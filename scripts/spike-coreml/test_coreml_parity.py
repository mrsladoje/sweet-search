"""
Compare CoreML .mlpackage output vs candle Metal BF16 reference + PyTorch FP32 reference.

Pads the 10 reference inputs to the .mlpackage's fixed shape (batch=32 × seq=512)
and only checks the first 10 outputs. The padded rows / seq positions are masked
out by the mean-pool, so output for the first 10 rows is identical to running
them at native shape.

Tests the .mlpackage under three compute units (ALL, CPU_AND_NE, CPU_AND_GPU)
and prints per-unit cosines + per-batch latency. Determines whether ANE actually
runs and whether it preserves quality.
"""

import argparse
import json
import math
import sys
import time
from pathlib import Path

import numpy as np
import torch

from pytorch_nomic_bert import load_nomic_bert

HERE = Path(__file__).resolve().parent
REF_PATH = HERE / "candle_reference.json"
MODEL_DIR = Path.home() / ".cache" / "sweet-search" / "models" / "nomic-ai--CodeRankEmbed"
ARTIFACTS = HERE / "artifacts"


def cosine_np(a, b):
    a = a.astype(np.float64)
    b = np.asarray(b, dtype=np.float64)
    return float((a @ b) / (np.linalg.norm(a) * np.linalg.norm(b)))


def pad_inputs(input_ids, attention_mask, target_batch, target_seq):
    n = len(input_ids)
    src_seq = len(input_ids[0])
    if src_seq > target_seq:
        raise ValueError(f"src seq {src_seq} > target seq {target_seq}")
    if n > target_batch:
        raise ValueError(f"src batch {n} > target batch {target_batch}")

    ids = np.zeros((target_batch, target_seq), dtype=np.int32)
    mask = np.zeros((target_batch, target_seq), dtype=np.int32)
    for i in range(n):
        ids[i, :src_seq] = input_ids[i]
        mask[i, :src_seq] = attention_mask[i]
    return ids, mask, n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mlpackage", default=str(ARTIFACTS / "nomic_bert_b32_s512_fp16.mlpackage"))
    ap.add_argument("--bench-iters", type=int, default=10)
    ap.add_argument("--warmup", type=int, default=3)
    args = ap.parse_args()

    if not REF_PATH.exists():
        print(f"Missing {REF_PATH}", file=sys.stderr)
        sys.exit(2)
    ref = json.loads(REF_PATH.read_text())
    print(f"Reference device: {ref['device']}, batch={ref['batch_size']}, seq={ref['seq_len']}")

    # Load the .mlpackage with all three compute unit configs
    import coremltools as ct
    print(f"\nUsing {args.mlpackage}")

    # Parse target shape from filename or load and infer
    head = ct.models.MLModel(args.mlpackage)
    spec_inputs = head.get_spec().description.input
    in_ids_shape = list(spec_inputs[0].type.multiArrayType.shape)
    target_batch = int(in_ids_shape[0])
    target_seq = int(in_ids_shape[1])
    print(f"  .mlpackage input shape: batch={target_batch}, seq={target_seq}")

    ids_padded, mask_padded, n_real = pad_inputs(ref["input_ids"], ref["attention_mask"], target_batch, target_seq)
    print(f"  Padded {n_real} reference inputs to ({target_batch}, {target_seq})")

    # Also produce the PyTorch FP32 reference at the padded shape so we can
    # tell ML-vs-PyTorch drift from PyTorch-vs-candle drift.
    print("\nLoading PyTorch FP32 reference …")
    pt_model = load_nomic_bert(str(MODEL_DIR / "model.safetensors"), str(MODEL_DIR / "config.json"), device="cpu")
    pt_model = pt_model.to(torch.float32).eval()
    with torch.no_grad():
        pt_out = pt_model.encode(
            torch.tensor(ids_padded, dtype=torch.long),
            torch.tensor(mask_padded, dtype=torch.long),
        ).cpu().numpy()
    pt_ref = pt_out[:n_real]  # FP32 reference for the real inputs

    cu_map = {
        "ALL": ct.ComputeUnit.ALL,
        "CPU_AND_NE": ct.ComputeUnit.CPU_AND_NE,
        "CPU_AND_GPU": ct.ComputeUnit.CPU_AND_GPU,
        "CPU_ONLY": ct.ComputeUnit.CPU_ONLY,
    }

    results = {}
    for cu_name, cu in cu_map.items():
        print(f"\n=== Compute units: {cu_name} ===")
        try:
            t0 = time.perf_counter()
            mlmodel = ct.models.MLModel(args.mlpackage, compute_units=cu)
            print(f"  load: {time.perf_counter() - t0:.2f}s")
        except Exception as e:
            print(f"  load FAILED: {e}")
            continue

        # Warmup
        for _ in range(args.warmup):
            mlmodel.predict({"input_ids": ids_padded, "attention_mask": mask_padded})
        # Measure
        times = []
        for _ in range(args.bench_iters):
            t0 = time.perf_counter()
            out = mlmodel.predict({"input_ids": ids_padded, "attention_mask": mask_padded})
            times.append((time.perf_counter() - t0) * 1000.0)
        times.sort()
        p50 = times[len(times) // 2]
        p_min = times[0]
        emb = out["embeddings"][:n_real]

        candle_cos = [cosine_np(emb[i], ref["embeddings"][i]) for i in range(n_real)]
        pt_cos = [cosine_np(emb[i], pt_ref[i]) for i in range(n_real)]
        results[cu_name] = {
            "p50_ms": p50,
            "min_ms": p_min,
            "candle_min": min(candle_cos),
            "candle_mean": sum(candle_cos) / len(candle_cos),
            "pt_min": min(pt_cos),
            "pt_mean": sum(pt_cos) / len(pt_cos),
        }
        print(f"  latency:    p50={p50:7.1f}ms  min={p_min:7.1f}ms (over {args.bench_iters} iters at batch={target_batch}×seq={target_seq})")
        print(f"  vs candle BF16:  min={min(candle_cos):.6f}  mean={sum(candle_cos)/len(candle_cos):.6f}")
        print(f"  vs PyTorch FP32: min={min(pt_cos):.6f}  mean={sum(pt_cos)/len(pt_cos):.6f}")

    print("\n────────────────────────────────────────────────────────────────────────────")
    print(f"{'compute':<14} {'p50_ms':>10} {'min_ms':>10} {'candle_min':>12} {'pt_min':>10}")
    print("────────────────────────────────────────────────────────────────────────────")
    for k, v in results.items():
        print(f"{k:<14} {v['p50_ms']:>10.1f} {v['min_ms']:>10.1f} {v['candle_min']:>12.6f} {v['pt_min']:>10.6f}")
    print("────────────────────────────────────────────────────────────────────────────")
    print()
    print(f"Quality gate: candle_min ≥ 0.999 (PyTorch FP32 vs candle BF16 was 0.999672)")


if __name__ == "__main__":
    main()
