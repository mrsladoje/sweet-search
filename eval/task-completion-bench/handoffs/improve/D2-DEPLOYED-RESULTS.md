# D2 (`rt-inflight` / terminal `run_tests` verdict) — deployed, live-verified on two of three harnesses

**Executes:** [`D2-DEPLOYMENT-BLOCKED.md`](./D2-DEPLOYMENT-BLOCKED.md) §4, under
[`D2-REDEPLOY-PREREGISTRATION.md`](./D2-REDEPLOY-PREREGISTRATION.md) (committed at `0f99263`,
**before** any rollout of the repaired shim existed).
**Date:** 2026-08-24. **Model spend: `$0.302`** — three acceptance rollouts plus one retry.
**Artifacts:** [`d2-20260824/`](./d2-20260824/) — `acceptance.txt`, `jail-probe.txt`, the three
pilot logs.
**Instruments:** [`d2-jail-import-probe.mjs`](./phase1-scripts/d2-jail-import-probe.mjs),
[`d2-verdict-count.mjs`](./phase1-scripts/d2-verdict-count.mjs).

---

## 0. Verdict

**D2 is deployed and works. It had TWO independent blockers, not one, and preflight was green
for both.** The second was invisible until a real rollout ran, exactly as the blocked write-up
predicted it would be.

| harness | rtLaunched | rtVerdicts | rtNoVerdict | rtEndedUnverified | verdict lines | `ERR_MODULE_NOT_FOUND` | result |
|---|---:|---:|---:|---|---:|---:|---|
| opencode | 3 | 3 | **0** | false | 6 | 0 | **PASS** |
| claude-code | 1 | 1 | **0** | false | 2 | 0 | **PASS** |
| codex | — | — | — | — | 0 | 0 | **NOT PROVEN** — cannot authenticate |

For comparison, the same measurement on the failed deploy was `rtLaunched=2, rtVerdicts=0,
rtNoVerdict=2, rtEndedUnverified=true`.

**Codex is reported as not proven, not as passing.** Its subscription refresh token was
already spent (`last_refresh 2026-08-06`), and `codex exec` returns
`401 Unauthorized … refresh token was already used. Please log out and sign in again.` That
needs an interactive `codex login`, which is the operator's action. The shim it would use is
byte-identical: `codex-task-runner.mjs` hard-codes `brokerMode: true` and calls the same
`writeRunTestsShim`. That is an argument, not a measurement, and it is not counted as one.

## 1. Blocker 1 — the root cause, reproduced before the fix was written

`agent-jail.mjs` `buildOps` masks the whole of `<repo>/eval` (step 3, so the repo bind does
not re-expose the benchmark). Every file in `harness/` is therefore `ENOENT` inside the jail.
Reproduced against a jail started with **the exact `extraBinds` and `extraMasks` an opencode
rollout passes** — the omission that made the previous probe distrusted:

```
harness dir listing from inside the jail: readdir failed: ENOENT
repo root listing from inside the jail:   43 entries
eval/ listing from inside the jail:       1 entries       (the ss-* bin bind, alone)

rt-shim-runtime.mjs   read=NOT READABLE (ENOENT)  import=IMPORT FAILED (ERR_MODULE_NOT_FOUND)
rt-inflight.mjs       read=NOT READABLE (ENOENT)  import=IMPORT FAILED (ERR_MODULE_NOT_FOUND)
rt-condense-lib.mjs   read=NOT READABLE (ENOENT)  import=IMPORT FAILED (ERR_MODULE_NOT_FOUND)
```

**The earlier probe was right; its premise was wrong.** There is no contradiction to resolve,
and the blocked write-up's §2 and §3 are corrected here rather than edited there:

- `setupRunner` passes `brokerMode: ISOLATION_ON`, so the shim that runs in production is the
  **broker requester** — and before D2 it imported `node:fs` and nothing else, which is why it
  never noticed the mask.
- `rt-shim-runtime.mjs` is imported by the **direct** variant, reached only with isolation OFF
  and therefore never inside a jail, and by the **broker**, which `setupRunner` spawns on the
  host before `startJail`. It is never imported from inside a jail, so it was never evidence
  that the directory is reachable.
- D2 added its absolute-path import to **both** shim variants, the requester included. The
  blocked write-up attributes the new import to the direct variant only. That is incorrect.

