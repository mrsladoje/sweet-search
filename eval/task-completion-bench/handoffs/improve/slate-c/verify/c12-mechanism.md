# c12 — mechanism verification (adversarial): NOT refuted, with five corrections

Candidate: "Make the shipped contact surface reachable: `bin` entries for the six `ss-*` wrappers plus an init-written permission allowlist" (merged from R13, `candidates/real-user-product.md`).
Lens: mechanism. Date: 2026-09-02. Verifier scratch: `/tmp/wf-slatec/c12-mechanism/` on the box, plus the local scratchpad.

## 0. Verdict

The defect is real and the candidate survives. I ran the candidate's own `$0` falsifier. After a clean install of the packed `sweet-search-2.7.2.tgz` into a scratch prefix, `command -v` resolves `sweet-search` and `sweet-search-mcp` and reports NOT FOUND for all six `ss-*` names `[M]`. The six wrapper files sit inside the installed package with no shim `[M]`. The published registry copy has the same two-entry `bin` map `[M npm view sweet-search@2.7.2]`. The tool guide that `init` installs names the bare commands `ss-grep`, `ss-search`, `ss-read`, `ss-find`, `ss-semantic`, `ss-trace` `[C]`. So a real user who follows the README gets a guide for six commands their shell cannot find. The bench never sees this because `buildAgentEnv` prepends the wrapper directory to PATH `[C agent-runner-shared.mjs:137-141]`.

The trace evidence cited by the candidate does not show this mechanism. No trace can: the bench supplies PATH, and the 66 sweet rollouts contain zero `ss-*` "command not found" results `[M]`. The traces only measure exposure (how often and how many distinct `ss-*` names a rollout calls). The mechanism is established by packaging facts, which is the right evidence class for a deterministic packaging defect.

The ceiling arithmetic is inflated but within a factor of two. The "three failed discovery requests = 10.1%" figure prices a discovery request at the whole-rollout average ($0.00070) `[M]`. Discovery failures happen at request 2 to 4, where a request costs $0.00040 to $0.00045 `[M]`. Three such requests are 5.8% to 6.6% of the $0.020727 cell, not 10.1%. The eight real "command not found" episodes in this run (three sweet, five native, none for `ss-*`) took one or two requests each before the agent moved on `[M]`. The candidate's `[W]` cache claim is verified verbatim `[W]`.

## 1. Claim-by-claim check

| # | candidate claim | verdict | evidence |
|---|---|---|---|
| 1 | `package.json` v2.7.2 `bin` has only `sweet-search` and `sweet-search-mcp`; `directories` undefined | confirmed `[C]` `[M]` | local `package.json`; `npm view sweet-search@latest bin` returns the same two entries, version 2.7.2 |
| 2 | six wrappers ship in `files` only | confirmed `[C]` `[M]` | `files` lists `eval/agent-read-workflows/bin/{ss-search,ss-find,ss-grep,ss-semantic,ss-trace,ss-read,_ss-helpers.mjs,_ss-argparse.mjs,_ss-env.sh}`; `npm pack --dry-run --json` shows the same nine paths in 284 files; `ss-batch` absent |
| 3 | `grep PATH scripts/init.js` = 0 lines | confirmed `[M]` | 0 lines; `scripts/hooks/` also 0; no script under `scripts/` references `agent-read-workflows/bin` |
| 4 | `init` writes `.claude/settings.json` but no `permissions.allow` for `ss-*` | confirmed `[C]` | `init.js` writes `hooks.SessionStart` / `hooks.SessionEnd` (lines 1017-1066) and the output style; the only `permissions` writer is `install-tool-enforcement.js:142-155`, a `deny: ['Grep']`, gated by `--enforce-tools` (line 38) |
| 5 | `resolveActiveHarnesses` defaults to claude-code only | confirmed `[C]` | `scripts/init.js:245-253`; README documents `--agents` as opt-in |
| 6 | bench prepends `ssBinDir` to PATH; runner uses `bypassPermissions` | confirmed `[C]` | `agent-runner-shared.mjs:137-141` (`buildAgentEnv`); `claude-code-task-runner.mjs:95` |
| 7 | 16.04 Bash envelopes/rollout, 31.1% chained, median 3 distinct names, 71 transcripts | replicated exactly; denominator and chain count need correction `[M]` | §2.2, §2.3 |
| 8 | F3: "discovery-less callers spend 13 discovery calls, fail 14.0%" | numbers real, phrasing misleading, mechanism different `[M]` | §2.6 |
| 9 | scoped allow rules keep the cache; a bare tool-name deny breaks it | confirmed `[W]` | §2.7 |
| 10 | three discovery requests add 10.1% of the claude-code cell | overstated 1.5x to 1.7x; within the factor-two bar `[M]` | §2.4, §2.5 |
| 11 | guide cost +3.1% to +4.4% | correct numbers, mixed denominators `[M]` | §2.4 |
| 12 | bench effect zero; solves not traded | confirmed `[C]` `[I]` | PATH supplied on both bench arms; fix touches no ranking or rendering path |

