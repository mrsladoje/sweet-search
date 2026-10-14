# Kernel A/B scorer: for ours.mjs outputs in one set, versus a base arm.
# Per arm: MRR@10 (doc-level, as score4/mrr.py) with a paired bootstrap CI of the change vs base, recall@10 vs the
# exact 768-d top-10 (gt.bin, when present), mean top-K overlap with base, share of queries with identical results,
# and p50 / p90 of total and stage-1 time (median over the files given for that arm).
# usage: python abscore.py <setDir> <base-arm> <arm>=<f1.json>,<f2.json>... [<arm>=...]
import sys, json, os, numpy as np
s = sys.argv[1]; base = sys.argv[2]
arms = {}
for a in sys.argv[3:]:
    name, files = a.split('=', 1); arms[name] = [json.load(open(f'{s}/{f}')) for f in files.split(',')]
meta = json.load(open(f'{s}/meta.json')); cd = meta['chunkDoc']; gold = [set(q['gold'] or []) for q in meta['queries']]
doc = lambda c: cd[c] if cd[c] is not None else ('__d', c)
gt = np.fromfile(f'{s}/gt.bin', dtype=np.int32).reshape(-1, 10) if os.path.exists(f'{s}/gt.bin') else None
def rr(res):
    out = []
    for i, r in enumerate(res):
        docs = list(dict.fromkeys(doc(int(c)) for c in r[:10] if c >= 0))
        out.append(next((1 / (j + 1) for j, x in enumerate(docs) if x in gold[i]), 0.0))
    return np.array(out)
B = arms[base][0]['res']; nq = min(len(o['res']) for v in arms.values() for o in v)
rrB = rr(B[:nq]); rng = np.random.default_rng(42)
print(f"== {os.path.basename(s)} nq={nq} base={base}")
print(f"{'arm':22} {'MRR@10':>7} {'dMRR':>8} {'95% CI':>18} {'R@10':>6} {'ovl':>6} {'same':>6} {'p50':>6} {'p90':>6} {'s1p50':>6} {'runs p50':>20}")
for name, outs in arms.items():
    res = outs[0]['res'][:nq]; r = rr(res); d = r - rrB
    bs = [d[rng.integers(0, nq, nq)].mean() for _ in range(2000)]; lo, hi = np.percentile(bs, [2.5, 97.5])
    rec = np.mean([len(set(res[i][:10]) & set(gt[i].tolist())) / 10 for i in range(nq)]) if gt is not None else float('nan')
    ovl = np.mean([len(set(res[i]) & set(B[i])) / max(1, len(B[i])) for i in range(nq)])
    same = np.mean([res[i] == B[i] for i in range(nq)])
    # every run of this arm must give the same results
    stable = all(o['res'][:nq] == res for o in outs)
    p50s = [np.median(o['total_us'][:nq]) for o in outs]
    p50 = np.median(p50s); p90 = np.median([np.percentile(o['total_us'][:nq], 90) for o in outs])
    s1 = np.median([np.median(o['stage1_us'][:nq]) for o in outs])
    print(f"{name:22} {r.mean():7.4f} {d.mean():+8.4f} [{lo:+.4f},{hi:+.4f}] {rec:6.4f} {ovl:6.4f} {same:6.4f} {p50:6.0f} {p90:6.0f} {s1:6.0f} {'/'.join(f'{x:.0f}' for x in p50s):>20}{'' if stable else '  UNSTABLE'}")
