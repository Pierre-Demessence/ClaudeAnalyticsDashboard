/**
 * Builds the Docker image and starts it through `docker/compose.yaml`, the file users download,
 * with an override that swaps in the local image, temp Claude and data dirs and a free loopback
 * port. Passes when the container turns healthy and answers like a friend's would. Never mounts
 * the user's own dirs: the merged config is checked before anything starts.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';

const IMAGE = 'cca-image-check';
const PROJECT = 'cca-image-check';
const PORT_IN_CONTAINER = 4173;
const repo = join(import.meta.dirname, '..');
const composeFile = join(repo, 'docker', 'compose.yaml');

interface ComposeConfig {
  networks?: Record<string, { external?: boolean }>;
  services: Record<string, {
    cap_drop?: string[];
    ports?: Array<{ host_ip?: string; protocol?: string; published?: string; target?: number }>;
    read_only?: boolean;
    security_opt?: string[];
    tmpfs?: string[];
    volumes?: Array<{ read_only?: boolean; source?: string; target?: string; type?: string }>;
  }>;
}

function fail(message: string): never {
  throw new Error(message);
}

// Docker is a native executable, so arguments go through as an array: no shell, no quoting.
function run(args: string[], options: { allowFailure?: boolean } = {}): string {
  // A cold build prints more than spawnSync's default 1 MB buffer holds.
  const result = spawnSync('docker', args, { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error)
    fail(`Could not start docker: ${result.error.message}. Is Docker installed?`);
  if (result.status !== 0 && !options.allowFailure)
    fail(`docker ${args.join(' ')} failed (${result.status}):\n${result.stdout}${result.stderr}`);
  return result.stdout;
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const probe = createServer();
    probe.once('error', rejectPort);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolvePort(port));
    });
  });
}

/** `fetch` does not let a script choose the Host header, and the Host check is what this proves. */
function get(port: number, path: string, host: string): Promise<{ body: string; status: number }> {
  return new Promise((resolveGet, rejectGet) => {
    const req = request({ headers: { Host: host }, host: '127.0.0.1', path, port, timeout: 10_000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => body += chunk);
      res.on('end', () => resolveGet({ body, status: res.statusCode ?? 0 }));
    });
    req.once('timeout', () => req.destroy(new Error(`GET ${path} timed out`)));
    req.once('error', rejectGet);
    req.end();
  });
}

function readConfig(files: string[]): ComposeConfig {
  const args = ['compose', '-p', PROJECT, ...files.flatMap(file => ['-f', file]), 'config', '--format', 'json'];
  return JSON.parse(run(args)) as ComposeConfig;
}

/** Compose resolves a path to the platform's own spelling; compare them in one. */
function samePath(a: string, b: string): boolean {
  const normalize = (path: string): string => resolve(path).replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();
  return normalize(a) === normalize(b);
}

/** AC3: the published file keeps its promises, read from its own config without the override. */
function checkPublishedFile(): void {
  const config = readConfig([composeFile]);
  const names = Object.keys(config.services);
  const service = config.services.dashboard;
  if (names.length !== 1 || !service)
    fail('docker/compose.yaml must define the single service "dashboard".');

  const { ports = [], volumes = [] } = service;
  const [port] = ports;
  if (ports.length !== 1 || !port || port.host_ip !== '127.0.0.1' || port.published !== '4747' || port.target !== PORT_IN_CONTAINER)
    fail(`The published file must publish only 127.0.0.1:4747 -> ${PORT_IN_CONTAINER}, not ${JSON.stringify(ports)}.`);

  const claude = volumes.find(volume => volume.target === '/claude');
  const data = volumes.find(volume => volume.target === '/data');
  if (volumes.length !== 2 || !claude || !data)
    fail(`The published file must mount only /claude and /data, not ${JSON.stringify(volumes)}.`);
  if (claude.read_only !== true || !samePath(claude.source ?? '', join(homedir(), '.claude')))
    fail('~/.claude must be mounted read-only at /claude.');
  if (data.read_only === true || !samePath(data.source ?? '', join(homedir(), '.claude-code-analytics')))
    fail('~/.claude-code-analytics must be mounted read-write at /data.');

  if (service.read_only !== true)
    fail('The published file must keep read_only.');
  if (!service.tmpfs?.includes('/tmp'))
    fail('The published file must keep the /tmp tmpfs.');
  if (service.cap_drop?.join() !== 'ALL')
    fail('The published file must keep cap_drop: ALL.');
  if (!service.security_opt?.includes('no-new-privileges:true'))
    fail('The published file must keep no-new-privileges.');
  const external = Object.entries(config.networks ?? {}).filter(([, network]) => network.external);
  if (external.length > 0)
    fail(`The published file must join no external network: ${external.map(([name]) => name).join(', ')}.`);
}

