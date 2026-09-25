#!/usr/bin/env bash
# Harness-trim micro-smoke on the owner's Mac — SWEET ARM ONLY, two conditions:
#   as-now = sweet exactly as the held-out legs ran it (trim switch 0)
#   TRIM   = the same + the harness trim (switch 1). The sweet rules file, the override and
#            the frame are byte-identical in both. Native is not run: it never gets the trim.
# 3 dev tasks (DEV-RET, none in HO2) x 2 conditions x 2 reps = 12 rollouts per harness, as four
# legs in A-B-B-A order so a drift over the session falls on both conditions.
#
#   bash mac-smoke.sh claudecode   # Opus 5.5 medium on the owner's subscription (claude 2.1.281)
#   bash mac-smoke.sh codex        # openai/gpt-5.6-luna via OpenRouter (codex 0.146.1)
#   bash mac-smoke.sh opencode     # openai/gpt-5.6-luna via OpenRouter (opencode 1.18.4)
#
# Claude Code needs ~/.ss-eval/claude-sub.env with CLAUDE_CODE_OAUTH_TOKEN=... (from
# `claude setup-token`, written by the owner; the token never goes into chat). The box's HIGH
# leg shares that subscription; a usage-limit hit stops this script, finished rows are kept.
# Never run two of these at once (one run-pilot per machine).
set -u
H=${1:?usage: mac-smoke.sh claudecode|codex|opencode [trim-value]}
ON=${2:-1}   # trim value for the TRIM legs: 1, or max (claudecode/opencode)
REPO=/Users/admin/Projects/sweet-search-private
BENCH=$REPO/eval/task-completion-bench
cd "$BENCH" || exit 2

export DOCKER_HOST=unix:///Users/admin/.colima/default/docker.sock   # agent-runner-shared defaults to /var/run/docker.sock
export TMPDIR=$HOME/.ss-eval/tmp                                   # Colima shares only $HOME with the VM
export SR_EVAL_DIR=$HOME/swe-rebench-tools/SWE-rebench-V2          # box commit c71902a8
export SS_ISOLATION=0                                              # no Linux jail on macOS; disclosed
export SWEET_SEARCH_NATIVE_INFERENCE=0 SWEET_SEARCH_COREML_CASCADE=0  # ORT INT8 queries, same as the box-built goldens
export NO_IMAGE_GC=1                                               # the VM cannot re-pull a deleted image
mkdir -p "$TMPDIR"

case $H in
  claudecode)
    if [ "${CC_BACKBONE:-opus}" = luna ]; then
      # Claude Code driving Luna through OpenRouter's Anthropic-compatible API (as the Luna
      # claude-code leg did): isolates harness effects from the Claude model.
      [ -n "${OPENROUTER_API_KEY:-}" ] || { echo "no OPENROUTER_API_KEY"; exit 2; }
      export PATH=$HOME/.ss-eval/bin-claude-2.1.281:$PATH
      [ "$(claude --version | cut -d' ' -f1)" = "2.1.281" ] || { echo "claude is not 2.1.281 via the shim"; exit 2; }
      MODEL=openai/gpt-5.6-luna; PROVIDER=openrouter; SWITCH=CC_HARNESS_TRIM; H_TAG=claudecode-luna
    else
    [ -f "$HOME/.ss-eval/claude-sub.env" ] && { set -a; . "$HOME/.ss-eval/claude-sub.env"; set +a; }
    [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] || { echo "no CLAUDE_CODE_OAUTH_TOKEN (write ~/.ss-eval/claude-sub.env)"; exit 2; }
    export PATH=$HOME/.ss-eval/bin-claude-2.1.281:$PATH
    [ "$(claude --version | cut -d' ' -f1)" = "2.1.281" ] || { echo "claude is not 2.1.281 via the shim"; exit 2; }
    MODEL=claude-opus-5-5; PROVIDER=anthropic; SWITCH=CC_HARNESS_TRIM
    fi ;;
  codex)
    [ -n "${OPENROUTER_API_KEY:-}" ] || { echo "no OPENROUTER_API_KEY"; exit 2; }
    export PATH=$HOME/.ss-eval/bin-codex-0.146.1:$PATH
    [ "$(codex --version | awk '{print $2}')" = "0.146.1" ] || { echo "codex is not 0.146.1 via the shim"; exit 2; }
    MODEL=openai/gpt-5.6-luna; PROVIDER=openrouter; SWITCH=CODEX_HARNESS_TRIM ;;
  opencode)
    [ -n "${OPENROUTER_API_KEY:-}" ] || { echo "no OPENROUTER_API_KEY"; exit 2; }
    export PATH=$HOME/.ss-eval/bin-opencode-1.18.4:$PATH
    [ "$(opencode --version | tail -1)" = "1.18.4" ] || { echo "opencode is not 1.18.4 via the shim"; exit 2; }
    MODEL=openai/gpt-5.6-luna; PROVIDER=openrouter; SWITCH=OC_HARNESS_TRIM ;;
  *) echo "unknown harness $H"; exit 2 ;;
