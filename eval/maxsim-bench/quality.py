#!/usr/bin/env python
# Quality of the BM25 candidate lists and of each score source, per dataset x model x k.
# MAY ONLY RUN AFTER THE FREEZE: it needs the FREEZE.json argument and refuses to run without it.
#
#   python quality.py FREEZE.json --prep PREP_DIR --results RESULTS_DIR --out OUT_DIR [--kernel IMPL]
#   python quality.py --selftest          (synthetic data only)
#
# Score sources
#   F    float32 vectors, float64 arithmetic, no clamp
#   F+c  as F with max(0, .) per query token
#   Q+c  int4 decoded in float64, contract S (per query token: max over doc tokens of
#        dot(q, d_hat) / (|q| * nr + 1e-8), clamp max(0, .), mean over query tokens)
#   K    the kernel's own per-candidate scores from the timing-run result JSON
#   rivals: every other implementation in the result JSONs, from its own recorded scores.
#
# Result JSON assumption (adjust READ_* helpers if the final format differs): one file per
# implementation x set, a dict (or a plain list) with calls = [{"file", "scores", "ts_ns"}, ...],
# plus "arm" (name) and, per call, "set" (replay set name, beir-<dataset>-<model>-k<k>).
import argparse, glob, json, math, os, re, sys, tempfile
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from quantize_int4 import quantize_int4_per_token  # noqa: E402

SEED = 42
BOOT = 10000
SET_RE = re.compile(r'beir-(.+?)-(answersmall|colbertv2)-k(\d+)')
PRIMARY_K = 100
PRIMARY_PAIRS = [(d, m) for m in ('colbertv2', 'answersmall') for d in ('scifact', 'nfcorpus')]


# ---------- metrics ----------
def ndcg_at(ranked_ids, rel, n=10):
    """rel: dict doc -> gain (>0 only). Linear gain, log2(rank+1) discount, ideal from ALL judged docs."""
    gains = [rel.get(d, 0) for d in ranked_ids[:n]]
    dcg = sum(g / math.log2(i + 2) for i, g in enumerate(gains))
    ideal = sorted(rel.values(), reverse=True)[:n]
    idcg = sum(g / math.log2(i + 2) for i, g in enumerate(ideal))
    return dcg / idcg if idcg > 0 else 0.0


def recall_at(ranked_ids, rel, n):
    return len(set(ranked_ids[:n]) & set(rel)) / len(rel) if rel else 0.0


def rerank(cand_ids, scores):
    """Descending score; ties keep BM25 order."""
    order = np.argsort(-np.asarray(scores, dtype=np.float64), kind='stable')
    return [cand_ids[i] for i in order]


# ---------- statistics ----------
def boot_means(d, B=BOOT, seed=SEED):
    """Means of B paired-bootstrap resamples (queries drawn with replacement)."""
    rng = np.random.default_rng(seed)
    n = len(d)
    idx = rng.integers(0, n, size=(B, n))
    return d[idx].mean(axis=1)


def paired_test(a, b, delta, B=BOOT, seed=SEED):
    """Non-inferiority of a vs b on per-query values (same queries). H0: mean(a-b) <= -delta.
    CI: 2.5/97.5 percentiles of the bootstrap means of the differences. p: shift the bootstrap
    distribution to the null (centre on the observed mean, true difference = -delta), p =
    (1 + #{boot_mean - obs_mean >= obs_mean + delta}) / (B + 1)."""
    d = np.asarray(a, np.float64) - np.asarray(b, np.float64)
    obs = float(d.mean())
    bm = boot_means(d, B, seed)
    lo, hi = np.percentile(bm, [2.5, 97.5])
    p = (1 + int(np.sum((bm - obs) >= (obs + delta)))) / (B + 1)
    mb = float(np.mean(b))
    rel = obs / mb if mb else float('nan')
    # relative loss: bootstrap of mean(a)/mean(b) - 1 with the same resamples
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(d), size=(B, len(d)))
    ra = np.asarray(a, np.float64)[idx].mean(axis=1)
    rb = np.asarray(b, np.float64)[idx].mean(axis=1)
    rr = ra / np.where(rb == 0, np.nan, rb) - 1
    rlo, rhi = np.nanpercentile(rr, [2.5, 97.5])
    return dict(n=len(d), mean_diff=obs, ci95=[float(lo), float(hi)], p_noninferior=p,
                no_material_loss=bool(lo > -delta), rel_diff=rel, rel_ci95=[float(rlo), float(rhi)],
                mean_a=float(np.mean(a)), mean_b=mb)


