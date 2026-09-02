# c09 — adversarial verify, MECHANISM lens

Date: 2026-09-02. Agent: verify/c09-mechanism. Spend: $0. No rollout launched. Nothing written under `results/`. HO2 not opened. No grading log opened. Box scratch: `/tmp/wf-slatec/c09-mechanism/` (`helpcensus.py`, `sidesplit.py`, `subagents.py`, `rawcheck.py`, `outcomes.py`, and their `.out` files). Tags: `[M]` measured with a named script, `[C]` read from code, `[I]` inferred with the arithmetic shown.

## 0. Verdict

**REFUTED as a lever. Confidence 0.90.** The cited traces do not show the mechanism. Every rejected `--help` or `-h` call already returned the complete usage line in the same tool result, and in all 8 affected requests the agent's next request used correct syntax with no retry `[M rawcheck.py]`. Changing the exit code from 2 to 0 therefore removes zero requests. The only information-losing events c09's table would fix are two `-E`/`-iE` rejections, each followed by one re-issued grep `[M]`. That is at most 2 requests in 198 rollouts, about $0.0008, about 0.06% of the claude-code sweet arm, and 0.00% on codex and opencode, where no `--help`, `-h`, or `-E` event exists in 970 and 788 operations `[M helpcensus.py, sidesplit.py]`. The candidate's ceiling of 0.56% is the whole failed-`ss-*` request envelope of all eleven subagents, including three guide-bearing general-purpose subagents whose failures were in classes already shipped by commit `36b802e`. It is about nine times the mechanism-supported figure. Its "about 0.2% elsewhere" has measured exposure zero. Every rollout carrying these events has `costRealizedUsd = null` and `sidechainAccountingComplete = false` in `rows.json`, so the population sits in imputed spend that the headline cell does not record `[M outcomes.py]`. The B3-closing half also fails on its own falsifier: the 97.7 / 100.0 / 98.2% "guide-only" figure counts forms that the shipped usage strings print; after the reclassification c09 itself specifies, the residual is 1.24 / 0.76 / 0.69%, all of it an `ss-trace` mode word the wrapper silently ignores `[M guidesyntax.py features; C _ss-helpers.mjs 939–1000]`. The help repair survives only as a correctness fix with no benchmark value, exactly as register row E2 books its class. No solve is traded either way.

## 1. What the candidate claims, and what the code says

c09 mechanism: "`--help`/`-h` currently hit `rejectUnknownOptions` → `failUsage('unrecognised option')` [C _ss-helpers.mjs 226-228]; make them print usage and exit 0."

- `[C]` `eval/agent-read-workflows/bin/_ss-helpers.mjs` 188–191: `failUsage` writes `[ss] <message>\n<usage>\n` to stderr and exits 2. **The usage text is already printed on every rejection.**
- `[C]` The path for `ss-grep`, `ss-find`, `ss-search`, `ss-trace` is `resolvePositional` → `extractPositional` → `failUsage` (lines 180–186; `_ss-argparse.mjs` `extractPositional`). `rejectUnknownOptions` (226–228) is called only by `ss-semantic` (line 899). The citation names the wrong function; the outcome is the same.
- `[C]` `ss-read --help` takes a different branch (line 564–566): `"--help" looks like a flag, but ss-read takes a file path first.` followed by the five-line `READ_USAGE`. Also prints usage, exits 2.
- `[C]` The `ss-grep` shell wrapper (`bin/ss-grep`) captures stderr to a temp file and re-emits it on non-zero exit, so the agent sees the usage line in the Bash tool result.

So the repair changes the exit code and removes one prefix line. It does not change what the agent learns from the call.

## 2. Mechanism test on the recorded traces

Source: `/tmp/wf-slatec/native-capability-gaps/calls-classified.jsonl.gz` (10,942 records; sweet arm, canonical rows, fresh pool TAB: `fp-codex-tab-20260826`, `fp-opencode-tab-20260826` + `rp-oc-tab-20260827`, `fp-claudecode-tab-20260826`), then the raw subagent transcripts under `fp-claudecode-tab-20260826/agent-state/*-sweet/claude-home/projects/*/*/subagents/*.jsonl` (11 files).

### 2.1 Every `--help` / `-h` / `-E` operation in the pool `[M helpcensus.py, rawcheck.py]`

