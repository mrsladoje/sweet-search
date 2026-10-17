# venv/bin/python -I paper/analysis/quality_extra.py
#
# Post-freeze analysis code (not frozen). Descriptive additions to quality.py (no test, no
# tuning; aggregates only):
#   1. nDCG@10 of the BM25 order itself (the candidate list without reranking).
#   2. nDCG@10 of float64 reference scores of each contract (refs-v2 caches): S, S-pre,
#      C on float64-decoded data (contract effect) and C on NumKong's own cast inputs, so
#      that NumKong's approximation effect (its scores vs C-a) and its contract effect
#      (C-b vs S) are apart.
#   3. The kernel's BEIR scores across platforms: share of bit-equal scores, max abs
#      difference, share of calls with the same ranking.
#   4. An int4 diagnostic on the stored float32 doc tokens per model: per-token relative
#      reconstruction error and cosine between the token and its int4 decoding, and the
#      peak-to-RMS ratio of the token's coordinates (a sign of outlier dimensions).
import glob, json, os, sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from common import OUT, dump  # noqa: E402
BENCH = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, BENCH)
import quality as Q  # noqa: E402
from quantize_int4 import quantize_int4_per_token  # noqa: E402

PREP = os.path.expanduser('~/.ss-eval/maxsim-beir-prep')
QIN = os.path.expanduser('~/.ss-eval/maxsim-quality-in')
VARIANTS = ['S-clamp', 'Spre-b-noclamp', 'C-b-noclamp', 'C-a-f32-noclamp', 'C-a-bf16-noclamp', 'C-a-f16-noclamp']
DATASETS, MODELS, KS = ('scifact', 'nfcorpus'), ('colbertv2', 'answersmall'), (10, 25, 50, 100, 200)


def ref_scores(ds, mk, k):
    root = os.path.join(PREP, 'sets', f'beir-{ds}-{mk}-k{k}')
    idx = json.load(open(os.path.join(root, 'refs-v2', 'index.json')))
    pv = Q.read_provenance(PREP, ds, mk, k)
    out = {}
    for v in VARIANTS:
        arr = np.fromfile(os.path.join(root, 'refs-v2', ds, v + '.f64'), '<f8')
        out[v] = {pv[key.split('/', 1)[1]]: arr[o:o + n] for key, (o, n) in idx['calls'].items()}
    return out


def ours_scores(platform, ds, mk, k):
    fs = glob.glob(os.path.join(QIN, platform, '*', 'ho-warm', f'beir-{ds}-{mk}-k{k}', 'ours.r0.p0.json'))
    if not fs:
        return None
    d = json.load(open(fs[0]))
    return {c['file']: np.asarray(c['scores'], np.float64) for c in d['calls']}


