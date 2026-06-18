---
name: cv-bullets
description: Generate CV bullets, refine existing CV sections, or analyze a project repository for resume-worthy achievements. Use this skill whenever the user wants to describe a software project for their CV, resume, portfolio, or professional experience document — even if they don't use the word "CV" specifically. Trigger phrases include "make CV bullets", "add this project to my CV", "describe this project for my resume", "polish/refine these bullets", "portfolio section for this project", or running /cv-bullets. ALSO trigger when the user is in a project repo and wants to describe their work professionally, or when they want bilingual (Polish/English) descriptions for job hunting. ALWAYS start with the mandatory dialog gate to ask about related repositories, target section, and flagship claim — skipping this loses major bullets. DO NOT trigger for cover letters, README files, marketing copy, landing pages, or generic documentation.
---

# CV Bullets Skill

Generates or refines CV bullets for software projects, in **both Polish and English**,
formatted as TypeScript arrays compatible with the user's CV files. The skill reads a
repo (plus related repos), mines git/PR metrics, filters achievements for senior signal,
composes bullets under a strict style guide, and writes them into the CV for review via
`git diff`.

## Configuration

This skill is configured per-user via `~/.claude/skills/cv-bullets/config.md`, which
supplies two values used throughout this document:

- **`cv_path`** — folder holding the CV. Wherever this document writes `<cv_path>`,
  substitute the configured value (example default: `~/dev/cv/`).
- **`git_author_pattern`** — substring(s) for `git log --author` to isolate the user's
  commits. Wherever this document writes `<git_author_pattern>`, substitute it
  (comma-separated if the user commits from several accounts — try each).

Reading and bootstrapping this file is **Step 0.0** of the workflow (below).

## CV structure

The CV lives at `<cv_path>` with two data files of **identical structure** (only the
text differs):
- `content/cv.pl.ts` — Polish
- `content/cv.en.ts` — English

Sections: `aiItExperience[].subRoles[]` (recent agentic-coding work, 09.2025+) and
`itExperience[]` (older roles, or recent work without agentic AI tooling). Each role has
fields like `company`, `period`, `bullets`, `techStack`, `aiTool`, `status`. Match the
exact shape of the target section by reading existing entries.

## Defaults

Unless the user overrides: `full` mode, both languages always, max **5** bullets per
project (a ceiling, not a target — ship fewer if fewer survive the filter), **105**-char
ceiling per bullet with one optional slot up to **170** (see STYLE_GUIDE.md → Length
discipline).

## Modes

- **`full`** (default) — read repo + git log + dialog gate + generate + write to CV.
  Activate: `/cv-bullets` or "make CV bullets for this project". This is the full
  Workflow below.
- **`refinement`** — polish existing bullets without scanning the repo. Read the bullets
  (from CV files or pasted input), apply STYLE_GUIDE.md and EXAMPLES_OF_MISTAKES.md,
  respect length limits, run Phase 6.5 (light — default to KEEP techStack) and Phase 6.6
  Part A (always — refinement is by definition a comparison). Skip the inventory file.
  Write the wins to the CV (or show in chat if working from pasted input). Activate:
  `/cv-bullets refinement` or "refine/polish these bullets".
- **`from-memory`** — for projects without repo access (old freelance, NDA-locked, lost
  repos). Interview the user: project name, role, period, tech stack, status, then the
  flagship achievement and iteratively dig for more. Apply the same senior-vs-baseline
  filter and the same review + write-and-show flow as `full`. Activate:
  `/cv-bullets from-memory`.

## Workflow (full mode)

### Phase 0 — config bootstrap + dialog gate

