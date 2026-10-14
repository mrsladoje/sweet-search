# Read-only checks + offline cascade sim on a dev set (brute-force Hamming stage 1, no graph).
# usage: python sim.py <setDir> <nq>
import sys, json, numpy as np, time
s = sys.argv[1]; NQ = int(sys.argv[2])
meta = json.load(open(f'{s}/meta.json')); cd = meta['chunkDoc']
X = np.fromfile(f'{s}/corpus768.bin', dtype=np.float32).reshape(-1, 768)
Q = np.fromfile(f'{s}/q768.bin', dtype=np.float32).reshape(-1, 768)
rng = np.random.default_rng(7); qi = np.sort(rng.choice(len(Q), min(NQ, len(Q)), replace=False))
Q = Q[qi]; gold = [set(meta['queries'][i]['gold'] or []) for i in qi]
gt = np.fromfile(f'{s}/gt.bin', dtype=np.int32).reshape(-1, 10)[qi] if __import__('os').path.exists(f'{s}/gt.bin') else None
def tr(A):
    A = A[:, :512].astype(np.float32); return A / np.linalg.norm(A, axis=1, keepdims=True)
Xn = X / np.linalg.norm(X, axis=1, keepdims=True); Qn = Q / np.linalg.norm(Q, axis=1, keepdims=True)
X5 = tr(X); Q5 = tr(Q)
print(f'n={len(X)} nq={len(Q)}')
# --- 1. int8 histogram (current quantizer: round(clamp(x,-1,1)*127) on the 512-d unit vector)
I = np.round(np.clip(X5[::10], -1, 1) * 127).astype(np.int16)
a = np.abs(I).ravel(); print('int8 |v| percentiles p50/p90/p99/p99.9/max:', [int(np.percentile(a, p)) for p in (50, 90, 99, 99.9)], int(a.max()))
print('distinct int8 levels used:', len(np.unique(I)), ' share of zeros: %.3f' % (a == 0).mean())
absx = np.abs(X5[::10]).ravel()
for p in (99.9, 99.99): print(f'|x| p{p} = {np.percentile(absx, p):.4f}')
print('|x| max = %.4f' % absx.max())
# --- 2. bit balance per dimension
mu = X5.mean(0); pos = (X5 > 0).mean(0)
print('bit balance: mean |p-0.5| = %.4f, max %.4f, dims with |p-0.5|>0.1: %d / 512' % (np.abs(pos - .5).mean(), np.abs(pos - .5).max(), (np.abs(pos - .5) > .1).sum()))
print('mean vector norm (512-d) = %.4f' % np.linalg.norm(mu))
# --- 3. offline cascade
def pack(B): return np.packbits(B, axis=1).view(np.uint64)
def ham_top(XB, QB, m):
    out = np.empty((len(QB), m), dtype=np.int64)
    for i in range(len(QB)):
        d = np.bitwise_count(XB ^ QB[i]).sum(1, dtype=np.int32)
        p = np.argpartition(d, m)[:m]; out[i] = p[np.argsort(d[p], kind='stable')]
    return out
doc = lambda c: cd[c] if cd[c] is not None else ('__d', c)
def metrics(top):
    rr = []
    for i, r in enumerate(top):
        docs = list(dict.fromkeys(doc(int(c)) for c in r[:10]))
        rr.append(next((1 / (j + 1) for j, x in enumerate(docs) if x in gold[i]), 0.0))
    rec = np.mean([len(set(top[i][:10].tolist()) & set(gt[i].tolist())) / 10 for i in range(len(top))]) if gt is not None else float('nan')
    return np.array(rr), rec
def q8(A, scale): return np.round(np.clip(A * scale, -127, 127)).astype(np.int32)
def pervec(A): return np.round(A * (127 / np.abs(A).max(1, keepdims=True))).astype(np.int32), np.abs(A).max(1) / 127
gscale = 127 / np.percentile(absx, 99.99)
t = time.time()
S1 = {'sign': ham_top(pack(X5 > 0), pack(Q5 > 0), 250), 'centered': ham_top(pack(X5 > mu), pack(Q5 > mu), 250)}
print('stage-1 sim %.0fs' % (time.time() - t))
base = None
for s1name, C in S1.items():
    inS1 = np.mean([len(set(C[i].tolist()) & set(gt[i].tolist())) / 10 for i in range(len(C))])
    print(f'\n[{s1name}] exact top-10 inside stage-1 top-250: {inS1:.4f}')
    for qname in ('127', 'global', 'pervec', 'exact512'):
        top_w08, top_w1, keep_rec = [], [], []
        for i in range(len(C)):
            c = C[i]
            if qname == '127': sc = q8(X5[c], 127) @ q8(Q5[i], 127)
            elif qname == 'global': sc = q8(X5[c], gscale) @ q8(Q5[i], gscale)
            elif qname == 'pervec': v, sx = pervec(X5[c]); sc = (v @ q8(Q5[i], gscale)) * sx
            else: sc = X5[c] @ Q5[i]
            o = np.argsort(-sc, kind='stable')[:50]; pool = c[o]; s8 = sc[o].astype(np.float64)
            keep_rec.append(len(set(pool.tolist()) & set(gt[i].tolist())) / 10)
            full = Xn[pool] @ Qn[i]
            nz = lambda v: (v - v.min()) / (v.max() - v.min()) if v.max() > v.min() else np.full_like(v, .5)
            top_w08.append(pool[np.argsort(-(0.8 * nz(full) + 0.2 * nz(s8)), kind='stable')][:10])
            top_w1.append(pool[np.argsort(-full, kind='stable')][:10])
        r08, rec08 = metrics(top_w08); r1, rec1 = metrics(top_w1)
        if base is None: base = r08
        d = r08 - base; d1 = r1 - base
        print(f'  int8={qname:8} exact-top10 in pool50 {np.mean(keep_rec):.4f} | W=.8 MRR {r08.mean():.4f} ({d.mean():+.4f}) R@10 {rec08:.4f} | W=1 MRR {r1.mean():.4f} ({d1.mean():+.4f}) R@10 {rec1:.4f}')
