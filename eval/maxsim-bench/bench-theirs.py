# venv/bin/python -I bench-theirs.py <replay-root> <out.json> [reps]
# Same replayed calls as bench-ours.mjs. Docs are dequantized from the captured int4 /
# int8 storage and divided by the STORED per-token norms; the query is L2-normalized.
# Then sum-of-max-dot / numQ == our contract whenever every per-query max is > 0.
import json, os, sys, time, glob
import numpy as np, torch, maxsim_cpu
root, out = sys.argv[1], sys.argv[2]
reps = int(sys.argv[3]) if len(sys.argv) > 3 else 7

def load(root):
    calls = []
    for repo in sorted(os.listdir(root)):
        d = os.path.join(root, repo)
        if not os.path.isdir(d): continue
        for idx in sorted(glob.glob(os.path.join(d, 'index-*.jsonl'))):
            for line in open(idx):
                m = json.loads(line); buf = open(os.path.join(d, m['file']), 'rb').read(); off = 0
                def take(n):
                    nonlocal off; b = buf[off:off + n]; off += n; return b
                nq, dim = m['numQ'], m['dim']
                q = np.frombuffer(take(nq * dim * 4), np.float32).reshape(nq, dim)
                cands = []
                for c in m['cands']:
                    nt = c['nt']; raw = np.frombuffer(take(c['tb']), np.uint8)
                    if m['kind'] == 'perdoc':
                        cands.append(dict(kind='perdoc', raw=raw, nt=nt, mn=c['min'], sc=c['scale'])); continue
                    mn = np.frombuffer(take(nt * 4), np.float32); sc = np.frombuffer(take(nt * 4), np.float32); nr = np.frombuffer(take(nt * 4), np.float32)
                    cands.append(dict(kind=m['kind'], raw=raw, nt=nt, mn=mn, sc=sc, nr=nr))
                calls.append(dict(repo=repo, file=m['file'], kind=m['kind'], q=q, dim=dim, cands=cands))
    return calls

def dequant(c, dim):
    nt = c['nt']
    if c['kind'] == 'int4':
        b = c['raw'].reshape(nt, (dim + 1) // 2)
        nib = np.empty((nt, b.shape[1] * 2), np.uint8); nib[:, 0::2] = b & 15; nib[:, 1::2] = b >> 4
        f = nib[:, :dim].astype(np.float32) * c['sc'][:, None] + c['mn'][:, None]
    elif c['kind'] == 'pertoken':
        f = (c['raw'].view(np.int8).reshape(nt, dim).astype(np.float32) + 128) * c['sc'][:, None] + c['mn'][:, None]
    else:
        f = (c['raw'].view(np.int8).reshape(nt, dim).astype(np.float32) + 128) * c['sc'] + c['mn']
        return f / (np.linalg.norm(f, axis=1, keepdims=True) + 1e-8)
    return f / (c['nr'][:, None] + 1e-8)

def qnorm(q): return np.ascontiguousarray(q / np.linalg.norm(q, axis=1, keepdims=True))

def torch_padded(qn, docs):
    L = max(d.shape[0] for d in docs); D = torch.zeros(len(docs), L, qn.shape[1]); mask = torch.zeros(len(docs), L, dtype=torch.bool)
    for i, d in enumerate(docs): D[i, :d.shape[0]] = torch.from_numpy(d); mask[i, :d.shape[0]] = True
    s = torch.einsum('qd,bld->bql', torch.from_numpy(qn), D).masked_fill(~mask[:, None, :], -1e9)
    return s.max(-1).values.sum(-1).numpy()

calls = load(root)
for c in calls: c['docs'] = [np.ascontiguousarray(dequant(x, c['dim'])) for x in c['cands']]
arms = {
    'maxsim_cpu': lambda c: maxsim_cpu.maxsim_scores_variable(qnorm(c['q']), c['docs']),
    'maxsim_cpu+dequant': lambda c: maxsim_cpu.maxsim_scores_variable(qnorm(c['q']), [dequant(x, c['dim']) for x in c['cands']]),
    'numpy': lambda c: np.array([(qnorm(c['q']) @ d.T).max(1).sum() for d in c['docs']]),
    'torch_padded': lambda c: torch_padded(qnorm(c['q']), c['docs']),
}
res = dict(reps=reps, torch_threads=torch.get_num_threads(), arms={a: dict(lat=[], scores=[]) for a in arms})
for c in calls:
    for a, f in arms.items():
        s = f(c); ts = []
        for _ in range(reps):
            t0 = time.perf_counter(); s = f(c); ts.append((time.perf_counter() - t0) * 1e3)
        ts.sort(); res['arms'][a]['lat'].append(ts[len(ts) // 2]); res['arms'][a]['scores'].append((np.asarray(s, np.float64) / c['q'].shape[0]).tolist())
res['calls'] = [dict(repo=c['repo'], file=c['file']) for c in calls]
json.dump(res, open(out, 'w'))
for a in arms:
    l = sorted(res['arms'][a]['lat']); print(a, f"n={len(l)} p50={l[len(l)//2]:.3f}ms p95={l[int(len(l)*0.95)]:.3f}ms total={sum(l):.1f}ms")
