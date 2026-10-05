#!/usr/bin/env python3
"""
analyze_git.py — Git history analysis for CV bullets skill.

Outputs metrics useful for CV self-assessment:
- Total commits in period (or all-time)
- Author breakdown (user vs others, % share)
- Identity rollup (every name/email variant you commit under, with counts)
- Conventional commit type counts
- Quality ratios (feat:fix, refactor+test+perf as % of total)
- Test commit ratio (% touching test files)
- Average commit size (lines changed)
- Active days in period

It also provides an **authorship gate** (--paths): for each file/folder, it reports your
git-blame share and whether you created it, classifying it OWN / PARTIAL / SKIP so the
skill never bullets work that isn't verifiably yours.

Usage:
    # History metrics (repeat --author for every name/email variant you commit under):
    python analyze_git.py [--author "Name"] [--author "gh-handle"] [--since YYYY-MM-DD] [--until YYYY-MM-DD]
    # Authorship gate over specific paths:
    python analyze_git.py --author "Name" --author "gh-handle" --paths src/ai/ app/_layout.tsx

The script runs in the current directory (assumed to be a git repository).
"""

import argparse
import os
import re
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import datetime

# Authorship-gate thresholds (your blame share of a path's lines)
OWN_THRESHOLD = 50.0       # >= this, or you created the file → OWN
PARTIAL_THRESHOLD = 20.0   # >= this and < OWN → PARTIAL (bullet only with co-built framing)
                           # < PARTIAL_THRESHOLD → SKIP (do not bullet)
MAX_FILES_PER_PATH = 400   # cap blame work per directory; truncation is reported, never silent


CONVENTIONAL_TYPES = [
    "feat", "fix", "refactor", "test", "docs", "chore",
    "perf", "style", "ci", "build", "revert"
]

TEST_FILE_PATTERNS = [
    r"\.test\.",
    r"\.spec\.",
    r"/__tests__/",
    r"/tests?/",
    r"Tests?\.kt$",
    r"Tests?\.swift$",
    r"Test\.java$",
]


def run_git(args):
    """Run a git command and return stdout. Returns empty string on error."""
    try:
        result = subprocess.run(
            ["git"] + args,
            capture_output=True,
            text=True,
            check=False,
        )
        return result.stdout.strip()
    except FileNotFoundError:
        print("ERROR: git not found. Are you in a git repository?", file=sys.stderr)
        sys.exit(1)


def is_git_repo():
    out = run_git(["rev-parse", "--is-inside-work-tree"])
    return out == "true"


def get_commits(since=None, until=None):
    """Get list of commits as tuples: (sha, author_name, author_email, date, subject)."""
    args = [
        "log",
        "--pretty=format:%H|%an|%ae|%ad|%s",
        "--date=short",
    ]
    if since:
        args.append(f"--since={since}")
    if until:
        args.append(f"--until={until}")

    output = run_git(args)
    if not output:
        return []

    commits = []
    for line in output.split("\n"):
        parts = line.split("|", 4)
        if len(parts) == 5:
            commits.append({
                "sha": parts[0],
                "author_name": parts[1],
                "author_email": parts[2],
                "date": parts[3],
                "subject": parts[4],
            })
    return commits


def get_commit_stats(sha):
    """Get insertions/deletions and changed files for a commit."""
    output = run_git(["show", "--stat", "--format=", sha])
    if not output:
        return {"insertions": 0, "deletions": 0, "files": []}

    files = []
    insertions = 0
    deletions = 0

    for line in output.split("\n"):
        line = line.strip()
        if not line:
            continue
        # File line: "path/to/file | NN +++---"
        if "|" in line and not line.startswith(" "):
            file_part = line.split("|")[0].strip()
            files.append(file_part)
        # Summary line: " 3 files changed, 45 insertions(+), 12 deletions(-)"
        match = re.match(r"\s*\d+ files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?", line)
        if match:
            insertions = int(match.group(1) or 0)
            deletions = int(match.group(2) or 0)

    return {"insertions": insertions, "deletions": deletions, "files": files}


def parse_conventional_type(subject):
    """Extract conventional commit type from subject, e.g. 'feat: add login' -> 'feat'."""
    match = re.match(r"^(\w+)(?:\([^)]+\))?!?:\s", subject)
    if match:
        commit_type = match.group(1).lower()
        if commit_type in CONVENTIONAL_TYPES:
            return commit_type
    return None


