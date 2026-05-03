"""
Trace the full CoreML shape cascade for NomicBERT embedding and
ModernBERT LI (both standard `lateon-code` and edge `lateon-code-edge`
variants) in one run.

The cascade shape set lives in core/infrastructure/coreml-cascade.json
as the single source of truth — this file READS that JSON rather than
duplicating the shapes, so bumping a shape in the JS cascade registry
automatically retraces to the right variant set on the next build.

At runtime the Rust dispatcher (`CoremlEmbedding::pick` /
`CoremlLi::pick`) selects the smallest variant where
`v.batch ≥ real_batch && v.seq ≥ real_seq`. Any call that doesn't fit
the largest variant falls back to candle — same safety contract as
before. The `lateon-code-edge` variants live in a separate dir
(`coreml-cascade/li-edge/`) and use the `li_modernbert_edge_b{B}_s{S}`
filename prefix so the standard 128d cascade is never shadowed.

Default outputs (managed cache, set by scripts/build-coreml-cascade.js):
  ~/.cache/sweet-search/models/coreml-cascade/embed/nomic_bert_b{B}_s{S}_fp16.mlpackage
  ~/.cache/sweet-search/models/coreml-cascade/li/li_modernbert_b{B}_s{S}_fp16.mlpackage
  ~/.cache/sweet-search/models/coreml-cascade/li-edge/li_modernbert_edge_b{B}_s{S}_fp16.mlpackage

For in-place development you can also invoke this script directly:
  cd scripts/spike-coreml
  python trace_cascade.py                # all 18 variants, default dirs
  python trace_cascade.py --embed-only   # only the 6 embedding variants
  python trace_cascade.py --li-only      # only the 6 standard LI variants
  python trace_cascade.py --li-edge-only # only the 6 edge LI variants
  python trace_cascade.py --skip-existing  # don't retrace files that exist
  python trace_cascade.py --embed-dir /path/to/embed --li-dir /path/to/li \\
                          --li-edge-dir /path/to/li-edge
"""

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import torch

from pytorch_nomic_bert import load_nomic_bert
from pytorch_modernbert import load_modernbert_li

HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parent.parent
EMBED_MODEL_DIR = Path.home() / ".cache" / "sweet-search" / "models" / "nomic-ai--CodeRankEmbed"
LI_MODEL_DIR = Path.home() / ".cache" / "sweet-search" / "models" / "lightonai--LateOn-Code"
LI_EDGE_MODEL_DIR = Path.home() / ".cache" / "sweet-search" / "models" / "lightonai--LateOn-Code-edge"

CASCADE_SPEC_PATH = PROJECT_ROOT / "core" / "infrastructure" / "coreml-cascade.json"


def _load_cascade_spec():
    """Read the shape set from the authoritative JSON file.

    This is the cascade's single source of truth — coreml-cascade.js
    reads the same file for state inspection, the Rust addon's
    parse_embed_variant_filename / parse_li_variant_filename rely on
    the filePattern convention defined here. Changing shapes is a
    one-file change.
    """
    with open(CASCADE_SPEC_PATH) as f:
        return json.load(f)


_SPEC = _load_cascade_spec()
EMBED_SHAPES = [(v["batch"], v["seq"]) for v in _SPEC["embed"]["variants"]]
LI_SHAPES = [(v["batch"], v["seq"]) for v in _SPEC["li"]["variants"]]
LI_EDGE_SHAPES = [(v["batch"], v["seq"]) for v in _SPEC.get("liEdge", {}).get("variants", [])]
EMBED_FILE_PATTERN = _SPEC["embed"]["filePattern"]
LI_FILE_PATTERN = _SPEC["li"]["filePattern"]
LI_EDGE_FILE_PATTERN = _SPEC.get("liEdge", {}).get("filePattern", "li_modernbert_edge_b{batch}_s{seq}_fp16.mlpackage")


