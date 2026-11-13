---
name: init
description: Install the honest-docs checks into this project — the hooks, the docs check and the docs rule.
disable-model-invocation: true
---

# honest-docs init

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/install.mjs" --mode init` with the Bash tool and show its
output verbatim.

It copies the hooks and the docs check into `.claude/honest-docs/`, adds the hooks to
`.claude/settings.json`, writes `.claude/rules/docs.md`, the `CLAUDE.md` passages and a starter
`.claude/honest-docs.json`. Every step left to you is a `next:` line: carry out each one. A
`warning:` line is for the user to decide on; do not change the config or `.gitignore` on your own.

If it exits non-zero, it wrote nothing. Show the user what it reports (a diff, a passage you take to
be the fragment it names) and ask with `AskUserQuestion` what to do. Rerun with `--force` only when
the user agrees to overwrite the files the diff shows; never edit anything to make it pass.

## The config it writes

When the user asks what to put in `.claude/honest-docs.json`, read the page for the key.
`<plugin_root>` in them means `${CLAUDE_PLUGIN_ROOT}`.

- `guard.command` — what the Stop gate does with it and what the command must do:
  [`hooks.md`](${CLAUDE_PLUGIN_ROOT}/references/hooks.md).
- `instructionsLog` — the measurement it turns on:
  [`instructions-log.md`](${CLAUDE_PLUGIN_ROOT}/references/instructions-log.md).