| rollout (task, rep, subagent) | request | calls | payload received | next request's first tool |
|---|---|---|---|---|
| `asynkron__protoactor-dotnet-1909` rep1, Explore `a3d311866bfc0b7cb` | #6 | `ss-find -h 2>&1 \| head -80`, `ss-grep -h 2>&1 \| head -80` (exit masked, not errored) | `[ss] unrecognised option "-h"` + full `Usage:` line, both | Bash `ss-grep 'TypeDictionary\|TypedDict…'` |
| `awslabs__aws-embedded-metrics-node-21` rep0, Explore `a0d415047c0776a3e` | #7 | `ss-grep --help`, `ss-find --help`, `ss-search --help` (is_error true) | `Exit code 2` + `[ss] unrecognised option` + full `Usage:` line, all three | Bash `ss-search "duplicate dimension se…"` |
| `awslabs__aws-embedded-metrics-node-21` rep2, Explore `a484cf2677177e8ef` | #4 | `ss-grep --help`, `ss-find --help`, `ss-read --help` | usage for all three (`ss-read`: "looks like a flag" + 5-line usage) | Bash `ss-grep -i 'dimension' --in src -…` |
| same agent | #7 | `ss-grep -iE '…' --in src --in test -k 20` | `[ss] unrecognised option "-iE"` + usage; **grep did not run** | Bash `ss-grep 'setDimensions' --in src` (re-issued without `-E`) |
| `bfgroup__b2-113` rep1, Explore `abd536db90e42b25d` | #4 | one Bash call `ss-grep --help; ss-find --help` | both usage lines | Bash `ss-grep 'build[ _-]*no\|BUILD_NO\|b…'` |
| `bfgroup__b2-113` rep2, Explore `a41e46d3e2671aa14` | #4 | `ss-grep --help` | usage | Bash `ss-grep -n -F 'boost-install' --i…` |
| same agent | #5 | `ss-grep -n -E '(^\|[^[:alnum:]_])install…'` | `[ss] unrecognised option "-E"` + usage; **grep did not run** | Bash `ss-grep 'install' --in /root/.ss-…` (re-issued without `-E`) |
| `final-form__final-form-64` rep2, Explore `a38e681945774a613` | #2 | `ss-grep --help`, `ss-find --help` | usage, both | Bash `ss-grep 'submitFailed' --in /root…` |

Totals `[M]`: 14 Bash tool-use events in 8 requests; 13 errored operations in `calls-classified` (11 in the `--help`/`-h` family including `ss-read --help`, 2 in the `-E` family) plus the 2 piped `-h` probes that did not register as errors; 6 subagents (all `Explore`, all guide-less); 6 rollouts of 198; 4 tasks; **0 on codex (970 operations), 0 on opencode (788)**. The only unrecognised option on opencode in the whole pool is one `--in`; codex has none `[M sidesplit.py]`.

### 2.2 What this shows

1. **The help request is not removable by the repair.** In every case the request that carried `--help` was the agent asking for syntax; the usage line answered it; the next request proceeded correctly. A working `--help` would produce the same request with the same payload minus one line. Requests saved: 0.
2. **The two `-E` events are the only ones that lost information.** Each cost at most one re-issued grep in the following request. Ceiling: ≤2 requests in 198 rollouts.
3. **Bundled `-iE` arrives as one token.** `_ss-argparse.mjs` `normalizeArgs` splits bundles only when every letter is in `BOOL_SHORTS = {i, w, F}` or `VALUE_SHORTS = {k}`; `E` is in neither, so `-iE` is rejected whole `[C 74–76, 96–113]`. An inert `-E` must also join the bundle-aware set to fix that event.

### 2.3 Pricing the affected requests `[M rawcheck.py]`

Only one of the 8 help-bearing requests carries usage in the transcript: `bfgroup__b2-113` rep2 request #5 (the `-E` event): in=3, cache_read=11,807, cache_create=131, out=433 → **$0.000391** at $0.10 / $0.01 / $0.60 per million. The other 7 requests record zero usage (the claude-code delegated-request gap the brief's G6 describes). So even the 2-request ceiling is largely off-ledger.

Upper bound `[I]`: 2 requests × ≈$0.0004 = **≈$0.0008 ≈ 0.06%** of the claude-code sweet inclusive arm ($1.3664; §4), and 0.00% on codex and opencode.

## 3. Denominators behind "48 usage errors" and "36/329 vs 12/779" `[M sidesplit.py]`

