"""
Trace the full CoreML shape cascade for NomicBERT embedding and
ModernBERT LI in one run.

The cascade shapes match the sweet-search indexer's cache-aware
bucketer stair-step — see core/infrastructure/onnx-session-utils.js
(`computeWeightsAwareBatchCap`) and the embed/LI bucketers in
core/embedding/embedding-local-model.js and core/indexing/indexer-pool.js
for the original formula. Each row in EMBED_SHAPES / LI_SHAPES is one
of the stair-step flats produced by the JS bucketer, rounded up for
per-call shape coverage:

  • short-seq flats at the JS hardCap (64 for embed, 128 for LI)
  • medium-seq flats where tokenBudget starts binding
  • long-seq flats where the cache-aware attention budget collapses
    batch to ≤1

At runtime the Rust dispatcher (`CoremlEmbedding::pick`) selects the
smallest variant where `v.batch ≥ real_batch && v.seq ≥ real_seq`.
Any call that doesn't fit the largest variant falls back to candle —
same safety contract as before.

Outputs:
  artifacts/cascade/nomic_bert_b{B}_s{S}_fp16.mlpackage     (6 files)
  artifacts/cascade/li_modernbert_b{B}_s{S}_fp16.mlpackage  (6 files)

Regenerate with:
  cd scripts/spike-coreml
  python trace_cascade.py                # all 12 variants
  python trace_cascade.py --embed-only   # only the 6 embedding variants
  python trace_cascade.py --li-only      # only the 6 LI variants
  python trace_cascade.py --skip-existing  # don't retrace files that exist
"""

import argparse
import sys
import time
from pathlib import Path

import numpy as np
import torch

from pytorch_nomic_bert import load_nomic_bert
from pytorch_modernbert import load_modernbert_li

HERE = Path(__file__).resolve().parent
EMBED_MODEL_DIR = Path.home() / ".cache" / "sweet-search" / "models" / "nomic-ai--CodeRankEmbed"
LI_MODEL_DIR = Path.home() / ".cache" / "sweet-search" / "models" / "lightonai--LateOn-Code"
OUT_DIR = HERE / "artifacts" / "cascade"


# Embed cascade — 6 variants. See file header + CLAUDE.md discussion.
EMBED_SHAPES = [
    (64, 96),    # 1. hardCap × short seq   — covers observed (64, 52..107) regime
    (64, 192),   # 2. hardCap × short-med
    (32, 384),   # 3. tokenBudget regime
    (16, 512),   # 4. long, cache-bound start
    (4, 1024),   # 5. long tail
    (1, 2048),   # 6. extreme tail / oversize docs
]

# LI cascade — 6 variants. LI upperCap is 128 (vs 64 for embed).
LI_SHAPES = [
    (128, 48),   # 1. upperCap × very short — covers observed (128, 18..33)
    (128, 128),  # 2. upperCap × short
    (64, 256),   # 3. medium
    (16, 512),   # 4. long, cache-bound start
    (4, 1024),   # 5. long tail
    (1, 2048),   # 6. LI max length
]


