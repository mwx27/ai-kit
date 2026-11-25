---
name: init
description: Install the honest-docs checks into this project — the hooks, the docs check and the docs rule.
disable-model-invocation: true
argument-hint: '[now]'
---

# honest-docs init

Unless the arguments are `now` (they are: "$ARGUMENTS") or `.claude/honest-docs.json` exists, first run
`node "${CLAUDE_PLUGIN_ROOT}/scripts/install.mjs" --check-empty`. It prints
`{"empty":bool,"blocking":[...]}`. When `empty` is true, ask with `AskUserQuestion`: "This project
has no code yet. Will you generate the app with a tool like create-next-app or create-expo-app?"

- Generate the app first (Recommended): write nothing. Tell the user to generate the app, commit
  it, then run `/honest-docs:init` again. When `blocking` lists entries, name them: "the generator
  may refuse to run because of these files; move them out of the folder for a moment."
- Install now: for a project no generator starts (scripts, docs only, code written by hand). Go on.

Without `AskUserQuestion`, stop there, writing nothing, and give both ways: generate the app (naming
`blocking` as above) and run init again, or run `/honest-docs:init now` to install anyway.

When the project has no `.claude/honest-docs.json`, then ask with `AskUserQuestion`: "Which folder
should hold the docs about this project's code? honest-docs checks that the docs there stay true to
the code." Offer these options, with these descriptions:

- `_docs/` (Recommended): docs about the code, for the people and agents working on it. The
  underscore keeps the folder near the top of the file tree, and leaves `docs/` free for a
  documentation website.
- `docs/`: the most familiar name. Pick it only when the project does not publish a documentation
  website from `docs/`.
- An existing docs folder, if there is one: keeps the docs where they are, so no link breaks. Pick
  it only when they are docs about the code, not pages of a published website. A docs folder is one
  at the first or second level named `docs`, `doc`, `documentation`, `_docs` or `wiki` that holds
  `.md` files; with several, offer the one holding the most, and give its `.md` count.
- Help me choose: read [`docs-folder.md`](${CLAUDE_PLUGIN_ROOT}/references/docs-folder.md), sum it
  up for the user in a few sentences, then ask again without this option.

Never offer as the existing folder one under `node_modules/` or `.claude/`, a folder git ignores,
or one a docs-site config publishes (`docusaurus.config.*`, `mkdocs.yml`,
`.vitepress/`, GitHub Pages from `/docs`): name that one to the user as a website. Never offer to
move docs. Without `AskUserQuestion`, skip the question and say in one sentence that docs go in
`_docs/`.

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/install.mjs" --mode init`, adding `--docs-dir <folder>` when
the user picked one, with the Bash tool and show its output verbatim.

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
