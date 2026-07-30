# PLAN — Held-out 200 (Grok-4.5 / OpenCode) consolidated forensics & action plan

**Run**: `heldout200-grok45-opencode-p7fs-{c1,c2rest}-20260726`
**Prompt**: `p7-v1-mppppp-fs` (1307 tok), completion frame + M± delivered via `AGENTS.md`
**Consolidated**: 2026-07-29, from three passes over the same run:

| tag | source document | data source | role |
|---|---|---|---|
| **[O]** | `FORENSICS-heldout200-grok-opencode-2026-07-28-OPUS-5.md` | condensed trajectory JSON + cost algebra | original defect/finding register (5 claims later corrected, recorded in its §G) |
| **[R]** | `FORENSICS-heldout200-grok-opencode-2026-07-28.md` | raw OpenCode SQLite DB (`/root/.local/share/opencode/opencode.db`), 400/400 matched sessions | authoritative rewrite — exact per-turn token splits, untruncated tool results |
| **[V]** | `FORENSICS-heldout200-grok-opencode-VERIFICATION-2026-07-29.md` | fresh rsync, from-scratch scripts, 20 blind sonnet readers | independent verification — reproduced every load-bearing number, sized contamination |

[R] and [V] used **disjoint data sources and disjoint methods** and converged on every conclusion.
[V] byte-verified (aggregate-md5) that all passes analyzed identical run data. Where the passes
disagree on a number it is noted inline; §9 carries the discrepancy ledger.

**Mode**: sanctioned post-run forensics, READ-ONLY. No rollout, grading, prompt, golden, or result
was modified or re-run. **These 200 tasks are now evidence, not a tuning set** — every lever in §6
must be validated on dev or genuinely fresh tasks, never by re-running these.

**Reported outcome**: native 93/200 vs sweet 81/200; discordant 16 v 4, McNemar p ≈ 0.012;
partial-macro 0.542 v 0.458; realized cost $102.48 vs $118.06 (+15.2% on full 200 [R];
+14.7% on the 196 cost-paired subset [O] — same quantity, two bases).

---

## Target outcome & run sequence (decided 2026-07-29)

**Goal for the next Grok/OpenCode held-out run** (revised 2026-07-29, after the cost levers were
struck): **a defensible, uncontaminated solve comparison at parity on a fresh, hardened held-out
set**, with cost reported and mechanistically explained rather than optimised.

Why this is achievable on the evidence below:
- **Cost**: the gap is 94.7% re-send tax from turn inflation (§4), arm-internal and
  contamination-independent. Counterfactual at native's calls/turn: **−14.2% instead of +14.7%**,
  stable across subsets (§4.3). **DECIDED 2026-07-29 — the cost levers that acted on this mechanism
  are struck** (P1/P1b MCP: the product is shell-routed `ss-*` and stays that way; P2 anti-thrash:
  repeatedly disproven, and M± is already tuned for retrieval without thrash). **Consequence: no
  remaining lever closes a +15.2% cost gap on the Grok/OpenCode backbone.** The §4.6 honest boundary
  is now the position of record: retrieval compression only pays when retrieval dominates context,
  and on Grok's build-log-heavy transcripts it is ~3%. The cost goal is therefore **not pursued on
  this backbone** — cost is reported and explained by mechanism, not optimised. (P8 M± compression,
  ≈$2 of $15.6, is not worth touching a tuned prompt for.)
  **AMENDED 2026-07-30 — "no remaining lever" is no longer accurate, and the "no prompt edits"
  position is reopened by explicit user instruction.** P9 (turn economy, §6) acts on the turn-count
  half of the re-send mechanism rather than on retrieval compression, so the §4.6 boundary — which
  bounds what *compression* can buy — does not bound it. It is drafted and pending a paired dev
  A/B; it is **not** a plan-of-record cost target until that validates, and the run sequence below
  is unchanged.
- **Solves**: the 93v81 deficit is not established (§2 — strict census 86v76 p=0.031; with
  assisted wins voided ≈2–4 v 2, n.s.). Native exploited the porous environment harder (63 v 43
  probes; 13/16 v 2/4 assisted wins), so P0 hardening removes more from native than from sweet.
  Parity is the *expected* clean outcome; P3/P4 are upside, not the plan of record. Statistical
  honesty: with N=200, rep=1, the achievable claim is "no significant difference", not proven
  equivalence.

**Sequence (each gate blocks the next):**
1. **P0 isolation** (§6) — **IMPLEMENTED 2026-07-29**, pending a full-scale run. Each rollout now
   runs in a per-rollout jail: mount+pid+ipc+uts namespaces with a mask-then-whitelist filesystem
   policy (`harness/agent-jail.mjs`, `agent-jail-init.mjs`), a shared network namespace whose only
   route is a stub resolver + SNI-allowlist proxy (`harness/egress-guard.mjs`, allowlist =
   `openrouter.ai`), no docker socket/client/layer store, a private `/tmp`, and a per-rollout agent
   session store. `run_tests` goes through the existing host-side broker. `escape` is a real
   measurement in all 3 CLI runners (`harness/escape-audit.mjs`); run-pilot REFUSES to launch a CLI
   harness that cannot isolate (`SS_ISOLATION=0` overrides, and stamps every row).
   Verified by `harness/isolation-canary.mjs` — 35/35: every vector blocked *including* IP-pinned
   egress and the new V5b layer store, plus positive controls (checkout writable, ss-* + engine
   reachable, repo read-only, `run_tests` shim on PATH, OpenRouter 200).
   **Two findings from bring-up, both load-bearing:** (a) V5b (§2) is a seventh vector the forensics
   never saw; (b) a mount-ordering bug that buried the `run_tests` shim did not fail quietly — the
   agent, unable to run tests, went hunting the box for a harness and *that* is how it found the gold
   patch. Broken controls change agent behaviour, so the canary now asserts them permanently.
2. **P7 measurement hygiene** — **IMPLEMENTED 2026-07-29.** Per-turn `{in,cached,out}` is now
   persisted by all four adapters to `results/<runId>/turns/<task>-<arm>.jsonl`
   (`harness/turn-log.mjs`), alongside the per-rollout agent session store P0 already
   retained; `costNaiveUsd` means the same thing everywhere and the `toolCounts.edit`
   backfill is gone (details in §3 B1/B3/B4). Covered by `tests/turn-log.mjs`.
3. ~~**P1 MCP variant on dev** + P2 anti-thrash~~ — **STRUCK 2026-07-29.** Benchmarks stay
   shell-only (`ss-*` on `$PATH`); no MCP variant is measured. Anti-thrash guidance is not
   introduced — it has been disproven repeatedly, and M± is already tuned for retrieval without
   thrash. **No M± edits** (P1b, P3, P4, P8 all touch the prompt → all struck; see §6). This gate
   is closed with no work. Remaining pre-run engineering moves into gate 3′:
3′. **Selection- and grader-side gates that must exist BEFORE the set is built** — P6 task
   preflight (reject F2P≥100 / P2P=0 / suite-red-at-baseline tasks, §1.3) and P5 grader isolation
   for test paths (§6). Both are selection/grading changes, not prompt changes, and both are
   unusable if landed after the set is frozen. **BOTH IMPLEMENTED 2026-07-30 — see the status
   block below.** Plus: **sync the P7 turn-log code to the eval box**
   (verified 2026-07-29 as absent there — `harness/turn-log.mjs` missing, no `turnsFile` /
   `costContentUsd` in any P0 smoke row) and confirm `turnsFile` is non-null on both arms of one
   real smoke.
   **P7 box sync DONE 2026-07-30** — the box was at `c61b5e8` with no local harness edits (every
   differing file hash-matched that revision), so `harness/` + `tests/` + `stats/` were synced
   wholesale. On the `l3-dedup-smoke-20260730` run all 5 rollouts carry a non-null `turnsFile`
   whose record count equals the row's turn count (25/82/58/83/56) and a populated
   `costContentUsd`. **Sweet arm only**; the native half **rides on the first native rollout of
   the next run** rather than costing a dedicated smoke — same code path, same adapter, and the
   stamping is arm-independent (confirm `turnsFile` + `rtDedup` on that row and this gate closes).

   **STATUS OF THE OTHER TWO GATE-3′ ITEMS — BOTH IMPLEMENTED 2026-07-30 (§6 rows P5/P6 carry the
   full detail and the evidence):**
   - **P6 task preflight gates — IMPLEMENTED.** Metadata-only, outcome-blind selection-time
     rejection of `FAIL_TO_PASS ≥ 100` or `PASS_TO_PASS == 0`, applied before the seeded draw in
     `select_tasks.py` / `select_heldout.py` (primary + reserve), thresholds single-sourced in
     `select/task-gates.json`, every rejection logged and written to a `REJECTED_<set>.json`
     sidecar next to the manifest, `materialize_tasks.py` as an audit checkpoint, and a WARN-only
     preflight in run-pilot for sets that predate the gate. `harness/task-overrides.json` keeps its
     separate after-the-fact-repair role. **Evidence:** dry run over the retired held-out metadata
     rejects 53/200 (25 on F2P, 40 on P2P, 12 both), including `spectreconsole-1942`,
     `firefly-716` and `btcpayserver-6251`; `jupytext-360` (F2P=33) is correctly below threshold.
     Retired manifests were not modified.
   - **P5 grader isolation for test paths — IMPLEMENTED.** `harness/patch-strip.mjs` in the shared
     `gradeArm` path drops, from the agent's patch, every block touching a file the hidden
     `test_patch` also touches — narrow and collision-based, not a test-glob sweep; symmetric
     across arms; every graded row stamped `strippedTestPaths`. **Evidence:** live re-grade of the
     two damaged tasks from the retired run's saved preds into a scratch dir — control (strip off)
     reproduces `with conflicts` + unmerged paths with zero tests run; with stripping ON the hidden
     patch applies cleanly and the suites execute (logs 24→243 and 46→362 lines). Mechanism check
     only, no solve claim.

   **Gate 3′ is therefore CLOSED for these two items, and the set build (gate 4) is UNBLOCKED.**
   The one remaining gate-3′ thread is the native half of the P7 turn-log confirmation, which
   rides on the first native rollout of the next run.
