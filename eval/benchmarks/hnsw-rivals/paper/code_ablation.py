# Post hoc (after the held-out runs; descriptive, not pre-registered): which binary code keeps task quality?
# Stage 1 is an exact Hamming scan of one code variant, top C candidates (ties: lower vector id); every candidate is
# rescored with the float32 cosine and the list is mapped to documents by the shared evaluation (quality.py).
# This isolates the code: no graph, no int8 screen, no float16. Variants:
#   sign512   sign of the first 512 dimensions (the product's code)
#   sign768   sign of all 768 dimensions
#   rot512    random orthogonal rotation of the 768-d vector (seed 42), then the sign of the first 512
#   rot768    the same rotation, sign of all 768
# Held-out queries, aggregate only: retained share mean(Q) / mean(Q_exact) and whether it meets f = 0.99 by the
# selection rule's one-sided 97.5% cluster-bootstrap bound.
#   python code_ablation.py --data DATA [--sets gcsn,...] [--models ...] [--out code-ablation.json]
import argparse, json, os, sys, time
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import quality as Q  # noqa: E402
import stats  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--data', required=True)
ap.add_argument('--sets', default='gcsn,d20k,advtest,fiqa,dall,quora,csn1m')
ap.add_argument('--models', default='CodeRankEmbed,jina-v2-base-code,bge-base-en-v1.5')
ap.add_argument('--budgets', default='100,200,400')
ap.add_argument('--out', default=os.path.join(HERE, 'code-ablation.json'))
a = ap.parse_args()
BUD = [int(x) for x in a.budgets.split(',')]
CMAX = max(BUD)
ROT = np.linalg.qr(np.random.default_rng(42).standard_normal((768, 768)))[0].astype(np.float32)
VARIANTS = ('sign512', 'sign768', 'rot512', 'rot768')


def codes(X, v):
    Y = X @ ROT if v.startswith('rot') else X
    w = 512 if v.endswith('512') else 768
    return np.where(Y[:, :w] >= 0, 1.0, -1.0).astype(np.float32)  # +-1: Hamming = (w - dot) / 2


res = json.load(open(a.out)) if os.path.exists(a.out) else []
done = {(r['set'], r['model'], r['variant']) for r in res}
for s in a.sets.split(','):
    S = Q.load_set(a.data, s); qidx = Q.split_index(S, 'ho')
    boot = stats.ClusterBoot([S.clusters[i] for i in qidx])
    for m in a.models.split(','):
        if all((s, m, v) in done for v in VARIANTS):
            continue
        t0 = time.time()
        e = f'{a.data}/emb/{m}/{s}'
        X = np.fromfile(f'{e}/corpus.f32', dtype='<f4').reshape(-1, 768)
        Qv = np.fromfile(f'{e}/queries.f32', dtype='<f4').reshape(-1, 768)[qidx]
        assert X.shape[0] == S.n_vec, (s, m, X.shape, S.n_vec)
        X = X / np.linalg.norm(X, axis=1, keepdims=True); Qv = Qv / np.linalg.norm(Qv, axis=1, keepdims=True)
        qx = Q.exact_quality(S, a.data, m, 'ho')
        for v in VARIANTS:
            if (s, m, v) in done:
                continue
            CX, CQ = codes(X, v), codes(Qv, v)
            n = CX.shape[0]; top = np.empty((len(qidx), CMAX), dtype=np.int64)
            for b in range(0, len(qidx), 128):
                dot = CQ[b:b + 128] @ CX.T  # higher dot = smaller Hamming distance; integers, exact in float32
                key = (-dot).astype(np.int64) * n + np.arange(n)  # Hamming order, ties by lower vector id
                p = np.argpartition(key, CMAX - 1, axis=1)[:, :CMAX]
                top[b:b + 128] = np.take_along_axis(p, np.argsort(np.take_along_axis(key, p, axis=1), axis=1), axis=1)
            for C in BUD:
                vids = top[:, :C]
                sc = np.einsum('qd,qcd->qc', Qv, X[vids])  # float32 cosine of every candidate (rescoring all C)
                o = np.argsort(-sc, axis=1, kind='stable')
                vids, sc = np.take_along_axis(vids, o, 1).astype(np.int32), np.take_along_axis(sc, o, 1)
                q = Q.eval_lists_fast(S, qidx, vids, sc)['q']
                sel = stats.selection(boot, q, qx, 0.99)
                res.append(dict(set=s, model=m, variant=v, C=C, share=float(q.mean() / qx.mean()),
                                lower=0.99 + sel['lower'] / float(qx.mean()), meets=bool(sel['qualifies'])))
            print(f'{s} {m} {v}: ' + ' '.join(f"C{r['C']} {r['share']:.4f}" for r in res if (r['set'], r['model'], r['variant']) == (s, m, v))
                  + f' ({time.time() - t0:.0f}s)', file=sys.stderr, flush=True)
            json.dump(res, open(a.out, 'w'), indent=0)
        del X