**Step 0.0 — config bootstrap.** Read `~/.claude/skills/cv-bullets/config.md`.
- **If it exists**, parse `cv_path` and `git_author_pattern` and use them silently.
- **If it is missing**, do not guess. Ask the user for both in one turn and offer to
  create the file (template: `config.md.example` in the skill folder):
  > "I don't see `~/.claude/skills/cv-bullets/config.md` yet. Two things before I start:
  > **(1) cv_path** — where's your CV folder (with `content/cv.pl.ts`/`cv.en.ts`; e.g.
  > `~/dev/cv/`)? **(2) git_author_pattern** — what should I match in `git log --author`
  > to find your commits (GitHub nick, email fragment, or name; comma-separate a few if
  > you use different accounts)? Want me to save these to `config.md` so you don't have
  > to answer again?"

  Write `config.md` (mirroring `config.md.example`) if they agree, then continue.

**The dialog gate (Steps below) is mandatory — do not skip it.** Automated repo analysis
silently makes wrong assumptions without it: wrong CV section, missed cross-repo
contributions, duplicated entries. The user prefers an extra turn of dialog over a fast
but wrong outcome. This is the skill's core mechanism for capturing knowledge that isn't
in the code. Ask all questions in one turn, then wait. Do not run analysis scripts or
read code beyond what's needed to frame the questions (a quick `ls` / `cat README.md` is
fine; `analyze_git.py` is not).

**Question 1 — Related repositories (the most important).** Many projects span multiple
repos (mobile app + separate backend, webview embeds, landing/admin elsewhere). Run
`~/.claude/skills/cv-bullets/scripts/scan_siblings.py` first, present its summary, then ask which repos to include
via a multi-select widget. **Full mechanics — scan command, summary format, the widget's
Case A/B/C and additive-only rules — are in `references/DIALOG_GATE.md`; read it when you
reach this question.**

**Question 2 — CV section target.** Heuristic: project 09.2025+ AND uses agentic AI
tooling (Claude Code / Cursor / similar) → `aiItExperience`; pre-09.2025 or no agentic
tooling → `itExperience`; borderline → present both without a strong default. Always
confirm, even when the heuristic is clear:
> "Should this go into `aiItExperience` (recent agentic-coding work) or `itExperience`
> (older roles)? My guess: {section} because {reason}."

**Question 3 — New entry vs refinement.** First read `<cv_path>/content/cv.pl.ts` and
search for the project. If it exists, ask:
> "I see {project} is already in {section}. Should I (a) refine the existing bullets,
> (b) replace them with new ones from current repo state, (c) add a separate sub-entry
> (e.g. new period), or (d) something else?"

If it doesn't exist, proceed as a new entry (no need to ask).

**Anchor-bias rule** — how to handle existing bullets depends on the answer:
- **(a) refine** — the existing bullets ARE the input. Read them carefully; apply
  STYLE_GUIDE, fix calques, improve specificity. Don't replace wholesale.
- **(b) replace** — DO NOT read this project's existing bullets; they'd anchor you toward
  prior decisions and defeat the fresh start. You may read OTHER projects for style and
  duplicate detection, but treat THIS project as new.
