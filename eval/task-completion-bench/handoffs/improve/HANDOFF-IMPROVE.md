# Handoff — make sweet beat native on EVERY harness, on BOTH cost and resolution

You are a fresh session. Launch a **multi-agent workflow** that mines the 204-rollout scoreboard
just completed, generates and screens improvement candidates, and returns a ranked, evidence-graded
slate of levers for cost AND resolution. **Investigate broadly; build nothing until a candidate
passes the $0 exposure gate.**

**Goal (operator, verbatim intent):** sweet should win on all harnesses and be better than native
on everything — not just cheaper on one harness.

---

## 0. Where we actually are (measured 2026-08-11, 204 rollouts, model held at Luna)

17 rotated DEV-RET tasks x 2 arms x 2 reps x 3 harnesses. Metered spend $1.31. Run IDs:
`sb-codex-20260811`, `sb-opencode-20260811`, `sb-claudecode-20260811` (box, `results/<id>/`).

### Cost — break-priced, paired (negative = sweet cheaper)

| Harness | Both-solved | p | All 17 paired | p |
|---|---|---|---|---|
| codex | −9.6% (n=9) | 0.138 | −6.5% | 0.275 |
| opencode | **−15.7%** (n=8) | **0.000** | −17.8% | 0.000 |
| claude-code | +0.2% (n=8) | 0.909 | +2.4% | 0.784 |

### Solve

| Harness | native | sweet | both | native-only | sweet-only | neither |
|---|---|---|---|---|---|---|
| codex | 9/17 | 10/17 | 9 | 0 | 1 | 7 |
| opencode | 9/17 | 9/17 | 8 | 1 | 1 | 7 |
| claude-code | 9/17 | 9/17 | 8 | 1 | 1 | 7 |

### Two honesty flags that MUST survive into any future write-up

1. **26% of opencode's all-paired −17.8% is sweet ABANDONING a task.** On
   `mransan__ocaml-protoc-202` sweet produced no patch at all ($0.0009 vs native $0.0072). Cheap
   because it gave up. Excluding it: −13.9%. The both-solved −15.7% is unaffected (nobody solved it).
2. **Claude-code's entire cost loss is ONE task.** `dart-lang__http-1114` contributes +$0.0112
   against a net of +$0.0047 over 17 tasks. Remove it and claude-code flips to **−3.7%**.

---

## 1. The evidence base you are mining (all $0, already on disk)

### 1a. Failure taxonomy — every patch scored against the gold patch

51 arm x harness cells per arm (17 tasks x 3 harnesses):

| Class | native | sweet |
|---|---|---|
| SOLVED | 27 | 28 |
| touched **every** gold file, still failed | 10 | 9 |
| touched **some** gold files | 9 | 8 |
| touched **no** gold file | 5 | 4 |
| produced no edit | 0 | 2 |

Reproduce by comparing `results/<run>/preds-<arm>.jsonl` `model_patch` file lists against
`spec.patch` file lists from `select/.cache/tasks_full_luna_rotate20.json`.

### 1b. FINDING A — multi-site under-coverage (biggest resolution headroom)

| Task | Gold files | Found, in ALL 6 arm x harness cells | Wrong files added |
|---|---|---|---|
| `joshuakgoldberg__bingo-274` | 9 | **1 of 9** every cell | **0** |
| `dart-lang__http-1114` | 4 | 1–2 of 4 | 5–8 |
| `mransan__ocaml-protoc-202` | 19 | 0 of 19 | 0–1 |

The bingo case is the cleanest signal in the whole run: **precise but shallow** — perfect
localization, zero wrong files, stops after 1 site of 9. This is "given a fix site, find the
sibling sites needing the same change" — a retrieval capability. It is **arm-universal today**,
which makes it headroom for sweet rather than a regression.

### 1c. FINDING B — three failures at PERFECT localization (agent-bound, low prospects)

`dotnet__yarp-2825`, `apple__swift-nio-http2-145`, `dashbitco__nimble_options-43`: both arms
touched EVERY gold file on EVERY harness and still failed. Retrieval is already perfect here.
Treat as agent-bound. A retrieval lever cannot help. Expect $0-gate death — say so if you propose it.

### 1d. FINDING C — the one sweet-specific localization miss

