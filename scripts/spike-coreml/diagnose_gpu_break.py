"""
Narrow down which part of the model triggers GPU output corruption.

Test cases (all with the SAME b32×s512 .mlpackage):
  A) GPU + padded inputs (some mask=0)        → known broken
  B) GPU + all-ones mask, random ids          → tests if mask handling is the issue
  C) GPU + all-ones mask, identical ids       → tests if it's input-dependent at all
  D) ANE + all-ones mask, random ids          → control: ANE works
"""

import json
import sys
import time
from pathlib import Path

import numpy as np
import torch

import coremltools as ct
from pytorch_nomic_bert import load_nomic_bert

HERE = Path(__file__).resolve().parent
ARTIFACTS = HERE / "artifacts"
MODEL_DIR = Path.home() / ".cache" / "sweet-search" / "models" / "nomic-ai--CodeRankEmbed"

mlpkg = str(ARTIFACTS / "nomic_bert_b32_s512_fp16.mlpackage")


def cosine(a, b):
    a = a.astype(np.float64)
    b = b.astype(np.float64)
    return float((a @ b) / (np.linalg.norm(a) * np.linalg.norm(b)))


def pt_reference(ids_np, mask_np):
    """Run the PyTorch FP32 model on the same inputs to get the gold reference."""
    pt_model = load_nomic_bert(str(MODEL_DIR / "model.safetensors"), str(MODEL_DIR / "config.json"))
    pt_model = pt_model.to(torch.float32).eval()
    with torch.no_grad():
        out = pt_model.encode(
            torch.tensor(ids_np, dtype=torch.long),
            torch.tensor(mask_np, dtype=torch.long),
        )
    return out.cpu().numpy()


def report(label, mlmodel, ids, mask, ref):
    out = mlmodel.predict({"input_ids": ids, "attention_mask": mask})
    emb = out["embeddings"]
    cosines = [cosine(emb[i], ref[i]) for i in range(emb.shape[0])]
    print(f"  {label}: min={min(cosines):.6f}  mean={sum(cosines)/len(cosines):.6f}")
    return cosines


def main():
    rng = np.random.default_rng(42)

    # Test A: padded inputs (some mask=0). Known broken on GPU.
    ids_padded = np.zeros((32, 512), dtype=np.int32)
    mask_padded = np.zeros((32, 512), dtype=np.int32)
    for i in range(8):
        seq = rng.integers(40, 90)
        ids_padded[i, :seq] = rng.integers(low=100, high=30000, size=seq)
        mask_padded[i, :seq] = 1

    # Test B: random IDs, all-ones mask
    ids_rand = rng.integers(low=100, high=30000, size=(32, 512), dtype=np.int32)
    mask_ones = np.ones((32, 512), dtype=np.int32)

    # Test C: identical ids (just to rule out batch-dependent issues)
    ids_same = np.full((32, 512), 5000, dtype=np.int32)

    print("Building PyTorch FP32 references …")
    ref_padded = pt_reference(ids_padded, mask_padded)
    ref_rand = pt_reference(ids_rand, mask_ones)
    ref_same = pt_reference(ids_same, mask_ones)
    print()

    print("=== ANE-only (control) ===")
    ne = ct.models.MLModel(mlpkg, compute_units=ct.ComputeUnit.CPU_AND_NE)
    report("padded input, mixed mask", ne, ids_padded, mask_padded, ref_padded)
    report("random input, all-ones mask", ne, ids_rand, mask_ones, ref_rand)
    report("identical input, all-ones mask", ne, ids_same, mask_ones, ref_same)

    print()
    print("=== CPU_AND_GPU ===")
    gpu = ct.models.MLModel(mlpkg, compute_units=ct.ComputeUnit.CPU_AND_GPU)
    report("padded input, mixed mask", gpu, ids_padded, mask_padded, ref_padded)
    report("random input, all-ones mask", gpu, ids_rand, mask_ones, ref_rand)
    report("identical input, all-ones mask", gpu, ids_same, mask_ones, ref_same)


if __name__ == "__main__":
    main()
