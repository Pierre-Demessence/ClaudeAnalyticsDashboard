// @vitest-environment node
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DOCKER_HOOK, installHook, npmHook, withCollectorHook } from './hook.ts';

describe('withCollectorHook', () => {
  it('adds an async Stop hook asking the dashboard for a run, keeping other settings', () => {
    const updated = withCollectorHook({ hooks: { Stop: [{ hooks: [{ command: 'other', type: 'command' }] }] }, model: 'opus' }, DOCKER_HOOK)!;
    expect(updated.model).toBe('opus');
    expect(updated.hooks!.Stop).toHaveLength(2);
    expect(updated.hooks!.Stop![1]!.hooks[0]).toBe(DOCKER_HOOK);
    expect(DOCKER_HOOK.async).toBe(true);
    expect(DOCKER_HOOK.command).toMatch(/^curl .* http:\/\/analytics\.claudecode\.localhost\/api\/hook$/);
    expect(DOCKER_HOOK.command).not.toContain('node');
  });

  it('replaces a hook that runs the local collector, keeping the other hooks of its group', () => {
    const local = { async: true, command: 'node "S:/Dev/ClaudeCodeAnalytics/src/collector/cli.ts" --quiet', type: 'command' as const };
    const other = { command: 'other', type: 'command' as const };
    const updated = withCollectorHook({ hooks: { Stop: [{ hooks: [local] }, { hooks: [local, other] }] } }, DOCKER_HOOK)!;
    expect(updated.hooks!.Stop).toEqual([{ hooks: [other] }, { hooks: [DOCKER_HOOK] }]);
  });

  it('removes a local collector hook left next to the installed one', () => {
    const local = { command: 'node "/x/src/collector/cli.ts"', type: 'command' as const };
    const updated = withCollectorHook({ hooks: { Stop: [{ hooks: [DOCKER_HOOK, local] }] } }, DOCKER_HOOK)!;
    expect(updated.hooks!.Stop).toEqual([{ hooks: [DOCKER_HOOK] }]);
  });

  it('tolerates hook entries of other shapes', () => {
    const settings = { hooks: { Stop: [{ hooks: [{ prompt: 'x', type: 'prompt' }] }, {}] } } as unknown as Parameters<typeof withCollectorHook>[0];
    expect(withCollectorHook(settings, DOCKER_HOOK)?.hooks?.Stop).toHaveLength(3);
  });

  it('is idempotent', () => {
    const once = withCollectorHook({}, DOCKER_HOOK)!;
    expect(withCollectorHook(once, DOCKER_HOOK)).toBeNull();
    const npm = withCollectorHook({}, npmHook(4747))!;
    expect(withCollectorHook(npm, npmHook(4747))).toBeNull();
  });

  it('keeps the repository\'s hook to the Docker dashboard free of any fallback that runs code', () => {
    expect(DOCKER_HOOK.command).not.toContain('||');
    expect(DOCKER_HOOK.command).not.toContain('claude-analytics-dashboard');
  });

  it('asks the npm server for a run and starts the installed release in the background when it does not answer', () => {
    const hook = npmHook(4747);
    expect(hook.async).toBe(true);
    expect(hook.command).toBe('curl -sf -m 120 -X POST -H "Content-Type: application/json" -d "{}" http://localhost:4747/api/hook || claude-analytics-dashboard start --background --no-open --port 4747');
    expect(npmHook(5000).command).toContain('http://localhost:5000/api/hook || claude-analytics-dashboard start --background --no-open --port 5000');
    expect(hook.command).not.toMatch(/\bnode\b|cli\.ts/);
  });

  it('switches between the Docker and npm hooks, and between ports, leaving one hook of ours', () => {
    const other = { command: 'other', type: 'command' as const };
    expect(withCollectorHook({ hooks: { Stop: [{ hooks: [other, DOCKER_HOOK] }] } }, DOCKER_HOOK)).toBeNull();
    const npm = withCollectorHook({ hooks: { Stop: [{ hooks: [other, DOCKER_HOOK] }] } }, npmHook(4747))!;
    expect(npm.hooks!.Stop).toEqual([{ hooks: [other] }, { hooks: [npmHook(4747)] }]);
    expect(withCollectorHook(npm, npmHook(4800))!.hooks!.Stop).toEqual([{ hooks: [other] }, { hooks: [npmHook(4800)] }]);
    expect(withCollectorHook(npm, DOCKER_HOOK)!.hooks!.Stop).toEqual([{ hooks: [other] }, { hooks: [DOCKER_HOOK] }]);
  });

  it('leaves another tool\'s webhook to an /api/hook path alone', () => {
    const webhook = { command: 'curl -X POST https://other.example/api/hook', type: 'command' as const };
    const updated = withCollectorHook({ hooks: { Stop: [{ hooks: [webhook, DOCKER_HOOK] }] } }, npmHook(4747))!;
    expect(updated.hooks!.Stop).toEqual([{ hooks: [webhook] }, { hooks: [npmHook(4747)] }]);
  });

  it('collapses duplicate hooks of ours into one', () => {
    const twice = { hooks: { Stop: [{ hooks: [DOCKER_HOOK] }, { hooks: [DOCKER_HOOK] }] } };
    expect(withCollectorHook(twice, DOCKER_HOOK)!.hooks!.Stop).toEqual([{ hooks: [DOCKER_HOOK] }]);
  });
});

describe('installHook', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cca-hook-'));
  });

  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  it('creates settings.json when Claude Code has not written one', async () => {
    expect(await installHook(dir, npmHook(4747))).toContain('Installed the Stop hook');
    expect(JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'))).toEqual({ hooks: { Stop: [{ hooks: [npmHook(4747)] }] } });
    expect(await readdir(dir)).toEqual(['settings.json']);
  });

  it('creates the Claude directory when it is missing', async () => {
    const missing = join(dir, 'claude');
    expect(await installHook(missing, npmHook(4747))).toContain('Installed the Stop hook');
    expect(await readdir(missing)).toEqual(['settings.json']);
  });

  it('backs up an existing settings.json before changing it, and leaves it alone when the hook is there', async () => {
    await writeFile(join(dir, 'settings.json'), JSON.stringify({ model: 'opus' }));
    expect(await installHook(dir, npmHook(4747))).toMatch(/backup: .*settings\.json\.bak-\d+/);
    expect(JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'))).toMatchObject({ model: 'opus' });
    expect(await readdir(dir)).toHaveLength(2);
    expect(await installHook(dir, npmHook(4747))).toContain('already');
    expect(await readdir(dir)).toHaveLength(2);
  });
});
