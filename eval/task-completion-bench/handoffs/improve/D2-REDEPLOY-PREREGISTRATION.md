# D2 redeployment — pre-registered acceptance bar

**Committed BEFORE any live rollout of the repaired shim exists.** Executes
[`D2-DEPLOYMENT-BLOCKED.md`](./D2-DEPLOYMENT-BLOCKED.md) §4.
**Date:** 2026-08-24. **Budgeted model spend: under `$0.10`** (one smoke rollout per harness).

---

## 1. The root cause, reproduced before the fix was written

`agent-jail.mjs` masks the whole of `<repo>/eval` inside the jail
(`buildOps`, step 3). Every file in `harness/` is therefore `ENOENT` to any process running
under isolation. Reproduced against a jail started with the **exact `extraBinds` and
`extraMasks` an opencode rollout passes**, by
[`phase1-scripts/d2-jail-import-probe.mjs`](./phase1-scripts/d2-jail-import-probe.mjs):

```
harness dir listing from inside the jail: readdir failed: ENOENT
repo root listing from inside the jail:   43 entries
eval/ listing from inside the jail:       1 entries      (the ss-* bin bind, alone)

rt-shim-runtime.mjs   read=NOT READABLE (ENOENT)  import=IMPORT FAILED (ERR_MODULE_NOT_FOUND)
rt-inflight.mjs       read=NOT READABLE (ENOENT)  import=IMPORT FAILED (ERR_MODULE_NOT_FOUND)
rt-condense-lib.mjs   read=NOT READABLE (ENOENT)  import=IMPORT FAILED (ERR_MODULE_NOT_FOUND)
```

**The previous probe was right and its premise was wrong.** `D2-DEPLOYMENT-BLOCKED.md` §3
recorded the harness directory as unreadable and treated it as unreconciled, because
`rt-shim-runtime.mjs` "the working shim imports the same way". It does not. There is no
contradiction to resolve:

- `setupRunner` passes `brokerMode: ISOLATION_ON`, so the shim that runs in production is the
  **broker requester**, and pre-D2 it imported `node:fs` and nothing else.
- `rt-shim-runtime.mjs` is imported by the **direct** variant, reached only with isolation
  OFF and therefore never inside a jail, and by the **broker**, which `setupRunner` spawns
  on the host before `startJail`.
- D2 added its absolute-path import to **both** variants — including the requester.
  §2 of the blocked write-up attributes it to the direct variant only; that is incorrect and
  is corrected here rather than edited there.

## 2. The fix

`inflightInlineSource()` in `rt-inflight.mjs` returns the module's own source down to an
explicit `INLINE BOUNDARY`, with the `export` keywords stripped. Both generated shims
prepend it instead of importing. One definition of the in-flight protocol, no runtime
dependency, immune to the mount policy. A generation-time check refuses any non-`node:`
import above the boundary.

## 3. Acceptance bar — pre-registered, and this is NOT preflight

Preflight does not execute the shim; it is reported but it decides nothing.

**Per harness (`codex`, `opencode`, `claude-code`), on a LIVE rollout with isolation ON:**

| # | criterion | source |
|---|---|---|
| A1 | `rtLaunched ≥ 1` | row telemetry |
| A2 | `rtNoVerdict == 0` | row telemetry |
| A3 | `rtEndedUnverified == false` | row telemetry |
| A4 | verdict LINES in the retained trace `≥ 1` | independent grep |
| A5 | `ERR_MODULE_NOT_FOUND` occurrences `== 0` | independent grep |

**PASS** for a harness = A1–A5 all hold. **FAIL** = any of them does not.
Instrument: [`phase1-scripts/d2-verdict-count.mjs`](./phase1-scripts/d2-verdict-count.mjs),
committed with this file.

### Two deviations from the bar as it was handed over, declared in the open

The handover said *"count with `grep -c "run_tests verdict"` on the retained trace. It must be
1 per trace."* Both halves of that are unsafe, and the reasons are measurable, not stylistic:

1. **`grep -c` counts the banner as a verdict.** D2's own running banner quotes the marker
   verbatim — `a completed run always ends with a line beginning "[run_tests verdict]
   status="`. So the naive grep scores a totally broken shim as passing, which is the exact
   failure this gate exists to catch. The instrument counts only marker occurrences that
   **begin a line**, and reports quoted banner occurrences separately.
2. **"1 per trace" is the wrong number.** A rollout legitimately calls `run_tests` more than
   once: the retained pre-D2 revert smoke on `dashbitco__nimble_options-43` contains **three**
   verdicts for three calls. And opencode's NDJSON re-emits an updated tool part, so each
   verdict appears 2–3 times in the raw stream — occurrence counts are not call counts. The
   per-call figure is the row telemetry; the grep is the independent cross-check.

The property actually being asserted is **"no launch went unanswered"**, which is A2/A3.

## 4. Stop conditions

- If any harness FAILS, revert the box to `/root/harness-backup-pre-D2-20260824/` and report
  the failure with its output. Do not iterate on the box under a live run.
- **Codex may be unable to authenticate** (the runner never writes the refreshed subscription
  token back). If it does, that is reported as *not proven on codex* and the fix lands for the
  two harnesses that were proven. It is NOT reported as three.
- No result from this gate is a head-to-head number. D2 is arm-universal by construction:
  one shim serves both arms. It can never be booked as a sweet win.
