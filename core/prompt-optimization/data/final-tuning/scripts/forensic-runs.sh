#!/usr/bin/env bash
# Forensic long-trajectory batch on the owner's Mac: SWEET ARM ONLY, shipped 2.8.2 (no SS_VARIANT_* switch), REPS=1,
# the product harness as shipped for each CLI. Purpose: collect long, many-turn trajectories of agents using the ss-* tools.
# 20 DEV tasks per harness (list below; DEV-RET + dev-200 only, never HO2), run in cells of FR_CONC tasks, one pilot at a time.
#
#   bash forensic-runs.sh plan                  # $0: per-task readiness (golden, image, green ledger). No model call.
#   bash forensic-runs.sh pull                  # $0: host-side image pull to tars for tasks with no local image (network only).
#   bash forensic-runs.sh stage                 # $0: copy vault goldens to ~/.ss-eval/golden for the tasks that lack one.
#   bash forensic-runs.sh sweep                 # $0: gold-only ledger sweep for tasks with no green entry. Needs a QUIET machine.
#   bash forensic-runs.sh claudecode            # Claude Code 2.1.281 + Opus 5.5 medium   (Claude subscription)
#   bash forensic-runs.sh codex                 # Codex 0.159.2 + GPT-6.1 Sol high         (ChatGPT subscription)
#   bash forensic-runs.sh opencode              # opencode 1.18.4 + gpt-5.6-luna medium    (OpenRouter, metered cash)
# Env: FR_DRY=1   print every command, run nothing (plan/pull/stage/sweep/run all honour it)
#      FR_N=20 (tasks per harness), FR_MIN=16 (abort if fewer are ready), FR_CONC=4 (tasks per cell), FR_STAMP (re-use to resume),
#      FR_BATCH (file with the chosen ids; default results/fr-batch.ids, created on first run so all 3 harnesses get the SAME tasks),
#      FR_AGENT_TIMEOUT_MS (default 3600000; run-pilot's own default is 30 min), FR_KEEP_IMAGES=1 (do not unload images after a cell),
#      FR_LEDGER_BASE (default: the 2026-09-29 fix5 ledger in the main checkout), FR_OC_MODEL (opencode model, default openai/gpt-5.6-luna),
#      FR_ALLOW_STALE_AUTH=1 (codex: run although ~/.codex/auth.json is older than 7 days).
# Refuses to run a model leg, a sweep or an image unload while another run-pilot, the final-tuning retrieval queue or any ss-* daemon is alive.
# Status: results/fr-<harness>-<stamp>.status (+ .manifest). Run ids are neutral (fr-<harness>-<stamp>-C<n>).
set -u
MODE=${1:?usage: forensic-runs.sh plan|pull|stage|sweep|claudecode|codex|opencode}
ROOT=$(cd "$(dirname "$0")/../../../../.." && pwd)
BENCH=$ROOT/eval/task-completion-bench
MAIN=/Users/admin/Projects/sweet-search-private
MAIN_BENCH=$MAIN/eval/task-completion-bench
cd "$BENCH" || exit 2
DRY=${FR_DRY:-0}
N=${FR_N:-20}; MIN=${FR_MIN:-16}; CONC=${FR_CONC:-4}
STAMP=${FR_STAMP:-$(date +%Y%m%d-%H%M)}
BATCH=${FR_BATCH:-$BENCH/results/fr-batch.ids}
SPECS=$BENCH/results/fr-specs.json
TSV=$BENCH/results/fr-tasks.tsv
LEDGER_BASE=${FR_LEDGER_BASE:-$MAIN_BENCH/results/bsmoke-ledger-fix5/ledger.jsonl}
LEDGER_DIR=${FR_LEDGER_DIR:-$BENCH/results/fr-ledger}
LEDGER=$BENCH/results/fr-ledger-merged.jsonl
TARDIRS="$HOME/.ss-eval/image-tars $HOME/.ss-eval/image-tars-smoke3 $HOME/.ss-eval/image-tars-candidates $HOME/.ss-eval/image-tars-forensic"
PULLDIR=$HOME/.ss-eval/image-tars-forensic
VAULT=$HOME/.ss-eval/vault/golden
GOLDEN=$HOME/.ss-eval/golden
mkdir -p results

