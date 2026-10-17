# Adding your own implementation (arm) to LIRK-Bench

An **arm** is one MaxSim implementation in one configuration. Adding an arm takes three
steps: write a function, pick its contract, run it. This file shows each step with code
that was run (`einsum_arm.py` in this folder).

## 1. What an arm is

An arm is a function `build(call) -> run`.

- `build(call)` runs once per call, **outside the timer**. It builds the arrays your library
  wants (layout, dtype, packing).
- `run()` is the **timed** part. It returns the MaxSim score of every candidate document:
  a float array of length `len(call["cands"])`. The score is the **mean** over the query
  tokens of the best match per query token. (Some libraries return the sum. Divide by
  the number of query tokens.)

`bench.py` calls `run()` once untimed (those scores are checked), then `--reps` times timed.
The latency of a call is the median of the timed repetitions.

## 2. Where `ARMS` is defined

In `bench.py`, in the section `# --- arms` (search for `ARMS = {}`):

```python
ARMS = {}

def arm(name, contract='Spre', clamp=False, precision='f32'):
    def reg(fn):
        ARMS[name] = (fn, contract, clamp, precision)
        return fn
    return reg
```

An entry is `name -> (build, contract, clamp, precision)`. Use the `@arm(...)` decorator,
or assign `ARMS[name] = (...)` directly (the NumKong and `torch_pad_*` arms do this).
`python bench.py --list-arms` prints every arm with its contract, clamp flag and precision.

## 3. Choose the contract

The contract says **what the number means**. The benchmark compares your scores with a
float64 reference of the *same* contract (`contracts.py`).

| contract | use it when your library... | clamp | precisions with a reference |
|---|---|---|---|
| `Spre` | takes a normalized query and docs already divided by their stored norms, and returns the max dot per query token (NumPy, PyTorch, maxsim-cpu) | `False` (or `True` if it clamps negatives to 0, like colbert-ai) | `f32`, `f16`, `bf16` |
| `S` | reads the index storage itself (int4 per token, min, scale, stored norm) and divides inside; clamps to 0. Only the sweet kernel does this | `True` | `int4` |
| `C` | computes the cosine itself, no clamp (NumKong) | `False` | `f32`, `f16`, `bf16` |
| `Spre-pad0` | zero-pads short docs, so short docs get `max(0, .)` (PyLate) | `False` | `f32` |

Most new arms are `Spre`, `clamp=False`, `precision='f32'`. The reference name is built by
`contracts.variant(contract, clamp, precision, 'a')`, for example `Spre-a-f32-noclamp`.
Only the combinations in `contracts.VARIANTS` exist. A new contract needs a new variant in
`contracts.py` (`VARIANTS`, `refs_for_call`, and a new `RULES` string so old caches rebuild).

## 4. Inputs and fixtures

What `build(call)` can read:

| name | what |
|---|---|
| `bench.rival_inputs(call, precision='f32')` | `(qn, docs)`. `qn`: `[nq, dim]` float32, L2-normalized. `docs`: list of `[nt, dim]` float32, dequantized and divided by `norm + 1e-8`. For `f16` / `bf16` the same values rounded to that type. **Use this for every `Spre` or `C` arm.** It is the only builder of rival inputs, and the reference (a) is computed from the same arrays |
| `bench.packed(docs)` | `(D, lens, offs)`: all doc tokens in one `[total, dim]` matrix, lengths, start offsets (for `np.maximum.reduceat`) |
| `bench.padded_repeat_last(docs)` | `[B, L, dim]`, short docs repeat their last token, so the max stays exact |
| `call["q"]`, `call["cands"][i]` | the raw storage: `raw` (uint8), `nt`, `mn`, `sc`, `nr` (per-token min, scale, stored norm). `S` arms read this directly |
| `bench.args.threads` | the `--threads` value (0 = library default). Honour it: set your library's thread limit in `build` |

Do not build your own normalized arrays for an `Spre` arm. If you do, your input differs
from the reference by rounding, and the error column stops meaning "implementation error".

**Fixtures.** `fixtures_contracts.py` runs every arm in `--list-arms` on hand-built edge
cases (negative best match, opposite vectors, unequal norms, a zero query token, constant
and zero doc tokens, ragged docs, dims 96 / 128 / 127) and compares with plain-Python
loops. Run it for your arm:

```bash
venv/bin/python -I fixtures_contracts.py --arms numpy_einsum
```

It prints pass, FAIL, "undefined input" (a zero query token makes `Spre` / `C` inputs NaN),
or "unsupported" (your library rejects the input, for example an odd dim) for each case.
It needs the arm to be in `bench.py` (see section 6). It does not need any data.

