# Shared reporting rules of analyze.py, merge_results.py and draft/mktex.py (written after the freeze; they
# choose nothing from held-out data).
#   ratio_ci   median over rounds of b / median over rounds of a, 95% percentile bootstrap over rounds
#   headline   per (CPU, set, model, f): ours vs THE RIVAL THAT WAS FASTEST ON DEV at that fraction (its frozen
#              point, dev latency from the shortlist); held-out decides nothing about which rival is shown
import json, os
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SL_TYPE = {'intel': 'intel', 'amd': 'amd', 'arm': 'arm', 'box': 'amd', 'mac': 'arm'}  # local plans borrow these shortlists


def ratio_ci(a_meds, b_meds, B=10000, seed=42):
    a_, b_ = np.asarray(a_meds, float), np.asarray(b_meds, float)
    est = float(np.median(b_) / np.median(a_))
    if len(a_) < 2 or len(b_) < 2:
        return est, None, None
    rng = np.random.default_rng(seed)
    ra = np.median(a_[rng.integers(0, len(a_), (B, len(a_)))], axis=1)
    rb = np.median(b_[rng.integers(0, len(b_), (B, len(b_)))], axis=1)
    lo, hi = np.percentile(rb / ra, [2.5, 97.5])
    return est, float(lo), float(hi)


_sl = {}


def dev_latency(t, s, m, system, f, shortlists=os.path.join(HERE, 'shortlists')):
    k = SL_TYPE[t]
    if k not in _sl:
        _sl[k] = json.load(open(os.path.join(shortlists, f'shortlist-{k}.json')))
    e = (((_sl[k].get(s) or {}).get(m) or {}).get('selection') or {}).get(system) or {}
    p = e.get(f'{f:g}') or e.get(str(f))
    return p.get('latency_us') if p else None


def headline(B, t, s, m, f):
    """B: {system: held-out row} of one (t, s, m, f). Returns (ours row, rival name, rival row) or None.
    The rival is the non-ours system with the lowest DEV latency among those with a held-out record."""
    o = B.get('ours_cascade')
    riv = [(dev_latency(t, s, m, k, f), k, x) for k, x in B.items() if not k.startswith('ours') and k != 'faiss_exact']
    riv = sorted(r for r in riv if r[0] is not None)
    if not o or not riv:
        return None
    return o, riv[0][1], riv[0][2]