def holm(ps):
    """Holm step-down adjusted p-values, in the input order."""
    m = len(ps)
    order = np.argsort(ps, kind='stable')
    adj = [0.0] * m
    run = 0.0
    for rank, i in enumerate(order):
        run = max(run, min(1.0, (m - rank) * ps[i]))
        adj[i] = run
    return adj


# ---------- score sources from vectors ----------
def contract_scores(q, docs, dnorms, clamp):
    """q (nq, dim) f32; docs: list of (nt, dim) float64 matrices; dnorms: list of (nt,) float64.
    Returns one score per doc: mean over query tokens of max over doc tokens of
    dot / (|q| * n + 1e-8), optionally clamped at 0 per query token."""
    q64 = q.astype(np.float64)
    qn = np.sqrt((q64 ** 2).sum(1))
    cat = np.concatenate(docs)
    n = np.concatenate(dnorms)
    s = (q64 @ cat.T) / (qn[:, None] * n[None, :] + 1e-8)
    offs = np.cumsum([0] + [len(x) for x in docs])[:-1]
    mx = np.maximum.reduceat(s, offs, axis=1)          # (nq, ndocs)
    if clamp:
        mx = np.maximum(mx, 0.0)
    return mx.mean(axis=0)


def decode_int4(raw, mn, sc, dim):
    nt = raw.shape[0]
    nib = np.empty((nt, raw.shape[1] * 2), np.float64)
    nib[:, 0::2] = raw & 15
    nib[:, 1::2] = raw >> 4
    return nib[:, :dim] * sc.astype(np.float64)[:, None] + mn.astype(np.float64)[:, None]


def vector_sources(q, docs_f32):
    """F, F+c, Q+c scores for one query and its candidate docs (list of float32 (nt, dim))."""
    f64 = [d.astype(np.float64) for d in docs_f32]
    fn = [np.sqrt((d ** 2).sum(1)) for d in f64]
    dim = docs_f32[0].shape[1]
    qd, qn = [], []
    for d in docs_f32:
        raw, mn, sc, nr = quantize_int4_per_token(d)
        qd.append(decode_int4(raw, mn, sc, dim))
        qn.append(nr.astype(np.float64))
    return {'F': contract_scores(q, f64, fn, False),
            'F+c': contract_scores(q, f64, fn, True),
            'Q+c': contract_scores(q, qd, qn, True)}


# ---------- reading files ----------
def read_prep(prep, ds, mk):
    rd = os.path.join(prep, 'raw', f'{ds}-{mk}')
    r = dict(
        dflat=np.load(os.path.join(rd, 'doc_tokens.npy'), mmap_mode='r'),
        doff=np.load(os.path.join(rd, 'doc_offsets.npy')),
        qflat=np.load(os.path.join(rd, 'query_tokens.npy'), mmap_mode='r'),
        qoff=np.load(os.path.join(rd, 'query_offsets.npy')),
        doc_ids=json.load(open(os.path.join(rd, 'doc_ids.json'))),
        qids=json.load(open(os.path.join(rd, 'query_ids.json'))),
        bm25=json.load(open(os.path.join(rd, 'bm25.json'))),
    )
    r['dpos'] = {d: i for i, d in enumerate(r['doc_ids'])}
    rel = {}
    for i, line in enumerate(open(os.path.join(rd, 'qrels.tsv'))):
        if i == 0:
            continue
        q, d, s = line.rstrip('\n').split('\t')
        if int(s) > 0:
            rel.setdefault(q, {})[d] = int(s)
    r['rel'] = rel
    return r


