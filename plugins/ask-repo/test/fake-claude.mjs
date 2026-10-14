// A stand-in for `claude -p` in the tests. Appends what it was called with to $FAKE_CLAUDE_LOG as
// one JSON line — argv, cwd, stdin, whether CLAUDECODE was set — and answers as $FAKE_CLAUDE_MODE says:
// ok (default), error (is_error), garbage (not JSON), or exit (stderr and exit code 3).
import { appendFileSync, readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const stdin = readFileSync(0, 'utf8');
const after = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);

if (process.env.FAKE_CLAUDE_LOG) {
  const call = { argv, cwd: process.cwd(), stdin, claudecode: 'CLAUDECODE' in process.env };
  appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify(call)}\n`);
}

const session_id = after('--session-id') ?? after('--resume') ?? '00000000-0000-0000-0000-000000000000';
switch (process.env.FAKE_CLAUDE_MODE ?? 'ok') {
  case 'ok':
    console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: `answer to: ${stdin}`, session_id }));
    break;
  case 'error':
    console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in', session_id }));
    break;
  case 'garbage':
    console.log('this is not json');
    break;
  case 'exit':
    console.error('fatal: something broke');
    process.exit(3);
}
