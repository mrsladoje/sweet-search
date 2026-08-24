# The env-ledger fingerprint did not cover the shim it ships — closed at version 4

**Executes:** [`D2-DEPLOYMENT-BLOCKED.md`](./D2-DEPLOYMENT-BLOCKED.md) §5, bullet 2.
**Date:** 2026-08-24. **Model spend: `$0`.** **Decision taken by the user** after the
trade-off below was measured; the fingerprint was not changed before that.

---

## 0. The gap

`RT_HARNESS_FINGERPRINT` hashed the modules the `run_tests` shim **calls** —
`rt-condense-lib`, `rt-shim-runtime`, `rt-dedup`, `rt-progress-controller` — plus the grader.
It never hashed **the shim itself**, and it never hashed the template that assembles it.

D2 walked straight through that. It changed the generated shim so that, under the production
isolation policy, every `run_tests` call on every harness died with `ERR_MODULE_NOT_FOUND`
and no agent ever received a verdict. **Two runs on either side of that change compared as
ledger-identical**, because neither `rt-inflight.mjs` nor `codex-task-runner.mjs` was covered.

## 1. The cost, measured rather than assumed

The blocked write-up recorded the price as *"closing it invalidates every existing green
ledger."* That is almost entirely already true, and the difference decides the question.

Freshness census over all 26 ledgers on the box, recomputing each entry's `configHash` under
the current fingerprint:

| | entries |
|---|---:|
| total | 1430 |
| **still fresh** | **22** |
| already stale | 1225 |
| spec not resolvable (task file no longer in the cache) | 183 |

**Only one ledger is meaningfully live: `env-ledger/luna-rotate20-v3`, 16 fresh of 18.** That
is the active rotation. Everything else was already invalid and would have needed a re-sweep
before its next use regardless.

**The census is verified, not asserted.** For `ucl__stir-1442` the script's bare
`taskConfigHash(spec, {})` returns `558229c74bb80f1a`, byte-for-byte what run-pilot's own
preflight reported as `current` and what a fresh sweep then wrote. **Limit:** tasks carrying
`task-overrides.json` entries, and tasks on local warm/derived images (whose hash embeds a
docker image ID), are not exercised by that check, so a handful of rows in the table could be
misclassified in either direction. The conclusion does not turn on them.

## 2. What was built

Hashing a **file list** would have closed the named hole and left the class open: the shim
template lives inside `codex-task-runner.mjs`, and adding that file would stale every gold
verdict each time an unrelated line of a 58 KB adapter moved.

So the fingerprint hashes **the generated shim text**:

- `harness/rt-shim-text.mjs` — the two shim variants as pure functions of their parameters.
  It exists as its own module because `codex-task-runner.mjs` already imports
  `env-ledger.mjs`, so the fingerprint cannot reach back into it without a cycle.
- `shimFingerprintSource()` renders both variants under **canonical placeholder paths**. That
  matters: a per-rollout temp path would make every run's fingerprint unique and the ledger
  permanently stale rather than merely strict. A test asserts the canonical text contains no
  such path.
- `RT_HARNESS_FINGERPRINT` gains `shim: {sha256}` and goes to **version 4**.

This covers the inlined in-flight protocol, the template, and any future inlining, in one
rule that does not rot.

**The jail rule now lives on the same bytes as the ledger rule.** `tests/env-ledger-gate.mjs`
asserts that the broker requester — the variant that runs inside a jail which masks the whole
of `<repo>/eval` — imports `node:` specifiers and nothing else, checked against the canonical
text the fingerprint hashes. The two rules cannot drift apart.

## 3. Consequence

Every existing ledger entry is now stale, which for 1225 of 1430 was already the case. The
one live ledger, `luna-rotate20-v3`, needs an 18-task re-sweep. A sweep costs container time
and **no model spend** — the single-task STIR re-sweep in this session took about four
minutes for a 67-test C++ suite.

**No run may be launched on a pre-v4 ledger.** The preflight enforces that by construction;
this note exists so the refusal is expected rather than surprising.