def read_results(results_dir):
    """Yield (impl, ds, mk, k, calls) from the run_matrix.py result files under results_dir
    (<machine>/<tag>/<group>/<arm>.r<round>.p<proc>.json; one file holds many sets). Calls
    are grouped by their own "set" field; the rounds and process repetitions of one arm
    are merged per call: scores from the first run (an arm's scores do not change between
    runs of one build), ts_ns pooled over every run. Concurrency results are skipped."""
    merged = {}
    for p in sorted(glob.glob(os.path.join(results_dir, '**', '*.r*.p*.json'), recursive=True)):
        try:
            j = json.load(open(p))
        except Exception:
            continue
        if not isinstance(j, dict) or not j.get('complete'):
            continue
        impl = str(j.get('arm') or os.path.basename(p).split('.r')[0])
        tag = os.path.basename(os.path.dirname(os.path.dirname(p)))
        for c in j.get('calls', []):
            m = SET_RE.search(str(c.get('set', '')))
            if not m or 'scores' not in c:
                continue
            key = (f'{impl}@{tag}' if 'parked' in tag else impl, m.group(1), m.group(2), int(m.group(3)))
            rec = merged.setdefault(key, {}).setdefault(c['file'], dict(c, ts_ns=[]))
            rec['ts_ns'] = rec['ts_ns'] + list(c.get('ts_ns', []))
    for (impl, ds, mk, k), calls in sorted(merged.items()):
        yield impl, ds, mk, k, list(calls.values())


def read_provenance(prep, ds, mk, k):
    pv = {}
    f = os.path.join(prep, 'sets', f'beir-{ds}-{mk}-k{k}', ds, 'provenance.jsonl')
    for line in open(f):
        r = json.loads(line)
        pv[r['file']] = r['query_id']
    return pv


# ---------- per-query metrics for one score source ----------
def per_query(qids, bm25, rel, k, scores_by_q):
    nd, rc = [], []
    for q in qids:
        cand = [d for d, _ in bm25[q][:k]]
        r = rel.get(q, {})
        ranked = rerank(cand, scores_by_q[q][:k])
        nd.append(ndcg_at(ranked, r, 10))
        rc.append(recall_at(ranked, r, 100) if k >= 100 else float('nan'))
    return np.array(nd), np.array(rc)


def pct(x, p):
    return float(np.percentile(np.asarray(x, np.float64), p))


