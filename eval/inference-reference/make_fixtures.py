"""Generate independent reference fixtures for the native inference models.

The fixtures pin, per model, what the product must produce from text:
  1. the token ids (upstream tokenizer at a pinned revision), and
  2. the model output for those ids, computed by the UPSTREAM model
     implementation (Hugging Face transformers / the model repo's own
     remote code) in float32 on CPU, one text at a time with no padding.

Nothing here shares code with crates/sweet-search-native, so a defect in
our model code cannot hide by appearing on both sides (the ModernBERT
global-layer mask bug once passed CPU-vs-CUDA parity because both sides
shared it).

Product contract recorded per model (see `contract` in each fixture):
  - CodeRankEmbed: mean pooling over attended tokens + L2 normalise,
    max_length 512. The upstream sentence-transformers config says CLS
    pooling; the product mean-pools (measured: matches stored vectors at
    cosine 0.9997, CLS gives 0.70-0.88). The fixture follows the product.
  - LateOn-Code / -edge: backbone last_hidden_state -> Dense stack (no
    bias, identity activation) -> per-token L2 normalise, every attended
    token returned (skiplist filtering happens later in JS). "[D] " / "[Q] "
    prefixes are part of the text (one added token each), documents
    truncate at 2048 tokens, queries at 256.

Usage (pinned environment, see requirements.lock.txt):
  uv venv -p 3.11 venv && uv pip install -p venv/bin/python -r requirements.lock.txt
  venv/bin/python -I make_fixtures.py <repo-root>

Writes tests/__test_fixtures__/inference-reference/<model>.json.
"""

from __future__ import annotations

import base64
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import torch
from huggingface_hub import hf_hub_download
from safetensors.torch import load_file
from transformers import AutoModel, AutoTokenizer

FIXTURE_VERSION = 1

MODELS = {
    "coderankembed": {
        "hf_id": "nomic-ai/CodeRankEmbed",
        "revision": "3c4b60807d71f79b43f3c4363786d9493691f8b1",
        "weights_sha256": "827529bcd58aef0d9082e66eeff7e7d53a02f62bd005f841a26b3d3e2fb17ebe",
        "kind": "embedding",
        "max_length": 512,
        "query_prefix": "Represent this query for searching relevant code: ",
    },
    "lateon-code": {
        "hf_id": "lightonai/LateOn-Code",
        "revision": "ace431824f35db231178fc602e33296784762a2e",
        "weights_sha256": "45c40bb4ba6b45f0c66b2deb3d27dd06efc3af23c78c8093b8cad2af61c683b2",
        "kind": "late_interaction",
        "dense": ["1_Dense/model.safetensors"],
        "max_length": 2048,
        "query_max_length": 256,
    },
    "lateon-code-edge": {
        "hf_id": "lightonai/LateOn-Code-edge",
        "revision": "4bcdf5ed93f791259eb130b577a240f753d68dd8",
        "weights_sha256": "7ffc36b8ff71367249cd5220dbdd4bdbe177bc0e305b2e978a8b598bd8296f04",
        "kind": "late_interaction",
        "dense": ["1_Dense/model.safetensors", "2_Dense/model.safetensors"],
        "max_length": 2048,
        "query_max_length": 256,
    },
}

# Token lengths (including special tokens) chosen from the dispatch
# conditions: <=8 vs 9 (the fused-attention gate is seq_len > 8), 64/65
# and 128/129 (ModernBERT local window 128 = radius 64), 256/257 (largest
# integer BF16 holds exactly), 512 (embedding max length), 1000 and 2048
# (late-interaction max length).
EMBED_LENGTHS = [5, 8, 9, 64, 65, 128, 129, 256, 257, 512]
LI_LENGTHS = [5, 8, 9, 64, 65, 128, 129, 256, 257, 512, 1000, 2048]

