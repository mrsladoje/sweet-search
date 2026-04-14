"""
Bench a single shape with a long warmup. Use one shape per Python process to
avoid cross-shape thermal contamination.

Usage: python bench_one_shape.py <batch> <seq>
"""

import sys
import time
from pathlib import Path

import numpy as np
import coremltools as ct

HERE = Path(__file__).resolve().parent
ARTIFACTS = HERE / "artifacts"

batch = int(sys.argv[1])
seq = int(sys.argv[2])
mlpkg = str(ARTIFACTS / f"nomic_bert_b{batch}_s{seq}_fp16.mlpackage")
print(f"Loading {Path(mlpkg).name} (CPU_AND_NE) …")
mlmodel = ct.models.MLModel(mlpkg, compute_units=ct.ComputeUnit.CPU_AND_NE)

rng = np.random.default_rng(42)
ids = rng.integers(low=100, high=30000, size=(batch, seq), dtype=np.int32)
mask = np.ones((batch, seq), dtype=np.int32)

# Warm up generously
for _ in range(10):
    mlmodel.predict({"input_ids": ids, "attention_mask": mask})

times = []
for _ in range(40):
    t0 = time.perf_counter()
    mlmodel.predict({"input_ids": ids, "attention_mask": mask})
    times.append((time.perf_counter() - t0) * 1000.0)

times.sort()
n = len(times)
p50 = times[n // 2]
p_min = times[0]
p_max = times[-1]
print(f"  shape b{batch}×s{seq}  n={n}  min={p_min:.0f}ms  p50={p50:.0f}ms  max={p_max:.0f}ms")
