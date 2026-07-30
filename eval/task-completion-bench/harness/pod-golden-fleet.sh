#!/usr/bin/env bash
# pod-golden-fleet.sh — rolling golden build: RunPod GPU builds each held-out
# golden serially (indexer discipline: one repo at a time per machine), the Mac
# pulls it into the durable vault (+sha256 manifest), then the pod copy is
# deleted to keep the 20G container disk free. Resume-safe: keys already in the
# vault with a manifest are skipped, so the driver can be re-run any time.
#
# Run FROM the Mac:  pod-golden-fleet.sh <specs.jsonl|.json> [--limit N]
# Env: SS_POD (default root@213.173.103.21), SS_POD_PORT (40662),
#      SS_POD_KEY (~/.ssh/id_ed25519), SS_VAULT_DIR (~/.ss-eval/vault/golden),
#      SS_POD_SPECS (filename of the spec file ON THE POD, relative to /root/ss;
#                    default heldout_specs.json — held-out 2 uses heldout2_specs.json)
set -uo pipefail

POD="${SS_POD:-root@213.173.103.21}"
PORT="${SS_POD_PORT:-40662}"
KEY="${SS_POD_KEY:-$HOME/.ssh/id_ed25519}"
VAULT="${SS_VAULT_DIR:-$HOME/.ss-eval/vault/golden}"
SSH=(ssh -p "$PORT" -i "$KEY" -o ServerAliveInterval=30 -o ServerAliveCountMax=4 "$POD")
SPECS="${1:?usage: pod-golden-fleet.sh <specs.jsonl|.json> [--limit N]}"
LIMIT="${3:-0}"; [ "${2:-}" = "--limit" ] && LIMIT="$3"
POD_GOLDEN=/root/.ss-eval/golden
POD_SPECS="${SS_POD_SPECS:-heldout_specs.json}"   # relative to /root/ss on the pod

mkdir -p "$VAULT"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# one representative id per UNIQUE cache key (tasks can share repo@commit)
node -e '
  const fs=require("fs");
  const f=process.argv[1];
  const raw=fs.readFileSync(f,"utf8");
  const rows=f.endsWith(".jsonl")?raw.split("\n").filter(Boolean).map(l=>JSON.parse(l)):JSON.parse(raw);
  const seen=new Set();
  for(const t of rows){
    const k=`${t.repo.replace("/","__")}@${t.base_commit}`;
    if(seen.has(k))continue; seen.add(k);
    console.log(`${t.instance_id}\t${k}`);
  }' "$SPECS" > "$WORK/keys.tsv"

TOTAL=$(wc -l < "$WORK/keys.tsv" | tr -d ' ')
echo "[fleet] $TOTAL unique golden keys; vault=$VAULT"
"${SSH[@]}" "true" </dev/null || { echo "[fleet] FATAL: pod unreachable"; exit 1; }

n=0; built=0; skipped=0; failed=0
while IFS=$'\t' read -r id key; do
  n=$((n+1)); [ "$LIMIT" -gt 0 ] && [ "$n" -gt "$LIMIT" ] && break
  if [ -f "$VAULT/$key/.vault-manifest.sha256" ]; then
    skipped=$((skipped+1)); continue
  fi
  echo "[fleet] $n/$TOTAL BUILD $id ($key) $(date +%H:%M:%S)"
  ok=0
  for attempt in 1 2; do
    if "${SSH[@]}" "cd /root/ss && node eval/task-completion-bench/harness/golden-build.mjs --tasks $POD_SPECS --ids $id --min-free-gb 8" </dev/null; then ok=1; break; fi
    echo "[fleet]   build attempt $attempt failed for $id"
    sleep 10
  done
  if [ "$ok" != 1 ]; then
    echo "$id	$key	build" >> "$VAULT/../fleet-failed.tsv"
    failed=$((failed+1)); continue
  fi
  ok=0
  for attempt in 1 2; do
    if rsync -aH --partial --timeout=120 -e "ssh -p $PORT -i $KEY -o ServerAliveInterval=15 -o ServerAliveCountMax=4" "$POD:$POD_GOLDEN/$key/" "$VAULT/$key/" </dev/null; then ok=1; break; fi
    echo "[fleet]   pull attempt $attempt failed for $key"; sleep 10
  done
  if [ "$ok" != 1 ] || [ ! -f "$VAULT/$key/.sweet-search/codebase.db" ]; then
    echo "$id	$key	pull" >> "$VAULT/../fleet-failed.tsv"
    rm -rf "$VAULT/$key"; failed=$((failed+1)); continue
  fi
  (cd "$VAULT/$key" && find . -type f ! -name .vault-manifest.sha256 -print0 \
    | LC_ALL=C sort -z | xargs -0 shasum -a 256) > "$VAULT/$key/.vault-manifest.sha256"
  "${SSH[@]}" "rm -rf $POD_GOLDEN/$key" </dev/null
  built=$((built+1))
  echo "[fleet]   vaulted $key ($(du -sh "$VAULT/$key" | cut -f1))"
done < "$WORK/keys.tsv"

echo "[fleet] DONE: built=$built skipped=$skipped failed=$failed (of $TOTAL keys)"
[ -f "$VAULT/../fleet-failed.tsv" ] && { echo "[fleet] failures:"; cat "$VAULT/../fleet-failed.tsv"; }
exit 0
