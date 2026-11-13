// What the working tree holds that HEAD does not: the snapshot a Bash call's PreToolUse and
// PostToolUse compare (core/attribution.mjs), and the hashes the guard gate keys its state by.
// Shared so the two cannot disagree about what "changed" means.
//
// The plugin's own folders (state, logs and the copy, config.ownDirs) are never a change, whatever
// the project's .gitignore says.
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
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
 * path → hash of what is on disk for `files` (repo-relative); null for a path with no file there,
 * a folder or a dangling symlink. Null when git cannot answer, as statusEntries.
 */
export function hashFiles(root, files) {
  const onDisk = files.filter((file) => {
    try {
      return statSync(path.join(root, file)).isFile();
    } catch {
      return false;
    }
  });
  try {
    const hashes = onDisk.length === 0 ? [] : git(root, ['hash-object', '--stdin-paths'], `${onDisk.join('\n')}\n`).trim().split('\n');
    if (hashes.length !== onDisk.length) return null;
    const hashOf = new Map(onDisk.map((file, index) => [file, hashes[index]]));
    return new Map(files.map((file) => [file, hashOf.get(file) ?? null]));
  } catch {
    return null;
  }
}
