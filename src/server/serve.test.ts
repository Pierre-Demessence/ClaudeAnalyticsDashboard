// @vitest-environment node
import type { AddressInfo } from 'node:net';

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Store } from '../collector/store.ts';
import { isLoopbackHost, startServer } from './serve.ts';

interface Reply { body: string; headers: Record<string, string | string[] | undefined>; status: number }

describe('isLoopbackHost', () => {
  it.each([
    'localhost',
    'localhost:4747',
    'LOCALHOST:4173',
    'analytics.claudecode.localhost',
    'analytics.claudecode.localhost:80',
    '127.0.0.1',
    '127.0.0.1:4747',
    '[::1]',
    '[::1]:4747',
  ])('accepts %s', (host) => {
    expect(isLoopbackHost(host)).toBe(true);
  });

  it.each([
    undefined,
    '',
    'example.com',
    'example.com:4747',
    'localhost.evil.com',
    'evil.com/localhost',
    'evil.localhost.com',
    'localhost:99999999',
    'localhost:',
    '127.0.0.2',
    '127.0.0.1.evil.com',
    '0.0.0.0',
    '[::2]',
    'localhost, evil.com',
    ' localhost',
  ])('rejects %s', (host) => {
    expect(isLoopbackHost(host)).toBe(false);
  });
});

