// @vitest-environment node
import type { RequestListener } from 'node:http';
import type { AddressInfo, Server, Socket } from 'node:net';

import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_PORT, parseCli, PortTakenError, prepareStart, probe, stopServer } from './control.ts';
import { startServer } from './serve.ts';

const APP = 'Test app';
const portOf = (server: Server) => (server.address() as AddressInfo).port;
const sockets = new Set<Socket>();
/** Listens on a free loopback port, tracking connections so `close` never waits on one a test left open. */
function listen<T extends Server>(server: T): Promise<T> {
  server.on('connection', (socket: Socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  return new Promise<T>(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}
const close = (server: Server) => new Promise<void>(resolve => server.listening ? server.close(() => resolve()) : resolve());

/** A port nothing listens on: taken from the OS, then released. */
async function freePort(): Promise<number> {
  const server = await listen(createTcpServer());
  const port = portOf(server);
  await close(server);
  return port;
}

describe('parseCli', () => {
  it('starts and opens on port 4747 with no arguments', () => {
    expect(parseCli([], {})).toEqual({ apply: false, background: false, command: 'start', help: false, host: undefined, open: true, port: DEFAULT_PORT });
  });

  it('reads the hook fallback\'s flags', () => {
    expect(parseCli(['start', '--background', '--no-open', '--port', '5000'], {})).toMatchObject({ background: true, command: 'start', open: false, port: 5000 });
  });

  it('takes the port from CCA_PORT unless --port is given', () => {
    expect(parseCli(['setup'], { CCA_PORT: '4800' }).port).toBe(4800);
    expect(parseCli(['setup', '--port', '4900'], { CCA_PORT: '4800' }).port).toBe(4900);
  });

  it.each([
    [['--port', '0'], {}],
    [['--port', '70000'], {}],
    [['--port', '47a'], {}],
    [[], { CCA_PORT: 'x' }],
    [['serve'], {}],
    [['start', 'extra'], {}],
    [['--unknown'], {}],
  ])('rejects %j with env %j', (argv, env) => {
    expect(() => parseCli(argv, env)).toThrow();
  });

  it('names CCA_PORT when its value is wrong', () => {
    expect(() => parseCli([], { CCA_PORT: '-1' })).toThrow(/CCA_PORT/);
  });
});

describe('port control', () => {
  let dist: string;
  const servers: Server[] = [];

  beforeEach(async () => {
    dist = await mkdtemp(join(tmpdir(), 'cca-control-'));
  });

  afterEach(async () => {
    const closing = servers.splice(0).map(close);
    for (const socket of sockets)
      socket.destroy();
    await Promise.all(closing);
    await rm(dist, { force: true, recursive: true });
  });

  const dashboard = async (version: string) => {
    const server = await startServer({ app: APP, distDir: dist, port: 0, version });
    servers.push(server);
    return server;
  };

  const otherProgram = async (handler: RequestListener) => {
    const server = await listen(createHttpServer(handler));
    servers.push(server);
    return server;
  };

  it('probes a free port, the dashboard and another program', async () => {
    expect(await probe(await freePort(), APP)).toEqual({ kind: 'free' });
    expect(await probe(portOf(await dashboard('1.0.0')), APP)).toEqual({ kind: 'ours', version: '1.0.0' });
    expect(await probe(portOf(await otherProgram((_, res) => res.end('hello'))), APP)).toEqual({ kind: 'other' });
    const lookalike = await otherProgram((_, res) => res.end(JSON.stringify({ app: 'Another app', version: '1.0.0' })));
    expect(await probe(portOf(lookalike), APP)).toEqual({ kind: 'other' });
  });

  it('calls a program speaking no HTTP another program', async () => {
    const tcp = await listen(createTcpServer(socket => socket.end('SSH-2.0-x\r\n')));
    servers.push(tcp);
    expect(await probe(portOf(tcp), APP)).toEqual({ kind: 'other' });
  });

  it('calls a program that never answers another program', async () => {
    const silent = await listen(createTcpServer(() => {}));
    servers.push(silent);
    expect(await probe(portOf(silent), APP, 300)).toEqual({ kind: 'other' });
  });

  it('leaves the same release running, so the CLI only opens the browser', async () => {
    const server = await dashboard('1.0.0');
    expect(await prepareStart(portOf(server), { app: APP, version: '1.0.0' })).toBe('running');
    expect(server.listening).toBe(true);
  });

  it('stops another release and waits until its port refuses connections', async () => {
    const server = await dashboard('1.0.0');
    const port = portOf(server);
    expect(await prepareStart(port, { app: APP, version: '2.0.0' })).toBe('free');
    expect(server.listening).toBe(false);
    expect(await probe(port, APP)).toEqual({ kind: 'free' });
    // The new release can take the port at once.
    servers.push(await startServer({ app: APP, distDir: dist, port, version: '2.0.0' }));
    expect(await probe(port, APP)).toEqual({ kind: 'ours', version: '2.0.0' });
  });

  it('reports a free port as free', async () => {
    expect(await prepareStart(await freePort(), { app: APP, version: '1.0.0' })).toBe('free');
  });

  it('refuses a port held by another program, naming the port and CCA_PORT', async () => {
    const port = portOf(await otherProgram((_, res) => {
      res.statusCode = 404;
      res.end();
    }));
    const attempt = prepareStart(port, { app: APP, version: '1.0.0' });
    await expect(attempt).rejects.toBeInstanceOf(PortTakenError);
    await expect(attempt).rejects.toThrow(new RegExp(`Port ${port} .*CCA_PORT`));
  });

  it('fails to stop a program that refuses the shutdown request', async () => {
    const port = portOf(await otherProgram((_, res) => {
      res.statusCode = 403;
      res.end();
    }));
    await expect(stopServer(port, APP)).rejects.toThrow(/refused to stop/);
  });

  it('waits for the listener to close after the shutdown reply, not just for the reply', async () => {
    let closedAt = 0;
    const slow = await otherProgram((req, res) => {
      res.statusCode = req.url === '/api/shutdown' ? 204 : 200;
      res.end(req.url === '/api/shutdown' ? undefined : JSON.stringify({ app: APP, version: '1.0.0' }));
      if (req.url === '/api/shutdown')
        setTimeout(() => slow.close(() => (closedAt = Date.now())), 300);
    });
    const port = portOf(slow);
    await stopServer(port, APP);
    expect(closedAt).toBeGreaterThan(0);
    expect(await probe(port, APP)).toEqual({ kind: 'free' });
  });

  it('gives up when the listener never closes', async () => {
    const stuck = await otherProgram((_, res) => {
      res.statusCode = 204;
      res.end();
    });
    await expect(stopServer(portOf(stuck), APP, 300)).rejects.toThrow(/did not stop/);
  });

  it('counts a server gone before the shutdown request as stopped', async () => {
    await expect(stopServer(await freePort(), APP)).resolves.toBeUndefined();
  });
});
