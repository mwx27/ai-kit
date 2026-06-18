# Changelog

All notable changes to the `cv-bullets` skill are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/). As an early-stage skill, it stays in the `0.x` range — behavior may change between minor releases until the interface settles and a `1.0.0` is cut.

---

## [0.5.0] — 2026-06-18

### Added

- **A public-safe copy of the inventory, made for you automatically.** The skill has always written one inventory file — a private working doc thick with evidence you'd never send outward: contribution percentages, file paths, commit counts, who-wrote-what, candid notes. Sharing your work with anything outward-facing (say, a recruiter-facing CV chatbot) meant redacting it by hand, every time, in a copy that quickly fell out of date. Now the skill also writes a redacted sibling to `content/data-inventories-public/` — same technical substance and significance tiers, same polished Polish/English bullets, but with the client metrics, paths, and teammate names stripped out (co-authored work reads "co-built", your majority work reads "primary author", no one else is named). It's rebuilt from the same data whenever the private one changes, so the two can't drift apart. Treat it as a draft to eyeball before sharing, not a guaranteed-clean file — automated redaction can miss a subtle leak. Skipped in `refinement` mode. (New `references/PUBLIC_INVENTORY.md`; `SKILL.md` Phases 7–8.)

## [0.4.0] — 2026-06-18

### Changed

