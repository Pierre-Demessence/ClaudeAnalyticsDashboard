//! The widget's one request: `GET /api/widget` on the dashboard.
//!
//! Two dashboards can be up: the Docker one behind Traefik and the npm one. Windows
//! does not resolve `*.localhost` (browsers special-case it), so the connection always
//! goes to loopback and the `Host` header stays the real one for Traefik's routing.
//! The request is HTTP/1.0 so that the answer is never chunked: the body is everything
//! after the headers. Redirects are not followed.

use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use crate::view::WidgetView;

/// Where a dashboard listens, the `Host` it routes on and the address a click opens.
pub struct Dashboard {
    pub host: &'static str,
    pub port: u16,
    pub url: &'static str,
}

pub const TRAEFIK: Dashboard = Dashboard {
    host: "analytics.claudecode.localhost",
    port: 80,
    url: "http://analytics.claudecode.localhost/",
};
/// The npm package's server, on its default port.
pub const NPM: Dashboard = Dashboard {
    host: "localhost:4747",
    port: 4747,
    url: "http://localhost:4747/",
};
const CANDIDATES: [&Dashboard; 2] = [&TRAEFIK, &NPM];

/// Index in `CANDIDATES` of the dashboard that answered last, tried first next time.
static ACTIVE: AtomicUsize = AtomicUsize::new(0);
const TIMEOUT: Duration = Duration::from_secs(10);
/// The answer is a few hundred bytes; anything much larger is not the API.
const MAX_ANSWER: u64 = 64 * 1024;

fn request(host: &str, path: &str) -> String {
    format!("GET {path} HTTP/1.0\r\nHost: {host}\r\nAccept: application/json\r\nConnection: close\r\n\r\n")
}

fn parse(answer: &[u8]) -> Result<WidgetView, String> {
    let split = answer
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or("incomplete answer")?;
    let (head, body) = (&answer[..split], &answer[split + 4..]);
    let head = std::str::from_utf8(head).map_err(|_| "bad headers")?;
    let status = head
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .ok_or("no status line")?;
    if status != "200" {
        return Err(format!("HTTP {status}"));
    }
    serde_json::from_slice(body).map_err(|error| format!("bad answer: {error}"))
}

/// Asks the dashboard on `address` (always loopback) for the widget view.
fn fetch_from(address: SocketAddr, host: &str, path: &str) -> Result<WidgetView, String> {
    let mut stream = TcpStream::connect_timeout(&address, TIMEOUT).map_err(|error| error.to_string())?;
    stream.set_read_timeout(Some(TIMEOUT)).map_err(|error| error.to_string())?;
    stream.set_write_timeout(Some(TIMEOUT)).map_err(|error| error.to_string())?;
    stream
        .write_all(request(host, path).as_bytes())
        .map_err(|error| error.to_string())?;
    let mut answer = Vec::new();
    stream
        .take(MAX_ANSWER)
        .read_to_end(&mut answer)
        .map_err(|error| error.to_string())?;
    parse(&answer)
}

/// Tries the candidates, the last one that answered first. Returns its index and view.
fn fetch_first(candidates: &[&Dashboard], first: usize) -> Result<(usize, WidgetView), String> {
    let mut errors = Vec::new();
    for offset in 0..candidates.len() {
        let index = (first + offset) % candidates.len();
        let dashboard = candidates[index];
        let address = SocketAddr::from((Ipv4Addr::LOCALHOST, dashboard.port));
        match fetch_from(address, dashboard.host, "/api/widget") {
            Ok(view) => return Ok((index, view)),
            Err(error) => errors.push(format!("{}: {error}", dashboard.host)),
        }
    }
    Err(errors.join("; "))
}

pub fn fetch() -> Result<WidgetView, String> {
    let (index, view) = fetch_first(&CANDIDATES, ACTIVE.load(Ordering::Relaxed))?;
    ACTIVE.store(index, Ordering::Relaxed);
    Ok(view)
}

/// The address a click opens: the dashboard that answered last.
pub fn dashboard_url() -> &'static str {
    CANDIDATES[ACTIVE.load(Ordering::Relaxed)].url
}

