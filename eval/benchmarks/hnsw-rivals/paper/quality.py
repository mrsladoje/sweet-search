# Quality library (DESIGN.md section 4): set loading, list -> documents, MRR@10, nDCG@10,
# recall@10 of vectors, result record + .lists.bin reader.
# usage: import quality; S = quality.load_set(DATA, 'gcsn'); see check_irmeasures.py, stats.py
import json, math, os
import numpy as np

CUT = 10


class Set:
    pass


def load_set(data, name):
    d = f'{data}/sets/{name}'
    S = Set()
    S.name, S.dir = name, d
    S.meta = json.load(open(f'{d}/set.json'))
    S.self_match = bool(S.meta.get('self_match'))
    keys, vdoc = {}, []
    with open(f'{d}/vectors.jsonl') as f:
        for vid, line in enumerate(f):
            r = json.loads(line)
            k = r.get('doc') or f'__v{vid}'
            vdoc.append(keys.setdefault(k, len(keys)))
    S.doc_keys = list(keys)
    S.doc_of_vec = np.asarray(vdoc, dtype=np.int32)
    S.n_vec, S.n_docs = len(vdoc), len(keys)
    S.qids, S.splits, S.clusters, S.rel, S.rel_all, S.self_doc = [], [], [], [], [], []
    with open(f'{d}/queries.jsonl') as f:
        for line in f:
            r = json.loads(line)
            S.qids.append(r['qid'])
            S.splits.append(r['split'])
            S.clusters.append(r['cluster'])
            # judged documents of the corpus: doc id -> grade; every grade > 0 counts for the ideal
            S.rel.append({keys[k]: g for k, g in r['rel'].items() if k in keys})
            S.rel_all.append([g for g in r['rel'].values() if g > 0])
            S.self_doc.append(keys.get(r['qid'], -1) if S.self_match else -1)
    S.n_queries = len(S.qids)
    S.splits_arr = np.asarray(S.splits)
    return S


def split_index(S, split):
    """Positions in queries.jsonl of the queries of one split."""
    return np.nonzero(S.splits_arr == split)[0]


def to_docs(S, vids, scores, qi, cut=CUT):
    """One retained vector list -> ([doc ids], [doc scores]), at most `cut` documents.
    Self-match dropped first; doc score = max of its vector scores; score desc, ties lower doc id."""
    sd = S.self_doc[qi]
    best = {}
    for v, s in zip(vids, scores):
        if v < 0:
            continue
        d = int(S.doc_of_vec[v])
        if d == sd:
            continue
        if d not in best or s > best[d]:
            best[d] = s
    order = sorted(best.items(), key=lambda kv: (-kv[1], kv[0]))[:cut]
    return [d for d, _ in order], [s for _, s in order]


def mrr(S, qi, docs, cut=CUT):
    rel = S.rel[qi]
    for r, d in enumerate(docs[:cut]):
        if rel.get(d, 0) > 0:
            return 1.0 / (r + 1)
    return 0.0


def ndcg(S, qi, docs, cut=CUT):
    rel = S.rel[qi]
    dcg = sum(rel.get(d, 0) / math.log2(r + 2) for r, d in enumerate(docs[:cut]) if rel.get(d, 0) > 0)
    ideal = sorted(S.rel_all[qi], reverse=True)[:cut]
    idcg = sum(g / math.log2(r + 2) for r, g in enumerate(ideal))
    return dcg / idcg if idcg > 0 else 0.0


METRICS = {'mrr': mrr, 'ndcg': ndcg}


def default_metric(S):
    return 'ndcg' if S.meta.get('kind') == 'beir' else 'mrr'


def recall_vec(S, qi, vids, exact_vids, cut=CUT):
    """|first `cut` retained vids (self-match dropped) ∩ exact top-`cut` vids| / cut. List order is
    the system's own order."""
    sd = S.self_doc[qi]
    top = []
    for v in vids:
        if v < 0 or int(S.doc_of_vec[v]) == sd:
            continue
        top.append(int(v))
        if len(top) == cut:
            break
    ex = {int(v) for v in exact_vids[:cut] if v >= 0}
    return len(set(top) & ex) / cut


def eval_lists(S, qidx, vids, scores, metric=None, exact_vecs=None):
    """vids/scores: n x L arrays aligned with qidx (positions in queries.jsonl).
    Returns dict: q (per-query metric), n_docs (per-query document count), short (lists with < CUT
    documents), recall (per-query, if exact_vecs n x >=CUT given)."""
    fn = METRICS[metric or default_metric(S)]
    q = np.zeros(len(qidx))
    nd = np.zeros(len(qidx), dtype=np.int32)
    rc = np.zeros(len(qidx)) if exact_vecs is not None else None
    for i, qi in enumerate(qidx):
        docs, _ = to_docs(S, vids[i], scores[i], qi)
        nd[i] = len(docs)
        q[i] = fn(S, qi, docs)
        if rc is not None:
            rc[i] = recall_vec(S, qi, vids[i], exact_vecs[i])
    return {'q': q, 'n_docs': nd, 'short': int((nd < CUT).sum()), 'recall': rc}


