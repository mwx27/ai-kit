// The project's docs: the .md files under the scanned folders and root files that git tracks or would
// track (untracked, not ignored). An ignored doc is one person's notes, not the project's docs, so no
// check reads it and none blocks a turn over it. docs-check, docs-grep and readCovers all list docs
// here, so they cannot disagree about what a doc is.
//
// Without git (not a repo, no binary, a failing call) the folders are walked on disk instead, and the
// caller says that ignored files could not be told apart.
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { skippedRoots } from './config.mjs';
import { posixPath } from './posix-path.mjs';

/**
 * Every path git tracks or would track, repo-relative, deleted ones included; null when git cannot
 * answer. One call serves the doc set and the `covers:` match.
 */
export function listRepoFiles(root) {
  try {
    return execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\0')
      .filter(Boolean);
  } catch {
    return null;
  }
}

const trimSlash = (p) => p.replace(/\/+$/, '');

/**
 * The docs in `dirs` and the root `files` (default: the config's `scan`), repo-relative POSIX:
 * `{ docs, dangling, git }`. `dangling` are symlinks to nothing found there, for docs-check's `links`;
 * `git` is false when the disk walk stood in. `listed` is listRepoFiles(root), for a caller that has it.
 */
export function docSet(root, config, { dirs = config.scan.dirs, files = config.scan.files } = {}, listed = listRepoFiles(root)) {
  const skipped = skippedRoots(config);
  const docs = new Set();
  const dangling = new Set();

  /** One path on disk: a doc, a symlink to nothing, or a folder to walk (git lists neither a symlinked folder's files nor a submodule's). */
  const visit = (rel) => {
    const full = path.join(root, rel);
    if (!existsSync(full)) {
      // A symlink to nothing would stop the run at statSync; a path deleted from disk is just gone.
      try {
        if (lstatSync(full).isSymbolicLink()) dangling.add(rel);
      } catch {}
      return;
    }
    if (!statSync(full).isDirectory()) {
      if (rel.endsWith('.md')) docs.add(rel);
      return;
    }
    for (const entry of readdirSync(full)) if (!skipped.includes(entry)) visit(`${rel}/${entry}`);
  };

  const scanned = dirs.map(trimSlash);
  if (listed) {
    const inScope = (file) => files.includes(file) || scanned.some((dir) => file === dir || file.startsWith(`${dir}/`));
    for (const file of listed.filter(inScope).sort()) visit(file);
  } else {
    for (const dir of scanned) if (existsSync(path.join(root, dir))) visit(dir);
    for (const file of files) visit(file);
  }
  return { docs: [...docs].map(posixPath), dangling: [...dangling].map(posixPath), git: listed !== null };
}
