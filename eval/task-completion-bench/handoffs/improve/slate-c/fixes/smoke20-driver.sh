#!/usr/bin/env bash
# SMOKE: 20 multi-file, larger-repo tasks from DEV-RET. Executes
# handoffs/improve/slate-c/SMOKE-MULTIFILE-PREREGISTRATION.md §9.
#
# Three corrections to the §9 command, each verified against the driver that produced the
# fresh pool (/root/fresh-driver.sh) and against the harness source:
#   1. HARNESS=claudecode, not "claude-code" (run-pilot's own routing name).
#   2. PROVIDER=openrouter REASONING=medium — §9 omits both; the defaults are
#      PROVIDER=deepseek REASONING=standard, which would misprice and change reasoning.
#   3. SS_DERIVED_BACKUP=/mnt/benchvol/tar-vault — the docker-save tar vault moved off
#      /workspace. Six of the 20 use a prep-warmed image; without this run-pilot cannot
#      load them and the env-ledger preflight refuses the run.
#
# Legs are staggered 20 min apart rather than run back-to-back: the box has 8 vCPU and each
# leg is CONCURRENCY=1, so three legs overlap without stacking three docker grades at once.
set -u
set -a; . /root/.openrouter.env; set +a
cd /root/sweet-search-private
export DOCKER_HOST=unix:///var/run/docker.sock
export SS_DERIVED_BACKUP=/mnt/benchvol/tar-vault
export PATH=/root/.local/bin:$PATH          # claude is not on the non-interactive PATH
BENCH=/root/sweet-search-private/eval/task-completion-bench
TASKS=$BENCH/select/.cache/smoke-candidates.json
LEDGER=/root/env-ledger/luna-smoke20-v5/ledger.jsonl
OUT=/root/smoke20
mkdir -p $OUT
INST=$(paste -sd, $BENCH/handoffs/improve/slate-c/smoke20.txt)

leg () {  # leg <run_id> <harness>
  local id=$1 h=$2
  echo "=== $(date -u +%FT%TZ) launching $id  harness=$h"
  env REASONING=medium ENV_LEDGER=$LEDGER TASKS_FILE=$TASKS \
    INSTANCES=$INST ARMS=native,sweet REPS=3 CONCURRENCY=1 \
    HARNESS=$h MODEL=openai/gpt-5.6-luna PROVIDER=openrouter RUN_ID=$id \
    node $BENCH/harness/run-pilot.mjs > $OUT/${id}.log 2>&1
  echo "=== $(date -u +%FT%TZ) $id exit=$?"
}

leg sm-opencode-20260902   opencode   &  P1=$!
sleep 1200
leg sm-claudecode-20260902 claudecode &  P2=$!
sleep 1200
leg sm-codex-20260902      codex      &  P3=$!

wait $P1 $P2 $P3
echo "=== $(date -u +%FT%TZ) ALL THREE LEGS DONE"

# completeness: every (task, arm, rep) must exist in every leg
for id in sm-opencode-20260902 sm-claudecode-20260902 sm-codex-20260902; do
  node --input-type=module -e '
    import fs from "node:fs";
    const [rows,pool]=process.argv.slice(1);
    if(!fs.existsSync(rows)){console.log(rows+": NO ROWS");process.exit(0)}
    const R=JSON.parse(fs.readFileSync(rows,"utf8"));
    const want=fs.readFileSync(pool,"utf8").trim().split("\n").filter(Boolean);
    const miss=[];
    for(const t of want) for(const a of ["native","sweet"]) for(const rep of [0,1,2])
      if(!R.some(r=>r.taskId===t&&r.arm===a&&r.rep===rep)) miss.push(t+"/"+a+"/r"+rep);
    console.log(rows.split("/").slice(-2)[0]+": "+R.length+" rows, "+miss.length+" missing cells"
      +(miss.length?" -> "+miss.slice(0,10).join(" "):""));
  ' "$BENCH/results/$id/rows.json" "$BENCH/handoffs/improve/slate-c/smoke20.txt"
done
echo "=== $(date -u +%FT%TZ) DRIVER COMPLETE"
