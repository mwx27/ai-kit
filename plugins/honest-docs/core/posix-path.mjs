// Every repo-relative path the plugin prints, logs, stores in state, compares or matches against a
// glob is POSIX (`/`), on every OS: a path from path.*, an fs walk or a hook payload passes through
// posixPath where it enters. Git output already uses `/`. Absolute paths the user is told to run stay
// native, since they are for the user's shell.
import path from 'node:path';

/** `p` with the OS separator replaced by `/`; on POSIX the separator already is `/`, so `p` as it is. */
export const posixPath = (p) => p.split(path.sep).join('/');
