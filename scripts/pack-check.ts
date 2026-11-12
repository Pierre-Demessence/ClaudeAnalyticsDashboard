/**
 * Packs the dashboard, installs the tarball in a throwaway prefix and runs the installed
 * binary like a friend would: `setup` (hook + background server), then fetches the page and
 * the summary, then `stop`. Uses a temp data dir and Claude config dir, never the user's.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const BIN = 'claude-analytics-dashboard';
const windows = process.platform === 'win32';
const repo = join(import.meta.dirname, '..');

/** AC2: the tarball holds the prebuilt app and these files, and nothing else. */
const ALLOWED = /^(?:dist\/|lib\/|package\.json$|README\.md$|LICENSE$|CHANGELOG\.md$)/;

function fail(message: string): never {
  throw new Error(message);
}

function run(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): string {
  // npm and the installed shim are `.cmd` files on Windows, which only a shell starts.
  const result = spawnSync(windows ? [command, ...args].map(part => `"${part}"`).join(' ') : command, windows ? [] : args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
    shell: windows,
  });
  if (result.status !== 0)
    fail(`${command} ${args.join(' ')} failed (${result.status}):\n${result.stdout}${result.stderr}`);
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

async function getText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok)
    fail(`GET ${url} answered ${response.status}`);
  return response.text();
}

const work = mkdtempSync(join(tmpdir(), 'cca-pack-'));
const prefix = join(work, 'prefix');
const env = {
  CCA_DATA_DIR: join(work, 'data'),
  CLAUDE_CONFIG_DIR: join(work, 'claude'),
};
mkdirSync(env.CLAUDE_CONFIG_DIR);
let port = 0;
let bin = '';
let passed = false;

try {
  // Run apart from `npm pack`: the build's own output would end up in the JSON that `--json` prints.
  run('npm', ['run', 'prepack'], { cwd: repo });
  const [packed] = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', work], { cwd: repo })) as Array<{
    files: Array<{ path: string }>;
    filename: string;
  }>;
  if (!packed)
    fail('npm pack reported no tarball');
  const stray = packed.files.map(file => file.path).filter(path => !ALLOWED.test(path));
  if (stray.length > 0)
    fail(`The tarball holds files outside dist/ and lib/:\n${stray.join('\n')}`);
  console.log(`Packed ${packed.filename}: ${packed.files.length} files.`);

  run('npm', ['install', '--global', '--prefix', prefix, '--no-audit', '--no-fund', join(work, packed.filename)]);
  const installed = join(windows ? prefix : join(prefix, 'lib'), 'node_modules', BIN);
  const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8')) as { dependencies?: object };
  if (Object.keys(manifest.dependencies ?? {}).length > 0)
    fail('The package has runtime dependencies.');
  if (existsSync(join(installed, 'node_modules')))
    fail('Installing the package downloaded dependencies.');

  bin = windows ? join(prefix, `${BIN}.cmd`) : join(prefix, 'bin', BIN);
  port = await freePort();
  const options = ['--no-open', '--port', String(port)];
  console.log(run(bin, ['setup', ...options], { env }));

  const base = `http://localhost:${port}`;
  const page = await getText(`${base}/`);
  const script = /<script[^>]+src="([^"]+)"/.exec(page)?.[1];
  if (!page.includes('<div id="app">') || !script)
    fail('GET / did not return the dashboard page.');
  await getText(`${base}${script}`);
  const summary = JSON.parse(await getText(`${base}/api/summary`)) as object | null;
  if (summary === null || typeof summary !== 'object' || !('breakdown' in summary) || !('activity' in summary))
    fail('GET /api/summary did not return a summary.');
  const settings = readFileSync(join(env.CLAUDE_CONFIG_DIR, 'settings.json'), 'utf8');
  if (!settings.includes(`localhost:${port}/api/hook`))
    fail('setup did not add the hook to settings.json.');
  passed = true;
  console.log('The installed dashboard serves the page and the summary.');
}
finally {
  try {
    if (bin && port)
      run(bin, ['stop', '--port', String(port)], { env });
  }
  catch (error) {
    // A broken `stop` fails the check, unless an earlier error is already on its way out.
    if (passed)
      process.exitCode = 1;
    console.error(`Could not stop the dashboard: ${error instanceof Error ? error.message : String(error)}`);
  }
  rmSync(work, { force: true, maxRetries: 10, recursive: true, retryDelay: 200 });
}
