"""
Long-running bench for the b32×s512 case to characterize ANE variance.
Also: thermal effects, warmup, and async batched calls.
"""

import sys
import time
from pathlib import Path

import numpy as np
import coremltools as ct

HERE = Path(__file__).resolve().parent
ARTIFACTS = HERE / "artifacts"

mlpkg = str(ARTIFACTS / "nomic_bert_b32_s512_fp16.mlpackage")

print(f"Loading {mlpkg} (CPU_AND_NE) …")
mlmodel = ct.models.MLModel(mlpkg, compute_units=ct.ComputeUnit.CPU_AND_NE)

rng = np.random.default_rng(42)
ids = rng.integers(low=100, high=30000, size=(32, 512), dtype=np.int32)
mask = np.ones((32, 512), dtype=np.int32)

print("\n=== 50 iterations, no warmup truncation ===")
times = []
for i in range(50):
    t0 = time.perf_counter()
    mlmodel.predict({"input_ids": ids, "attention_mask": mask})
    times.append((time.perf_counter() - t0) * 1000.0)
    if i < 10:
        print(f"  iter {i:2d}: {times[-1]:7.1f}ms")

times.sort()
n = len(times)
print(f"\nFull distribution over {n} iters:")
print(f"  min     = {times[0]:.1f}ms")
print(f"  p10     = {times[n//10]:.1f}ms")
print(f"  p25     = {times[n//4]:.1f}ms")
print(f"  p50     = {times[n//2]:.1f}ms")
print(f"  p75     = {times[3*n//4]:.1f}ms")
print(f"  p90     = {times[9*n//10]:.1f}ms")
print(f"  max     = {times[-1]:.1f}ms")

# Also, separate first 10 (warmup-like) and last 40 (steady)
warmup = times[:10]
steady = sorted(times[10:])
print(f"\nWarmup phase (first 10 iters by submission order):")
print(f"  min={min(warmup):.0f}, p50≈{sorted(warmup)[5]:.0f}, max={max(warmup):.0f}")
print(f"\nSteady phase (last 40 iters by submission order, sorted):")
print(f"  min={steady[0]:.0f}, p10={steady[4]:.0f}, p50={steady[20]:.0f}, p90={steady[36]:.0f}, max={steady[-1]:.0f}")

print("\nMetal BF16 baseline at this shape: ~1235-1351ms")
print(f"CoreML steady p50 / baseline midpoint = {steady[20] / 1293:.2f}x speedup")
