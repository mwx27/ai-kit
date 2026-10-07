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
of the file as it is. Run it again after every plugin update; `honest-docs-check` reports `init`
until you do.

After a successful run, format the files it wrote the way the project formats Markdown.

If it exits non-zero, it wrote nothing: a fragment is missing from `CLAUDE.md`, edited by hand,
or there twice. Show the user the passage you take to be the fragment, if any, and ask with
`AskUserQuestion` what to do — never edit it to match and rerun on your own.
