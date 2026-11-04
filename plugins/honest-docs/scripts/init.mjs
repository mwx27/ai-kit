#!/usr/bin/env node
// Writes the plugin's files into the project (core/init.mjs). Run as `honest-docs-init` (bin/).
// Exits 1 and writes nothing when a CLAUDE.md fragment is there twice, or gone after the first run;
// exits 2 and writes nothing on a broken .claude/honest-docs.json. Warnings go to stderr and leave
// the exit code 0. A successful run ends with what honest-docs-check reports, which does not change
// the exit code either.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { CONFIG_FILE, ConfigError, loadConfig, projectRoot } from '../core/config.mjs';
import { runInit } from '../core/init.mjs';
import { PLUGIN_ROOT } from '../core/log.mjs';

const ROOT = projectRoot();
let config;
try {
  config = loadConfig(ROOT);
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  console.error(`honest-docs-init: ${error.message}`);
  process.exit(2);
}
const { writes, notes, warnings, errors } = runInit(ROOT, config);

if (errors.length > 0) {
  for (const e of errors) console.error(`honest-docs-init: ${e}`);
  console.error('honest-docs-init: nothing written');
  process.exit(1);
}
for (const { file } of writes)
  console.log(`honest-docs-init: ${file === CONFIG_FILE ? 'created' : 'wrote'} ${file}`);
if (writes.length === 0) console.log('honest-docs-init: no changes');
for (const n of notes) console.log(`honest-docs-init: ${n}`);
for (const w of warnings) console.error(`honest-docs-init: warning: ${w}`);

// The verdict the Stop gate reaches on the next turn that changes a file, said now, rather than as
// a blocked stop the user did not expect.
const check = spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'scripts', 'docs-check.mjs')], {
  cwd: ROOT,
  encoding: 'utf8',
});
const problems = check.status === 0 ? 0 : Number(check.stderr?.match(/^docs-check: (\d+) problem\(s\)/m)?.[1] ?? NaN);
if (problems === 0) console.log('honest-docs-init: honest-docs-check reports no problems, so the docs give the Stop gate nothing to block on.');
else if (problems > 0)
  console.log(
    `honest-docs-init: honest-docs-check reports ${problems} problem${problems === 1 ? '' : 's'}: the Stop gate blocks every ` +
      'turn that changes a file until they are fixed. Run honest-docs-check to see them.'
  );
else console.error(`honest-docs-init: warning: honest-docs-check could not run (exit ${check.status ?? check.signal}).`);