# ---------- main run ----------
def run(args):
    try:
        freeze = json.load(open(args.freeze))
    except Exception as e:
        sys.exit(f'cannot read FREEZE file: {e}')
    delta = float(freeze.get('delta', 0.01))
    kernel = args.kernel or freeze.get('kernel_impl')
    prep = args.prep
    out = {'freeze': args.freeze, 'delta': delta, 'seed': SEED, 'bootstrap_resamples': BOOT,
           'kernel_impl': kernel, 'cells': {}, 'primary': [], 'secondary': [], 'latency': {}}
    results = {}
    for impl, ds, mk, k, calls in read_results(args.results):
        results.setdefault((ds, mk), {}).setdefault(k, {})[impl] = calls
    datasets = sorted({ds for ds, _ in results})
    cells = sorted({(ds, mk) for ds, mk in results})
    srcs = {}
    for ds, mk in cells:
        P = read_prep(prep, ds, mk)
        qids = P['qids']
        kmax = max(results[(ds, mk)])
        vec = {s: {} for s in ('F', 'F+c', 'Q+c')}
        for qi, q in enumerate(qids):
            qv = np.asarray(P['qflat'][P['qoff'][qi]:P['qoff'][qi + 1]])
            ids = [d for d, _ in P['bm25'][q][:kmax]]
            docs = [np.asarray(P['dflat'][P['doff'][P['dpos'][d]]:P['doff'][P['dpos'][d] + 1]]) for d in ids]
            sc = vector_sources(qv, docs)
            for s in vec:
                vec[s][q] = sc[s]
        srcs[(ds, mk)] = (P, vec)

    per_q = {}   # (ds, mk, k, source) -> per-query ndcg array in P['qids'] order
    for (ds, mk), (P, vec) in srcs.items():
        qids = P['qids']
        for k in sorted(results[(ds, mk)]):
            cell = {'k': k, 'candidate_recall_at_k': float(np.mean([recall_at([d for d, _ in P['bm25'][q][:k]], P['rel'].get(q, {}), k) for q in qids])),
                    'sources': {}}
            names = dict(vec)
            for impl, calls in results[(ds, mk)][k].items():
                pv = read_provenance(prep, ds, mk, k)
                byq = {pv[c['file']]: np.asarray(c['scores'], np.float64) for c in calls}
                if set(byq) != set(qids):
                    print(f'WARNING {impl} {ds} {mk} k={k}: {len(byq)} of {len(qids)} queries scored')
                    continue
                names[('K' if impl == kernel else f'rival:{impl}')] = byq
                # latency: pooled over all timed repetitions of all calls
                ts = np.concatenate([np.asarray(c.get('ts_ns') or [], np.float64) for c in calls]) / 1e6
                if ts.size:
                    out['latency'].setdefault(f'{impl}|{ds}|{mk}', []).append(
                        {'k': k, 'p50_ms': pct(ts, 50), 'p95_ms': pct(ts, 95), 'n_timed': int(ts.size)})
            for name, sbq in names.items():
                key = name if isinstance(name, str) else name[0]
                nd, rc = per_query(qids, P['bm25'], P['rel'], k, sbq)
                per_q[(ds, mk, k, key)] = nd
                cell['sources'][key] = {'ndcg10': float(nd.mean()),
                                        'recall100': None if k < 100 else float(np.nanmean(rc))}
            out['cells'][f'{ds}|{mk}|k{k}'] = cell
    # attach nDCG@10 to the latency points
    for lk, pts in out['latency'].items():
        impl, ds, mk = lk.split('|')
        for pt in pts:
            c = out['cells'].get(f'{ds}|{mk}|k{pt["k"]}')
            key = 'K' if impl == kernel else f'rival:{impl}'
            pt['ndcg10'] = c['sources'][key]['ndcg10'] if c and key in c['sources'] else None
        pts.sort(key=lambda p: p['k'])

    # primary: K - F at k = PRIMARY_K
    prim = []
    for ds, mk in PRIMARY_PAIRS:
        a, b = per_q.get((ds, mk, PRIMARY_K, 'K')), per_q.get((ds, mk, PRIMARY_K, 'F'))
        if a is None or b is None:
            continue
        t = paired_test(a, b, delta)
        t.update(dataset=ds, model=mk, k=PRIMARY_K, contrast='K - F')
        prim.append(t)
    for t, adj in zip(prim, holm([t['p_noninferior'] for t in prim])):
        t['p_holm'] = adj
        t['noninferior_holm_0.05'] = bool(adj < 0.05)
    out['primary'] = prim
    for (ds, mk, k, key), nd in sorted(per_q.items()):
        if key == 'Q+c':
            f = per_q[(ds, mk, k, 'F')]
            t = paired_test(nd, f, delta)
            t.update(dataset=ds, model=mk, k=k, contrast='Q+c - F')
            out['secondary'].append(t)
    os.makedirs(args.out, exist_ok=True)
    json.dump(out, open(os.path.join(args.out, 'quality.json'), 'w'), indent=1)
    open(os.path.join(args.out, 'quality.md'), 'w').write(render_md(out))
    print('wrote quality.json and quality.md')