esac

if pgrep -f "harness/run-pilo[t].mjs" >/dev/null; then echo "another run-pilot is running — one at a time"; exit 2; fi
if pgrep -x sweet-search-daemon >/dev/null || pgrep -x sweet-search-maintainer >/dev/null; then
  echo "ss-* daemons are running (CPU ORT and the GPU path must not coexist):"
  pgrep -xl sweet-search-daemon; pgrep -xl sweet-search-maintainer
  echo "stop them (pkill -x sweet-search-daemon; pkill -x sweet-search-maintainer) and re-run"; exit 2
fi
for t in "$HOME"/.ss-eval/image-tars/*.tar; do
  img=$(basename "$t" .tar | sed -E 's#^docker.io_swerebenchv2_#swerebenchv2/#; s#_([^_]+)$#:\1#')
  docker image inspect "$img" >/dev/null 2>&1 || docker load -i "$t" | tail -1
done

TASKS=gitbookio__markup-it-56,pytask-dev__pytask-210,jensneuse__graphql-go-tools-174
LEDGER=$BENCH/results/ledger-trim-mac-20260925c/ledger.jsonl
STAMP=$(date +%Y%m%d-%H%M)
RUNS=()
# Neutral run ids: on the Mac the run id is part of paths the agent sees (the memory path in
# Claude Code's system prompt), so it must not name the condition. Rows carry harnessTrim.
N=0
for LEG in asnow-r1:0 trim-r1:$ON trim-r2:$ON asnow-r2:0; do
  NAME=${LEG%%:*}; TRIM=${LEG##*:}; N=$((N+1))
  RUN=hsmoke-${H_TAG:-$H}-$STAMP-L$N
  echo "$(date +%T) launching $RUN = $NAME ($SWITCH=$TRIM)"
  env "$SWITCH=$TRIM" TASKS_FILE=select/.cache/tasks_full_heldout.json INSTANCES=$TASKS \
    ARMS=sweet REPS=1 CONCURRENCY=1 HARNESS=$H MODEL=$MODEL PROVIDER=$PROVIDER \
    REASONING=medium RUN_ID=$RUN ENV_LEDGER=$LEDGER \
    node harness/run-pilot.mjs > "results/$RUN.log" 2>&1
  RC=$?
  echo "$(date +%T) $RUN exited rc=$RC"
  RUNS+=("results/$RUN")
  if grep -q "account fatal" "results/$RUN.log"; then
    grep -m1 -o "account fatal.*" "results/$RUN.log"; echo "stopping: account/usage problem"; break
  fi
done

python3 handoffs/improve/harness-prompt-trim/scripts/analyze_trim_smoke.py "${RUNS[@]}" | tee "results/hsmoke-${H_TAG:-$H}-$STAMP-report.txt"