describe('dashboard server', () => {
  let root: string;
  let port: number;
  let close: () => Promise<void>;
  const env = { ...process.env };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'cca-serve-'));
    process.env.CCA_DATA_DIR = join(root, 'data');
    process.env.CLAUDE_CONFIG_DIR = join(root, 'claude');
    await mkdir(join(root, 'claude', 'projects'), { recursive: true });
    // Endpoint off: these tests never touch the network or credentials.
    const store = new Store(process.env.CCA_DATA_DIR);
    await store.ensureDir();
    await store.saveSettings({ endpointEnabled: false, limitThreshold: 95, planHistory: [], throttleMinutes: 15, weekLimitThreshold: 98 });

    await mkdir(join(root, 'dist', 'assets'), { recursive: true });
    await writeFile(join(root, 'dist', 'index.html'), '<!doctype html><title>home</title>');
    await writeFile(join(root, 'dist', 'assets', 'app-1.js'), 'export {};');
    // Outside dist, in a folder whose name starts with "dist": a prefix check would let it through.
    await writeFile(join(root, 'secret.txt'), 'secret');
    await mkdir(join(root, 'dist-private'));
    await writeFile(join(root, 'dist-private', 'secret.txt'), 'secret');

    const server = await startServer({ app: 'Test app', distDir: join(root, 'dist'), lockWaitMs: 200, port: 0, version: '1.2.3' });
    port = (server.address() as AddressInfo).port;
    close = () => new Promise(resolve => server.close(() => resolve()));
  });

  afterAll(async () => {
    await close();
    process.env = env;
    await rm(root, { force: true, recursive: true });
  });

  /** `fetch` cannot set `Host` or send an unnormalised path; the raw client can. */
  const raw = (path: string, { headers = {}, method = 'GET' }: { headers?: Record<string, string>; method?: string } = {}) =>
    new Promise<Reply>((resolve, reject) => {
      const req = request({ headers: { Host: `localhost:${port}`, ...headers }, host: '127.0.0.1', method, path, port }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (body += chunk));
        res.on('end', () => resolve({ body, headers: res.headers, status: res.statusCode ?? 0 }));
      });
      req.on('error', reject);
      req.end(method === 'POST' ? '{}' : undefined);
    });

  it('serves the dashboard page at / and its assets with their type', async () => {
    const page = await raw('/');
    expect(page.status).toBe(200);
    expect(page.body).toContain('<title>home</title>');
    expect(page.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(page.headers['cache-control']).toBe('no-cache');

    const asset = await raw('/assets/app-1.js');
    expect(asset.status).toBe(200);
    expect(asset.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(asset.headers['cache-control']).toContain('immutable');
  });

  it('answers HEAD without a body and refuses other methods on files', async () => {
    const head = await raw('/', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.body).toBe('');
    expect((await raw('/', { method: 'POST' })).status).toBe(405);
  });

  it('answers 404 for a missing file or a directory', async () => {
    expect((await raw('/nope.js')).status).toBe(404);
    expect((await raw('/assets')).status).toBe(404);
  });

  it.each([
    '/../secret.txt',
    '/%2e%2e/secret.txt',
    '/..%2fsecret.txt',
    '/assets/..%2f..%2fsecret.txt',
    '/..\\secret.txt',
    '/../dist-private/secret.txt',
    '/%2e%2e%2fdist-private%2fsecret.txt',
    '/..%5csecret.txt',
    '/C:/Windows/win.ini',
    '//example.com/secret.txt',
    '/apix',
    '/%00',
    '/%zz',
  ])('answers 404 for a path escaping dist: %s', async (path) => {
    const reply = await raw(path);
    expect(reply.status).toBe(404);
    expect(reply.body).not.toContain('secret');
  });

  it.each([
    '/',
    '/assets/app-1.js',
    '/api/health',
    '/api/summary',
    '/api/hook',
    '/api/shutdown',
  ])('answers 403 on %s when the Host is not loopback', async (path) => {
    for (const host of ['evil.example.com', 'evil.example.com:4747', 'localhost.evil.com']) {
      const reply = await raw(path, { headers: { Host: host }, method: path === '/api/hook' || path === '/api/shutdown' ? 'POST' : 'GET' });
      expect(reply.status).toBe(403);
    }
  });

  it('accepts the loopback names a browser or the widget sends', async () => {
    for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`, 'analytics.claudecode.localhost'])
      expect((await raw('/api/health', { headers: { Host: host } })).status).toBe(200);
  });

  it('reports the app name and version on /api/health', async () => {
    const reply = await raw('/api/health');
    expect(JSON.parse(reply.body)).toEqual({ app: 'Test app', version: '1.2.3' });
  });

  it('serves the API with the /api prefix stripped', async () => {
    const summary = await raw('/api/summary?collect=0&tz=Europe/Paris');
    expect(summary.status).toBe(200);
    expect(JSON.parse(summary.body)).toMatchObject({ endpointEnabled: false, timeZone: 'Europe/Paris' });
    expect((await raw('/api/unknown')).status).toBe(404);
    expect((await raw('/api')).status).toBe(404);
    expect((await raw('/api?x=1')).status).toBe(404);
  });

  it('applies the JSON and same-origin check to /api/shutdown', async () => {
    const notJson = await raw('/api/shutdown', { method: 'POST' });
    expect(notJson.status).toBe(415);
    const crossSite = await raw('/api/shutdown', { headers: { 'Content-Type': 'application/json', 'Origin': 'http://evil.example.com' }, method: 'POST' });
    expect(crossSite.status).toBe(403);
    expect((await raw('/api/health')).status).toBe(200);
  });
});

describe('dashboard server shutdown', () => {
  it('stops listening after a same-origin POST to /api/shutdown', async () => {
    const dist = await mkdtemp(join(tmpdir(), 'cca-serve-dist-'));
    try {
      const server = await startServer({ app: 'Test app', distDir: dist, port: 0, version: '1.0.0' });
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const closed = new Promise<void>(resolve => server.once('close', () => resolve()));

      const response = await fetch(`${base}/api/shutdown`, { body: '{}', headers: { 'Content-Type': 'application/json' }, method: 'POST' });
      expect(response.status).toBe(204);
      await closed;
      expect(server.listening).toBe(false);
      await expect(fetch(`${base}/api/health`)).rejects.toThrow();
    }
    finally {
      await rm(dist, { force: true, recursive: true });
    }
  });

  it('rejects when the port is taken', async () => {
    const dist = await mkdtemp(join(tmpdir(), 'cca-serve-dist-'));
    const first = await startServer({ app: 'Test app', distDir: dist, port: 0, version: '1.0.0' });
    try {
      const { port } = first.address() as AddressInfo;
      await expect(startServer({ app: 'Test app', distDir: dist, port, version: '1.0.0' })).rejects.toMatchObject({ code: 'EADDRINUSE' });
    }
    finally {
      await new Promise<void>(resolve => first.close(() => resolve()));
      await rm(dist, { force: true, recursive: true });
    }
  });
});