## 2. Re-derivations

### 2.1 The falsifier, run locally at $0

Commands (local repo, HEAD `1a00765`, package version 2.7.2):

1. `npm view sweet-search@latest version bin --json` -> `{"version":"2.7.2","bin":{"sweet-search":"core/cli.js","sweet-search-mcp":"mcp/server.js"}}` `[M]`.
2. `npm pack --dry-run --json` -> 284 files, 1,981,758 bytes; the nine wrapper-directory files are present; `eval/agent-read-workflows/bin/ss-batch` is absent `[M]`.
3. `npm pack --pack-destination <scratch>/pack --ignore-scripts` then `npm install -g --prefix <scratch>/prefix --ignore-scripts --omit=dev <tgz>` -> "added 187 packages in 3s" `[M]`.
4. `<scratch>/prefix/bin` holds exactly two sweet-search links: `sweet-search -> ../lib/node_modules/sweet-search/core/cli.js`, `sweet-search-mcp -> ../lib/node_modules/sweet-search/mcp/server.js` `[M]`.
5. With `PATH=<scratch>/prefix/bin:$PATH`: `command -v ss-grep`, `ss-search`, `ss-read`, `ss-find`, `ss-semantic`, `ss-trace` -> NOT FOUND, all six `[M]`.
6. `ls <prefix>/lib/node_modules/sweet-search/eval/agent-read-workflows/bin/` lists the six wrappers and three helpers `[M]`.

The kill condition ("withdraw if `command -v ss-grep` resolves") does not fire. Part (b)'s kill condition ("drop if a fresh init already writes an allow entry") also does not fire, by code reading: no `permissions.allow` writer exists in `scripts/` `[C]`. I did not run `sweet-search init` in a scratch repo, because it downloads models and starts daemons; the code reading is conclusive for what it writes.

Two further packaging facts `[C]`: `_ss-helpers.mjs` imports `../../../core/...`, which resolves to the package root inside the npm layout, so the wrappers would work if invoked by absolute path from the global install directory. The wrapper `sweet-search` in the same directory is labelled a "bench-local shim ... without requiring a global install", and `_ss-env.sh` is labelled "COMMON BENCHMARK-HARNESS ENVIRONMENT". The wrappers were written as bench tooling and were never given a product install path.

### 2.2 The perm.py census and its denominator

I re-ran `/tmp/wf-slatec/real-user-product/perm.py` unchanged and reproduced it exactly: 71 files, mean 16.04, median 14.0, total 1,139 Bash envelopes; 354 chained = 31.1%; distinct `ss-*` names mean 3.46, median 3.0, max 6 `[M]`.

