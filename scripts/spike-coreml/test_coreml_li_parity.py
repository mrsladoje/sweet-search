"""
Compare CoreML LI .mlpackage output vs candle Metal BF16 reference AND vs
PyTorch FP32 reference. Tests all 4 compute-unit configurations to catch
the same GPU-path correctness gotcha we hit with NomicBERT embedding.

Workload: the 10-input candle_li_reference.json (420 active tokens).
Padded to the mlpackage's fixed shape (b32 × s512 by default).
"""

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import torch

from pytorch_modernbert import load_modernbert_li

HERE = Path(__file__).resolve().parent
REF_PATH = HERE / "candle_li_reference.json"
ARTIFACTS = HERE / "artifacts"
MODEL_DIR = Path.home() / ".cache" / "sweet-search" / "models" / "lightonai--LateOn-Code"


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


def compare_batches(name, out, ref, token_counts):
    """out: ndarray [B, S, 128]. ref: flat list of (sum_active * 128) floats. token_counts per batch."""
    dim = 128
    flat = ref
    offset = 0
    mn = 1.0
    sm = 0.0
    cnt = 0
    per_batch_min = []
    for b, count in enumerate(token_counts):
        bmn = 1.0
        for t in range(count):
            rv = flat[offset + t * dim : offset + (t + 1) * dim]
            ov = out[b, t]
            c = cosine_np(ov, rv)
            mn = min(mn, c)
            bmn = min(bmn, c)
            sm += c
            cnt += 1
        offset += count * dim
        per_batch_min.append(bmn)
    mean = sm / cnt
    print(f"  {name}:  min={mn:.6f}  mean={mean:.6f}  across {cnt} tokens")
    return mn, mean


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mlpackage", default=str(ARTIFACTS / "li_modernbert_b32_s512_fp16.mlpackage"))
    ap.add_argument("--bench-iters", type=int, default=6)
    ap.add_argument("--warmup", type=int, default=2)
    args = ap.parse_args()

    if not REF_PATH.exists():
        print(f"Missing {REF_PATH}", file=sys.stderr)
        sys.exit(2)
    ref = json.loads(REF_PATH.read_text())
    print(f"Reference: device={ref['device']}, batch={ref['batch_size']}, seq={ref['seq_len']}, "
          f"{sum(ref['token_counts'])} active tokens")

    import coremltools as ct
    print(f"Using {args.mlpackage}")

    head = ct.models.MLModel(args.mlpackage)
    in_shape = list(head.get_spec().description.input[0].type.multiArrayType.shape)
    target_batch, target_seq = int(in_shape[0]), int(in_shape[1])
    print(f"  mlpackage shape: batch={target_batch}, seq={target_seq}")

    ids_p, mask_p, n_real = pad_inputs(ref["input_ids"], ref["attention_mask"], target_batch, target_seq)
    print(f"  Padded {n_real} reference inputs to ({target_batch}, {target_seq})")

    # PyTorch FP32 reference at the padded shape for a ground-truth comparison
    print("\nComputing PyTorch FP32 reference at padded shape …")
    pt_model = load_modernbert_li(
        backbone_safetensors=str(MODEL_DIR / "model.safetensors"),
        projection_safetensors=str(MODEL_DIR / "1_Dense" / "model.safetensors"),
        config_json=str(MODEL_DIR / "config.json"),
        device="cpu",
    )
    pt_model = pt_model.to(torch.float32).eval()
    with torch.no_grad():
        pt_out = pt_model(
            torch.tensor(ids_p, dtype=torch.long),
            torch.tensor(mask_p, dtype=torch.long),
        ).cpu().numpy()

    # Build a PyTorch reference flat array laid out exactly like candle's ref:
    pt_flat = []
    for b, count in enumerate(ref["token_counts"]):
        for t in range(count):
            pt_flat.extend(pt_out[b, t].tolist())

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
            mlmodel.predict({"input_ids": ids_p, "attention_mask": mask_p})
        # Timed run
        times = []
        last_out = None
        for _ in range(args.bench_iters):
            t0 = time.perf_counter()
            last_out = mlmodel.predict({"input_ids": ids_p, "attention_mask": mask_p})
            times.append((time.perf_counter() - t0) * 1000.0)
        times.sort()
        p50 = times[len(times) // 2]
        p_min = times[0]
        out = last_out["token_vectors"]  # shape (target_batch, target_seq, 128)

        candle_min, candle_mean = compare_batches(
            "vs candle BF16 ", out, ref["vectors_flat"], ref["token_counts"]
        )
        pt_min, pt_mean = compare_batches(
            "vs PyTorch FP32", out, pt_flat, ref["token_counts"]
        )

        results[cu_name] = {
            "p50_ms": p50,
            "min_ms": p_min,
            "candle_min": candle_min,
            "candle_mean": candle_mean,
            "pt_min": pt_min,
            "pt_mean": pt_mean,
        }
        print(f"  latency: p50={p50:7.1f}ms  min={p_min:7.1f}ms  over {args.bench_iters} iters at b{target_batch}×s{target_seq}")

    print("\n──────────────────────────────────────────────────────────────────────────────")
    print(f"{'compute':<14} {'p50_ms':>10} {'min_ms':>10} {'cand_min':>10} {'cand_mean':>11} {'pt_min':>9}")
    print("──────────────────────────────────────────────────────────────────────────────")
    for k, v in results.items():
        print(f"{k:<14} {v['p50_ms']:>10.1f} {v['min_ms']:>10.1f} "
              f"{v['candle_min']:>10.6f} {v['candle_mean']:>11.6f} {v['pt_min']:>9.6f}")
    print("──────────────────────────────────────────────────────────────────────────────")
    print()
    print("Quality gate: candle_min ≥ 0.998, candle_mean ≥ 0.9995")
    print("(matches the PyTorch port's parity thresholds — BF16 accumulation noise floor)")


if __name__ == "__main__":
    main()