def render_md(o):
    L = [f'# Quality of the BM25 candidate lists and of each score source', '',
         f'delta = {o["delta"]} (absolute nDCG@10, from FREEZE.json). Paired bootstrap over queries, '
         f'{o["bootstrap_resamples"]} resamples, seed {o["seed"]}.', '',
         'p-value: one-sided non-inferiority (H0: mean difference <= -delta). The bootstrap distribution of the mean '
         'difference is centred on the observed mean; p = (1 + #{centred resample >= observed + delta}) / (B + 1). '
         'Holm step-down over the four primary comparisons (k = 100).', '',
         '## Primary: K - F, nDCG@10 at k = 100', '',
         '| dataset | model | n | mean K - F | 95% CI | relative | rel. 95% CI | p | Holm p | no material loss (CI) | non-inferior (Holm) |',
         '|---|---|---|---|---|---|---|---|---|---|---|']
    for t in o['primary']:
        L.append(f'| {t["dataset"]} | {t["model"]} | {t["n"]} | {t["mean_diff"]:+.4f} | [{t["ci95"][0]:+.4f}, {t["ci95"][1]:+.4f}] | '
                 f'{t["rel_diff"]:+.2%} | [{t["rel_ci95"][0]:+.2%}, {t["rel_ci95"][1]:+.2%}] | {t["p_noninferior"]:.4f} | {t["p_holm"]:.4f} | '
                 f'{"yes" if t["no_material_loss"] else "no"} | {"yes" if t["noninferior_holm_0.05"] else "no"} |')
    L += ['', '## Secondary: Q+c - F (no multiplicity correction)', '',
          '| dataset | model | k | mean diff | 95% CI | relative | no material loss |', '|---|---|---|---|---|---|---|']
    for t in o['secondary']:
        L.append(f'| {t["dataset"]} | {t["model"]} | {t["k"]} | {t["mean_diff"]:+.4f} | [{t["ci95"][0]:+.4f}, {t["ci95"][1]:+.4f}] | '
                 f'{t["rel_diff"]:+.2%} | {"yes" if t["no_material_loss"] else "no"} |')
    L += ['', '## nDCG@10 and recall per cell', '',
          '| cell | candidate Recall@k | source | nDCG@10 | Recall@100 (reranked) |', '|---|---|---|---|---|']
    for ck, c in o['cells'].items():
        for s, v in c['sources'].items():
            r = '' if v['recall100'] is None else f'{v["recall100"]:.4f}'
            L.append(f'| {ck} | {c["candidate_recall_at_k"]:.4f} | {s} | {v["ndcg10"]:.4f} | {r} |')
    L += ['', '## nDCG@10 against rerank time per request', '',
          'Time statistics pool all timed repetitions of all calls of one implementation and set. One line per implementation, one point per k.', '',
          '| implementation | dataset | model | k | nDCG@10 | p50 ms | p95 ms |', '|---|---|---|---|---|---|---|']
    for lk, pts in o['latency'].items():
        impl, ds, mk = lk.split('|')
        for p in pts:
            nd = '' if p['ndcg10'] is None else f'{p["ndcg10"]:.4f}'
            L.append(f'| {impl} | {ds} | {mk} | {p["k"]} | {nd} | {p["p50_ms"]:.3f} | {p["p95_ms"]:.3f} |')
    return '\n'.join(L) + '\n'


