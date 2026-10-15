# H2 scorer (dev only): per tie order (seed) of h2.cpp, the dev quality (MRR@10 / nDCG@10) and recall@10 of
# vectors; the spread over seeds; the share of queries whose retained set or top-10 documents change vs seed 0;
# and the tie statistics at the stage-1 cut (queries whose cut splits a run of equal distances).
# usage: python h2score.py <DATA> <set> <model> <h2 out prefix> <H> <seeds>
import sys
import numpy as np

import quality as Q

data, name, model, pre = sys.argv[1:5]
H, seeds = int(sys.argv[5]), int(sys.argv[6])
S = Q.load_set(data, name)
qidx = Q.split_index(S, 'dev')
gt = Q.read_gt(data, model, name, 'dev')
n = len(qidx)
res, docs0 = [], None
for s in range(seeds):
    raw = np.fromfile(f'{pre}.s{s}.lists.bin', dtype=np.uint8)
    v = raw[:n * H * 4].view('<i4').reshape(n, H); sc = raw[n * H * 4:].view('<f4').reshape(n, H)
    r = Q.eval_lists(S, qidx, v, sc, exact_vecs=gt['vecs'])
    top = [Q.to_docs(S, v[i], sc[i], qi)[0] for i, qi in enumerate(qidx)]
    if s == 0:
        v0, docs0 = v, top
    res.append(dict(q=r['q'].mean(), rec=r['recall'].mean(),
                    set_changed=np.mean([set(v[i]) != set(v0[i]) for i in range(n)]),
                    top10_changed=np.mean([top[i] != docs0[i] for i in range(n)])))
t = np.loadtxt(f'{pre}.ties.tsv', skiprows=1, dtype=np.int64)
split = (t[:, 3] < t[:, 2])
metric = Q.default_metric(S)
print(f'{name}/{model} dev, C cut ties: {split.mean():.1%} of {n} queries split a tie run at the cut '
      f'(median run {int(np.median(t[split, 2])) if split.any() else 0}, median kept {int(np.median(t[split, 3])) if split.any() else 0})')
for s, r in enumerate(res):
    print(f"  seed {s}: {metric}@10 {r['q']:.4f}  R@10vec {r['rec']:.4f}  retained set changed {r['set_changed']:.1%}  top-10 docs changed {r['top10_changed']:.1%}")
qs = np.array([r['q'] for r in res])
print(f'  spread over {seeds} tie orders: {metric} min {qs.min():.4f} max {qs.max():.4f} (range {qs.max() - qs.min():.4f})')