def is_test_file(filepath):
    """Check if a file path looks like a test file."""
    for pattern in TEST_FILE_PATTERNS:
        if re.search(pattern, filepath):
            return True
    return False


def matches_any(name, email, patterns):
    """True if any pattern is a case-insensitive substring of the name or email.

    Substring (not regex) keeps multiple `--author "<name>"` / `--author "<handle>"`
    patterns behaving predictably; a GitHub-noreply address
    (<account-id>+<handle>@users.noreply.github.com) matches whenever you pass the handle
    as one of the patterns.
    """
    if not patterns:
        return False
    n = (name or "").lower()
    e = (email or "").lower()
    return any(p.lower() in n or p.lower() in e for p in patterns)


def matches_author(commit, patterns):
    """Check if a commit's author matches any of the identity patterns."""
    return matches_any(commit["author_name"], commit["author_email"], patterns)


def analyze(commits, target_authors):
    """Run full analysis on the list of commits. `target_authors` is a list of patterns."""
    total_commits = len(commits)
    if total_commits == 0:
        return None

    # Author breakdown
    author_counts = Counter(c["author_name"] for c in commits)
    user_commits = [c for c in commits if matches_author(c, target_authors)] if target_authors else []
    user_commit_count = len(user_commits)
    user_share = (user_commit_count / total_commits * 100) if total_commits else 0

    # Identity rollup: every (name, email) variant the patterns matched, with counts.
    # Surfaces e.g. a GitHub-noreply variant so the user can spot a missing pattern.
    identity_variants = Counter((c["author_name"], c["author_email"]) for c in user_commits)

    # Conventional commit breakdown (for ALL commits)
    type_counts = Counter()
    untyped_count = 0
    for c in commits:
        t = parse_conventional_type(c["subject"])
        if t:
            type_counts[t] += 1
        else:
            untyped_count += 1

    # Conventional commit breakdown for USER commits only
    user_type_counts = Counter()
    user_untyped_count = 0
    for c in user_commits:
        t = parse_conventional_type(c["subject"])
        if t:
            user_type_counts[t] += 1
        else:
            user_untyped_count += 1

    # Compute ratios (use user commits if specified, else all)
    relevant_commits = user_commits if target_authors else commits
    relevant_type_counts = user_type_counts if target_authors else type_counts
    relevant_total = len(relevant_commits)

    feat_count = relevant_type_counts.get("feat", 0)
    fix_count = relevant_type_counts.get("fix", 0)
    refactor_count = relevant_type_counts.get("refactor", 0)
    test_count = relevant_type_counts.get("test", 0)
    perf_count = relevant_type_counts.get("perf", 0)

    feat_fix_ratio = (feat_count / fix_count) if fix_count > 0 else None
    quality_pct = (
        (refactor_count + test_count + perf_count) / relevant_total * 100
        if relevant_total > 0 else 0
    )

    # Test file ratio (commits touching test files) — only for user if specified
    print("Analyzing per-commit stats (this may take a moment)...", file=sys.stderr)
    commits_touching_tests = 0
    total_insertions = 0
    total_deletions = 0
    active_dates = set()

    sample = relevant_commits[:500]  # cap analysis to 500 commits to keep it fast
    for c in sample:
        stats = get_commit_stats(c["sha"])
        if any(is_test_file(f) for f in stats["files"]):
            commits_touching_tests += 1
        total_insertions += stats["insertions"]
        total_deletions += stats["deletions"]
        active_dates.add(c["date"])

    sample_size = len(sample)
    test_commit_pct = (commits_touching_tests / sample_size * 100) if sample_size > 0 else 0
    avg_commit_size = ((total_insertions + total_deletions) / sample_size) if sample_size > 0 else 0
    active_days = len(active_dates)

    return {
        "total_commits": total_commits,
        "target_authors": target_authors,
        "identity_variants": [
            {"name": n, "email": e, "count": ct}
            for (n, e), ct in identity_variants.most_common()
        ],
        "user_commit_count": user_commit_count,
        "user_share_pct": user_share,
        "author_breakdown": dict(author_counts.most_common(10)),
        "type_counts_all": dict(type_counts),
        "type_counts_user": dict(user_type_counts) if target_authors else None,
        "untyped_count_all": untyped_count,
        "untyped_count_user": user_untyped_count if target_authors else None,
        "feat_fix_ratio": feat_fix_ratio,
        "feat_count": feat_count,
        "fix_count": fix_count,
        "quality_pct": quality_pct,
        "refactor_count": refactor_count,
        "test_count": test_count,
        "perf_count": perf_count,
        "test_commit_pct": test_commit_pct,
        "avg_commit_size": avg_commit_size,
        "active_days": active_days,
        "sample_size": sample_size,
        "prs": None,  # Filled in by main() after gh check. None = unavailable.
        "date_range": (
            min(c["date"] for c in commits) if commits else None,
            max(c["date"] for c in commits) if commits else None,
        ),
    }


