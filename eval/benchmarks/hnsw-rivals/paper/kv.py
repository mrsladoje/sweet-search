# k_v per set and model, on dev only (PAPER_PLAN.md section 4): the smallest number of vectors k_v at which
# the exact vector list yields 10 distinct documents (self-matches removed) for >= 99.9% of dev queries.
# Quora (self_match) systems then return k_v + 1 vectors. Writes nothing; print the value for set.json /
# shortlist.json at the freeze. A query whose 100 stored exact vectors hold fewer than 10 documents gets its
# full exact vector list (float64, ties lower vid, as gt.py), so k_v may exceed 100.
# usage: python kv.py <DATA> <set> <model> [--share 0.999]
import json
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
deep = np.flatnonzero(need == 10 ** 9)
if len(deep):  # walk the whole exact list for these queries only
    ed = f'{data}/emb/{model}/{name}'
    dim = json.load(open(f'{ed}/model.json'))['dim']
    C = np.memmap(f'{ed}/corpus.f32', dtype='<f4', mode='r').reshape(-1, dim).astype(np.float64)
    C /= np.maximum(np.sqrt((C * C).sum(axis=1)), 1e-300)[:, None]
    Qv = np.memmap(f'{ed}/queries.f32', dtype='<f4', mode='r').reshape(-1, dim)
    for i in deep:
        qi = qidx[i]
        q = Qv[qi].astype(np.float64); q /= np.sqrt((q * q).sum()) or 1.0
        sc = C @ q
        seen, k = set(), 0
        for v in np.lexsort((np.arange(len(sc)), -sc)):
            d = int(S.doc_of_vec[v])
            if d == S.self_doc[qi]:  # self-match vectors are not in the list (gt.py)
                continue
            k += 1
            seen.add(d)
            if len(seen) == 10:
                need[i] = k
                break
reach = need < 10 ** 9
kv = int(np.quantile(need, share, method='higher')) if reach.mean() >= share else None
print(f'{name}/{model}: k_v = {kv} ({share:.1%} of {len(qidx)} dev queries reach 10 documents; '
      f'{len(deep)} needed more than the 100 stored exact vectors (deepest {int(need[reach].max())}); median {int(np.median(need[reach]))})')