# ---- the batch: PRIMARY in order of historical length; RESERVE substitutes (in order) for any primary that is not ready ----
# Pools: DEV-RET (select/tasks_heldout.jsonl) and dev-200 (select/tasks_multilingual.jsonl). Filters applied 2026-10-01: vacuity pre-screen,
# blocklist, excludeFromAgentRuns, F2P/P2P gate, name-lock census, no box-built image override, no golden REBUILD verdict (see NEW-TASK-RUNS.md).
PRIMARY=(
  intel__rohd-458 jensneuse__graphql-go-tools-174 singapore__renovate-1153 rstudio-education__gradethis-161 getmoto__moto-6716
  gitbookio__markup-it-56 chaijs__chai-990 yargs__yargs-1422 ember-cli__eslint-plugin-ember-551 rokucommunity__brighterscript-1050
  joshuakgoldberg__bingo-271 mirumee__ariadne-codegen-223 teleporthq__teleport-code-generators-291 smooth-code__svgr-10 mwouts__jupytext-360
  superlistapp__super_editor-2516 pytask-dev__pytask-210 aio-libs__aiohttp-8038 suzuki-shunsuke__tfcmt-1257 yelp__bravado-core-154
)
RESERVE=(
  fastify__fastify-cors-285 vazco__uniforms-787 python-markdown__markdown-1294 hotmeteor__spectator-181 sqlkata__querybuilder-557
)
ALL=("${PRIMARY[@]}" "${RESERVE[@]}")

export DOCKER_HOST=unix:///Users/admin/.colima/default/docker.sock
export TMPDIR=$HOME/.ss-eval/tmp
export SR_EVAL_DIR=$HOME/swe-rebench-tools/SWE-rebench-V2
export SS_ISOLATION=0
export SWEET_SEARCH_NATIVE_INFERENCE=0 SWEET_SEARCH_COREML_CASCADE=0   # ORT INT8 queries, same as the goldens
export NO_IMAGE_GC=1
mkdir -p "$TMPDIR"

say() { printf '%s\n' "$*"; }
die() { say "$*"; exit 2; }
run() { if [ "$DRY" = 1 ]; then printf 'DRY:'; printf ' %q' "$@"; echo; return 0; fi; "$@"; }

# ---- guards (same set as task-guard.sh) ----
quiet_or_die() {
  [ "$DRY" = 1 ] && return 0
  if pgrep -f "harness/run-pilo[t].mjs" >/dev/null; then die "another run-pilot is running - one at a time"; fi
  if pgrep -f "env-ledger-swee[p]" >/dev/null; then die "an env-ledger sweep is running"; fi
  if pgrep -f "retrieval-bench-28[2]|final-tuning/scripts/queue[.]sh" >/dev/null; then die "the final-tuning retrieval queue is running (ss-* daemons, Metal/ORT): wait for it"; fi
  if pgrep -x sweet-search-daemon >/dev/null || pgrep -x sweet-search-maintainer >/dev/null; then
    say "ss-* daemons are alive (CPU ORT and the GPU path must not coexist). Blocking process(es):"
    for n in sweet-search-daemon sweet-search-maintainer; do for p in $(pgrep -x $n); do
      say "  $n pid=$p ppid=$(ps -o ppid= -p "$p" | tr -d ' ') cwd=$(lsof -a -p "$p" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"; done; done
    exit 2
  fi
}
base_guards() {
  [ "$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)" = final-tuning ] || die "not on branch final-tuning ($ROOT)"
  [ -x "$BENCH/.venv-grade/bin/python" ] || die "missing $BENCH/.venv-grade (symlink dir to the main checkout's venv)"
  docker info >/dev/null 2>&1 || die "docker/colima not reachable at $DOCKER_HOST (start colima yourself; this script does not)"
}

