import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import type { CliOptions, Identity } from './control.ts';

import { BIN_NAME, installHook, npmHook } from '../collector/hook.ts';
import { claudeDir } from '../collector/store.ts';
import { openBrowser, parseCli, PortTakenError, prepareStart, probe, spawnBackground, stopServer, waitUntilUp } from './control.ts';
import { startServer } from './serve.ts';

// The same two levels up from `src/server/` in the repository and `lib/server/` in the package.
const root = resolve(import.meta.dirname, '../..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string; version: string };
const identity: Identity = { app: pkg.name, version: pkg.version };
const distDir = join(root, 'dist');
const BACKGROUND_START_MS = 15_000;

const USAGE = `Usage: ${BIN_NAME} [command] [options]

Commands:
  start          Serve the dashboard and open it (the default)
  stop           Stop the running dashboard
  setup          Add the Claude Code hook, start the dashboard in the background and open it
  install-hook   Print the Claude Code hook; --apply adds it to settings.json

Options:
  --background   Start in the background and return
  --no-open      Do not open the browser
  --port <n>     Port to serve on (default: CCA_PORT, else 4747)
  --host <addr>  Address to listen on (default 127.0.0.1; for Docker)`;

async function start(options: CliOptions): Promise<void> {
  const url = `http://localhost:${options.port}/`;
  if (!existsSync(join(distDir, 'index.html')))
    throw new Error(`${distDir} has no index.html: run \`npm run build\` first.`);
  if (await prepareStart(options.port, identity) === 'running') {
    console.log(`The dashboard is already running at ${url}`);
  }
  else if (options.background) {
    const host = options.host ? ['--host', options.host] : [];
    spawnBackground(fileURLToPath(import.meta.url), ['start', '--no-open', '--port', String(options.port), ...host]);
    if (!await waitUntilUp(options.port, identity, BACKGROUND_START_MS))
      throw new Error(`The dashboard did not start in the background; run \`${BIN_NAME} start\` to see why.`);
    console.log(`The dashboard runs in the background at ${url}`);
  }
  else {
    await startServer({ ...identity, distDir, host: options.host, port: options.port }).catch((error: unknown) => {
      throw (error as NodeJS.ErrnoException).code === 'EADDRINUSE' ? new PortTakenError(options.port) : error;
    });
    console.log(`The dashboard runs at ${url} (Ctrl+C to stop)`);
  }
  if (options.open)
    openBrowser(url);
}

async function stop(port: number): Promise<void> {
  const state = await probe(port, identity.app);
  if (state.kind === 'free') {
    console.log(`No dashboard is running on port ${port}.`);
  }
  else if (state.kind === 'other') {
    throw new Error(`Port ${port} is used by another program, not the dashboard.`);
  }
  else {
    await stopServer(port, identity.app);
    console.log(`Stopped the dashboard on port ${port}.`);
  }
}

async function run(options: CliOptions): Promise<void> {
  switch (options.command) {
    case 'install-hook':
      if (options.apply) {
        console.log(await installHook(claudeDir(), npmHook(options.port)));
      }
      else {
        console.log(`Add this to ~/.claude/settings.json (or run \`${BIN_NAME} install-hook --apply\`):\n`);
        console.log(JSON.stringify({ hooks: { Stop: [{ hooks: [npmHook(options.port)] }] } }, null, 2));
      }
      return;
    case 'setup':
      console.log(await installHook(claudeDir(), npmHook(options.port)));
      return start({ ...options, background: true });
    case 'start':
      return start(options);
    case 'stop':
      return stop(options.port);
  }
}

let options: CliOptions | undefined;
try {
  options = parseCli(process.argv.slice(2), process.env);
}
catch (error) {
  console.error(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
  process.exitCode = 1;
}

if (options?.help) {
  console.log(USAGE);
}
else if (options) {
  try {
    await run(options);
  }
  catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
