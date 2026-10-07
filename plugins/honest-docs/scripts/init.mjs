#!/usr/bin/env node
// Writes the plugin's files into the project (core/init.mjs). Run as `honest-docs-init` (bin/).
// Exits 1 and writes nothing when a CLAUDE.md fragment is not found exactly once.

import { CONFIG_FILE, loadConfig, projectRoot } from '../core/config.mjs';
import { runInit } from '../core/init.mjs';

const ROOT = projectRoot();
const { writes, notes, errors } = runInit(ROOT, loadConfig(ROOT));

if (errors.length > 0) {
  for (const e of errors) console.error(`honest-docs-init: ${e}`);
  console.error('honest-docs-init: nothing written');
  process.exit(1);
}
for (const { file } of writes)
  console.log(`honest-docs-init: ${file === CONFIG_FILE ? 'created' : 'wrote'} ${file}`);
if (writes.length === 0) console.log('honest-docs-init: no changes');
for (const n of notes) console.log(`honest-docs-init: ${n}`);
