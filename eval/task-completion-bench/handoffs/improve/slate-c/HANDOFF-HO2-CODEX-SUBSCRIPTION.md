# HANDOFF — run the frozen held-out 2, codex leg only, 1 rep, on the owner's ChatGPT subscription

**Written 2026-09-09.** Everything below is prepared and verified. Nothing has been launched.
**Your job is one command plus the reading discipline in §5.**

---

## 0. What to run

```bash
ssh root@167.233.69.121 'setsid nohup bash /root/ho2-codex-sub.sh \
  > /root/ho2-codex-sub.out 2>&1 < /dev/null &'
```

**200 tasks x 1 rep x 2 arms (sweet, native) = 400 rollouts, codex harness only.**
Expect roughly 4-6 hours. **Model cost: $0** — it runs on the owner's ChatGPT login, not OpenRouter.

Do not launch anything else without the owner saying so. Preparation is not permission to spend.

---

## 1. Why this is free, and the one thing that makes it work

`CODEX_SUBSCRIPTION=1` makes `harness/codex-task-runner.mjs` drop the
`-c model_provider="openrouter"` override and strip the `openai/` prefix from the model id, so
codex uses its **built-in ChatGPT backend** authenticated by `/root/.codex/auth.json`
(`codex-task-runner.mjs:419-421, 601`).

The owner logged in on the box on **2026-09-08 22:41Z**. `auth.json` carries `auth_mode`,
`id_token`, `access_token`, `refresh_token`, `account_id`. It is **not** an API key
(`OPENAI_API_KEY: false`).

**The known trap, and the reason the script snapshots the token.** The runner never writes a
refreshed token back, so if the session expires mid-run the leg does not error — it quietly
degrades and looks like a dead treatment. `ho2-codex-sub.sh` copies `auth.json` to
`auth.json.pre-<RUN_ID>` before starting and checks the file still exists afterwards. **If it
warns that the token vanished, every rollout after the expiry is suspect — do not publish that
leg.** Check `codex --version` still reports `0.146.1` too.

---

## 2. What is already done — do not redo any of it

| | state |
|---|---|
| goldens | **200/200 rebuilt**, every index post-2026-08-28, each stamped in `~/.ss-eval/golden/.provenance-index/` |
| green ledger | `/root/env-ledger/luna-ho2-fp5/ledger.jsonl`, **200/200 gold-valid** under fingerprint v5 |
| preflight | `PREFLIGHT_ONLY=1` returned **`200/200 selected tasks gold-FULL under current config`** |
| task list | `/root/ho2-admitted200.txt` (200 ids) and merged spec `/root/ho2-200-specs.json` |
| harness pins | codex **0.146.1**, opencode 1.18.4, claude-code 2.1.218 — **unchanged, do not update** |
| host escape | isolation canary **35/35**; the July contamination finding is closed |

**Never update codex.** A pin change is a shared change and nothing may be pooled across it. The
frozen set, the 27-task rebaseline, the smoke and the fresh pool all ran on 0.146.1.

---

## 3. How the denominator became 200 — cite this in any publication

Started at 200 declared. **14 tasks were replaced** under `HELDOUT2_RULES.md` §7, logged in
`select/HELDOUT2_REPLACEMENTS_ROUND2.json`:

- **11 under §7(b)** — the suite would not reach gold-FULL under the exact run config *after*
  `prep-warm` was attempted. 4 same-language, 7 cross-language fallback.
- **3 under the new §7(d)** — vacuity. See below.

**`HELDOUT2_RULES.md` gained Amendment 2 (2026-09-08).** §7 previously allowed replacement only
for (a) golden won't build, (b) won't reach gold-FULL, (c) repo vanished. A **vacuous** task —
one that grades RESOLVED for an empty patch — builds fine and grades gold-FULL but cannot fail,
so it measures nothing. The amendment adds (d) and argues it sits inside §7's own stated test
("a mechanical, arm-neutral reason", nothing "derived from inspecting a diff or an issue"):
vacuity is found by a static marker scan plus a null arm, and an empty patch passes for both arms
equally. Written **before any rollout existed**, with no result observed. **It raises the
denominator from 197 to 200 and must be cited.**

**Four tasks are now permanently blocklisted as vacuous**, each with null-arm evidence
(0 tool calls, 0 patch hunks, graded RESOLVED): `symfony__flex-685`,
`pheature-flags__pheature-flags-196`, `opensearch-project__opensearch-php-316`,
`knuckleswtf__scribe-886`.

