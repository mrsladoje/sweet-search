"""
Compare the PyTorch ModernBERT LI port vs candle Metal BF16 reference.

Reads candle_li_reference.json (produced by dump_candle_li_reference.js),
runs the same input_ids + attention_mask through the PyTorch port at FP32
on CPU, and reports per-token cosine similarity.

The FP32 PyTorch output vs candle BF16 reference should match at ≥0.999
per-token mean cosine — any significant drop means a bug in the port.
"""

import json
import sys
from pathlib import Path

import torch

from pytorch_modernbert import load_modernbert_li


HERE = Path(__file__).resolve().parent
REF_PATH = HERE / "candle_li_reference.json"
MODEL_DIR = Path.home() / ".cache" / "sweet-search" / "models" / "lightonai--LateOn-Code"


def cosine(a: list[float], b: list[float]) -> float:
    ta = torch.as_tensor(a, dtype=torch.float64)
    tb = torch.as_tensor(b, dtype=torch.float64)
    return (ta @ tb / (ta.norm() * tb.norm())).item()


def main():
    if not REF_PATH.exists():
        print(f"Missing {REF_PATH}. Run: node scripts/spike-coreml/dump_candle_li_reference.js", file=sys.stderr)
        sys.exit(2)

    ref = json.loads(REF_PATH.read_text())
    print(f"Reference device={ref['device']}  batch={ref['batch_size']}  seq={ref['seq_len']}  dim={ref['dim']}")
    print(f"Token counts: {ref['token_counts']}  (total active: {sum(ref['token_counts'])})")

    device = "cpu"  # FP32 PyTorch on CPU as the reference
    print(f"\nLoading PyTorch ModernBertLI on {device} …")
    model = load_modernbert_li(
        backbone_safetensors=str(MODEL_DIR / "model.safetensors"),
        projection_safetensors=str(MODEL_DIR / "1_Dense" / "model.safetensors"),
        config_json=str(MODEL_DIR / "config.json"),
        device=device,
    )
    model = model.to(torch.float32).eval()

    input_ids = torch.tensor(ref["input_ids"], dtype=torch.long, device=device)
    attn_mask = torch.tensor(ref["attention_mask"], dtype=torch.long, device=device)
    print(f"PyTorch input shape: {input_ids.shape}")

    with torch.no_grad():
        out = model(input_ids, attn_mask).cpu().numpy()
    print(f"PyTorch output shape: {out.shape}")

    # The reference is a flat array laid out as
    #   [batch_0 active_0 × dim, batch_0 active_1 × dim, ..., batch_1 active_0 × dim, ...]
    # Walk the same layout and compare per-token cosine.
    token_counts = ref["token_counts"]
    flat = ref["vectors_flat"]
    dim = ref["dim"]

    print()
    print("─" * 90)
    print(f"{'#':>3}  {'batch':>5}  {'tok':>4}  {'cosine':>10}  input preview")
    print("─" * 90)

    per_batch_stats = []
    overall_min = 1.0
    overall_max = 0.0
    overall_sum = 0.0
    overall_count = 0

    offset = 0
    for b, count in enumerate(token_counts):
        per_token_cos = []
        for t in range(count):
            ref_vec = flat[offset + t * dim : offset + (t + 1) * dim]
            pt_vec = out[b, t].tolist()
            c = cosine(pt_vec, ref_vec)
            per_token_cos.append(c)
            overall_min = min(overall_min, c)
            overall_max = max(overall_max, c)
            overall_sum += c
            overall_count += 1
        offset += count * dim

        if per_token_cos:
            mean = sum(per_token_cos) / len(per_token_cos)
            mn = min(per_token_cos)
            flag = "PASS" if mn >= 0.999 else ("WARN" if mn >= 0.99 else "FAIL")
            preview = ref["inputs"][b][:60].replace("\n", "\\n")
            per_batch_stats.append((b, count, mean, mn, flag, preview))
            print(f"{b:>3}  {count:>5}  {'all':>4}  mean={mean:.6f} min={mn:.6f} [{flag}]  {preview}")

    mean_overall = overall_sum / overall_count
    print("─" * 90)
    print(f"\nPer-token cosine — min: {overall_min:.6f}  max: {overall_max:.6f}  mean: {mean_overall:.6f}  (across {overall_count} tokens)")

    # Accept thresholds:
    #   mean ≥ 0.9995  (tight: structural correctness requires this)
    #   min  ≥ 0.998   (loose: individual tokens can drift by ~1e-3 from BF16
    #                   accumulation-order differences between PyTorch's BF16
    #                   path and candle's Metal SDPA kernels, even when both
    #                   are run at BF16. Empirically verified via a separate
    #                   BF16-vs-BF16 comparison that showed identical drift.)
    min_threshold = 0.998
    mean_threshold = 0.9995
    ok = overall_min >= min_threshold and mean_overall >= mean_threshold
    if ok:
        print(f"\nPASS — min {overall_min:.6f} ≥ {min_threshold}, mean {mean_overall:.6f} ≥ {mean_threshold}")
        print("      (tokens within BF16 accumulation-order noise; retrieval-irrelevant)")
        sys.exit(0)
    else:
        print(f"\nFAIL — min {overall_min:.6f} (threshold {min_threshold}), mean {mean_overall:.6f} (threshold {mean_threshold})")
        print("\nPotential causes:")
        print("  - RoPE convention mismatch (interleaved vs non-interleaved)")
        print("  - Mask value mismatch (-1e4 vs -inf vs other)")
        print("  - Layer 0 attn_norm handling")
        print("  - Local attention window sizing (128 full vs 64 half)")
        print("  - GeGLU activation order (gelu(gate) * up vs gelu(up) * gate)")
        print("  - Projection weight layout (transpose mismatch)")
        sys.exit(1)


if __name__ == "__main__":
    main()
