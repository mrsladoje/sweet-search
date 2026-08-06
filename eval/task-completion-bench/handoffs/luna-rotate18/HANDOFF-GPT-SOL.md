# Handoff to GPT Sol — deep trace analysis: cost + sweet-resolution on the Luna rotation run

## Your role and goal

You are a senior retrieval/agent-systems researcher. Analyze a real 72-rollout agent-mode
benchmark run of **sweet-search** and deliver two things, each backed by the traces AND by
**deep 2026 SOTA web research**:

1. **Cost**: where does the money actually go, and how do we cut it **without losing solves**?
2. **Resolution**: why does the sweet arm solve *less* than the native arm, and what concrete
   changes would close the gap?

Rank every suggestion by expected impact × implementation cost. Cite sources inline (prefer
2025-2026 arXiv, tool source/docs). Do not propose anything already closed (see §6).

## 1. What sweet-search is (context)

sweet-search is a code-retrieval engine exposed to a coding agent as CLI tools:
`ss-search` / `ss-find` (ranked code blocks), `ss-grep` (file:line), `ss-semantic`
(NL→spans), `ss-read` (span/file read with a line-number gutter). The competing baseline is
**native** tools: raw `rg`/grep + `sed`/cat file reads. Both arms drive the SAME coding agent
(codex harness, model = gpt-5.6-luna via a ChatGPT subscription). The task benchmark is
SWE-rebench-style: apply a repo patch so hidden FAIL_TO_PASS tests pass, PASS_TO_PASS stay green.

The product thesis: retrieval (ss-*) should let the agent localize + fix with **less context and
fewer/cheaper tokens** than grep/read flooding — at equal or better solve rate. This run tests
whether that holds.

## 2. The run

- **Cohort**: 18 fresh tasks, 13 languages, seed-42, never used in tuning, zero overlap with the
  frozen held-out set. All baselines graded green under the exact config.
- **Arms × reps**: native + sweet, REPS=2 → 72 rollouts. CONCURRENCY=2. Tool-call cap 60 (matched).
- **Shipped features under test** (both default-on): a per-line `N| ` line-number gutter on all
  ss-* code output, and an M± "fix discipline" system-prompt block (read ≤2 examples then write;
  check repo conventions; recheck the contract shape).

## 3. Result (headline)

| arm | solved | rate | avg calls | ss-* uses | avg input tok/rollout | ideal cost | CPS |
|---|---|---|---|---|---|---|---|
| native | 19/36 | 53% | 8.0 | 0 | **381k** | $0.352 | $0.009 |
| sweet | 15/36 | 42% | 9.6 | 243 | **308k** | $0.302 | $0.008 |

- Sweet solved **4 fewer** and cost **~11.6% less**. Sweet uses **19% less input context/rollout**
  (its retrieval diet) — that is *why* it is cheaper, and (hypothesis) part of why it solves less.
- **60% of all spend is on FAILED rollouts** (38 of 72 rollouts = $0.393 of $0.654 ideal).
- Not statistically significant at n=18 (±37% aggregate-cost noise floor). Treat cost deltas as
  directional; treat solve deltas as the signal.

## 4. Per-task table (native vs sweet; solve, ideal cost, avg input tokens, sweet ss-* count)

```
task                                nat_solve sw_solve  nat_$     sw_$     nat_avgIn sw_avgIn sw_ss
akinsho__nvim-bufferline.lua-173    2/2       2/2       $0.0123   $0.0142  150k      205k     9
apple__swift-nio-http2-145          0/2       0/2       $0.0201   $0.0170  322k      288k     11
codeception__codeceptjs-367         0/2       0/2       $0.0146   $0.0167  290k      351k     19
dart-lang__http-1114                0/2       0/2       $0.0515   $0.0281  1308k     535k     20   <- cost tail
dashbitco__nimble_options-43        0/2       0/2       $0.0175   $0.0144  371k      236k     8
dotnet__yarp-2825                   0/2       0/2       $0.0116   $0.0128  190k      222k     12
epiforecasts__scoringutils-229      2/2       2/2       $0.0120   $0.0091  199k      153k     4
jashkenas__underscore-2757          2/2       1/2       $0.0208   $0.0254  358k      495k     20
joshuakgoldberg__bingo-274          0/2       0/2       $0.0242   $0.0170  471k      321k     19
litestar-org__polyfactory-405       0/2       0/2       $0.0263   $0.0232  519k      481k     21
mransan__ocaml-protoc-202           0/2       0/2       $0.0265   $0.0239  513k      542k     29   <- sweet retrieval-heavy, still fails
oceanparcels__parcels-617           2/2       2/2       $0.0141   $0.0127  246k      233k     10
ontodev__robot-710                  2/2       2/2       $0.0168   $0.0138  313k      262k     11
pytask-dev__pytask-210              1/2       1/2       $0.0144   $0.0109  209k      150k     7
redboltz__mqtt_cpp-466              2/2       2/2       $0.0095   $0.0139  182k      259k     7
rstudio-education__gradethis-161    2/2       1/2       $0.0289   $0.0237  621k      378k     18
statamic__cms-9029                  2/2       2/2       $0.0189   $0.0146  371k      264k     12
teleporthq__teleport-code-generat   2/2       0/2       $0.0122   $0.0106  225k      170k     6    <- THE resolution gap
```

Full machine-readable data (read these with your tools):
- `rollups.json` / `rollups.tsv` — all 72 rollouts: calls, ss, nativeGrep, toolCounts, patchHunks,
  patchFiles, stepsToFirstEdit, exitReason, input/cached/output tokens, idealCostUsd, wallSec.
