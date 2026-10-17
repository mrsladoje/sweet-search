# venv/bin/python -I paper/analysis/quality_collect.py
#
# Post-freeze analysis code (not frozen). Collects quality.py's output per platform
# (~/.ss-eval/maxsim-analysis/quality/<platform>/quality.json) into tables/quality_primary.json:
# the primary tests, the secondary tests and the per-cell nDCG@10 / Recall@100 of every
# score source. quality.py's "latency" block is left out on purpose: it pools several
# thread budgets under one arm name (see budget.py); budget.py recomputes it per arm file.
# Also writes tables/counts.json (job counts from the completeness logs).
import json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import PLATFORMS, dump, HERE  # noqa: E402

Q = os.path.expanduser('~/.ss-eval/maxsim-analysis/quality')


def main():
    out = {}
    for p in PLATFORMS:
        f = os.path.join(Q, p, 'quality.json')
        if os.path.exists(f):
            q = json.load(open(f))
            out[p] = {k: q[k] for k in ('delta', 'seed', 'bootstrap_resamples', 'kernel_impl', 'primary', 'secondary', 'cells')}
    dump('quality_primary.json', out)
    counts = {}
    for f in sorted(os.listdir(os.path.join(HERE, 'logs'))):
        txt = open(os.path.join(HERE, 'logs', f)).read()
        m = re.search(r'(\d+) of (\d+) jobs complete', txt)
        if m:
            counts[f.replace('complete-', '').replace('.txt', '')] = int(m.group(2))
    dump('counts.json', counts)
    print(counts)


if __name__ == '__main__':
    main()
