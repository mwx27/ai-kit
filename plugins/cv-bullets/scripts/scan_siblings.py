#!/usr/bin/env python3
"""
scan_siblings.py — Discover sibling git repositories and identify the user's contributions.

For the CV-bullets skill: when generating bullets for a project, related work may live in
sibling repositories (backend, lambdas, smart contracts, landing pages, admin panels, etc.).
This script scans sibling directories, identifies git repos, and reports which ones the user
has contributed to.

Output lists the contributor sibling repos for the skill's dialog gate to present for
selection. How they're shown to the user (multi-select widget, cases, fallbacks) is owned
by SKILL.md Question 1 / references/DIALOG_GATE.md — this script only reports the data.

Usage:
    python3 scan_siblings.py [--author "Pattern"] [--min-commits N] [--parent PATH] [--json]

By default:
    - Parent directory: parent of pwd (i.e. siblings of current repo)
    - Author pattern: read from `git config user.name` in current repo
    - Minimum commits to count as contributor: 1
    - Output format: human-readable text
"""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path


def run_git(args, cwd=None):
    """Run a git command and return stdout. Returns empty string on error."""
    try:
        result = subprocess.run(
            ["git"] + args,
            capture_output=True,
            text=True,
            check=False,
            cwd=cwd,
        )
        return result.stdout.strip()
    except FileNotFoundError:
        print("ERROR: git not found.", file=sys.stderr)
        sys.exit(1)


def is_git_repo(path):
    """Check if a directory is a git repository (has .git directory or file)."""
    git_dir = Path(path) / ".git"
    return git_dir.exists()


def get_default_author_pattern(repo_path):
    """Read the user.name from the current repo's git config."""
    name = run_git(["config", "user.name"], cwd=repo_path)
    return name if name else None


def author_matches(name, email, pattern):
    """Case-insensitive substring match on author name or email.

    Mirrors analyze_git.py's matches_author so the same --author value behaves identically
    across both scripts. We filter in Python rather than via `git log --author=`, which git
    treats as a regex (metacharacters like . + ( | would silently over-/under-match).
    """
    p = pattern.lower()
    return p in name.lower() or p in email.lower()


def count_user_commits(repo_path, author_pattern):
    """Count commits whose author matches the pattern (substring, case-insensitive)."""
    if not author_pattern:
        return 0
    # --all across all branches, --no-merges to skip merge commits; filter in Python.
    output = run_git(
        ["log", "--all", "--no-merges", "--pretty=format:%an%x1f%ae"],
        cwd=repo_path,
    )
    if not output:
        return 0
    count = 0
    for line in output.split("\n"):
        name, _, email = line.partition("\x1f")
        if author_matches(name, email, author_pattern):
            count += 1
    return count


def count_total_commits(repo_path):
    """Count total commits in the repository (all branches, excluding merges)."""
    output = run_git(
        ["log", "--all", "--no-merges", "--pretty=format:%H"],
        cwd=repo_path,
    )
    if not output:
        return 0
    return len(output.split("\n"))


def get_last_user_commit_date(repo_path, author_pattern):
    """Get the date of the user's last commit (YYYY-MM-DD), or None.

    Uses the same substring matcher as count_user_commits. git log is newest-first, so the
    first matching line is the latest commit.
    """
    if not author_pattern:
        return None
    output = run_git(
        ["log", "--all", "--no-merges", "--pretty=format:%ad%x1f%an%x1f%ae", "--date=short"],
        cwd=repo_path,
    )
    if not output:
        return None
    for line in output.split("\n"):
        date, _, rest = line.partition("\x1f")
        name, _, email = rest.partition("\x1f")
        if author_matches(name, email, author_pattern):
            return date
    return None


def analyze_sibling(sibling_path, author_pattern):
    """Analyze a single sibling directory. Returns a dict with results."""
    name = sibling_path.name
    is_git = is_git_repo(sibling_path)

    if not is_git:
        return {
            "name": name,
            "path": str(sibling_path),
            "is_git_repo": False,
            "user_commits": 0,
            "total_commits": 0,
            "share_pct": 0.0,
            "last_user_commit": None,
        }

    user_commits = count_user_commits(sibling_path, author_pattern)
    total_commits = count_total_commits(sibling_path)
    share_pct = (user_commits / total_commits * 100) if total_commits > 0 else 0.0
    last_commit = get_last_user_commit_date(sibling_path, author_pattern)

    return {
        "name": name,
        "path": str(sibling_path),
        "is_git_repo": True,
        "user_commits": user_commits,
        "total_commits": total_commits,
        "share_pct": share_pct,
        "last_user_commit": last_commit,
    }


def scan_parent_directory(parent_path, author_pattern, current_repo_path):
    """Scan all subdirectories of parent_path for sibling git repos."""
    parent = Path(parent_path).resolve()
    current = Path(current_repo_path).resolve()

    if not parent.exists() or not parent.is_dir():
        print(f"ERROR: Parent directory not found or not a directory: {parent}", file=sys.stderr)
        sys.exit(1)

    siblings = []
    for entry in sorted(parent.iterdir()):
        # Skip the current repo itself
        if entry.resolve() == current:
            continue
        # Skip non-directories and hidden directories
        if not entry.is_dir() or entry.name.startswith("."):
            continue
        siblings.append(analyze_sibling(entry, author_pattern))

    return siblings


