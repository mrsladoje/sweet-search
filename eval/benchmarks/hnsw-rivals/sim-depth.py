# Where is the MRR lost? brute Hamming top-M, exact-512 pool P, W=1 final. usage: python sim3.py <setDir> <nq>
import sys, json, os, numpy as np
s = sys.argv[1]; NQ = int(sys.argv[2])
meta = json.load(open(f'{s}/meta.json')); cd = meta['chunkDoc']
X = np.fromfile(f'{s}/corpus768.bin', dtype=np.float32).reshape(-1, 768)
Q = np.fromfile(f'{s}/q768.bin', dtype=np.float32).reshape(-1, 768)
rng = np.random.default_rng(7); qi = np.sort(rng.choice(len(Q), min(NQ, len(Q)), replace=False))
Q = Q[qi]; gold = [set(meta['queries'][i]['gold'] or []) for i in qi]
nz = lambda A: A / np.linalg.norm(A, axis=1, keepdims=True)
Xn = nz(X); Qn = nz(Q); X5 = nz(X[:, :512]); Q5 = nz(Q[:, :512])
doc = lambda c: cd[c] if cd[c] is not None else ('__d', c)
def rr(top):
    out = []
    for i, r in enumerate(top):
        docs = list(dict.fromkeys(doc(int(c)) for c in r[:10]))
        out.append(next((1 / (j + 1) for j, x in enumerate(docs) if x in gold[i]), 0.0))
    return np.array(out)
XB = np.packbits(X5 > 0, axis=1).view(np.uint64); QB = np.packbits(Q5 > 0, axis=1).view(np.uint64)
C = np.empty((len(Q), 2000), dtype=np.int64)
for i in range(len(Q)):
    d = np.bitwise_count(XB ^ QB[i]).sum(1, dtype=np.int32); p = np.argpartition(d, 2000)[:2000]; C[i] = p[np.argsort(d[p], kind='stable')]
res = {}
for M in (250, 500, 1000, 2000):
    for P in (50, 100, 200):
        top = []
        for i in range(len(Q)):
            c = C[i, :M]; pool = c[np.argsort(-(X5[c] @ Q5[i]), kind='stable')[:P]]
            top.append(pool[np.argsort(-(Xn[pool] @ Qn[i]), kind='stable')[:10]])
        res[(M, P)] = rr(top)
    # 768 exact over the whole stage-1 set
    top = [C[i, :M][np.argsort(-(Xn[C[i, :M]] @ Qn[i]), kind='stable')[:10]] for i in range(len(Q))]
    res[(M, 'all768')] = rr(top)
b = res[(250, 50)]
for k, v in res.items():
    d = v - b; bs = [d[rng.integers(0, len(d), len(d))].mean() for _ in range(1000)]; lo, hi = np.percentile(bs, [2.5, 97.5])
    print(f'  M={k[0]:5} P={k[1]!s:7} MRR {v.mean():.4f} d {d.mean():+.4f} [{lo:+.4f},{hi:+.4f}]')
