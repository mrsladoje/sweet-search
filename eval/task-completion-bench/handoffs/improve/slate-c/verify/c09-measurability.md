# c09 — adversarial verify, DIFFERENTIAL and MEASURABILITY lens

Date: 2026-09-02. Cost of this study: `$0`. I read traces, read code, and did arithmetic.
No model rollout ran. The evidence box was read only. My scratch is
`/tmp/wf-slatec/c09-measurability/` on the box.
Tags: `[M]` measured with a named script, `[C]` read from code, `[I]` inferred.

---

## 0. Verdict

**REFUTED. Confidence 0.93.**

c09 fails its own pre-registered kill condition, and I fired that kill condition at `$0`.
The candidate says: kill the help repair if fewer than 30 of 48 recorded usage errors become
valid under the proposed flag table. **Measured: 14 flag occurrences, in 13 records, become
valid** `[M rescuable.py, chaincheck.py]`. Counting `--full` on `ss-grep`, which the candidate
also names, the total is 19. Both numbers are below 30. The falsifier fires.

Three further facts decide the case, and I measured all three.

**First, the tools already self-describe.** `failUsage` prints the whole usage line before it
exits 2 `[C _ss-helpers.mjs:188-190]`. The traces confirm the model received it. In
`fp-claudecode-tab-20260826`, task `awslabs__aws-embedded-metrics-node-21`, sweet arm, rep 2,
subagent `a484cf2677177e8ef`, the agent ran `ss-grep --help`, `ss-find --help` and
`ss-read --help` (each "Exit code 2", each printing full usage), and then ran
`ss-grep -i 'dimension' --in src --in test -k 100` and got 173 matches on the first try `[M
seq.py]`. It used three flags it had just been shown. The repair changes an exit code and one
prefix line. It does not change the information the model receives.

**Second, the exposure on the two harnesses that need help is exactly zero.** Of 3,064 sweet
`ss-*` operations in the fresh pool, the flags c09 adds appear on **claude-code 14 times, codex
0 times, opencode 0 times** `[M rescuable.py]`. The candidate's stated ceiling of "~0.2%
elsewhere" is 0.00% elsewhere. codex must close +0.35% and opencode +3.31%; c09 offers those two
harnesses nothing at all.

**Third, the guide-drop half rests on a census that measures the wrong thing.** The
98-to-100-percent "guide-only syntax" figure counts `-k`, read spans, `--in` and `--regex` — every
one of which the shipped usage strings already print `[C]`. Credit the usage strings and the same
census gives **1.24% codex, 0.76% opencode, 0.69% claude-code** `[M guidesyntax_repaired.py]`.
Seed S1's 20% kill line does not fire on that reading. c09's headline ("closes B3 at $0") is not
supported; it is also self-contradictory, because c09 elsewhere predicts the same repair drives
dependence to zero.

The admissible residue is two recorded events (`-E` and `-iE` on `ss-grep`) worth about **0.05%
of the claude-code sweet cell** `[I on M]`. That is 100 to 500 times below the bench's cost
noise. Ship the repair as `E2`-class hygiene with no benchmark claim. That is also exactly what
the 2026-08-28 panel already decided about this same defect.

---

## 1. What I measured, and with what

| script (on the box, `/tmp/wf-slatec/c09-measurability/`) | what it answers |
|---|---|
| `allerr.py` (mine) | every recorded `ss-*` usage-error record in the fresh-pool TAB sweet arm, with its command and its first error line |
| `helpout.py` (mine) | the literal stdout/stderr the model received for each `--help` / `-h` / unknown-flag event |
| `seq.py` (mine) | the ordered subagent call sequence around the `--help` and `-E` failures |
| `rescuable.py` (from `c09-history`, re-run) | flag occurrences the CURRENT parser rejects, and the subset c09 rescues |
| `errcensus.py` (from `c09-history`, re-run) | error classes per harness and per thread |
| `guidesyntax_repaired.py` (from `c09-history`, re-run) | guide-only syntax share once the shipped usage strings are credited |

Data: `/tmp/wf-slatec/native-capability-gaps/calls-classified.jsonl.gz` (10,942 classified calls,
built by a sibling agent from `fp-{codex,opencode,claudecode}-tab-20260826`).
Denominators: 66 sweet rollouts per harness; 970 / 788 / 1,306 sweet `ss-*` operations
(codex / opencode / claude-code), 3,064 total.

---

## 2. The `$0` falsifier, run

### 2.1 The full usage-error census

`[M allerr.py]` **50 usage-error records** in the fresh-pool TAB sweet arm:

| cell | usage-error records |
|---|---:|
| codex, main thread | 1 |
| opencode, main thread | 5 |
| claude-code, main thread | 10 |
| claude-code, subagents | 34 |
| **total** | **50** |

This reproduces the source's "36 of 329 subagent, 12 of 779 main" for claude-code
(`native-capability-gaps.md` §3.2); records hold one or two calls each.

### 2.2 What the current parser already accepts

`[M rescuable.py]` Flag occurrences that today's parser rejects, out of 3,064 sweet `ss-*`
operations:

| harness | operations | rejected flag occurrences | rescued by c09's new rules |
|---|---:|---:|---:|
| codex | 970 | 1 (`ss-grep --like`) | **0** |
| opencode | 788 | 0 | **0** |
| claude-code | 1,306 | 31 | **14** (1.07% of its operations) |

The 14 are `ss-grep --help` 5, `ss-find --help` 4, `ss-search --help` 1, `ss-read --help` 1,
`ss-grep -h` 1, `ss-find -h` 1, `ss-grep -E` 1. `ss-grep -iE` (1 more) is rescued only if `E`
also joins `BOOL_SHORTS`, so that the bundle splits `[C _ss-argparse.mjs:79,99-118]`.

### 2.3 The kill condition fires

c09: *"Help repair: fewer than half (R3: <30) of 48 usage errors become valid."*

- Rescued by the genuinely new rules (`--help`, `-h`, `-E`): **14 occurrences / 13 records**.
- Adding `--full` on `ss-grep`, which c09 also lists: **+5 → 19**.
- Kill line: 30. **14 < 30 and 19 < 30. The candidate is killed by its own falsifier.**

### 2.4 The trap inside the falsifier as written

The fresh pool ran on **2026-08-26**. The `ss-*` hygiene commit `36b802e` landed on
**2026-08-28**. A naive re-parse "against the proposed table" therefore credits c09 with repairs
that already shipped. Concretely, `--in` on `ss-find` did not exist during the run and exists now
`[C git show 36b802e]`; the recorded `FIND_USAGE` in the traces lacks `[--in <path>]...` and the
current one has it. About 25 of the 50 records are already valid today for that reason. A naive
re-parse would score roughly 44 of 50 and report a PASS.

This is the register's own rule: **never pool a run across a shipped fix.** The falsifier must be
re-specified as *"flags the CURRENT post-`36b802e`/`fb9f936` parser rejects"*. On that
specification the answer is already measured: 14, not 44.

---

## 3. Differential lens

**Vehicle: sweet-only. This part of the candidate is sound.** `_ss-argparse.mjs` and
`_ss-helpers.mjs` are the `ss-*` wrappers; native never runs them. `inject-agent-instructions.js`
writes only the sweet arm's guide. No shared FRAME, no shared `run_tests` shim, no shared harness
setting. No zero-differential violation.

**Payload: 12 of the 14 events re-render text the model already has.** BRIEF §0.7 admits a
payload lever only if it changes *which* lines or *which* requests happen. Recorded outputs
`[M helpout.py]`:

```
CMD: .../ss-grep --help
OUT: Exit code 2
     [ss] unrecognised option "--help"
     Usage: ss-grep <regex> [-i|--ignore-case] [-w|--word-regexp] [-F|--fixed-strings] [--in <path>]... [-k N]
```

```
CMD: .../ss-read --help
OUT: Exit code 2
     [ss-read] "--help" looks like a flag, but ss-read takes a file path first.
     Usage: ss-read <file>            # whole file
            ss-read <file> <start>    # ONE line
            ss-read <file> <start> <end>
            ss-read <file> 10-20      # range (also 10:20, 10,20)
     Option: --force shows content again after an unchanged-content omission.
```

The lines that would change are one prefix line and the "Exit code 2" label. The requests do not
change: the agent chose to run `--help`, and it would still run it. In 12 of 13 records the
`--help` call is solo, not chained, and no record shows the same tool's `--help` retried after a
failure `[M chaincheck.py]`.

**Two events do change which requests happen.** `ss-grep -iE …` in
`awslabs__aws-embedded-metrics-node-21/sweet/rep2` and `ss-grep -n -E …` in
`bfgroup__b2-113/sweet/rep2` were each followed by a reformulation `[M seq.py]`. That is the
admissible part, and it is two events in 198 rollouts.

**Code-path citation is wrong.** c09 cites `_ss-helpers.mjs` 226-228 (`rejectUnknownOptions`).
That function has exactly one caller, `ss-semantic` `[C line 899]`. All 14 recorded rejections come
from `resolvePositional` → `extractPositional` → `failUsage` `[C lines 180-190]`, or from
`ss-read`'s own "looks like a flag" branch `[C lines ~563-566]`. Patch the wrong function and
nothing recorded changes.