def get_pr_stats(since=None, until=None):
    """
    Fetch PR statistics from GitHub via `gh` CLI.

    Returns dict with PR counts (authored: open/closed/merged/total), or None
    if gh is not available, repo is not on GitHub, or auth fails.

    Silent degradation: this is bonus data. If it doesn't work, return None
    and let the caller carry on without PR stats — git metrics are still useful.
    """
    # Check 1: is gh installed?
    try:
        result = subprocess.run(
            ["gh", "--version"],
            capture_output=True, text=True, check=False, timeout=5
        )
        if result.returncode != 0:
            return None
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None

    # Check 2: is current repo on GitHub?
    remote_url = run_git(["remote", "get-url", "origin"])
    if not remote_url:
        return None
    # Match github.com (https or ssh) and enterprise GitHub hosts
    is_github = (
        "github.com" in remote_url
        or "github.io" in remote_url
        # Enterprise hosts are harder to detect statically — let gh auth status decide
    )
    # If not obviously github.com, still try gh — it might be enterprise.
    # gh will return non-zero if it can't talk to the host.

    # Check 3: is gh authenticated?
    try:
        auth = subprocess.run(
            ["gh", "auth", "status"],
            capture_output=True, text=True, check=False, timeout=5
        )
        if auth.returncode != 0:
            return None
    except subprocess.TimeoutExpired:
        return None

    # Fetch PRs. Use `gh pr list --author @me` for authored-by-current-user.
    # Pull all states (open, closed, merged) and bucket them.
    pr_data = {}
    for state in ["open", "closed", "merged"]:
        try:
            result = subprocess.run(
                ["gh", "pr", "list",
                 "--author", "@me",
                 "--state", state,
                 "--limit", "1000",
                 "--json", "number,createdAt,mergedAt,title"],
                capture_output=True, text=True, check=False, timeout=20
            )
            if result.returncode != 0:
                # Specific state failed — e.g. permissions issue. Skip silently.
                return None
            import json as _json
            prs = _json.loads(result.stdout) if result.stdout.strip() else []
        except (subprocess.TimeoutExpired, ValueError):
            return None

        # Filter by date range if provided
        if since or until:
            filtered = []
            for pr in prs:
                created = pr.get("createdAt", "")[:10]  # YYYY-MM-DD
                if since and created < since:
                    continue
                if until and created > until:
                    continue
                filtered.append(pr)
            prs = filtered

        pr_data[state] = prs

    # Note: `gh pr list --state closed` includes merged in some versions.
    # Deduplicate by PR number across buckets.
    seen = {}
    for state in ["merged", "closed", "open"]:
        for pr in pr_data[state]:
            num = pr["number"]
            if num not in seen:
                seen[num] = state

    counts = Counter(seen.values())
    return {
        "total": len(seen),
        "merged": counts.get("merged", 0),
        "closed": counts.get("closed", 0),
        "open": counts.get("open", 0),
        "remote_url": remote_url,
    }



# ---------------------------------------------------------------------------
# Authorship gate (--paths)
# ---------------------------------------------------------------------------

def list_tracked_files(path):
    """Tracked files under a path (the path itself if it's a single tracked file)."""
    out = run_git(["ls-files", "-z", "--", path])
    if not out:
        return []
    return [f for f in out.split("\0") if f]