| thread | `ss-*` ops | errored calls | usage errors | classes |
|---|---:|---:|---:|---|
| claude-code main | 973 | 37 | 10 | extra positional 7, unrecognised `--in` 2, `--include=*.jam` 1; plus exit-1 16, ENOENT 8, not-indexed 1, other 3 |
| claude-code subagents | 333 | 36 | 33 | unrecognised option 22 (`--help` 10, `--in` 6, `--full` 3, `-iname` 2, `-E` 1, `-iE` 1), extra positional 8, read range 1, `ss-read --help` 1, flag-needs-value 1; plus ENOENT 1, other 2 |
| codex main | 970 | 25 | 1 | extra positional 1; ENOENT 12, other 12 |
| opencode main | 788 | 32 | 5 | extra positional 4, unrecognised `--in` 1; ENOENT 12, other 15 |

- c09's "36 subagent usage errors" are 36 errored calls, of which 33 are usage errors. Its "12 main" matches 10 usage errors + 2 other exits. The two sibling documents disagree on the operation count (329 vs 317 vs my 333) because of how chained commands are split; the shares agree.
- **Rescued by c09's genuinely new items** (`--help`/`-h` exit 0, `-E` inert): 13 of the 48 it names = **27%** (30% of the 43 true usage errors). c09's kill line is 30 of 48. **The kill condition fires** `[M]`. A generous reading that also accepts `--full` on `ss-grep` (3 events, semantically undefined for a file:line tool) reaches 16 of 48 = 33%. Still fires.
- **Already fixed before c09** `[C git]`: extra positional path (20 events across harnesses) and `--in` on `ss-find` (9 events) shipped in `36b802e` on 2026-08-28, two days after the run; `--in` on `ss-trace` was accepted before the run (`git show ba5b4ee:…/_ss-helpers.mjs` line 875); `-i` and `-F` were never rejected by `ss-grep`/`ss-find` (the `-i`/`-F` events in the pool errored for positional-path or `--in` reasons, not for the flag) `[M sidesplit.py "why" table]`; `--full` is accepted by `ss-search` and `ss-find` (lines 445, 690). Of c09's seven table items, two are unbuilt.

## 4. The ceiling's denominator and the "0.56%"

- `[M subagents.py]` `census-fp-claudecode-tab-20260826.json`, 11 sweet subagents: `ssFailRequests` total 15 = $0.0073; of these, **6 requests ($0.0038) belong to the 3 general-purpose subagents that HAD the guide** and failed on positional-path and `--in` (E2 classes). Explore-only: 9 requests, $0.00355. `preSSRequests` (hunting for binaries, raw shell, native `Read` before the first working `ss-*`) total 31 = $0.0182, all in the 8 Explore agents.
- So $0.0073 / 0.56% is not the help class. It is every failed-`ss-*` request in every subagent. The help-class portion is 5 requests (§2.1, excluding the piped probes and the `-E` request), and none of the 5 is removable by the repair (§2.2).
- Arm total `[M subagents.py]`: dedup 66 canonical sweet cells, main ideal $1.0475 + subagent imputed $0.3189 = **$1.3664 inclusive**, which matches the brief's $0.020727 × 66 = $1.368. The sibling document's $1.3009 is a slightly different inclusive total; the difference does not change any conclusion. 0.0073 / 1.3664 = 0.53%.
- `rows.json` `[M outcomes.py]`: all 6 sweet rollouts carrying help/`-E` events have `costRealizedUsd = null`, `idealCostUsd = null`, `sidechainAccountingComplete = false`. The headline sweet TAB cell is built with imputation for these rows. A saving inside them cannot show on the measured column.

**Correction to the ceiling arithmetic:** claimed ≤0.56% claude-code, ~0.2% codex/opencode; mechanism-supported ≤0.06% claude-code (2 requests, 1 ledgered at $0.000391, 1 off-ledger), 0.00% codex, 0.00% opencode. The claude-code figure is overstated about 9×; the other two are stated against zero measured exposure.

## 5. The B3-closing census