`codeception__codeceptjs-367` (3 gold files): native reached 1 of 3 on claude-code; sweet reached
0 of 3 on all three harnesses. The only place sweet localizes WORSE than native in 204 rollouts.
n=1 task — weak evidence, but it is the only one of its kind. Worth a look, not a program.

### 1e. FINDING D — cost mechanics (why the win is harness-dependent)

| Harness | arm | calls | ss-* | turn-1 ctx | growth | out tokens | break-priced |
|---|---|---|---|---|---|---|---|
| codex | native | 7.5 | 0 | 13,277 | 18,627 | 4,024 | $0.0085 |
| codex | sweet | 9.3 | 6.5 | 14,734 | 14,095 | 4,145 | $0.0080 |
| opencode | native | 22.8 | 0 | 6,911 | 22,134 | 3,655 | $0.0080 |
| opencode | sweet | 17.0 | 8.2 | 8,368 | 14,818 | 2,901 | $0.0066 |
| claude-code | native | 29.5 | 0 | 17,630 | 17,022 | 6,226 | $0.0117 |
| claude-code | sweet | 19.7 | 8.6 | 19,217 | 15,074 | 3,176 | $0.0120 |

Read: sweet adds a **constant ~1,500-token prefix** (M± rules + system override) on every harness,
fully displaces native grep (nativeGrep → ~0), cuts trajectory growth everywhere, and **halves
output tokens on claude-code** — and still loses there, purely because of the `dart-lang` outlier.
The +52% on `dashbitco__nimble_options-43` (codex) shows the fixed prefix dominates on SHORT
trajectories. Prefix amortization is a real, unexplored axis.

### 1f. FINDING E — the discordant pair is agent-bound

`pytask-dev__pytask-210`. Every sweet rollout on every harness edited exactly the right file. On
codex sweet threaded `exc_info` through the call chain (3 hunks, solved); on opencode it reached the
SAME insight (`if callable(is_hidden)`) but called `is_hidden()` with no argument and never
propagated the parameter (1 hunk, failed). Right location, shallower edit. Per-rep: native won it
1/2 on opencode and 1/2 on claude-code (coin flips); sweet won 2/2 on codex.

---

## 2. THE DEAD LIST — do NOT propose any of these

Every item below was tested and killed. Re-proposing one is a failure of this handoff.

**Cost levers, all dead at the $0 gate:**
- **Turn/context packing** — CLOSED 2026-08-06.
- **Context eviction** (e.g. 32K-cap replay) — DEAD 2026-08-10. It measured **+7.7% saved on
  idealCost while actually LOSING 12.3%** on break-priced. This is why break-priced exists.
- **Tool-result fusion** — DEAD 2026-08-10.
- **Preamble trimming** — DEAD 2026-08-10.
- **Thrash reduction in all three forms** — novelty-stall detection, no-progress abort, failed-edit
  retry limiting. ALL no-go 2026-08-11. Root cause: **there is no doomed tail.** Every rollout ends
  `model_stopped`; none hits a cap. Failed tasks have the SAME spend profile as solved ones. Today's
  204 rollouts confirm it again — every exit is `model_stopped`.
- **Five further GPT-sourced cost levers** — $0-gated out during the poll-await work.

**Resolution / prompt levers, dead:**
- **Completeness card** — DEAD at $0 (0–1 starved cases against a bar of 2).
- **Checkpoint-on-green** — NO-GO (zero exposure measured three ways; 2 of 5 grader regressions).
- **Tests-first prompting** — REJECTED in two independent rounds.
- **Match-judge trust gating** — rejected.

**Already SHIPPED — do not re-propose as new ideas:**
M++++ and M+++++ (memory-file delivery + verdict-gated trust), `SS_RT_LONGYIELD` (−71% run_tests
polls, solve-neutral), P2 fix-surface, ss-grep round-robin file diversity + `--in`, span map +
unread trailer + result diet, trace trust gates, L1 condenser / L2 rt-authority, rt-dedup.

**Infrastructure dead ends:** bareapi 60-call-cap harness (rejected); Muse Spark (hard 403, US-only,
box is Frankfurt); mimo backbone (too slow, dropped); INT4 quantization (rejected); float HNSW
(removed).