def categorize_siblings(siblings, min_commits):
    """Group siblings into contributor / non-contributor / non-git."""
    contributors = []
    non_contributors = []
    non_git = []

    for s in siblings:
        if not s["is_git_repo"]:
            non_git.append(s)
        elif s["user_commits"] >= min_commits:
            contributors.append(s)
        else:
            non_contributors.append(s)

    # Sort contributors by user_commits descending
    contributors.sort(key=lambda x: x["user_commits"], reverse=True)
    return contributors, non_contributors, non_git


def format_text_report(parent_path, author_pattern, siblings, min_commits):
    """Render scan results as human-readable text."""
    lines = []
    lines.append("=" * 70)
    lines.append("Sibling Repositories Scan")
    lines.append("=" * 70)
    lines.append("")
    lines.append(f"Parent directory: {parent_path}")
    lines.append(f"Author pattern: '{author_pattern}'")
    lines.append(f"Minimum commits to count as contributor: {min_commits}")
    lines.append("")

    if not siblings:
        lines.append("No sibling directories found.")
        lines.append("=" * 70)
        return "\n".join(lines)

    contributors, non_contributors, non_git = categorize_siblings(siblings, min_commits)

    git_count = len(contributors) + len(non_contributors)
    lines.append(
        f"Found {len(siblings)} sibling directories ({git_count} git repos, {len(non_git)} non-git)."
    )
    lines.append("")

    if contributors:
        lines.append(f"Repos where YOU CONTRIBUTED (≥{min_commits} commit{'s' if min_commits != 1 else ''}):")
        for s in contributors:
            last = s["last_user_commit"] or "n/a"
            lines.append(
                f"  ✓ {s['name']:<35} "
                f"{s['user_commits']:>4} commits (you) / "
                f"{s['total_commits']:>4} total "
                f"({s['share_pct']:>5.1f}%)  "
                f"last: {last}"
            )
        lines.append("")

    if non_contributors:
        lines.append("Repos where you are NOT a significant contributor:")
        for s in non_contributors:
            lines.append(
                f"  ✗ {s['name']:<35} "
                f"{s['user_commits']:>4} commits (you) / "
                f"{s['total_commits']:>4} total"
            )
        lines.append("")

    if non_git:
        lines.append("Non-git directories (skipped):")
        for s in non_git:
            lines.append(f"  - {s['name']}")
        lines.append("")

    lines.append("=" * 70)
    lines.append("Next step: hand these contributor repos to the skill's dialog gate for")
    lines.append("selection. How to present them (widget cases, fallbacks) is owned by")
    lines.append("SKILL.md Question 1 / references/DIALOG_GATE.md.")
    lines.append("=" * 70)

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="Scan sibling directories for git repos and the user's contributions.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--author",
        help="Author name/email pattern (substring match, case-insensitive). "
        "If not provided, reads from `git config user.name` in current repo.",
    )
    parser.add_argument(
        "--min-commits",
        type=int,
        default=1,
        help="Minimum commits to count as contributor (default: 1)",
    )
    parser.add_argument(
        "--parent",
        help="Parent directory to scan (default: parent of pwd)",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output as JSON instead of human-readable text",
    )
    args = parser.parse_args()

    # Determine current repo path
    current_repo = Path(os.getcwd()).resolve()
    if not is_git_repo(current_repo):
        print(f"ERROR: Current directory is not a git repository: {current_repo}", file=sys.stderr)
        print("Run this script from inside a git repo, or pass --parent explicitly.", file=sys.stderr)
        sys.exit(1)

    # Determine parent directory
    parent_path = Path(args.parent).resolve() if args.parent else current_repo.parent

    # Determine author pattern
    author = args.author or get_default_author_pattern(current_repo)
    if not author:
        print("ERROR: Could not determine author pattern.", file=sys.stderr)
        print("Either pass --author or set git config user.name in the current repo.", file=sys.stderr)
        sys.exit(1)

    # Scan
    siblings = scan_parent_directory(parent_path, author, current_repo)

    # Output
    if args.json:
        contributors, non_contributors, non_git = categorize_siblings(siblings, args.min_commits)
        output = {
            "parent_directory": str(parent_path),
            "author_pattern": author,
            "min_commits": args.min_commits,
            "contributors": contributors,
            "non_contributors": non_contributors,
            "non_git": non_git,
            "summary": {
                "total_siblings": len(siblings),
                "git_repos": len(contributors) + len(non_contributors),
                "contributor_repos": len(contributors),
            },
        }
        print(json.dumps(output, indent=2))
    else:
        print(format_text_report(parent_path, author, siblings, args.min_commits))


if __name__ == "__main__":
    main()