# ---- task table: specs for PRIMARY+RESERVE from the two DEV caches only (never any heldout2 file) ----
build_specs() {
  FR_IDS=$(IFS=,; echo "${ALL[*]}") FR_OUT_SPECS=$SPECS FR_OUT_TSV=$TSV FR_MAIN=$MAIN_BENCH python3 - <<'EOF' || die "cannot build specs"
import json, os
m = os.environ['FR_MAIN']
want = os.environ['FR_IDS'].split(',')
specs = {}
for f in ('select/.cache/tasks_full_multilingual.json', 'select/.cache/tasks_full_heldout.json'):  # dev-200 and DEV-RET
    for s in json.load(open(os.path.join(m, f))): specs[s['instance_id']] = s
miss = [i for i in want if i not in specs]
if miss: raise SystemExit('ids not in the dev pools: %s' % miss)
json.dump([specs[i] for i in want], open(os.environ['FR_OUT_SPECS'], 'w'))
with open(os.environ['FR_OUT_TSV'], 'w') as o:
    for i in want:
        s = specs[i]
        o.write('\t'.join([i, s['language'], s['image_name'].replace('docker.io/', ''), '%s@%s' % (s['repo'].replace('/', '__'), s['base_commit'])]) + '\n')
EOF
}
tsv() { awk -F'\t' -v id="$1" -v c="$2" '$1==id{print $c}' "$TSV"; }   # 2=lang 3=image 4=golden key
merge_ledger() {
  { cat "$LEDGER_BASE" 2>/dev/null; cat "$LEDGER_DIR/ledger.jsonl" 2>/dev/null; } > "$LEDGER"
}

# ---- images ----
tar_for() { local f; for d in $TARDIRS; do f="$d/$(echo "docker.io_$1" | tr '/:' '__').tar"; [ -f "$f" ] && { echo "$f"; return; }; done; }
img_loaded() { docker image inspect "$1" >/dev/null 2>&1; }
vm_free_gb() { colima ssh -- df -k /var/lib/docker 2>/dev/null | awk 'NR==2{print int($4/1048576)}'; }
LOADED_NOW=()
load_image() {   # load from a kept tar when the image is not in the VM; track it so the cell can unload it afterwards
  local img=$1 t; img_loaded "$img" && return 0
  t=$(tar_for "$img"); [ -n "$t" ] || { say "  NO IMAGE and NO TAR for $img: run 'forensic-runs.sh pull' first"; return 1; }
  say "  docker load $(basename "$t")"; run docker load -i "$t" | tail -1; LOADED_NOW+=("$img")
}
ensure_room() {   # $@ = images the next cell needs. Evict tar-backed images the cell does not need until ~4x the tar sizes + 6 GB are free.
  local need=6 img t keep free cand
  for img in "$@"; do img_loaded "$img" && continue; t=$(tar_for "$img"); [ -n "$t" ] && need=$((need + $(stat -f %z "$t") * 4 / 1073741824 + 1)); done
  free=$(vm_free_gb); [ -n "$free" ] || { say "  (cannot read VM free disk; skipping the room check)"; return 0; }
  say "  VM disk free ${free} GB, this cell needs about ${need} GB"
  [ "$free" -ge "$need" ] && return 0
  for cand in $(docker images --format '{{.Repository}}:{{.Tag}}' | grep '^swerebenchv2/'); do
    keep=0; for img in "$@"; do [ "$img" = "$cand" ] && keep=1; done; [ $keep = 1 ] && continue
    [ -n "$(tar_for "$cand")" ] || continue          # never remove an image that has no tar (cannot be reloaded)
    say "  evict $cand (tar kept)"; run docker rmi "$cand" >/dev/null
    [ "$DRY" = 1 ] && continue
    free=$(vm_free_gb); [ "$free" -ge "$need" ] && return 0
  done
  [ "$DRY" = 1 ] && return 0
  free=$(vm_free_gb); [ "$free" -ge "$need" ] || die "not enough VM disk after eviction (${free} GB free, ${need} GB needed): free space by hand (docker image prune of old swebench/* images?)"
}

