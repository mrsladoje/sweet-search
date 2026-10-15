#!/usr/bin/env python
"""Cross-check embed.py output of a --limit run against the model cards' own library path.

    python check_embed.py --model CodeRankEmbed --set gcsn --data DATA --limit 50 [--n 8] [--existing corpus.f32]

1. First n documents and n queries again through sentence-transformers (the card's pipeline: Transformer + pooling
   [+ Normalize], max_seq_length 512, prefix added by hand for queries): max |difference| of components and min cosine
   against the rows embed.py wrote.
2. With --existing (also --existing-queries: float32 n x 768 queries file, same row order as queries.jsonl)
   With --existing (float32 n x 768 file of vectors made by another path, e.g. the product's CodeRankEmbed vectors):
   cosine of the first n embed.py document rows against it. Meant for rows with exact texts.
Computes no retrieval metric.
"""
import argparse, json, os
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
ap.add_argument('--model', required=True); ap.add_argument('--set', required=True); ap.add_argument('--data', required=True)
ap.add_argument('--limit', type=int, required=True); ap.add_argument('--n', type=int, default=8)
ap.add_argument('--existing', default=None); ap.add_argument('--existing-queries', default=None); ap.add_argument('--device', default='cpu')
a = ap.parse_args()
spec = json.load(open(os.path.join(HERE, 'MODELS.json')))['models'][a.model]
out = os.path.join(a.data, 'emb', a.model, f'{a.set}.limit{a.limit}')
x = np.fromfile(os.path.join(out, 'corpus.f32'), dtype='<f4').reshape(-1, 768)
q = np.fromfile(os.path.join(out, 'queries.f32'), dtype='<f4').reshape(-1, 768)
sd = os.path.join(a.data, 'sets', a.set)
docs = [json.loads(l)['text'] for _, l in zip(range(a.n), open(os.path.join(sd, 'texts.jsonl')))]
qs = [spec['query_prefix'] + json.loads(l)['text'] for _, l in zip(range(a.n), open(os.path.join(sd, 'queries.jsonl')))]
from sentence_transformers import SentenceTransformer
kw = {'trust_remote_code': True} if spec.get('trust_remote_code') else {}
m = SentenceTransformer(spec['hf_id'], revision=spec['revision'], device=a.device, model_kwargs=spec.get('model_args', {}) or {}, **kw)
m.max_seq_length = 512
if spec['pooling'] != spec.get('card_pooling', spec['pooling']):  # MODELS.json: the product's pooling differs from the card's
    pool = m[1]
    pool.pooling_mode_cls_token = spec['pooling'] == 'cls'
    pool.pooling_mode_mean_tokens = spec['pooling'] == 'mean'
res = {}
for name, texts, mine in (('docs', docs, x[:a.n]), ('queries', qs, q[:a.n])):
    ref = m.encode(texts, batch_size=8, normalize_embeddings=True, convert_to_numpy=True).astype('<f4')
    cos = (ref.astype(np.float64) * mine.astype(np.float64)).sum(1)
    res[name] = {'n': a.n, 'max_abs_component_diff': float(np.abs(ref - mine).max()), 'min_cos': float(cos.min())}
if a.existing:
    ex = np.fromfile(os.path.expanduser(a.existing), dtype='<f4', count=a.n * 768).reshape(-1, 768).astype(np.float64)
    ex /= np.linalg.norm(ex, axis=1, keepdims=True)
    cos = (ex * x[:a.n].astype(np.float64)).sum(1)
    res['vs_existing_docs'] = {'n': a.n, 'min_cos': float(cos.min()), 'median_cos': float(np.median(cos))}
if a.existing_queries:
    eq = np.fromfile(os.path.expanduser(a.existing_queries), dtype='<f4', count=a.n * 768).reshape(-1, 768).astype(np.float64)
    eq /= np.linalg.norm(eq, axis=1, keepdims=True)
    cos = (eq * q[:a.n].astype(np.float64)).sum(1)
    res['vs_existing_queries'] = {'n': a.n, 'min_cos': float(cos.min()), 'median_cos': float(np.median(cos))}
print(json.dumps({'model': a.model, 'set': a.set, **res}))