**Ranking-signal trap:** any new ranking signal that detects structured-query patterns MUST be
gated on `opts._isAgentFormat`. Ungated, it has regressed GCSN twice: −0.07pp, then **−27.57pp**.

---

## 3. Non-negotiable methodology

1. **$0 exposure gate FIRST.** Before running any lever, prove from EXISTING traces that its
   trigger condition occurs often enough to matter. Most levers die here, for free. Load the
   `microsmoke` skill for the full protocol.
2. **Never infer "was not in context" from trajectory files.** They truncate tool results at 600
   chars and will fake an absence. Use raw rollout JSONL / opencode SQLite / the patch artifacts.
3. **Read break-priced cost.** Never realized. idealCost alone is blind to prefix-cache breaks.
4. **Solve is the veto dimension.** Report cost only with solve stated beside it. At n=17 the cost
   noise band is wide; trust per-task solve flips first, and check per-REP before believing any flip
   — today three of four "differences" were single-rep coin flips.
5. **REPS≥2, CONCURRENCY=1, matched caps.** `MAX_TOOL_CALLS` is bareapi-only; all three real
   harnesses are uncapped, so caps match by absence. `AGENT_TIMEOUT_MS=1800000` is the real bound —
   hold it identical.
6. **Green ledger invariant.** No run without one. The fingerprint is **harness-agnostic** (it
   covers image/testCmd/net/excludes/presed/rt-* shim sources, NOT the agent harness), so one ledger
   serves all three harnesses. Editing any `rt-*.mjs` invalidates it and forces a re-sweep.
7. **HO2 is frozen. Never touch it.** DEV-RET rotated tasks only. Rotate tasks to resist overfit.
8. **One pilot at a time on the box** (uid-501 dubious-ownership bug). Abort if `df /` avail < 12G.
9. **M± is delivered via the memory file** (CLAUDE.md / AGENTS.md), never in-prompt. Bench-specific
   content (run_tests usage, completion discipline) goes in the FRAME, for BOTH arms. M± stays general.

---

## 4. The workflow to build

Use the `Workflow` tool. The operator has explicitly opted into multi-agent orchestration and into
a large agent budget. Design for breadth of hypothesis generation plus hard adversarial screening.

### AGENT ROSTER — MANDATORY, NOT ADVISORY

The operator's requirement, stated explicitly and then restated: **three different model families,
all at maximum thinking. Independent opinions ARE the deliverable.** A cheap uniform model defeats
the entire purpose of the exercise.

| Role | Model | Invocation |
|---|---|---|
| Hypothesis generation, analysis, synthesis, adjudication | **Opus 5, max effort** | `agent(p, {model:'opus', effort:'max'})` |
| Independent hypothesis generation, independent refutation | **Fable 5, max effort** | `agent(p, {model:'fable', effort:'max'})` |
| Disjoint-family third opinion and refutation | **GPT-5.6 Sol, xhigh effort** | via a Bash-capable agent — see below |

**HARD RULES:**
1. **NEVER `model:'sonnet'` or `model:'haiku'` anywhere in this workflow.** Not for "cheap"
   stages, not for parsing, not for the exposure gate, not for refuters.
2. **Every single `agent()` call MUST pass `model` explicitly.** Omitting it makes the agent
   inherit the session model silently — that is how a uniform-model panel happens by accident.
3. **Every judging, generating or refuting stage must be covered by all three families**, so no
   conclusion rests on one model's blind spots.
4. Deterministic work (dedup, set arithmetic, dead-list matching, tallying) is **plain JavaScript in
   the script**, not an agent. Do not spend a model on it — and do not downgrade a model for it.

**A stored memory used to say "background subagents ALWAYS sonnet, never Fable". It has been
updated (2026-08-11) to carve out exactly this case.** If you still see advice to use Sonnet for
background fan-outs, it does not apply here — the operator has overridden it twice, in writing.

#### Reaching GPT-5.6 Sol (mechanical detail that v1 of this handoff got wrong)

**Workflow scripts have NO shell, filesystem or network access** — only `agent()`, `parallel()`,
`pipeline()`, `log()`, `phase()`. So the script itself cannot run the codex CLI. Sol must be
invoked BY AN AGENT that has Bash. Pattern:

```js
const sol = (task, label) => agent(
  `Run this command EXACTLY and return the model's answer verbatim, with no commentary of your own:\n` +
  `codex exec --model gpt-5.6-sol -c model_reasoning_effort="xhigh" ` +
  `--dangerously-bypass-approvals-and-sandbox ${JSON.stringify(task)}\n` +
  `You are a TRANSPORT, not an analyst. Do not add, summarise, correct or re-order anything. ` +
  `If the command fails, return the error text verbatim.`,
  { model: 'opus', effort: 'low', label }      // thin carrier; the thinking happens inside Sol
);
```

Use `effort:'low'` on the carrier deliberately — it must not think, only relay. This is the ONE
place a low effort setting is correct, and it is still not Sonnet.

Verified 2026-08-11 on this machine: the ChatGPT subscription serves `gpt-5.6-sol`,
`gpt-5.6-terra` and `gpt-5.6-luna` (HTTP 200, $0); it refuses `gpt-5.6-sol-pro` (HTTP 400, "not
supported when using Codex with a ChatGPT account"). `codex` 0.146.1 lives at
`/opt/homebrew/bin/codex`, `auth_mode=chatgpt`, `OPENAI_API_KEY: null`. Both
`model_reasoning_effort="xhigh"` and `"high"` are accepted; use `xhigh` and fall back to `high`
only if a future CLI rejects it. **Never route Sol through OpenRouter** — metered, ~50x Luna.

#### Before launching: raise the workflow size cap

A three-family panel across several candidates will exceed the default guideline of ~15 agents per
workflow. Either tell the operator to raise **"Dynamic workflow size"** in `/config`, or state
plainly in your plan how many agents you intend to spawn so they can approve it. Do not silently
shrink the panel to fit the cap — that would quietly drop the model diversity that is the point.

### Phase design — skeleton, models already assigned

Adapt freely, but keep three properties: (a) the three families generate **independently**, (b)
every survivor is refuted by a family that did not propose it, (c) dead-list screening is code.

```js
export const meta = {
  name: 'sweet-lever-hunt',
  description: 'Three-family lever hunt for sweet cost + resolution, screened against the dead list',
  phases: [
    { title: 'Generate', detail: 'Opus / Fable / Sol propose independently', model: 'opus+fable+sol' },
    { title: 'Gate',     detail: '$0 exposure measured from the 204 rollouts' },
    { title: 'Refute',   detail: 'cross-family adversarial verification' },
    { title: 'Synthesize', detail: 'ranked slate, Opus max' },
  ],
}

const EVIDENCE = `<paste §0 + §1 + §2 + §3 of this handoff verbatim>`;
const ASK = `${EVIDENCE}\n\nPropose levers that make sweet CHEAPER and RESOLVE MORE, on all three
harnesses. Anything on the DEAD LIST is an automatic failure — do not propose it. For each lever
give: mechanism, which finding it attacks, which harnesses it applies to, the cheapest measurement
that would falsify it, and your honest confidence.`;

// ── Phase 1: independent generation, one per FAMILY. No agent sees another's output.
phase('Generate')
const proposals = (await parallel([
  () => agent(`${ASK}\n\nLens: COST.`,       { model: 'opus',  effort: 'max', phase: 'Generate', schema: LEVERS }),
  () => agent(`${ASK}\n\nLens: RESOLUTION.`, { model: 'opus',  effort: 'max', phase: 'Generate', schema: LEVERS }),
  () => agent(`${ASK}\n\nLens: COST.`,       { model: 'fable', effort: 'max', phase: 'Generate', schema: LEVERS }),
  () => agent(`${ASK}\n\nLens: RESOLUTION.`, { model: 'fable', effort: 'max', phase: 'Generate', schema: LEVERS }),
  () => sol(`${ASK}\n\nLens: COST.`,       'sol:cost'),        // carrier pattern above
  () => sol(`${ASK}\n\nLens: RESOLUTION.`, 'sol:resolution'),
])).filter(Boolean);

// ── Phase 2: dedup + dead-list screen — PLAIN CODE, no agent, nothing silently dropped.
const dead = [/pack/i, /evict/i, /fus(e|ion)/i, /preamble/i, /thrash/i, /novelty.?stall/i,
              /no.?progress/i, /completeness card/i, /checkpoint.?on.?green/i, /tests.?first/i,
              /match.?judge/i];