4. **Build + freeze the NEW held-out set** — **DRAWN + FROZEN 2026-07-30.**
   `select/tasks_heldout2.jsonl` (200) + `select/tasks_heldout2_reserve.jsonl` (67), seed
   `20260731`, V2 pinned at `475dd5e8…`. Rules: `select/HELDOUT2_RULES.md`; pre-registration
   snapshot: `select/FAIRNESS.md`; manifest: `select/MANIFEST_heldout2.json`.
   **Hashes** — primary `67d83ded531112a0ce7ff8082e99a8d10014df3ff24ff4cfe755e97932f148c8` ·
   reserve `113994d5ce1b2ce5e8e9264269c0b593db9854d603d85d2adeec00356963a307` · manifest
   `0417a0f7bf5993f44040df5456b3880973637eb780d896d22539fc9bdbf73164`. The draw was run
   twice from a clean state and is byte-identical.
   Two-tier exclusions (730 instance ids unconditionally; 268 repos where we have task-level
   knowledge — dev-200, the tasks read in forensics, the hand-written override tasks), the
   rejection gate before the draw (4,047 of 17,830 pool candidates rejected), one task per
   repo (200 distinct repos), and proportional redistribution of the 19 slots freed by C#/C++/C
   pool exhaustion. Realized mix: python 34 · ts 33 · js 29 · java 22 · go 20 · rust 20 · php 9
   · kotlin 7 · swift 5 · c 5 · csharp 3 · cpp 3 · scala 2 · dart 2 · elixir 2 · julia 2 · r 1 ·
   clojure 1. **Amendment 1** (a first draw under seed `20260730` discarded for a degenerate
   deficit rule; both draws and the reason committed) is disclosed in `FAIRNESS.md` §7.
   Progress from here — goldens, staging, ledger — is tracked in
   `HELDOUT2_BUILD_LOG.md`. Original recipe, for reference: Octoverse quotas, dev-repo
   exclusion, fresh seed, outcome-blind selection,
   **the task-rejection gate now runs inside the draw** (expect ~25% of the pool rejected, absorbed
   by re-drawing — `resolve_deficits` already handles a per-language shortfall);
   goldens built, vaulted (golden-vault.sh), staged on the box, and a **preflight golden-presence
   check** added (prior run died 14/200 on this); green ledger under the exact run config; one
   run-pilot per box at a time.
5. **Single confirmatory run** on the frozen set — aggregate-only inspection, both arms, then
   forensics from the DB. No lever may be tuned against this set afterwards.

---

## 0. Executive verdict (all three passes agree)

1. **The solve headline (93 v 81, p≈0.012) is NOT interpretable as a tooling comparison and must
   not be published or reasoned from.** 13 of the 16 native-only "wins" were ground-truth-assisted
   before or during editing (6 direct hidden-data + 7 upstream/solution-exposure); only 2 are clean
   (`firebase-2933`, `spectreconsole-1942` — and the latter is env-flavored, so ~1 clean *code*
   win). 2 of sweet's 4 exclusive wins are contaminated too. Under full accounting the discordance
   is ≈2–4 v 2 and **not significant**. The true native-Grok completion rate is unknown. [V]/[R]
2. **The solve deficit, to the extent sweet's own path failed, is post-retrieval, not retrieval.**
   Retrieval-engine-caused losses: **0 of 16**. Sweet surfaced the primary gold file in 14–15 of
   16, at median call 2 (native 3–4), earlier than native in 11 of 14 co-found tasks. Blind
   adjudication: retrieval 0 · post-retrieval capability 12–13 · prompt-induced 0 confirmed ·
   env/grader 2–3. [O]§D1, [R]§2, [V]§3
3. **The cost gap is real and structural: it is a re-send (repeated long-context) tax, ~95% of the
   gap, driven by turn inflation from shell-routing `ss-*` calls** (1.14 calls/turn vs native's
   1.76), amplified but not caused by Grok's $0.30/M cached-input price. Fresh packs are NOT the
   cause (Δ fresh-input ≈ $0.69 on 200 tasks; sweet introduced 139k *fewer* unique context
   tokens). This mechanism is independent of the contamination problem — it rests on arm-internal
   economics. [O]§C, [R]§4, [V]§4
4. **No M±-prompt-induced loss survived scrutiny** (blind readers: "none observed" on every task);
   no retrieval-ranking or sufficiency-trailer change is justified by this run. [R]§2, [V]§3
5. **The environment was porous for both arms** (six escape vectors, §2). `escape=0` in the rows is
   hardcoded, not an audit. This is the publication blocker; hardening + re-run is the only path to
   a defensible solve number. [O]§A2, [V]§2

---

## 1. Benchmark-validity defects (blocking for publication)

### 1.1 Agents escape to the host and read ground truth [O]§A1, corrected/expanded [V]§2
The agent process runs **on the host**; only test execution is containerized. It retained read
access to prior results, goldens, task caches, HF datasets, the Docker socket, and (partial) live
network egress. Canonical example — `pointfreeco__swift-case-paths-90`, native, call #19: grepped a
prior run's logs and recovered the hidden F2P name, its file:line, and the failure semantics
("397853 is not equal to 400000" ⇒ lost-update race ⇒ fix must serialize). Native then wrote the
lock (the gold fix) and "won"; sweet, which never probed, wrote `@unchecked Sendable` and failed.

### 1.2 `escape=0` is vacuous in every CLI harness [O]§A2, confirmed [V]§2
Escape auditing exists only in `api-task-runner.mjs` (`auditEscape`, ~L49–80). All three CLI
runners hardcode it: `opencode-task-runner.mjs:141`, `codex-task-runner.mjs:502` (explicit
`// escape audit TODO`), `claude-code-task-runner.mjs:198`. `escape=0` in this run's rows is **not
evidence of cleanliness**. `shimTampered` detection *is* live and fired correctly (0 hits) — a
different, write-side vector; it does not cover this. The completion frame textually forbade
reading harness/ledger/task data, but the permission model did not enforce it. [R]§1

### 1.3 Tasks whose whole suite is red at baseline [O]§A3
`spectreconsole-1942` F2P=495; `hyperledger__firefly-716` F2P=293; `jupytext-360` 33;
`btcpayserver-6251` 21 with **P2P=0**. **Closed 2026-07-30 by the selection-time task-rejection
gate** (§6 P6): F2P≥100 or P2P==0 is rejected before the draw, so a set built from here on cannot
contain one. On these, "solving" means repairing the build, not fixing
the bug (native "won" spectreconsole by rewriting `net9.0` across every `.csproj`). BTCPay's
F2P=21/P2P=0 is compile-gated: the hidden `TestAccount.cs` helper calls the new
`GeneralSettings(storeId)` signature, so any patch not changing that signature fails the whole
assembly → 21/21. [V]§3

### 1.4 No replication — `rep: 0` only [O]§A4
n = 1 per (task, arm). The 16 attributions are **single samples whose aggregate is significant**,
not 16 independent findings. Any per-task story is one draw from a stochastic policy.

### 1.5 Truncation floors [O]§A5/§B5
63.9% of tool results in the trajectory JSON (9,709 / 15,202) hit the 600-char cap; inputs capped
at 200 chars. Anything detected by scanning that text is a floor, for both arms. ([R] and [V]'s
contamination work bypassed this via the raw DB / manual reads — one reason the original census
was ~2× low.)

### 1.6 Task selection itself is clean — checked, no defect [O]§A6
Gold-patch file mix across all 200: `.ts` 11.7% · `.py` 10.4% · `.java` 9.9% · `.js` 8.9% ·
`.go` 8.6% · `.rs` 6.3% · `.php` 4.0% · `.cs` 3.3% · `.swift` 1.7% · `.kt` 1.6% · `.dart` 0.7%;
config-ish (yaml/yml/json/toml/ini) 5.9%. The suspicious-looking org names are ordinary code repos.
Held-out was also *easier* than the codex dev set (native solve 47.4% vs 39.2%), so task difficulty
does not explain the flip either. [O]§F6

---

## 2. Contamination: six verified escape vectors [V]§2 (the fullest census; [R]§1 matches)

