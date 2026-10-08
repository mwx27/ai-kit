---
name: init
description: Write or update the plugin's docs rule, config skeleton and CLAUDE.md fragments in this project.
disable-model-invocation: true
---

# honest-docs init

Run `honest-docs-init` with the Bash tool and show its output verbatim.

It writes `.claude/rules/docs.md` (the plugin is its only author: fixes go to the plugin, never
to that file), creates `.claude/honest-docs.json` only when the project has none, and replaces
in `CLAUDE.md` the `Read` line and the docs policy with their current versions, leaving the rest
of the file as it is. On the first run it appends whichever of the two is missing under a
`## honest-docs` heading at the end of `CLAUDE.md`. Run it again after every plugin update;
`honest-docs-check` reports `init` when an update changed the rule or a passage, until you do.

After a successful run, format the files it wrote the way the project formats Markdown. If the
output says it appended fragments, tell the user where they went and that they can move them
anywhere in `CLAUDE.md`.

If it exits non-zero, it wrote nothing: a fragment is there twice, or after an earlier run it is
gone or its words were edited by hand. Show the user the passage you take to be the fragment, if
any, and ask with `AskUserQuestion` what to do — never edit it to match and rerun on your own.

## The config it writes

When the user asks what to put in `.claude/honest-docs.json`, read the page for the key.
`<plugin_root>` in them means `${CLAUDE_PLUGIN_ROOT}`.

- `guard.command` — what the Stop gate does with it and what the command must do:
  [`hooks.md`](${CLAUDE_PLUGIN_ROOT}/references/hooks.md).
- `instructionsLog` — the measurement it turns on:
  [`instructions-log.md`](${CLAUDE_PLUGIN_ROOT}/references/instructions-log.md).
