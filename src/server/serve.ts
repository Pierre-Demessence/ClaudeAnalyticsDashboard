import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, isAbsolute, relative, resolve } from 'node:path';

import { assertSameOriginJson, collectWhileOpen, createApiMiddleware, onError, send } from './api.ts';

export interface ServeOptions {
  /** Name reported by `/api/health`, so a client can tell this dashboard from another program. */
  app: string;
  /** The built dashboard (`vite build`'s output), served as static files. */
  distDir: string;
  /** Loopback by default: the dashboard shows the user's projects and prompts' metadata. */
  host?: string;
  lockWaitMs?: number;
  /** 0 picks a free port. */
  port: number;
  /** Reported by `/api/health`, so a newer install can replace an older running server. */
  version: string;
}

/**
 * `localhost`, any `*.localhost` name, `127.0.0.1` and `[::1]`, with an optional port.
 * Checking the `Host` header keeps a web page from reading the API through a DNS name
 * that it points at 127.0.0.1 (DNS rebinding): the browser sends that name as the host.
 */
const LOOPBACK_HOST = /^(?:localhost|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i;

export function isLoopbackHost(host: string | undefined): boolean {
  return host !== undefined && LOOPBACK_HOST.test(host);
}

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

/** The file under `root` that a request path names, or null when it names none or escapes `root`. */
function fileUnder(root: string, pathname: string): null | string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  }
  catch {
    return null;
  }
  if (decoded.includes('\0'))
    return null;
  const target = resolve(root, `.${decoded}`);
  const fromRoot = relative(root, target);
  return fromRoot === '' || fromRoot.startsWith('..') || isAbsolute(fromRoot) ? null : target;
}

async function serveStatic(req: IncomingMessage, res: ServerResponse, root: string, pathname: string): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return send(res, 405, { error: 'Method not allowed' });
  }
  const file = fileUnder(root, pathname);
  const info = file ? await stat(file).catch(() => null) : null;
  if (!file || !info?.isFile())
    return send(res, 404, { error: 'Not found' });
  const body = await readFile(file);
  res.statusCode = 200;
  res.setHeader('Content-Type', CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream');
  res.setHeader('Content-Length', body.length);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Bundled assets carry a content hash in their name; the page that names them must stay fresh.
  res.setHeader('Cache-Control', pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
  res.end(req.method === 'HEAD' ? undefined : body);
}

/** The dashboard's HTTP server, not yet listening: static files, `/api/*` and the two control routes. */
export function createDashboardServer(options: Omit<ServeOptions, 'host' | 'port'>): Server {
  const api = createApiMiddleware({ lockWaitMs: options.lockWaitMs });
  const distDir = resolve(options.distDir);

  const server = createServer((req, res) => {
    // Before any route: the API answers a rebinding page just as well as the user's own tab.
    if (!isLoopbackHost(req.headers.host))
      return send(res, 403, { error: 'Forbidden host' });

    const [pathname = '/'] = (req.url ?? '/').split('?', 1);
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      if (req.method === 'GET' && pathname === '/api/health')
        return send(res, 200, { app: options.app, version: options.version });
      if (req.method === 'POST' && pathname === '/api/shutdown') {
        try {
          // Any local process could kill the server anyway; this keeps a web page from doing it.
          assertSameOriginJson(req);
        }
        catch (error) {
          return onError(res, error);
        }
        req.resume();
        res.statusCode = 204;
        res.on('finish', () => {
          server.close();
          server.closeIdleConnections();
          // A browser tab may keep a connection busy; do not wait for it.
          setTimeout(() => server.closeAllConnections(), 1000).unref();
        });
        res.end();
        return;
      }
      // Connect mounts a middleware by stripping its prefix, which the API's routes expect.
      const rest = (req.url ?? '').slice('/api'.length);
      req.url = rest.startsWith('/') ? rest : `/${rest}`;
      return api(req, res);
    }

    serveStatic(req, res, distDir, pathname).catch((error: unknown) => onError(res, error));
  });
  return server;
}

/** Starts the dashboard on `host:port` and resolves once it listens; rejects on `EADDRINUSE` and the like. */
export async function startServer(options: ServeOptions): Promise<Server> {
  const server = createDashboardServer(options);
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(options.port, options.host ?? '127.0.0.1', () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });
  collectWhileOpen(server);
  return server;
}