# ---- per-task readiness: run-pilot's own preflight (ledger + golden + model cache + admission), one task at a time ----
ready_status() {   # echoes "ok" or the failure reasons
  local id=$1 out rc
  out=$(env BENCH_INCLUDE_UNTRACKED=1 RT_ATTACH_REQUIRE_SAME_DIFF=1 TASKS_FILE=$SPECS ARMS=sweet HARNESS=codex MODEL=openai/gpt-6.1-sol PROVIDER=chatgpt-subscription \
        REASONING=high ENV_LEDGER=$LEDGER REPS=1 INSTANCES=$id PREFLIGHT_ONLY=1 node harness/run-pilot.mjs 2>&1); rc=$?
  if [ $rc = 0 ]; then echo ok; return; fi
  local r; r=$(printf '%s\n' "$out" | grep -E "^  $id: " | sed -E "s/^  [^:]+: ([a-zA-Z-]+).*/\1/" | sort -u | paste -sd, -)
  printf '%s\n' "$out" | grep -q 'admission' && r="${r:+$r,}admission"
  echo "${r:-preflight-failed}"
}
plan() {
  build_specs; merge_ledger
  say "ledger: base=$LEDGER_BASE + sweep=$LEDGER_DIR/ledger.jsonl -> $LEDGER"
  printf '%-4s %-42s %-7s %-7s %-9s %s\n' '#' task lang golden image 'readiness (ok = run-pilot preflight passes)'
  local i=0 id g im st
  for id in "${ALL[@]}"; do
    i=$((i+1)); [ "$i" = $((${#PRIMARY[@]}+1)) ] && say "---- reserves ----"
    if [ -f "$GOLDEN/$(tsv "$id" 4)/.sweet-search/codebase.db" ]; then g=local; elif [ -f "$VAULT/$(tsv "$id" 4)/.sweet-search/codebase.db" ]; then g=vault; else g=MISSING; fi
    if img_loaded "$(tsv "$id" 3)"; then im=loaded; elif [ -n "$(tar_for "$(tsv "$id" 3)")" ]; then im=tar; else im=PULL; fi
    st=$(ready_status "$id")
    printf '%-4s %-42s %-7s %-7s %-9s %s\n' "$i" "$id" "$(tsv "$id" 2)" "$g" "$im" "$st"
    echo "$id $st" >> "$TMPDIR/fr-plan.$$"
  done
}
pick_batch() {   # first N ready ids, PRIMARY then RESERVE; writes $BATCH (so every harness runs the same tasks)
  if [ -s "$BATCH" ]; then say "batch file $BATCH exists - using it (delete it to recompute)"; IDS=(); while read -r l; do IDS+=("$l"); done < <(tr ',' '\n' < "$BATCH" | sed '/^$/d'); return; fi
  rm -f "$TMPDIR/fr-plan.$$"; plan >/dev/null
  IDS=(); local id st
  while read -r id st; do [ "$st" = ok ] && [ ${#IDS[@]} -lt "$N" ] && IDS+=("$id"); done < "$TMPDIR/fr-plan.$$"
  say "ready: ${#IDS[@]} of $N wanted"
  while read -r id st; do [ "$st" != ok ] && say "  not ready: $id ($st)"; done < "$TMPDIR/fr-plan.$$"
  rm -f "$TMPDIR/fr-plan.$$"
  [ ${#IDS[@]} -ge "$MIN" ] || die "only ${#IDS[@]} tasks are ready (FR_MIN=$MIN). Run: forensic-runs.sh pull && stage && sweep, then re-run. (FR_MIN=n to accept fewer)"
  (IFS=,; echo "${IDS[*]}" > "$BATCH"); say "batch written: $BATCH"
}

# ---- modes that need no model ----
case $MODE in
  plan) base_guards; rm -f "$TMPDIR/fr-plan.$$"; plan; rm -f "$TMPDIR/fr-plan.$$"; exit 0 ;;
  pull)
    build_specs; mkdir -p "$PULLDIR"
    for id in "${ALL[@]}"; do
      img=$(tsv "$id" 3); img_loaded "$img" && continue; [ -n "$(tar_for "$img")" ] && continue
      out="$PULLDIR/$(echo "docker.io_$img" | tr '/:' '__').tar"
      say "pull $img -> $out"; run python3 "$BENCH/handoffs/improve/harness-prompt-trim/scripts/host_pull.py" "docker.io/$img" "$out" || say "  FAILED: $img"
    done
    exit 0 ;;
  stage)
    build_specs
    for id in "${ALL[@]}"; do
      k=$(tsv "$id" 4)
      if [ -f "$GOLDEN/$k/.sweet-search/codebase.db" ]; then continue
      elif [ -f "$VAULT/$k/.sweet-search/codebase.db" ]; then say "stage $k ($(du -sh "$VAULT/$k" | cut -f1))"; run cp -a "$VAULT/$k" "$GOLDEN/$k"
      else say "NO GOLDEN anywhere for $id ($k)"; fi
    done
    exit 0 ;;
  sweep)
    base_guards; quiet_or_die; build_specs; merge_ledger; mkdir -p "$LEDGER_DIR"; touch "$LEDGER_DIR/ledger.jsonl"
    for id in "${ALL[@]}"; do
      st=$(ready_status "$id")
      case $st in *missing*|*stale*|*not-gold-FULL*) ;; *) continue ;; esac     # golden-only failures are for 'stage', not for the sweep
      say "sweep $id ($st)"
      img=$(tsv "$id" 3); LOADED_NOW=(); ensure_room "$img"; load_image "$img" || continue
      # drop an older verdict of this id so the sweep re-grades it under the current harness
      [ "$DRY" = 1 ] || { grep -v "\"instance_id\":\"$id\"" "$LEDGER_DIR/ledger.jsonl" > "$LEDGER_DIR/ledger.tmp"; mv "$LEDGER_DIR/ledger.tmp" "$LEDGER_DIR/ledger.jsonl"; }
      echo "$id" > "$TMPDIR/fr-sweep.ids"
      run node harness/env-ledger-sweep.mjs --tasks "$SPECS" --ids "$TMPDIR/fr-sweep.ids" --out "$LEDGER_DIR" --batch 1 --max-workers 1
      merge_ledger
    done
    say "sweep done. verdicts: $LEDGER_DIR/ledger.jsonl   (gold-valid = ready; run 'plan' next)"
    exit 0 ;;
  claudecode|codex|opencode) ;;
  *) die "unknown mode $MODE" ;;
