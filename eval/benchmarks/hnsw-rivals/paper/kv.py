# k_v per set and model, on dev only (PAPER_PLAN.md section 4): the smallest number of vectors k_v at which
# the exact vector list yields 10 distinct documents (self-matches removed) for >= 99.9% of dev queries.
# Quora (self_match) systems then return k_v + 1 vectors. Writes nothing; print the value for set.json /
# shortlist.json at the freeze.
# usage: python kv.py <DATA> <set> <model> [--share 0.999]
import sys
import numpy as np

import quality as Q

data, name, model = sys.argv[1:4]
share = float(sys.argv[sys.argv.index('--share') + 1]) if '--share' in sys.argv else 0.999
S = Q.load_set(data, name)
gt = Q.read_gt(data, model, name, 'dev')
qidx = Q.split_index(S, 'dev')
need = np.full(len(qidx), 10 ** 9)
for i, qi in enumerate(qidx):
    seen = set()
    for k, v in enumerate(gt['vecs'][i]):
        if v < 0:
            break
        d = int(S.doc_of_vec[v])
        if d == S.self_doc[qi]:
            continue
        seen.add(d)
        if len(seen) == 10:
            need[i] = k + 1
            break
ok = need < 10 ** 9
kv = int(np.quantile(need[ok], share, method='higher')) if ok.mean() >= share else None
print(f'{name}/{model}: k_v = {kv} ({share:.1%} of {len(qidx)} dev queries reach 10 documents; '
      f'{(~ok).sum()} need more than the 100 exact vectors kept; median {int(np.median(need[ok]))}, max {int(need[ok].max())})')
