#!/usr/bin/env bash
# run.sh — PLAN.md §7 final comparison driver: before (d013b492) vs after (final-prep) vs native,
# 30 frozen DEV questions (questions.json), cells codex-sol61-high, oc-sol61-high, cc-opus55-medium.
# PAID: every rollout is a subscription model call plus OpenRouter judge calls. Launch only on the owner's go.
#
#   bash run.sh plan        print the preflight result and the step list; launches nothing ($0)
#   bash run.sh start       preflight, then run every step DETACHED (nohup); returns at once
#   bash run.sh status      step table + live log tail
#   bash run.sh stop        stop the driver and its bench processes; reap their daemons / maintainers
#   bash run.sh analyze     the §7.5 report (analyze.mjs)
#
# Steps (reps: 2 for both sweet arms, 1 for native → 150 rollouts per harness):
#   OpenAI lane (Codex and opencode, ChatGPT subscription), arms INTERLEAVED per question (A B C / C B A …):
#     codex r1 native+after+before · oc r1 native+after+before · codex r2 after+before · oc r2 after+before
#   Claude lane (Claude Code, Claude subscription), one arm per invocation (Claude Code installs product
#   files into the clones), symmetric order after, before, native, before, after (A B C B A):
#     cc r1 after · cc r1 before · cc r1 native · cc r2 before · cc r2 after
#   FR_LANES=parallel (default): the two lanes run side by side (different subscriptions);
#   FR_LANES=serial: OpenAI lane, then Claude lane. Never two Claude Code jobs at once.
# Resumable: a step is done when runs.jsonl holds an ok row for every (arm, question) of the step;
# `start` again re-runs only missing rollouts (the bench skips finished ones). A step is retried up to
# FR_RETRIES (2) times; an ACCOUNT FATAL (usage limit, login) stops its lane.
set -uo pipefail
. "$(dirname "$0")/config.sh"
CMD="${1:-plan}"
LOGS="$FR_STATE/logs"; STEPS_DIR="$FR_STATE/steps"; PIDF="$FR_STATE/run.pid"
mkdir -p "$LOGS" "$STEPS_DIR"
RESULTS="$FINAL_ROOT/core/prompt-optimization/data/results"
NQ=$(node -e 'console.log(require(process.argv[1]).probes.length)' "$QUESTIONS")
log() { echo "$(date '+%F %T') $*" | tee -a "$LOGS/run.log"; }

# step id → "cell rep arms mode"
OPENAI_STEPS=("codex-sol61-high 1 native,sweet,before interleave" "oc-sol61-high 1 native,sweet,before interleave"
              "codex-sol61-high 2 sweet,before interleave" "oc-sol61-high 2 sweet,before interleave")
CLAUDE_STEPS=("cc-opus55-medium 1 sweet seq" "cc-opus55-medium 1 before seq" "cc-opus55-medium 1 native seq"
              "cc-opus55-medium 2 before seq" "cc-opus55-medium 2 sweet seq")
in_cells() { case " $FR_CELLS " in *" $1 "*) return 0;; *) return 1;; esac; }
step_id() { echo "$1-r$2-${3//,/+}"; }
step_dir() { echo "$RESULTS/r282-$1-$FR_TAG-r$2"; }
# Missing (arm|id) pairs of a step, from its runs.jsonl.
step_missing() { # <cell> <rep> <arms>
  node -e '
    const fs = require("fs"); const [f, q, arms] = process.argv.slice(1);
    const ids = require(q).probes.map(p => p.id);
    const done = new Set(fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)).filter(r => !r.error && r.exitCode === 0).map(r => `${r.arm}|${r.id}`) : []);
    let n = 0; for (const a of arms.split(",")) for (const id of ids) if (!done.has(`${a}|${id}`)) n++;
    console.log(n);' "$(step_dir "$1" "$2")/runs.jsonl" "$QUESTIONS" "$3"; }