Edge cases to handle in your arm: docs with one token, dims that are not a multiple of 8,
and (in `packed`-style layouts) zero-token docs. The `reduceat` call in the example
returns a wrong value for a doc with zero tokens. Real calls have none.

## 5. A minimal new arm: NumPy einsum

This is `einsum_arm.py`. Copy it, change the function body, run it:

```python
import argparse, os, sys
import numpy as np

BENCH = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # eval/maxsim-bench
sys.path.insert(0, BENCH)
import bench   # module import: bench.args holds the defaults

@bench.arm('numpy_einsum', contract='Spre', clamp=False, precision='f32')
def np_einsum(call):
    qn, docs = bench.rival_inputs(call)        # untimed set-up
    D, lens, offs = bench.packed(docs)
    nq = qn.shape[0]

    def run():                                 # timed
        S = np.einsum('qd,td->qt', qn, D, optimize=True)     # [nq, total tokens]
        best = np.maximum.reduceat(S, offs, axis=1)          # [nq, n_docs]
        return best.sum(0, dtype=np.float64) / nq            # [n_docs]
    return run

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--set', required=True); ap.add_argument('--out', required=True)
    ap.add_argument('--limit', type=int, default=0); ap.add_argument('--reps', type=int, default=5)
    a = ap.parse_args()
    bench.args.arm, bench.args.set, bench.args.out = 'numpy_einsum', [a.set], a.out
    bench.args.limit, bench.args.reps = a.limit, a.reps
    bench.main()
```

Run it on a replay set (the quickstart writes a synthetic one; or use your own set):

```bash
venv/bin/python -I contracts.py --ensure <set-dir>        # once per set: reference cache
venv/bin/python -I examples/einsum_arm.py --set <set-dir> --out /tmp/einsum.json --limit 20
```

Output (real run, 20 calls of the agent development set, Apple M-series laptop):

```
numpy_einsum threads=default gap=0.0ms calls=20 p50=0.1263 ms total=2.4 ms max|err|=7.35e-08 top1_S=100.00%
```

`max|err|` of about `1e-7` against the `Spre` reference means the arm is correct.

## 6. Put the arm in your fork (to use `run_matrix.py`, fixtures and the shortlists)

`bench.py`, `run_matrix.py` and the other files in `eval/maxsim-bench/` are **frozen** in
the release (`FREEZE.json` holds their hashes). Do not change them in the release tree.
In your own fork:

1. Paste the decorated function into `bench.py`, before the `# ---- NumKong` line
   (keep `@arm('numpy_einsum')`; drop the `bench.` prefix on `rival_inputs` and `packed`).
2. Check it: `venv/bin/python -I bench.py --list-arms | grep numpy_einsum`.
3. Run the fixtures (section 4).
4. Run it in the matrix, one process per arm, two rounds, idle gate:

```bash
venv/bin/python -I run_matrix.py --machine mylaptop --tag mytest --set <set-dir> \
    --arm numpy_packed --arm numpy_einsum --arm numpy_einsum@1 --limit 50 --max-busy 15
```

   Arm spec: `name[@threads][%env]`. `@1` runs with one thread. `%mkl` runs the arm in
   `venv-mkl`.
5. `freeze_check.py FREEZE.json` now fails in your fork, because `bench.py` changed. That
   is correct. Re-freeze your fork (`freeze_check.py --write`, see its header) before you
   publish held-out numbers of your own.

## 7. Where results are written

- `bench.py --out FILE.json` writes one JSON file (atomically, with `complete: true`):
  `arm`, `contract`, `clamp`, `precision`, `ref_a`, `ref_b`, `env` (CPU, library versions,
  load), and `calls`. Each call record holds `set`, `repo`, `file`, `query_id`,
  `nq`, `pool`, `tokens`, `ms` (median), `ts_ns` (every timed repetition),
  `err` (max |score - reference (a)|, the implementation error), `err_input`
  (max |(a) - (b)|, the input rounding), `top1`, `top10` (agreement with (a)),
  `top1_S`, `top10_S` (agreement with the contract-`S` ranking). `--keep-scores` adds the scores.
- `run_matrix.py` writes `results/<machine>/<tag>/<group>/<arm>.r<round>.p<proc>.json`
  and `jobs.json`. A file is reused only if its job key matches.
- `summarize.py results/<machine> --mode dev` turns a results folder into tables.
  It refuses to run on an incomplete folder. `check_complete.py` checks completeness.

## 8. Rules that keep your numbers comparable

- Time on **development** data while you tune. Use held-out data only once, in aggregate.
  The rules are in the repository `CLAUDE.md` ("Benchmark Methodology").
- Give your library its **best case**: prepare layouts and dtypes in `build`, try thread
  counts, try its API variants. Report the fastest on the calls reported, as the paper does.
- One arm per process. Do not run two arms in one process.
