# Exact ground truth (DESIGN.md section 3): for each query of a split, the top 100 documents
# (score = max cosine over the document's vectors, whole corpus, ties lower doc id) and the top 100
# vectors (ties lower vector id). Stored float32 vectors, normalised in float64, float64 matmul.
# usage: python gt.py <DATA> <set> <model> <split> [--block N]   (N = corpus rows per block)
# writes DATA/emb/<model>/<set>/gt/<split>.{docs,vecs}.{i32,f64} and <split>.json
# Memory: 8 B x n_vec x dim (normalised corpus) + 8 B x QB x n_docs (running maxima).
import argparse, hashlib, json, os, sys, time
import numpy as np
import quality

K = 100
QB = 256


def sha_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 24), b''):
            h.update(b)
    return h.hexdigest()


def normalise(x):
    x = x.astype(np.float64)
    n = np.sqrt((x * x).sum(axis=1))
    n[n == 0] = 1.0
    return x / n[:, None]


def top_k_desc(score, ids, k):
    """Indices of the k best by (score desc, id asc)."""
    return np.lexsort((ids, -score))[:k]


def compute(S, corpus, queries, qidx, block):
    n_vec, dim = corpus.shape
    perm = np.argsort(S.doc_of_vec, kind='stable')          # vectors of one document become contiguous
    docp = S.doc_of_vec[perm]
    Cn = np.empty((n_vec, dim), dtype=np.float64)
    for a in range(0, n_vec, 1 << 16):
        Cn[a:a + (1 << 16)] = normalise(np.asarray(corpus[perm[a:a + (1 << 16)]]))
    nq = len(qidx)
    docs_i, docs_s = np.full((nq, K), -1, dtype='<i4'), np.full((nq, K), -np.inf, dtype='<f8')
    vecs_i, vecs_s = np.full((nq, K), -1, dtype='<i4'), np.full((nq, K), -np.inf, dtype='<f8')
    t0 = time.time()
    for q0 in range(0, nq, QB):
        rows = np.arange(q0, min(q0 + QB, nq))
        Qn = normalise(np.asarray(queries[qidx[rows]]))
        docmax = np.full((len(rows), S.n_docs), -np.inf)
        cand_s = [[] for _ in rows]
        cand_v = [[] for _ in rows]
        selfs = [(r, S.self_doc[qidx[g]]) for r, g in enumerate(rows) if S.self_doc[qidx[g]] >= 0]
        for a in range(0, n_vec, block):
            b = min(a + block, n_vec)
            sc = Qn @ Cn[a:b].T                                    # float64 x float64
            for r, sd in selfs:                                    # self-match: drop doc and vectors
                lo, hi = np.searchsorted(docp, [sd, sd + 1])
                lo, hi = max(lo, a), min(hi, b)
                if lo < hi:
                    sc[r, lo - a:hi - a] = -np.inf
            dp = docp[a:b]
            starts = np.flatnonzero(np.r_[True, dp[1:] != dp[:-1]])
            red = np.maximum.reduceat(sc, starts, axis=1)
            dids = dp[starts]
            docmax[:, dids] = np.maximum(docmax[:, dids], red)
            if b - a > K:
                thr = np.partition(sc, (b - a) - K, axis=1)[:, (b - a) - K]
                mask = (sc >= thr[:, None]) & (sc > -np.inf)       # keeps every tie at the threshold
            else:
                mask = sc > -np.inf
            rr, cc = np.nonzero(mask)
            cut = np.searchsorted(rr, np.arange(len(rows) + 1))
            for r in range(len(rows)):
                c = cc[cut[r]:cut[r + 1]]
                cand_s[r].append(sc[r, c])
                cand_v[r].append(perm[a + c])
        for r in range(len(rows)):
            s, v = np.concatenate(cand_s[r]), np.concatenate(cand_v[r])
            o = top_k_desc(s, v, K)
            vecs_i[rows[r], :len(o)], vecs_s[rows[r], :len(o)] = v[o], s[o]
        if S.n_docs > K:
            thr = np.partition(docmax, S.n_docs - K, axis=1)[:, S.n_docs - K]
        for r in range(len(rows)):
            m = (docmax[r] >= thr[r]) if S.n_docs > K else np.ones(S.n_docs, bool)
            m &= docmax[r] > -np.inf
            ids = np.flatnonzero(m)
            o = top_k_desc(docmax[r][ids], ids, K)
            docs_i[rows[r], :len(o)], docs_s[rows[r], :len(o)] = ids[o], docmax[r][ids[o]]
        print(f'gt {rows[-1] + 1}/{nq} queries  {time.time() - t0:.0f}s', file=sys.stderr)
    return docs_i, docs_s, vecs_i, vecs_s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('data'), ap.add_argument('set'), ap.add_argument('model'), ap.add_argument('split')
    ap.add_argument('--block', type=int, default=1 << 16)
    a = ap.parse_args()
    data = os.path.expanduser(a.data)
    S = quality.load_set(data, a.set)
    ed = f'{data}/emb/{a.model}/{a.set}'
    model = json.load(open(f'{ed}/model.json'))
    dim = model['dim']
    corpus = np.memmap(f'{ed}/corpus.f32', dtype='<f4', mode='r').reshape(-1, dim)
    queries = np.memmap(f'{ed}/queries.f32', dtype='<f4', mode='r').reshape(-1, dim)
    assert corpus.shape[0] == S.n_vec and queries.shape[0] == S.n_queries, 'vector/query counts differ from the set'
    qidx = quality.split_index(S, a.split)
    t0 = time.time()
    outs = compute(S, corpus, queries, qidx, a.block)
    os.makedirs(f'{ed}/gt', exist_ok=True)
    names = ['docs.i32', 'docs.f64', 'vecs.i32', 'vecs.f64']
    out_sha = {}
    for n, arr in zip(names, outs):
        p = f'{ed}/gt/{a.split}.{n}'
        arr.tofile(p + '.tmp')
        os.replace(p + '.tmp', p)
        out_sha[n] = sha_file(p)
    inputs = {'set.json': f'{S.dir}/set.json', 'vectors.jsonl': f'{S.dir}/vectors.jsonl',
              'queries.jsonl': f'{S.dir}/queries.jsonl', 'model.json': f'{ed}/model.json',
              'corpus.f32': f'{ed}/corpus.f32', 'queries.f32': f'{ed}/queries.f32'}
    man = {'set': a.set, 'model': a.model, 'split': a.split, 'k': K, 'n_vectors': S.n_vec,
           'n_docs': S.n_docs, 'n_queries': int(len(qidx)), 'dim': dim, 'self_match': S.self_match,
           'arithmetic': 'stored float32 -> float64, L2-normalised in float64, float64 matmul; '
                         'doc score = max over its vectors; docs by (score desc, doc id asc); '
                         'vectors by (score desc, vid asc); empty slots -1 / -inf',
           'numpy': np.__version__,
           'inputs_sha256': {k: sha_file(p) for k, p in inputs.items()}, 'outputs_sha256': out_sha}
    p = f'{ed}/gt/{a.split}.json'
    json.dump(man, open(p + '.tmp', 'w'), indent=1, sort_keys=True)
    os.replace(p + '.tmp', p)
    print(f'gt {a.set}/{a.model}/{a.split}: {len(qidx)} queries in {time.time() - t0:.1f}s')


if __name__ == '__main__':
    main()