preflight() { # prints problems; returns 1 on any blocker
  local bad=0
  node "$FR_HERE/select-questions.mjs" --check >/dev/null || { echo "BLOCK questions.json does not match a fresh seed-42 draw"; bad=1; }
  for w in "$FINAL_ROOT" "$BEFORE_ROOT"; do
    [ -z "$(git -C "$w" status --porcelain --untracked-files=no)" ] || { echo "BLOCK $w has uncommitted tracked changes (rows must name the code they ran)"; bad=1; }
  done
  [ "$(git -C "$BEFORE_ROOT" rev-parse HEAD)" = "$(git -C "$BEFORE_ROOT" rev-parse "$BEFORE_COMMIT^{commit}")" ] || { echo "BLOCK before worktree is not at $BEFORE_COMMIT"; bad=1; }
  bash "$FR_HERE/prepare-native.sh" both > "$LOGS/prepare-native.log" 2>&1 || { echo "BLOCK native build/verify failed ($LOGS/prepare-native.log)"; bad=1; }
  for arm in before after; do
    for r in $(fr_repos); do
      local st="$FR_STATE/index-stamps/$arm/$r.json"
      [ -f "$st" ] || { echo "BLOCK no $arm index stamp for $r — run: bash index-repos.sh $arm"; bad=1; continue; }
      if [ "$arm" = before ]; then node -e 'const s=require(process.argv[1]); process.exit(s.commit.startsWith(process.argv[2]) ? 0 : 1)' "$st" "$(git -C "$BEFORE_ROOT" rev-parse HEAD)" || { echo "BLOCK before index of $r was not built by $BEFORE_COMMIT"; bad=1; }; fi
    done
  done
  # The after index should be built by code whose indexer matches the final code (PLAN §6.1 runs after all merges).
  local aft; aft=$(for r in $(fr_repos); do node -e 'try{console.log(require(process.argv[1]).commit)}catch{}' "$FR_STATE/index-stamps/after/$r.json"; done | sort -u)
  for c in $aft; do
    if [ -n "$(git -C "$FINAL_ROOT" diff --name-only "$c" HEAD -- core/indexing core/graph core/embedding core/vector-store crates/sweet-search-native 2>/dev/null)" ]; then
      echo "WARN after index built at ${c:0:8}; indexing code changed since (git diff $c HEAD -- core/indexing core/graph …) — reindex (index-repos.sh after) unless the change is index-neutral"
    fi
  done
  bash "$FR_HERE/exposure-check.sh" "$FR_STATE/exposure-latest" > "$LOGS/exposure-check.log" 2>&1 || { echo "BLOCK exposure check failed ($LOGS/exposure-check.log)"; bad=1; }
  [ -f "$HOME/.ss-eval/claude-sub.env" ] || [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] || ! in_cells cc-opus55-medium || { echo "BLOCK no Claude subscription token (~/.ss-eval/claude-sub.env)"; bad=1; }
  [ -f "$HOME/.codex/auth.json" ] || ! in_cells codex-sol61-high || { echo "BLOCK no ~/.codex/auth.json (ChatGPT login for Codex)"; bad=1; }
  node -e 'const a=require(process.env.HOME+"/.local/share/opencode/auth.json"); process.exit(a.openai ? 0 : 1)' 2>/dev/null || ! in_cells oc-sol61-high || { echo "BLOCK no openai entry in ~/.local/share/opencode/auth.json (opencode auth login → ChatGPT)"; bad=1; }
  [ -n "${OPENROUTER_API_KEY:-}" ] || { echo "BLOCK OPENROUTER_API_KEY not in env (judge panel: DeepSeek via OpenRouter, Gemini, MiniMax) — launch from a shell that has the judge keys"; bad=1; }
  return $bad
}