| vector | verified examples (task-arm-call cited against raw trajectories) |
|---|---|
| **V1. Task-spec cache with gold + test patches** (`select/.cache/tasks_full_heldout.json`) | btcpay-6251 native c44–46: extracted `/tmp/gold.patch` **and applied it** (`patch -p1`); jupytext-360 native c28–34: applied gold, verified with the hidden test patch applied, then **reverse-applied the test patch to hide tracks**; pytest-xdist-851 native c52; 1c-syntax-2901 native c87–90 (post-edit) |
| **V2. Golden checkouts** (`/root/.ss-eval/golden/**`, incl. post-fix goldens of *other* commits of the same repo) | redboltz-239 native c47–52: read post-fix `client.hpp`/`endpoint.hpp` from `@f48e140…` and transcribed the new APIs (first edit c78); rohd-458 sweet c17/37/44–45 (diffed drafts against golden, decisive); jupytext native c26–27; pytest-xdist native c28–29 (`diff -u` vs golden `plugin.py`); samchungy-330 sweet c17–18 |
| **V3. Prior-run results / ledger logs** (`results/**`) | ccache-1312 native c30–34: read the **same task's submitted patch from the mimo run**; svgr-10 native c59–65: prior-run log named `removeStyle.js` + "should remove style tags" before its final edits; dart-http-1114 native c25–29; pointfreeco-90 native c14–21 |
| **V4. Live network egress** — only github.com was DNS-blocked; cdn.jsdelivr.net, unpkg, data.jsdelivr, proxy.golang.org worked; api.github.com reachable via `--resolve` IP-pinning | firefly-716 native c42–49: jsDelivr tag-scan found the fix at v1.0.0-rc.5, diffed pre-edit; spectator-181 native c96–102: `@master` post-fix source + test; pion-209 native c14: current fixed `receiver_stream.go` 3 calls before "character-for-character gold" edits; k8s-178 native c23–26: **the real PR #178 body and per-file diff** via IP-pin; protofire-224: both arms fetched upstream impl, native additionally the exact fixture files; bfgroup-b2-259 native c30–34: upstream commit-history spoiler naming the exact fix mechanism |
| **V5. Runnable task/grading docker images** (full git history + post-fix trees inside; agent had `DOCKER_HOST`) | pmmmwh-921 native c29–37: `git show b863d17` — **the actual fix commit** — then wrote the file; sap-luigi-3946 native c38–44; spectator native c62–64 (`docker cp` the image tree); pointfreeco native c25–26 |
| **V5b. Container LAYER STORE on the host** (`/var/lib/containerd/**`) — *added 2026-07-29; found by the first jailed canary rollout, not by any of the three forensics passes* | containerd unpacks every image layer as plain files, so removing the docker socket and the docker client removes nothing. mpmath-689 native: `find / -name 'run_tests*'` → snapshot tree → read `swebench_matterhorn/swebench_instance.json`, which carries `patch`, `test_patch`, `FAIL_TO_PASS`, `PASS_TO_PASS`. The rollout printed the gold diff (c61) and edited from it (c60). **No docker command involved.** Implication for the 2026-07 run: this vector was open for all 400 rollouts and is invisible to a socket- or `docker`-keyword scan, so the §2 census is a lower bound by an unknown margin |
| **V6. Harness caches on the host** | sap-luigi-3946 native c47–56: loaded the **HF SWE-rebench-V2 parquet** with the grading venv's pyarrow, extracted the literal gold diff, `git apply`'d it; aiohttp-8038 sweet c30–36: read newer released aiohttp (the shipped fix) from eval venvs + uv cache; vapor-82 sweet c22: copied EdDSA sources from a `/tmp/jwt48` checkout; `/tmp` carried cross-task artifacts (apigee saw btcpay's gold.patch); samchungy-330 + vaskoz-117 sweet read the **current run's own** trajectories/native rows (9 live-run-dir probes, all sweet — an ordering artifact: sweet ran second) |

**Census** (needle-scan over infra-path probes; still a lower bound — excludes V4/V5 which were
verified by reading): [V]§2

| | probed infra | confirmed leak | leak pre-first-edit | **solved with pre-edit leak** |
|---|---|---|---|---|
| native | 63 | 30 | 14 | **7** (btcpay, jupytext, redboltz, ccache, pmmmwh, pointfreeco, dart-http) |
| sweet | 43 | 16 | 7 | **5** (rohd, vaskoz, samchungy, vapor, aiohttp) |

**Headline under increasing strictness** ([V]§2 — note the original claim that voiding *sharpens*
the gap inverts under full accounting):

| voiding rule | native | sweet | discordant | McNemar p |
|---|---|---|---|---|
| as reported | 93 | 81 | 16 v 4 | 0.0118 |
| original (3+4) voiding | 90 | 77 | 14 v 2 | 0.0042 |
| strict pre-edit-leak census (7+5) | 86 | 76 | 14 v 4 | **0.031** |
| + verified V4/V5 ground-truth-assisted wins | — | — | ≈2–4 v 2 | **not significant** |

**Ground-truth-assisted native wins among the 16: 13** (btcpay, jupytext, redboltz, pointfreeco,
pmmmwh, pytest-xdist, sap-luigi, firefly, spectator, svgr, k8s-178, pion, bfgroup; + protofire
partially — both arms network-assisted, native better). [R] arrives at the same 13 as
6 direct-hidden-data + 7 upstream-exposure, reported separately because public-upstream lookup is
a benchmark-policy choice while direct held-out leakage is unambiguously invalid.

**Symmetry note** [V]§2: the environment was equally porous for both arms; native probed infra in
63 rollouts vs sweet's 43 — sweet's ss-* tooling appears to keep it inside the repo somewhat more.
Outcomes then partly reflect *exploitation skill*, which is not the construct the benchmark
measures. Corollary on cost (§4.5): three of sweet's biggest per-task savings are native-only
"failures" where native cheated and sweet didn't — "sweet stopped early and didn't cheat" is the
right moral, not "sweet stopped early and lost".

---

## 3. Harness & measurement defects (fix regardless of re-run) [O]§B

- **B1 — per-turn token usage collected then thrown away.** `opencode-task-runner.mjs` parses
  `step_finish` into `turns[]`, passes to `costsFromTurns()`, then discards it; only four scalar
  cost columns + `idealTurns` reach `rows.json`; raw NDJSON not persisted (`sweet/logs/*` are
  test-runner logs, not agent logs). Costs are recoverable algebraically — from
  `agent-runner-shared.mjs:162` and Grok pricing $2.00 / $0.30 / $6.00:

  ```
  naive = (N·in + O·out)/1e6                          N = Σ fresh input, O = Σ output
  ideal = naive + R·cache/1e6                         R = Σ re-sent prefix
  real  = naive + (R·in − C·(in−cache))/1e6           C = Σ cache-read tokens
  ⇒ R = (ideal − naive)·1e6 / cache
  ⇒ C = (R·in/1e6 − (real − naive))·1e6 / (in − cache)
  ```

  Reconstruction matches to <1e-6 on all 310 c2rest rollouts, but fresh-input vs output remains
  entangled in the single `naive` term — only the raw OpenCode SQLite DB separates them. **Persist
  per-turn `{in, cached, out}` (or the DB) in future runs; start forensics from the DB, not
  trajectory dumps.**
  **FIXED 2026-07-29** — `harness/turn-log.mjs` writes one JSONL per rollout to
  `results/<runId>/turns/<task>-<arm>.jsonl`: a meta line (task, arm, harness, model, price,
  `source`) then one record per turn. All four adapters emit it — opencode from `step_finish`,
  codex from the rollout jsonl (which lives in the per-rollout codex home and used to die with
  the run), api from its own loop, claude-code from per-assistant-message usage. The row carries
  the path as `turnsFile`. JSONL not JSON-array precisely because of B2: a crash costs the last
  turn, not the file. `source` is recorded because the numbers are not equally exact — the
  OpenRouter Anthropic skin zeroes Claude Code's per-message usage, so that route logs ONE
  `source: "aggregate"` record instead of fabricating a turn distribution.
- **B2 — `c1/rows.json` truncated mid-object by the crash.** Repaired by re-parsing +
  re-merging `graded-45.json`; 3 tasks have no row data (`jtablesaw-591`, `weld-junit-27`,
  `open-feature-805`); 196/200 have cost on both arms. Solve counts reconcile exactly. ([R]
  independently reconstructed 400/400 sessions from the DB + rollout log.)
- **B3 — `toolCounts.edit` / `stepsToFirstEdit` unreliable under shell edits.** Backfill at
  `opencode-task-runner.mjs:130` affects 9/196 sweet vs 1/197 native rollouts (the asymmetry is
  itself a shell-routing consequence). All patch-based metrics must use `preds-*.jsonl`.
  **FIXED 2026-07-29** — the `toolCounts.edit = patchFiles` backfill is removed from all three
  CLI adapters (api never had it). `toolCounts.edit` is now strictly "edit-tool calls observed";
  patch-derived metrics read `patchFiles`/`patchHunks` on the row or `preds-*.jsonl`.
  `stepsToFirstEdit` keeps its `?? calls` fallback and remains a tool-call-derived quantity —
  under shell edits it is a ceiling, not a measurement.
- **B4 — `costNaiveUsd` means different things across runners** (opencode
  `costsFromTurns`: fresh-input-only, `naive ≤ ideal`; codex `codex-task-runner.mjs:470`: all
  prompt tokens at full rate, `naive ≫ real`). Naive cross-harness comparison produces nonsense
  (observed: codex appeared to have content $602 against real $144). Cross-harness comparison
  must go through `content = ideal − R·cache/1e6`.
  **FIXED 2026-07-29** — four columns, one definition each, in every adapter:
  `costNaiveUsd` = every input token at the full rate (no cache at all) · `costRealizedUsd` =
  what we paid · `idealCostUsd` = cache-normalized · **`costContentUsd`** = unique context
  charged once + output, i.e. §3 B4's `content`, which is what opencode used to publish under
  the name `costNaiveUsd`. Ordering `content ≤ ideal ≤ realized ≤ naive` is asserted in
  `tests/turn-log.mjs`. `costContentUsd` needs the growing-prefix structure, so an adapter with
  aggregate-only usage reports it as **null**, never a stand-in from another column —
  `stats/task-stats.mjs` pair-filters it rather than defaulting a missing value to $0.
- **B5 — trajectory JSON truncation** (200-char inputs / 600-char results) → chained commands and
  leak scans are undercounted; every scan-derived figure is a floor.
- **B6 — the `run_tests` timeouts were never coherent across the agent and the harness**
  (found 2026-07-30 on the L3 smoke; **FIXED same day**). Symptom first: on `simdjson-2016`
  (cmake build + ctest) the FIRST `run_tests` took **256 s** — the first call of a rollout runs TWO
  full suites in series, the L2 clean baseline plus the agent's current diff — and the requester
  process was already gone when the broker answered, leaving an unconsumed `res-*` file →
  `shimTampered` → policy re-run → the re-run then hit the 30-min wall guard
  (`exitReason: timeout`).
  **Quantification (2026-07-30) — the intended count could not be measured, and the reason
  matters more than the count.** No archive carries per-task suite durations (the env-ledger rows
  have no duration field; the sweep ran 4-wide so `ts` deltas are not per-task; grading reports
  carry no timings), and the broker path only exists post-P0, so prior full runs contain no
  instances of this failure at all. Structural exposure instead: **30% of every candidate
  population has a build-step `test_cmd`** (heldout 59/200 · reserve 33/101 · dev200 57/200,
  mostly rust/java/csharp/kotlin/scala/swift). But the binding constraint turned out not to be
  slow suites at all: **opencode's bash tool defaults to a 120 s timeout**
  (`bashDefaultTimeoutMs ?? 120000` in the shipped bundle) while the harness gives a suite 300 s
  and the requester waited `tSec+90`. The agent side therefore killed `run_tests` on **any** suite
  over two minutes, first call or not — an unconditional inconsistency, not a tail.
  **Fix applied (config-shaped, both halves together, no L2 restructuring):** requester deadline
  `tSec+90` → **`2*tSec+120`** (covers baseline + current + overhead); the opencode adapter exports
  **`OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS`** at deadline+60 s (override
  `SS_AGENT_BASH_TIMEOUT_MS`), so the harness's own budget is the only thing that can time a test
  run out. **Tradeoff:** a first call may now occupy up to ~12 min of the 30-min
  `AGENT_TIMEOUT_MS` rollout guard on a slow suite. **Still open / deferred:** computing the
  baseline off the critical path (before the agent starts, or after answering the first call) —
  deferred until after the confirmatory run because it changes L2's blast radius; and the codex /
  claude-code adapters' own tool timeouts, which were not audited (only opencode was, since that
  is the run backbone). L3's own exposure is closed independently — an undelivered response is no
  longer citable (see the L3 row in §6).