# ---------- self-test (synthetic data only) ----------
def selftest():
    # nDCG / recall on a hand-made case
    rel = {'a': 2, 'b': 1}
    assert abs(ndcg_at(['a', 'b', 'x'], rel) - 1.0) < 1e-12
    got = ndcg_at(['x', 'b', 'a'], rel)
    want = (1 / math.log2(3) + 2 / math.log2(4)) / (2 / math.log2(2) + 1 / math.log2(3))
    assert abs(got - want) < 1e-12, (got, want)
    assert recall_at(['x', 'b', 'a'], rel, 2) == 0.5 and recall_at(['a'], {}, 5) == 0.0
    assert rerank(['p', 'q', 'r'], [1.0, 1.0, 2.0]) == ['r', 'p', 'q']          # ties keep BM25 order
    # Holm
    adj = holm([0.01, 0.04, 0.03, 0.005])
    assert np.allclose(adj, [0.03, 0.06, 0.06, 0.02]), adj
    # bootstrap: identical -> difference 0, non-inferior; clearly worse -> not
    rng = np.random.default_rng(1)
    base = rng.uniform(0.3, 0.9, 200)
    same = paired_test(base, base, 0.01)
    assert same['mean_diff'] == 0 and same['no_material_loss'] and same['p_noninferior'] < 0.01
    worse = paired_test(base - 0.1, base, 0.01)
    assert not worse['no_material_loss'] and worse['p_noninferior'] > 0.5 and worse['rel_diff'] < 0
    noisy = paired_test(base + rng.normal(0, 0.05, 200) - 0.004, base, 0.01)
    assert noisy['ci95'][0] < noisy['mean_diff'] < noisy['ci95'][1]
    assert paired_test(base, base, 0.01)['ci95'] == paired_test(base, base, 0.01)['ci95']   # deterministic
    # vector score sources: F+c >= F, Q+c close to F+c, clamp acts
    q = rng.standard_normal((4, 16)).astype(np.float32)
    docs = [rng.standard_normal((n, 16)).astype(np.float32) for n in (5, 9, 3)]
    sc = vector_sources(q, docs)
    assert np.all(sc['F+c'] >= sc['F'] - 1e-15)
    assert np.abs(sc['Q+c'] - sc['F+c']).max() < 0.08
    neg = [-np.abs(rng.standard_normal((6, 16)).astype(np.float32)) - 0.1]
    pos_q = np.abs(rng.standard_normal((3, 16))).astype(np.float32) + 0.1
    s2 = vector_sources(pos_q, neg)
    assert s2['F'][0] < 0 and s2['F+c'][0] == 0.0 and s2['Q+c'][0] == 0.0
    # end to end on synthetic prep + results: join through provenance, K equal to F -> no loss
    with tempfile.TemporaryDirectory() as td:
        ds, mk, k, nq, dim = 'scifact', 'answersmall', 100, 12, 8
        rd = os.path.join(td, 'raw', f'{ds}-{mk}')
        os.makedirs(rd)
        ndoc = 120
        dts = [rng.standard_normal((int(rng.integers(3, 7)), dim)).astype(np.float32) for _ in range(ndoc)]
        qts = [rng.standard_normal((5, dim)).astype(np.float32) for _ in range(nq)]
        for nm, arrs in (('doc', dts), ('query', qts)):
            off = np.concatenate([[0], np.cumsum([len(a) for a in arrs])]).astype(np.int64)
            np.save(os.path.join(rd, f'{nm}_tokens.npy'), np.concatenate(arrs))
            np.save(os.path.join(rd, f'{nm}_offsets.npy'), off)
        json.dump([f'd{i}' for i in range(ndoc)], open(os.path.join(rd, 'doc_ids.json'), 'w'))
        qids = [f'q{i}' for i in range(nq)]
        json.dump(qids, open(os.path.join(rd, 'query_ids.json'), 'w'))
        bm = {q: [[f'd{(i * 7 + j) % ndoc}', 1.0 - j / 1000] for j in range(ndoc)] for i, q in enumerate(qids)}
        json.dump(bm, open(os.path.join(rd, 'bm25.json'), 'w'))
        with open(os.path.join(rd, 'qrels.tsv'), 'w') as f:
            f.write('query-id\tcorpus-id\tscore\n')
            for i, q in enumerate(qids):
                f.write(f'{q}\t{bm[q][3][0]}\t1\n{q}\t{bm[q][40][0]}\t1\n')
        sd = os.path.join(td, 'sets', f'beir-{ds}-{mk}-k{k}', ds)
        os.makedirs(sd)
        with open(os.path.join(sd, 'provenance.jsonl'), 'w') as f:
            for i, q in enumerate(qids):
                f.write(json.dumps({'file': f'call-{i:05d}.bin', 'repo': ds, 'query_id': q, 'query_sha256': 'x', 'source_task': ds}) + '\n')
        P = read_prep(td, ds, mk)
        calls_k, calls_r = [], []
        for i, q in enumerate(qids):
            ids = [d for d, _ in bm[q][:k]]
            sc = vector_sources(qts[i], [dts[int(d[1:])] for d in ids])
            sname = f'beir-{ds}-{mk}-k{k}'
            calls_k.append({'set': sname, 'file': f'call-{i:05d}.bin', 'scores': sc['F+c'].tolist(), 'ts_ns': [1000, 2000]})
            calls_r.append({'set': sname, 'file': f'call-{i:05d}.bin', 'scores': (sc['F+c'] - 0.2 * np.arange(k) / k).tolist(), 'ts_ns': [5000, 6000]})
        # run_matrix.py layout: <machine>/<tag>/<group>/<arm>.r<round>.p<proc>.json; two rounds of the kernel
        rdir = os.path.join(td, 'results'); g = os.path.join(rdir, 'm', 'ho-warm', 'beir-x')
        os.makedirs(g)
        json.dump({'arm': 'kern', 'complete': True, 'calls': calls_k}, open(os.path.join(g, 'kern.r0.p0.json'), 'w'))
        json.dump({'arm': 'kern', 'complete': True, 'calls': [dict(c, ts_ns=[3000, 4000]) for c in calls_k]}, open(os.path.join(g, 'kern.r1.p0.json'), 'w'))
        json.dump({'arm': 'rival1', 'complete': True, 'calls': calls_r}, open(os.path.join(g, 'rival1.r0.p0.json'), 'w'))
        json.dump({'delta': 0.01}, open(os.path.join(td, 'FREEZE.json'), 'w'))
        ns = argparse.Namespace(freeze=os.path.join(td, 'FREEZE.json'), prep=td, results=rdir, out=os.path.join(td, 'out'), kernel='kern')
        run(ns)
        o = json.load(open(os.path.join(td, 'out', 'quality.json')))
        cell = o['cells'][f'{ds}|{mk}|k{k}']
        assert set(cell['sources']) == {'F', 'F+c', 'Q+c', 'K', 'rival:rival1'}, cell['sources'].keys()
        assert abs(cell['sources']['K']['ndcg10'] - cell['sources']['F+c']['ndcg10']) < 1e-12
        assert cell['sources']['K']['recall100'] is not None
        assert abs(cell['candidate_recall_at_k'] - 1.0) < 1e-12
        lat = o['latency'][f'kern|{ds}|{mk}'][0]
        assert lat['k'] == k and abs(lat['p50_ms'] - 0.0025) < 1e-9 and lat['ndcg10'] is not None
        assert os.path.exists(os.path.join(td, 'out', 'quality.md'))
        # K vs F: scores differ only by the clamp, so the difference is tiny
        assert o['secondary'] and all(t['contrast'] == 'Q+c - F' for t in o['secondary'])
    print('selftest ok')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('freeze', nargs='?', help='FREEZE.json (required; this script refuses to run without it)')
    ap.add_argument('--prep', help='output dir of beir_prep.py')
    ap.add_argument('--results', help='dir with timing-run result JSON files')
    ap.add_argument('--out', help='output dir for quality.json and quality.md')
    ap.add_argument('--kernel', help='implementation name of the kernel in the result JSONs (or FREEZE.json key kernel_impl)')
    ap.add_argument('--selftest', action='store_true')
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if not a.freeze or not os.path.isfile(a.freeze):
        sys.exit('refusing to run: pass the path of FREEZE.json (quality may only be computed after the freeze)')
    if not (a.prep and a.results and a.out):
        sys.exit('--prep, --results and --out are required')
    run(a)


if __name__ == '__main__':
    main()
