#!/usr/bin/env bash
# golden-vault.sh — durable golden-index vault on the local Mac (4TB), restored
# to the eval box per batch. Fixes the box's evaporating golden cache without
# re-indexing: artifacts only ever flow box -> vault (pull) and vault -> box
# (push). The Mac NEVER builds goldens — they are box-built (ORT INT8 config),
# so backend/config parity with runs is preserved by construction.
#
# Usage (run from the Mac):
#   golden-vault.sh pull                                  # archive all box goldens + manifests
#   golden-vault.sh pull --keys k1,k2                     # archive specific cache keys
#   golden-vault.sh push --tasks <specs.json|.jsonl> --ids id1,id2 [--verify]
#   golden-vault.sh push --keys k1,k2 [--verify]          # restore batch to box, lock read-only
#   golden-vault.sh unlock --keys k1,k2                   # re-allow writes on box (rebuilds)
#   golden-vault.sh status                                # vault + box inventory and disk
#
# Cache key = repo with '/'->'__' + '@' + base_commit (mirrors golden-build.mjs).
set -euo pipefail

BOX="${SS_BOX:-root@167.233.69.121}"
BOX_GOLDEN="${SS_BOX_GOLDEN:-/root/.ss-eval/golden}"
VAULT="${SS_VAULT_DIR:-$HOME/.ss-eval/vault/golden}"
RSYNC_OPTS=(-aH --partial --info=stats1)
MIN_BOX_FREE_GB="${SS_MIN_BOX_FREE_GB:-15}"

cmd="${1:-}"; [ $# -gt 0 ] && shift
die() { echo "golden-vault: $*" >&2; exit 1; }

argval() { # argval <name> "$@" -> value or empty
  local n="$1"; shift
  while [ $# -gt 0 ]; do [ "$1" = "--$n" ] && { echo "${2:-}"; return; }; shift; done
}
has_flag() { local n="$1"; shift; for a in "$@"; do [ "$a" = "--$n" ] && return 0; done; return 1; }

keys_from_args() { # resolves --keys OR --tasks+--ids to newline-separated cache keys
  local keys tasks ids
  keys="$(argval keys "$@")"; tasks="$(argval tasks "$@")"; ids="$(argval ids "$@")"
  if [ -n "$keys" ]; then echo "$keys" | tr ',' '\n' | sed '/^$/d'; return; fi
  [ -n "$tasks" ] && [ -n "$ids" ] || die "need --keys or --tasks + --ids"
  node -e '
    const fs = require("fs");
    const [file, idcsv] = process.argv.slice(1);
    const raw = fs.readFileSync(file, "utf8");
    const rows = file.endsWith(".jsonl")
      ? raw.split("\n").filter(Boolean).map(l => JSON.parse(l))
      : JSON.parse(raw);
    for (const id of idcsv.split(",").filter(Boolean)) {
      const t = rows.find(r => r.instance_id === id);
      if (!t) { console.error("golden-vault: id not in tasks file: " + id); process.exit(1); }
      console.log(`${t.repo.replace("/", "__")}@${t.base_commit}`);
    }' "$tasks" "$ids"
}

manifest_for() { # build sha256 manifest for a vault key dir (portable Mac<->Linux format)
  local dir="$1"
  (cd "$dir" && find . -type f ! -name .vault-manifest.sha256 -print0 \
    | LC_ALL=C sort -z | xargs -0 shasum -a 256) > "$dir/.vault-manifest.sha256"
}

box_free_gb() { ssh "$BOX" "df -BG --output=avail / | tail -1 | tr -dc 0-9"; }

case "$cmd" in
  pull)
    mkdir -p "$VAULT"
    keys="$(keys_from_args "$@" 2>/dev/null || true)"
    if [ -z "$keys" ]; then
      keys="$(ssh "$BOX" "ls -1 $BOX_GOLDEN 2>/dev/null" || true)"
      [ -n "$keys" ] || die "no goldens on box at $BOX_GOLDEN"
    fi
    while IFS= read -r k; do
      [ -n "$k" ] || continue
      echo "== pull $k"
      rsync "${RSYNC_OPTS[@]}" "$BOX:$BOX_GOLDEN/$k/" "$VAULT/$k/"
      [ -f "$VAULT/$k/.sweet-search/codebase.db" ] || { echo "   WARN: $k has no codebase.db (incomplete build?) — kept but not manifested"; continue; }
      manifest_for "$VAULT/$k"
      echo "   archived + manifested ($(du -sh "$VAULT/$k" | cut -f1))"
    done <<< "$keys"
    ;;

  push)
    keys="$(keys_from_args "$@")"
    free="$(box_free_gb)"
    [ "$free" -ge "$MIN_BOX_FREE_GB" ] || die "box disk ${free}G < ${MIN_BOX_FREE_GB}G — GC images/old goldens first"
    while IFS= read -r k; do
      [ -n "$k" ] || continue
      [ -f "$VAULT/$k/.vault-manifest.sha256" ] || die "$k not in vault (or unmanifested) — run pull first"
      echo "== push $k"
      ssh "$BOX" "test -d $BOX_GOLDEN/$k && chmod -R u+w $BOX_GOLDEN/$k || true; mkdir -p $BOX_GOLDEN/$k"
      # --delete heals half-written/tampered box states back to the vault truth
      rsync "${RSYNC_OPTS[@]}" --delete "$VAULT/$k/" "$BOX:$BOX_GOLDEN/$k/"
      if has_flag verify "$@"; then
        ssh "$BOX" "cd $BOX_GOLDEN/$k && sha256sum --quiet -c .vault-manifest.sha256" \
          || die "$k FAILED checksum verify on box"
        echo "   verified"
      fi
      # lock: agents/maintainers on the box cannot silently mutate or re-index it
      ssh "$BOX" "chmod -R a-w $BOX_GOLDEN/$k"
      echo "   restored + locked read-only"
    done <<< "$keys"
    ;;

  unlock)
    keys="$(keys_from_args "$@")"
    while IFS= read -r k; do
      [ -n "$k" ] || continue
      ssh "$BOX" "chmod -R u+w $BOX_GOLDEN/$k" && echo "unlocked $k"
    done <<< "$keys"
    ;;

  status)
    echo "== vault: $VAULT"
    if [ -d "$VAULT" ]; then
      ls -1 "$VAULT" | wc -l | xargs echo "   keys:"
      du -sh "$VAULT" 2>/dev/null | cut -f1 | xargs echo "   size:"
    else echo "   (empty)"; fi
    echo "== box: $BOX:$BOX_GOLDEN"
    ssh "$BOX" "ls -1 $BOX_GOLDEN 2>/dev/null | wc -l | xargs echo '   keys:'; du -sh $BOX_GOLDEN 2>/dev/null | cut -f1 | xargs echo '   size:'; df -h / | tail -1 | awk '{print \"   disk: \" \$4 \" free\"}'"
    ;;

  *)
    die "unknown command '${cmd:-}' — use pull | push | unlock | status"
    ;;
esac
