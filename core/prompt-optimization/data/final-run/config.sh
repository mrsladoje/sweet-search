# final-run/config.sh — shared settings for the PLAN.md §7 final comparison (sourced by the scripts here).
# Override any value from the environment.
FR_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FINAL_ROOT="${FINAL_ROOT:-$(cd "$FR_HERE/../../../.." && pwd)}"            # final code = this worktree (branch final-prep)
BEFORE_ROOT="${BEFORE_ROOT:-/Users/admin/Projects/sweet-search-before}"     # detached worktree of the "before" commit
BEFORE_COMMIT="${BEFORE_COMMIT:-d013b492}"                                  # state before the obs loop
MAIN_ROOT="${MAIN_ROOT:-/Users/admin/Projects/sweet-search-private}"         # owns node_modules, models/, eval/repos
FR_STATE="${FR_STATE:-$HOME/.ss-eval/final-run}"                            # logs, step state, build stamps
BEFORE_REPOS="${BEFORE_REPOS:-$HOME/.ss-eval/final-before-repos}"           # before-arm source repos (copies + before-built index)
AFTER_REPOS="${AFTER_REPOS:-$FINAL_ROOT/eval/repos}"
AFTER_COPY="${AFTER_COPY:-$HOME/.ss-eval/final-after-repos}"                    # private copies of AFTER_REPOS the run reads (another session uses eval/repos)                        # after-arm source repos = eval/repos (PLAN §6.1 index)
QUESTIONS="${QUESTIONS:-$FR_HERE/questions.json}"
FR_CELLS="${FR_CELLS:-codex-sol61-high oc-sol61-high cc-opus55-medium}"
FR_TAG="${FR_TAG:-final}"                                                   # results: core/prompt-optimization/data/results/r282-<cell>-<tag>-r<rep>
FR_CONC="${FR_CONC:-3}"
# Bench env, as obs-loop/ab.sh (judges via OpenRouter DeepSeek; no USD content panel — the report needs cost, calls, score).
FR_COMMON_ENV="SWEET_SEARCH_MAX_DAEMONS=8 SS_BENCH_STABLE_RULES_PATH=1 SS_JUDGE_DEEPSEEK_VIA_OPENROUTER=1 SS_BENCH_NO_USD=1 SWEET_SEARCH_VOCAB_AUTO_EXPAND=0"
# opencode: both sweet products ship the cache-key plugin (init, since a3c0cc6c, in both commits); native = stock opencode.
FR_OC_ARM_ENV="sweet:SS_VARIANT_OC_CACHE_KEY=product;before:SS_VARIANT_OC_CACHE_KEY=product"
fr_repos() { node -e 'const q=require(process.argv[1]); console.log([...new Set(q.probes.map(p=>p.repo))].sort().join(" "))' "$QUESTIONS"; }
fr_ids() { node -e 'const q=require(process.argv[1]); console.log(q.probes.map(p=>p.id).join(","))' "$QUESTIONS"; }
# Index / bench / model jobs that must not overlap an index build (and that an index build must not overlap).
fr_busy() { pgrep -fl "run-pilot|retrieval-bench|index-codebase|index-maintainer|run_benchmark" | grep -v "pgrep" || true; }
