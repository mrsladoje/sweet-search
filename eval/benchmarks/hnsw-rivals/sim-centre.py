# Centering checks with paired CIs. usage: python sim2.py <setDir> <nq>
import sys, json, os, numpy as np
s = sys.argv[1]; NQ = int(sys.argv[2])
meta = json.load(open(f'{s}/meta.json')); cd = meta['chunkDoc']
X = np.fromfile(f'{s}/corpus768.bin', dtype=np.float32).reshape(-1, 768)
Q = np.fromfile(f'{s}/q768.bin', dtype=np.float32).reshape(-1, 768)
rng = np.random.default_rng(7); qi = np.sort(rng.choice(len(Q), min(NQ, len(Q)), replace=False))
Q = Q[qi]; gold = [set(meta['queries'][i]['gold'] or []) for i in qi]
nz = lambda A: A / np.linalg.norm(A, axis=1, keepdims=True)
Xn = nz(X); Qn = nz(Q); X5 = nz(X[:, :512]); Q5 = nz(Q[:, :512]); mu5 = X5.mean(0); mu = Xn.mean(0)
doc = lambda c: cd[c] if cd[c] is not None else ('__d', c)
def rr(top):
    out = []
    for i, r in enumerate(top):
        docs = list(dict.fromkeys(doc(int(c)) for c in r[:10]))
        out.append(next((1 / (j + 1) for j, x in enumerate(docs) if x in gold[i]), 0.0))
    return np.array(out)
def exact_top(XX, QQ, m=10):
    out = np.empty((len(QQ), m), dtype=np.int64)
    for b in range(0, len(QQ), 128):
        S = QQ[b:b+128] @ XX.T; P = np.argpartition(-S, m, axis=1)[:, :m]
        out[b:b+128] = np.take_along_axis(P, np.argsort(-np.take_along_axis(S, P, 1), 1), 1)
    return out
def pack(B): return np.packbits(B, axis=1).view(np.uint64)
def ham_top(XB, QB, m=250):
    out = np.empty((len(QB), m), dtype=np.int64)
    for i in range(len(QB)):
        d = np.bitwise_count(XB ^ QB[i]).sum(1, dtype=np.int32)
        p = np.argpartition(d, m)[:m]; out[i] = p[np.argsort(d[p], kind='stable')]
    return out
def cascade(C, XF, QF):  # int8 pool 50 by exact 512 (int8 scale shown not to matter), then W=1 on XF/QF
    top = []
    for i in range(len(C)):
        c = C[i]; pool = c[np.argsort(-(X5[c] @ Q5[i]), kind='stable')[:50]]
        top.append(pool[np.argsort(-(XF[pool] @ QF[i]), kind='stable')[:10]])
    return np.array(top)
def ci(d):
    b = [d[rng.integers(0, len(d), len(d))].mean() for _ in range(2000)]; return np.percentile(b, [2.5, 97.5])
res = {}
res['exact768'] = rr(exact_top(Xn, Qn))
Xc = nz(Xn - mu); Qc = nz(Qn - mu)
res['exact768-centered'] = rr(exact_top(Xc, Qc))
Cs = ham_top(pack(X5 > 0), pack(Q5 > 0)); Cc = ham_top(pack(X5 > mu5), pack(Q5 > mu5))
res['casc-sign-W1'] = rr(cascade(Cs, Xn, Qn))
res['casc-cent-W1'] = rr(cascade(Cc, Xn, Qn))
res['casc-sign-W1cent'] = rr(cascade(Cs, Xc, Qc))
res['casc-cent-W1cent'] = rr(cascade(Cc, Xc, Qc))
b = res['casc-sign-W1']
print(f'{os.path.basename(s)} nq={len(Q)} base=casc-sign-W1')
for k, v in res.items():
    lo, hi = ci(v - b); print(f'  {k:20} MRR {v.mean():.4f}  d {np.mean(v - b):+.4f} [{lo:+.4f},{hi:+.4f}]')
