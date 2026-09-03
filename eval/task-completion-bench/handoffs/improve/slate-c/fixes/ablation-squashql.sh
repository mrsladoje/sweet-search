#!/usr/bin/env bash
# Does the 2026-09-02 golden rebuild explain squashql's sweet loss?
#
# The rebuild's ENTIRE effect on this golden is one 23 KB minified CSS file
# (server/src/test/resources/public/static/css/main.1adff166.css) dropped from the index.
# The ablation index reproduces the pre-rebuild state EXACTLY: 486 files / 2399 chunks,
# matching the July index; the shipped one is 485 / 2397. Same git tree in both.
#
# Two conditions, same day, same harness pins, native as the control (it should be 3/3 in both).
set -u
set -a; . /root/.openrouter.env; set +a
cd /root/sweet-search-private
export DOCKER_HOST=unix:///var/run/docker.sock
export SS_DERIVED_BACKUP=/mnt/benchvol/tar-vault
export PATH=/root/.local/bin:$PATH
BENCH=/root/sweet-search-private/eval/task-completion-bench
K=squashql__squashql@5e866a8e82fa8b04603bc536c3bad67ae8c2a40d
G=/root/.ss-eval/golden/$K
OUT=/root/ablation; mkdir -p $OUT

# keep the shipped index so the box goes back exactly as it was
if [ ! -d /root/.ss-eval/shipped-index/$K ]; then
  mkdir -p /root/.ss-eval/shipped-index
  chmod -R u+w $G; cp -a $G/.sweet-search /root/.ss-eval/shipped-index/$K
  echo "=== saved the shipped index"
fi

swap () {  # swap <sourcedir>
  chmod -R u+w $G
  rm -rf $G/.sweet-search
  cp -a "$1" $G/.sweet-search
  chmod -R a-w $G
  echo "=== index now: $(node -e '
    const D=require("/root/sweet-search-private/node_modules/better-sqlite3");
    const d=new D(process.argv[1]+"/.sweet-search/codebase.db",{readonly:true});
    const r=d.prepare("SELECT COUNT(*) c FROM vectors WHERE epoch_retired IS NULL").get().c;
    const f=d.prepare("SELECT COUNT(DISTINCT file_path) c FROM vectors WHERE epoch_retired IS NULL").get().c;
    d.close(); console.log(f+" files / "+r+" chunks");' $G)"
}

cell () {  # cell <run_id> <harness>
  local id=$1 h=$2
  echo "=== $(date -u +%H:%M:%SZ) $id  harness=$h"
  env REASONING=medium ENV_LEDGER=/root/env-ledger/luna-smoke20-v5/ledger.jsonl \
    TASKS_FILE=$BENCH/select/.cache/smoke-candidates.json \
    INSTANCES=squashql__squashql-295 ARMS=native,sweet REPS=3 CONCURRENCY=1 \
    HARNESS=$h MODEL=openai/gpt-5.6-luna PROVIDER=openrouter RUN_ID=$id \
    node $BENCH/harness/run-pilot.mjs > $OUT/${id}.log 2>&1
  echo "    exit=$?  $(node -e '
    const fs=require("fs"); const p=process.argv[1];
    if(!fs.existsSync(p)){console.log("no rows");process.exit(0)}
    const r=JSON.parse(fs.readFileSync(p,"utf8"));
    const c=a=>r.filter(x=>x.arm===a&&x.resolved).length+"/"+r.filter(x=>x.arm===a).length;
    console.log("native "+c("native")+"   sweet "+c("sweet"));' $BENCH/results/$id/rows.json)"
}

echo "########## CONDITION B — pre-rebuild index (minified CSS present)"
swap /root/.ss-eval/ablation-index/$K
cell ab-sq-oldidx-codex-20260903    codex
cell ab-sq-oldidx-opencode-20260903 opencode

echo "########## CONDITION A — shipped index (control, same day)"
swap /root/.ss-eval/shipped-index/$K
cell ab-sq-newidx-codex-20260903    codex
cell ab-sq-newidx-opencode-20260903 opencode

echo "=== $(date -u +%FT%TZ) ABLATION COMPLETE; golden restored to the shipped index"
