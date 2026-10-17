# LIRK-Bench: small reproduction example

## What the benchmark is

LIRK-Bench times CPU kernels that score a query against candidate documents with late
interaction (MaxSim, as in ColBERT). Every implementation ("arm") must meet a written
scoring contract, and each of its scores is checked against a float64 reference of that
contract. The benchmark replays real calls captured from a production search path,
and it publishes numbers from held-out data only.

This folder shows how to run a small, quick check on your own machine, and how to add an
implementation. The full benchmark is in the parent folder: [README](../README.md),
[RESULTS](../RESULTS.md), and the paper in [`../paper/`](../paper/).

## Quickstart (a few seconds to a few minutes)

From a fresh clone:

```bash
cd eval/maxsim-bench
uv venv --python 3.12 venv
# macOS on Apple silicon:
VIRTUAL_ENV=$PWD/venv uv pip install --require-hashes -r requirements-macos-arm64.lock
# Linux x86_64 (CPU wheels of torch):
#   VIRTUAL_ENV=$PWD/venv uv pip install --require-hashes -r requirements-linux-x86_64.lock \
#       --extra-index-url https://download.pytorch.org/whl/cpu --index-strategy unsafe-best-match
# Linux aarch64: use requirements-linux-aarch64.lock the same way.

# optional: the sweet kernel (`ours`). Needs a Rust toolchain; without it the arm is skipped.
(cd capi && cargo build --release)

venv/bin/python -I examples/quickstart.py --limit 20
```

The script:

1. writes a small synthetic replay set (seed 42), or reads a set you give with `--set DIR`;
2. builds the contract references (`contracts.py --ensure`);
3. runs three arms, each in its own process, on the first `--limit` calls:
   `ours` (the sweet kernel, contract `S`), `numpy_packed` and `torch_pad_bmm` (contract `Spre`);
4. checks every arm against the float64 reference of its contract and prints a table.

Real output (Apple M-series laptop, synthetic set, 20 calls, about 2 s in total):

```
arm            contract  p50 ms  mean ms  max err  top-1  check
-------------  --------  ------  -------  -------  -----  -----
ours           S+clamp   0.057   0.074    6.5e-08  100%   PASS
numpy_packed   Spre      0.126   0.152    4.0e-08  100%   PASS
torch_pad_bmm  Spre      0.531   0.549    4.0e-08  100%   PASS
```

`max err` is the largest difference between an arm's score and the reference. `PASS` means
it is within the bound for its input precision (`2e-6` for int4 and f32). `top-1` is how
often the arm picks the same best candidate as the reference.

**These timings are not benchmark results.** The synthetic set is not the real workload,
the machine is not gated for idle load, and there is one round. Published numbers use
held-out replay sets, an idle gate, two rounds in opposite order, and one process per arm.
Other options: `--arms a,b,c` (any name from `bench.py --list-arms`), `--reps N`,
`--work DIR`. To use a real set, pass `--set <dir>`. Use a development set, not a held-out
set, while you tune (see `CLAUDE.md`, "Benchmark Methodology").

## Add your own implementation

See [ADDING_AN_IMPLEMENTATION.md](ADDING_AN_IMPLEMENTATION.md). It has a working example
(`einsum_arm.py`) that needs no change to the frozen files.

## Replay format (summary)

A replay set is a folder. Each subfolder is a "repo" (a group of calls). `replay_py.load_set`
reads it. Writer: `hook.mjs`. Example writer in Python: `quickstart.py` (`synthetic_set`).

- `<repo>/index-*.jsonl`: one JSON line per call:
  `{"file": "x.bin", "kind": "int4", "numQ": 10, "dim": 128, "cands": [{"nt": 246, "dim": 128, "tb": 15744}, ...], "scores": [...]}`.
  `kind` is `int4` or `int8`. `nt` is the token count of a candidate. `tb` is its byte size.
  `scores` are the scores the production path returned (stored; the benchmark does not use them).
- `<repo>/x.bin`, little-endian:
  the raw query as float32 `[numQ, dim]`; then, for each candidate in order,
  `tb` bytes of quantized tokens (int4: `nt` rows of `ceil(dim/2)` bytes, even dim in the low
  nibble; int8: `nt` rows of `dim` bytes, value minus 128), then `nt` float32 min,
  `nt` float32 scale, `nt` float32 stored norm (the norm before quantization).
  A decoded value is `code * scale + min`.
- Optional: `<repo>/provenance.jsonl` (query id and hash per call), `EXCLUDE.json` (calls to
  leave out), `MANIFEST.sha256` (written by `set_manifest.py`), `refs-v2/` (reference cache,
  written by `contracts.py --ensure`).

The scoring contracts (`S`, `Spre`, `C`, `Spre-pad0`) are defined at the top of `contracts.py`.

## Links

- Repository: https://github.com/mrsladoje/sweet-search (benchmark in `eval/maxsim-bench/`)
- Benchmark README: [../README.md](../README.md). Results: [../RESULTS.md](../RESULTS.md).
- Paper sources and analysis code: [../paper/](../paper/). Citation file: [../paper/CITATION.cff](../paper/CITATION.cff).
- Data and code release (Zenodo): DOI TODO.
- Paper (arXiv): TODO.

## How to cite

```bibtex
@misc{lirkbench2026,
  title        = {{LIRK-Bench}: A Contract-Checked Benchmark of {CPU} Late-Interaction Reranking Kernels},
  author       = {TODO},
  year         = {2026},
  eprint       = {TODO},
  archivePrefix = {arXiv},
  primaryClass = {cs.IR},
  doi          = {TODO},
  note         = {Code and data: Zenodo, DOI TODO. Repository: https://github.com/mrsladoje/sweet-search}
}
```

`primaryClass` is a guess; the owner sets it with the arXiv submission.

## Proposed repo-root `CITATION.cff`

For the owner to place at the repository root (`CITATION.cff`). GitHub then shows a
"Cite this repository" button. This text cites the repository and names the paper as the
preferred citation. The file `../paper/CITATION.cff` is the benchmark-only variant
(title LIRK-Bench). Fill the TODO fields at release. Fields with no value yet are
comments, because `doi` and dates must be valid values for the CFF validator.

```yaml
cff-version: 1.2.0
message: "If you use this software or the LIRK-Bench benchmark, please cite the paper below."
type: software
title: "sweet-search"
abstract: "Local code search. The folder eval/maxsim-bench holds LIRK-Bench, a contract-checked benchmark of CPU late-interaction reranking kernels."
authors:
  - family-names: "TODO"
    given-names: "TODO"
repository-code: "https://github.com/mrsladoje/sweet-search"
license: Apache-2.0
# version: TODO
# date-released: TODO   (YYYY-MM-DD)
# doi: TODO             (Zenodo DOI of the release)
preferred-citation:
  type: article
  title: "LIRK-Bench: A Contract-Checked Benchmark of CPU Late-Interaction Reranking Kernels"
  authors:
    - family-names: "TODO"
      given-names: "TODO"
  journal: "arXiv preprint"
  year: 2026
  notes: "TODO: arXiv identifier and Zenodo DOI"
```

## Files in this folder

| file | what |
|---|---|
| `quickstart.py` | the three-arm check described above |
| `einsum_arm.py` | a new arm (NumPy einsum) that runs without editing `bench.py` |
| `ADDING_AN_IMPLEMENTATION.md` | how to add an arm |
