---
name: update
description: Bring this project's copy of the honest-docs checks to the installed plugin's version.
disable-model-invocation: true
---

# honest-docs update

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/install.mjs" --mode update` with the Bash tool and show its
output verbatim, the CHANGELOG sections included.

Every step left to you is a `next:` line: carry out each one. A `warning:` line is for the user to
decide on.

If it exits non-zero, it wrote nothing. Show the user what it reports (a diff of files changed by
hand in `.claude/honest-docs/`, a passage you take to be the fragment it names) and ask with
`AskUserQuestion` what to do. Rerun with `--force` only when the user agrees to overwrite the files
the diff shows; never edit anything to make it pass.
