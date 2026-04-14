"""
Test the FP32 .mlpackage under each compute unit. FP32 forces off ANE per
Apple docs, so this should run on GPU+CPU. We want to know:
1. Does GPU FP32 produce correct outputs (unlike GPU FP16)?
2. Is GPU FP32 faster than the CPU_AND_NE FP16 path?
"""

import json
import sys
import time
from pathlib import Path

import numpy as np
import torch

from pytorch_nomic_bert import load_nomic_bert

HERE = Path(__file__).resolve().parent
ARTIFACTS = HERE / "artifacts"
MODEL_DIR = Path.home() / ".cache" / "sweet-search" / "models" / "nomic-ai--CodeRankEmbed"
REF_PATH = HERE / "candle_reference.json"


def cosine(a, b):
    a = a.astype(np.float64)
    b = np.asarray(b, dtype=np.float64)
    return float((a @ b) / (np.linalg.norm(a) * np.linalg.norm(b)))


def main():
    import coremltools as ct

    ref = json.loads(REF_PATH.read_text())
    n_real = ref["batch_size"]

    mlpkg = str(ARTIFACTS / "nomic_bert_b32_s512_fp32.mlpackage")

    # Build padded inputs to match the .mlpackage shape
    ids = np.zeros((32, 512), dtype=np.int32)
    mask = np.zeros((32, 512), dtype=np.int32)
    for i in range(n_real):
        src_seq = len(ref["input_ids"][i])
        ids[i, :src_seq] = ref["input_ids"][i]
        mask[i, :src_seq] = ref["attention_mask"][i]

    cu_map = {
        "ALL": ct.ComputeUnit.ALL,
        "CPU_AND_GPU": ct.ComputeUnit.CPU_AND_GPU,
        "CPU_ONLY": ct.ComputeUnit.CPU_ONLY,
    }

    # Random inputs for latency
    rng = np.random.default_rng(42)
    rand_ids = rng.integers(low=100, high=30000, size=(32, 512), dtype=np.int32)
    rand_mask = np.ones((32, 512), dtype=np.int32)

    print(f"=== Testing {Path(mlpkg).name} ===")
    print()
    for cu_name, cu in cu_map.items():
        print(f"--- {cu_name} ---")
        try:
            mlmodel = ct.models.MLModel(mlpkg, compute_units=cu)
        except Exception as e:
            print(f"  load FAILED: {e}")
            continue

        # Quality on padded reference
        out = mlmodel.predict({"input_ids": ids, "attention_mask": mask})
        emb = out["embeddings"][:n_real]
        cosines = [cosine(emb[i], ref["embeddings"][i]) for i in range(n_real)]
        print(f"  vs candle BF16: min={min(cosines):.6f}  mean={sum(cosines)/len(cosines):.6f}")

        # Latency on random
        for _ in range(5):
            mlmodel.predict({"input_ids": rand_ids, "attention_mask": rand_mask})
        times = []
        for _ in range(20):
            t0 = time.perf_counter()
            mlmodel.predict({"input_ids": rand_ids, "attention_mask": rand_mask})
            times.append((time.perf_counter() - t0) * 1000.0)
        times.sort()
        print(f"  latency: min={times[0]:.0f}ms p50={times[10]:.0f}ms max={times[-1]:.0f}ms (over 20 iters)")
        print()


if __name__ == "__main__":
    main()