const work = mkdtempSync(join(tmpdir(), 'cca-image-'));
const claudeDir = join(work, 'claude');
const dataDir = join(work, 'data');
mkdirSync(claudeDir);
mkdirSync(dataDir);
// The container runs as uid 1000, which on Linux is not the user running this script: it must
// be able to enter the temp dir and write the data dir, as it does for a real user's.
chmodSync(work, 0o755);
chmodSync(dataDir, 0o777);
let files: string[] = [];
let started = false;

try {
  if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0)
    fail('Docker is not running (or not installed): start Docker Desktop and run this again.');

  checkPublishedFile();

  const port = await freePort();
  // JSON strings are valid YAML scalars, so no escaping to get right for Windows paths.
  const override = join(work, 'override.yaml');
  writeFileSync(override, `${[
    'services:',
    '  dashboard:',
    `    image: ${JSON.stringify(IMAGE)}`,
    '    pull_policy: never',
    '    ports: !override',
    `      - ${JSON.stringify(`127.0.0.1:${port}:${PORT_IN_CONTAINER}`)}`,
    '    volumes: !override',
    '      - type: bind',
    `        source: ${JSON.stringify(claudeDir)}`,
    '        target: /claude',
    '        read_only: true',
    '      - type: bind',
    `        source: ${JSON.stringify(dataDir)}`,
    '        target: /data',
  ].join('\n')}\n`);
  files = [composeFile, override];

  // AC2: nothing starts if the merged config still mounts anything but the two temp dirs.
  const mounts = readConfig(files).services.dashboard?.volumes ?? [];
  const allowed = [claudeDir, dataDir];
  const stray = mounts.filter(volume => !allowed.some(dir => samePath(dir, volume.source ?? '')));
  if (mounts.length !== 2 || stray.length > 0)
    fail(`The merged config mounts paths outside the temp dirs: ${JSON.stringify(mounts)}.`);

  console.log('Building the image...');
  run(['build', '-t', IMAGE, '.']);

  const compose = (...args: string[]): string => run(['compose', '-p', PROJECT, ...files.flatMap(file => ['-f', file]), ...args]);
  started = true;
  compose('up', '--detach', '--wait', '--wait-timeout', '120');
  console.log('The container is healthy.');

  const loopback = `localhost:${port}`;
  const page = await get(port, '/', loopback);
  if (page.status !== 200 || !page.body.includes('<div id="app">'))
    fail(`GET / answered ${page.status} without the dashboard page.`);
  const health = await get(port, '/api/health', loopback);
  const reported = health.status === 200 ? (JSON.parse(health.body) as { app?: string }).app : undefined;
  if (typeof reported !== 'string' || reported === '')
    fail(`GET /api/health answered ${health.status}: ${health.body}`);
  const foreign = await get(port, '/', 'example.com');
  if (foreign.status !== 403)
    fail(`A request with Host: example.com answered ${foreign.status}, not 403.`);
  // The summary request runs the collector once (the endpoint is off by default, so no network
  // call): the status file proves the container can write the mounted data dir.
  const summary = await get(port, '/api/summary', loopback);
  if (summary.status !== 200 || !existsSync(join(dataDir, 'status.json')))
    fail(`GET /api/summary answered ${summary.status} and the container did not write its status file to /data.`);
  console.log('The container serves the page and the health check, writes /data and refuses a foreign Host.');
}
finally {
  if (started) {
    // The check already failed or passed; a stuck cleanup must still be said out loud.
    const down = spawnSync('docker', ['compose', '-p', PROJECT, ...files.flatMap(file => ['-f', file]), 'down', '--volumes', '--remove-orphans'], { cwd: repo, encoding: 'utf8' });
    if (down.status !== 0) {
      process.exitCode = 1;
      console.error(`Could not remove the container:\n${down.stdout}${down.stderr}`);
    }
  }
  try {
    rmSync(work, { force: true, maxRetries: 10, recursive: true, retryDelay: 200 });
  }
  catch (error) {
    // Files the container wrote as another uid can resist a Linux user; never let that hide the result.
    console.error(`Could not remove ${work}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
