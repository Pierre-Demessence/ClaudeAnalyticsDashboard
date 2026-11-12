import process from 'node:process';

import { collect } from './collect.ts';
import { DOCKER_HOOK, installHook } from './hook.ts';
import { claudeDir, dataDir } from './store.ts';

const args = new Set(process.argv.slice(2));

if (args.has('install-hook')) {
  if (args.has('--apply')) {
    console.log(await installHook(claudeDir(), DOCKER_HOOK));
    console.log('The hook needs the Docker dashboard running (`npm run docker:up`).');
  }
  else {
    console.log('Add this to ~/.claude/settings.json (or run `npm run hook:install -- --apply`):\n');
    console.log(JSON.stringify({ hooks: { Stop: [{ hooks: [DOCKER_HOOK] }] } }, null, 2));
  }
}
else {
  try {
    const result = await collect({ claudeDir: claudeDir(), dataDir: dataDir(), force: args.has('--force') });
    if (result.skipped)
      console.log('Another collector run is in progress; skipped.');
    else
      console.log(JSON.stringify(result.status, null, 2));
  }
  catch (error) {
    console.error('Collector failed:', error instanceof Error ? error.message : error);
  }
}
