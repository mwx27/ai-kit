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
   cp ~/.claude/plugins/cv-bullets/config.md.example ~/.claude/skills/cv-bullets/config.md
   ```

   (Adjust the source path if your plugin installs elsewhere — the file is `config.md.example` inside the `cv-bullets` plugin.)

2. Open `~/.claude/skills/cv-bullets/config.md` and fill in:
   - **`cv_path`** — path to your CV folder (the one containing `content/cv.pl.ts` / `content/cv.en.ts`)
   - **`git_author_pattern`** — substring(s) for `git log --author` matching your commits (GitHub nick, email fragment, or name; comma-separated if you use several accounts)

`config.md` is git-ignored, so your personal data never gets committed. If you skip this step, the skill will ask you for both values on first run and offer to create the file for you.

## Available skills

### cv-bullets

Generate, refine, or analyze CV/resume bullets for software projects. It runs a mandatory dialog gate to capture cross-repo context, scans the project repo (and related sibling repos), pulls git + PR metrics, categorizes achievements as baseline vs senior, and composes bilingual (Polish/English) bullets that follow a strict style guide — writing them straight into your CV files for review via `git diff`. If the work it found looks thin for how long you were on the project, it re-scans the repo before composing so whole parts of your contribution don't get left out.

Alongside that private working inventory it also writes a redacted, public-safe version (client metrics, file paths, and teammate attribution stripped out) for outward-facing use such as a recruiter-facing chatbot — kept in sync with the private one, as a draft to review before you share it.

One caveat worth knowing: to stop you from claiming a teammate's work, the skill checks `git blame` before it bullets any file. That check is a strong filter, not the last word — if you reformatted a whole repo (say, ran Prettier) or did heavy refactoring, git can credit you with code that is really someone else's. Treat its authorship calls as a guardrail and use your own judgement; you stay the final authority on what's genuinely yours.
