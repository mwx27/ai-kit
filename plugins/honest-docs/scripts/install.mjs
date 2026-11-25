#!/usr/bin/env node
// /honest-docs:init and /honest-docs:update (core/install.mjs):
//
//   node install.mjs --mode init|update [--force] [--docs-dir <folder>]
//   node install.mjs --check-empty
//
// --docs-dir, init only, sets docsDir in the config init creates (core/install.mjs).
//
// --check-empty, alone, writes nothing: it prints one JSON line, {"empty":bool,"blocking":[...]}
// (core/empty-project.mjs), and exits 0. /honest-docs:init runs it first. It judges the repository
// holding the current folder, or outside a repository the current folder itself, with the same
// output; init then refuses for want of git.
//
// Prints what it wrote, then `honest-docs-init: installed X` or `honest-docs-update: updated X → Y`
// with the CHANGELOG sections in between, then `next:` lines for the agent and `warning:` lines
// for the user. It ends with the new copy's docs-check count, which never changes the exit code.
//
// Exits 1 and writes nothing on a refusal or a fragment error; a copied file changed by hand is
// shown as a diff, and --force overwrites it. Exits 2 and writes nothing on a broken
// .claude/honest-docs.json or a bad command line.
import path from 'node:path';
import { CONFIG_FILE, COPY_DIR, ConfigError, loadConfig, projectRoot } from '../core/config.mjs';
import { checkEmpty } from '../core/empty-project.mjs';
import { PRETTIER_IGNORE, changelogBetween, runInstall } from '../core/install.mjs';
import { runDocsCheck } from '../core/problems.mjs';
import { SETTINGS_FILE } from '../core/settings-merge.mjs';

const USAGE = 'usage: install.mjs --mode init|update [--force] [--docs-dir <folder>] | --check-empty';

const args = process.argv.slice(2);
if (args.includes('--check-empty')) {
  if (args.length !== 1) {
    console.error(USAGE);
    process.exit(2);
  }
  console.log(JSON.stringify(checkEmpty(projectRoot())));
  process.exit(0);
}

let mode = null;
let force = false;
let docsDir;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--force') force = true;
  else if (args[i] === '--mode') mode = args[++i] ?? '';
  else if (args[i] === '--docs-dir') docsDir = args[++i] ?? '';
  else mode = '';
}
if (!['init', 'update'].includes(mode)) {
  console.error(USAGE);
  process.exit(2);
}
const tag = `honest-docs-${mode}`;

const ROOT = projectRoot();
let config;
try {
  config = loadConfig(ROOT);
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  console.error(`${tag}: ${error.message}`);
  process.exit(2);
}

const plan = runInstall(ROOT, config, { mode, force, docsDir });
if (plan.refusal || plan.errors.length > 0) {
  for (const e of [plan.refusal, ...plan.errors].filter(Boolean)) console.error(`${tag}: ${e}`);
  for (const { diff } of plan.conflicts) process.stderr.write(diff);
  console.error(`${tag}: nothing written`);
  process.exit(1);
}

// The project's own files, for the agent to format; the copy is left as written.
const written = [
  ...plan.writes.map(({ file }) => ({ file, verb: file === CONFIG_FILE ? 'created' : 'wrote' })),
  ...(plan.settings !== null ? [{ file: SETTINGS_FILE, verb: 'wrote' }] : []),
  ...(plan.prettier !== null ? [{ file: PRETTIER_IGNORE, verb: 'wrote' }] : []),
];
for (const { file, verb } of written) console.log(`${tag}: ${verb} ${file}`);
if (plan.copy.changed > 0) console.log(`${tag}: wrote ${COPY_DIR}/ (${plan.copy.changed} file${plan.copy.changed === 1 ? '' : 's'} changed)`);
if (written.length === 0 && plan.copy.changed === 0) console.log(`${tag}: no changes`);
for (const n of plan.notes) console.log(`${tag}: ${n}`);

if (mode === 'init') console.log(`${tag}: installed ${plan.version}`);
else {
  console.log(`${tag}: updated ${plan.from} → ${plan.version}`);
  for (const section of changelogBetween(plan.from, plan.version)) console.log(`\n${section}\n`);
}

const nexts = [...plan.nexts];
if (written.length > 0) nexts.unshift(`format the files written above the way the project formats them: ${written.map((w) => w.file).join(', ')}`);
const docs = runDocsCheck(ROOT, 60_000, path.join(ROOT, COPY_DIR));
if (docs.error) plan.warnings.push(`the docs check of the new copy could not run (${docs.error})`);
else if (docs.problems.length > 0)
  nexts.push(
    `${docs.problems.length} docs problem${docs.problems.length === 1 ? '' : 's'} in this repo (not blocking); ` +
      "propose fixes and wait for the user's consent"
  );
for (const n of nexts) console.log(`next: ${n}`);
for (const w of plan.warnings) console.error(`warning: ${w}`);
