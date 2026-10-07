#!/usr/bin/env bash
# Did each expected rule reach context before the session's first Edit/Write?
# Expected set = output of context-budget.mjs (next to this script) for the declared files.
set -euo pipefail
if [ $# -ne 2 ]; then
  echo 'usage: check-instructions-log.sh <log> "<expected set>"' >&2
  exit 64
fi
LOG="$1"
EXPECTED="$2"
echo "log: $LOG"
awk -v expected="$EXPECTED" '
  $2 ~ /^write:/ { if (!fw) fw = $1; nw++; next }
  $3 ~ /\.claude\/rules\// {
    n = split($3, p, "/"); r = p[n]; sub(/\.md$/, "", r)
    if (!(r in first)) { first[r] = $1; trig[r] = $4 }
  }
  END {
    if (!fw) { print "no Edit/Write in this log — session out of sample"; exit }
    printf "first write: %s  (%d writes)\n\n", fw, nw
    split(expected, e, " ")
    for (i in e) {
      r = e[i]
      if (!(r in first)) printf "%-24s NEVER loaded\n", r
      else printf "%-24s %s  %s  %s\n", r, first[r], (first[r] < fw ? "BEFORE" : "after "), trig[r]
    }
  }
' "$LOG"
