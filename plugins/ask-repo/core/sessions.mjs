// Session files live in the project the question is asked from, in artifacts/ask-repo/<alias>/
// ($ASK_REPO_SESSIONS moves the artifacts/ask-repo/ part): <name>.id holds the Claude session id
// for `-c`, <name>.md the questions and answers. Both are touched on every use, so a session's age
// is the time it was last used, for picking the latest and for pruning alike.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AskRepoError, usageError } from './errors.mjs';

export const SESSION_NAME = /^[\w-][\w.-]*$/;
export const RETENTION_DAYS = 7;

/** The git top level `cwd` is in, or `cwd` itself outside git. */
export function projectRoot(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return cwd;
  }
}

/**
 * The alias's session folder, created on first use. The base folder carries a `.gitignore` of `*`,
 * so the sessions never show up in the project's git status, whatever its own .gitignore says.
 */
export function sessionsDir(cwd, alias, env = process.env) {
  const base = env.ASK_REPO_SESSIONS || path.join(projectRoot(cwd), 'artifacts', 'ask-repo');
  const dir = path.join(base, alias);
  mkdirSync(dir, { recursive: true });
  const ignore = path.join(base, '.gitignore');
  if (!existsSync(ignore)) writeFileSync(ignore, '*\n');
  return dir;
}

export function checkName(name) {
  if (!SESSION_NAME.test(name)) throw usageError(`session name may hold only letters, digits, _, . and -, and not start with .: ${name}`);
}

const files = (dir, name) => ({ id: path.join(dir, `${name}.id`), log: path.join(dir, `${name}.md`) });
const mtime = (file) => (existsSync(file) ? statSync(file).mtimeMs : 0);

/** Every session name in `dir` with the time it was last used, newest first. */
function sessions(dir) {
  const names = new Set(
    readdirSync(dir)
      .filter((file) => /\.(id|md)$/.test(file))
      .map((file) => file.replace(/\.(id|md)$/, ''))
  );
  return [...names]
    .map((name) => {
      const { id, log } = files(dir, name);
      return { name, used: Math.max(mtime(id), mtime(log)), hasId: existsSync(id) };
    })
    .sort((a, b) => b.used - a.used);
}

/** Deletes each session, both of its files, last used more than RETENTION_DAYS ago. */
export function prune(dir, now = Date.now()) {
  const cutoff = now - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const { name, used } of sessions(dir)) {
    if (used >= cutoff) continue;
    const { id, log } = files(dir, name);
    rmSync(id, { force: true });
    rmSync(log, { force: true });
  }
}

/** The name and Claude session id to continue: `name`'s, or the last used session's. */
export function sessionToContinue(dir, alias, name) {
  if (name === undefined) {
    const latest = sessions(dir).find((session) => session.hasId);
    if (!latest) throw new AskRepoError(`no session to continue for ${alias}; ask a new question first`);
    name = latest.name;
  } else if (!existsSync(files(dir, name).id)) {
    throw new AskRepoError(`no session ${name} for ${alias}`);
  }
  return { name, sessionId: readFileSync(files(dir, name).id, 'utf8').trim() };
}

/** A name for a new session: `name` if free, else a timestamp, suffixed when that is taken. */
export function newSessionName(dir, alias, name, now = new Date()) {
  if (name !== undefined) {
    if (existsSync(files(dir, name).id)) {
      throw new AskRepoError(`session ${name} already exists for ${alias}; continue it with: ask-repo -c ${alias} ${name} "question"`);
    }
    return name;
  }
  const stamp = timestamp(now).replace(/[-: ]/g, '').replace(/^(\d{8})/, '$1-');
  let candidate = stamp;
  for (let n = 2; existsSync(files(dir, candidate).id) || existsSync(files(dir, candidate).log); n++) candidate = `${stamp}-${n}`;
  return candidate;
}

/** Records one question and answer; `sessionId` only for a new session. */
export function record(dir, { alias, name, sessionId, question, answer, now = new Date() }) {
  const { id, log } = files(dir, name);
  const entry = `**Q** *(${timestamp(now)})*: ${question}\n\n**A**:\n\n${answer}\n`;
  if (sessionId !== undefined) {
    writeFileSync(id, `${sessionId}\n`);
    writeFileSync(log, `# Session: ${alias} / ${name}\n\n${entry}`);
  } else {
    appendFileSync(log, `\n---\n\n${entry}`);
    utimesSync(id, now, now);
  }
}

/** Local time as YYYY-MM-DD HH:MM:SS. */
export function timestamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
