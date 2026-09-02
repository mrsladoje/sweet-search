#!/bin/sh
# F5 — the per-cell trustworthy-verdict census, from rows.json alone.
#
# Replaces scripts-c15-measurability/untrusted-cell-census.sh, which grepped every retained
# transcript for `trustworthy=yes` / `trustworthy=no`. That grep was slow, needed agent-state
# to still exist, and double-counted on opencode and claude-code (both store each tool result
# twice). rtTrustworthy and rtInfra are per-rollout row columns, so this is exact.
#
# A cell is ALL-UNTRUSTED when it produced verdicts and none of them was trustworthy: the
# agent tested, was answered, and could act on nothing. That is the class the smoke's stop
# rule counts (abort if more than 4 of 20 tasks are flagged).
#
# Usage: f5-untrusted-cell-census.jq.sh <results/<run>/rows.json> [...]
for f in "$@"; do
  echo "== $f"
  jq -r '
    map(select(.rtLaunched != null))
    | group_by(.taskId + "|" + .arm)
    | map({
        cell: (.[0].taskId + "/" + .[0].arm),
        launched: (map(.rtLaunched) | add),
        verdicts: (map(.rtVerdicts) | add),
        trusted:  (map(.rtTrustworthy // 0) | add),
        infra:    (map(.rtInfra // 0) | add),
      })
    | map(select(.verdicts > 0 and .trusted == 0))
    | if length == 0 then "   (no all-untrusted cell)"
      else .[] | "   ALL-UNTRUSTED \(.cell)  verdicts=\(.verdicts) infra=\(.infra)"
      end
  ' "$f"
done