class TracedNomicBert(torch.nn.Module):
    """Embedding wrapper — mean-pool + L2-normalize baked into the graph so
    the .mlpackage exposes a single end-to-end `(ids, mask) -> (B, 768)` op.
    Matches the candle `EmbedBatchTask` compute pipeline.
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


class TracedModernBertLI(torch.nn.Module):
    """LI wrapper — backbone + 768→128 projection + per-token L2-normalise
    all baked into the traced graph. Output is `[B, S, 128]` float32 to
    match `LiEncodeTask::compute`.
    """

    def __init__(self, model):
        super().__init__()
        self.model = model

    def forward(self, input_ids: torch.Tensor, attention_mask: torch.Tensor) -> torch.Tensor:
        return self.model(input_ids, attention_mask)


def trace_and_convert(wrapped, batch, seq, out_path, output_name):
    """Trace the given wrapped model at (batch, seq) and convert to a
    CoreML mlprogram .mlpackage. All cascade variants use fp16 compute
    precision and pin compute units to ALL (the Rust shim overrides
    to CPU_AND_NE at load time anyway — see coreml_shim.m).
    """
    import coremltools as ct

    print(f"  ── tracing at b={batch} s={seq} …", flush=True)
    sample_ids = torch.zeros(batch, seq, dtype=torch.long)
    sample_mask = torch.ones(batch, seq, dtype=torch.long)

    t0 = time.perf_counter()
    with torch.no_grad():
        traced = torch.jit.trace(wrapped, (sample_ids, sample_mask), strict=False)
    trace_s = time.perf_counter() - t0

    # Sanity check — eager vs traced must agree before handing to ct.convert.
    # If the traces diverge the mlpackage would embed a silently-wrong graph.
    with torch.no_grad():
        out_eager = wrapped(sample_ids, sample_mask)
        out_traced = traced(sample_ids, sample_mask)
    diff = (out_eager - out_traced).abs().max().item()
    if diff >= 1e-3:
        raise RuntimeError(
            f"eager/traced diverge at ({batch},{seq}): max abs diff {diff:.3e}"
        )

    t0 = time.perf_counter()
    mlmodel = ct.convert(
        traced,
        inputs=[
            ct.TensorType(name="input_ids", shape=sample_ids.shape, dtype=np.int32),
            ct.TensorType(name="attention_mask", shape=sample_mask.shape, dtype=np.int32),
        ],
        outputs=[ct.TensorType(name=output_name, dtype=np.float32)],
        convert_to="mlprogram",
        compute_precision=ct.precision.FLOAT16,
        compute_units=ct.ComputeUnit.ALL,
        minimum_deployment_target=ct.target.macOS14,
    )
    convert_s = time.perf_counter() - t0

    if out_path.exists():
        import shutil
        shutil.rmtree(out_path)
    mlmodel.save(str(out_path))

    print(
        f"  ✓ {out_path.name} (trace {trace_s:.1f}s, convert {convert_s:.1f}s, diff {diff:.1e})",
        flush=True,
    )


def run_embed_cascade(shapes, skip_existing):
    print(f"\n=== Embed cascade — {len(shapes)} variants ===")
    print("Loading NomicBERT once (cascade reuses this) …", flush=True)
    model = load_nomic_bert(
        str(EMBED_MODEL_DIR / "model.safetensors"),
        str(EMBED_MODEL_DIR / "config.json"),
        device="cpu",
    )
    model = model.to(torch.float32).eval()
    wrapped = TracedNomicBert(model).eval()

    for (batch, seq) in shapes:
        out_name = f"nomic_bert_b{batch}_s{seq}_fp16.mlpackage"
        out_path = OUT_DIR / out_name
        if skip_existing and out_path.exists():
            print(f"  ── skip {out_name} (exists)", flush=True)
            continue
        trace_and_convert(wrapped, batch, seq, out_path, output_name="embeddings")


def run_li_cascade(shapes, skip_existing):
    print(f"\n=== LI cascade — {len(shapes)} variants ===")
    print("Loading ModernBERT LI once (cascade reuses this) …", flush=True)
    model = load_modernbert_li(
        backbone_safetensors=str(LI_MODEL_DIR / "model.safetensors"),
        projection_safetensors=str(LI_MODEL_DIR / "1_Dense" / "model.safetensors"),
        config_json=str(LI_MODEL_DIR / "config.json"),
        device="cpu",
    )
    model = model.to(torch.float32).eval()
    wrapped = TracedModernBertLI(model).eval()

    for (batch, seq) in shapes:
        out_name = f"li_modernbert_b{batch}_s{seq}_fp16.mlpackage"
        out_path = OUT_DIR / out_name
        if skip_existing and out_path.exists():
            print(f"  ── skip {out_name} (exists)", flush=True)
            continue
        trace_and_convert(wrapped, batch, seq, out_path, output_name="token_vectors")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--embed-only", action="store_true", help="Only trace the embedding cascade")
    ap.add_argument("--li-only", action="store_true", help="Only trace the LI cascade")
    ap.add_argument(
        "--skip-existing",
        action="store_true",
        help="Don't retrace variants whose .mlpackage already exists",
    )
    args = ap.parse_args()

    if args.embed_only and args.li_only:
        print("--embed-only and --li-only are mutually exclusive", file=sys.stderr)
        sys.exit(2)

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    t_total = time.perf_counter()

    if not args.li_only:
        run_embed_cascade(EMBED_SHAPES, args.skip_existing)
    if not args.embed_only:
        run_li_cascade(LI_SHAPES, args.skip_existing)

    total_s = time.perf_counter() - t_total
    print(f"\n=== Cascade trace complete in {total_s/60:.1f} min ===")
    print(f"Output: {OUT_DIR}")


if __name__ == "__main__":
    main()