# Mixed-length batches, by case id. The product must give each text the
# same output alone and inside a padded batch.
EMBED_BATCHES = [["len9", "len512", "len64"], ["len5", "len8", "len129", "len257", "query"]]
LI_BATCHES = [
    ["len9", "len65", "len129", "len257"],
    ["len8", "len2048"],
    ["len5", "len1000", "len64", "query"],
]

# Source text for the length cases. Real code with comments, frozen here
# so the fixture never depends on the repository's files.
SOURCE_FILES = [
    "core/infrastructure/native-inference.js",
    "crates/sweet-search-native/src/inference/varlen.rs",
]


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def b64_f32(a: np.ndarray) -> str:
    # float32, not float16: float16 storage alone moved token cosines by
    # up to 1.4e-4, too coarse for F32 parity thresholds near 1.0.
    return base64.b64encode(np.ascontiguousarray(a, dtype="<f4").tobytes()).decode()


def text_with_tokens(tok, prefix: str, source: str, n_tokens: int) -> str:
    """Prefix + the shortest leading slice of `source` that tokenizes to
    exactly `n_tokens` ids (special tokens included)."""
    enc = tok(prefix + source, add_special_tokens=True, return_offsets_mapping=True)
    offsets = enc["offset_mapping"]
    # Content tokens sit between [CLS] and [SEP]; keep n_tokens - 2.
    keep = n_tokens - 2
    for delta in range(0, 6):
        for k in (keep + delta, keep - delta):
            if k < 1 or k >= len(offsets) - 1:
                continue
            end = offsets[k][1]
            text = (prefix + source)[:end]
            if len(tok(text)["input_ids"]) == n_tokens:
                return text
    raise RuntimeError(f"no slice of the source tokenizes to {n_tokens} tokens")


def l2(x: torch.Tensor) -> torch.Tensor:
    return x / x.norm(dim=-1, keepdim=True)


