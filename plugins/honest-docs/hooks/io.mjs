// The one place that speaks Claude Code's hook protocol: JSON on stdin; stdout, stderr and the exit
// code out. core/ takes the parsed input and returns { stdout, stderr, exitCode }, so a port to
// another agent replaces only this folder.
//
// An unreadable payload reaches the handler as null. Anything the handler throws exits 0 in
// silence: a hook that breaks the session is worse than no hook.
import { readFileSync } from 'node:fs';

export function runHook(handler) {
  let input = null;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    // Left null; the handler decides what no input means.
  }

  let result = { exitCode: 0 };
  try {
    result = handler(input) ?? result;
  } catch {
    // See above.
  }

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode ?? 0;
}