**Finding worth carrying forward: the PHP reserve is contaminated.** Two of three PHP reserve
promotions were vacuous. PHPUnit and Pest print timings as `[0.54 ms]`, so any PHP
`FAIL_TO_PASS` list harvested from a green run carries the runner's success marker — the same
defect that produced `jsonmapper-161`. **Null-arm any future PHP reserve draw before admitting it.**
PHP reserve is now exhausted; 10 reserve tasks remain (rust x5, swift, dart, clojure, r, go).

---

## 4. Two limits of this specific run — state them, do not hide them

1. **REPS=1.** The pre-registration wanted 3 reps for variance power. One rep gives a point
   estimate with no within-task variance, on a benchmark where a single codex cell has been
   observed swinging 3/3 → 1/3 → 2/3 across identical runs. Treat any solve delta as
   provisional.
2. **codex only.** One of three harnesses. The frozen set's pre-registered read is per-harness,
   so this is one third of the intended evidence.
3. **The dollar columns are notional.** `costRealizedUsd` etc. are priced at the OpenRouter luna
   rate, but nothing was billed. Do not publish these as costs; they are useful only as a
   *relative* sweet-vs-native comparison within this leg.

---

## 5. How to read the result

**Aggregate only. Never inspect per-query held-out results** — not the trajectories, not the
per-task solves, not the failure modes. That rule is absolute and this set is the frozen one.

Primary outcome: **solved rollouts per arm**, sweet vs native, out of 200 each.
Secondary: cost per rollout on the realised / ideal / break-priced columns, with the §4.3 caveat.

**Also report, every time:** **37 of the 200 (18.5%) are naming lotteries** — the hidden test
needs an identifier the reference patch invented, which the base tree never mentions and the
issue does not spell out. This set had never been name-lock stamped before 2026-09-08. That is
a fifth of the denominator measuring guessing rather than retrieval. The 27-task rebaseline pool
was 0%.

**Also disclose:** the goldens are three-way mixed by encoder — **177 built on Mac ORT INT8
(`q8`), 23 on a RunPod RTX 5090 (`device: cuda, dtype: bf16`)** — each recorded in its stamp.
The owner tested GPU/CPU retrieval parity and accepted the mix.

---

## 6. Prior result this will be compared against

The 27-task post-fix rebaseline (2026-09-04/05, 486 rollouts, $8.87) came out **at parity on
solves and cheaper on every harness**:

| harness | sweet | native | Δ solves | Δ cost |
|---|---:|---:|---:|---:|
| codex | 56/81 | 55/81 | +1 | −9.5% |
| opencode | 55/81 | 57/81 | −2 | −7.8% |
| claude-code | 58/81 | 55/81 | +3 | −2.9% |

The standing claim is **efficiency at parity**, not more solves. Do not expect the frozen set to
say otherwise, and do not let a 1-rep codex leg overturn it on its own.

**claude-code cost must come from OpenRouter's billing** (`/root/reprice-claudecode-openrouter.mjs`),
never from `rows.json` — its rows null out **arm-asymmetrically** and reverse the sign.

---

## 7. If something breaks

- **Disk.** The script kills every leg at 15 GB free. Root sits near 54 GB; `/mnt/benchvol` holds
  the warm-image vault. The rebaseline was once voided entirely by `NO_IMAGE_GC=1` filling the
  disk — that flag is deliberately **not** set here.
- **`pgrep -f` self-matching.** Four separate incidents in the last two days: a pattern that
  appears in your own command line matches your own shell. Always bracket, e.g. `run-pilo[t]`,
  and check what actually matched before killing anything.
- **Per-rep patches are not persisted.** Only rep0 lands in `preds-*.jsonl`; `predsByRepArm` is
  in memory. If a run dies after the agent phase, reps 1+ are unrecoverable. Irrelevant at
  REPS=1, but know it before raising reps.
- **Trailing newlines.** `/root/ho2-admitted200.txt` needed one added; without it the 200th id
  was silently dropped by `while read`. Check any list file you build.

---

## 8. Paths

| what | where |
|---|---|
| launch script (staged, unexecuted) | `/root/ho2-codex-sub.sh` |
| full 3-harness launch (also staged, ~$66) | `/root/ho2-launch.sh` |
| task ids / merged specs | `/root/ho2-admitted200.txt`, `/root/ho2-200-specs.json` |
| green ledger | `/root/env-ledger/luna-ho2-fp5/ledger.jsonl` |
| goldens + index stamps | `/root/.ss-eval/golden/`, `.../.provenance-index/` |
| replacement log | `eval/task-completion-bench/select/HELDOUT2_REPLACEMENTS_ROUND2.json` |
| amended rules | `eval/task-completion-bench/select/HELDOUT2_RULES.md` (Amendment 2) |
| null-arm clearances | `eval/task-completion-bench/harness/prescreen-cleared.json` |
| vacuity blocklist | `eval/task-completion-bench/harness/task-blocklist.json` |
| rebaseline traces | `results/rb27c-{codex,opencode,claudecode}-20260905/`, `results/rb27-opencode-20260904/` |
| CUDA addon (reusable) | `/root/sweet-search-native.linux-x64-gnu-cuda.node`, sha256 `13f5cc79…` |