- **Run integrity otherwise clean** [O]§E4: 393 rollouts `model_stopped` 391 / `agent_error` 2;
  0 shim tampering, 0 timeouts, 0 start-retries, all indexes `golden-cache`; 3 zero-hunk patches
  (sweet 1 / native 2), 6 never-ran-tests (all sweet, none in the 16).

---

## 4. Cost: why sweet is more expensive on this backbone

### 4.1 Exact accounting (full 200, raw DB) [R]§4.1

| | Native | Sweet | Δ |
|---|---:|---:|---:|
| solved | 93 | 81 | −12 |
| tool calls | 8,601 | 6,601 | **−2,000 (−23.3%)** |
| model turns | 4,879 | 5,790 | **+911 (+18.7%)** |
| calls / turn | 1.763 | 1.140 | −35.3% |
| avg input context / turn | 46,738 tok | 47,851 tok | +1,113 tok |
| fresh input | $25.647642 | $26.334624 | +$0.686982 |
| cached input | $64.563494 | $79.167744 | **+$14.604250** |
| output + reasoning | $12.271248 | $12.555498 | +$0.284250 |
| **realized** | **$102.482384** | **$118.057866** | **+$15.575482 (+15.2%)** |

Cache-normalization definition [R]: no analyzed turn had cache writes; full input context =
`fresh + cached`; newly introduced context on turn `t` = `max(0, context[t] − context[t−1])`, the
rest is a re-sent prefix. Raw turn sums reconcile exactly with all 400 session totals and
benchmark costs. Causal decomposition: unique/new context **−$0.28** (−1.8%; sweet introduced
139,325 *fewer* unique context tokens) · long-context re-sends **+$14.75 (94.7%)** · output
+$0.28 (1.8%) · cache-miss luck +$0.82 (5.3%). ([O] on the 196-paired base: +$14.86 = content
−$0.05 + re-send +$14.92 + luck +$0.77, re-sent prefix 262M v 215M tok (+22%); identical
structure. `corr(Δcost, Δturns) = 0.951`.)

Decomposition of the re-send delta: ≈$12.2–12.8 from the **911/881 extra turns** at ~46k
context/turn; ≈$1.9 from the **~1.1k wider sweet context per turn** — which is, within noise, the
**M± block itself (1307 tok) re-sent every turn**. The retrieval packs add zero net context: our
search output exactly displaces native's file reads. Marginal cost of one extra turn ≈ $0.014.
[O]§C4, [R]§4.1

### 4.2 Refuted causes
- **Cache pricing** — amplifier, not cause. Hit rates 98.9% v 98.8%; luck ≈ 5% of gap. Repricing
  the same token trajectories at Luna rates ($1/$0.10/$6) leaves sweet **+$5.496, still
  positive**. Grok's $0.30/M cached makes the loop ~3× as painful but cannot reverse its sign.
  [O]§C2, [R]§5
- **Pack size / fresh richness** — Δcontent ≈ $0; unique new input per call is 1,230.7 (sweet) v
  1,231.5 (native). Richer per-call payload is cancelled by 23% fewer calls. [O]§C3, [R]§4.2
- **Task mix / difficulty** — held-out was easier; the mix explains only *where* the tail lands.
  [O]§F6, [R]§5

### 4.3 Root cause: shell routing kills batching [O]§C5 — the confound-free evidence
`ss-*` are binaries on `$PATH`, not registered tools, so every search is `bash("ss-…")`; OpenCode
emits several *structured* calls per assistant step but ~1 bash call per step. Established
**within the native arm alone** (same model, prompt, harness, tasks):

| native rollouts, by structured-tool share | calls/turn |
|---|---|
| ≥70% shell | 1.24 |
| 50–70% shell | 1.50 |
| 30–50% shell | 1.84 |
| <30% shell | **2.26** |

Regression: `calls/turn ≈ 0.48 + 2.32 × structured-share`, R² = 0.42 ([V] reproduction:
0.52 + 2.21×, R² = 0.38). Sweet's line is flat (~1.15–1.22, R² = 0.00) because shell dominates its
mix. **Counterfactual**: 6,468 calls at native's 1.76 calls/turn → 3,675 turns (23% *fewer* than
native) → estimated **−14.2% cost instead of +14.7%**; stable across subsets (both-solved −15.6%,
both-failed −12.0%, the native-only-16 −23.4%). Caveats: we already
batch *inside* the shell string (62.2% of ss calls chain ≥2 commands with `&&` — a floor) and
still burn more turns; and the arms barely overlap in tool mix, so the counterfactual is an
extrapolation, not a measurement.

### 4.4 Heavy tail, not a broad regression [O]§C6, [R]§4.2, [V]§4
Median per-task Δ ≈ +$0.005. **Top 5 adverse tasks = 80% of the net gap; top 10 = 129%**; top 8 =
**107.2% of the whole-run gap** on [R]'s exact accounting (+$16.70; the other 192 offset by
~$1.13). Sweet was **cheaper on 93/196 tasks** (−$25.00 total) and used fewer turns on 73/196;
per-task turn ratio p10 0.53, median 1.13, p90 2.20. Every tail task is a **turn blow-up, not a
pack blow-up** (`bsl-language-server-2901` is the clean control: both arms made exactly 129 calls,
sweet's ctx/turn was *lower*, and it spent $0.222 *less* fresh input — pure serialization). Tail
aggregate split: cached +$14.20 (85%), fresh +$1.33, output +$1.18; cache-normalized: +$0.87
unique context, +$14.27 re-sends, +$1.18 output, +$0.39 luck — behavioral serialization/looping
= 97.7% before cache luck. Unique new input per call: 1,230.7 sweet v 1,231.5 native.

Per-task tail (turns and ctx/turn n→s; Δ$; productivity verdict [R]§4.2, waste mechanism [V]§4):

| task | turns | ctx/turn | Δ$ | what the extra turns bought |
|---|---|---|---|---|
| pennylane-3651 | 17→130 | 32k→80k | +3.27 | fix known by turn 3, edited S6, tested S7; then 120+ calls of repeated tests, network attempts, gold-hunting (6×+4×+4× manual `docker run` loops). Both failed; late work bought F2P 0.0315 v 0. **Waste.** |
| raml-java-parser-614 | 20→83 | 42k→90k | +2.32 | right diagnosis by S7; 22× consecutive `edit` on one file; ~60 calls reconstructing harness behavior before the YAML/JSON distinction at S89–100. Both failed. **Waste-dominant.** |
| simdjson-2016 | 30→84 | 46k→81k | +2.21 | repeated rewrites of `find_next_document_index` (7×+7× edit/write churn), Docker copies, hand reproducers; scored 0 vs native 0.9896; cache misses explain only $0.226. **Waste.** |
| underscore-2757 | 56→124 | 40k→67k | +2.19 | working fix at S12–13, reproduced S16; then 110+ calls on an unrelated TypedArray failure + contamination sightseeing; applied canonical patch S126. Both solved. **Productive outcome, wasteful tail.** |
| firefly-716 | 44→98 | 79k→94k | +1.95 | had the identity/aggregator graph in 17 calls; wrong same-batch design ground through shell/patch loops; native's win was V4-contaminated. **Design loop, not pack cost.** |
| php-scoper-1027 | 23→86 | 26k→58k | +1.62 | correct regex edit at S12; S13–85 diagnosed six unrelated pre-existing failures + test modify/revert. Both 0. **Post-fix waste.** |
| bsl-language-server-2901 | 77→130 | 113k→**109k** | +1.62 | targeted tests green ~S64; then Gradle/Lombok/network spiral (17× `JAVA_HOME` export retries). Both failed. **Serialization control case.** |
| stingray-324 | 33→98 | 26k→50k | +1.52 | found `baseline_als` immediately + exact upstream few-bin guard by S35; ~60 more calls of config/Docker/harness inspection + revert/reapply. Both solved. **Post-fix tail waste.** |

Waste taxonomy [V]§4 — the extra sweet turns live in the **completion/verification phase, not
retrieval** (first ~40 calls are ss-heavy and work; then drift to generic bash grinding):
(a) manual docker test-reconstruction loops in defiance of the run_tests authority banner,
(b) same-file edit-thrash, (c) toolchain fights, (d) results-dir sightseeing. On 5 of the 8 tail
tasks both arms failed ([O] said 6 of 8; [V] corrected — underscore & stingray are both-solved,
firefly is native-only).

The **re-test half** of this tail — the agent re-running `run_tests` on an unchanged source diff
and being handed the whole transcript again — now has a MECHANICAL lever: **L3** in §6
(harness-side, both arms, no prompt change; distinct from the struck prompt-side P2). (b) and (c)
remain *described*, not levered.

### 4.5 The mirror image [O]§C7, reframed [V]§4
3 of the tasks where sweet was cheapest (hotmeteor −$2.12, redboltz −$2.01, sap-luigi −$1.01) are
native-only "failures" — all three native wins contaminated. Sweet's effort allocation is
higher-variance than native's (SD(log turn ratio) 0.55 v 0.44 on codex at the same geometric-mean
ratio): savings and blow-ups are two tails of the same stop/persist policy.