def _variant_filename(pattern: str, batch: int, seq: int) -> str:
    """Matches coreml-cascade.js::formatVariantFilename."""
    return pattern.replace("{batch}", str(batch)).replace("{seq}", str(seq))


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


def run_embed_cascade(shapes, skip_existing, embed_dir):
    print(f"\n=== Embed cascade — {len(shapes)} variants ===")
    print(f"Output: {embed_dir}", flush=True)
    print("Loading NomicBERT once (cascade reuses this) …", flush=True)
    model = load_nomic_bert(
        str(EMBED_MODEL_DIR / "model.safetensors"),
        str(EMBED_MODEL_DIR / "config.json"),
        device="cpu",
    )
    model = model.to(torch.float32).eval()
    wrapped = TracedNomicBert(model).eval()

    embed_dir.mkdir(parents=True, exist_ok=True)
    for (batch, seq) in shapes:
        out_name = _variant_filename(EMBED_FILE_PATTERN, batch, seq)
        out_path = embed_dir / out_name
        if skip_existing and out_path.exists():
            print(f"  ── skip {out_name} (exists)", flush=True)
            continue
        trace_and_convert(wrapped, batch, seq, out_path, output_name="embeddings")


def run_li_cascade(shapes, skip_existing, li_dir):
    print(f"\n=== LI cascade (standard `lateon-code`, 768d → 128d) — {len(shapes)} variants ===")
    print(f"Output: {li_dir}", flush=True)
    print("Loading ModernBERT LI once (cascade reuses this) …", flush=True)
    model = load_modernbert_li(
        backbone_safetensors=str(LI_MODEL_DIR / "model.safetensors"),
        projection_safetensors=str(LI_MODEL_DIR / "1_Dense" / "model.safetensors"),
        config_json=str(LI_MODEL_DIR / "config.json"),
        device="cpu",
    )
    model = model.to(torch.float32).eval()
    wrapped = TracedModernBertLI(model).eval()

    li_dir.mkdir(parents=True, exist_ok=True)
    for (batch, seq) in shapes:
        out_name = _variant_filename(LI_FILE_PATTERN, batch, seq)
        out_path = li_dir / out_name
        if skip_existing and out_path.exists():
            print(f"  ── skip {out_name} (exists)", flush=True)
            continue
        trace_and_convert(wrapped, batch, seq, out_path, output_name="token_vectors")


def run_li_edge_cascade(shapes, skip_existing, li_edge_dir):
    """Trace the `lateon-code-edge` LI cascade (256d backbone, 2-stage
    projection 256→512→48). Uses the same wrapper class as standard
    LI — `ModernBertLI` is variant-agnostic; the loader picks up the
    right backbone + projection set from `coreml-cascade.json::liEdge`.
    """
    if not shapes:
        print("\n=== LI edge cascade — no variants in spec, skipping ===")
        return

    li_edge_section = _SPEC.get("liEdge")
    if not li_edge_section:
        print("\n=== LI edge cascade — coreml-cascade.json has no `liEdge` section, skipping ===")
        return

    trace_source = li_edge_section.get("traceSource") or {}
    projection_paths = trace_source.get("projections") or []
    token_dims = trace_source.get("projectionDims") or []
    if not projection_paths or not token_dims:
        print(
            "\n=== LI edge cascade — `liEdge.traceSource` missing `projections`/`projectionDims`, skipping ==="
        )
        return

    print(
        f"\n=== LI cascade (edge `lateon-code-edge`, 256d → 512d → 48d) — {len(shapes)} variants ==="
    )
    print(f"Output: {li_edge_dir}", flush=True)
    print("Loading ModernBERT LI edge once (cascade reuses this) …", flush=True)
    model = load_modernbert_li(
        backbone_safetensors=str(LI_EDGE_MODEL_DIR / "model.safetensors"),
        projection_paths=[str(LI_EDGE_MODEL_DIR / p) for p in projection_paths],
        token_dims=token_dims,
        config_json=str(LI_EDGE_MODEL_DIR / "config.json"),
        device="cpu",
    )
    model = model.to(torch.float32).eval()
    wrapped = TracedModernBertLI(model).eval()

    li_edge_dir.mkdir(parents=True, exist_ok=True)
    for (batch, seq) in shapes:
        out_name = _variant_filename(LI_EDGE_FILE_PATTERN, batch, seq)
        out_path = li_edge_dir / out_name
        if skip_existing and out_path.exists():
            print(f"  ── skip {out_name} (exists)", flush=True)
            continue
        trace_and_convert(wrapped, batch, seq, out_path, output_name="token_vectors")


