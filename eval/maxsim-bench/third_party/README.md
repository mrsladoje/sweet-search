# Third-party code used by the MaxSim benchmark

- `segmented_maxsim.cpp`: colbert-ai's CPU segmented max (used after one packed GEMM by
  `colbert_score_packed`), unchanged, from
  https://github.com/stanford-futuredata/ColBERT/blob/cc4f3dc91c0b45d2d08c251d9d95178285c65f1c/colbert/modeling/segmented_maxsim.cpp
  (MIT, see `LICENSE.colbert`). `bench.py` builds it with `torch.utils.cpp_extension.load(..., extra_cflags=['-O3'])`,
  as colbert-ai does.
