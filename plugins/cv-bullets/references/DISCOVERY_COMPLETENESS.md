# Discovery completeness

Two safeguards against the worst failure mode — a **silently missed contribution**. A
wrong bullet you catch on review; a bullet that was never written you don't. The first
guard widens the inventory *before* composition; the second catches categorical blind
spots *after* it. Neither is a quota: both look for **real** missed work, never invent
items to hit a number.

## 1. Inventory-size sniff test (end of Phase 3)

Before moving the inventory to categorization, check it isn't suspiciously thin for how
long the engagement ran.

**Estimate the engagement length — from the user's own activity, not the repo's.** The
headline `Period: start → end` is computed over *all* commits in range, not the user's, so
on a repo that predates the user joining (or outlived their leaving) it overstates the
engagement and inflates the floor below. Lead with user-scoped signals instead:
- **`Active days (with commits)`** — distinct days the user committed (user-scoped whenever
  `--author` is set, which it always is here). The reality check on *how much* they worked.
- **The user's own commit span** — bound the run to the project window with `--since` /
  `--until` (Phase 2 already does this) so `Period` reflects the user's engagement, or read
  their first/last commit directly.

Convert the user-scoped span to active years. If that span is long but `Active days` is
small (e.g. a two-year window with 15 active days), it's a light engagement with a long
calendar tail — scale the floor down accordingly.

**Expectation band: ≈ 3–5 inventory candidates per active year.** A one-year engagement
that surfaced 2 candidates, or a two-year one that surfaced 3, is under the floor — the
Phase 2 scan likely walked past whole subsystems.

**Trigger.** If the inventory is *much* smaller than the low end of the band (roughly: at
or below half of `3 × years`), dispatch a feature-discovery subagent (below) before
Phase 4. If it's merely at the low end, a second manual pass over unread directories is
usually enough.

## The feature-discovery subagent (the Explore pattern)

`Explore` is a **built-in Claude Code agent type** (invoked via the `Agent` tool with
`subagent_type: "Explore"`) — read-only, built for broad fan-out searches, returns a
conclusion rather than file dumps. It is **not** part of this skill and needs no setup.

Why a subagent rather than scanning inline:
- **Less biased** — the main context already knows which bullets it wants, so it scans for
  confirmation. A fresh subagent given a neutral prompt enumerates what's *there*.
- **Protects context** — it reads excerpts, not whole files, and hands back only the list,
  so the main context stays clean for composition.

Give it a **neutral** prompt — describe the search, not the bullets you're hoping for:

> "List every distinct feature, subsystem, or significant change in the repo at `<path>`
> authored by `<git_author_pattern>`. For each, give a one-line description and the
> files/dirs that implement it. Enumerate broadly; do not judge importance or filter."

For multi-repo projects, point it at each repo (or run one subagent per repo).

**After it returns:**
1. Fold only genuinely-new items into the inventory (drop what's already there).
2. Run every new path through the **Phase 2.5 authorship gate** like any other candidate —
   subagent findings are *not* exempt; an Explore hit can still come back SKIP.

**Fallback.** If the `Explore` agent type isn't available in the current environment, do
the broad scan inline in the main context instead — list unread top-level dirs and read
into the ones the Phase 2 pass skipped. Note that this spends main-context budget; it's the
degraded path, not the default.

## 2. Category-mix check (end of Phase 6)

After self-review, sort the surviving bullets into three buckets:
- **feature** — new user- or system-facing capability
- **refactor** — restructuring existing code (re-architecture, migrations, modularization)
- **maintenance** — upkeep: bugfixes, dependency bumps, config, test/CI plumbing

**If 3+ bullets cluster in one bucket** (and the other buckets are near-empty), the set has
probably under-sampled the others — all-feature bullets tend to skip the hard refactor that
made the features possible; all-maintenance bullets miss the capability actually shipped.
The skew is **especially** suspect on engagements longer than a year, where a real
contribution almost always spans more than one bucket.

**Action:** treat it as a prompt to look again — re-scan the thin buckets in the inventory
(or dispatch the subagent above scoped to them). Do **not** force balance by promoting weak
items; if the work genuinely was all in one bucket, keep the skew and say so. This guards
breadth of *kind*, the way the Phase 3 sniff test guards breadth of *count*.
