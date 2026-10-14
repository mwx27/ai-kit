# ai-kit

Plugins for AI coding agents by [@mwx27](https://github.com/mwx27) — [Claude Code](https://docs.anthropic.com/en/docs/claude-code) now, Codex planned.

Add the marketplace once, then install plugins from it:

```
/plugin marketplace add mwx27/ai-kit
```

| Plugin                        | What it does                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------- |
| [honest-docs](#honest-docs)   | Your agent reads the docs. Make sure they're not lying.                          |
| [ask-repo](#ask-repo)         | Ask another repo on your machine a question without leaving the one you are in.  |
| [cv-bullets](#cv-bullets)     | A personal tool that writes my CV bullets from a project repo; not built for reuse. |

## honest-docs

Your agent reads the docs. Make sure they're not lying. A plugin that keeps a project's docs and agent rules in step with its code:

- At the end of every turn that changed something, it checks the docs, then runs your project's own check script on the changed files. If either fails, the agent has to fix it before handing back. It gives up after three identical failures rather than looping.
- It keeps each doc's `**Last Updated:**` date current, from when the file actually changed.
- When code that a doc says it describes changes, it tells the agent to re-read that doc.
- `honest-docs-check` catches docs that point at files, headings, paths or scripts that no longer exist; `honest-docs-grep <symbol>` lists every line of the docs and rules that names a symbol; `/honest-docs:docs-audit` goes further and checks what the docs claim against the code.

Whether a sentence is still true is something only a reader can judge: you, or the audit.

It needs `node` and `git` on the PATH.

### Setup

It is meant to run only in projects that opt in.

1. Install it:

   ```
   /plugin install honest-docs@mwx27-ai-kit
   ```

2. Turn it on in the project's `.claude/settings.json`:

   ```json
   { "enabledPlugins": { "honest-docs@mwx27-ai-kit": true } }
   ```

   If your install turned it on for every project, set the same entry to `false` in `~/.claude/settings.json`; the project's setting wins.

3. Add `artifacts/` to `.gitignore`. The plugin keeps its working files in `artifacts/claude-hooks/` and `artifacts/logs/`; `stateDir` and `logDir` move them.

4. Start a new session in the project and run `/honest-docs:init`. It writes the docs rule, a starter `.claude/honest-docs.json` and two short passages in `CLAUDE.md`. Run it again after every plugin update.

5. Have the agent run `honest-docs-check` and fix what it reports. The end-of-turn check covers all the docs, so until this passes, every turn that changes anything is sent back to fix docs it never touched.

The docs rule is the plugin's and is rewritten on every `init`. Rules only your project needs go in a rule file of your own, which the plugin never touches; [`references/instruction-channels.md`](plugins/honest-docs/references/instruction-channels.md#decisions) says how.

### Connect your check script (optional)

To have the end-of-turn check also run your own checks, name the command in `.claude/honest-docs.json`:

```json
{ "guard": { "command": ["bash", "scripts/guard.sh"] } }
```

The plugin calls it with `--changed` and the changed files, after `honest-docs-check` passes; a non-zero exit means it failed. What the command must do, and every other setting, is in [`references/hooks.md`](plugins/honest-docs/references/hooks.md) and [`core/config.mjs`](plugins/honest-docs/core/config.mjs).

### Limitations

The end-of-turn check cannot tell your own mid-session edits from the agent's. Changes are in [`CHANGELOG.md`](plugins/honest-docs/CHANGELOG.md).

## ask-repo

When work in one repo depends on another — an app and its API, a client and its backend — your agent can ask the other repo instead of guessing. A separate Claude session starts inside that repo, finds the answer in its code and hands it back. Follow-up questions continue the same session, so it does not search from scratch each time.

The session in the other repo can only read files: it gets none of your MCP servers and none of the permissions your own settings grant. It needs `node` and `claude` on the PATH.

### Setup

1. Install it:

   ```
   /plugin install ask-repo@mwx27-ai-kit
   ```

2. Register each repo you want to ask by a short name. Have the agent run, or ask it to:

   ```
   ask-repo --add api ~/dev/my-api
   ```

   Names are kept in `~/.config/ask-repo/registry.json`, outside every repo, so no personal path is ever committed. `ask-repo --list` shows them, `ask-repo --remove <name>` drops one.

### Use

Ask in plain words ("ask api how tokens are refreshed"), or run `/ask-repo:ask api "how are tokens refreshed?"`. The agent also asks on its own when a task needs a registered repo. `ask-repo --help` lists the options, among them `--git`, which also lets the session read the other repo's git history.

Answers are saved in `artifacts/ask-repo/` of the project you ask from, so the agent can look there before asking again. That folder ignores itself in git, and a conversation unused for 7 days is deleted.

### Limitations

Each question runs a full Claude session on your account. The `ask-repo` command works only inside Claude Code, not in your own terminal. With `--git`, a git option that writes a file is forbidden to the session by its instructions, not blocked. Changes are in [`CHANGELOG.md`](plugins/ask-repo/CHANGELOG.md).

## cv-bullets

A personal tool I built while writing my own CV. It turns a project repo into bilingual (Polish/English) CV bullets: it asks about related repos first, reads the git history, checks with `git blame` that the work is yours, and writes the bullets straight into the CV files for review via `git diff`. It also writes a redacted copy of its notes that is safe to share.

It is tied to my CV's shape: it expects `content/cv.pl.ts` / `content/cv.en.ts` with `aiItExperience` / `itExperience` sections, and only paths and your git author live in config. It is published so I can reinstall it, not as a general tool.

```
/plugin install cv-bullets@mwx27-ai-kit
```

On first run it asks for `cv_path` (the folder holding `content/`) and `git_author_pattern` (substrings for `git log --author`, comma-separated), and offers to save them in `~/.claude/skills/cv-bullets/config.md`, which is never committed. Changes are in [`CHANGELOG.md`](plugins/cv-bullets/CHANGELOG.md).
