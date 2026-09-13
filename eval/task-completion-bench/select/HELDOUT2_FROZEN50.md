# HELDOUT2 FROZEN 50 — the fixed subset for expensive models

**Drawn 2026-09-13, BEFORE any model in the expensive slate was run.** That order is the
whole point: a subset chosen after seeing results, or varied per model, cannot support a
comparison.

- **Source:** the 200 admitted tasks of frozen held-out 2 (`/root/ho2-admitted200.txt`).
- **Method:** stratified by language, proportional, largest-remainder to land exactly 50.
  Ids sorted before shuffling, so the draw does not depend on file order.
- **Seed:** 42.
- **List:** `HELDOUT2_FROZEN50.txt`, sha256
  `861000ee263e600ba016f4db940b7426fdc5f347ce7426a4c0409e2bfa7ae51d`.

## Language mix

| language | in 50 | in 200 | share 50 vs 200 |
|---|---:|---:|---|
| python | 11 | 42 | 22% vs 21% |
| ts | 11 | 42 | 22% vs 21% |
| js | 8 | 31 | 16% vs 16% |
| go | 6 | 25 | 12% vs 12% |
| rust | 5 | 20 | 10% vs 10% |
| java | 4 | 17 | 8% vs 8% |
| php | 2 | 8 | 4% vs 4% |
| swift | 1 | 5 | 2% vs 2% |
| dart | 1 | 2 | 2% vs 1% |
| elixir | 1 | 2 | 2% vs 1% |
| c, clojure, cpp, csharp, r, scala | 0 | 1 each | singletons, unrepresentable at n=50 |

## Rules for using it

1. **Every expensive model uses THIS list, unchanged.** Comparing model A on one 50 against
   model B on another 50 measures the draw, not the models.
2. **Six singleton languages are absent.** A 50-task result says nothing about c, clojure,
   cpp, csharp, r or scala.
3. **Expect solve deltas at n=50 to be noise.** The full 200 with 1 rep already produced
   McNemar p=0.12 and p=0.66; a quarter of the tasks cannot do better. Cost deltas stay
   readable because the comparison is paired per task.
4. **Report the whole slate.** Running many models against a frozen set is not contamination
   while the system under test is unchanged — there is no feedback loop. What *would* break
   it is reporting only the model that flattered the result.
