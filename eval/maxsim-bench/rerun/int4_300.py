# <pylate venv>/bin/python -I rerun/int4_300.py --prep <BEIR prep dir> --cache <download dir> --capi <libss_maxsim_capi> --out FILE.json
#
# Post-freeze check, post hoc and descriptive. The int4 non-inferiority test of the paper ran on
# ColBERTv2 documents encoded at the model's default length of 180 tokens, which cuts about 9 in
# 10 documents (rerun/colbert300.py). This script encodes the same documents with the same model
# revision at 180 tokens (control: it must give the paper's F and K) and at 300 tokens, stores
# them with the production int4 quantizer, and scores BM25's top 100 per query with
#   F    float32 vectors, float64 arithmetic, no clamp
#   K    the kernel itself (production source through the C ABI, contract S with clamp)
#   Q+c  int4 decoded in float64, contract S with clamp (must equal K in nDCG@10)
#   C-b  int4 decoded in float64, contract C (cosine of the decoded tokens, no clamp)
# It reports nDCG@10 per source and the paired bootstrap of K - F and C-b - F with the paper's
# statistics (quality.py: 10,000 resamples, seed 42, margin 0.01). The BEIR queries were seen
# in the main test, so this is not a new confirmatory test. Aggregates only.
import argparse, ctypes, json, os, sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import beir_prep  # noqa: E402
import quality  # noqa: E402  (ndcg_at, rerank, paired_test; reused unchanged)
from quantize_int4 import quantize_int4_per_token  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument('--prep', required=True)
p.add_argument('--cache', required=True)
p.add_argument('--capi', required=True)
p.add_argument('--out', required=True)
p.add_argument('--lengths', default='180,300')
p.add_argument('--threads', type=int, default=os.cpu_count())
MODEL, REVISION, K, DELTA, EPS = 'colbert-ir/colbertv2.0', 'c1e84128e85ef755c096a95bdb06b47793b13acf', 100, 0.01, 1e-8


def kernel(lib):
    vp, u32 = ctypes.c_void_p, ctypes.c_uint32
    lib.ss_maxsim_per_token.argtypes = [vp, u32, u32, u32, u32, vp, vp, vp, vp, vp, vp]
    lib.ss_maxsim_per_token.restype = None

    def score(q, cands):
        q = np.ascontiguousarray(q, dtype=np.float32)
        ptrs = [np.array([c[k].ctypes.data for c in cands], np.uintp) for k in ('raw', 'mn', 'sc', 'nr')]
        nts = np.array([c['nt'] for c in cands], np.uint32)
        out = np.empty(len(cands), np.float64)
        lib.ss_maxsim_per_token(q.ctypes.data, q.shape[0], q.shape[1], 4, len(cands), *[x.ctypes.data for x in ptrs],
                                nts.ctypes.data, out.ctypes.data)
        return out
    return score


def decode64(c, dim):
    b = c['raw']
    nib = np.empty((c['nt'], b.shape[1] * 2), np.uint8); nib[:, 0::2] = b & 15; nib[:, 1::2] = b >> 4
    return nib[:, :dim].astype(np.float64) * c['sc'].astype(np.float64)[:, None] + c['mn'].astype(np.float64)[:, None]


def main(a):
    import torch
    from pylate import models
    torch.set_num_threads(a.threads)
    score_k = kernel(ctypes.CDLL(a.capi))
    res = dict(model=MODEL, revision=REVISION, k=K, delta=DELTA, seed=quality.SEED, bootstrap_resamples=quality.BOOT, results={})
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
            store = {}
            for d, v in D.items():
                raw, mn, sc, nr = quantize_int4_per_token(v)
                store[d] = dict(raw=raw, mn=mn, sc=sc, nr=nr, nt=v.shape[0])
            nd = {s: [] for s in ('F', 'K', 'Q+c', 'C-b', 'BM25')}
            dim = None
            for q, qv in zip(qids, Q):
                ids = [d for d, _ in bm25[q][:K]]
                dim = qv.shape[1]
                q64 = qv.astype(np.float64)
                qn = np.linalg.norm(q64, axis=1)
                f, s, c = [], [], []
                for d in ids:
                    f.append((q64 @ D[d].astype(np.float64).T).max(axis=1).mean())
                    dh = decode64(store[d], dim)
                    dot = q64 @ dh.T
                    s.append(np.maximum((dot / (qn[:, None] * store[d]['nr'].astype(np.float64)[None, :] + EPS)).max(axis=1), 0).mean())
                    c.append((dot / (qn[:, None] * np.linalg.norm(dh, axis=1)[None, :])).max(axis=1).mean())
                kk = score_k(qv, [store[d] for d in ids])
                r = rel.get(q, {})
                nd['BM25'].append(quality.ndcg_at(ids, r))
                for name, sc_ in (('F', f), ('K', kk), ('Q+c', s), ('C-b', c)):
                    nd[name].append(quality.ndcg_at(quality.rerank(ids, sc_), r))
            row = dict(document_length=L, queries=len(qids), docs=len(need),
                       mean_doc_tokens=float(np.mean([v.shape[0] for v in D.values()])),
                       ndcg10={k_: float(np.mean(v)) for k_, v in nd.items()},
                       K_vs_F=quality.paired_test(nd['K'], nd['F'], DELTA),
                       Cb_vs_F=quality.paired_test(nd['C-b'], nd['F'], DELTA))
            res['results'][f'{ds}|{L}'] = row
            print(ds, L, {k_: round(v, 4) for k_, v in row['ndcg10'].items()}, 'K-F', round(row['K_vs_F']['mean_diff'], 4),
                  [round(x, 4) for x in row['K_vs_F']['ci95']], flush=True)
    json.dump(res, open(a.out, 'w'), indent=1)


if __name__ == '__main__':
    main(p.parse_args())