run_step() { # <cell> <rep> <arms> <mode>
  local cell=$1 rep=$2 arms=$3 mode=$4 id; id=$(step_id "$cell" "$rep" "$arms")
  [ -f "$STEPS_DIR/$id.done" ] && { log "skip $id (done)"; return 0; }
  local extra=() attempt=0 rc missing
  [ "$mode" = interleave ] && extra+=(--interleave)
  [[ "$cell" == oc-* ]] && extra+=(--arm-env "$FR_OC_ARM_ENV")
  while :; do
    # Never next to an index build or a foreign bench job; never two Claude Code jobs.
    local n=0
    while busy_foreign "$cell"; do [ $((n % 10)) -eq 0 ] && log "$id waiting: $(busy_foreign_list "$cell" | head -2 | tr '\n' ';')"; n=$((n + 1)); sleep 60; done
    attempt=$((attempt + 1)); log "START $id (attempt $attempt)"
    ( cd "$FINAL_ROOT" && env $FR_COMMON_ENV CELL="$cell" node scripts/retrieval-bench-282.mjs --conc "$FR_CONC" \
        --probes "$QUESTIONS" --arms "$arms" --before-root "$BEFORE_ROOT" --before-repos "$BEFORE_REPOS" --after-repos "$AFTER_COPY" \
        --index-stamps "$FR_STATE/index-stamps" --require-index-stamp --tag "$FR_TAG-r$rep" ${extra[@]+"${extra[@]}"} ) >> "$LOGS/$id.log" 2>&1
    rc=$?
    reap_step "$cell" "$rep"
    missing=$(step_missing "$cell" "$rep" "$arms")
    log "END $id rc=$rc missing=$missing"
    if [ "$missing" = 0 ]; then
      [ $rc -eq 3 ] && log "WARN $id: Claude Code cache-fairness violation (summary.json) — reported by analyze.mjs"
      date > "$STEPS_DIR/$id.done"; return 0
    fi
    if grep -q "ACCOUNT FATAL" "$LOGS/$id.log"; then log "STOP lane: ACCOUNT FATAL in $id (usage limit / login). Fix, then: bash run.sh start"; return 2; fi
    [ $attempt -gt "${FR_RETRIES:-2}" ] && { log "GIVE UP $id after $attempt attempts ($missing missing)"; return 1; }
  done
}
# Processes that must not overlap a step: index builds, GCSN, task bench, other retrieval benches
# (not ours), and for a Claude Code step any Claude Code bench session not started by this driver.
busy_foreign_list() {
  pgrep -fl "index-codebase|run_benchmark|run-pilot" | grep -v pgrep
  pgrep -fl "retrieval-bench-282.mjs" | grep -v -- "--tag $FR_TAG-r" | grep -v pgrep
  # A Claude Code step starts only when no Claude Code bench session runs: this lane is sequential, so
  # at that moment every pinned-claude process belongs to someone else.
  [[ "$1" == cc-* ]] && pgrep -fl "bin-claude-2.1.281/claude" | grep -v pgrep
  return 0
}
busy_foreign() { [ -n "$(busy_foreign_list "$1")" ]; }
reap_step() { # stop anything still holding files in this step's clones (the bench reaps too; this is the backstop)
  ( cd "$FINAL_ROOT" && node --input-type=module -e '
    const [a, b] = process.argv.slice(1);
    const { reapRoots } = await import(process.cwd() + "/eval/task-completion-bench/harness/spawn-ledger-reap.mjs");
    const k = await reapRoots({ ledgerDir: null, roots: [a, b] });
    if (k.length) console.log(`reaped ${k.length}: ${k.map(x => `${x.comm}(${x.pid})`).join(", ")}`);' \
    "$HOME/.ss-eval/r282-repos/$1-$FR_TAG-r$2" "$HOME/.ss-eval/r282-repos/$1-$FR_TAG-r$2__before" ) 2>&1 | tee -a "$LOGS/run.log"
}
lane() { # <name> <steps...>
  local name=$1; shift
  for s in "$@"; do
    read -r cell rep arms mode <<< "$s"
    in_cells "$cell" || continue
    run_step "$cell" "$rep" "$arms" "$mode" || { log "lane $name stopped at $(step_id "$cell" "$rep" "$arms")"; return 1; }
  done
  log "lane $name done"
}

case "$CMD" in
  plan)
    echo "questions: $NQ ($QUESTIONS) | repos: $(fr_repos)"
    echo "before: $BEFORE_ROOT @ $(git -C "$BEFORE_ROOT" rev-parse --short=8 HEAD) | after: $FINAL_ROOT @ $(git -C "$FINAL_ROOT" rev-parse --short=8 HEAD) | lanes: ${FR_LANES:-parallel} | conc $FR_CONC"
    echo "--- preflight"; preflight && echo "PREFLIGHT OK" || echo "PREFLIGHT BLOCKED"
    echo "--- steps (missing rollouts)"
    for s in "${OPENAI_STEPS[@]}" "${CLAUDE_STEPS[@]}"; do read -r cell rep arms mode <<< "$s"; in_cells "$cell" || continue
      printf '  %-44s %-12s missing %s\n' "$(step_id "$cell" "$rep" "$arms")" "$mode" "$(step_missing "$cell" "$rep" "$arms")"; done ;;
  start)
    [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null && { echo "already running (pid $(cat "$PIDF"))"; exit 1; }
    preflight || { echo "preflight blocked — nothing launched"; exit 1; }
    nohup bash "$0" _run >> "$LOGS/run.log" 2>&1 &
    echo $! > "$PIDF"; disown
    echo "started (pid $(cat "$PIDF")); log $LOGS/run.log; per-step logs $LOGS/<step>.log" ;;
  _run)
    log "=== run start: tag $FR_TAG, lanes ${FR_LANES:-parallel}, cells $FR_CELLS"
    if [ "${FR_LANES:-parallel}" = serial ]; then lane openai "${OPENAI_STEPS[@]}"; lane claude "${CLAUDE_STEPS[@]}"
    else lane openai "${OPENAI_STEPS[@]}" & p1=$!; lane claude "${CLAUDE_STEPS[@]}" & p2=$!; wait $p1 $p2; fi
    log "=== run end"; rm -f "$PIDF" ;;
  status)
    [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null && echo "running (pid $(cat "$PIDF"))" || echo "not running"
    for s in "${OPENAI_STEPS[@]}" "${CLAUDE_STEPS[@]}"; do read -r cell rep arms mode <<< "$s"; in_cells "$cell" || continue
      id=$(step_id "$cell" "$rep" "$arms"); printf '  %-44s %s missing %s\n' "$id" "$([ -f "$STEPS_DIR/$id.done" ] && echo DONE || echo '    ')" "$(step_missing "$cell" "$rep" "$arms")"; done
    tail -5 "$LOGS/run.log" 2>/dev/null ;;
  stop)
    if [ -f "$PIDF" ]; then pkill -TERM -P "$(cat "$PIDF")" 2>/dev/null; kill "$(cat "$PIDF")" 2>/dev/null; fi
    pkill -TERM -f "retrieval-bench-282.mjs.*--tag $FR_TAG-r" 2>/dev/null   # the bench reaps its daemons on SIGTERM
    sleep 10; for c in $FR_CELLS; do for r in 1 2; do reap_step "$c" "$r"; done; done
    rm -f "$PIDF"; log "stopped" ;;
  analyze) node "$FR_HERE/analyze.mjs" --tag "$FR_TAG" --out "$FR_STATE/report-$FR_TAG.json" ;;
  *) echo "usage: run.sh plan|start|status|stop|analyze"; exit 2 ;;
esac
