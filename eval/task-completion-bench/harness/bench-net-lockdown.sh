#!/bin/bash
# bench-net-lockdown.sh on|off|status — agent-shell egress lockdown (bench hygiene 2026-07-07).
#
# WHY: the full-200 forensics found native's derive_more "solve" was a curl of the
# upstream GitHub PR diff, executed in codex's HOST shell (the agent runs on the box,
# not in a container), so container-level --network none cannot close this leak.
# Codex 0.141's own sandbox was probed and rejected: its Linux (bwrap+seccomp) policy
# denies ALL unix-socket connects with no working per-path allowlist on `exec`, which
# kills the sweet arm's ss-* daemon sockets (and docker for run_tests) — and arm-
# asymmetric sandboxing would confound the A/B. See analysis/harness-hygiene design note.
#
# MECHANISM: a marker-delimited /etc/hosts block maps code-hosting domains to 0.0.0.0.
# Blocks the observed leak class (fetching upstream PRs/patches/repos by hostname) for
# every host process incl. codex shells, both arms symmetrically. Leaves untouched:
# OpenRouter (agent API), docker.io pulls, DNS for everything else, all container
# traffic (governed separately by --network none). RESIDUAL RISK (documented): a
# process could bypass via hardcoded IPs or an external DNS resolver; acceptable for
# leakage-prevention (not adversarial containment).
#
# NOTE: while ON, golden clones from github.com FAIL — pre-warm goldens first
# (WARM_ONLY=1) or run `bench-net-lockdown.sh off` for the warm phase.
set -euo pipefail
MARK_BEGIN="# BEGIN sweet-bench-net-lockdown"
MARK_END="# END sweet-bench-net-lockdown"
DOMAINS=(
  github.com www.github.com api.github.com codeload.github.com gist.github.com
  raw.githubusercontent.com objects.githubusercontent.com gist.githubusercontent.com
  patch-diff.githubusercontent.com
  gitlab.com bitbucket.org codeberg.org sr.ht git.sr.ht
  googlesource.com android.googlesource.com chromium.googlesource.com
  sourceforge.net git.savannah.gnu.org
)
status() {
  if grep -q "$MARK_BEGIN" /etc/hosts 2>/dev/null; then echo "LOCKDOWN ACTIVE"; else echo "lockdown inactive"; fi
}
off() {
  sed -i "/$MARK_BEGIN/,/$MARK_END/d" /etc/hosts
  echo "lockdown removed"
}
on() {
  grep -q "$MARK_BEGIN" /etc/hosts 2>/dev/null && off > /dev/null # idempotent refresh
  {
    echo "$MARK_BEGIN"
    for d in "${DOMAINS[@]}"; do echo "0.0.0.0 $d"; done
    echo "$MARK_END"
  } >> /etc/hosts
  echo "lockdown enabled (${#DOMAINS[@]} domains)"
}
case "${1:-status}" in
  on) on ;;
  off) off ;;
  status) status ;;
  *) echo "usage: $0 on|off|status" >&2; exit 2 ;;
esac