esac

# ---------------------------------------------------------------- a model leg
H=$MODE
base_guards
case $H in
  claudecode)
    [ -f "$HOME/.ss-eval/claude-sub.env" ] && { set -a; . "$HOME/.ss-eval/claude-sub.env"; set +a; }
    [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] || die "no CLAUDE_CODE_OAUTH_TOKEN (~/.ss-eval/claude-sub.env)"
    export PATH=$HOME/.ss-eval/bin-claude-2.1.281:$PATH
    [ "$(claude --version | cut -d' ' -f1)" = "2.1.281" ] || die "claude is not 2.1.281"
    MODEL=claude-opus-5-5; PROVIDER=anthropic; REASONING=medium
    HENV=(CC_HARNESS_TRIM=product)           # the product trim; CC_TRIM_BATCH stays unset = read6fs (what init ships)
    HUNSET=(-u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_BASE_URL -u OPENROUTER_API_KEY -u OPENAI_API_KEY)
    EXPECT="about 25-40 min per cell, 5 cells = 2-3 h. Claude subscription (Max plan, shared with the loop session): 20 Opus 5.5 rollouts, about \$8-20 API-equivalent. No cash." ;;
  codex)
    export PATH=$HOME/.ss-eval/bin-codex-0.159.2:$PATH
    [ "$(codex --version | awk '{print $2}')" = "0.159.2" ] || die "codex is not 0.159.2"
    [ -f "$HOME/.codex/auth.json" ] || die "no ~/.codex/auth.json (ChatGPT login)"
    age=$(python3 - <<'EOF'
import json, os, time, datetime
d = json.load(open(os.path.expanduser('~/.codex/auth.json')))
lr = d.get('last_refresh', '')
try: t = datetime.datetime.fromisoformat(lr.replace('Z', '+00:00')).timestamp()
except Exception: t = 0
print(int((time.time() - t) / 86400))
EOF
)
    if [ "${age:-999}" -gt 7 ] && [ "${FR_ALLOW_STALE_AUTH:-0}" != 1 ]; then
      die "~/.codex/auth.json last_refresh is ${age} days old. Codex is believed to refresh after about 8 days (not verified); this runner has no auth write-back, so 4 concurrent rollouts would race on one single-use refresh token and every rollout would die with 0 calls. Refresh the login yourself (interactive codex), or FR_ALLOW_STALE_AUTH=1."
    fi
    MODEL=openai/gpt-6.1-sol; PROVIDER=chatgpt-subscription; REASONING=high
    # SS_CODEX_PRIVATE_HOME=1: private HOME + CODEX_HOME per rollout (only the ChatGPT login is copied in). Without it the unjailed Mac
    # rollout reads ~/.codex/config.toml (MCP servers, notify hook), ~/.codex/AGENTS.md and ~/.agents/skills.
    HENV=(CODEX_SUBSCRIPTION=1 SS_CODEX_PRIVATE_HOME=1)
    HUNSET=(-u OPENAI_API_KEY -u OPENROUTER_API_KEY -u ANTHROPIC_API_KEY)   # no key may route a subscription leg to metered billing
    EXPECT="about 25-45 min per cell, 5 cells = 2-4 h (Sol, high effort). ChatGPT subscription: 20 Sol rollouts, about \$4-12 API-equivalent. No cash. A usage-limit hit stops the script." ;;
  opencode)
    [ -n "${OPENROUTER_API_KEY:-}" ] || die "no OPENROUTER_API_KEY in the environment"
    export PATH=$HOME/.ss-eval/bin-opencode-1.18.4:$PATH
    [ "$(opencode --version | tail -1)" = "1.18.4" ] || die "opencode is not 1.18.4"
    MODEL=${FR_OC_MODEL:-openai/gpt-5.6-luna}; PROVIDER=openrouter; REASONING=medium   # the model every hill-climb opencode cell used
    HENV=()
    HUNSET=(-u OPENAI_API_KEY -u ANTHROPIC_API_KEY)
    EXPECT="about 25-40 min per cell, 5 cells = 2-3 h. OpenRouter CASH (the task runner has no subscription path): about \$0.5-2 for 20 Luna rollouts (hill-climb mean \$0.014 per short rollout)." ;;