- `[M guidesyntax.py, re-run unchanged]` 948/970 = 97.7% codex, 788/788 = 100.0% opencode, 1,283/1,306 = 98.2% claude-code. Reproduces exactly.
- The instrument's "guide-taught" set is `-k`, `--in`, `--regex`, `--json`, read span, `ss-semantic` two-argument form, `ss-trace` mode word. `[C]` The shipped usage strings print `-k`/`--top`, `--in`, `--regex`, `--full`/`--xl`, `-i`/`-w`/`-F`, `--mode`, `--max-tokens`, `--query`, `--depth`, `--budget`, the `ss-read` span forms, and `ss-semantic <file> "<question>"` (lines 328, 445, 551–555, 690, 891, 939). Every "guide-taught" form except the `ss-trace` mode word is self-describing today through the error path and would be through `--help`.
- Applying c09's own falsifier (2), which reclassifies `-k` and read spans as self-describable, and extending it to the other usage-string forms, the guide-only residual is the `trace-mode` feature count alone `[M guidesyntax.py features]`: **12/970 = 1.24% codex, 6/788 = 0.76% opencode, 9/1,306 = 0.69% claude-code**. Seed S1's kill line is 20% (`research/agent-efficiency-2026.md` §8 S1). It does not fire; it is missed 16–29×. The headline "fires at 98–100%, closing B3" is the pre-reclassification number from an instrument that counts documented optional flags as guide dependence. The two halves of c09 contradict each other.
- `[C _ss-helpers.mjs 939–1000]` `cmdTrace` reads `--in`/`--file`, `--query`/`--hint`, `--depth`, `--budget`, `--json`, then `symbol = resolvePositional(args)`; there is no mode handling and no `rejectExtraPositionals`, so `ss-trace foo callers` silently drops `callers`. The guide (line 32) teaches that form. The 27 pooled operations that used it are dependence on a form the tool ignores. Real guide-taught syntax dependence is indistinguishable from zero.
- **The census cannot answer B3 regardless.** It measures which forms guided agents typed. The only guide-less population in the pool (8 Explore subagents) called `ss-*` because 11 of 11 delegation prompts told them to (`forensics/claude-subagents.md` line 60). A guide-less main thread has no such prompt; whether it would call `ss-*` at all is untested, as c09's own `solve_risk` field concedes.

## 6. The "6.2–7.6× loss" for the guide-drop branch `[M subagents.py; I]`

- c09: "$0.0032 and 5.8 discovery requests per agent". Source arithmetic: ($0.0182 + $0.0073) / 8 = $0.0032; (31 + 15) / 8 = 5.75. Both numerators include the 3 general-purpose subagents' 6 failed requests ($0.0038), while the denominator is the 8 Explore agents.
- Explore-only: pre-`ss-*` 31 requests, $0.0182; failed-`ss-*` 9 requests, $0.00355; union ≤ 40 requests, ≤ $0.0217; **≤ 5.0 requests and ≤ $0.00272 per agent**; pre-`ss-*` alone $0.00227 per agent.
- Ratio against the guide's $0.000417–$0.000511 per rollout: 5.3–6.5×, not 6.2–7.6×. Not a factor-two error, but the comparison is invalid: the numerator is per-agent discovery in a worktree the index did not cover (45 of 57 worktree-scoped calls returned false zeros, `forensics/native-capability-gaps.md` §3.2), dominated by hunting for binaries that `--help` cannot shorten, and it is applied to every rollout as if a guide-less main thread would repeat an Explore subagent's behaviour. No ceiling for B3 can be stated from this evidence.
- The "7.5% no-delegation value" attributed to the guide is unadjudicated: `forensics/claude-subagents.md` attributes sweet's lower delegation to the tools occupying the Explore slot, and records the guide's delegation sentence fully obeyed 0 of 27 times; register thread 45 marks the causal question open.

## 7. Solve check `[M outcomes.py]`

Sweet claude-code outcomes for the 6 affected rollouts: `asynkron` rep1 resolved, `awslabs` rep0 and rep2 resolved, `final-form` rep2 resolved, `bfgroup__b2-113` rep1 and rep2 not resolved (index-gap task at the time; sweet 0/3, native 1/3). In each resolved case the agent recovered inside the next request. No solve depends on the exit code. The repair has no solve risk and no solve upside.

## 8. Corrections the synthesis must adopt

