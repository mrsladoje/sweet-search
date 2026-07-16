# Held-out set pre-registration — task-completion bench

**Date frozen:** 2026-07-15 (written BEFORE sampling; no outcomes of any kind consulted)
**Status:** selection criteria below are final once `tasks_heldout.jsonl` is frozen.

## Purpose

The dev-200 (`tasks_multilingual.jsonl`, seed=42) has been iterated against
(prompt variants, harness levers, per-repo overrides). Paper numbers therefore
come from this fresh held-out set, sampled outcome-blind under the rules below.

## Population

- `nebius/SWE-rebench-V2`, **revision pinned to the dev manifest revision**
  (`475dd5e8703bb5fb22dd3c60b5d038b019eba1e0`) so dev and held-out draw from the
  identical pool snapshot.
- Same base filters as dev: `meta.llm_metadata.code == 'A'`, non-empty
  `FAIL_TO_PASS`, full date range.

## Exclusions (contamination guard)

1. Any `instance_id` present in `tasks_multilingual.jsonl` (dev-200).
2. Any task whose `repo` appears in the dev-200 — repo-level exclusion, because
   harness levers (task-overrides, shim policy, lockdown handling) were tuned
   with dev repos in view.
3. Any `instance_id` present in `tasks_decontam.jsonl` (belt-and-braces; that
   set serves the separate recency robustness check).

The selector asserts zero instance-id AND zero repo overlap with the dev-200
and refuses to freeze otherwise.

## Language distribution (fixed target, N=200)

Rationale: the dev-200 used a floor of 5 per language, over-representing
long-tail languages relative to real 2026 agentic-coding traffic. The held-out
uses fixed weights anchored to GitHub Octoverse 2025 most-used-language
rankings (TypeScript #1 — overtook Python and JavaScript in Aug 2025; then
Python, JavaScript, Java, C#, C++, Go, PHP, C; Rust fastest-rising, all-time
high), mapped onto the 20 languages available in SWE-rebench-V2 (which has no
Ruby). A ~5% long-tail slice is retained deliberately so the claim is not
"top languages only".

| lang | n | | lang | n |
|------|---|-|------|---|
| ts | 30 | | c | 8 |
| python | 30 | | php | 8 |
| js | 26 | | kotlin | 6 |
| java | 20 | | swift | 4 |
| go | 18 | | scala | 2 |
| rust | 18 | | dart | 2 |
| csharp | 12 | | elixir | 2 |
| cpp | 10 | | julia | 2 |
| | | | r | 1 |
| | | | clojure | 1 |
| | | | lua, ocaml | 0 |

Total = 200. Weights are judgment-fixed from the external anchor above and
committed before sampling; they were not derived from any per-language dev
performance.

**Deficit rule (pre-registered fallback):** if a language's post-exclusion pool
is smaller than its quota, the shortfall is reassigned one task at a time to
the language with the largest quota that still has spare pool (ties broken
alphabetically). Applied deterministically by the selector.

## Sampling

- Within each language: sort candidates by `instance_id`, shuffle with
  `random.Random(20260715)` (single RNG shared across languages, languages
  visited in sorted order — same scheme as dev), take the quota.
- **Seed = 20260715** (the freeze date; chosen before sampling).

## Ranked reserve & replacement protocol (amended 2026-07-15, before any runs)

Dev attrition (~17% of tasks lost to environment issues at preflight) motivates
a replacement protocol so the analyzed N stays exactly 200. A ranked reserve of
`ceil(primary_quota / 2)` per language (101 tasks, `tasks_heldout_reserve.jsonl`)
is drawn from the NEXT ranks of the same seeded shuffle — the primary 200 is
byte-identical to the original freeze (asserted in-script).

**Replacement rule:** a primary task that fails environment preflight
(golden-FULL build or env-ledger gate) for tool-independent reasons is replaced
by the lowest-rank unused reserve of the same language; if that language's
reserves are exhausted, by the reserve of the largest-primary-quota language
with reserves remaining (ties alphabetical). Replacement happens strictly
BEFORE any arm rollout on that task — no task is ever replaced, added, or
dropped after outcomes exist. Goldens/ledger are only built for primaries and
promoted reserves. Every replacement is logged in the run manifest with its
preflight failure reason.

## Planned evaluation (recorded for pre-registration completeness)

- N = 200 tasks × 2 arms (sweet-search vs control) per backbone model.
- Backbones: mimo (dev continuity anchor), Sonnet 5, Grok 4.5,
  GPT-5.6 Terra (access permitting), Muse Spark 1.1 (conditional on a stable
  smoke run). Preview-API models may be dropped for availability reasons;
  such drops are availability-driven, never outcome-driven.
- Primary endpoint: efficiency-at-parity in aggregate (cache-normalized
  idealCost delta on both-solved pairs; solve parity via paired test), as on
  dev. Per-language numbers are descriptive only (slices are too thin for
  inference at these quotas).
- Discipline: NO per-task inspection of held-out results; aggregate metrics
  only, at milestones. Any held-out regression is fixed at the principle
  level, never tuned to.
- Before any counted run: golden-FULL + green env-ledger per task under the
  exact run config; language indexing gate (FILE_PATTERNS/EXTENSION_MAP)
  verified for every language present; USD + cache pricing plumbed for every
  provider.
