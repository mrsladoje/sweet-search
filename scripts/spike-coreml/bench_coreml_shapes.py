"""
Benchmark CoreML NomicBERT at multiple production shapes (CPU_AND_NE only).

Production batcher uses 16384-token batches:
  batch=128 × seq=128
  batch=64  × seq=256
  batch=32  × seq=512   (the dominant case for long code chunks)

For each shape, converts a .mlpackage if missing, then measures p50 latency
under truly random (not padded) inputs. Compares against the Metal BF16
baseline numbers measured by tests/diagnose-metal-seqlen.js.
"""

import shutil
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ARTIFACTS = HERE / "artifacts"
ARTIFACTS.mkdir(exist_ok=True)

SHAPES = [
    (32, 512),
    (64, 256),
    (128, 128),
]

BASELINE_MS = {
    (32, 512): 1351.0,  # from diagnose-metal-seqlen.js production config
    (64, 256): 1322.0,
    (128, 128): 1304.0,
}


def ensure_mlpackage(batch, seq):
    out = ARTIFACTS / f"nomic_bert_b{batch}_s{seq}_fp16.mlpackage"
    if out.exists():
        return out
    print(f"[convert] batch={batch} seq={seq} …")
    r = subprocess.run(
        [sys.executable, str(HERE / "convert_to_coreml.py"),
         "--batch", str(batch), "--seq", str(seq), "--precision", "fp16",
         "--compute-units", "ALL"],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        print(r.stdout)
        print(r.stderr)
        raise RuntimeError(f"convert failed for {batch}×{seq}")
    return out


def main():
    import coremltools as ct

    print(f"=== CoreML benchmark vs Metal BF16 baseline ===")
    print(f"All measurements: 3 warmup + 12 iters, p50 reported")
    print()

    rng = np.random.default_rng(42)

    rows = []
    for batch, seq in SHAPES:
        mlpkg = ensure_mlpackage(batch, seq)
        # Use the only viable compute unit (the others either break quality
        # or fall off ANE; see test_coreml_parity.py).
        mlmodel = ct.models.MLModel(str(mlpkg), compute_units=ct.ComputeUnit.CPU_AND_NE)

        # Real-ish random tokens spanning the vocab; full attention (no padding)
        ids = rng.integers(low=100, high=30000, size=(batch, seq), dtype=np.int32)
        mask = np.ones((batch, seq), dtype=np.int32)

        for _ in range(3):
            mlmodel.predict({"input_ids": ids, "attention_mask": mask})

        times = []
        for _ in range(12):
            t0 = time.perf_counter()
            mlmodel.predict({"input_ids": ids, "attention_mask": mask})
            times.append((time.perf_counter() - t0) * 1000.0)
        times.sort()
        p50 = times[6]
        p_min = times[0]
        p_max = times[-1]

        baseline = BASELINE_MS[(batch, seq)]
        speedup = baseline / p50
        rows.append((batch, seq, p_min, p50, p_max, baseline, speedup))
        print(f"  batch={batch:>3} × seq={seq:>4}  p50={p50:7.1f}ms  min={p_min:7.1f}ms  max={p_max:7.1f}ms   baseline={baseline:.0f}ms   speedup={speedup:.2f}×")

    print()
    print("──────────────────────────────────────────────────────────────────────────")
    print(f"{'shape':<14} {'min_ms':>8} {'p50_ms':>8} {'max_ms':>8} {'baseline':>10} {'speedup':>8}")
    print("──────────────────────────────────────────────────────────────────────────")
    for batch, seq, mn, p50, mx, base, sp in rows:
        print(f"b{batch}×s{seq:<10} {mn:>8.1f} {p50:>8.1f} {mx:>8.1f} {base:>10.0f} {sp:>8.2f}×")
    print("──────────────────────────────────────────────────────────────────────────")
    print()
    print("Decision criteria (Day 3): quality ≥ 0.999 (already shown) AND latency ≥ 1.3× speedup")


if __name__ == "__main__":
    main()