def build_ignore_args(manual_revs):
    """Blame ignore-revs args: auto .git-blame-ignore-revs at repo root + manual --ignore-rev.

    Mass-reformatting/rename commits (Prettier, lint --fix) rewrite lines and steal blame
    onto their author. Excluding such a commit re-attributes its lines to the prior author.
    """
    args = []
    root = run_git(["rev-parse", "--show-toplevel"])
    if root:
        p = os.path.join(root, ".git-blame-ignore-revs")
        if os.path.isfile(p):
            args += ["--ignore-revs-file", p]
    for rev in (manual_revs or []):
        args += ["--ignore-rev", rev]
    return args


def blame_share(filepath, patterns, ignore_args=None):
    """Your blame share of a file at HEAD. Returns (your_lines, total_lines).

    --line-porcelain repeats the author headers for EVERY line (unlike --porcelain),
    so each '\\t'-prefixed source line is reliably preceded by its own author/author-mail.
    -w ignores whitespace-only changes; ignore_args excludes named reformatting commits.
    """
    out = run_git(
        ["blame", "-w", "--line-porcelain"] + (ignore_args or []) + ["HEAD", "--", filepath]
    )
    if not out:
        return (0, 0)
    your = total = 0
    name = email = ""
    for line in out.split("\n"):
        if line.startswith("author "):
            name = line[len("author "):]
        elif line.startswith("author-mail "):
            email = line[len("author-mail "):].strip().strip("<>")
        elif line.startswith("\t"):
            total += 1
            if matches_any(name, email, patterns):
                your += 1
            name = email = ""
    return (your, total)


def created_by_you(filepath, patterns):
    """True/False if you authored the commit that first added this file; None if unknown.

    --follow tracks across renames; --diff-filter=A keeps only additions. git log is
    newest-first, so the last line is the original creation.
    """
    out = run_git(
        ["log", "--follow", "--diff-filter=A", "--format=%an%x1f%ae", "--", filepath]
    )
    if not out:
        return None
    name, _, email = out.split("\n")[-1].partition("\x1f")
    return matches_any(name, email, patterns)


def gate_one_path(path, patterns, ignore_args=None):
    """Classify a single file or directory as OWN / PARTIAL / SKIP by blame share."""
    is_dir = os.path.isdir(path)
    files = list_tracked_files(path)
    truncated = len(files) > MAX_FILES_PER_PATH
    if truncated:
        files = sorted(files)[:MAX_FILES_PER_PATH]

    your = total = 0
    for f in files:
        y, t = blame_share(f, patterns, ignore_args)
        your += y
        total += t

    # Creator detection is reliable only for a single file (--follow rejects dirs).
    created = created_by_you(path, patterns) if (not is_dir and files) else None

    share = (your / total * 100) if total else 0.0
    # Creator-ship is the stronger OWN signal — it wins even for a file with no blameable
    # lines (e.g. one you created that's now empty), so it's checked before total == 0.
    if created or share >= OWN_THRESHOLD:
        verdict = "OWN"
    elif total == 0:
        verdict = "UNTRACKED"  # nothing tracked here / no blameable lines, and not yours
    elif share >= PARTIAL_THRESHOLD:
        verdict = "PARTIAL"
    else:
        verdict = "SKIP"

    return {
        "path": path,
        "is_dir": is_dir,
        "created_by_you": created,
        "your_lines": your,
        "total_lines": total,
        "share_pct": share,
        "files_scanned": len(files),
        "truncated": truncated,
        "verdict": verdict,
    }


def run_authorship_gate(paths, patterns, ignore_args=None):
    """Classify each path. Returns a list of result dicts."""
    return [gate_one_path(p, patterns, ignore_args) for p in paths]


