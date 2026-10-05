# Authorship Gate — mechanics

Procedural detail for **Phase 2.5** (authorship gate). SKILL.md owns the *intent* (every
bulleted file must be verifiably yours); this file owns the *how*. Read it when you reach
Phase 2.5.

## Why this exists

In projects you joined mid-flight, "exists in the repo and looks custom" ≠ "you built it."
Without a hard per-path check, inventories drift toward bulleting teammates' work —
someone else's translation pipeline, auth flow, error-tracking setup — because it's
recent, sophisticated, and you remember touching the area. The gate replaces *memory* and
*momentum* with *blame evidence*, file by file, before anything reaches composition.

## Step 1 — get your identity set right (prerequisite)

The gate is only as accurate as the identity it matches against. One name pattern is
usually not enough: web-UI merges and squash-merges land under
`<account-id>+<handle>@users.noreply.github.com`, whose local part is your GitHub
**handle**, not your display name. Matching only `"Maciej Wojda"` silently misses those
and *undercounts your share* — the gate then rejects real work.

Run the history analysis first and read the **Identity rollup** section:

```bash
python3 ~/.claude/skills/cv-bullets/scripts/analyze_git.py --author "<pattern1>" --author "<pattern2>"
```

Pass one `--author` per variant from `config.md`'s `git_author_pattern` (comma-separated
there → one flag each). If the rollup shows fewer commits than you expect, or a top
contributor that is actually you under a different email, add that variant as another
`--author` and re-run. Carry the **same full set of patterns** into every gate call below.

## Step 2 — gate every path you intend to name

For each file or folder an inventory item would cite:

```bash
python3 ~/.claude/skills/cv-bullets/scripts/analyze_git.py \
  --author "<pattern1>" --author "<pattern2>" \
  --paths src/ai/transport.ts src/webview/ app/_layout.tsx
```

Pass all paths in one call. Each path is classified by your **git-blame share** of its
current lines (at HEAD) plus, for single files, whether you authored the commit that first
added it (`--diff-filter=A --follow`):

| Verdict | Condition | What you may write |
|---------|-----------|--------------------|
| **OWN** | you created the file, OR blame share ≥ 50% | Bullet freely. |
| **PARTIAL** | blame share 20–49% | Bullet **only** with explicit co-built framing. |
| **SKIP** | blame share < 20% | **Do not bullet** — even if recent, sophisticated, or you remember touching it. |
| **UNTRACKED** | nothing tracked / no blameable lines | Not evidence — don't bullet on this path alone. |

These thresholds live in `analyze_git.py` (`OWN_THRESHOLD`, `PARTIAL_THRESHOLD`); the gate
report restates them in its header.

**This verdict overrides earlier categorization.** A path you labelled FLAGSHIP/SENIOR in
Phase 4 that comes back SKIP does not ship, regardless of how strong the work is — it
isn't yours to claim. The gate runs *before* composition for exactly this reason.

## Directories vs files

- **File** → blame share of its lines + creator check.
- **Directory** → aggregate blame across all tracked files under it (`git ls-files`), summed
  lines. No creator check (git's `--follow` only works on a single file), so a folder
  reaches OWN only on the ≥ 50% share rule.
- Large directories are capped at `MAX_FILES_PER_PATH` (400) files; when capped, the report
  says so and the share covers only the sampled files. If a capped folder lands near a
  threshold, gate its key sub-paths individually rather than trusting the sampled share.

## PARTIAL framing

A PARTIAL path is real but shared. Frame it so the claim matches the evidence — never imply
sole authorship:

- "Co-built the X pipeline" (not "Built the X pipeline")
- "Majority author of the auth refactor within a shared backend"
- "Contributed the Y layer to the team's Z system"

If you can't honestly narrow the claim to your slice, drop it. A vague shared-credit bullet
is weaker than one fewer bullet.

## Blind spots — reformatting and refactors (KNOWN LIMITATION)

`git blame` answers *"whose lines are these now"*, not *"who authored the substance"*. Two
situations break that equivalence, and the gate cannot fully detect either on its own:

**Mass reformatting (Prettier, `lint --fix`, mass-rename).** A commit that rewrites every
line steals blame onto its author. If you joined late and ran a repo-wide formatter, the
gate will show OWN for files you only reformatted. Mitigation, in order of strength:

- The gate always runs `git blame -w`, which discounts whitespace-only changes — but a
  formatter also flips quotes, adds trailing commas/semicolons, and rewraps lines, and `-w`
  does **not** save those. So `-w` alone is partial.
- For full coverage, exclude the formatting commit so its lines re-attribute to the prior
  author: add its SHA to a `.git-blame-ignore-revs` file at the repo root (auto-detected),
  or pass `--ignore-rev <sha>` (repeatable). The gate header prints which revs it excluded.
- When you know you ran such a tool, find the commit (`git log --oneline --author="<you>"
  --grep -iE "prettier|format|lint|reformat"`) and feed it to `--ignore-rev` before trusting
  any OWN verdict.

**Heavy refactors.** Refactoring genuinely rewrites lines, so a file you restructured will
read OWN — and that is *correct for a refactor bullet*. The trap is letting it become an
origination claim. The gate confirms the lines are yours; it does **not** confirm you built
the underlying feature. Match the verb to the contribution: "Re-architected / migrated X"
(yours), not "Built X" (someone else's feature you reshaped). See STYLE_GUIDE.md → verb
choice. There is no script fix here — blame cannot distinguish "rewrote at refactor" from
"wrote from scratch"; the safeguard is honest framing plus your own judgment.

In both cases the gate raises the floor (it stops outright fabrication) but the user remains
the final authority on whether an OWN verdict reflects real authorship.

## The inventory is a truth document

Only items that survive this gate go into the inventory. **Items rejected during the gate
are not written down** — not even in a "considered but cut" note. The inventory is the
document the user trusts for interview prep; it records what is verifiably theirs, not the
journey of what was considered and dropped. (This is why the inventory template has no
audit-trail / "removed during review" section.)
