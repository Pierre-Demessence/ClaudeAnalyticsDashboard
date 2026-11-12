import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { homedir } from 'node:os';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';

export const DEFAULT_PORT = 4747;

/** What `/api/health` reports, telling this dashboard from another program and one release from another. */
export interface Identity {
  app: string;
  version: string;
}

export type PortState = { kind: 'free' } | { kind: 'ours'; version: string } | { kind: 'other' };

export interface CliOptions {
  background: boolean;
  command: 'install-hook' | 'setup' | 'start' | 'stop';
  help: boolean;
  /** Docker only: the container must listen beyond loopback for Traefik to reach it. */
  host?: string;
  open: boolean;
  port: number;
  /** `install-hook` writes the hook instead of printing it. */
  apply: boolean;
}

const COMMANDS = new Set<CliOptions['command']>(['install-hook', 'setup', 'start', 'stop']);
const PROBE_TIMEOUT_MS = 3_000;
/** `/api/health` answers a few dozen characters; a program streaming more is not the dashboard. */
const MAX_REPLY_CHARS = 64 * 1024;
const STOP_TIMEOUT_MS = 10_000;

export class PortTakenError extends Error {
  constructor(port: number) {
    super(`Port ${port} is used by another program. Set the CCA_PORT environment variable to a free port and run the command again.`);
  }
}

function parsePort(text: string, source: string): number {
  const port = Number(text);
  if (!/^\d+$/.test(text) || port < 1 || port > 65_535)
    throw new Error(`${source} must be a port number from 1 to 65535, not "${text}".`);
  return port;
}

/** Reads the command line; the port comes from `--port`, else `CCA_PORT`, else 4747. Throws on a mistake. */
export function parseCli(argv: string[], env: NodeJS.ProcessEnv): CliOptions {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    args: argv,
    options: {
      'apply': { type: 'boolean' },
      'background': { type: 'boolean' },
      'help': { short: 'h', type: 'boolean' },
      'host': { type: 'string' },
      'no-open': { type: 'boolean' },
      'port': { type: 'string' },
    },
  });
  const [command = 'start', ...extra] = positionals;
  if (!COMMANDS.has(command as CliOptions['command']))
    throw new Error(`Unknown command "${command}".`);
  if (extra.length)
    throw new Error(`Unexpected argument "${extra[0]}".`);
  let port = DEFAULT_PORT;
  if (values.port !== undefined)
    port = parsePort(values.port, '--port');
  else if (env.CCA_PORT)
    port = parsePort(env.CCA_PORT, 'CCA_PORT');
  return {
    apply: values.apply ?? false,
    background: values.background ?? false,
    command: command as CliOptions['command'],
    help: values.help ?? false,
    host: values.host,
    open: !values['no-open'],
    port,
  };
}

interface Reply {
  body: string;
  status: number;
}

/**
 * One request to `127.0.0.1:port` on a fresh connection: a pooled one could still reach a
 * server whose listener has closed, making it look alive after a shutdown.
 */
function call(port: number, method: 'GET' | 'POST', path: string, timeoutMs: number): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ agent: false, headers: method === 'POST' ? { 'Content-Type': 'application/json' } : {}, host: '127.0.0.1', method, path, port, timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        body += chunk;
        if (body.length > MAX_REPLY_CHARS)
          req.destroy(new Error('Reply too large'));
      });
      res.on('end', () => resolve({ body, status: res.statusCode ?? 0 }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('No reply')));
    req.on('error', reject);
    req.end(method === 'POST' ? '{}' : undefined);
  });
}

/** Who answers on `port`: nothing, this dashboard (with its version), or another program. */
export async function probe(port: number, app: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<PortState> {
  let reply: Reply;
  try {
    reply = await call(port, 'GET', '/api/health', timeoutMs);
  }
  catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ECONNREFUSED' ? { kind: 'free' } : { kind: 'other' };
  }
  let body: Partial<Identity> | null = null;
  try {
    body = JSON.parse(reply.body) as Partial<Identity> | null;
  }
  catch {}
  return reply.status === 200 && body?.app === app && typeof body.version === 'string' ? { kind: 'ours', version: body.version } : { kind: 'other' };
}

async function waitUntil(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check())
      return true;
    if (Date.now() >= deadline)
      return false;
    await delay(100);
  }
}

/** Resolves true once this exact release answers on `port`, false after `timeoutMs`. */
export function waitUntilUp(port: number, identity: Identity, timeoutMs: number): Promise<boolean> {
  return waitUntil(async () => {
    const state = await probe(port, identity.app);
    return state.kind === 'ours' && state.version === identity.version;
  }, timeoutMs);
}

/**
 * Asks the dashboard on `port` to stop and resolves once the port refuses connections:
 * `/api/shutdown` answers before the listener closes, so starting at once could collide.
 */
export async function stopServer(port: number, app: string, timeoutMs = STOP_TIMEOUT_MS): Promise<void> {
  let status: number;
  try {
    ({ status } = await call(port, 'POST', '/api/shutdown', PROBE_TIMEOUT_MS));
  }
  catch (error) {
    // Stopped since it was probed, by a concurrent run: the goal is reached.
    if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED')
      return;
    throw error;
  }
  if (status !== 204)
    throw new Error(`The dashboard on port ${port} refused to stop (HTTP ${status}).`);
  if (!await waitUntil(async () => (await probe(port, app)).kind === 'free', timeoutMs))
    throw new Error(`The dashboard on port ${port} did not stop within ${Math.round(timeoutMs / 1000)} s.`);
}

/**
 * Readies `port` for this release: 'running' when it already serves it, 'free' once nothing
 * does, after stopping another release of the dashboard. Throws `PortTakenError` when
 * another program holds the port.
 */
export async function prepareStart(port: number, identity: Identity): Promise<'free' | 'running'> {
  const state = await probe(port, identity.app);
  if (state.kind === 'free')
    return 'free';
  if (state.kind === 'other')
    throw new PortTakenError(port);
  if (state.version === identity.version)
    return 'running';
  await stopServer(port, identity.app);
  return 'free';
}

/** Runs `script` with the same Node in a detached process, without a console window, and returns at once. */
export function spawnBackground(script: string, args: string[]): void {
  // Not the caller's cwd: a hook runs in the user's project, which Windows would keep from being renamed or deleted.
  spawn(process.execPath, [script, ...args], { cwd: homedir(), detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

/** Opens `url` in the default browser; the caller prints the URL too, in case none opens. */
export function openBrowser(url: string): void {
  let command = 'xdg-open';
  let args = [url];
  if (process.platform === 'win32') {
    // No shell: `start` would need cmd.exe and its quoting rules.
    command = 'rundll32.exe';
    args = ['url.dll,FileProtocolHandler', url];
  }
  else if (process.platform === 'darwin') {
    command = 'open';
  }
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  child.unref();
}