def format_gate_report(results, patterns, ignore_args=None):
    """Render the authorship gate as human-readable text."""
    lines = []
    lines.append("=" * 60)
    lines.append("Authorship gate")
    lines.append("=" * 60)
    lines.append(f"Identity: {', '.join(patterns)}")
    lines.append(f"Thresholds: OWN >= {OWN_THRESHOLD:.0f}% or creator | "
                 f"PARTIAL >= {PARTIAL_THRESHOLD:.0f}% and < {OWN_THRESHOLD:.0f}% | "
                 f"SKIP < {PARTIAL_THRESHOLD:.0f}%")
    lines.append("Blame: -w (ignore whitespace)" +
                 (f", ignoring revs: {' '.join(ignore_args)}" if ignore_args
                  else " (no reformatting commits excluded — see KNOWN LIMITATION below)"))
    lines.append("")
    for r in results:
        kind = "dir " if r["is_dir"] else "file"
        lines.append(f"[{r['verdict']:<9}] ({kind}) {r['path']}")
        if r["total_lines"]:
            lines.append(f"             your lines: {r['your_lines']}/{r['total_lines']} "
                         f"({r['share_pct']:.1f}%)")
        else:
            lines.append("             your lines: 0/0 (nothing tracked / blameable)")
        if r["created_by_you"] is not None:
            lines.append(f"             created by you: {'yes' if r['created_by_you'] else 'no'}")
        if r["is_dir"]:
            note = f"             files scanned: {r['files_scanned']}"
            if r["truncated"]:
                note += f" (capped at {MAX_FILES_PER_PATH} — share is over the sampled files only)"
            lines.append(note)
        lines.append("")
    lines.append("=" * 60)
    lines.append("Gate rule (see references/AUTHORSHIP_GATE.md):")
    lines.append("  OWN     → bullet freely.")
    lines.append("  PARTIAL → bullet only with explicit co-built framing.")
    lines.append("  SKIP    → do not bullet, even if recent or you remember touching it.")
    lines.append("")
    lines.append("KNOWN LIMITATION: blame shows whose lines these are NOW, not who originated")
    lines.append("the feature — a repo-wide formatter or heavy refactor can read OWN for a")
    lines.append("teammate's work. Exclude formatting commits (--ignore-rev); for refactors,")
    lines.append("match the verb (re-architected ≠ built). See AUTHORSHIP_GATE.md.")
    lines.append("=" * 60)
    return "\n".join(lines)