---

## 4. Measurability lens

### 4.1 Honest ceiling

Price of one removed claude-code request: `$0.000318` (`verify-tail.md` §5). claude-code sweet
cell: `$0.020727` per rollout (BRIEF §1).

| bound | arithmetic | per rollout | share of cell |
|---|---|---:|---:|
| all 14 rescued calls become free requests (not physically true) | 14 / 66 × $0.000318 | $0.0000675 | 0.33% |
| **realized: 2 reformulation events removed** | 2 / 66 × $0.000318 | **$0.0000096** | **0.047%** |
| prefix line deleted on 14 calls (~10 tokens, re-sent 20.1×) | 140 × $0.301/M ÷ 66 | $0.0000006 | 0.003% |

**Honest total: about 0.05% of the claude-code sweet cell. Exactly 0.00% on codex and
opencode.** `[I on M]`

c09 states "≤0.56% of claude-code sweet arm, ~0.2% elsewhere". The 0.56% is
`claude-subagents.md` line 124's *"requests whose every `ss-*` call failed"* bucket, which holds
all 36 subagent failures, not the 10-to-14 that `--help` and `-E` explain. It over-attributes by
about 3×, and the realized figure is about 12× smaller again. The "~0.2% elsewhere" appears to be
`native-capability-gaps.md` S3's global "≤0.2%" ceiling re-used as a per-harness floor; measured
exposure elsewhere is zero.

### 4.2 Detectability

Noise floor on this pool, 95% bootstrap interval on the sweet-minus-native cost ratio:
codex [−11.5%, +13.2%], opencode [−8.1%, +17.0%], claude-code main [−19.6%, +26.9%]
`[M inversion-and-removal.md §1, gutter_cost3.py]`. The brief gives per-rollout cost intervals of
about ±$0.001 to ±$0.005.

An effect of $0.0000096 per rollout is **100 to 500 times below** that interval, and 0.05% is
**180 to 460 times below** the bootstrap half-width. Solves: 0 of 66 expected to change, against a
bar of ±6. **No run this programme can afford would ever see this.** That is not a reason to
refuse a correctness fix; it is a reason to refuse the cost claim.

### 4.3 Concentration

All 14 events sit in **claude-code subagents**, in 4 tasks (`asynkron__protoactor-dotnet-1909`,
`awslabs__aws-embedded-metrics-node-21`, `bfgroup__b2-113`, `final-form__final-form-64`) and 6 of
198 rollouts `[M chaincheck.py]`. Codex and opencode delegated zero times in the fresh pool
`[M claude-subagents.md]`, so the population that generates these errors does not exist there.

---

## 5. The guide branch (B3) does not close

### 5.1 The census counts forms the tools already print

`[M guidesyntax_repaired.py]` Once the shipped usage strings are credited as a source of syntax:

| harness | `ss-*` operations | guide-ONLY after credit | residual forms |
|---|---:|---:|---|
| codex | 970 | 12 (**1.24%**) | `ss-trace` mode word only |
| opencode | 788 | 6 (**0.76%**) | `ss-trace` mode word only |
| claude-code | 1,306 | 9 (**0.69%**) | `ss-trace` mode word only |

`-k`, read spans, `--in`, `--regex` and the `ss-semantic <file> "<query>"` form are all in
`GREP_USAGE`, `READ_USAGE`, `SEARCH_USAGE`, `FIND_USAGE`, `SEMANTIC_USAGE` and `TRACE_USAGE`
today `[C _ss-helpers.mjs:328, 550-555, 690, 445, 891, 939]`. The 98-to-100-percent figure is a
count of guide-*taught* forms, not guide-*only* forms.

S1's kill line is "more than 20% of `ss-*` calls depend on guide-taught syntax". On the corrected
reading the value is 0.69% to 1.24%, so the line does not fire.

### 5.2 The "6.2 to 7.6 times" loss mixes two units

c09: the guide costs `$0.00042-0.00051` per rollout, and dropping it costs `$0.0032` of
discovery, so the drop loses 6.2 to 7.6 times what it saves.

The `$0.0032` is **per guide-less subagent**, and it is an upper bound on a union of two sets
(`claude-subagents.md` lines 123-124: 31 pre-`ss-*` requests plus 15 wholly-failed requests, at
most `$0.0255` over 8 subagents). The same report gives the **per-rollout** figure:
`$0.00039` (line 9). Against the claude-code guide cost of `$0.000511` per rollout, the guide
costs **1.3× the discovery tax**, not 0.13× of it. The ratio reverses when the units match.

