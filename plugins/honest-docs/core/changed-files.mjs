// What the working tree holds that HEAD does not — the file list the guard gate runs on, the
// baseline core/baseline.mjs records at session start, and the snapshot core/reminder.mjs compares
// after every tool call. Shared so the three cannot disagree about what "changed" means.
//
// Git is the source rather than a record of the agent's own writes, because the agent also edits
// through Bash (`printf >>`, `sed -i`, `mv`, `patch`), and a turn that did so left no record at all.
//
// The plugin's own folders (state and logs, config.ownDirs) are never a change, whatever the
// project's .gitignore says.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const MAX_BUFFER = 8 * 1024 * 1024;

const git = (root, args, input) =>
  execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    input,
    maxBuffer: MAX_BUFFER,
    stdio: ['pipe', 'pipe', 'ignore'],
  });

/**
 * Every path git status reports outside `excluded` (folder prefixes ending in `/`), each with the
 * hash of what is on disk — the working tree, not the index, because that is what the guard would
 * read. A path with nothing on disk (deleted, or the source of a rename) carries a null hash.
 *
 * Returns null when git cannot answer at all: no repo, no binary, a broken object store. The
 * caller must pass on null rather than block, since it then knows nothing about the tree.
 */
export function statusEntries(root, excluded = []) {
  try {
    const records = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).split('\0');
    const paths = new Set();

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      if (record.length < 4) continue;

      const status = record.slice(0, 2);
      if (status === '!!') continue;
      paths.add(record.slice(3));
      // R and C spend a second -z record on the source path.
      if (status[0] === 'R' || status[0] === 'C') paths.add(records[++i]);
    }

    // hash-object --stdin-paths is newline-delimited.
    const listed = [...paths].filter(
      (file) => file && !file.includes('\n') && !excluded.some((prefix) => file.startsWith(prefix))
    );
    const onDisk = listed.filter((file) => existsSync(path.join(root, file)));

    // One git process for every path, not one per path.
    const hashes =
      onDisk.length === 0
        ? []
        : git(root, ['hash-object', '--stdin-paths'], `${onDisk.join('\n')}\n`)
            .trim()
            .split('\n');
    if (hashes.length !== onDisk.length) return null;

    const hashOf = new Map(onDisk.map((file, index) => [file, hashes[index]]));
    return listed
      .map((file) => ({ path: file, hash: hashOf.get(file) ?? null }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  } catch {
    return null;
  }
}

/** statusEntries() as a map, path → hash (null = nothing on disk); a path absent from it is as in HEAD. */
export function treeSnapshot(root, excluded) {
  const entries = statusEntries(root, excluded);
  return entries && Object.fromEntries(entries.map((entry) => [entry.path, entry.hash]));
}

/**
 * Modified (staged or not), added, untracked and rename destinations — the entries of
 * statusEntries() that have something on disk for the guard to check.
 */
export function changedFiles(root, excluded) {
  return statusEntries(root, excluded)?.filter((entry) => entry.hash !== null) ?? null;
}
