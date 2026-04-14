"""
Convert PyTorch NomicBERT to a CoreML .mlpackage via torch.jit.trace + coremltools.convert.

The trace is captured at a fixed shape (batch × seq) for stability — coremltools
handles fixed-shape conversion much more reliably than enumerated/dynamic shapes.
For the spike, we trace at the production batch size: batch=32, seq=512.

Outputs:
  artifacts/nomic_bert_b{B}_s{S}.mlpackage    — the compiled CoreML program
"""

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import torch

from pytorch_nomic_bert import load_nomic_bert

HERE = Path(__file__).resolve().parent
MODEL_DIR = Path.home() / ".cache" / "sweet-search" / "models" / "nomic-ai--CodeRankEmbed"
ARTIFACTS = HERE / "artifacts"


class TracedNomicBert(torch.nn.Module):
    """Wrapper exposing only (input_ids, attention_mask) → (B, hidden) for tracing.

    Mean-pool + L2-normalize are baked into the traced graph so the .mlpackage
    can be called as a single end-to-end embedding op, matching the napi
    interface contract (`embed_batch` returns L2-normalized vectors).
    """

    def __init__(self, model):
        super().__init__()
        self.model = model

    def forward(self, input_ids: torch.Tensor, attention_mask: torch.Tensor) -> torch.Tensor:
        hidden = self.model(input_ids, attention_mask, None)
        mask_f = attention_mask.to(hidden.dtype).unsqueeze(-1)
        summed = (hidden * mask_f).sum(dim=1)
        denom = mask_f.sum(dim=1).clamp_min(1e-9)
        pooled = summed / denom
        return torch.nn.functional.normalize(pooled, p=2, dim=-1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--seq", type=int, default=512)
    ap.add_argument("--precision", choices=["fp16", "fp32"], default="fp16")
    ap.add_argument("--compute-units", choices=["ALL", "CPU_AND_NE", "CPU_AND_GPU", "CPU_ONLY"], default="ALL")
    args = ap.parse_args()

    ARTIFACTS.mkdir(exist_ok=True)
    out_name = f"nomic_bert_b{args.batch}_s{args.seq}_{args.precision}.mlpackage"
    out_path = ARTIFACTS / out_name

    print(f"=== Converting NomicBERT → CoreML ===")
    print(f"  batch={args.batch}, seq={args.seq}, precision={args.precision}, compute={args.compute_units}")

    print("Loading PyTorch model …")
    model = load_nomic_bert(
        str(MODEL_DIR / "model.safetensors"),
        str(MODEL_DIR / "config.json"),
        device="cpu",
    )
    model = model.to(torch.float32).eval()
    wrapped = TracedNomicBert(model).eval()

    # Sample inputs for the trace. The actual values don't matter, only shapes
    # and dtypes; coremltools infers the graph from the trace, not the values.
    sample_ids = torch.zeros(args.batch, args.seq, dtype=torch.int32)
    sample_mask = torch.ones(args.batch, args.seq, dtype=torch.int32)

    print("Tracing (this is the slow part — full forward pass at trace shape) …")
    t0 = time.perf_counter()
    with torch.no_grad():
        traced = torch.jit.trace(wrapped, (sample_ids.long(), sample_mask.long()), strict=False)
    print(f"  traced in {time.perf_counter() - t0:.1f}s")

    # Verify the trace runs.
    print("Sanity check trace …")
    with torch.no_grad():
        out_eager = wrapped(sample_ids.long(), sample_mask.long())
        out_traced = traced(sample_ids.long(), sample_mask.long())
    diff = (out_eager - out_traced).abs().max().item()
    print(f"  trace eager-vs-traced max abs diff: {diff:.3e}")

    print("Importing coremltools …")
    import coremltools as ct
    print(f"  coremltools {ct.__version__}")

    precision_map = {
        "fp16": ct.precision.FLOAT16,
        "fp32": ct.precision.FLOAT32,
    }
    cu_map = {
        "ALL": ct.ComputeUnit.ALL,
        "CPU_AND_NE": ct.ComputeUnit.CPU_AND_NE,
        "CPU_AND_GPU": ct.ComputeUnit.CPU_AND_GPU,
        "CPU_ONLY": ct.ComputeUnit.CPU_ONLY,
    }

    print(f"Converting → {out_name} (this is the slow part — graph compilation) …")
    t0 = time.perf_counter()
    mlmodel = ct.convert(
        traced,
        inputs=[
            ct.TensorType(name="input_ids", shape=sample_ids.shape, dtype=np.int32),
            ct.TensorType(name="attention_mask", shape=sample_mask.shape, dtype=np.int32),
        ],
        outputs=[ct.TensorType(name="embeddings", dtype=np.float32)],
        convert_to="mlprogram",
        compute_precision=precision_map[args.precision],
        compute_units=cu_map[args.compute_units],
        minimum_deployment_target=ct.target.macOS14,
    )
    print(f"  converted in {time.perf_counter() - t0:.1f}s")

    if out_path.exists():
        import shutil
        shutil.rmtree(out_path)
    mlmodel.save(str(out_path))
    print(f"Saved {out_path}")


if __name__ == "__main__":
    main()