def eval_lists_fast(S, qidx, vids, scores, metric=None, cut=CUT):
    """eval_lists without the per-query Python loop (same rules: self-match dropped, doc score = max of
    its vector scores, score desc then lower doc id, cut at `cut`). Returns the per-query metric and the
    number of lists with fewer than `cut` documents. Checked equal to eval_lists (select.py --check)."""
    n, L = vids.shape
    qidx = np.asarray(qidx)
    D = np.where(vids >= 0, S.doc_of_vec[np.clip(vids, 0, None)], -1).astype(np.int64)
    selfd = np.asarray(S.self_doc, dtype=np.int64)[qidx][:, None]
    valid = (D >= 0) & (D != selfd)
    row = np.repeat(np.arange(n), L)
    d, sc, ok = D.ravel(), scores.ravel().astype(np.float64), valid.ravel()
    d, sc, row = d[ok], sc[ok], row[ok]
    # the first entry of each (row, doc) in (row, doc, score desc) order holds the doc's max score
    o = np.lexsort((-sc, d, row))
    d, sc, row = d[o], sc[o], row[o]
    first = np.ones(len(d), bool)
    first[1:] = (row[1:] != row[:-1]) | (d[1:] != d[:-1])
    d, sc, row = d[first], sc[first], row[first]
    # documents per row by (score desc, doc asc), rank within row, keep rank < cut
    o = np.lexsort((d, -sc, row))
    d, row = d[o], row[o]
    start = np.searchsorted(row, np.arange(n))
    rank = np.arange(len(row)) - start[row]
    keep = rank < cut
    d, row, rank = d[keep], row[keep], rank[keep]
    ndocs = np.bincount(row, minlength=n)
    # judged grades via sorted (query, doc) keys
    m = metric or default_metric(S)
    if not hasattr(S, '_relkeys'):
        ks, gs = [], []
        for qi, rel in enumerate(S.rel):
            for doc, g in rel.items():
                if g > 0:
                    ks.append(qi * S.n_docs + doc); gs.append(g)
        o2 = np.argsort(ks)
        S._relkeys, S._relg = np.asarray(ks, dtype=np.int64)[o2], np.asarray(gs, dtype=np.float64)[o2]
    key = qidx[row].astype(np.int64) * S.n_docs + d
    pos = np.searchsorted(S._relkeys, key)
    pos_c = np.minimum(pos, len(S._relkeys) - 1)
    hit = (len(S._relkeys) > 0) & (S._relkeys[pos_c] == key)
    g = np.where(hit, S._relg[pos_c], 0.0)
    q = np.zeros(n)
    if m == 'mrr':
        h = np.nonzero(g > 0)[0]
        firsts = {}
        for r_, k_ in zip(row[h], rank[h]):  # few hits: first relevant rank per row
            if r_ not in firsts:
                firsts[r_] = k_
        for r_, k_ in firsts.items():
            q[r_] = 1.0 / (k_ + 1)
    else:
        dcg = np.zeros(n)
        np.add.at(dcg, row, g / np.log2(rank + 2.0))
        idcg = np.array([sum(gg / math.log2(r + 2) for r, gg in enumerate(sorted(S.rel_all[qi], reverse=True)[:cut]))
                         for qi in qidx])
        q = np.where(idcg > 0, dcg / np.where(idcg > 0, idcg, 1), 0.0)
    return {'q': q, 'n_docs': ndocs, 'short': int((ndocs < cut).sum())}


def read_gt(data, model, name, split):
    d = f'{data}/emb/{model}/{name}/gt'
    r = {}
    for k in ('docs', 'vecs'):
        ids = np.fromfile(f'{d}/{split}.{k}.i32', dtype='<i4').reshape(-1, 100)
        sc = np.fromfile(f'{d}/{split}.{k}.f64', dtype='<f8').reshape(-1, 100)
        r[k], r[k + '_scores'] = ids, sc
    return r


def exact_quality(S, data, model, split, metric=None):
    """Per-query quality of the exact document ranking (Q_exact), split order."""
    gt = read_gt(data, model, S.name, split)
    qidx = split_index(S, split)
    fn = METRICS[metric or default_metric(S)]
    return np.array([fn(S, qi, [int(d) for d in gt['docs'][i] if d >= 0]) for i, qi in enumerate(qidx)])


def read_record(path):
    """Result record + sidecar -> (record dict, vids int32 n_q x L, scores float32 n_q x L).
    Sidecar: <stem>.lists.bin = int32 vids then float32 scores, query-index order; vid -1 = empty."""
    rec = json.load(open(path))
    n, L = rec['n_queries'], rec['L']
    side = os.path.splitext(path)[0] + '.lists.bin'
    raw = np.fromfile(side, dtype=np.uint8)
    if raw.size != n * L * 8:
        raise ValueError(f'{side}: {raw.size} bytes, expected {n * L * 8}')
    vids = raw[:n * L * 4].view('<i4').reshape(n, L)
    scores = raw[n * L * 4:].view('<f4').reshape(n, L)
    return rec, vids, scores