1. Ceiling: "help/`-E` repair ≤0.06% of the claude-code sweet inclusive arm (≤2 requests in 198 rollouts, one ledgered at $0.000391, one off-ledger); 0.00% codex; 0.00% opencode." Drop "≤0.56%" and "~0.2% elsewhere".
2. Evidence line: "13 errored `--help`/`-h`/`-E` operations plus 2 piped `-h` probes, 14 Bash events in 8 requests, 6 Explore subagents, 6 of 198 rollouts, 4 tasks; every rejection returned the full usage line; the next request used correct syntax in 8 of 8." Replace "12 rejected `--help`".
3. Usage-error census: "33 usage errors of 333 subagent operations (36 errored calls) against 10 of 973 on the main thread (37 errored calls); codex 1, opencode 5." Replace "36/329 vs 12/779".
4. Falsifier (1) result: 13 of 48 = 27% rescued; kill line 30 of 48 fires.
5. Falsifier (2) result: guide-only dependence after reclassification 1.24 / 0.76 / 0.69%, all `ss-trace` mode word, which the wrapper ignores; the 20% line does not fire; the census cannot adjudicate B3; withdraw the B3-closing claim.
6. Table items to drop as already shipped or never broken: `-i`, `-F`, `--full` on `ss-search`/`ss-find`, `--in` on `ss-trace` (pre-run), `--in` on `ss-find` and positional path (`36b802e`). Unbuilt: `--help`/`-h` exit 0; `-E`/`--extended-regexp` inert, bundle-aware (`-iE`). `--full` on `ss-grep` is undefined and should stay rejected.
7. Code citation: `--help` reaches `failUsage` via `resolvePositional`→`extractPositional` (180–186), not `rejectUnknownOptions` (226–228, `ss-semantic` only); `ss-read --help` takes the "looks like a flag" branch (564–566). Usage is printed on every path.
8. Off-ledger note: all 6 affected sweet rollouts have null `costRealizedUsd` and incomplete sidechain accounting; the population is imputed spend.
9. Keep as a separate product/guide mismatch (not a lever): guide line 32 teaches an `ss-trace` mode word the wrapper drops; 27 pooled operations used it.
10. Book the repair as E2-class correctness, claude-code subagents only, no benchmark value, consistent with `PANEL-SYNTHESIS.md` §N-3 ("about 1% of sweet spend, solve 0 tasks … claim no benchmark value").

## 9. What I could not finish

- I did not run the wrapper locally to observe `--help`; starting the engine on this machine was not needed because 14 recorded payloads and the code show the same thing.
- I did not reproduce the census's imputation for the 7 zero-usage help requests; I priced the ledgered one and bounded the rest at the same size.
- I did not verify in engine code that ERE is the default regex dialect (the `-E` inert claim rests on the `native-capability-gaps` note); this affects the build, not the verdict.
- I did not open HO2, any `ho2-*` run, or any grading log.

## 10. Evidence opened

Local: `slate-c/BRIEF.md`; `slate-c/DEAD-LEVER-REGISTER-DRAFT.md`; `slate-c/register/DEAD-LEVER-REGISTER.md` (rows B3, E2, §272); `slate-c/candidates/inversion-and-removal.md` (R24, lines 37–58, 208–284, 516–548, 668–669, 706); `slate-c/candidates/cost-structural.md` (lines 442–505); `slate-c/forensics/claude-subagents.md` (§0, lines 44–70, 124–131, 159–199, 207); `slate-c/forensics/native-capability-gaps.md` (lines 436–451, 480, 572–575); `slate-c/research/agent-efficiency-2026.md` (§6.2–6.4, S1 lines 567–585); `slate-c/verify/c09-history.md`; `handoffs/improve/PANEL-SYNTHESIS.md` §N-3; `handoffs/improve/harness-gutter-cost-20260828/06-research-cost-mechanics.md` lines 687, 782; `eval/agent-read-workflows/bin/_ss-helpers.mjs` (180–228, 328–345, 440–465, 550–600, 690–713, 891–903, 939–1000), `_ss-argparse.mjs` (full), `ss-grep`, `_ss-env.sh`; `core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md` (full); git `ba5b4ee`, `36b802e`, `1a00765`.
Box (read-only): `results/fp-claudecode-tab-20260826/rows.json`; `results/fp-codex-tab-20260826/rows.json`; `results/fp-opencode-tab-20260826/rows.json`; `results/rp-oc-tab-20260827/rows.json`; raw subagent transcripts `fp-claudecode-tab-20260826/agent-state/{asynkron__protoactor-dotnet-1909,awslabs__aws-embedded-metrics-node-21,bfgroup__b2-113,final-form__final-form-64}-sweet/claude-home/projects/*/*/subagents/agent-{a3d311866bfc0b7cb,a0d415047c0776a3e,a484cf2677177e8ef,abd536db90e42b25d,a41e46d3e2671aa14,a38e681945774a613}.jsonl`; `/tmp/wf-slatec/native-capability-gaps/calls-classified.jsonl.gz`; `/tmp/wf-slatec/inversion-removal/guidesyntax.py`; `/tmp/wf-slatec/claude-subagents/census-fp-claudecode-tab-20260826.json`.