#[cfg(test)]
mod tests {
    use std::net::TcpListener;
    use std::thread;

    use super::*;

    const BODY: &str = r#"{"fiveHour":{"estimated":false,"limit":95,"percent":42},"generatedAt":"x","weekly":{"estimated":false,"limit":98}}"#;

    fn serve(answer: String) -> (SocketAddr, thread::JoinHandle<String>) {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut received = [0; 1024];
            let size = stream.read(&mut received).unwrap();
            stream.write_all(answer.as_bytes()).unwrap();
            String::from_utf8_lossy(&received[..size]).into_owned()
        });
        (address, handle)
    }

    #[test]
    fn asks_for_the_route_with_the_real_host_header() {
        let (address, handle) = serve(format!("HTTP/1.0 200 OK\r\n\r\n{BODY}"));
        fetch_from(address, TRAEFIK.host, "/api/widget").unwrap();
        let received = handle.join().unwrap();
        assert!(received.starts_with("GET /api/widget HTTP/1.0\r\n"));
        assert!(received.contains("Host: analytics.claudecode.localhost\r\n"));
    }

    #[test]
    fn reads_the_view_from_the_body() {
        let (address, _) = serve(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{BODY}"));
        let view = fetch_from(address, TRAEFIK.host, "/api/widget").unwrap();
        assert_eq!(view.five_hour.percent, Some(42.0));
        assert_eq!(view.weekly.percent, None);
    }

    #[test]
    fn a_status_other_than_200_is_an_error() {
        assert_eq!(parse(b"HTTP/1.1 404 Not Found\r\n\r\nnope").unwrap_err(), "HTTP 404");
        assert_eq!(parse(b"HTTP/1.1 302 Found\r\nLocation: /\r\n\r\n").unwrap_err(), "HTTP 302");
    }

    #[test]
    fn a_body_that_is_not_a_view_is_an_error() {
        assert!(parse(b"HTTP/1.1 200 OK\r\n\r\n<html>").is_err());
        assert!(parse(b"HTTP/1.1 200 OK\r\n\r\n{\"fiveHour\":1}").is_err());
    }

    #[test]
    fn a_truncated_answer_is_an_error() {
        assert!(parse(b"HTTP/1.1 200 OK\r\n").is_err());
        assert!(parse(b"").is_err());
    }

    fn dashboard(address: SocketAddr, host: &'static str) -> Dashboard {
        Dashboard {
            host,
            port: address.port(),
            url: "http://unused/",
        }
    }

    fn refused() -> SocketAddr {
        TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap().local_addr().unwrap()
    }

    const OK: &str = "HTTP/1.0 200 OK\r\n\r\n";

    #[test]
    fn falls_back_to_the_second_dashboard_with_its_own_host() {
        let (up, handle) = serve(format!("{OK}{BODY}"));
        let (first, second) = (dashboard(refused(), "first"), dashboard(up, "second:1"));
        let (index, view) = fetch_first(&[&first, &second], 0).unwrap();
        assert_eq!(index, 1);
        assert_eq!(view.five_hour.percent, Some(42.0));
        assert!(handle.join().unwrap().contains("Host: second:1\r\n"));
    }

    #[test]
    fn starts_with_the_dashboard_that_answered_last() {
        let (first_up, _) = serve(format!("{OK}{BODY}"));
        let (second_up, _) = serve(format!("{OK}{BODY}"));
        let (first, second) = (dashboard(first_up, "first"), dashboard(second_up, "second"));
        assert_eq!(fetch_first(&[&first, &second], 1).unwrap().0, 1);
    }

    #[test]
    fn reports_every_failure_when_none_answers() {
        let (first, second) = (dashboard(refused(), "first"), dashboard(refused(), "second"));
        let error = fetch_first(&[&first, &second], 0).err().unwrap();
        assert!(error.contains("first:") && error.contains("second:"));
    }

    #[test]
    fn a_refused_connection_is_an_error() {
        let address = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap().local_addr().unwrap();
        assert!(fetch_from(address, TRAEFIK.host, "/api/widget").is_err());
    }
}
