import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface HookCommand {
  async?: boolean;
  command: string;
  type: 'command';
}

interface HookGroup {
  hooks: HookCommand[];
  matcher?: string;
}

interface ClaudeSettings {
  [key: string]: unknown;
  hooks?: Record<string, HookGroup[]>;
}

/** The command the npm package installs, also the name its fallback hook runs. */
export const BIN_NAME = 'claude-analytics-dashboard';

const POST_HOOK = 'curl -sf -m 120 -X POST -H "Content-Type: application/json" -d "{}"';

/**
 * Asks the Docker dashboard for a collector run after every Claude Code response, in the
 * background. The host runs no code from this folder: checking out a branch here cannot
 * run it as the user. With the container down, the run is skipped; the next one catches up.
 */
export const DOCKER_HOOK: HookCommand = {
  async: true,
  command: `${POST_HOOK} http://analytics.claudecode.localhost/api/hook`,
  type: 'command',
};

/**
 * Asks the npm package's server for a collector run and, when it does not answer, starts
 * it in the background. The fallback runs the globally installed release, never a working
 * copy. Claude Code runs hooks through a POSIX shell (Git Bash on Windows), so `||` works.
 */
export function npmHook(port: number): HookCommand {
  return {
    async: true,
    command: `${POST_HOOK} http://localhost:${port}/api/hook || ${BIN_NAME} start --background --no-open --port ${port}`,
    type: 'command',
  };
}

/** Today's hooks call `/api/hook` on a loopback name; the old one ran the local collector. */
const OUR_HOOK = /https?:\/\/(?:[\w-]+\.)*localhost(?::\d+)?\/api\/hook|collector\/cli\.ts/;

/** A hook installed by this tool; another tool's webhook to some `/api/hook` is left alone. */
const isOurs = (hook: HookCommand) => typeof hook.command === 'string' && OUR_HOOK.test(hook.command);

/** Adds the Stop hook, replacing any earlier hook of ours. Returns null when unchanged. */
export function withCollectorHook(settings: ClaudeSettings, hook: HookCommand): ClaudeSettings | null {
  const stop = settings.hooks?.Stop ?? [];
  const ours = stop.flatMap(group => (group.hooks ?? []).filter(isOurs));
  if (ours.length === 1 && ours[0]!.command === hook.command)
    return null;
  const kept = stop.flatMap((group) => {
    if (!group.hooks?.some(isOurs))
      return [group];
    const hooks = group.hooks.filter(other => !isOurs(other));
    return hooks.length ? [{ ...group, hooks }] : [];
  });
  return { ...settings, hooks: { ...settings.hooks, Stop: [...kept, { hooks: [hook] }] } };
}

/**
 * Adds the hook to `<claudeDir>/settings.json`, after a backup; creates the file when
 * Claude Code has not written one yet. Returns a message for the user.
 */
export async function installHook(claudeDir: string, hook: HookCommand): Promise<string> {
  const path = join(claudeDir, 'settings.json');
  let text: string | undefined;
  try {
    text = await readFile(path, 'utf8');
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      return `Could not read ${path}; add the hook by hand (run without --apply to print it).`;
  }
  const updated = withCollectorHook(text === undefined ? {} : JSON.parse(text) as ClaudeSettings, hook);
  if (!updated)
    return `The collector hook is already in ${path}.`;
  let backup = '';
  if (text !== undefined) {
    backup = `${path}.bak-${Date.now()}`;
    await copyFile(path, backup);
  }
  await mkdir(claudeDir, { recursive: true });
  await writeFile(path, `${JSON.stringify(updated, null, 2)}\n`);
  return backup ? `Installed the Stop hook in ${path} (backup: ${backup}).` : `Installed the Stop hook in ${path}.`;
}
