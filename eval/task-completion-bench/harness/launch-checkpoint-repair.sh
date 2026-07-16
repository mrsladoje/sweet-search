#!/usr/bin/env bash
# Checkpoint-repair re-run (2026-07-09 env-honesty workstream). Re-runs BOTH arms on
# the checkpoint pairs invalidated by (a) codex startup failures (now: error-event
# parsing + one-shot 0-call relaunch guard in codex-task-runner.mjs) and (b) test-time
# network breakage (now: prep-warmed images wired via task-overrides.json).
# Same recipe as codex-dev-checkpoint-59 (gpt-5.5 medium, MPP fix-surface, frame ON,
# lockdown active, one pilot, golden-cache, idealCost column, tamper policy).
# INSTANCES is finalized from the env-ledger: only tasks that are gold-valid (stock
# or warmed) at launch time are re-run — re-running on a broken env is spend with
# zero signal. DEV data — never publishable.
set -eu
test -f /root/.openrouter-key || { echo "FATAL: key missing"; exit 1; }
test -f /root/Mppppp-fixsurface.md || { echo "FATAL: prompt missing"; exit 1; }
export OPENROUTER_API_KEY=$(cat /root/.openrouter-key)
cd /root/sweet-search-private
BENCH=eval/task-completion-bench
pkill -9 -f "cli.js --serve" 2>/dev/null || true
pkill -9 -f "index-maintainer" 2>/dev/null || true
echo "[preflight] disk: $(df -h / | tail -1)"
echo "[preflight] lockdown: $(bash $BENCH/harness/bench-net-lockdown.sh status)"
export HARNESS=codex PROVIDER=openrouter MODEL=openai/gpt-5.5 REASONING=medium
export CONCURRENCY=4 CODEX_TIMEOUT_MS=5400000 SS_NO_ANTITHRASH=1 REPS=1
export DOCKER_HOST=unix:///var/run/docker.sock
export TASKS_FILE=$BENCH/select/.cache/tasks_full_multilingual.json
export MPP=/root/Mppppp-fixsurface.md
export RUN_ID=codex-checkpoint-repair
# The 16-pair rerun set (env-ledger 2026-07-09): 4 errored pairs with fixable envs +
# jump (gold-valid, errored pair) + 11 broken-env checkpoint tasks now warmed. The 8
# curation-broken checkpoint tasks (helm-7381, emscripten-5742, kiota-3760,
# elasticmq-406, graphql-php-1382, zeek-3703, swc-3392, swc-8619) are EXCLUDED
# (see ledger evidence; swc x2 = P2P set unstable under ANY network condition).
# ENV_LEDGER pre-flight refuses launch unless all 16 are gold-FULL under current config.
export ENV_LEDGER=/root/env-ledger/dev200/ledger.jsonl
export INSTANCES=cqfn__diktat-947,dart-lang__dartdoc-3393,gfx-rs__wgpu-6354,graphql-java-kickstart__graphql-java-tools-593,jump-dev__jump.jl-2714,k0sproject__k0sctl-556,mgechev__revive-477,microformats__php-mf2-255,parquet-go__parquet-go-292,php-cs-fixer__php-cs-fixer-7593,randombit__botan-2738,scalameta__scalameta-3728,spoonlabs__gumtree-spoon-ast-diff-88,swiftlang__swift-syntax-1170,tursodatabase__libsql-1287,verygoodopensource__very_good_cli-611
echo "===== CHECKPOINT REPAIR START $(date -u +%FT%TZ) ====="
node $BENCH/harness/run-pilot.mjs 2>&1 | tee $BENCH/results/codex-checkpoint-repair.log
echo "===== CHECKPOINT REPAIR DONE $(date -u +%FT%TZ) ====="