- **(c) sub-entry** — read existing sub-entries (so you don't repeat) but compose fresh
  bullets for the new one.
- **(d)** — clarify.

**Question 4 — Flagship claim.**
> "What's your flagship achievement here? What makes you proud as a senior engineer?
> This drives bullet priority."

**Question 5 — Limits and count** — only ask if the user signals something other than
the Defaults (e.g. a long multi-year role needing ~8 bullets, or very short bullets).

**Question 6 — CV style strategy** (single-select widget, two options — always ask):
> "How should I treat the rest of your CV? **1. Mirror the style** — match formatting,
> voice, conventions of other sections (use if your CV is already polished). **2. Ignore
> other sections** — use only the canonical rules in STYLE_GUIDE.md (use if you're
> rewriting from scratch and other sections aren't trustworthy patterns yet)."

This is independent of Question 3. Downstream effect: **Mirror** → read 3–5 nearby
entries from the SAME target section, detect patterns (verb vs noun lead, emoji, detail
depth, numbers, tone) and match them in Phase 5. **Ignore** → apply STYLE_GUIDE.md as
sole authority; glance at other sections only for cross-project duplicate detection.

**If CV files are inaccessible** (sandbox / permission denied): do not proceed blind.
> "I can't access `<cv_path>/content/cv.pl.ts` (permission denied). Please either (a)
> grant access when prompted, (b) `cd` to the CV directory and run me from there, or (c)
> paste the relevant existing section so I can match style and avoid duplication."

Wait for the response — generating without seeing the CV produces duplicates and
style-inconsistent output.

### Phase 1 — Project context

With the user's answers in hand:
1. Identify structure for the primary repo: read `CLAUDE.md` and `README.md` if present;
   list top-level structure and build files (`package.json`, `build.gradle`,
   `Package.swift`, `Podfile`, …); note language/framework.
2. Do the same for each related repo (from Q1), tracking which insights come from which
   repo so you can attribute them in bullets.
3. Read the existing CV. **Depth depends on Q6:** *Mirror* → read 3–5 nearby entries from
   the SAME target section and note their style patterns (these become composition
   constraints in Phase 5). *Ignore* → read only enough to detect cross-project duplicate
   signals; do not extract style patterns. In both cases, re-check for the project name to
   avoid duplication, and note the user's identity for the author filter.

### Phase 2 — Repo analysis

Run `~/.claude/skills/cv-bullets/scripts/analyze_git.py` (it analyzes the current
directory — no `--repo` flag; `cd` into a different repo to analyze it):

```bash
python3 ~/.claude/skills/cv-bullets/scripts/analyze_git.py --author "<git_author_pattern>"                     # all-time, filtered to user
python3 ~/.claude/skills/cv-bullets/scripts/analyze_git.py --author "<git_author_pattern>" --since 2025-11-01  # limit to project period
python3 ~/.claude/skills/cv-bullets/scripts/analyze_git.py --author "<git_author_pattern>" --json              # for parsing
```

Substitute the configured `git_author_pattern`. `--author` is **repeatable** — pass one
per variant if config holds several comma-separated patterns (e.g. `--author "Maciej Wojda"
--author "mwx27"`), so squash/merge commits under a GitHub-noreply email get counted too.
Flags: `--author` (repeatable), `--paths` (the Phase 2.5 gate), `--since`, `--until`,
`--json`.

Read the **Identity rollup** the script prints: it lists every name/email variant your
patterns matched, with counts. If a top contributor is actually you under another email, or
the count looks low, add that variant as another `--author` and re-run before trusting any
share number. Carry the same full pattern set into the Phase 2.5 gate.

The script reports: total commits; user's commits vs others (% share); conventional
commit breakdown; feat:fix ratio; quality ratio (refactor+test+perf); % of commits
touching test files; average commit size; active days; and **PRs authored by the user**
(open/closed/merged/total) via `gh` if available (silent skip otherwise — bonus data, no
need to prompt).

**For multi-repo projects:** run the script in EACH repo and aggregate. Contribution
share may vary widely (100% on mobile, 10% on shared backend) — that's informative for
framing. Report PR counts per-repo in the inventory, not as one total.

Then **read key files** identified from CLAUDE.md/README/structure: architecture
decisions, non-trivial code (concurrency, error handling, custom integrations), test
setup, configuration that signals senior thinking.

### Phase 2.5 — Authorship gate (mandatory, before composition)

**For every file or folder you intend to name in an inventory item, verify authorship
with `git blame` first.** "Exists in the repo and looks custom" ≠ "you built it" — in
projects joined mid-flight, this is how teammates' work silently ends up in your bullets.
Run the gate over the candidate paths (same `--author` set as Phase 2):

```bash
python3 ~/.claude/skills/cv-bullets/scripts/analyze_git.py --author "<p1>" --author "<p2>" --paths <path> <path> …
```

Each path returns **OWN** (you created it, or blame ≥ 50% → bullet freely), **PARTIAL**
(20–49% → bullet only with explicit co-built framing), or **SKIP** (< 20% → don't bullet,
even if recent). The verdict **overrides earlier categorization** — a FLAGSHIP-looking path
that comes back SKIP does not ship — and rejected items are not recorded in the inventory.

**Known limitation:** blame shows whose lines these are *now*, not who originated the
feature — a repo-wide formatter or heavy refactor can read OWN for a teammate's substance.
The gate runs `git blame -w` and honors `.git-blame-ignore-revs` / `--ignore-rev`; for
refactors, match the verb (re-architected ≠ built).

Full mechanics — identity setup, dir vs file, framing examples, the reformatting/refactor
blind spots, the truth-document rule — are in **`references/AUTHORSHIP_GATE.md`**.

### Phase 3 — Inventory

Build a flat list of every technical decision and achievement found. Don't categorize
yet — enumerate. Over-collect now; filter later.

**Completeness sniff test.** Before Phase 4, check the inventory isn't suspiciously thin
for how much the user actually worked the project — judged from their own commit activity,
not the repo's calendar. If it is, dispatch a feature-discovery `Explore` subagent to
re-scan before composing. The candidate band, the user-scoped signals to read, the subagent
prompt, and the fallback are in **`references/DISCOVERY_COMPLETENESS.md`**. Subagent findings
still go through the Phase 2.5 gate.

### Phase 4 — Categorization

Label each inventory item using `references/BASELINE_VS_SENIOR.md`: **BASELINE**
(standard, not worth a bullet), **SOLID** (okay but generic), **SENIOR** (above-average
signal), **FLAGSHIP** (the user's stated flagship claim from Q4). When unsure, ask: "Is
this above what most devs in your stack do, or standard?"

Then **write the inventory table to disk now, before any bullet is chosen** — one row per
gate-surviving item, Status column empty. Building the rows here, while "chosen for CV"
does not yet exist, is what stops the table later shrinking to just the picked bullets and
losing the swap-in pool. Path and format: `references/INVENTORY_TEMPLATE.md` (skip in
`refinement` mode).

### Phase 5 — Composition

**Selection logic (how many):** all FLAGSHIP items are in (never cut); all SENIOR items
are in; SOLID items only if they add a distinct signal not already covered AND there's
room under the cap; BASELINE never. Cap at 5 — if FLAGSHIP+SENIOR already exceeds 5, keep
the strongest 5 (ask the user if it's unclear which to cut). If only 3 strong items
exist, ship 3. **Never pad with weak signals to hit a number.**

After selecting, **overlay a ⭐ onto the matching rows of the inventory table written in
Phase 4** — don't rebuild or prune it. Non-chosen rows stay; they are the swap-in pool.

**Length:** 105-char ceiling, one optional extended slot up to 170 per section. Full
rules — including the padding/length-as-target smells — live in **STYLE_GUIDE.md →
Length discipline**.

**Style:** apply `references/STYLE_GUIDE.md` (Polish noun-forms; English action verbs
past tense; term-of-art stays in English; numbers exposed; no calques). Then per Q6:
*Mirror* → layer the sibling-entry patterns on top of the guide (guide is the floor,
sibling patterns the target). *Ignore* → STYLE_GUIDE.md is the sole authority.

### Phase 6 — Self-review

Review every draft against `references/EXAMPLES_OF_MISTAKES.md` (principles, not a
checklist): unique signal per bullet beyond the header; concrete detail over generic
adjectives; show-don't-tell; no bragging about baseline hygiene; no throwing the team
under the bus; one signal per bullet; natural language (no calques/awkward grammar); no
tautologies; no empty adjectives; no header duplication in bullet 1. Also run the length
checks from STYLE_GUIDE.md (padding cluster at 95–105, length-as-target, at most one
extended slot). Fix issues before writing.

**Category-mix check.** Sort the surviving bullets into feature / refactor / maintenance;
3+ clustered in one bucket (especially on >1-year engagements) usually means the others
were under-sampled — re-scan the thin buckets rather than accept the skew. Full rule in
**`references/DISCOVERY_COMPLETENESS.md`**.

### Phase 6.5 — TechStack reconciliation

Propose the entry's `techStack` field. Sources in priority order: (1) technologies named
in the new bullets (must be included), (2) repo dependencies, (3) existing techStack.
Include a tech if it's bullet-mentioned, a SENIOR-tier dependency, or distinctive; exclude
baseline/transitive/already-implied tech. Format: **one line**, grouped with `+` and
parentheses (e.g. "Kotlin + Jetpack Compose, Coroutines/Flow, Hilt, Firebase (Firestore +
Auth + Crashlytics)").

Decision: new entry → compose from sources 1+2. Refine/replace with existing techStack →
keep it if it already covers the bullets and current repo state (note "kept as-is"),
otherwise propose a new version. Sub-entry → use the parent's techStack; don't override.
**When unsure whether the existing one is "already strong", default to KEEP** — a skipped
minor improvement costs less than a misguided rewrite. Record the decision in the
inventory's "TechStack revision" section (Case A/B/C — see `references/INVENTORY_TEMPLATE.md`).

### Phase 6.6 — Comparison gate + duplicate detection

**Part A — comparison (refine/replace mode only; skip for new entries and sub-entries).**
For each new bullet, find the closest old bullet by topic/signal and judge it:
- **NEW BETTER** → write it (replaces the old)
- **OLD BETTER** → keep the old, don't write the new
- **TIE** → keep the old (don't churn), but show the new as a proposal
- **NEW TOPIC** → no old match; write it

**Honesty rule:** be willing to judge OLD BETTER even though you just composed the new
one — the user values truth over sunk cost. Write only NEW BETTER + NEW TOPIC. Always
show ALL new proposals in chat (even the ones not written) so the user can override. If
most verdicts are OLD BETTER/TIE, say so explicitly and keep the existing entry. Example
chat output:
```
- Bullet 1 (auth migration): NEW BETTER — old said "auth flow", new specifies "header→cookie across 12 endpoint groups"
- Bullet 2 (testing): OLD BETTER — old has more concrete numbers, keeping it
- Bullet 3 (RN bridge): NEW TOPIC — adding
```

**Part B — cross-project duplicates (always).** Scan OTHER project entries for bullets
that resemble what you're about to write (same topic/signal, not string similarity — e.g.
"Expo SDK X→Y migration" in two projects). Do NOT modify your composition; add a warning
to the inventory ("Duplicate warnings" section) and to chat. The user decides whether to
keep both, differentiate, or remove one. If none, omit the section.

### Inventory file (populated across phases)

The categorized inventory is a markdown file built **incrementally**, not in one end-of-run
write (skip entirely in `refinement` mode) — the per-phase population order and the
**two-axes rule** (authorship vs. selection) that keeps the table from collapsing into the
chosen list live in **`references/INVENTORY_TEMPLATE.md`**.

A **public-safe sibling** is derived from the same in-memory data (Phase 7, refreshed in
Phase 8) and written to `content/data-inventories-public/` — a redacted, review-first draft
for outward-facing use. Strip/keep rules, prose format, and path: **`references/PUBLIC_INVENTORY.md`**.

### Phase 7 — Write to CV (no preview gate)

Once self-review is clean, write directly to `cv.pl.ts` and `cv.en.ts` — no approval gate
(git is the safety net; the user reviews via `git diff`).
1. Locate the right place: `aiItExperience` → new `subRoles[]` entry, chronologically
   positioned; `itExperience` → new entry or new `subRoles[]` in an existing entry.
2. Match existing formatting (indentation, double quotes, field order).
3. Write both files, including the `techStack` field if Phase 6.5 decided to update it
   (otherwise leave it untouched).
4. **Leave changes unstaged — do NOT run `git add`, `git commit`, or any git mutation.**
   The user reviews unstaged diffs as their sanity check.
5. **Emit the public-safe inventory draft** (skip in `refinement` mode): derive a redacted
   sibling of the inventory from the in-memory data and write it to
   `content/data-inventories-public/`. Rules, format, and path: `references/PUBLIC_INVENTORY.md`.
6. Show what was written in chat: the two TS arrays; comparison verdicts (incl. proposals
   not written, so the user can override); the techStack decision ("kept as-is" or "added
   X, removed Y"); any duplicate warnings; a brief rationale for cuts; acknowledged
   uncertainties; a pointer to the inventory file (⭐ items, cut items to swap in); a
   pointer to `git diff content/cv.pl.ts content/cv.en.ts`; and the git/PR metrics as a
   bonus after the bullets. Also flag the public-safe draft and note it is a
   **review-it-first draft** — the user should eyeball it before feeding it to any
   outward-facing bot (redaction can miss a subtle leak).

**Exception:** if the CV files are inaccessible (sandbox), fall back to preview-only —
show the TS arrays in chat and tell the user to paste them in. Don't silently fail.

### Phase 8 — Iteration (on-disk)

Iterate by editing the files in place:
- Adjust/swap/tighten bullets; when the user picks an item from the inventory, look up its
  categorization, edit the CV, and update the inventory's ⭐ markers.
- When iteration changes the bullets or tiers, **refresh the public-safe inventory file too**
  (overwrite in place) so it stays in sync — see `references/PUBLIC_INVENTORY.md`.
- Show only the changed bullets (deltas), not the full array unless asked. Remind once:
  "Run `git diff` to see all changes."
- **Do NOT commit between iterations** — unstaged is the working state; the user commits
  when the session is done.
- If the user says "revert"/"undo", suggest `git checkout content/cv.pl.ts content/cv.en.ts`
  rather than reconstructing by editing.

Iterate until the user signals done ("looks good", "kończymy").

## Output format

Match the existing CV file structure. `aiItExperience` shape:

```typescript
{
  company: "Project name",
  logo: "/logos/...",
  period: "MM.YYYY" | "MM.YYYY – obecnie" / "MM.YYYY – present",
  details: ["context line 1", "context line 2"],
  bullets: ["Bullet 1", "Bullet 2"],
  techStack: "Tech1, Tech2, Tech3",
  aiTool: "Claude Code" | "Cursor" | ...,
  status: "status description",
}
```

Older `itExperience` is similar but may lack `aiTool` and vary otherwise — read existing
entries to match the exact target pattern.

## Reference files

Read these on demand during the workflow — they are pointed to from the phases above, not
auto-loaded:

- `references/STYLE_GUIDE.md` — language and style rules (PL/EN), and the canonical
  **Length discipline** section.
- `references/BASELINE_VS_SENIOR.md` — how to categorize achievements (Phase 4).
- `references/EXAMPLES_OF_MISTAKES.md` — anti-patterns from real iterations (Phase 6).
- `references/DIALOG_GATE.md` — sibling-scan and repo-selection widget mechanics (Phase 0
  Question 1).
- `references/AUTHORSHIP_GATE.md` — per-path blame gate mechanics, identity-set setup, and
  PARTIAL framing (Phase 2.5).
- `references/INVENTORY_TEMPLATE.md` — inventory file template, path convention, and
  techStack-revision / duplicate-warning formats.
- `references/PUBLIC_INVENTORY.md` — redacted public-safe inventory: strip/keep rules, prose
  format, path, and the review-first safety stamp (Phase 7 / Phase 8).
- `references/DISCOVERY_COMPLETENESS.md` — the inventory-size sniff test + `Explore`
  feature-discovery subagent (Phase 3) and the category-mix check (Phase 6).
- `scripts/analyze_git.py` — git/PR metrics (`--author` repeatable, identity rollup) and the
  `--paths` authorship gate; `scripts/scan_siblings.py` — sibling discovery.

---

**Current version: 0.5.0.** See `CHANGELOG.md` for version history.
