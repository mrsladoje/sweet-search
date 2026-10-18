# venv/bin/python -I paper/analysis/numkong_gap.py
#
# Post-freeze diagnostic (not frozen; synthetic data only, no benchmark data). Extends
# numkong_check.py from two points to a curve: how NumKong's candidate order follows the exact
# order as the candidates' scores move closer together. Every token is a shared direction plus
# noise of scale s (larger s: candidate scores further apart; "random" = no shared direction).
# Per point: the median relative gap between the first and the tenth exact score, the median
# Spearman correlation of NumKong's order with the exact order (contract C), and the top-1
# agreement, over 40 queries of 32 tokens against 100 candidates of 160 tokens.
import json, os, sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import numkong_check as nc  # noqa: E402  (make-like helpers, exact, numkong_py, spearman; reused unchanged)

NOISE = [0.2, 0.35, 0.5, 0.7, 1.0, 1.5, 2.5, 4.0, None]   # None: random unit vectors


def make(dim, s, rng):
    if s is None:
        q = nc.unit(rng.standard_normal((nc.NQ, dim)))
        docs = [nc.unit(rng.standard_normal((nc.NTOK, dim))) for _ in range(nc.NDOC)]
    else:
        base = rng.standard_normal(dim)
        q = nc.unit(base + s * rng.standard_normal((nc.NQ, dim)))
        docs = [nc.unit(base + s * rng.standard_normal((nc.NTOK, dim))) for _ in range(nc.NDOC)]
    return q, docs


def main():
    rng = np.random.default_rng(42)
    rows = []
    for dim in (96, 128):
        for s in NOISE:
            gap, rho, top1 = [], [], []
            for _ in range(nc.QUERIES):
                q, docs = make(dim, s, rng)
                ex, got = nc.exact(q, docs), nc.numkong_py(q, docs, 'f32')
                srt = np.sort(ex)[::-1]
                gap.append((srt[0] - srt[9]) / srt[0])
                rho.append(nc.spearman(ex, got))
                top1.append(int(np.argmax(ex) == np.argmax(got)))
            rows.append(dict(dim=dim, noise=s, gap_median=float(np.median(gap)), spearman_median=float(np.median(rho)),
                             spearman_p25=float(np.percentile(rho, 25)), spearman_p75=float(np.percentile(rho, 75)),
                             top1=float(np.mean(top1))))
            print(f'dim {dim} noise {s}: gap {np.median(gap):.4f} rho {np.median(rho):.3f} top1 {np.mean(top1):.2f}', flush=True)
    json.dump(dict(numkong=getattr(nc.nk, '__version__', '?'), queries=nc.QUERIES, shape=[nc.NQ, nc.NDOC, nc.NTOK], dtype='f32', rows=rows),
              open(os.path.join(HERE, 'tables', 'numkong_gap.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
