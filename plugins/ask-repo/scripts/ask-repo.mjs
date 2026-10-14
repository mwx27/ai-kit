#!/usr/bin/env node
// Asks a question about another local repository, answered by a read-only `claude -p` session run
// inside it. Called as `ask-repo` (bin/). The answer goes to stdout; how to continue the session
// goes to stderr, so stdout is the answer alone.
//
// Exit 0 on success, 64 on a usage error, claude's own exit code when it fails, 1 otherwise.
import { randomUUID } from 'node:crypto';
import { ask } from '../core/claude.mjs';
import { AskRepoError, usageError } from '../core/errors.mjs';
import { addAlias, readRegistry, registryPath, removeAlias, resolveAlias } from '../core/registry.mjs';
import { checkName, newSessionName, prune, record, sessionToContinue, sessionsDir } from '../core/sessions.mjs';

const USAGE = `usage:
  ask-repo [-n <name> | -c | -a] [--git] [--model <model>] <alias> "question"
  ask-repo -c <alias> <name> "question"
  ask-repo --list | --add <alias> <path> | --remove <alias>

  -n <name>   start a session with this name (default: a timestamp)
  -c          continue a session: the named one, or the last used
  -a          ask once, keeping no session
  --git       also let it run git log, show, diff, blame, ls-files and status
              (without --git it can only read files)
  --model     the model to answer with (default: claude's own)

Sessions are kept in artifacts/ask-repo/<alias>/ of the git project you ask from, and deleted
after 7 days without use. Aliases live in ~/.config/ask-repo/registry.json.`;

function list(file) {
  const entries = Object.entries(readRegistry(file));
  if (entries.length === 0) {
    console.log('No aliases yet. Add one with: ask-repo --add <alias> <path>');
    return;
  }
  const width = Math.max(...entries.map(([alias]) => alias.length));
  for (const [alias, target] of entries) console.log(`${alias.padEnd(width)}  ${target}`);
}

function parseQuestion(argv) {
  const options = { mode: 'new' };
  const setMode = (mode) => {
    if (options.mode !== 'new' || options.name !== undefined) throw usageError('use only one of -n, -c and -a');
    options.mode = mode;
  };
  let i = 0;
  for (; i < argv.length && argv[i].startsWith('-'); i++) {
    const arg = argv[i];
    if (arg === '-c') setMode('continue');
    else if (arg === '-a') setMode('anonymous');
    else if (arg === '--git') options.git = true;
    else if (arg === '-n' || arg === '--model') {
      const value = argv[++i];
      if (value === undefined) throw usageError(`${arg} needs a value`);
      if (arg === '--model') options.model = value;
      else {
        setMode('new');
        options.name = value;
      }
    } else throw usageError(`unknown option: ${arg}\n\n${USAGE}`);
  }
  const rest = argv.slice(i);
  if (options.mode === 'continue' && rest.length === 3) [options.alias, options.name, options.question] = rest;
  else if (rest.length === 2) [options.alias, options.question] = rest;
  else throw usageError(USAGE);
  if (options.name !== undefined) checkName(options.name);
  if (!options.question.trim()) throw usageError('the question is empty');
  return options;
}

function askQuestion(argv) {
  const { mode, name, alias, question, git, model } = parseQuestion(argv);
  const cwd = resolveAlias(registryPath(), alias);

  if (mode === 'anonymous') {
    console.log(ask({ cwd, question, git, model, anonymous: true }));
    return;
  }

  const dir = sessionsDir(process.cwd(), alias);
  prune(dir);
  if (mode === 'continue') {
    const session = sessionToContinue(dir, alias, name);
    const answer = ask({ cwd, question, git, model, resume: session.sessionId });
    record(dir, { alias, name: session.name, question, answer });
    console.log(answer);
    console.error(`[ask-repo] continued session ${session.name}`);
  } else {
    const sessionName = newSessionName(dir, alias, name);
    const sessionId = randomUUID();
    const answer = ask({ cwd, question, git, model, sessionId });
    record(dir, { alias, name: sessionName, sessionId, question, answer });
    console.log(answer);
    console.error(`[ask-repo] session ${sessionName}; follow up with: ask-repo -c ${alias} ${sessionName} "question"`);
  }
}

function main(argv) {
  const [first] = argv;
  if (first === '-h' || first === '--help') return console.log(USAGE);
  if (first === '--list') {
    if (argv.length !== 1) throw usageError(USAGE);
    return list(registryPath());
  }
  if (first === '--add') {
    if (argv.length !== 3) throw usageError('usage: ask-repo --add <alias> <path>');
    const target = addAlias(registryPath(), argv[1], argv[2], process.cwd());
    return console.log(`${argv[1]} -> ${target}`);
  }
  if (first === '--remove') {
    if (argv.length !== 2) throw usageError('usage: ask-repo --remove <alias>');
    return removeAlias(registryPath(), argv[1]);
  }
  askQuestion(argv);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof AskRepoError)) throw error;
  console.error(`ask-repo: ${error.message}`);
  process.exit(error.code);
}
