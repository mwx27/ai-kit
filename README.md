# ai-kit

A personal marketplace of plugins and skills for AI coding agents by [@mwx27](https://github.com/mwx27) — [Claude Code](https://docs.anthropic.com/en/docs/claude-code) now, Codex planned.

## Status & scope

These are personal tools, published so they're easy to version and reinstall across machines — not (yet) turnkey for general use.

`cv-bullets` in particular is tightly coupled to my own CV: it assumes a specific data shape (`content/cv.pl.ts` / `content/cv.en.ts`, with `aiItExperience` / `itExperience` sections and a particular field schema) and bilingual Polish/English output. The CV itself isn't in this repo (it's live at [maciejwojda.cv](https://maciejwojda.cv)), and `config.md` externalizes only paths and your git-author pattern — not the CV structure. So it fits my setup out of the box, less so yours.

None of that is fundamental, though: the coupling lives in assumptions (CV schema, languages, section names) that could move into config. Making it genuinely reusable for others is a realistic future direction — just not there yet.

## Installation

Add this marketplace, then install a plugin from it:

```
/plugin marketplace add mwx27/ai-kit
/plugin install cv-bullets@mwx27-ai-kit
```

## Configuration

Some skills read a per-user config file so they don't ship anyone's personal paths or identity. For `cv-bullets`:

1. Copy the example config into your Claude config directory:

   ```bash
   mkdir -p ~/.claude/skills/cv-bullets
   cp ~/.claude/plugins/cache/mwx27-ai-kit/cv-bullets/<version>/config.md.example ~/.claude/skills/cv-bullets/config.md
   ```

   (Replace `<version>` with the installed version shown in `/plugin`.)

2. Open `~/.claude/skills/cv-bullets/config.md` and fill in:
   - **`cv_path`** — path to your CV folder (the one containing `content/cv.pl.ts` / `content/cv.en.ts`)
   - **`git_author_pattern`** — substring(s) for `git log --author` matching your commits (GitHub nick, email fragment, or name; comma-separated if you use several accounts)

`config.md` is git-ignored, so your personal data never gets committed. If you skip this step, the skill will ask you for both values on first run and offer to create the file for you.

## Available skills

### cv-bullets

Generate, refine, or analyze CV/resume bullets for software projects. It runs a mandatory dialog gate to capture cross-repo context, scans the project repo (and related sibling repos), pulls git + PR metrics, categorizes achievements as baseline vs senior, and composes bilingual (Polish/English) bullets that follow a strict style guide — writing them straight into your CV files for review via `git diff`. If the work it found looks thin for how long you were on the project, it re-scans the repo before composing so whole parts of your contribution don't get left out.

Alongside that private working inventory it also writes a redacted, public-safe version (client metrics, file paths, and teammate attribution stripped out) for outward-facing use such as a recruiter-facing chatbot — kept in sync with the private one, as a draft to review before you share it.

One caveat worth knowing: to stop you from claiming a teammate's work, the skill checks `git blame` before it bullets any file. That check is a strong filter, not the last word — if you reformatted a whole repo (say, ran Prettier) or did heavy refactoring, git can credit you with code that is really someone else's. Treat its authorship calls as a guardrail and use your own judgement; you stay the final authority on what's genuinely yours.

### honest-docs

Your agent reads the docs. Make sure they're not lying. A plugin that keeps a project's docs and agent rules in step with its code:

- At the end of every turn, it runs your project's own check script on the files the turn changed, and if it fails, the agent has to fix it before handing back. It gives up after three identical failures rather than looping.
- It keeps each doc's `**Last Updated:**` date current, from when the file actually changed.
- When code that a doc says it describes changes, it tells the agent to re-read that doc.
- `honest-docs-check` catches docs that point at files, headings, paths or scripts that no longer exist; `/honest-docs:docs-audit` goes further and checks what the docs claim against the code.

Whether a sentence is still true is something only a reader can judge: you, or the audit.

**Install.** It is meant to run only in projects that opt in. Add the marketplace and install the plugin:

```
/plugin marketplace add mwx27/ai-kit
/plugin install honest-docs@mwx27-ai-kit
```

Then turn it on in the project's `.claude/settings.json`:

```json
{ "enabledPlugins": { "honest-docs@mwx27-ai-kit": true } }
```

If your install turned it on for every project, set the same entry to `false` in `~/.claude/settings.json`; the project's setting wins. Start a new session in the project and run `/honest-docs:init`. It writes the docs rule, a starter `.claude/honest-docs.json` and two short passages in `CLAUDE.md`; run it again after every plugin update.

At the end of every turn that changed something, the plugin runs `honest-docs-check` over all the docs and sends the agent back to fix what it finds, so make it report no problems before you turn the plugin on.

**Connect your check script** (optional). To have the same end-of-turn check also run your own checks, name the command in `.claude/honest-docs.json`:

```json
{ "guard": { "command": ["bash", "scripts/guard.sh"] } }
```

The plugin calls it with `--changed` and the changed files, after `honest-docs-check` passes; a non-zero exit means it failed. What the command must do, and every other setting, is in [`references/hooks.md`](plugins/honest-docs/references/hooks.md) and [`core/config.mjs`](plugins/honest-docs/core/config.mjs).

The plugin keeps its working files in `artifacts/claude-hooks/` and `artifacts/logs/` in the project; add `artifacts/` to `.gitignore`, or move them with `stateDir` and `logDir`.

**Limitations.** `honest-docs-check` needs a `package.json` and a `CLAUDE.md` in the project, and the end-of-turn check cannot tell your own mid-session edits from the agent's. Changes are in [`CHANGELOG.md`](plugins/honest-docs/CHANGELOG.md).