- **The inventory table is now built before the bullets are chosen, not after.** The table is meant to list *all* of your work that passed the authorship gate — with a ⭐ on the items that became CV bullets and the rest left as a pool you can swap in while iterating. Previously the skill assembled the whole inventory at the very end of the run, when only the chosen bullets were fresh in mind, so it sometimes recorded *only* the starred items and silently dropped the solid-but-not-chosen work — leaving nothing to swap in. The rows are now written right after categorization (when "chosen" doesn't exist yet) and the ⭐ is layered on during composition, so the swap-in pool can no longer go missing. The inventory file is filled in across phases instead of in one write at the end. (`SKILL.md` Phases 4–5 and inventory section; `references/INVENTORY_TEMPLATE.md` truth-document rule + population order.)

## [0.3.0] — 2026-06-03

### Added

- **Discovery-completeness safeguards** (`references/DISCOVERY_COMPLETENESS.md`) against the skill silently missing real work. Two checks: (1) a Phase 3 sniff test — if the inventory is much thinner than ~3–5 candidates per active year (judged from the user's own commit activity, not the repo-wide calendar), the skill dispatches a read-only `Explore` subagent to re-scan the repo with a neutral prompt before composing, so whole subsystems aren't walked past; its findings still pass the Phase 2.5 authorship gate. (2) a Phase 6 category-mix check — bullets clustering 3+ in one of feature / refactor / maintenance (especially on >1-year engagements) flag the other buckets as under-sampled and prompt a re-scan rather than an unbalanced set. Neither check pads to a number; both look only for work that was actually missed.

## [0.2.0] — 2026-06-03

### Added

- **Authorship gate (Phase 2.5)** — before a bullet can claim a file or folder, the skill verifies you actually wrote it with `git blame`. `scripts/analyze_git.py --paths <path…>` labels each path **OWN** / **PARTIAL** / **SKIP** by your blame share and overrides earlier categorization, so in projects you joined mid-flight a teammate's code can no longer end up in your bullets. Runs `git blame -w` and honors `.git-blame-ignore-revs` / `--ignore-rev` to exclude formatting commits. Mechanics: `references/AUTHORSHIP_GATE.md`.
- **Commit attribution across your git identities** — `analyze_git.py --author` can now be given more than once, so commits made under any of your name/email variants all count as yours. The report lists every variant it matched (with counts), surfacing e.g. GitHub merge-UI commits under `<account-id>+<handle>@users.noreply.github.com` that a single name pattern silently missed — which previously undercounted your contribution.

### Changed

- The inventory is now explicitly a **truth document** (`references/INVENTORY_TEMPLATE.md`): only verified items are recorded; items rejected during the authorship gate are not logged at all (no audit-trail / "considered but cut" section).

### Known limitations

- The gate reflects whose lines a file holds *now*, not who originated its substance: a repo-wide reformat or heavy refactor can read OWN for a teammate's code. `-w` + `--ignore-rev` / `.git-blame-ignore-revs` mitigate the formatting case; for refactors the safeguard is verb choice (re-architected ≠ built). The user remains the final authority on an OWN verdict.

---

## [0.1.0] — 2026-06-02

First public release on the marketplace. This entry describes the feature set the skill ships with, not a delta from earlier work (prior iterations were never publicly released — see *Prior history* below).

### Features

- **Three modes** — `full` (default: read repo + git log + dialog + generate + write), `refinement` (polish existing bullets without scanning the repo), `from-memory` (structured interview for projects without repo access).
- **Mandatory Phase 0 dialog gate** — captures what automated analysis can't: related repositories, target CV section, new-entry-vs-refinement, the flagship claim, limits, and CV style strategy (mirror vs. canonical rules).
- **Multi-repo discovery** (`scripts/scan_siblings.py`) — scans sibling directories for git repos the user contributed to and offers them via a multi-select widget, so cross-repo work isn't lost.
- **Git + PR metrics** (`scripts/analyze_git.py`) — conventional-commit breakdown, feat:fix ratio, quality ratio (refactor+test+perf), test-touch %, average commit size, active days, and PR counts authored by the user via `gh` (silent skip when `gh` is unavailable).
- **Baseline-vs-senior categorization** — every achievement is labelled BASELINE / SOLID / SENIOR / FLAGSHIP (`references/BASELINE_VS_SENIOR.md`) so only above-the-bar signals become bullets.
- **Bilingual composition (Polish + English)** following a strict style guide (`references/STYLE_GUIDE.md`): Polish noun-forms, English action verbs, term-of-art kept in English, numbers over adjectives, no calques.
- **Length & count discipline** — max 5 bullets (never padded to hit a number), 105-char ceiling, with one optional extended slot up to 170 chars per section for a dense signal that would weaken if split.
- **TechStack reconciliation** — proposes an updated `techStack` field from the composed bullets and repo dependencies; keeps the existing one if already strong.
- **Comparison gate + duplicate detection** — when refining/replacing, judges new vs. old bullets per item (NEW BETTER / OLD BETTER / TIE / NEW TOPIC) and flags bullets that resemble entries in other projects.
- **Inventory output** — a categorized markdown inventory saved under `<cv_path>/content/data-inventories/`, with chosen items marked ⭐, for offline review and interview prep.
- **Write-first flow** — writes directly to `cv.pl.ts` / `cv.en.ts`, leaves changes unstaged, and points to `git diff` as the review surface (no chat-approval gate).
- **Per-user configuration** (`config.md`) — `cv_path` and `git_author_pattern` are read from `~/.claude/skills/cv-bullets/config.md`; the skill prompts for them and offers to create the file on first run if it's missing. No personal paths or identity are baked into the skill.

### Known limitations

- The Phase 0 dialog gate can still be under-executed on long runs; not yet confirmed by an eval harness.
- `scripts/scan_siblings.py` does not deduplicate snapshot/copy directories (e.g. `repo`, `repo-copy`, `repo-copy 2` are counted as separate repos).
- No automated eval harness yet — behavior is validated by walkthrough only.

---

## Prior history (pre-publication)

Before this release the skill went through roughly ten private iterations (internally numbered v1–v10); none were ever publicly released, and that `vN` numbering is retired. In brief, it evolved as follows:

- **Early versions** established the core bilingual Polish/English bullet rules and the style guide.
- **Mid versions** added multi-repo discovery, git metrics, the baseline-vs-senior categorization reference, the `from-memory` mode, and the CV-style strategy question.
- **Later versions** dropped the chat-approval gate in favor of the write-first flow (with `git diff` as the safety net), and treated bullet length and count as ceilings rather than targets.
- **The final pre-publication version** added PR statistics, TechStack reconciliation, and the comparison + cross-project duplicate gates.

`0.1.0` is the consolidation of that work into an installable, configurable marketplace plugin.
