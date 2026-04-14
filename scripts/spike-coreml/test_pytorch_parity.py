"""
Compare PyTorch NomicBERT output vs candle Metal BF16 reference.

Reads candle_reference.json (produced by dump_candle_reference.js), runs the
same input_ids/attention_mask through the PyTorch port, and reports per-input
cosine similarity. Target: ≥0.999 against the BF16 reference.
"""

import json
import math
import sys
from pathlib import Path

import torch

from pytorch_nomic_bert import load_nomic_bert


HERE = Path(__file__).resolve().parent
REF_PATH = HERE / "candle_reference.json"
MODEL_DIR = Path.home() / ".cache" / "sweet-search" / "models" / "nomic-ai--CodeRankEmbed"


def cosine(a, b):
    a = torch.as_tensor(a, dtype=torch.float64)
    b = torch.as_tensor(b, dtype=torch.float64)
    return (a @ b / (a.norm() * b.norm())).item()


def main():
    if not REF_PATH.exists():
        print(f"Missing {REF_PATH}. Run: node scripts/spike-coreml/dump_candle_reference.js", file=sys.stderr)
        sys.exit(2)
    ref = json.loads(REF_PATH.read_text())
    print(f"Reference device: {ref['device']}, batch={ref['batch_size']}, seq={ref['seq_len']}")

    device = "cpu"  # FP32 PyTorch on CPU as the upper-bound reference
    model = load_nomic_bert(
        str(MODEL_DIR / "model.safetensors"),
        str(MODEL_DIR / "config.json"),
        device=device,
    )
    model = model.to(torch.float32)

    input_ids = torch.tensor(ref["input_ids"], dtype=torch.long, device=device)
    attn_mask = torch.tensor(ref["attention_mask"], dtype=torch.long, device=device)
    print(f"PyTorch input shape: {input_ids.shape}")

    with torch.no_grad():
        out = model.encode(input_ids, attn_mask).cpu().numpy()
    print(f"PyTorch output shape: {out.shape}")

    print()
    print("─" * 80)
    print(f"{'#':>3}  {'cosine':>10}  preview")
    print("─" * 80)
    cosines = []
    for i, (py, ref_emb) in enumerate(zip(out, ref["embeddings"])):
        c = cosine(py, ref_emb)
        cosines.append(c)
        preview = ref["inputs"][i][:60].replace("\n", "\\n")
        flag = "PASS" if c >= 0.999 else ("WARN" if c >= 0.99 else "FAIL")
        print(f"{i:>3}  {c:>10.6f}  [{flag}] {preview}")
    print("─" * 80)
    print(f"min={min(cosines):.6f}  max={max(cosines):.6f}  mean={sum(cosines)/len(cosines):.6f}")

    threshold = 0.999
    if min(cosines) >= threshold:
        print(f"\nPASS — minimum cosine {min(cosines):.6f} ≥ {threshold}")
        sys.exit(0)
    else:
        print(f"\nFAIL — minimum cosine {min(cosines):.6f} < {threshold}")
        sys.exit(1)


if __name__ == "__main__":
    main()