The denominator is session files, not rollouts. The run has 66 sweet rollouts (22 tasks x 3 reps, `rows.json`) `[M]`. Nineteen task directories hold 3 session files; `aio-libs__aiohttp-8038` holds 5, `protofire__solhint-224` holds 5, `fastify__fastify-cors-285` holds 4 `[M]`. The five extra files are retried or re-run sessions (`rows.json` carries `startRetried` and `degenReran` fields). Their cost is in the ledger, so they belong to rollouts. Per rollout the count is therefore between 16.2 (my 66-largest-file mapping: mean 16.17, median 13.5, total 1,067) and 17.3 (1,139 / 66) `[M]`. The candidate's 16.04 is per session file and understates per-rollout exposure by 1% to 7%. Not material, but the synthesis should say "per rollout, 16 to 17".

Every one of the 66 rollouts made at least one `ss-*` call; mean 12.0 `ss-*` envelopes per rollout `[M c12_check.py]`.

### 2.3 The chained-envelope share is 20%, not 31%

`perm.py` counts an envelope as chained when the raw command contains `&&`, `||`, `;` or `|`. A `|` inside a quoted regex argument, for example `ss-grep "foo|bar"`, is not a shell chain. After removing single- and double-quoted segments, 228 of 1,139 envelopes chain = 20.0% (66-file mapping: 19.3%) `[M c12_check.py]`. The candidate itself flagged the compound-command permission analyser as unverified `[I]`; the exposure it applies to is 20%, not 31%.

### 2.4 The 10.1% figure uses the wrong request price

Main-thread request economics, 66 sweet rollouts, registered luna price (0.10 in / 0.01 cached / 0.60 out per million), usage taken once per `message.id` `[M c12_check.py]`:

| quantity | value |
|---|---|
| requests per rollout (main thread) | mean 23.8, median 18 |
| main-thread cost per rollout | $0.016211 (66 x = $1.0699; the ledger's main-thread total is $1.1825 because it includes the five retried sessions; 2% residual) |
| mean cost per request, whole rollout | $0.000681 (the candidate's $0.00070) |
| first `ss-*` call lands at request | mean 2.48, median 2 (n = 66) |
| mean cost of the request holding the first `ss-*` call plus the two after it | $0.000454 (n = 198) |
| mean cost of requests 2 to 4 | $0.000403 |

Three failed discovery requests therefore cost $0.0012 to $0.0014 = 5.8% to 6.6% of the $0.020727 cell, or 7.5% to 8.4% of the main-thread-only mean `[M]`. The candidate's $0.0021 = 10.1% prices early requests at the rollout average, which is 1.5x to 1.7x too high. Tokens that a failed discovery leaves resident in the prefix cost about $0.00006 more over the rest of the rollout (roughly 300 tokens x 21 remaining requests x $0.01/M) `[I]`.

Denominators are mixed inside the candidate's ceiling sentence. The guide shares come from `06-research-cost-mechanics.md:670-672`: codex $0.000417 = 3.4% of $0.012330; opencode $0.000408 = 4.4% of $0.009265; claude-code $0.000511 = 3.1% "(main thread)", that is of about $0.0162, not of the $0.020727 sidechain-inclusive cell `[M]`. Against the cell the guide is 2.5%. The "10.1%" is against the cell. State both against one denominator.

### 2.5 What agents actually do after "command not found"

The tab run holds eight such episodes, none for `ss-*` `[M c12_notfound.py]`:

| arm | rollout | missing command | requests before moving on |
|---|---|---|---|
| sweet | `apigee__registry-961` | `gofmt` | 1 |
| sweet | `awslabs__aws-embedded-metrics-node-21` | `python` | 2 (retried as `python3`) |
| sweet | `bfgroup__b2-113` | `python` | 2 (retried as `python3`) |
| native | `accenture__sfmc-devtools-1974` | `python` | 2 |
| native | `apigee__registry-961` (3 rollouts) | `gofmt` | 1, 1, 1 |
| native | `awslabs__aws-embedded-metrics-node-21` | `file` | 1 |

Mean 1.4 requests per episode; the agent substitutes an obvious alternative and continues. This is an analog, not the mechanism: `python3` is an obvious substitute for `python`; native `Grep`/`grep` is an obvious substitute for `ss-grep`, but the installed guide and output style push the agent back toward `ss-*`, so the real reaction is unmeasured `[I]`. The analog supports one to two wasted requests; the candidate's "three" is an upper estimate.

### 2.6 What the F3 subagent numbers do and do not show

`forensics/claude-subagents.md` §2.1, tab run: eight guide-less `Explore` subagents made 215 `ss-*` calls, 30 failed (14.0%), 200 by absolute path, 13 hunt calls and 12 rejected `--help` calls in total `[M, read]`. Three corrections to the candidate's wording:

1. "13 discovery calls" is a total across eight subagents: 1.6 hunts plus 1.5 rejected `--help` per subagent, about 3 discovery-type calls each. That supports the order of magnitude "three" but is not per caller as written.
2. Those subagents had the wrappers on PATH. They hunted because they lacked the guide, then found the binaries by `command -v` / `find` and called them by absolute path. A real npm user's agent cannot resolve the name via PATH; it can recover only by searching the filesystem into the global `node_modules`, which the wrappers would survive (§2.1) `[C]` `[I]`.
3. The 14.0% is a guide-less syntax-failure rate and predates the `36b802e` hygiene commit (`verify/c08-history.md` §2.8). It measures a different defect (guide delivery to subagents), not reachability. It should not be cited as evidence for c12's mechanism.

### 2.7 The cache claim

`https://code.claude.com/docs/en/prompt-caching`, fetched 2026-09-02 `[W]`: "Adding a bare tool name like `Bash` or `WebFetch` as a deny rule removes that tool from Claude's context entirely ... adding or removing one of these rules mid-session invalidates the cache." and "Scoped deny rules like `Bash(rm *)`, and all allow and ask rules, don't change which tools Claude sees. Claude Code checks them when Claude attempts a call, leaving the prefix intact." The candidate's statement is accurate. An init-written scoped allow list is cache-safe.

## 3. Corrections the synthesis must adopt

1. Denominator: "16.04 Bash envelopes per rollout over 71 transcripts" -> "16 to 17 Bash envelopes per rollout; 71 session files belong to 66 rollouts, five are retried or re-run sessions" `[M]`.
2. Chained share: 31.1% -> 20.0% (19.3% on the 66-file mapping) once `|` inside quoted arguments is excluded `[M]`.
3. Discovery penalty: "three failed discovery requests at $0.00070 = $0.0021 = 10.1% of the cell" -> "one to three early requests at $0.00040 to $0.00045 = $0.0004 to $0.0014 = 2% to 7% of the $0.020727 cell; observed not-found reactions take 1 to 2 requests" `[M]` `[I]`.
4. Single denominator: guide 2.5% of the cell (3.1% of main thread only); discovery 2% to 7% of the cell. Do not mix.
5. F3 citation: rewrite as "eight guide-less Explore subagents made 13 hunt and 12 rejected `--help` calls in total (about 3 per subagent) with the wrappers on PATH; their 14.0% failure rate is pre-fix and measures guide absence, not reachability".
6. Add to the falsifier record: run and passed on 2026-09-02 (§2.1). The kill condition did not fire.

## 4. Revised ceiling

Bench: zero on all three harnesses, as the candidate says; both arms get PATH from the runner `[C]`. Solves: none traded; the fix touches `package.json` and `init.js` only.

Real user, default install, claude-code, stated against the fresh-pool sweet TAB cell $0.020727 `[I on M parts]`: the sweet arm pays the guide (+2.5%) plus one to three wasted early requests (+2% to +7%) and receives native retrieval, so sweet lands at roughly native +5% to +10% with no retrieval benefit. Codex and opencode: guide +3.4% / +4.4% plus a similar one-to-three-request opening, and no guide at all unless the user passed `--agents` `[C]`. This is a correctness precondition, not a percentage lever.

## 5. Hazards in the proposed fix that the candidate did not state

1. `solve_risk: none from the fix` is too strong. The wrappers source `_ss-env.sh`, which pins `SWEET_SEARCH_INTRA_OP_THREADS=8`, `SWEET_SEARCH_MAX_DAEMONS=3`, `SWEET_SEARCH_MAINTAINER_IDLE_TTL_MS=120000` and `SS_QUIET_BOOT=1` as unset-only defaults, and its header calls them a "COMMON BENCHMARK-HARNESS ENVIRONMENT" `[C]`. Adding `bin` entries to these exact files ships bench pins to every user machine (for example eight intra-op threads on a four-core laptop). The product entry points need their own env policy or the pins need a bench-only guard.
2. Six global command names collide with user PATHs; the candidate flags this as `needs_user_decision`, correctly.
3. "The codex/opencode equivalents" of a permission allowlist are not specified; codex uses approval policy and sandbox settings, opencode a `permission` block. I did not verify either `[I]`.

## 6. What I could not finish

- I did not run `sweet-search init` in a scratch repo (it downloads models and starts daemons). The absence of an allow-rule writer is by code reading `[C]`.
- I did not measure how a guided agent reacts to `ss-grep: command not found`; no trace contains that event. The one-to-three-request estimate rests on eight analog episodes and on the F3 subagent hunts `[I]`.
- I did not verify Claude Code's compound-command permission analyser; the candidate marked it `[I]` and I leave it there.
- The scratch install prefix was not pristine (it held an unrelated `bp-linked` shim from another agent's test); this cannot affect which shims npm creates for `sweet-search`.

## 7. Paths, scripts, rollouts

- Box (read-only run): `/root/sweet-search-private/eval/task-completion-bench/results/fp-claudecode-tab-20260826/` — `rows.json` (132 rows, 66 sweet), `agent-state/*-sweet/claude-home/projects/*/*.jsonl` (71 files).
- Box scratch: `/tmp/wf-slatec/c12-mechanism/c12_check.py` (+ `c12_check.out`, `sessions.json`), `c12_notfound.py` (+ `c12_notfound.out`). Original census: `/tmp/wf-slatec/real-user-product/perm.py`.
- Rollouts opened: `aio-libs__aiohttp-8038-sweet` (5 sessions), `protofire__solhint-224-sweet` (5), `fastify__fastify-cors-285-sweet` (4); not-found episodes in `apigee__registry-961-{sweet,native}`, `awslabs__aws-embedded-metrics-node-21-{sweet,native}`, `bfgroup__b2-113-sweet`, `accenture__sfmc-devtools-1974-native`.
- Local code: `package.json` (`bin`, `files`, `directories`), `scripts/init.js:245-253, 1017-1066`, `scripts/install-tool-enforcement.js:24, 38, 142-155`, `eval/agent-read-workflows/bin/{ss-grep,_ss-env.sh,_ss-helpers.mjs,sweet-search}`, `core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md:27-33`, `eval/task-completion-bench/harness/agent-runner-shared.mjs:137-141`, `eval/task-completion-bench/harness/claude-code-task-runner.mjs:95`, `README.md:100-171, 420-434, 880-901`.
- Local scratch: `<scratchpad>/pack/sweet-search-2.7.2.tgz`, `<scratchpad>/prefix/`.
- Documents read: `slate-c/BRIEF.md`, `slate-c/DEAD-LEVER-REGISTER-DRAFT.md`, `candidates/DEDUP.md` (c12 entry), `candidates/real-user-product.md` §1.5-1.6, §7 notes, `forensics/claude-subagents.md` §2.1-2.2, `harness-gutter-cost-20260828/06-research-cost-mechanics.md:670-672`, `FRESH-POOL-RESULTS.md:36-37, 68-69`.
- Web: `https://code.claude.com/docs/en/prompt-caching` (2026-09-02).