esac
quiet_or_die
build_specs; merge_ledger
# Every other switch of every harness is unset so the sweet arm is the shipped product. SS_VARIANT_* are removed by name from the environment.
SVAR=(); for v in $(env | sed -n 's/^\(SS_VARIANT_[A-Za-z0-9_]*\)=.*/\1/p'); do SVAR+=(-u "$v"); done
UNSET=("${SVAR[@]+"${SVAR[@]}"}" -u CC_HARNESS_TRIM -u CC_TRIM_BATCH -u CC_PRODUCT_STEER -u CC_PRODUCT_TOKREM -u CC_PRODUCT_SKILLDESC -u CC_PRODUCT_HOOKPLUG
  -u CODEX_HARNESS_TRIM -u CODEX_TRIM_BATCH -u OC_HARNESS_TRIM -u SWEET_RULES_PLACEMENT -u MPP -u MAX_TOOL_CALLS -u SS_BENCH_NO_USD -u SS_CODEX_PRIVATE_HOME
  -u CODEX_SUBSCRIPTION -u CODEX_HOME -u SS_SKIP_ENV_LEDGER -u SS_SKIP_GOLDEN_CHECK -u SS_ALLOW_BLOCKED_TASKS "${HUNSET[@]}")
COMMON=(BENCH_INCLUDE_UNTRACKED=1 RT_ATTACH_REQUIRE_SAME_DIFF=1 TASKS_FILE=$SPECS ARMS=sweet HARNESS=$H MODEL=$MODEL PROVIDER=$PROVIDER REASONING=$REASONING
  ENV_LEDGER=$LEDGER REPS=1 AGENT_TIMEOUT_MS=${FR_AGENT_TIMEOUT_MS:-3600000})

if [ "$DRY" = 1 ]; then
  say "DRY RUN ($H): readiness is not required in dry mode; the cells below are the PRIMARY list in order."
  IDS=("${PRIMARY[@]}")
