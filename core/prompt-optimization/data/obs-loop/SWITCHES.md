# Experiment switches — inventory and decisions (PLAN 5, 2026-10-03)

Branch `plan-switches` (from `plan-diet` 4c2a0e2f). Rule: nobody uses the product, so a decided
switch is deleted together with its losing code path and its tests. An old bench row is
reproduced from its git commit (retrieval-bench rows stamp `gitCommit`; they now also stamp every
`SS_VARIANT_*` / `SS_FIX_*` value in `variants`).

Default output check: 146 golden cases of the real ss-* tool code (ss-grep, ss-find, ss-search,
ss-semantic, ss-trace, ss-read, the daemon agent text; default env plus the kept switches) gave
the same stdout, stderr, exit code and engine request before and after the deletion. The only
request difference is the three deleted engine options (`grepFileOrder`, `grepFileWeight`,
`grepLineClasses`), which the engine now applies without being asked.

## Deleted — default ON (only the ON path is kept)

| Switch | Default | What it did | Decision | Deleted with it |
|---|---|---|---|---|
| `SS_FIX_A` | ON (69c8e2fe) | Bundle A umbrella: A1 one-line header, no score / kind / budget / route lines; A2 one-line summary entries and covered-summary dedupe; A7 imports dedupe; implies A4, A5 | Shipped (Opus −7.1 % cost, sig.) | non-compact ss-search / ss-find printers, `resultRenderFixActive`, route trailer on stdout |
| `SWEET_SEARCH_COMPACT_OUTPUT` | compact | product opt-out `=0` → previous output | PLAN 5.3 / D2: delete | legacy daemon agent-text renderer |
| `SS_FIX_TRACE_COMPACT` (A4) | ON | compact ss-trace, definition fallback | Shipped with A | full `formatStructuralContext` output in ss-trace, meta line on stdout |
| `SS_FIX_GREP_RETRY` (A5) | ON | regex repair per alternative, one case-insensitive retry | Shipped with A | the no-retry path |
| `SS_FIX_GREP_ALLOC` | ON (5943d4ec) | weighted file selection, Sainte-Laguë lines | Shipped | path-order file walk, round-robin `allocateGrepBudget`, `fileOrder` request param |
| `SS_FIX_GREP_WEIGHT=sat2` | ON (945a9664) | weight hits / (hits + 2) × prior | Shipped | sqrt weight, `fileWeight` param |
| `SS_FIX_GREP_ALLOC_RULE=guarantee` | ON (945a9664) | one line per kept file first | Shipped | plain Sainte-Laguë `allocateGrepLinesSainteLague`, Huntington–Hill control |
| `SS_FIX_GREP_LINES` | ON (945a9664) | declaration lines first (line classes) | Shipped | `lineClasses` param; the engine stamps classes for every agent-format ss-grep |
| `SS_FIX_SEMANTIC_RANGES` | ON (945a9664) | exact printed ranges, `# not shown` lines | Shipped | ss-semantic legacy cut; `readSemantic({exactRanges})` stays for the read-semantic CLI and MCP, which keep their own default |
| `SS_FIX_TRACE_MODE_BUDGET` | ON (945a9664) | mode word's section takes the budget | Shipped | ss-trace always passes `modeSection`; the option stays in structural-context for other callers |
| `SS_VARIANT_CC_RULES_IN_PROMPT` | unset = `2` (V1b pointer) | `0` 2.8.2 full rules file, `1` V1 no rules file | V1b shipped (070c0e47) | `resolveClaudeRulesLayout`, the `0` / `1` layouts in init, lean harness, task runner and retrieval bench; init warning for bad values |

## Deleted — default OFF (switch, feature code, variant files and tests)

| Switch | What it did | Decision | Deleted with it |
|---|---|---|---|
| `SS_FIX_ALREADY_SHOWN` (A3) | "already shown" omission in ss-search / ss-find | Not shipped (thread key cannot tell a subagent from its parent) | A3 ledger namespace, `resolveThreadKey`, `decideAlreadyShown`, `collectAgentShownSpansIndexed` |
| `SS_FIX_DROP_SUFFICIENCY` | drop `# sufficient=YES` | Never run; owner: the rules use the line | `drop` option |
| `SS_FIX_SUMMARY_CAP` (B1) | cap summary-only entries | REJECTED | `(+N lower-ranked entries not shown)` path |
| `SS_FIX_ONE_PER_FILE` (B2) | one ss-search entry per file | Not shipped | `also in this file:` line |
| `SS_FIX_GREP_ORDER` (B7) | source before tests, per-file line lists at ≥ 50 hits | Not shipped; the weighted rule replaced it | `orderSourceBeforeTests`, `renderGrepLineLists`, `matchTextIsRepeated`, `dropRepeatedText` |
| `SS_FIX_SEARCH_FIRST_UNIT` | 60-token units for ranks 4–5 | Owner: token bloat (plan-arms memory) | first-unit allocation in context-expander, `firstUnit` param, `eval/search-allocation-measure/replay.mjs` |
| `SS_FIX_SEMANTIC_PICK` | excerpt around the best chunk | Owner: weak gain, tuned on the same calls | `pickExcerptRange`, `pick` param, `eval/semantic-range-replay/` |
| `SS_VARIANT_SEARCH_DEDUPE` (V3) | v3 summary dedupe on the legacy printer | Below MDE; A2 dedupe shipped instead | v3 dedupe, `final-tuning/scripts/replay-dedupe.mjs` |
| `SS_VARIANT_SENTINEL` | proof line that a run uses the worktree | Infra check, done | the line |
| `SS_VARIANT_PRUNE3` (V2) | drop ss-find / ss-semantic / ss-trace | REJECTED (Codex accuracy −1.9 pt, sig.) | pruned bin dir, `final-tuning/variants/rules-prune3.md` |