const seen = new Set(), live = [], killed = [];
for (const p of proposals.flatMap(x => x.levers)) {
  const key = p.name.toLowerCase().replace(/[^a-z]/g, '');
  if (seen.has(key)) continue; seen.add(key);
  const hit = dead.find(rx => rx.test(p.name + ' ' + p.mechanism));
  (hit ? killed : live).push(hit ? { ...p, killedBy: String(hit) } : p);
}
log(`${live.length} live, ${killed.length} killed by the dead list`);

// ── Phase 3+4: exposure gate then cross-family refutation, pipelined (no barrier).
const verdicts = await pipeline(live,
  l => agent(`Measure EXPOSURE for this lever from the 204 rollouts on the box. How often does its
trigger actually fire, and what is the CEILING on its benefit? Zero exposure = dead; say so
plainly.\n\n${JSON.stringify(l)}\n\n${EVIDENCE}`,
    { model: 'opus', effort: 'max', phase: 'Gate', schema: EXPOSURE }),
  (exp, l) => exp.exposure === 0 ? { ...l, verdict: 'dead-no-exposure', exp }
    : parallel([
        () => agent(`REFUTE this lever. Default to refuted if uncertain. Lens: does the trigger
really fire as claimed?\n${JSON.stringify({ l, exp })}`, { model: 'fable', effort: 'max', phase: 'Refute', schema: VERDICT }),
        () => agent(`REFUTE this lever. Default to refuted if uncertain. Lens: even if it fires,
would it change the OUTCOME (solve or cost)?\n${JSON.stringify({ l, exp })}`, { model: 'opus', effort: 'max', phase: 'Refute', schema: VERDICT }),
        () => sol(`REFUTE this lever. Default to refuted if uncertain. Lens: what does it COST
elsewhere — regressions, latency, other harnesses?\n${JSON.stringify({ l, exp })}`, 'sol:refute'),
      ]).then(v => ({ ...l, exp, survives: v.filter(Boolean).filter(x => !x.refuted).length >= 2 })));

// ── Phase 5: synthesis. Opus max. Must report the killed list too.
phase('Synthesize')
return await agent(`Rank the survivors into a slate. State evidence class, exposure, per-harness
applicability, expected effect on BOTH solve and cost, and the exact next experiment. Then list what
was killed and why — including dead-list hits. Do not soften a dead verdict.
\n${JSON.stringify({ verdicts, killed })}`, { model: 'opus', effort: 'max' });
```

Note the refuters for a lever are drawn from families that did not necessarily propose it, and the
majority rule is 2 of 3. If a lever was proposed by Opus, weight Fable's and Sol's refutations.

The dead-list regexes are a blunt first pass (`/pack/i` will also hit "package"). Every kill is
carried into the synthesis output with its reason so a false positive is visible and recoverable.
Never drop a proposal without recording it.

#### The exposure gate is WORTHLESS unless agents touch the real data

This is the single most important mechanical requirement in this handoff. An agent asked to
"measure exposure" from a prose summary will invent numbers. Every gate and refute agent MUST be
told, in its own prompt, how to reach the evidence — subagents do not inherit this document.

Data lives on the box: **`ssh root@167.233.69.121`**, under
`/root/sweet-search-private/eval/task-completion-bench/results/<RUN_ID>/` for
`RUN_ID ∈ {sb-codex-20260811, sb-opencode-20260811, sb-claudecode-20260811}`:

| Artifact | Contains | Use it for |
|---|---|---|
| `rows.json` | 68 rollouts: `taskId, arm, rep, resolved, calls, ss, nativeGrep, patchHunks, patchFiles, exitReason, breakPricedCostUsd, idealCostUsd, contextRewrites, idealTurns, turnsFile` | solve/cost/tool-use tallies |
| `preds-<arm>.jsonl` | `model_patch` — the FULL final diff, untruncated | localization vs gold, edit shape |
| `turns/<task>-<arm>.jsonl` | per-turn `{in, cached, out}` + meta | context growth, prefix cost |
| `trajectories/` | tool-call sequences | ordering only — **results truncated at 600 chars** |
| `rt-dedup/` | repeat-`run_tests` audit | redundant test runs |

Gold patches come from `select/.cache/tasks_full_luna_rotate20.json` (`spec.patch`,
`spec.test_patch`). Worked example — the localization taxonomy in §1a is reproduced by:

```bash
ssh root@167.233.69.121 'cd /root/sweet-search-private/eval/task-completion-bench && node -e "…
  const gold = files(spec.patch);                       // diff --git a/<path>
  const agent = files(pred.model_patch);
  const cls = !agent.length ? \"no-edit\"
            : !agent.some(f=>gold.includes(f)) ? \"WRONG-LOC\"
            : gold.every(f=>agent.includes(f)) ? \"loc-ALL\" : \"loc-some\";