else
  pick_batch
fi
say "harness=$H model=$MODEL reasoning=$REASONING provider=$PROVIDER tasks=${#IDS[@]} cell=$CONC stamp=$STAMP"
say "expected: $EXPECT"
MANIFEST=results/fr-$H-$STAMP.manifest; STATUS=results/fr-$H-$STAMP.status

cellno=0; i=0
while [ $i -lt ${#IDS[@]} ]; do
  cell=("${IDS[@]:$i:$CONC}"); i=$((i+CONC)); cellno=$((cellno+1)); run="fr-$H-$STAMP-C$cellno"
  if grep -q "^$run done" "$STATUS" 2>/dev/null; then say "skip $run (done)"; continue; fi
  csv=$(IFS=,; echo "${cell[*]}")
  say ""; say "== $run: $csv"
  imgs=(); for id in "${cell[@]}"; do imgs+=("$(tsv "$id" 3)"); done
  LOADED_NOW=(); ensure_room "${imgs[@]}"
  ok=1; for img in "${imgs[@]}"; do load_image "$img" || ok=0; done
  [ $ok = 1 ] || { [ "$DRY" = 1 ] || die "missing image for $run: stop"; }
  if [ "$DRY" = 1 ]; then
    printf 'DRY: env'; printf ' %q' "${UNSET[@]}" "${COMMON[@]}" ${HENV[@]+"${HENV[@]}"} "INSTANCES=$csv" "CONCURRENCY=${#cell[@]}" "RUN_ID=$run"; echo ' node harness/run-pilot.mjs'
    continue
  fi
  echo "$run $csv" >> "$MANIFEST"
  say "$(date +%T) launching $run"
  env "${UNSET[@]}" "${COMMON[@]}" ${HENV[@]+"${HENV[@]}"} INSTANCES=$csv CONCURRENCY=${#cell[@]} RUN_ID=$run node harness/run-pilot.mjs > "results/$run.log" 2>&1
  rc=$?
  echo "$run done rc=$rc $(date +%T)" >> "$STATUS"
  say "$(date +%T) $run exited rc=$rc"
  if [ "${FR_KEEP_IMAGES:-0}" != 1 ]; then for img in "${LOADED_NOW[@]+"${LOADED_NOW[@]}"}"; do docker rmi "$img" >/dev/null 2>&1 && say "  unloaded $img (tar kept)"; done; fi
  if grep -q -i -E "account fatal|usage limit|refresh token was already used" "results/$run.log"; then
    grep -m1 -i -E -o "(account fatal|usage limit|refresh token was already used).*" "results/$run.log" | cut -c1-200; say "stopping: account/usage problem (re-run with the same FR_STAMP=$STAMP to resume)"; exit 9
  fi
done
[ "$DRY" = 1 ] && exit 0

# ---- read-out: one line per rollout. Check harnessTrim / exitReason / calls = 0 before reading anything else. ----
python3 - "$STAMP" "$H" <<'EOF'
import json, glob, sys
stamp, h = sys.argv[1], sys.argv[2]
rows = []
for f in sorted(glob.glob('results/fr-%s-%s-C*/rows.json' % (h, stamp))):
    try: rows += json.load(open(f))
    except Exception as e: print('unreadable', f, e)
print('\nrollouts: %d   solved: %d   zero-call: %d' % (len(rows), sum(1 for r in rows if r.get('resolved')), sum(1 for r in rows if not r.get('calls'))))
print('%-42s %5s %5s %5s %7s %-9s %s' % ('task', 'calls', 'ss', 'turns', 'wall_m', 'solved', 'exit / trim'))
for r in rows:
    print('%-42s %5s %5s %5s %7.1f %-9s %s / %s' % (r['taskId'], r.get('calls'), r.get('ss'), r.get('idealTurns'), (r.get('wallMs') or 0) / 60000, r.get('resolveStatus') or r.get('resolved'), r.get('exitReason'), r.get('harnessTrim')))
EOF
say "manifest: $BENCH/$MANIFEST   status: $BENCH/$STATUS"
