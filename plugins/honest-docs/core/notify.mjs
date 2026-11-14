// The plugin's one hook (SessionStart): tells the user when the repo's copy of the checks
// (.claude/honest-docs/, core/install.mjs) is missing or on another version than the plugin.
//
//   no .claude/honest-docs.json        silent: the repo does not use honest-docs
//   a config, no manifest.json         run /honest-docs:init
//   the copy older than the plugin     run /honest-docs:update
//   the copy newer than the plugin     run claude plugin update
//   the same version                   silent
//
// Through `systemMessage`, which the user sees and the model does not: the user decides, and the
// skills it names are theirs to run. Not part of the copy (core/install.mjs copySources). Always
// exit 0; a config or manifest it cannot read is named in the message instead.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CONFIG_FILE, COPY_DIR, ConfigError, loadConfig } from './config.mjs';
import { compareSemver, semver } from './init.mjs';
import { pluginVersion } from './log.mjs';
import { repoRoot } from './root.mjs';
import { MANIFEST } from './version.mjs';

const message = (text) => ({ stdout: JSON.stringify({ systemMessage: `honest-docs: ${text}` }), exitCode: 0 });

/** Hook input → { stdout, exitCode }. Always exit 0. */
export function notify(input) {
  const root = repoRoot(input);
  if (!existsSync(path.join(root, CONFIG_FILE))) return { exitCode: 0 };
  try {
    loadConfig(root);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    return message(error.message);
  }
  const manifestFile = `${COPY_DIR}/${MANIFEST}`;
  if (!existsSync(path.join(root, manifestFile)))
    return message('this repo uses honest-docs but its checks are not installed in the repo; run /honest-docs:init');

  let theirs;
  try {
    ({ version: theirs } = JSON.parse(readFileSync(path.join(root, manifestFile), 'utf8')));
  } catch (error) {
    return message(`${manifestFile} cannot be read (${error.message})`);
  }
  const ours = pluginVersion();
  if (typeof theirs !== 'string' || !semver(theirs) || !semver(ours))
    return message(`${manifestFile}: version ${JSON.stringify(theirs ?? null)} cannot be compared with the plugin's ${ours}`);
  const diff = compareSemver(semver(theirs), semver(ours));
  if (diff === 0) return { exitCode: 0 };
  const at = `this repo's checks are at ${theirs}, the plugin at ${ours}`;
  return message(diff < 0 ? `${at}; run /honest-docs:update` : `${at}; run claude plugin update`);
}
