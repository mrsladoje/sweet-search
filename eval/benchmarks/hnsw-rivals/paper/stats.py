# Statistics (DESIGN.md section 4): cluster bootstrap, selection rule, non-inferiority, Holm, TOST, power.
# One ClusterBoot per (set, split) is shared by every statistic of that split (shared query identities).
# usage (library): boot = stats.ClusterBoot(S.clusters of the split); stats.noninferiority(boot, a, b, 0.005)
# CLI:  python stats.py noninf|tost|select|power <DATA> <set> <model> <split> --a REC.json [--b REC.json] [--f 0.99]
#       (--b omitted for select: Q_exact comes from the gt files; power: --a minus --b on dev)
import argparse, json, math, sys
import numpy as np

B_DEFAULT, SEED, DELTA, ALPHA = 10000, 42, 0.005, 0.025


class ClusterBoot:
    """Resamples whole clusters with replacement. counts[b, c] = times cluster c is drawn in resample b
    (clusters in order of first appearance). Mean of a per-query vector d in resample b:
    sum_c counts[b,c] * sum_d(c) / sum_c counts[b,c] * n(c)."""

    def __init__(self, clusters, B=B_DEFAULT, seed=SEED):
        lab = {}
        self.cidx = np.fromiter((lab.setdefault(c, len(lab)) for c in clusters), dtype=np.int64, count=len(clusters))
        self.C, self.B, self.seed = len(lab), B, seed
        self.size = np.bincount(self.cidx, minlength=self.C).astype(np.float64)
        rng = np.random.default_rng(seed)
        self.counts = np.empty((B, self.C), dtype=np.int32)
        step = max(1, (1 << 24) // max(self.C, 1))
        for b0 in range(0, B, step):
            n = min(step, B - b0)
            draws = rng.integers(0, self.C, size=(n, self.C))
            flat = (draws + np.arange(n)[:, None] * self.C).ravel()
            self.counts[b0:b0 + n] = np.bincount(flat, minlength=n * self.C).reshape(n, self.C)
        self.denom = self._mm(self.size)

    def _mm(self, v):
        out = np.empty(self.B)
        for b0 in range(0, self.B, 2000):
            out[b0:b0 + 2000] = self.counts[b0:b0 + 2000].astype(np.float64) @ v
        return out

    def means(self, d):
        """Bootstrap distribution (B values) of the mean of per-query vector d."""
        d = np.asarray(d, dtype=np.float64)
        assert len(d) == len(self.cidx)
        return self._mm(np.bincount(self.cidx, weights=d, minlength=self.C)) / self.denom


def pct(x, p):
    return float(np.percentile(x, p))


def selection(boot, q_sys, q_exact, f, alpha=ALPHA):
    """Qualifies when the one-sided (1-alpha) lower bound of mean(Q_sys - f * Q_exact) is >= 0."""
    d = np.asarray(q_sys) - f * np.asarray(q_exact)
    lo = pct(boot.means(d), 100 * alpha)
    return {'f': f, 'mean_d': float(d.mean()), 'lower': lo, 'qualifies': lo >= 0}


def noninferiority(boot, ours, rival, delta=DELTA, alpha=ALPHA):
    """H0: ours - rival <= -delta. Pass when the alpha percentile of the bootstrap mean > -delta.
    p = (k + 1) / (B + 1), k = resamples with mean <= -delta (used by Holm)."""
    m = boot.means(np.asarray(ours) - np.asarray(rival))
    k = int((m <= -delta).sum())
    lo = pct(m, 100 * alpha)
    return {'mean_diff': float(np.mean(np.asarray(ours) - np.asarray(rival))), 'lower': lo,
            'delta': delta, 'pass': lo > -delta, 'p': (k + 1) / (boot.B + 1)}


def holm(ps, alpha=ALPHA):
    """Holm step-down on a list of p-values -> list of bool (reject H0 = comparison passes)."""
    order = sorted(range(len(ps)), key=lambda i: ps[i])
    rej = [False] * len(ps)
    for rank, i in enumerate(order):
        if ps[i] <= alpha / (len(ps) - rank):
            rej[i] = True
        else:
            break
    return rej


def holm_noninferiority(boot, pairs, delta=DELTA, alpha=ALPHA):
    """pairs: list of (ours, rival) per-query vectors on the same split -> results with 'holm_pass'."""
    res = [noninferiority(boot, o, r, delta, alpha) for o, r in pairs]
    for r, ok in zip(res, holm([r['p'] for r in res], alpha)):
        r['holm_pass'] = ok
    return res


def tost(boot, ours, rival, delta=DELTA):
    """Two one-sided tests at 0.05 each: the 5% and 95% percentiles of the mean difference inside +-delta."""
    m = boot.means(np.asarray(ours) - np.asarray(rival))
    lo, hi = pct(m, 5), pct(m, 95)
    return {'lower5': lo, 'upper95': hi, 'delta': delta, 'equivalent': lo > -delta and hi < delta}


def phi(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def power_analytic(delta, se_ho, z=1.96):
    return 1.0 if se_ho == 0 else phi(delta / se_ho - z)


def power(dev_boot, diff_dev, n_clusters_ho, delta=DELTA, draws=2000, inner=1000, seed=SEED, alpha=ALPHA):
    """Power of the held-out non-inferiority test at a true difference of 0, from dev paired differences.
    analytic: Phi(delta/SE_ho - 1.96), SE_ho = dev cluster-bootstrap SE * sqrt(C_dev / C_ho).
    simulation: dev differences re-centred to mean 0; each draw resamples C_ho dev clusters (with
    replacement, all their queries), then takes its own cluster bootstrap (`inner` resamples) and
    checks lower bound > -delta."""
    d = np.asarray(diff_dev, dtype=np.float64)
    se_dev = float(dev_boot.means(d).std(ddof=1))
    se_ho = se_dev * math.sqrt(dev_boot.C / n_clusters_ho)
    c = np.bincount(dev_boot.cidx, weights=d - d.mean(), minlength=dev_boot.C)   # cluster sums, centred
    n = dev_boot.size
    rng = np.random.default_rng(seed)
    ok = 0
    for _ in range(draws):
        pick = rng.integers(0, dev_boot.C, size=n_clusters_ho)
        s, m = c[pick], n[pick]
        cnt = rng.multinomial(n_clusters_ho, np.full(n_clusters_ho, 1.0 / n_clusters_ho), size=inner)
        lo = np.percentile((cnt @ s) / (cnt @ m), 100 * alpha)
        ok += lo > -delta
    return {'se_dev': se_dev, 'se_ho': se_ho, 'power_analytic': power_analytic(delta, se_ho),
            'power_sim': ok / draws, 'n_clusters_dev': dev_boot.C, 'n_clusters_ho': n_clusters_ho,
            'delta': delta}


def _per_query(S, data, model, split, rec_path, metric=None):
    import quality
    rec, vids, scores = quality.read_record(rec_path)
    gt = quality.read_gt(data, model, S.name, split)
    r = quality.eval_lists(S, quality.split_index(S, split), vids, scores, metric, gt['vecs'])
    return r['q']


def main():
    import quality
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['noninf', 'tost', 'select', 'power'])
    for k in ('data', 'set', 'model', 'split'):
        ap.add_argument(k)
    ap.add_argument('--a'), ap.add_argument('--b')
    ap.add_argument('--f', type=float, default=0.99)
    ap.add_argument('--delta', type=float, default=DELTA)
    ap.add_argument('--n-clusters-ho', type=int, help='power: held-out cluster count (default: from the set)')
    ap.add_argument('--metric')
    ap.add_argument('--draws', type=int, default=2000)
    ap.add_argument('--inner', type=int, default=1000)
    a = ap.parse_args()
    import os
    data = os.path.expanduser(a.data)
    S = quality.load_set(data, a.set)
    qidx = quality.split_index(S, a.split)
    boot = ClusterBoot([S.clusters[i] for i in qidx])
    qa = _per_query(S, data, a.model, a.split, a.a, a.metric)
    if a.cmd == 'select':
        out = selection(boot, qa, quality.exact_quality(S, data, a.model, a.split, a.metric), a.f)
    else:
        qb = _per_query(S, data, a.model, a.split, a.b, a.metric)
        if a.cmd == 'noninf':
            out = noninferiority(boot, qa, qb, a.delta)
        elif a.cmd == 'tost':
            out = tost(boot, qa, qb, a.delta)
        else:
            nho = a.n_clusters_ho or len({S.clusters[i] for i in quality.split_index(S, 'ho')})
            out = power(boot, qa - qb, nho, a.delta, a.draws, a.inner)
    json.dump(out, sys.stdout, indent=1)
    print()


if __name__ == '__main__':
    main()