- `trajectories.txt` — condensed step-by-step traces for 4 key rollouts (teleport native+sweet,
  dart-http native, mransan sweet), tool command + truncated output + running context size.

## 5. What we already found (do NOT redo; build on it)

- **The solve gap is concentrated in ONE task, teleport (2/2 → 0/2).** Both arms patched the SAME
  correct file+function; sweet dropped ONE conjunct in an equality check (`&& fileType === fileType`).
  Cause: the discriminating field `fileType` appeared **39×** in native's context (it did
  `rg` + `sed -n '1,230p'` = read the whole file) but only **1×** in sweet's diet retrieval. →
  **retrieval-completeness for repair**, not retrieval quality (right file was found).
- The other two divergences (underscore 1/2, gradethis 1/2) do NOT share that mechanism — they are
  **generation variance** with *adequate* retrieval (each passed the other rep; context was rich).
  underscore's failed rep even had a *richer* context and produced an *internally inconsistent*
  patch (mixed a broken `_.has(result, [key])` form). So richer context is not automatically better.
- **Cost concentrates on failed tasks and on context blow-up.** The single costliest task is
  dart-http (both arms fail): native ballooned to **1.3M avg input tokens** ($0.0515), sweet 535k
  ($0.0281). The re-send tax (resident context re-sent every turn) dominates on long, failing runs.

## 6. Levers already CLOSED — do not re-propose (with reasons)

Read `eval/task-completion-bench/TURN_PACKING_FINAL.md` and §23-§24 of
`eval/task-completion-bench/TURNFIX-PHASE0-REPLAY-RESULTS-2026-08-03.md` for the evidence.
- **Turn-packing / "make more parallel tool calls" prompts** — CLOSED; the calls/turn gap was a
  counting artifact, and this backbone class is instruction-deaf to packing prose.
- **Mid-task advisories / footers** — CLOSED (channel-deaf 3-for-3).
- **Server-side fusion as a standalone lever** — measured NET-NEGATIVE on the economics gate: a
  fused payload enters resident context and is re-sent ~32 more turns; it only pays off *when paired
  with context eviction*. See §23. So "fuse search+read" alone is off the table; "fuse + evict" is open.
- Prompt/format tuning of M± is exhausted on this backbone (neutral on rotation).

## 7. The questions we need you to answer

**Cost**
1. Decompose the spend: how much is (a) failed-task tails, (b) resident-context re-send tax,
   (c) redundant retrieval/reads, (d) turn count? Use `rollups.json` (input vs cached tokens,
   calls, wallSec) and `trajectories.txt`.
2. On dart-http, native hit 1.3M input tokens. Trace *why* context exploded and what a
   principled cap/eviction/compaction policy would have saved — quantify against the 2026 SOTA on
   agent context management (context editing / eviction / compaction, KV-cache-aware pruning,
   summary-checkpointing). Does the evidence support eviction as the unlock that also makes fusion pay?
3. Where can sweet cut cost further *without* touching solves? (It is already the cheaper arm on
   most solved tasks; the risk is over-dieting retrieval — see resolution below.)

**Resolution**
4. Is the "retrieval diet starves repair of disambiguating signal" hypothesis (teleport) worth
   building for, given it is 1/18 tasks here and the other divergences are variance? What is the
   2026 SOTA on **retrieval/context for program repair specifically** (not QA) — e.g., surfacing
   all call-sites/usages of an edited symbol, type-aware context, "read the whole file vs spans"
   trade-offs, agentic localization? Native gets usage-flooding free from `rg`; what is the
   cheapest way to give sweet the *same disambiguating signal* without native's token cost?
5. Sweet makes MORE tool calls (9.6 vs 8.0) and heavy ss-* on some failures (mransan: 29 ss, still
   0/2). Is that productive exploration or retrieval-thrash? What does 2026 SOTA say about
   knowing-when-to-stop-retrieving and converting retrieval into a correct edit?
6. Generation variance (underscore/gradethis): both arms find the right files but sometimes write
   an inconsistent/over-large patch. What 2026 techniques reduce repair-generation variance
   (self-consistency, test-guided edit repair, constrained edit formats, verify-before-commit)?

## 8. Deep research directions (2026 SOTA — please actually search)

- Context management for long-horizon coding agents: eviction / context-editing / compaction,
  KV-cache-aware context pruning, "lost in the middle" for large repo context.
- Retrieval for code REPAIR vs code QA: what context actually helps localization → correct edit;
  usage/call-site expansion; type-/def-aware retrieval; whole-file vs span reads on SWE-bench-class tasks.
- Agentic cost reduction at fixed accuracy: token/turn budgeting, stop policies, speculative vs
  resident context.
- Edit-generation reliability: constrained diff formats, test-time verification, self-repair loops.

## 9. Rules and calibration

- **Accuracy is non-negotiable**: never propose a cost cut that plausibly reduces solve rate; if a
  lever trades solves for cost, say so explicitly and quantify.
- **n=18, ±37% cost noise**: do not over-read any single cost number; argue from mechanism + the
  full 72-row distribution, not one rollout.
- Distinguish **retrieval quality** (finding the right place — already good) from **retrieval
  completeness** (surfacing the disambiguating detail) from **generation** (writing the correct edit).
- Deliverable: a ranked list. For each item: the mechanism, the evidence (which rollouts/rows),
  the 2026 source(s), the expected effect on cost AND solves, and a concrete first experiment
  (ideally a micro-smoke on 1-2 named tasks + a control).