---

# ADDENDUM — 2026-09-09, first launch failed and was repaired

The run described above was launched, lost **27 of 27 rollouts**, and was killed at 26/400.
Nothing above is wrong about the task set; two things it asserts about the environment were.

## A. The launch command as written cannot work — egress

The agent jail routes ALL egress through `egress-guard.mjs`'s SNI-inspecting proxy, whose
allowlist was the literal `['openrouter.ai']`. A subscription run talks to **`chatgpt.com`**,
which the proxy refused mid-ClientHello. Every rollout came back
`calls=0 hunks=0 exit=codex_error` after ~72s with
`stream disconnected before completion: tls handshake eof`. The denial log recorded
**33,952 refusals, every one `chatgpt.com`**.

The failure is arm-symmetric and silent. It grades as a dead treatment, not as an error —
the same shape as the auth-decay trap §1 warns about, from a different cause.

**Why the preflight passed anyway.** `assertGuardReachable` probes only `allow[0]`, which was
`openrouter.ai`. The guard was genuinely reachable; the host the run needed was not.

**Fixed in `4017a54`.** `DEFAULT_ALLOW` now reads `EGRESS_ALLOW`, and `ensureGuard` reconciles
against it when no explicit allowlist is passed — without that second half, a guard left running
by an earlier run keeps serving its own allowlist and silently overrides the environment.
`/root/ho2-codex-sub.sh` now exports:

```
export EGRESS_ALLOW="chatgpt.com,openrouter.ai"
```

**Put the host the run depends on FIRST.** That is what makes this failure abort the run instead
of quietly producing 400 zeroes.

**Verified** inside the netns after the fix: `chatgpt.com` completes TLS 1.3 with
`authorized=true`; `github.com` is still refused. A live 1-task smoke on a DEV-RET task
(zero overlap with the frozen 200) then produced a real rollout: 13 tool calls, 7 hunks,
tests run.

## B. Report `escape=` with a caveat for this leg

Subscription rollouts attempt `sdmntpr*.oaiusercontent.com` (an OpenAI content CDN) and the
guard refuses it. That is **not** an agent escape attempt, and it is **not** on the allowlist —
deliberately, since it is a content host of exactly the class the allowlist exists to exclude.
The rollout completes without it. Every `escape=` count in this leg therefore carries a nonzero
floor from codex itself. It is arm-symmetric, so comparisons hold, but the raw number must not
be read as agent behaviour.

## C. The golden claim in §2 was two claims, and one was wrong

There are **two** provenance stores, and the table above conflated them.

`.provenance/` holds **commit** provenance — proof the tree is the base commit. It holds
**16 stamps for 474 goldens**. This is the store the runner reads, and it is the source of every
`provenance UNSTAMPED` line in the run log. It is near-universally absent, it predates this
work, and it affects every prior run equally. `golden-provenance.mjs` explains why it cannot be
reconstructed: `rm -rf .git && git init` destroys the evidence.

`.provenance-index/` holds **index** provenance — what the rebuild wrote. It covered
**186 of the 200** admitted tasks, not 200.

**The 14 without a stamp were rebuilt.** The owner is right. Their indexes date from
2026-09-08 13:36–21:02, *newer* than the stamped ones, and 14 is exactly the number of §7
replacements. `/root/promote*.log` shows them built on the box by `golden-build.mjs`, which
builds the golden but never writes an index stamp. The stamp step, not the build, was missing.

All 14 are now back-stamped (`stamper: backstamp-replacements@1`), so coverage is 200/200.
Each back-stamp is explicit about what is measured and what is not: `goldenTreeHash`, chunk and
file counts and index file sizes were computed from the artefact; `builtAt_observed` is the
index mtime; **`backend` is marked INFERRED and `backendVerified: false`**, because the build
environment was never recorded and the box has no accelerator. Do not cite it as verified.

## D. The encoder census in §5 is wrong

§5 says 177 Mac `q8` plus 23 RunPod `cuda`. The stamps for the admitted 200 actually say:

| built | count |
|---|---:|
| `ort-int8-cpu-q8`, host `m3max` | 165 |
| `ho2-pod-20260907` (RunPod, no backend field recorded) | 21 |
| box-built §7 replacements, backend inferred | 14 |

That is a **three-way** mix, not two-way. Publish this table, not §5's.