def main():
    res = {'bm25': {}, 'refs': {}, 'kernel_across_platforms': {}, 'int4_diagnostic': {}}
    for ds in DATASETS:
        for mk in MODELS:
            P = Q.read_prep(PREP, ds, mk)
            qids = P['qids']
            for k in KS:
                cell = f'{ds}|{mk}|k{k}'
                bm = {q: -np.arange(k, dtype=float) for q in qids}
                res['bm25'][cell] = float(Q.per_query(qids, P['bm25'], P['rel'], k, bm)[0].mean())
                refs = ref_scores(ds, mk, k)
                res['refs'][cell] = {v: float(Q.per_query(qids, P['bm25'], P['rel'], k, refs[v])[0].mean()) for v in VARIANTS}
                if k == 100:
                    # descriptive, post hoc: contract C on float64-decoded int4 against float32 (F), same test as the primary one
                    import itertools  # noqa: F401
                    F = {}
                    for qi, qq in enumerate(qids):
                        qv = np.asarray(P['qflat'][P['qoff'][qi]:P['qoff'][qi + 1]])
                        ids = [d for d, _ in P['bm25'][qq][:k]]
                        docs = [np.asarray(P['dflat'][P['doff'][P['dpos'][d]]:P['doff'][P['dpos'][d] + 1]]) for d in ids]
                        F[qq] = Q.vector_sources(qv, docs)['F']
                    nf = Q.per_query(qids, P['bm25'], P['rel'], k, F)[0]
                    nc = Q.per_query(qids, P['bm25'], P['rel'], k, refs['C-b-noclamp'])[0]
                    ns = Q.per_query(qids, P['bm25'], P['rel'], k, refs['S-clamp'])[0]
                    res.setdefault('posthoc_tests', {})[cell] = {'C-b - F': Q.paired_test(nc, nf, 0.01), 'S - F': Q.paired_test(ns, nf, 0.01)}
                    # score margins under F: spread of the candidate scores of one query (coefficient of variation)
                    # and the relative gap between the 1st and the 10th score; median over queries
                    cvs, gaps = [], []
                    for qq in qids:
                        sc = np.sort(F[qq])[::-1]
                        cvs.append(np.std(F[qq]) / np.mean(F[qq])); gaps.append((sc[0] - sc[9]) / sc[0])
                    res.setdefault('score_margins', {})[f'{ds}|{mk}'] = dict(cv_median=float(np.median(cvs)), top1_top10_gap_median=float(np.median(gaps)))
                # kernel across platforms (bit equality and ranking)
                plats = [p for p in ('intel', 'amd', 'arm', 'm3max', 'epyc') if os.path.isdir(os.path.join(QIN, p))]
                sc = {p: ours_scores(p, ds, mk, k) for p in plats}
                sc = {p: v for p, v in sc.items() if v}
                if len(sc) > 1:
                    base = plats[0]
                    cmp = {}
                    for p in sc:
                        if p == base:
                            continue
                        eq = tot = 0; mx = 0.0; same_rank = 0
                        for f, a in sc[base].items():
                            b = sc[p][f]
                            eq += int(np.sum(a == b)); tot += a.size; mx = max(mx, float(np.max(np.abs(a - b))))
                            same_rank += int(np.array_equal(np.argsort(-a, kind='stable'), np.argsort(-b, kind='stable')))
                        cmp[f'{p} vs {base}'] = dict(bit_equal_share=eq / tot, max_abs=mx, same_ranking_share=same_rank / len(sc[base]))
                    res['kernel_across_platforms'][cell] = cmp
            # int4 diagnostic on an evenly spaced sample of 100,000 doc tokens
            flat = P['dflat']
            idx = np.linspace(0, flat.shape[0] - 1, num=min(100000, flat.shape[0])).astype(np.int64)
            x = np.asarray(flat[idx], np.float32)
            raw, mn, sc_, nr = quantize_int4_per_token(x)
            xd = Q.decode_int4(raw, mn, sc_, x.shape[1])
            x64 = x.astype(np.float64)
            rel = np.linalg.norm(x64 - xd, axis=1) / np.linalg.norm(x64, axis=1)
            cos = (x64 * xd).sum(1) / (np.linalg.norm(x64, axis=1) * np.linalg.norm(xd, axis=1))
            p2r = np.abs(x64).max(1) / np.sqrt((x64 ** 2).mean(1))
            dn = np.linalg.norm(xd, axis=1)                  # norm of the decoded token
            ratio_ = dn / nr.astype(np.float64)               # what contract S keeps: |d_hat| / n
            q = lambda a, v: float(np.percentile(a, v))
            res['int4_diagnostic'][f'{ds}|{mk}'] = dict(dim=int(x.shape[1]), tokens=int(len(idx)),
                                                         rel_err_median=float(np.median(rel)), rel_err_p90=float(np.percentile(rel, 90)),
                                                         cos_median=float(np.median(cos)), cos_p10=float(np.percentile(cos, 10)),
                                                         peak_to_rms_median=float(np.median(p2r)),
                                                         stored_norm_p1=q(nr, 1), stored_norm_median=q(nr, 50), stored_norm_p99=q(nr, 99),
                                                         decoded_over_stored_p1=q(ratio_, 1), decoded_over_stored_p10=q(ratio_, 10),
                                                         decoded_over_stored_median=q(ratio_, 50), decoded_over_stored_p90=q(ratio_, 90),
                                                         decoded_over_stored_p99=q(ratio_, 99),
                                                         decoded_over_stored_sd=float(np.std(ratio_)))
    # bit identity of the kernel's BEIR scores within one CPU: every ours* file (thread budget, round, process) against ours.r0.p0
    files = scores = equal = 0
    for plat in ('intel', 'amd', 'arm', 'm3max', 'epyc'):
        for d in glob.glob(os.path.join(QIN, plat, '*', 'ho-warm', 'beir-*')):
            base = {c['file']: np.asarray(c['scores']) for c in json.load(open(os.path.join(d, 'ours.r0.p0.json')))['calls']}
            for f in glob.glob(os.path.join(d, 'ours*.r*.p*.json')):
                files += 1
                for c in json.load(open(f))['calls']:
                    a = np.asarray(c['scores']); scores += a.size; equal += int(np.sum(a == base[c['file']]))
    res['kernel_within_cpu'] = dict(files=files, scores=scores, bit_equal=equal)
    dump('quality_extra.json', res)
    L = ['# Quality: descriptive additions (BEIR, fresh held-out; aggregates only)', '', '## nDCG@10 by score source', '',
         '| cell | BM25 order | ' + ' | '.join(VARIANTS) + ' |', '|---|--:|' + '--:|' * len(VARIANTS)]
    for cell in res['refs']:
        L.append(f"| {cell} | {res['bm25'][cell]:.4f} | " + ' | '.join(f"{res['refs'][cell][v]:.4f}" for v in VARIANTS) + ' |')
    L += ['', '## Kernel scores across platforms', '', '| cell | pair | bit-equal scores | max abs diff | same ranking |', '|---|---|--:|--:|--:|']
    for cell, d in res['kernel_across_platforms'].items():
        for pair, v in d.items():
            L.append(f"| {cell} | {pair} | {v['bit_equal_share']*100:.2f}% | {v['max_abs']:.1e} | {v['same_ranking_share']*100:.2f}% |")
    L += ['', '## int4 diagnostic (100,000 evenly spaced doc tokens per model and dataset)', '',
          '| data | dim | rel. error median / p90 | cosine median / p10 | stored norm p1 / median / p99 | decoded / stored norm p1 / p10 / median / p90 / p99 (sd) |',
          '|---|--:|--:|--:|--:|--:|']
    for k, v in res['int4_diagnostic'].items():
        L.append(f"| {k} | {v['dim']} | {v['rel_err_median']:.3f} / {v['rel_err_p90']:.3f} | {v['cos_median']:.4f} / {v['cos_p10']:.4f} | "
                 f"{v['stored_norm_p1']:.3f} / {v['stored_norm_median']:.3f} / {v['stored_norm_p99']:.3f} | "
                 f"{v['decoded_over_stored_p1']:.3f} / {v['decoded_over_stored_p10']:.3f} / {v['decoded_over_stored_median']:.3f} / "
                 f"{v['decoded_over_stored_p90']:.3f} / {v['decoded_over_stored_p99']:.3f} ({v['decoded_over_stored_sd']:.4f}) |")
    L += ['', '## Score margins under F at k = 100 (median over queries)', '', '| data | coefficient of variation of candidate scores | (top-1 - top-10) / top-1 |', '|---|--:|--:|']
    for k_, v in res.get('score_margins', {}).items():
        L.append(f"| {k_} | {v['cv_median']:.4f} | {v['top1_top10_gap_median']:.4f} |")
    L += ['', '## Post-hoc descriptive tests at k = 100 (same paired bootstrap as the primary test; not pre-registered)', '',
          '| cell | contrast | mean diff | 95% CI | relative |', '|---|---|--:|--:|--:|']
    for cell, d in res.get('posthoc_tests', {}).items():
        for name, t in d.items():
            L.append(f"| {cell} | {name} | {t['mean_diff']:+.4f} | [{t['ci95'][0]:+.4f}, {t['ci95'][1]:+.4f}] | {t['rel_diff'] * 100:+.2f}% |")
    open(os.path.join(OUT, 'quality_extra.md'), 'w').write('\n'.join(L) + '\n')
    print('\n'.join(L))


if __name__ == '__main__':
    main()