The per-subagent ratio is real, but it argues for putting the guide in front of subagents (the
`Explore.md` idea), not against dropping it from the main thread.

### 5.3 The evidence does not reach the harnesses S1 targets

The only guide-less natural experiment in the pool is 8 claude-code `Explore` subagents. Codex and
opencode delegated zero times `[M claude-subagents.md §"Codex and opencode: 0"]`. S1 proposes
dropping the guide **on codex and opencode only**, with a ceiling of −3.4% and −4.4% — larger than
both measured gaps (+0.35% and +3.31%). c09 uses a claude-code-only observation to kill it on two
harnesses where the observation does not exist, and its census also fires on claude-code, which S1
does not touch.

Those Explore subagents were also unrepresentative: they ran in a git worktree the index does not
cover, so their scoped calls returned silent zeros whatever the syntax, and they hunted for the
binaries because PATH did not resolve in that cwd `[M native-capability-gaps.md §3.2]`.

### 5.4 An untested inversion

c09's own `solve_risk` says a guide-less arm "may stop using `ss-*` (untested)". If that happens,
sweet's cost converges on native's, which is the brief's stated target. The "negative ceiling"
claim assumes the arm keeps paying for `ss-*` discovery. Neither branch is measured. B3 stays a
user decision, not an evidence question.

---

## 6. Register and rule check

| rule | result |
|---|---|
| HO2 never opened per task | not opened |
| gold, hidden tests, task identity as runtime inputs | none proposed |
| ranking signals gated on `_isAgentFormat` | not touched by `--help` or `-E`; if `--full` is added to `ss-grep` it must map to an agent format, which the gate already covers |
| owner "no new tools" | respected; `new_tool: false` is correct |
| owner decisions flagged | correct: the guide branch is flagged `needs_user_decision` |
| shared vehicle / zero differential | no violation; vehicle is sweet-only |
| no same-information compaction (§0.7) | **breached for 12 of 14 events**: identical usage text, same requests |
| never pool a run across a shipped fix | **breached by the falsifier as written** (see §2.4) |

**Novelty.** `--help` exits 2 was already named and dispositioned. `PANEL-SYNTHESIS.md` §N-3
(2026-08-28): *"Two more defects sit on the same path: `--help` exits 2 … Ceiling: cost about 1%
of sweet spend, solve 0 tasks. Dead as a bench lever … Ship it as a correctness fix … Claim no
benchmark value for it."* The same file's killed table lists "Scope and flag honesty for the ss
CLI" at cost 0.99%, solve under 1 task. c09's own ceiling (0.56%) is smaller than what was already
killed on that surface.

---

## 7. What the synthesis should keep

1. **Ship `--help` / `-h` with exit 0 and `-E` / `--extended-regexp` as inert, as `E2`-class
   hygiene, with no cost claim.** Real-user value is genuine: `ss-grep --help` returning 2 breaks
   any script under `set -e`. Bench value is 0.05% on one harness and zero on the other two.
2. **Do not spend the "precondition for B3" argument.** The tools already print their syntax on
   the error path, so the precondition is largely met today.
3. **Point at the bigger neighbour instead.** On the same claude-code subagent surface, 45 of 57
   worktree-scoped `ss-grep`/`ss-find` calls returned a silent zero, and the agents then did
   127 native operations and 184,470 tokens of retrieval `[M native-capability-gaps.md G1]`. That
   is roughly three times c09's call count and orders of magnitude more tokens. It is the same
   vehicle and the same build cost.
4. **Repairs that actually cost a request and are NOT in c09's table**, all recorded: repeated
   `--in` plus `-k` on `ss-trace` (one retry in `awslabs.../rep2`), `--in ""` (empty scope),
   `-iname` / `-o` on `ss-find`, `--include=<glob>` on `ss-grep`, `--start` / `--end` on
   `ss-read`. If the flag table is widened, widen it to these.

---

## 8. What I could not finish

- I did not price the `--full`-on-`ss-grep` alias, because `ss-grep` has no `agent_full` render
  path today; whether those 5 records become useful calls or merely non-erroring ones is a design
  question, not a measurement.
- I did not verify the `-E` bundle behaviour by running the wrapper. I read the normaliser
  `[C _ss-argparse.mjs:99-118]` and inferred that `-iE` needs `E` in `BOOL_SHORTS`. Running `ss-*`
  in this repository is against the standing instruction to use native tools here, and the
  recorded traces answered the question anyway.
- I did not attempt a counterfactual estimate of how a guide-less **main thread** behaves on codex
  or opencode. No such rollout exists in any pool I am allowed to open.
