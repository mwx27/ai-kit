// Runs one question through `claude -p` inside the target repo, read-only, and returns the answer.
//
// The question goes in on stdin, never as an argument: on Windows an npm install of claude is a
// .cmd file that only cmd.exe can run, and cmd.exe would read `"`, `%` or `&` in the question.
// Every argument is fixed or checked, so none of them can carry those.
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AskRepoError, usageError } from './errors.mjs';

const PROMPT_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'prompts', 'system.md');

// The session gets the file-reading tools only, so it cannot change anything. dontAsk refuses any
// other tool without a prompt, even where the user's own settings default to auto mode;
// --strict-mcp-config leaves out the user's MCP servers, which could act outside the repo.
//
// --git adds Bash for these commands alone. A permission rule matches a command by its prefix, so
// a flag that writes is not blocked (`git diff --output=<file>`): only the system prompt keeps the
// session from it. `git grep` stays out, since its -O runs a program.
const GIT = ['log', 'show', 'diff', 'blame', 'ls-files', 'status'].map((cmd) => `Bash(git ${cmd}:*)`);

export const MODEL = /^[\w.\-[\]]+$/;

/** The arguments for one call: a new session with `sessionId`, or a follow-up to `resume`. */
export function claudeArgs({ sessionId, resume, anonymous = false, git = false, model }) {
  const args = [
    '-p',
    '--output-format', 'json',
    '--permission-mode', 'dontAsk',
    '--strict-mcp-config',
    '--tools', 'Read', 'Grep', 'Glob', ...(git ? ['Bash', '--allowedTools', ...GIT] : []),
    '--append-system-prompt-file', PROMPT_FILE,
  ];
  if (resume) args.push('--resume', resume);
  else if (sessionId) args.push('--session-id', sessionId);
  if (anonymous) args.push('--no-session-persistence');
  if (model !== undefined) {
    if (!MODEL.test(model)) throw usageError(`not a model name: ${model}`);
    args.push('--model', model);
  }
  return args;
}

const isFile = (file) => existsSync(file) && statSync(file).isFile();

/** The claude executable: $ASK_REPO_CLAUDE, else the first `claude` on PATH (with PATHEXT on Windows). */
export function findClaude(env = process.env) {
  if (env.ASK_REPO_CLAUDE) return env.ASK_REPO_CLAUDE;
  const windows = process.platform === 'win32';
  const exts = windows ? (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  for (const dir of (env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const file = path.join(dir, `claude${ext}`);
      if (isFile(file)) return file;
    }
  }
  throw new AskRepoError('claude not found on PATH');
}

// Inside cmd.exe's /s /c "…" every argument sits in double quotes, where & | < > ^ are literal;
// only `"` and `%` would still be read, and no argument may hold them.
function cmdLine(file, args) {
  for (const arg of [file, ...args]) {
    if (/["%\r\n]/.test(arg)) throw new AskRepoError(`cannot pass an argument holding " or % to ${file}: ${arg}`);
  }
  return `"${[file, ...args].map((arg) => `"${arg}"`).join(' ')}"`;
}

/** How to start `file`: a .cmd or .bat through cmd.exe, a .js or .mjs through node, anything else directly. */
function command(file, args) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.cmd' || ext === '.bat') {
    return { cmd: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', cmdLine(file, args)], verbatim: true };
  }
  if (ext === '.js' || ext === '.mjs') return { cmd: process.execPath, args: [file, ...args], verbatim: false };
  return { cmd: file, args, verbatim: false };
}

/** The environment for the nested session: the caller's, minus what marks it as inside Claude Code. */
function childEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => key.toUpperCase() !== 'CLAUDECODE'));
}

/** Asks `question` in `cwd` and returns the answer text; any failure is an AskRepoError. */
export function ask({ cwd, question, env = process.env, ...options }) {
  const { cmd, args, verbatim } = command(findClaude(env), claudeArgs(options));
  const run = spawnSync(cmd, args, {
    cwd,
    input: question,
    encoding: 'utf8',
    env: childEnv(env),
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
    windowsVerbatimArguments: verbatim,
  });
  if (run.error) throw new AskRepoError(`could not run claude: ${run.error.message}`);

  let result;
  try {
    result = JSON.parse(run.stdout);
  } catch {
    // Not JSON: a crash or a CLI error, which claude prints on stderr.
  }
  if (run.status !== 0 || result === undefined || result.is_error) {
    const detail = [result?.result, run.stderr?.trim(), result === undefined ? run.stdout?.trim().slice(0, 300) : '']
      .filter(Boolean)
      .join('\n');
    throw new AskRepoError(`claude failed${run.status ? ` with exit code ${run.status}` : ''}${detail ? `:\n${detail}` : ''}`, run.status || 1);
  }
  if (typeof result.result !== 'string' || !result.result.trim()) throw new AskRepoError('claude returned an empty answer');
  return result.result;
}
