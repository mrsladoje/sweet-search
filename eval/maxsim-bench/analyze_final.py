# python3 analyze_final.py <results/MACHINE/TAG> [--base ours] [--md out.md]
#
# Dev analysis of one tag (e.g. dev-warm): per workload (replay set or sweep cell), every
# arm against the base, sorted by total time, with the workload interval (cluster
# bootstrap) and, per library, "best-of" = per call the fastest of the library's
# configurations (a post-hoc oracle, never a published number). For choosing the shortlist
# use make_shortlist.py; for publication tables, summarize.py.
import argparse, collections, os, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import results_lib as rl  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument('dir')
p.add_argument('--base', default='ours')
p.add_argument('--md')
a = p.parse_args()
arms = rl.load_tag(a.dir)
if not arms:
    arms = rl.load_group(a.dir)
base = arms[a.base]
lines = []
for w in sorted({k[0] for k in base['rows']}):
    keys = [k for k in base['rows'] if k[0] == w]
    b = np.array([base['rows'][k]['ms'] for k in keys]); cl = [rl.cluster_of(base['rows'][k]) for k in keys]
    lines.append(f"\n### {w}: {len(keys)} calls, base = {a.base}\n")
    lines.append('| arm | p50 ms | per-request p99 ms | total ms | ratio vs base [workload 95% CI] | base faster on | max err | top-1 = S |')
    lines.append('|---|--:|--:|--:|--:|--:|--:|--:|')
    entries = []
    fam = collections.defaultdict(list)
    for arm, d in arms.items():
        if all(k in d['rows'] for k in keys):
            rows = [d['rows'][k] for k in keys]
            entries.append((arm, rows))
            if rl.library(arm):
                fam[rl.library(arm)].append(rows)
    for lib, rs in fam.items():
        if len(rs) > 1:
            entries.append((f'{lib} best-of ({len(rs)} configs, per call)', [dict(rs[0][i], ms=min(r[i]['ms'] for r in rs), ts=rs[0][i]['ts']) for i in range(len(keys))]))
    for arm, rows in sorted(entries, key=lambda e: sum(r['ms'] for r in e[1])):
        ms = np.array([r['ms'] for r in rows]); g, lo, hi, _ = rl.cluster_bootstrap(ms, b, cl)
        lines.append(f"| {arm} | {np.percentile(ms, 50):.3f} | {rl.per_request(rows)[2]:.3f} | {ms.sum():.1f} | {g:.2f}× [{lo:.2f}, {hi:.2f}] | "
                     f"{np.mean(b < ms) * 100:.0f}% | {max(r['err'] for r in rows):.1e} | {np.mean([r['top1_S'] for r in rows]) * 100:.1f}% |")
text = '\n'.join(lines)
print(text)
if a.md:
    open(a.md, 'w').write(text + '\n')
