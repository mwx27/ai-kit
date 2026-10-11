#!/usr/bin/env node
// Writes the plugin's files into the project (core/init.mjs). Run as `honest-docs-init` (bin/).
// Exits 1 and writes nothing when a CLAUDE.md fragment is there twice, or gone after the first run;
// exits 2 and writes nothing on a broken .claude/honest-docs.json. Warnings go to stderr and leave
// the exit code 0.

import { CONFIG_FILE, ConfigError, loadConfig, projectRoot } from '../core/config.mjs';
import { runInit } from '../core/init.mjs';

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
