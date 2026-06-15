"""Reference-encoder AdvTest diagnostic.

Runs the REFERENCE PyTorch nomic-ai/CodeRankEmbed (F32) on our exact AdvTest
data (same docstring-stripped corpus, same queries, same prefix), full 19,210
pool, exact cosine. This is the gold standard: if it hits ~59.5, the gap is our
ONNX/INT8 deployment; if it also lands ~48, our data prep differs from published.

Run: uv run --with sentence-transformers --with torch --with einops \
         python eval/diagnose-advtest-reference.py
"""
import json, os, time
import numpy as np

DATA = os.path.join(os.path.dirname(__file__), "data", "advtest")
QSAMPLE = int(os.environ.get("QSAMPLE", "3000"))
PREFIX = "Represent this query for searching relevant code: "

docs = [json.loads(l) for l in open(os.path.join(DATA, "corpus.jsonl"))]
queries = [json.loads(l) for l in open(os.path.join(DATA, "queries.jsonl"))][:QSAMPLE]
doc_idx = {d["doc_id"]: i for i, d in enumerate(docs)}
print(f"docs={len(docs)} queries={len(queries)}")

import torch
from sentence_transformers import SentenceTransformer
DEVICE = os.environ.get("SS_DEVICE", "cpu")  # default CPU — MPS crashed on this custom model
BATCH = int(os.environ.get("BATCH", "16"))
print(f"device={DEVICE} batch={BATCH}  loading nomic-ai/CodeRankEmbed (F32 reference)...", flush=True)
model = SentenceTransformer("nomic-ai/CodeRankEmbed", trust_remote_code=True, device=DEVICE)
model.max_seq_length = 512  # match our pipeline's cap

t = time.time()
D = model.encode([d["code"] for d in docs], batch_size=BATCH, normalize_embeddings=True,
                 show_progress_bar=True, convert_to_numpy=True).astype(np.float32)
print(f"docs encoded in {time.time()-t:.0f}s", flush=True)
Q = model.encode([PREFIX + q["query"] for q in queries], batch_size=BATCH, normalize_embeddings=True,
                 show_progress_bar=True, convert_to_numpy=True).astype(np.float32)
print(f"encoded in {time.time()-t:.0f}s; D={D.shape} Q={Q.shape}")

n = len(queries); mrr10 = mrru = hit1 = hit10 = hit100 = 0
sims = Q @ D.T  # (n_queries, n_docs)
for qi, qobj in enumerate(queries):
    g = doc_idx.get(qobj["relevant_doc_ids"][0])
    if g is None:
        continue
    gold = sims[qi, g]
    rank = 1 + int((sims[qi] > gold).sum())  # how many docs beat the gold
    if rank == 1: hit1 += 1
    if rank <= 10: hit10 += 1; mrr10 += 1.0 / rank
    if rank <= 100: hit100 += 1
    mrru += 1.0 / rank

print("\n=== REFERENCE PyTorch CodeRankEmbed (F32) on OUR AdvTest data ===")
print(f"MRR@10       = {mrr10/n*100:.2f}%")
print(f"MRR uncapped = {mrru/n*100:.2f}%   <- published is 59.5 (MRR@1000)")
print(f"Hit@1={hit1/n*100:.1f}%  Recall@10={hit10/n*100:.1f}%  Recall@100={hit100/n*100:.1f}%")