Arm-comparison harnesses whose arms no longer exist were deleted too:
`eval/grep-allocation-replay/{replay,replay-core,fidelity,collect,engine-matches}.mjs`, `prereg.json`,
and `scripts/benchmark-grep-allocation.js` (old-vs-new speed). `lib.mjs` and `provenance.mjs` stay
(the trace and search measurement harnesses use them).

Already gone before this pass: `SS_FIX_RULES_V2` (2e316865). Never read by code: `SS_VARIANT_RANKSHAPE`
(only in the historical `final-tuning/scripts/launch.sh`).

## Kept — still under test or bench plumbing

| Switch | Default | Why kept |
|---|---|---|
| `SS_FIX_GREP_FULLLINE` | ON (`0` = matched text) | PLAN 3.1 decides it; 3.3 deletes it with the matched-substring path |
| `SS_VARIANT_GREP_BROAD=<hits>:<chars>` | off | PLAN 3.1 broad-grep A/B |
| `SS_VARIANT_RULES_FILE` | off | rules A/B (PLAN 2) |
| `SS_READ_GUTTER` (+ `SS_READ_LINENUMS`) | per harness | gutter forms, PLAN 3.2 |
| `SS_BENCH_STABLE_RULES_PATH`, `SS_BENCH_NO_USD`, `SS_BENCH_ALLOW_NET` | off | bench plumbing, not arms |
| `CC_HARNESS_TRIM`, `CC_TRIM_BATCH`, `CODEX_TRIM_BATCH`, `OC_HARNESS_TRIM`, `SWEET_RULES_PLACEMENT`, `MPP` | product values | the task bench needs them to run its current product harness and cells |
| `SWEET_SEARCH_OC_CACHE_KEY`, `SWEET_SEARCH_OC_CACHE_SHARDS` | plugin on | settings of the shipped opencode plugin, not arms |

## Unclear — kept, recommendation for the owner

| Switch | Default | Recommendation |
|---|---|---|
| `SS_VARIANT_OC_CACHE_KEY` (unset / `repo` / `product`) | unset = no plugin in the bench | The product plugin ships. Delete `repo`; make the opencode sweet arm always use the product plugin and native none — after you confirm that fairness rule, because it changes every opencode bench run. |
| `SS_SIBLING_LINE=0` | ON | Shipped default ON (sibling line); delete the opt-out. |
| `SS_UNREAD_ABOVE=0` | ON | Same: delete the opt-out. |
| `SS_READ_SPAN_EXPAND=1` | OFF | DEAD-LEVER B12 (inverted live): delete with the `spanExpand` code. |
| `SS_READ_WINDOW=<n>` | OFF (parked) | Owner call: delete, or keep for one more read-window test. |
| `SS_SMOKE_SEARCH_BUDGET`, `SS_SMOKE_FIND_BUDGET`, `SS_SMOKE_TRACE_BUDGET`, `SS_SMOKE_SEMANTIC_MAXTOKENS` | off | Budget-sweep hooks; delete unless a sweep is planned. |
| `CC_PRODUCT_STEER`, `CC_PRODUCT_TOKREM`, `CC_PRODUCT_SKILLDESC`, `CC_PRODUCT_HOOKPLUG` | off | Claude Code trim research variants; delete if the harness hill-climb is closed (memory says CLOSED). |
| `SS_NO_CMD_CONDENSE`, `SS_NO_ANTITHRASH`, `SS_RT_LONGYIELD=0`, `SS_RUNTESTS_DEDUP=0` | levers ON | Task-bench opt-outs of shipped levers; delete after an owner yes. |
| `SWEET_SEARCH_SHOWN_SPAN_TRAILER`, `SWEET_SEARCH_EXACT_REREAD_OMISSION` | product features | Product settings, not arms; review separately. |

Historical scripts under `core/prompt-optimization/data/final-tuning/scripts/` (task-guard, forensic
runs) still name deleted switches in `env -u` lists; they ran at their own commits and are not edited.
`OBSERVATIONS.md` and the data notes keep their switch names as history.