def format_report(stats):
    """Render analysis as human-readable text."""
    if not stats:
        return "No commits found in the specified range."

    lines = []
    lines.append("=" * 60)
    lines.append("Git History Analysis")
    lines.append("=" * 60)
    lines.append("")

    start, end = stats["date_range"]
    lines.append(f"Period: {start} → {end}")
    lines.append(f"Total commits: {stats['total_commits']}")
    lines.append("")

    if stats["target_authors"]:
        patterns = ", ".join(f"'{p}'" for p in stats["target_authors"])
        lines.append(f"Author filter: {patterns}")
        lines.append(f"  Your commits: {stats['user_commit_count']} ({stats['user_share_pct']:.1f}% of total)")
        lines.append("")

        variants = stats.get("identity_variants") or []
        lines.append("Identity rollup (variants matched by your patterns):")
        if variants:
            for v in variants:
                lines.append(f"  {v['name']} <{v['email']}>: {v['count']}")
        else:
            lines.append("  (none — no commits matched your patterns)")
        lines.append("  Tip: web/merge-UI commits use <id>+<handle>@users.noreply.github.com.")
        lines.append("       If the count looks low, re-run with an extra --author \"<handle>\".")
        lines.append("")

    lines.append("Top contributors:")
    for author, count in stats["author_breakdown"].items():
        pct = count / stats["total_commits"] * 100
        lines.append(f"  {author}: {count} ({pct:.1f}%)")
    lines.append("")

    counts_to_show = stats["type_counts_user"] if stats["target_authors"] else stats["type_counts_all"]
    untyped_to_show = stats["untyped_count_user"] if stats["target_authors"] else stats["untyped_count_all"]
    label_suffix = " (your commits)" if stats["target_authors"] else " (all commits)"

    lines.append(f"Conventional commit breakdown{label_suffix}:")
    total_typed = sum(counts_to_show.values())
    grand_total = total_typed + untyped_to_show
    for ctype in CONVENTIONAL_TYPES:
        count = counts_to_show.get(ctype, 0)
        if count > 0:
            pct = count / grand_total * 100 if grand_total else 0
            lines.append(f"  {ctype}: {count} ({pct:.1f}%)")
    if untyped_to_show > 0:
        pct = untyped_to_show / grand_total * 100 if grand_total else 0
        lines.append(f"  (untyped): {untyped_to_show} ({pct:.1f}%)")
    lines.append("")

    lines.append("Quality metrics:")
    if stats["feat_fix_ratio"] is not None:
        lines.append(f"  feat:fix ratio: {stats['feat_count']}:{stats['fix_count']} = {stats['feat_fix_ratio']:.2f}")
    elif stats["fix_count"] == 0 and stats["feat_count"] > 0:
        lines.append(f"  feat:fix ratio: {stats['feat_count']}:0 (no fixes recorded)")
    lines.append(f"  Quality-focused commits (refactor+test+perf): {stats['quality_pct']:.1f}%")
    lines.append(f"    refactor: {stats['refactor_count']}, test: {stats['test_count']}, perf: {stats['perf_count']}")
    lines.append("")

    lines.append(f"Test coverage signal (sampled {stats['sample_size']} commits):")
    lines.append(f"  Commits touching test files: {stats['test_commit_pct']:.1f}%")
    lines.append("")

    lines.append("Commit size & cadence:")
    lines.append(f"  Average commit size: {stats['avg_commit_size']:.0f} lines changed")
    lines.append(f"  Active days (with commits): {stats['active_days']}")
    lines.append("")

    # PR stats (only if available — None means gh wasn't configured or repo isn't on GitHub)
    if stats.get("prs") is not None:
        prs = stats["prs"]
        lines.append("Pull Requests (authored by you):")
        lines.append(f"  Total authored: {prs['total']}")
        lines.append(f"    merged: {prs['merged']}")
        lines.append(f"    closed (unmerged): {prs['closed']}")
        lines.append(f"    open: {prs['open']}")
        lines.append("")
    else:
        lines.append("Pull Requests: unavailable (gh not configured, not authenticated, or repo not on GitHub)")
        lines.append("")

    lines.append("=" * 60)
    lines.append("Interpretation hints:")
    lines.append("  - feat:fix > 2 = proactive (more features than bugfixes)")
    lines.append("  - feat:fix < 1 = reactive (firefighting mode)")
    lines.append("  - Quality % > 20% = mature engineering discipline")
    lines.append("  - Test commit % > 30% = strong test culture")
    lines.append("  - Avg commit size < 100 = good discipline (small commits)")
    lines.append("  - Avg commit size > 500 = consider smaller commits")
    lines.append("=" * 60)

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Analyze git history for CV bullet generation.")
    parser.add_argument("--author", action="append", dest="authors", metavar="PATTERN",
                        help="Author name/email pattern (substring match). Repeat for every "
                             "variant you commit under, e.g. --author \"Maciej Wojda\" --author \"mwx27\".")
    parser.add_argument("--since", help="Start date (YYYY-MM-DD)")
    parser.add_argument("--until", help="End date (YYYY-MM-DD)")
    parser.add_argument("--paths", nargs="+", metavar="PATH",
                        help="Authorship gate: classify each file/folder as OWN/PARTIAL/SKIP "
                             "by your git-blame share. Requires --author.")
    parser.add_argument("--ignore-rev", action="append", dest="ignore_revs", metavar="SHA",
                        help="Exclude a commit from blame — e.g. a repo-wide formatting/rename "
                             "commit that would otherwise credit you with its rewritten lines. "
                             "Repeatable. A .git-blame-ignore-revs file at the repo root is used "
                             "automatically.")
    parser.add_argument("--json", action="store_true", help="Output as JSON instead of formatted text")
    args = parser.parse_args()

    if not is_git_repo():
        print("ERROR: Not inside a git repository.", file=sys.stderr)
        sys.exit(1)

    authors = args.authors or []

    # Authorship gate mode: classify paths and exit (no history scan needed).
    if args.paths:
        if not authors:
            print("ERROR: --paths requires --author (the gate needs your identity to "
                  "compute blame share).", file=sys.stderr)
            sys.exit(1)
        ignore_args = build_ignore_args(args.ignore_revs)
        results = run_authorship_gate(args.paths, authors, ignore_args)
        if args.json:
            import json
            print(json.dumps(results, indent=2, default=str))
        else:
            print(format_gate_report(results, authors, ignore_args))
        return

    commits = get_commits(since=args.since, until=args.until)
    stats = analyze(commits, authors)

    # Empty range (--since/--until/--author window with no commits) is a normal input.
    if stats is None:
        if args.json:
            import json
            print(json.dumps(None))
        else:
            print(format_report(None))
        return

    # Augment with PR stats from gh (Phase 2 silent skip — None if gh unavailable)
    stats["prs"] = get_pr_stats(since=args.since, until=args.until)

    if args.json:
        import json
        print(json.dumps(stats, indent=2, default=str))
    else:
        print(format_report(stats))


if __name__ == "__main__":
    main()
