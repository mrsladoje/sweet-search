# <pylate venv>/bin/python -I rerun/colbert300.py --prep <BEIR prep dir> --cache <download dir> --out FILE.json
#
# Post-freeze check (owner approval 2026-10-17, after the external reviews; plan in
# paper/analysis/rerun-plan.md). Float32 ColBERTv2 reranking of BM25's top 100 gave a lower
# nDCG@10 on SciFact than the BM25 order itself. The BEIR prep encoded ColBERTv2 documents at
# its default length of 180 tokens, which cut about 9 in 10 documents. This script encodes the
# same documents again with the same model revision at 180 tokens (a control: it must give the
# paper's F value) and at 300 tokens, and reports nDCG@10 of contract F (float32 vectors,
# float64 arithmetic, mean over query tokens of the best dot product) for each. It changes no
# test of the paper: those compare storage formats on the same encoded vectors.
import argparse, json, math, os, sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import beir_prep  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument('--prep', required=True)
p.add_argument('--cache', required=True)
p.add_argument('--out', required=True)
p.add_argument('--lengths', default='180,300')
p.add_argument('--threads', type=int, default=os.cpu_count())
MODEL, REVISION, K = 'colbert-ir/colbertv2.0', 'c1e84128e85ef755c096a95bdb06b47793b13acf', 100


def ndcg_at(ranked, rel, n=10):
    gains = [rel.get(d, 0) for d in ranked[:n]]
    dcg = sum(g / math.log2(i + 2) for i, g in enumerate(gains))
    ideal = sorted(rel.values(), reverse=True)[:n]
    idcg = sum(g / math.log2(i + 2) for i, g in enumerate(ideal))
    return dcg / idcg if idcg > 0 else 0.0


def main(a):
    import torch
    from pylate import models
    torch.set_num_threads(a.threads)
    res = dict(model=MODEL, revision=REVISION, k=K, results={})
    for ds in ('scifact', 'nfcorpus'):
        rd = os.path.join(a.prep, 'raw', f'{ds}-colbertv2')
        qids = json.load(open(os.path.join(rd, 'query_ids.json')))
        bm25 = json.load(open(os.path.join(rd, 'bm25.json')))
        rel = {}
        for i, line in enumerate(open(os.path.join(rd, 'qrels.tsv'))):
            if i:
                q, d, s = line.rstrip('\n').split('\t')
                if int(s) > 0:
                    rel.setdefault(q, {})[d] = int(s)
        corpus, _, qtext, _, _ = beir_prep.fetch_beir(ds, a.cache)
        text = dict(corpus)
        need = sorted({d for q in qids for d, _ in bm25[q][:K]})
        for L in [int(x) for x in a.lengths.split(',')]:
            m = models.ColBERT(model_name_or_path=MODEL, device='cpu', revision=REVISION, document_length=L)
            D = dict(zip(need, beir_prep.encode(m, [text[d] for d in need], False)))
            Q = beir_prep.encode(m, [qtext[q] for q in qids], True)
            nd = []
            for q, qv in zip(qids, Q):
                ids = [d for d, _ in bm25[q][:K]]
                qv64 = qv.astype(np.float64)
                sc = np.array([(qv64 @ D[d].astype(np.float64).T).max(axis=1).mean() for d in ids])
                nd.append(ndcg_at([ids[i] for i in np.argsort(-sc, kind='stable')], rel.get(q, {})))
            res['results'][f'{ds}|{L}'] = dict(document_length=L, queries=len(qids), docs=len(need),
                                               mean_doc_tokens=float(np.mean([v.shape[0] for v in D.values()])), ndcg10=float(np.mean(nd)))
            print(ds, L, 'done', flush=True)
    json.dump(res, open(a.out, 'w'), indent=1)


if __name__ == '__main__':
    main(p.parse_args())
