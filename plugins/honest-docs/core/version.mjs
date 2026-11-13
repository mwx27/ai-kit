// The version of the code that is running. It runs either from the plugin, whose root holds
// .claude-plugin/plugin.json, or from the copy /honest-docs:init puts in a project, whose root
// (.claude/honest-docs/) holds manifest.json and no plugin.json. The manifest wins where both exist.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const MANIFEST = 'manifest.json';
const PLUGIN_JSON = '.claude-plugin/plugin.json';

/** True when `codeRoot` is a copy in a project rather than the plugin. */
export const isCopy = (codeRoot) => existsSync(path.join(codeRoot, MANIFEST));

/** The `version` in `codeRoot`'s manifest.json, else in its plugin.json. Throws naming the files. */
export function installedVersion(codeRoot) {
  for (const file of [MANIFEST, PLUGIN_JSON]) {
    const full = path.join(codeRoot, file);
    if (!existsSync(full)) continue;
    let version;
    try {
      ({ version } = JSON.parse(readFileSync(full, 'utf8')));
    } catch (error) {
      throw new Error(`${full}: not valid JSON (${error.message})`);
    }
    if (typeof version !== 'string' || version === '') throw new Error(`${full}: no "version" string`);
    return version;
  }
  throw new Error(`no version: ${codeRoot} has neither ${MANIFEST} nor ${PLUGIN_JSON}`);
}