**Fix.** `inflightInlineSource()` returns `rt-inflight.mjs`'s own source down to an explicit
`INLINE BOUNDARY`, with the `export` keywords stripped, and both generated shims prepend it
instead of importing. One definition of the in-flight protocol, no runtime dependency, immune
to the mount policy. Shim generation refuses any non-`node:` import above the boundary, so the
defect cannot return as a quiet edit.

## 2. Blocker 2 — found by the first live rollout, and preflight was green for it too

With the import fixed, the shim started and produced verdicts. Every rollout was then thrown
away:

```
[SHIM-TAMPERED dashbitco__nimble_options-43] _rt_ipc/verdict-1787565862399-91hajg (unexpected),
  … three more … — test signals untrusted
[sweet rep0] SHIM-TAMPERED (…) — invalid, automatic re-run (policy)
```

`verifyRunnerDirectoryIntegrity` requires `_rt_ipc` to be **empty** at exit, because an
unconsumed request or an undelivered response means the agent never received an answer it
asked for. D-6's `publishVerdict` **retains** `verdict-<id>` on purpose — that is what lets a
later `run_tests` call attach to a run whose requester was killed mid-wait and still be given
the answer. The two rules contradict each other.

`verdict-` and `inflight-` are now whitelisted: they are harness-written by design, not agent
evidence. `req-`, `res-` and `tmp-` still flag, so the property the check exists for is
unchanged — asserted in both directions in `tests/rt-integration.mjs`.

**This blocker was in D2 as committed at `b54d194`.** Fixing only the import would have
produced a run in which every rollout was marked invalid and re-run.

## 3. Why preflight could never have caught either

The env ledger validates that a gold grade transfers under the current config. **It does not
execute the generated shim.** Preflight was `1/1 gold-FULL` for the broken import, for the
tamper defect, and for the working build. The acceptance signal has to be verdict counts on a
live rollout, and this is now the second time that has been the only thing that worked.

## 4. Measurement, and two corrections to the bar as handed over

Both were declared in the pre-registration before the run, not after seeing the numbers.

1. **`grep -c "run_tests verdict"` counts the banner as a verdict.** D2's own running banner
   quotes the marker verbatim — `a completed run always ends with a line beginning
   "[run_tests verdict] status="`. The naive grep would have scored the *broken* shim as
   passing. The instrument counts only occurrences that **begin a line** and reports the
   quoted banner copies separately: **9 banner quotes against 6 verdict lines on opencode, 3
   against 2 on claude-code.**
2. **"1 verdict line per trace" is the wrong number.** A rollout legitimately calls
   `run_tests` more than once — opencode did so three times here — and opencode's NDJSON
   re-emits an updated tool part, so each verdict appears twice in the raw stream. Occurrence
   counts are not call counts. The per-call figure is the row telemetry; the grep is the
   independent cross-check. The property asserted is **"no launch went unanswered"**.

## 5. State of the box, and what is now different

- The box harness is **no longer divergent from `main`**: all four previously-behind files
  plus `rt-inflight.mjs` and `golden-provenance.mjs` are deployed and md5-identical to `main`.
  Pre-attempt backups remain at `/root/harness-backup-pre-D2-20260824/`, and a second copy of
  the same bytes at `/root/harness-backup-pre-D2-20260824-verify/`.
- **`claude` is not on the non-interactive PATH on the box.** The first claude-code attempt
  died with `agent binary "claude" not found on PATH inside the jail`, which is a launcher
  defect, not a D2 one: `/root/.local/bin` is absent from a non-login shell's PATH. Any script
  driving `HARNESS=claudecode` must `export PATH=/root/.local/bin:$PATH`. The retry with that
  line passed and resolved the task.
- **Codex cannot run at all until someone re-authenticates it.** This is the documented
  subscription-auth decay: the runner never writes a refreshed token back. Every codex figure
  gathered from now until that is fixed is a `codex_error` with `calls=0`.

## 6. Consequences carried forward

- **Codex evidence gathered before this deployment still carries the yield-before-completion
  defect** D2 was written to fix — 14 codex task-arm cells across 8 tasks. That is unchanged.
- **D2 is arm-universal by construction.** One shim serves both arms; it carries zero
  head-to-head differential and must never be booked as a sweet win. It is a validity fix.
- **`rt-inflight.mjs` is still not in `RT_HARNESS_FINGERPRINT`,** so this change — which can
  silently zero every test verdict — does not stale a single existing ledger. That gap is
  raised as its own decision item; it is not closed here.
