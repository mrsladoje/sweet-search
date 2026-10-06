# MaxSim kernel benchmark (replayed production calls)

Times the native MaxSim kernels (`crates/sweet-search-native/src/lib.rs`) on real
query × candidate-pool calls captured from the production search path, and
compares them with the popular CPU MaxSim kernel
[`maxsim-cpu`](https://github.com/mixedbread-ai/maxsim-cpu) (mixedbread, Rust +
Apple Accelerate / libxsmm), a NumPy per-doc matmul and a padded PyTorch einsum
(the PyLate `colbert_scores` shape).

## Data: two replay sets (dev only)

| set | source | kernel calls | pool p50 / p95 / max | query tokens p50 / max | doc tokens p50 / max |
|---|---|---|---|---|---|
| agent | 689 unique `ss-search` / `ss-semantic` / `ss-find` calls that agents made in dev retrieval-bench runs (`core/prompt-optimization/data/results/r282-*`, held-out ids excluded), replayed on the 11 `eval/repos/r3-*` repos | 655 | 25 / 58 / 690 | 14 / 48 | 366 / 512 |
| gcsn | GenCodeSearchNet **dev** split (3,600 queries), `eval/run_benchmark.js` | 3,582 | 20 / 20 / 20 | 14 / 102 | 119 / 512 |

All captured calls use the int4 per-token path (what the current indexes store).
The int8 per-token arm requantizes the same docs (`int8.mjs`).

## Capture

`hook.mjs` is a `--import` preload: it wraps the native addon's three batch
functions and writes each call (query, candidates, our scores) to
`$SS_MAXSIM_DUMP`. Both the daemon and the client get the hook, so the calls
are exactly the ones production makes.

```bash
OUT=/some/scratch/maxsim-replay
python3 extract-calls.py $OUT/agent/calls.json
./run-capture.sh $OUT/agent composer dgraph drogon grdb jj ocelot okhttp sequel tortoise-orm typedoc zipkin
SS_MAXSIM_DUMP=$OUT/gcsn/gcsn NODE_OPTIONS="--import $PWD/hook.mjs" \
  node ../run_benchmark.js --dataset=gencodesearchnet --split=dev --profile=full --sqlite-fast --concurrency=1 --skip-index
```

`run-capture.sh` starts one hooked daemon per repo and stops it with
`pkill -x sweet-search-daemon` (the daemon renames its process title, so a
`--serve` pattern does not match it).

## Timing

```bash
uv venv --python 3.11 venv && VIRTUAL_ENV=$PWD/venv uv pip install maxsim-cpu numpy torch   # no wheels for 3.14
node bench-ours.mjs $OUT/agent ours-agent-1.json 7           # ADDON=<.node> times a specific build
venv/bin/python -I bench-theirs.py $OUT/agent theirs-agent-1.json 7
python3 analyze.py agent 1
node ab.mjs $OUT/agent 7 old.node new.node int4               # build vs build, interleaved per call
```

Per call: one warm run, then the median of 7 timed runs, calls back-to-back.
Ours is timed from Node through NAPI (the production call). Theirs is timed from
Python through pyo3 with docs already dequantized and divided by the stored
norms (`maxsim_cpu`, their best case). `maxsim_cpu+dequant` adds the int4 → f32
step that our storage would need. Parity: theirs / numQ equals our contract once
our clamp `max(0, ·)` is applied (checked: max diff 1.8e-7). Without the clamp it
differs by up to 2e-2 when a query token has only negative similarities.

**Idle gaps:** after ~2 ms idle, every rayon pool (ours and `maxsim-cpu`) pays
~150–200 µs to wake threads and ramp clocks. Back-to-back timing is the kernel
metric. In production the query encoder keeps the cores busy right before scoring.

## Results (M3 Max, 2026-10-06, back-to-back, 7 reps)

Speed ratio = geometric mean over calls of other / ours-int4 (> 1 = ours faster), 95% bootstrap CI.

| arm | agent p50 ms | agent p95 ms | agent ratio | gcsn p50 ms | gcsn ratio |
|---|---|---|---|---|---|
| ours int4, before (98de5a8c) | 0.494 | 1.181 | — | 0.327 | — |
| **ours int4, after** | **0.137** | **0.274** | 1 | **0.102** | 1 |
| ours int8 per-token, after | 0.138 | 0.281 | 1.01 | 0.102 | 1.01 |
| maxsim-cpu (pre-normalized f32) | 0.540 | 1.238 | 2.86 [2.73, 3.01] | 0.417 | 3.92 [3.89, 3.95] |
| maxsim-cpu + int4 dequant | 1.641 | 4.100 | 9.51 | 1.023 | 9.83 |
| numpy per-doc matmul | 0.272 | 0.734 | 1.58 | 0.193 | 1.87 |
| torch padded einsum | 1.051 | 2.500 | 7.05 | 0.572 | 5.45 |

Before the change, `maxsim-cpu` (best case) beat our kernel on the agent set
(ours 0.85–0.93×) and NumPy beat it on both sets. After: same-process A/B
old → new = 1.78× (agent int4), 1.61× (gcsn int4), 1.45× (agent int8); scores
within 3.7e-7 relative, top-1 agreement 100%.

What the change did (aarch64 only, x86 unchanged): NEON int4/int8 dequant
(1.22×), a 4 query × 4 doc register-blocked kernel with pairwise-add folding
(1.29×; both together 1.73×), per-thread tile reuse and a per-batch padded query.
Tried and dropped: dim-major transposed 4×8 kernel (0.97×), running small
batches on the calling thread (0.39–0.90×), work-balanced task splitting (helps
only after idle gaps, hurts back-to-back), QoS user-interactive pool threads (no
change). Remaining fixed cost per call: ~1 µs per candidate of NAPI object
marshalling, and the rayon wake-up.