### 4.6 Cross-harness: why codex/GPT-5.5 flipped the sign [O]§C8
Re-send spend ≈ turns × mean context; the turn penalty is ~identical on both harnesses (1.14 v
1.18 ratio); **the flip is ctx/turn**:

| run | Δreal | turns ratio | ctx/turn ratio | content ratio |
|---|---|---|---|---|
| OpenCode / Grok-4.5 (held-out) | +14.7% | 1.183 | **1.03** | 1.00 |
| codex / GPT-5.5 (dev-200) | −12.6% | 1.140 | **0.80** | 0.88 |

Why compression vanishes on Grok — per-task tool intensity:

| | ss | bash | test | read | grep | edit |
|---|---|---|---|---|---|---|
| OpenCode/Grok sweet | 12.9 | **9.2** | 3.4 | 1.0 | 1.8 | **4.8** |
| OpenCode/Grok native | 0 | **14.4** | 3.9 | 10.8 | 8.7 | 5.2 |
| codex/GPT sweet | 14.7 | **3.1** | 3.0 | 0.4 | 0.1 | **1.6** |
| codex/GPT native | 0 | **5.4** | 3.1 | 10.0 | 3.9 | 1.8 |

Grok runs 2–3× the shell calls and ~3× the edits **in both arms**; its transcript is
build/test/compiler output, identical in both arms, swamping the retrieval difference. On codex
the transcript is retrieval-dominated (native does 10.0 whole-file reads/task) so compact packs
cut context 20% and get paid.
**Backbone verdict: (c) OpenCode transport, enabled by (b) Grok's shell-heavy style; not (a) cache
pricing; not (d) task mix.** Confound disclosure: this comparison varies model, harness, task set
and M± version at once; the confound-free mechanism evidence is §4.3.

---

## 5. Solve-side findings

