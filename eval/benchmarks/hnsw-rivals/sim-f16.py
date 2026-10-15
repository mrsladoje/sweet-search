# D4 read-only sim (HANDOFF-v5 §8): does storing the full vectors as f16 (or bf16) change the final order?
# Offline cascade on a dev set: exact Hamming top-400 (512-bit sign codes), int8 rescore of all 400, head of 50 by
# int8, final order by the full 768-d dot (f64 sums) with the stored vectors in f32 / f16 / bf16.
# Reports, against f32: share of queries with an identical top 10, MRR@10 change with a paired bootstrap CI.
# usage: python sim-f16.py <setDir> [nq]
import sys, json, os, numpy as np
s = sys.argv[1]; NQ = int(sys.argv[2]) if len(sys.argv) > 2 else 10 ** 9
meta = json.load(open(f'{s}/meta.json')); cd = meta['chunkDoc']
X = np.fromfile(f'{s}/corpus768.bin', dtype=np.float32).reshape(-1, 768)
Q = np.fromfile(f'{s}/q768.bin', dtype=np.float32).reshape(-1, 768)[:NQ]
gold = [set(q['gold'] or []) for q in meta['queries'][:len(Q)]]
def tr(A):
    A = A[:, :512].astype(np.float64); return (A / np.linalg.norm(A, axis=1, keepdims=True)).astype(np.float32)
X5 = tr(X); Q5 = tr(Q)
XB = np.packbits(X5 > 0, axis=1).view(np.uint64); QB = np.packbits(Q5 > 0, axis=1).view(np.uint64)
X8 = np.round(np.clip(X5, -1, 1).astype(np.float64) * 127).astype(np.int32)
Q8 = np.round(np.clip(Q5, -1, 1).astype(np.float64) * 127).astype(np.int32)
def bf16(A):
    u = A.view(np.uint32).astype(np.uint64)
    r = ((u + 0x7FFF + ((u >> 16) & 1)) >> 16) << 16          # round to nearest even
    return r.astype(np.uint32).view(np.float32)
stores = {'f32': X, 'f16': X.astype(np.float16).astype(np.float32), 'bf16': bf16(X)}
for k, v in stores.items():
    if k != 'f32': print(f'{k}: max abs error {np.abs(v - X).max():.2e}, mean {np.abs(v - X).mean():.2e}')
doc = lambda c: cd[c] if cd[c] is not None else ('__d', c)
def rr(top, i):
    docs = list(dict.fromkeys(doc(int(c)) for c in top[:10]))
    return next((1 / (j + 1) for j, x in enumerate(docs) if x in gold[i]), 0.0)
tops = {k: [] for k in stores}
for i in range(len(Q)):
    d = np.bitwise_count(XB ^ QB[i]).sum(1, dtype=np.int32)
    p = np.argpartition(d, 400)[:400]; c = p[np.lexsort((p, d[p]))]
    sc = X8[c] @ Q8[i]
    head = c[np.argsort(-sc, kind='stable')[:50]]
    q64 = Q[i].astype(np.float64)
    for k, v in stores.items():
        full = v[head].astype(np.float64) @ q64
        tops[k].append(head[np.argsort(-full, kind='stable')][:10])
base = np.array([rr(t, i) for i, t in enumerate(tops['f32'])])
rng = np.random.default_rng(42)
print(f'== {os.path.basename(s)} n={len(X)} nq={len(Q)} f32 MRR@10 {base.mean():.4f}')
for k in ('f16', 'bf16'):
    r = np.array([rr(t, i) for i, t in enumerate(tops[k])]); dlt = r - base
    bs = [dlt[rng.integers(0, len(dlt), len(dlt))].mean() for _ in range(2000)]; lo, hi = np.percentile(bs, [2.5, 97.5])
    same = np.mean([np.array_equal(a, b) for a, b in zip(tops[k], tops['f32'])])
    same_set = np.mean([set(a.tolist()) == set(b.tolist()) for a, b in zip(tops[k], tops['f32'])])
    print(f'  {k:5} MRR {r.mean():.4f} d {dlt.mean():+.5f} [{lo:+.5f},{hi:+.5f}]  identical top10 {same:.4f}  same set {same_set:.4f}  queries changed {int((dlt != 0).sum())}')
