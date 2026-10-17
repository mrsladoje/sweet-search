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
            res['int4_diagnostic'][f'{ds}|{mk}'] = dict(dim=int(x.shape[1]), tokens=int(len(idx)),
                                                         rel_err_median=float(np.median(rel)), rel_err_p90=float(np.percentile(rel, 90)),
                                                         cos_median=float(np.median(cos)), cos_p10=float(np.percentile(cos, 10)),
                                                         peak_to_rms_median=float(np.median(p2r)))
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
          '| data | dim | rel. error median / p90 | cosine median / p10 | peak-to-RMS median |', '|---|--:|--:|--:|--:|']
    for k, v in res['int4_diagnostic'].items():
        L.append(f"| {k} | {v['dim']} | {v['rel_err_median']:.3f} / {v['rel_err_p90']:.3f} | {v['cos_median']:.4f} / {v['cos_p10']:.4f} | {v['peak_to_rms_median']:.2f} |")
    open(os.path.join(OUT, 'quality_extra.md'), 'w').write('\n'.join(L) + '\n')
    print('\n'.join(L))


if __name__ == '__main__':
    main()