def _default_output_dirs():
    """Default output dirs match coreml-cascade.js::getCoremlEmbedDir /
    getCoremlLiDir / getCoremlLiEdgeDir.

    Reads SWEET_SEARCH_MODEL_CACHE to honour enterprise mirror overrides,
    same contract as the JS side's MODEL_DELIVERY_CONFIG.modelCacheRoot.
    """
    import os
    root = os.environ.get("SWEET_SEARCH_MODEL_CACHE") or str(Path.home() / ".cache" / "sweet-search" / "models")
    cascade_root = Path(root) / "coreml-cascade"
    return cascade_root / "embed", cascade_root / "li", cascade_root / "li-edge"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--embed-only", action="store_true", help="Only trace the embedding cascade")
    ap.add_argument("--li-only", action="store_true", help="Only trace the standard LI cascade")
    ap.add_argument("--li-edge-only", action="store_true", help="Only trace the edge LI cascade")
    ap.add_argument(
        "--skip-existing",
        action="store_true",
        help="Don't retrace variants whose .mlpackage already exists",
    )
    ap.add_argument(
        "--embed-dir",
        type=Path,
        default=None,
        help="Override the embed output directory (default: managed cache).",
    )
    ap.add_argument(
        "--li-dir",
        type=Path,
        default=None,
        help="Override the standard LI output directory (default: managed cache).",
    )
    ap.add_argument(
        "--li-edge-dir",
        type=Path,
        default=None,
        help="Override the edge LI output directory (default: managed cache).",
    )
    ap.add_argument("--verbose", action="store_true", help="Verbose output (unused currently; here for forward compat with build-coreml-cascade.js)")
    args = ap.parse_args()

    only_flags = sum([args.embed_only, args.li_only, args.li_edge_only])
    if only_flags > 1:
        print(
            "--embed-only / --li-only / --li-edge-only are mutually exclusive",
            file=sys.stderr,
        )
        sys.exit(2)

    default_embed, default_li, default_li_edge = _default_output_dirs()
    embed_dir = args.embed_dir if args.embed_dir is not None else default_embed
    li_dir = args.li_dir if args.li_dir is not None else default_li
    li_edge_dir = args.li_edge_dir if args.li_edge_dir is not None else default_li_edge

    t_total = time.perf_counter()

    # Each `--*-only` flag is exclusive: when set, ONLY that family is
    # traced. The default (no `--*-only` flag) traces all three.
    if args.embed_only:
        run_embed_cascade(EMBED_SHAPES, args.skip_existing, embed_dir)
    elif args.li_only:
        run_li_cascade(LI_SHAPES, args.skip_existing, li_dir)
    elif args.li_edge_only:
        run_li_edge_cascade(LI_EDGE_SHAPES, args.skip_existing, li_edge_dir)
    else:
        run_embed_cascade(EMBED_SHAPES, args.skip_existing, embed_dir)
        run_li_cascade(LI_SHAPES, args.skip_existing, li_dir)
        run_li_edge_cascade(LI_EDGE_SHAPES, args.skip_existing, li_edge_dir)

    total_s = time.perf_counter() - t_total
    print(f"\n=== Cascade trace complete in {total_s/60:.1f} min ===")
    print(f"Embed output:   {embed_dir}")
    print(f"LI output:      {li_dir}")
    print(f"LI-edge output: {li_edge_dir}")


if __name__ == "__main__":
    main()