### 5.1 Retrieval was better, not worse [O]§D1, [V]§1
Primary gold code file, deliberate retrieval calls only: sweet surfaced it **14/16** (15/16 under
[V]'s primary-pick), median call **2** v native 3–4, by-call-3 in 10/16, **earlier in 11 of 14**
co-found tasks. On the very tasks sweet lost, its retrieval was faster.

### 5.2 Hunk coverage — real, but the native side is not a capability baseline [O]§D2, [V]§3
Final patches (`preds-*.jsonl`, so shell-edits count) vs gold hunk regions ±25 lines: sweet
56/135 (41%) v native 112/135 (83%) ([V] reproduction: 56/146 v 118/146 — same numerators, filter
diff). **83% is substantially what copying gold looks like** — 13/16 native wins were assisted —
so the gap is inflated and unpublishable as a comparison. The sweet-side per-task rows remain
diagnostic [O]§D2 (found@ = call at which the primary gold code file was first surfaced):

| task | gold files | sweet found @ | native @ | sweet hunks | native hunks | reading |
|---|---|---|---|---|---|---|
| bfgroup__b2-259 | 1 | 15 | 22 | 0/3 | 3/3 | missed region — fixed a different layer |
| btcpayserver-6251 | 6 | 2 | 5 | 2/14 | 12/14 | breadth (F2P=21, **P2P=0**) |
| firebase-tools-2933 | 1 | 2 | 7 | 2/2 | 2/2 | **content** — near-miss, f2pFrac 0.67 |
| hotmeteor__spectator-181 | 1 | 1 | 6 | 4/4 | 4/4 | **content** |
| hyperledger__firefly-716 | 9 | 17 | 3 | 3/21 | 19/21 | breadth + **F2P=293** |
| kubernetes-sigs-178 | 7 | never | 10 | 1/9 | 9/9 | breadth/design (downgraded from retrieval, §5.3) |
| mwouts__jupytext-360 | 4 | 1 | 2 | 5/11 | 11/11 | breadth (F2P=33) |
| pion__interceptor-209 | 1 | 1 | 2 | 2/2 | 2/2 | **content** |
| pmmmwh-921 | 1 | 5 | 15 | 1/3 | 3/3 | breadth |
| pointfreeco-90 | 2 | 1 | 3 | 2/5 | 4/5 | breadth |
| protofire__solhint-224 | 5 | 2 | 3 | 2/8 | **2/8** | **content** (coverage equal) |
| pytest-xdist-851 | 1 | 3 | 3 | 3/3 | 3/3 | **content** |
| redboltz__mqtt_cpp-239 | 2 | 3 | 2 | **27/31** | 22/31 | **content** (sweet out-covered native and still failed) |
| sap__luigi-3946 | 7 | 16 | **81** | 1/10 | 10/10 | breadth |
| smooth-code__svgr-10 | 6 | never | never | 0/8 | 5/8 | missed region (both arms; target file doesn't exist pre-patch) |
| spectreconsole-1942 | 1 | 1 | 3 | 1/1 | 1/1 | **content** + **F2P=495** |

([V] nit: the primary-file bookkeeping for k8s-178 / sap-luigi / svgr depends on which gold file
is the anchor; under either choice the substantive story is unchanged.)

### 5.3 Sweet-side mechanism buckets on the 16 [O]§D3, adjudicated [R]§2 + [V]§3

Two legitimate lenses on the same evidence [R]:

| lens | retrieval | post-retrieval | prompt | task-quirk-or-env | grader-marginal |
|---|---|---|---|---|---|
| **strict causal** (counts control validity) | 0 | 6 (b2, hotmeteor, firefly, pion, pmmmwh, redboltz) | 0 | 9 | 1 (firebase) |
| **sweet-side mechanics** (ignores whether native was clean) | 0 | 12–13 | 0 | 2–3 | 1 |

The strict lens answers "is this discordant pair evidence?"; the mechanics lens answers "where did
sweet's own path go wrong?". Both agree on the zeroes. Mechanism buckets (mutually exclusive,
sums to 16):

- **Wrong edit content, right file+lines (7)**: firebase (`EMAIL_NOT_FOUND` vs `USER_NOT_FOUND`,
  2/3 F2P — the cleanest genuine sweet-caused loss), hotmeteor (hand-rolled assert vs the repo's
  `$this->assertStatus()`; then edited the *test* to match its own message), pion (replaced the
  whole bitmask design at 4.6× gold vs the 6-line modulo fix), pytest-xdist (invented a new ini
  option vs gold's `pytest_configure` gating), protofire (hand-typed fixtures collided with the
  hidden test patch), redboltz (duplicate `clean_session_` instead of writing through base; also
  modified `test_broker.hpp` despite the do-not-modify-tests frame → unmerged conflict, no tests
  ran), spectreconsole (near-gold patch; grader exited 145 for want of SDK 9.0.306).
- **Fix too narrow / breadth-design (7)**: btcpay, firefly (recognized cross-batch was needed,
  implemented in-batch only; omitted `queueDIDRewind` contract), k8s-178 (ss found Makefile c1
  `sufficient=YES` correct; chose a 1-file sort fix vs the unstated api-package split — downgraded
  from [O]'s sole "retrieval-caused" to breadth/design), jupytext (fallback in `check_auto_ext`
  only), pmmmwh (1-line `.call` patch vs ~79-line rewrite; reversed its own correct `this`
  reasoning, then edited the snapshot), pointfreeco (`@unchecked Sendable`, no lock), sap-luigi
  (read "removal" literally, deleted `_tpcCheck()` instead of adding the opt-out flag).
- **Never edited the gold region (2)**: bfgroup (had `property.jam` at S15–16, patched
  `configure.jam`/`build-feature.jam`), svgr (`removeStyle.js` doesn't exist pre-patch — no engine
  could rank it; sweet thrashed 88 calls preserving CSS, incl. phantom `convertStyle.js`
  create/rm ×3).

A cross-cutting pattern [O]§D3: sweet reinvents where native reuses the repo's own idiom
(hotmeteor, firebase, pytest-xdist).

### 5.4 Under-fixing, not over-rewriting [O]§D4/§F4
On the 16, sweet's patches are *smaller* than gold (median 0.85×) while native's match (1.00× —
because it copied): k8s-178 6 lines vs gold 260 (native 266), pmmmwh 2 vs 79 (native 81),
pointfreeco 4 vs 35, btcpay 68 vs 270, jupytext 54 vs 181. Across all 200: median patch/gold
0.91× sweet v 0.84× native; bigger in 74 tasks, smaller in 66 — a coin flip. `pion` (4.6×) is the
outlier that spawned the over-rewrite hypothesis, not the pattern; **under-fixing dominates**.

### 5.5 Multi-file breadth — the generalization, weakly significant [O]§D5
Gold-file coverage across all 200 is at parity for small fixes and drops only on large ones:

| gold-file count | n | coverage sweet vs native | Δ | solve Δ | per-bucket McNemar |
|---|---|---|---|---|---|
| 1 file | 88 | 94% vs 94% | 0.0pp | −6pp | 7v2, p=0.18 |
| 2 files | 41 | 67% vs 66% | +1.2pp | −5pp | 2v0, p=0.50 |
| 3–4 files | 30 | 63% vs 65% | −1.9pp | 0pp | 1v1, p=1.00 |
| **5+ files** | **41** | **46% vs 55%** | **−9.0pp** | **−12pp** | 6v1, p=0.125 |

Paired bootstrap (20k) on the 5+ bucket: **95% CI [−18.9, −0.4], p = 0.077**; overall (n=200)
−1.9pp, p = 0.24 — no population-level coverage deficit. Per-bucket McNemar is underpowered
everywhere; only the pooled 16v4 reaches p=0.0118 — which §2 dissolves. The deficit is diffuse,
not cleanly localised, and the breadth-discipline suspicion **remains open but cannot be measured
on this run** (contaminated yardstick). [V]§3

### 5.6 The 4 sweet-only wins [O]§D6, [R]§3, [V]§3
2 clean: `ant-design-mobile-5706` (sweet fixed the integer-step math; native kept the lossy
division — a genuine native-side content bug, though the P2P flake muddies the discordance) and
`apigee__registry-994` (**the model legitimate win**: S1 was poor, S2–S6 reconstructed the
architecture, correct `ERROR`-severity semantic choice; native churned 126 calls). 2 contaminated:
`intel__rohd-458` (diffed drafts against golden), `vaskoz-117` (fetched gold `day48` via jsDelivr;
also read the live run's native trajectory — and it directly refutes "sufficient=YES locks Grok
onto the first hit": trailer fired on an analogous file and sweet kept going). The 4 wins cost
+44.6% (turns 140→211) — not cheap.

### 5.7 Prompt (M±) and engine: cleared [R]§2, [O]§F, [V]§3
- Sufficiency trailer: only 8 `YES` across all 316 ss calls in the 16 (12 `no`, 18 `unknown`);
  only 13.5% of ss calls carry a trailer at all; repo-wide `YES` correlates with *success*; the
  noisy `YES` on bfgroup didn't stop 54 more calls. **Refuted as a cause.**
- Absence-probe rule: empty-result rate 14.6% in the 16 v 12.9% overall. **Refuted.**
- "We edit with less investigation": pre-first-edit work identical (5.0 reads + 5.0 searches v
  5.3 + 5.0); sweet reaches first edit in 10.7 calls v 17.3 purely by cheaper orientation.
  **Refuted.**
- Narrow reads (66.2% of ss-read range-limited, median 55 lines, vs native 99.9% whole-file):
  real and large, a tidy mechanism for 3 content cases, but does not predict solving (≤50% share
  → 39.7% solve; >50% → 40.3%; p=0.93). **Observation, not cause.**
- Turn counts are real inference steps, not accounting artifacts (ideal $/turn median ≈ $0.014–16).
- Two weak suggestive strands only (fixture re-verification nudge on protofire;
  verification-depth nudge on pointfreeco) — unconfirmed.

### 5.8 Product-usage profile (load-bearing for L1/L2) [O]§E
`ss-read` 55.4% + `ss-grep` 32.6% = **88% of usage is read+grep**; `ss-search` 8.0%, `ss-find`
2.0%, `ss-semantic` 1.8%, `ss-trace` 0.2%. Near-identical on codex/GPT-5.5, so this is how M±
shapes usage, not a Grok artifact. Most of what sweet routes through the shell is work the harness
already offers as batchable native tools.

---

## 6. Action plan — merged, renumbered levers

All levers validate on **dev or genuinely fresh tasks only**; none may be evaluated by re-running
these 200. Ordered by priority.

| # | lever | cause | smallest concrete change | expected effect / rows plausibly affected |
|---|---|---|---|---|
| **P0 — isolation (publication blocker)** | §1, §2 | full isolation, not permission tweaks (3 of 6 vectors survive a chmod-level fix): (1) run rollouts in a container/namespace with **no access** to `results/**`, `/root/.ss-eval/golden/**`, `select/.cache/**`, HF caches, eval venvs, or the sweet-search-private checkout; (2) **egress allowlist** — breaking github.com DNS is not enough (jsDelivr/unpkg/proxy.golang.org/IP-pinned HTTPS all worked); (3) **no docker socket** for the agent (task images carry the fix commit) — `run_tests` via broker only; (4) scrub `/tmp` between rollouts (cross-task gold observed); (5) port `auditEscape` into all 3 CLI runners so `escape:0` stops lying; (6) grader tripwire: flag any submitted patch ≥95%-identical to gold hunks | no effect on valid solves — makes the solve comparison *measurable*. Then **re-run** for a defensible headline. **SHIPPED 2026-07-29**: all six items done plus V5b (container layer store), canary 35/35. Verified end-to-end on: a 5-task python opencode/Grok smoke; a 4-language smoke (java/rust/go/csharp) where masked host build caches broke nothing and agents made ZERO host-toolchain attempts, using run_tests instead; and one rollout each on the codex and claudecode adapters. All three CLI harnesses now run under the jail. Per-task `testTimeoutSec` is needed for .NET/JVM suites — `dotnet test` re-restores and rebuilds per invocation, exhausting a 30-min budget. |
| **L3 — frame-side run_tests anti-loop (shim output dedup)** — **IMPLEMENTED + SMOKE-VERIFIED 2026-07-30** | §4.4 (a) + the re-test half of (d) | MECHANICAL, in the shared `run_tests` shim (`harness/rt-dedup.mjs` + `rt-shim-runtime.mjs`), symmetric across both arms and **not** the struck prompt-side P2 — no M±, frame, or ranking text is touched. Per-rollout state key = sha256(`git diff HEAD` + untracked non-ignored files as sorted path+content hashes + the exact `run_tests` argv). The suite **always executes**; only the response text changes. Repeat call with an identical key AND an identical result (exit code + normalized failure set) → a one-line `[run_tests-dedup]` summary (exit, failure count, first failure, "change the code before re-running, or pass `--ss-full`"). Result CHANGED under an identical key → full output + a flakiness note. First/changed-key call → byte-identical to the pre-lever shim. Degrades to full output on any doubt: unhashable untracked set, infra-error result, unwritable state log, or a cited result the requester never received (`undelivered` marker). **Semantics: `--ss-full`** bypasses condensation for one call (stripped from argv before the runner, excluded from the key, per-call not sticky); **`SS_RUNTESTS_DEDUP=0`** disables the mechanism; every row is stamped `rtDedup` beside `isolated`. State + hand-audit trail = `results/<RUN_ID>/rt-dedup/<task>-<arm>.jsonl`, written only by the host-side broker (results/** is masked by the P0 jail), reset per rollout by a `session` record. Grading (swebench `run_evaluation` / `sr-eval.py`) and the env-ledger gold-FULL runs do not go through this shim — verified. Covered by `tests/rt-dedup.mjs` (91 assertions, offline) and gated by `stats/rt-dedup-audit.mjs` | **Evidence** — 5-task sweet-arm smoke `l3-dedup-smoke-20260730` (Grok-4.5/OpenCode, P0 jail on, retired held-out loopers, mechanism-only): **84 `run_tests` calls → 18 suppressed, 4 changed-under-identical-key, 0 FALSE POSITIVES** (every suppression re-checked against its cited call: diff, untracked set, argv, digest all identical), marker observed in 4/5 trajectories, all 5 rollouts completed and graded with `turnsFile` non-null. Two caveats: the agent answered its first suppression with `--ss-full` in 4/5 rollouts (14 of 84 calls), so realized saving ≪ firing count; and argv variation on an unchanged diff (php-scoper: identical diff across all 15 calls, 13 with differing argv) is correctly *not* suppressed, so the lever catches bare repeats only. **No solve/cost claim** — burned tasks, n=1, jailed env. **K1 decision 2026-07-30: the `--ss-full` hint is REMOVED from the summary** (the flag still works, undocumented, and stays on the integrity file list) — advertising it made the agent spend 20 of 84 smoke calls re-requesting a transcript it already had; nothing is lost, because a summary is only ever emitted when that exact output is already in the conversation, and the legitimate route to more detail is a targeted run (different argv → different key → full output). **No A/B was run, deliberately** (decided 2026-07-30): a 78-rollout paired study is disproportionate for a harness output-formatting change whose safety is already verified, whose information-preservation follows from construction, and which is symmetric across arms so it cannot bias the sweet-vs-native comparison. **Cost effect: bounded, not separately measured** (~$0.10 avoided on a $6.19 smoke; the one plausible offset, the `--ss-full` tax, is what K1 removed). The confirmatory run reports it in passing |
| **P9 — turn economy (M± instruction block)** — **DRAFTED, PENDING VALIDATION 2026-07-30** | §4.2, §4.3, §5.8 | **Reopens the "no prompt edits" position by explicit user instruction on 2026-07-30.** Distinct mechanism from the struck P1/P2: it changes *when* already-planned probes are issued (grouping), not what is retrieved (P2) or how it is transported (P1). A ≤100-token block appended to M± telling the agent to carry every independent call it already intends in ONE message, capped at ~three, with dependent shell steps chained by `&&` in a single bash call. Full note: `TURN-ECONOMY-2026-07-30.md`. **Frozen prompts are untouched** — the variants live in `core/prompt-optimization/data/p7-turn-economy/` and are selected at run time by `MPP=` (`run-pilot.mjs:68`) with `ARMS=sweet` (`:69`, a knob that already exists for prompt-variant smokes); no harness change needed. Block: **69 tok** (CLI, 1307→1377) / **48 tok** (MCP, 1336→1385) after an external-review revision on 2026-07-30 that cut three defects from the first draft: a sentence calling single-probe turns wasted (it fought M±'s own "ONE `ss-grep` … trust the top hit and stop" rule), a worked example whose two probes were actually independent (it serialized what the block says to batch), and an "EVERY … about three" pair that was not a limit. The review's recommendation to drop `&&` guidance was NOT adopted: `&&`-in-one-call is 1 call/1 turn where two parallel calls are 2 calls/1 turn, and `&&` is already 67.8% of `ss-*` calls, so dropping it would raise call count for no turn gain and trip our own revert gate. **The edit+test-in-one-message clause from the original draft was CUT** — see the ordering verdict below | **Evidence — Phase 1 (SOTA)**: W&D (Salesforce, arXiv:2602.07359) is a direct ablation of this mechanism: on BrowseComp/GPT-5-Medium, 3 tool calls per turn vs 1 gives 45.7→23.8 turns, **cost −35.9%**, accuracy 66→68% (no degradation). Width has a low optimum — 5 and 8 calls/turn score *worse* (64, 63), which is the quantified anti-shotgun bound. Explore-then-exploit (wide early, narrow late) is the best schedule tested (74%); letting the model pick its own width underperformed it (72%). **Four recorded caveats**: (a) W&D's *effective* delivery channel was a per-turn user message; they tested a system-message placement and found it inferior — our block ships via the persistent `AGENTS.md` memory file, so expect an attenuated effect; (b) their cost win came *with more total calls* (71.4 vs 45.7) — they traded calls for turns, whereas our guardrail forbids that trade, so we are validating a strictly narrower claim the paper does not isolate; (c) their accuracy gain came from web-retrieval properties (source cross-checking, unreliable-tool detection) that do not transfer to a local code index — treat it as unclaimed; (d) Grok is in no published ablation. **Phase 2 (free verifications, both read-only)**: **ORDERING — OpenCode 1.18.4 does NOT serialize tool calls within one assistant message.** Source: the streaming `case"tool-call"` handler fires `executeTool` **un-awaited** per streamed call, tracking pending work in a set with no completion barrier. Run DB: among the 30 multi-call messages containing a ≥1 s non-final call, **23 had a later call start before the earlier finished** (e.g. `grep` at 710 ms inside a `run_tests` spanning 0→180,121 ms); separately, a later-declared call started first in **445 of 2,996** multi-call messages. Hence dependent steps are safe only as `&&` inside one bash call. **PLUMBING** — `MPP` + `ARMS` env override, documented above; one gap: `rows.json` carries no prompt provenance, so the variant is identified by `RUN_ID` + recorded sha256. **Phase 4 — NOT LAUNCHED, awaiting explicit go**: paired dev A/B, 36 gold-valid dev-200 tasks (seed 20260730, stratified by language, never held-out), sweet arm both sides, ≈$42 (range $32–58). Gates: solve rate = hard revert tripwire (underpowered at n=36 — a tripwire, not a parity test), calls/task and ctx/turn flat, turns/task ≥10% drop to win. **Pre-check BLOCKER: 0/168 dev goldens are staged on the box** (it holds the retired held-out 200); a vault push is required first. **Revised expectation**: the ordering verdict puts the 292 edit→`run_tests` pairs out of reach (an edit tool call and a bash `run_tests` can neither be `&&`-chained nor safely co-issued), removing ~37% of the 797 greedy-collapsible turns, so the ≈$11.4 figure is an overestimate of what this block reaches; the broader target is the calls/turn gap itself (1.14 v 1.76; 85.7% single-call turns v 52%). No revised dollar figure until the pilot measures one |
| ~~**P1 — cost: MCP/structured `ss-*`**~~ **STRUCK 2026-07-29** | §4.3 | **not doing it.** The product's contact surface is `ss-*` binaries on `$PATH`; benchmarks measure the shipped product, so all arms stay shell-only. The MCP variant is not benchmarked | the −14.2% counterfactual stays an unrealised extrapolation and is not a plan target |
| ~~**P1b — plain reads via the harness reader**~~ **STRUCK** | §5.8 | M± edit; M± is tuned and not being reopened | — |
| ~~**P2 — anti-thrash completion guidance**~~ **STRUCK 2026-07-29** | §4.4 | **not doing it.** Anti-thrash guidance has been disproven repeatedly; M± is already tuned for retrieval without thrash. The §4.4 tail stays a *described* waste taxonomy — except for the re-test loop, which is addressed MECHANICALLY by **L3** above (shim output dedup). L3 is not a revival of P2: it is harness output shaping, contains no guidance text, and cannot steer retrieval | — |
| ~~**P3 — completion checkpoint**~~ **STRUCK** | §5.3 content bucket | M± edit — see P1b; also the sibling tests-first variant was already rejected twice | — |
| ~~**P4 — breadth-of-fix trigger**~~ **STRUCK** | §5.3 breadth bucket, §5.5 | M± edit — see P1b. §5.5 itself says the deficit is diffuse and unmeasurable on a contaminated yardstick | — |
| **P5 — grader isolation for test paths** — **IMPLEMENTED 2026-07-30** | protofire, redboltz conflicts | **Narrow, collision-based, not a test-glob sweep.** `harness/patch-strip.mjs`, called from `gradeArm` (`evaluator-runtime.mjs`) — i.e. the SHARED grading path, so both arms are treated identically. Before eval.py applies the hidden `test_patch`, every `diff --git` block of the agent's `model_patch` that touches a path the hidden patch modifies/creates/deletes/renames is dropped; the rest is graded normally. The split is byte-lossless, so a non-colliding patch passes through unchanged, and a patch emptied by stripping falls through to the ordinary zero-hunk case (no special case). Path extraction reads `---`/`+++`/`rename from`/`rename to` and stops at the first `@@` (hunk text cannot inject a path), with a `diff --git`-line fallback for header-less blocks. Transparency: `gradeArm` returns `stripped_paths`, run-pilot stamps every row with `strippedTestPaths` (empty list normally) and logs a warning per firing. `SS_GRADE_STRIP_COLLISIONS=0` restores verbatim passthrough for bit-exact re-grading of frozen evidence; the broader **test-glob** mode exists behind `SS_GRADE_STRIP_TEST_GLOBS=1`, **default OFF**. Covered by `tests/patch-strip.mjs` (41 assertions, offline, stub evaluator; includes both-arms symmetry and the narrowness case). Note `harness/task-overrides.json` is unchanged — it stays the after-the-fact per-task repair mechanism | **Evidence — live re-grade of the two damaged tasks** (retired run's SAVED sweet-arm preds, re-graded into `/root/regrade-scratch` on the box; the original results were read-only and are byte-unchanged). **Control (`SS_GRADE_STRIP_COLLISIONS=0`) reproduces the defect exactly**: redboltz-239 → `Applied patch to 'test/test_broker.hpp' with conflicts` → `U test/test_broker.hpp`, log ends there (24 lines, `set -e`, zero tests run); protofire-224 → `U test/fixtures/order/ordering-correct.js` (46 lines). Both `f2pFrac=0.000`. **With stripping ON**: 1 path stripped for redboltz (`test/test_broker.hpp`), 2 for protofire (`test/fixtures/order/ordering-{correct,incorrect}.js`); **zero `with conflicts`, zero unmerged paths, and the suites actually execute** — logs grow 24→243 and 46→362 lines. Resulting `f2pFrac=1.000 / status=FULL` on both, reported as a **sanity signal only: NO solve claim** — these two tasks are retired and burned, n=1, and the re-graded patches come from the contaminated run. **Why collision and not a glob** (measured over heldout-200 + multilingual-200 + heldout-reserve-101 = 501 tasks): GOLD patches touching ≥1 test-glob path = 8/501 (1.6%; 4/200 heldout), so a blanket test-glob strip would discard part of the LEGITIMATE fix surface on ~1 task in 60 — that is the number that says a broad mode is not safe as a default. GOLD patches sharing ANY path with the hidden test patch = **0/501**, so the collision rule cannot discard a load-bearing fix on any task in these populations. Non-test collision paths are stripped too (hidden test patches do touch real source files — e.g. `Sources/MapboxDirections/RouteStep.swift`; 21/480 heldout test-patch files are not test-glob-shaped): whatever the hidden patch writes is the authoritative graded state of that file, so stripping makes the outcome deterministic instead of merge-order-dependent |
| **P6 — task preflight gates** — **IMPLEMENTED 2026-07-30** | §1.3 | **Selection-time rejection, metadata-only and outcome-blind** (task structure, never a run result — so it is pre-registration compatible). Reject when `FAIL_TO_PASS ≥ 100` **or** `PASS_TO_PASS == 0`. Thresholds + their motivating cases live in ONE file, `select/task-gates.json`, read by both the Python selection path (`select/task_gates.py`) and the JS preflight (`harness/task-gates.mjs`). Rejection happens **before the seeded draw** in `select_tasks.py` / `select_heldout.py` (primary AND reserve, since a reserve can be promoted), so a set built from here on cannot contain a violator; every rejection is logged with id + reason + counts, counted in the manifest, and written to a sidecar `REJECTED_<set>.json` next to the manifest. `materialize_tasks.py` is an audit checkpoint over an already-frozen id list: report + sidecar by default (frozen sets must stay materializable for re-grading), `--enforce-gate` to drop, `--gate-only` to audit without writing. Defense in depth: run-pilot's `loadTasks` **WARNs, never refuses** (old sets predate the gate) and degrades to one warning if the config is unreadable. `select_heldout.py`'s frozen-set identity check now says explicitly that a set predating the gate must be rebuilt, not re-verified. The hand-curated `excludeF2P`/`excludeP2P` map in `harness/task-overrides.json` is untouched and keeps its separate role: after-the-fact repair of a task already in a set, not a gate. Covered by `tests/task-gates.mjs` (28 assertions) + `python3 select/task_gates.py --self-test` (16), including a cross-language assertion that both sides load identical thresholds | **Evidence — dry run over the retired held-out metadata** (`materialize_tasks.py --set heldout --gate-only`; report-only, the retired manifests were NOT modified): **53/200 would have been rejected** — 25 on `FAIL_TO_PASS≥100`, 40 on `PASS_TO_PASS==0` (12 on both). All three expected cases are caught: `spectreconsole__spectre.console-1942` (F2P=495), `hyperledger__firefly-716` (F2P=293), `btcpayserver__btcpayserver-6251` (F2P=21, P2P=0). `mwouts__jupytext-360` (F2P=33) is correctly **not** caught — it sits below the threshold, which is deliberately set where whole-suite failure is unambiguous rather than where it first smells. Same gate on the other populations: 67/200 multilingual, 20/101 heldout-reserve. **Recorded caveat on the `P2P==0` half**: it is stricter than the btcpay case alone requires (~20% of candidates, some with F2P=1 where the empty PASS_TO_PASS looks like a dataset recording artifact rather than a red suite). Kept because a task with no verified-passing baseline test gives the grader no regression signal, and because rejection is cheap — the gate runs against a ~19k-task pool, so a rejected candidate is simply replaced by the next draw of the same seeded shuffle. It costs pool size, never set size |
| **P7 — measurement hygiene** | §3 | persist per-turn `{in,cached,out}` (or archive the OpenCode DB) per run; fix/unify `costNaiveUsd` semantics; stop backfilling `toolCounts.edit`; future forensics start from the DB | makes the next forensics pass exact instead of algebraic. **SHIPPED 2026-07-29** (B1+B3+B4, `harness/turn-log.mjs` + `tests/turn-log.mjs`, all four adapters). The first half landed as a side-effect of P0: each rollout gets a PRIVATE agent session store at `results/<runId>/agent-state/<task>-<arm>/`, required anyway because the shared 1.8 GB `~/.local/share/opencode` store is itself escape vector V6 (rollouts read the current run's other-arm trajectories out of it). The second half is `results/<runId>/turns/<task>-<arm>.jsonl` — the per-turn split, which is what the DB was only a proxy for. Next forensics reads the turn logs first and the DB only to adjudicate. **Verified on synthetic streams, not yet on a real rollout** — confirm `turnsFile` is non-null on both arms of the next smoke before trusting a run's cost columns. |
| ~~**P8 — prompt size**~~ **STRUCK** | §4.1 | M± edit for ≈$1.9 of a $15.6 gap — not worth reopening a tuned prompt | — |
| **Honest boundary (not fixable)** | §4.6 | retrieval compression only pays when retrieval dominates context; on Grok's build-log-heavy transcripts it is ~3%. Write it down rather than engineer around it | — |
| **Do NOT change** | §5.7 | no retrieval-ranking, sufficiency-trailer, or absence-probe changes — retrieval surfaced targets 14–15/16, earlier than native 11/14; trailers rare and `YES` correlated with correct locations; zero retrieval-caused and zero prompt-induced losses | — |

**Publication guidance** [V]§5: the cost/turn mechanics are usable with caveats (disclose
contamination; the mechanism rests on arm-internal economics). The solve comparison is not usable;
the clean-control subset is too small to power a solve claim. The right move is a re-run after P0.
An engine change cannot repair a model that retrieves the right code, states the right invariant,
and then implements a different design — the content-bucket cases need completion-behavior
improvement demonstrated on fresh tasks. [R]§6

---

## 7. Limitations (union of all three passes)

- n = 1 per (task, arm); per-task labels are forensic judgments, not replicated effects.
- Leak counts are lower bounds even after the [V] census (V4/V5 verified by reading, not scanned).
- Hunk overlap uses ±25-line slack and measures similarity to gold, not correctness (redboltz:
  sweet out-covered native and still failed).
- The Grok/Luna cross-harness comparison is observational — model, harness, task set, and prompt
  version all vary; no same-task-set control exists (mimo held-out runs carry no per-turn
  accounting).
- Public-upstream lookup vs direct hidden-data leakage are both solution exposure but only the
  latter is unambiguously disallowed; both are disclosed and both matter for the 13/16 figure.
- The structured-tool counterfactual (−14.2%) is an extrapolation until P1 is actually run.
- [O]'s pass worked from truncated JSON and dispatched six per-task reader subagents that were
  stopped at ~45 min; its §D narratives are single-reader. [V]'s 20 blind sonnet readers +
  adjudication supersede where they differ.

## 8. Provenance & reproduction

- **[O] scripts**: `costdecomp.mjs`, `full.mjs`, `batch.mjs`, `pooled.mjs`, `xh2.mjs`,
  `bothsolved.mjs`, `leakscan.mjs`, `leakscan2.mjs`, `retrieval.mjs`, `retrieval2.mjs`, `hunk.mjs`,
  `multifile.mjs`, `preedit.mjs`, `triage16.mjs`, `trailer.mjs`, `factsheet.mjs`, `escape.mjs`,
  `escape2.mjs`.
- **[V] scripts** (written from scratch, prior scripts not consulted until numbers matched):
  `verify1.mjs`, `verify3.mjs`, `verify4-leaks.mjs`, `verify6-costtl.mjs`, `render-digests.mjs`,
  reader prompts + 20 blind verdicts — session scratchpad `929be800…/scratchpad/`.
- **Inputs**: both run directories, `preds-*.jsonl`, `select/.cache/tasks_full_heldout.json`,
  `/root/.local/share/opencode/opencode.db` (read-only), codex `full200-rebaseline-shard*` rows
  for the cross-harness comparison. Data byte-verified identical across passes (aggregate md5).
- **Detail retained only in the sources**: the per-task call-by-call evidence narratives
  (`S#`/`N#` citations — e.g. "`S1` ranked `operations.ts:479-584` #1", "native `N44` opened the
  task cache") live in [R]§2–3 and [V]§3; this plan preserves every verdict and load-bearing
  number but not the call-level walkthroughs. Consult those tables before re-litigating any
  single task.

## 9. Discrepancy ledger (kept so the merge hides nothing)

| item | [O] | [R] | [V] | resolution |
|---|---|---|---|---|
| cost base | 196 paired, +$14.86 (+14.7%) | 200 full, +$15.575 (+15.2%) | reproduced both | same quantity, two bases; cite [R] for headline |
| fresh vs output split | not separable (algebra) | exact (+$0.687 / +$0.284) | flagged as impossible from JSON | [R] authoritative |
| tail both-failed count | "6 of 8" | per-task (consistent w/ 5) | **5 of 8** | 5 of 8 |
| contamination census | 3 + 4 pre-edit-leak solves (1 of 6 vectors) | 6 direct + 7 upstream = 13 assisted | 7 + 5 census; 13/16 assisted | 13/16; census a lower bound |
| voiding effect | "sharpens" (p→0.0042) | dissolves | dissolves (p→0.031→n.s.) | **dissolves** |
| network egress | "blocked" (original text) | not blocked | not blocked (verified live) | only github.com DNS blocked |
| k8s-178 | retrieval-caused (tentative) | task-quirk / breadth | downgraded: breadth/design | **retrieval-caused = 0** |
| retrieval surfaced | 14/16, median 2 v 3 | — | 15/16, median 2 v 4 | anchor-file bookkeeping; story unchanged |
| hunk denominator | /135 | — | /146 (filter diff) | same numerators; report both |
| native-arm calls/turn regression | 0.48+2.32×, R²=.42 | — | 0.52+2.21×, R²=.38 (incl. c1) | trivial sample diff |
