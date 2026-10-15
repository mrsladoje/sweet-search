# Cross-check quality.py against ir_measures (and pytrec_eval, if importable) on the same document runs.
# Prints ONLY the query count and the max absolute difference; exit 1 if the difference exceeds 1e-9.
# usage: python check_irmeasures.py <DATA> <set> <model> <split> [result.json ...]
#   no result files: the exact run (gt documents) plus 3 seeded random perturbations of it.
import os, sys
import numpy as np
import ir_measures
from ir_measures import RR, nDCG
import quality

TOL = 1e-9


def runs_from_files(S, data, model, split, qidx, files):
    for p in files:
        _, vids, scores = quality.read_record(p)
        yield os.path.basename(p), [quality.to_docs(S, vids[i], scores[i], qi)[0] for i, qi in enumerate(qidx)]


def runs_default(S, data, model, split, qidx):
    gt = quality.read_gt(data, model, S.name, split)
    yield 'exact', [[int(d) for d in r[:10] if d >= 0] for r in gt['docs']]
    for seed in (1, 2, 3):                                     # noisy scores on the exact vector list
        rng = np.random.default_rng(seed)
        v, s = gt['vecs'], gt['vecs_scores'].copy()
        s[v >= 0] += rng.normal(0, 0.02, size=int((v >= 0).sum()))
        cut = rng.integers(3, 100, size=len(qidx))            # random list lengths, some below 10 documents
        yield f'perturbed{seed}', [quality.to_docs(S, v[i, :cut[i]], s[i, :cut[i]], qi)[0] for i, qi in enumerate(qidx)]


def main():
    data, name, model, split = os.path.expanduser(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4]
    S = quality.load_set(data, name)
    qidx = quality.split_index(S, split)
    keys = S.doc_keys
    qrels = [ir_measures.Qrel(S.qids[qi], k, g) for qi in qidx for k, g in _judged(S, qi)]
    judged = {q.query_id for q in qrels if q.relevance > 0}
    runs = runs_from_files(S, data, model, split, qidx, sys.argv[5:]) if len(sys.argv) > 5 \
        else runs_default(S, data, model, split, qidx)
    worst, nq = 0.0, 0
    for _, docs in runs:
        run = [ir_measures.ScoredDoc(S.qids[qi], keys[d], -float(r)) for qi, ds in zip(qidx, docs)
               for r, d in enumerate(ds)]                    # strictly decreasing score = our order
        ref = {}
        for m in ir_measures.iter_calc([RR @ 10, nDCG @ 10], qrels, run):
            ref[(m.query_id, str(m.measure))] = m.value
        for i, qi in enumerate(qidx):
            if S.qids[qi] not in judged:
                continue
            nq += 1
            for fn, mname in ((quality.mrr, 'RR@10'), (quality.ndcg, 'nDCG@10')):
                worst = max(worst, abs(fn(S, qi, docs[i]) - ref.get((S.qids[qi], mname), 0.0)))
        worst = max(worst, _pytrec(S, qidx, docs, qrels))
    print(f'queries {nq}  max_abs_diff {worst:.3e}')
    sys.exit(0 if worst <= TOL else 1)


def _judged(S, qi):
    # keep the original judged keys (also those outside the corpus)
    import json
    if not hasattr(S, '_raw_rel'):
        S._raw_rel = {}
        with open(f'{S.dir}/queries.jsonl') as f:
            for i, line in enumerate(f):
                S._raw_rel[i] = json.loads(line)['rel']
    return S._raw_rel[qi].items()


def _pytrec(S, qidx, docs, qrels):
    try:
        import pytrec_eval
    except ImportError:
        return 0.0
    qr = {}
    for q in qrels:
        qr.setdefault(q.query_id, {})[q.doc_id] = int(q.relevance)
    run = {S.qids[qi]: {S.doc_keys[d]: -float(r) for r, d in enumerate(ds)} for qi, ds in zip(qidx, docs) if ds}
    ev = pytrec_eval.RelevanceEvaluator(qr, {'recip_rank', 'ndcg_cut_10'})
    res = ev.evaluate(run)
    worst = 0.0
    for i, qi in enumerate(qidx):
        if S.qids[qi] not in qr or not any(g > 0 for g in qr[S.qids[qi]].values()):
            continue
        r = res.get(S.qids[qi], {})
        # recip_rank has no cut: compare it only on lists of at most 10 documents (ours)
        worst = max(worst, abs(quality.mrr(S, qi, docs[i]) - r.get('recip_rank', 0.0)),
                    abs(quality.ndcg(S, qi, docs[i]) - r.get('ndcg_cut_10', 0.0)))
    return worst


if __name__ == '__main__':
    main()