def build(repo: Path, key: str, cfg: dict) -> dict:
    rev = cfg["revision"]
    weights = hf_hub_download(cfg["hf_id"], "model.safetensors", revision=rev)
    got = sha256_file(weights)
    if got != cfg["weights_sha256"]:
        raise SystemExit(f"{key}: weights sha256 {got} != pinned {cfg['weights_sha256']}")

    tok = AutoTokenizer.from_pretrained(cfg["hf_id"], revision=rev)
    model_kwargs = {"revision": rev, "dtype": torch.float32}
    if cfg["kind"] == "embedding":
        # The repo's own NomicBERT code; its loader needs safe_serialization
        # (sentence_bert_config.json model_args).
        model_kwargs["trust_remote_code"] = True
        model_kwargs["safe_serialization"] = True
    else:
        model_kwargs["attn_implementation"] = "eager"
    model = AutoModel.from_pretrained(cfg["hf_id"], **model_kwargs).eval()

    dense = []
    for rel in cfg.get("dense", []):
        path = hf_hub_download(cfg["hf_id"], rel, revision=rev)
        (w,) = load_file(path).values()
        dense.append({"path": rel, "sha256": sha256_file(path), "weight": w.float()})

    source = "\n".join((repo / f).read_text() for f in SOURCE_FILES)
    doc_prefix = "" if cfg["kind"] == "embedding" else "[D] "
    lengths = EMBED_LENGTHS if cfg["kind"] == "embedding" else LI_LENGTHS
    cases = [
        {"id": f"len{n}", "text": text_with_tokens(tok, doc_prefix, source, n), "max_length": cfg["max_length"]}
        for n in lengths
    ]
    # Truncation: longer than max_length; only the token ids are pinned.
    cases.append({
        "id": "truncated",
        "text": doc_prefix + source[: 4 * cfg["max_length"] * 4],
        "max_length": cfg["max_length"],
        "ids_only": True,
    })
    if cfg["kind"] == "embedding":
        q = cfg["query_prefix"] + "how to unpack padded flash attention output back to batch layout"
        cases.append({"id": "query", "text": q, "max_length": cfg["max_length"]})
    else:
        q = "[Q] how to unpack padded flash attention output back to batch layout"
        cases.append({"id": "query", "text": q, "max_length": cfg["query_max_length"]})

    out_cases = []
    for case in cases:
        enc = tok(case["text"], truncation=True, max_length=case["max_length"], return_tensors="pt")
        ids = enc["input_ids"]
        entry = {**case, "input_ids": ids[0].tolist()}
        if not case.get("ids_only"):
            with torch.no_grad():
                hidden = model(input_ids=ids, attention_mask=enc["attention_mask"]).last_hidden_state[0]
                if cfg["kind"] == "embedding":
                    vec = l2(hidden.mean(dim=0))
                    entry["output"] = b64_f32(vec.numpy())
                    entry["shape"] = [int(vec.shape[0])]
                else:
                    x = hidden
                    for d in dense:
                        x = x @ d["weight"].T
                    x = l2(x)
                    entry["output"] = b64_f32(x.numpy())
                    entry["shape"] = [int(x.shape[0]), int(x.shape[1])]
        out_cases.append(entry)
        print(f"  {key} {case['id']}: {len(entry['input_ids'])} tokens", file=sys.stderr)

    if cfg["kind"] == "late_interaction":
        check_against_pylate(cfg, out_cases)

    return {
        "fixture_version": FIXTURE_VERSION,
        "model": key,
        "hf_id": cfg["hf_id"],
        "revision": rev,
        "weights_sha256": cfg["weights_sha256"],
        "dense": [{"path": d["path"], "sha256": d["sha256"]} for d in dense],
        "kind": cfg["kind"],
        "pad_id": tok.pad_token_id,
        "contract": (
            "ids = tokenizer(text, truncation, max_length); output = L2(mean(last_hidden_state over attended tokens))"
            if cfg["kind"] == "embedding"
            else "ids = tokenizer(text, truncation, max_length); output[t] = L2(last_hidden_state[t] @ dense...) for every attended token"
        ),
        "reference": f"upstream transformers {__import__('transformers').__version__}, torch {torch.__version__}, float32 CPU, each text alone",
        "storage": "outputs are little-endian float32, base64, row-major",
        "batches": EMBED_BATCHES if cfg["kind"] == "embedding" else LI_BATCHES,
        "cases": out_cases,
    }


def check_against_pylate(cfg: dict, cases: list) -> None:
    """Confirm the hand-assembled Dense stack equals PyLate's own module
    stack on the same ids (PyLate is the library the model ships for)."""
    from pylate import models

    colbert = models.ColBERT(cfg["hf_id"], revision=cfg["revision"], device="cpu")
    case = next(c for c in cases if c["id"] == "len257")
    ids = torch.tensor([case["input_ids"]])
    with torch.no_grad():
        feats = colbert({"input_ids": ids, "attention_mask": torch.ones_like(ids)})
    ours = np.frombuffer(base64.b64decode(case["output"]), dtype="<f4").reshape(case["shape"])
    theirs = l2(feats["token_embeddings"][0].float()).numpy()
    worst = float((ours * theirs).sum(-1).min())
    print(f"  pylate cross-check {cfg['hf_id']} len257: min token cosine {worst:.6f}", file=sys.stderr)
    if worst < 0.99999:
        raise SystemExit("PyLate module stack disagrees with the fixture projection")


def main() -> None:
    repo = Path(sys.argv[1]).resolve()
    out_dir = repo / "tests/__test_fixtures__/inference-reference"
    out_dir.mkdir(parents=True, exist_ok=True)
    torch.manual_seed(0)
    for key, cfg in MODELS.items():
        data = build(repo, key, cfg)
        (out_dir / f"{key}.json").write_text(json.dumps(data, indent=1) + "\n")
        print(f"wrote {key}.json", file=sys.stderr)


if __name__ == "__main__":
    main()
