"""
Convert ModernBERT LI (backbone + projection + L2-normalise) to a CoreML
.mlpackage via torch.jit.trace + coremltools.convert.

Same fixed-shape strategy as convert_to_coreml.py for embedding: the
trace is captured at a fixed (batch, seq) shape because coremltools
handles fixed-shape conversion much more reliably than dynamic / enumerated.
Produces `artifacts/li_modernbert_b{B}_s{S}_{precision}.mlpackage`.

The forward pass is the full ModernBertLI wrapper:
  input_ids, attention_mask
    → ModernBERT backbone (22 layers, sliding-window local attention)
    → 768 → 128 projection
    → L2 normalise per token
    → Float32 output [batch, seq, 128]

Risk points for this conversion (unknown until attempted):
  1. Sliding-window local attention mask — we build it at each forward
     as a torch.where on distance; coremltools' PyTorch converter may or
     may not trace that cleanly.
  2. Dual RoPE (global + local) — two sets of precomputed cos/sin tables
     selected per layer based on uses_local_attention. The Python-side
     layer-id branching is resolved at trace time (trace will only see
     the concrete path for the specific layer_id), so this should work.
  3. Layer 0 has no attn_norm (Optional[LayerNorm]). TorchScript trace
     might not like an optional field; if so, we'll convert per-layer or
     rewrite to a single attn_norm with identity for layer 0.
"""

import argparse
import sys
import time
from pathlib import Path

import numpy as np
import torch

from pytorch_modernbert import load_modernbert_li

HERE = Path(__file__).resolve().parent
MODEL_DIR = Path.home() / ".cache" / "sweet-search" / "models" / "lightonai--LateOn-Code"
ARTIFACTS = HERE / "artifacts"


class TracedModernBertLI(torch.nn.Module):
    """Thin wrapper exposing only (input_ids, attention_mask) → Float32 [B, S, 128]
    so the trace captures a single forward and coremltools sees a clean
    input/output contract.
    """

    def __init__(self, model):
        super().__init__()
        self.model = model

    def forward(self, input_ids: torch.Tensor, attention_mask: torch.Tensor) -> torch.Tensor:
        return self.model(input_ids, attention_mask)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--seq", type=int, default=512)
    ap.add_argument("--precision", choices=["fp16", "fp32"], default="fp16")
    ap.add_argument(
        "--compute-units",
        choices=["ALL", "CPU_AND_NE", "CPU_AND_GPU", "CPU_ONLY"],
        default="ALL",
    )
    args = ap.parse_args()

    ARTIFACTS.mkdir(exist_ok=True)
    out_name = f"li_modernbert_b{args.batch}_s{args.seq}_{args.precision}.mlpackage"
    out_path = ARTIFACTS / out_name

    print(f"=== Converting ModernBERT LI → CoreML ===")
    print(f"  batch={args.batch}  seq={args.seq}  precision={args.precision}  compute={args.compute_units}")

    print("Loading PyTorch ModernBertLI …")
    model = load_modernbert_li(
        backbone_safetensors=str(MODEL_DIR / "model.safetensors"),
        projection_safetensors=str(MODEL_DIR / "1_Dense" / "model.safetensors"),
        config_json=str(MODEL_DIR / "config.json"),
        device="cpu",
    )
    model = model.to(torch.float32).eval()
    wrapped = TracedModernBertLI(model).eval()

    # Sample inputs for the trace. Values don't matter — shapes/dtypes do.
    sample_ids = torch.zeros(args.batch, args.seq, dtype=torch.long)
    sample_mask = torch.ones(args.batch, args.seq, dtype=torch.long)

    print("Tracing (this runs a full 22-layer forward pass at the trace shape) …")
    t0 = time.perf_counter()
    with torch.no_grad():
        traced = torch.jit.trace(wrapped, (sample_ids, sample_mask), strict=False)
    print(f"  traced in {time.perf_counter() - t0:.1f}s")

    # Sanity-check the trace produces the same output as eager mode.
    print("Sanity check trace (eager vs traced) …")
    with torch.no_grad():
        out_eager = wrapped(sample_ids, sample_mask)
        out_traced = traced(sample_ids, sample_mask)
    diff = (out_eager - out_traced).abs().max().item()
    print(f"  max abs diff: {diff:.3e}")
    assert diff < 1e-4, f"Eager/traced diverge ({diff}); trace is incorrect"

    print("Importing coremltools …")
    import coremltools as ct
    print(f"  coremltools {ct.__version__}")

    precision_map = {"fp16": ct.precision.FLOAT16, "fp32": ct.precision.FLOAT32}
    cu_map = {
        "ALL": ct.ComputeUnit.ALL,
        "CPU_AND_NE": ct.ComputeUnit.CPU_AND_NE,
        "CPU_AND_GPU": ct.ComputeUnit.CPU_AND_GPU,
        "CPU_ONLY": ct.ComputeUnit.CPU_ONLY,
    }

    print(f"Converting → {out_name} (graph compilation) …")
    t0 = time.perf_counter()
    mlmodel = ct.convert(
        traced,
        inputs=[
            ct.TensorType(name="input_ids", shape=sample_ids.shape, dtype=np.int32),
            ct.TensorType(name="attention_mask", shape=sample_mask.shape, dtype=np.int32),
        ],
        outputs=[ct.TensorType(name="token_vectors", dtype=np.float32)],
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