"'
```

**Read-only.** Do not launch rollouts, do not spend money, do not mutate `results/`. If a candidate
needs a new run, that is a recommendation for a later session, not an action for this one.

### Specific questions worth assigning

- Can sweet surface **sibling fix sites** after the first edit (Finding A)? 2-hop graph expansion
  already exists and is fast (single-digit ms) — is the gap capability or surfacing?
- What exactly happens on `dart-lang__http-1114` under claude-code, where sweet edits 6 wrong files
  (Finding D)? That one task is claude-code's whole cost loss.
- Can the **~1,500-token fixed prefix** be amortized or trimmed without losing ss-* behaviour? It is
  what makes short trajectories lose (+52% on `dashbitco__nimble_options-43`).
- Why does sweet halve output tokens on claude-code yet not save money there?
- Is the `codeception__codeceptjs-367` miss (Finding C) a real retrieval defect or noise?
- The 7 tasks nobody ever solves — is any of them reachable at all, or is the floor genuinely fixed?

---

## 5. Operational recipe (all verified 2026-08-11)

- **Box:** `root@167.233.69.121`. Runner `/root/sb-run.sh` (3-cell scoreboard runner; holds tasks,
  ledger, caps, timeouts identical across cells). `/root/smoke.sh` for codex-only smokes.
- **Ledger:** `/root/.ss-eval/ledger-postfix-20260807/ledger.jsonl` — 17/17 gold-FULL, re-verified
  under all three harnesses today.
- **Tasks:** `select/.cache/tasks_full_luna_rotate20.json` — 18 specs, of which
  `litestar-org__polyfactory-405` is excluded by `harness/task-overrides.json` as unfixable in the
  shim ⇒ **17 usable**.
- **Free codex cell:** `HARNESS=codex MODEL=openai/gpt-5.6-luna PROVIDER=openai CODEX_SUBSCRIPTION=1
  REASONING=medium EGRESS_ALLOW=chatgpt.com,openai.com`. `MODEL` must be the FULL pricing key —
  the bare id aborts every rollout at the pricing guard.
- **Metered cells:** `PROVIDER=openrouter`, `EGRESS_ALLOW=openrouter.ai`; routed through
  `harness/openrouter-spend-guardian.mjs` (operational stop $45). Luna is ~$0.5/cell of 68 rollouts.
- **GOTCHA if you ever bench Sol:** `openai/gpt-5.6-sol` is **NOT** in `MODEL_PRICES`
  (`harness/ideal-cost.mjs`) and will throw "no pricing registered". OpenRouter rates are
  `{in: 5.0, cache: 0.5, out: 30.0}`. Sol as a bench backbone via OpenRouter is ~50x Luna — for
  analysis only, use the free subscription path above.
- **Keep the harness in sync.** On 2026-08-11 the box was running code that predated the
  break-priced column, so that column did not exist there for ANY harness. Checksum
  `harness/*.mjs` between Mac and box before trusting a run. Commit `eff752d` also repaired
  claude-code per-turn cost recovery and added break-priced to the shared `costsFromTurns`.

---

## 6. Deliverable

A ranked slate of candidate levers for **cost** and for **resolution**, each with: evidence class
(direct / inferred / speculative), measured exposure from the 204 rollouts, which harnesses it
would apply to, expected effect on solve AND cost, the adversarial verdict, and the exact next
experiment. Plus an explicit list of what was proposed and killed, with reasons. Record everything
in a RUN-LEDGER in this folder.

**Build nothing in the workflow.** Anything that survives goes through the normal $0-gate-first
microsmoke discipline in a later, separate session.
