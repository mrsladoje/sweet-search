# python3 analyze_final.py results/<tag> [--base ours] [--group-by set|cell] [--md out.md]
#
# Per arm and call: latency = median over rounds of the per-round call latency.
# Per workload (replay set, or size-sweep cell):
#   p50 / p95 / total  across calls
#   ratio  geometric mean over calls of (arm latency / base latency), with a 95%
#          bootstrap CI (10,000 resamples of calls, seed 42); > 1 = base faster
#   win    share of calls on which the base is faster
#   err / top1  max |score - float64 reference| and top-1 agreement with it
# Rivals: all configs of one library (maxsim_cpu_*, numpy_*, torch_*, numkong_*, any
# thread count) form a family, reported at its FASTEST configuration per workload
# (lowest total time, chosen on the reported data itself, which can only favour
# them), plus "best-of" = per call the fastest of all the family's configs.
# Single-threaded configs (@t1) also form "<library>@t1", for --base ours@t1.
import argparse, collections, glob, json, math, os, re
import numpy as np

p = argparse.ArgumentParser()
p.add_argument('dir')
p.add_argument('--base', default='ours')
p.add_argument('--md')
a = p.parse_args()

runs = collections.defaultdict(list)
for f in sorted(glob.glob(os.path.join(a.dir, '*.r*.json'))):
    arm = re.sub(r'\.r\d+\.json$', '', os.path.basename(f))
    runs[arm].append(json.load(open(f)))

arms = {}
for arm, rs in runs.items():
    calls = rs[0]['calls']
    keyed = [{(c['set'], c['file']): c for c in r['calls']} for r in rs]
    rows = []
    for c in calls:
        k = (c['set'], c['file'])
        ms = [kd[k]['ms'] for kd in keyed if k in kd]
        rows.append(dict(c, ms=float(np.median(ms)), rounds=len(ms)))
    arms[arm] = dict(rows=rows, env=rs[0]['env'], clamp=rs[0]['clamp'], rounds=len(rs))


def families(arm):
    """A rival config belongs to its library's family (any thread count) and, when
    single-threaded, also to "<library>@t1" (compared with ours@t1)."""
    base = arm.split('@')[0]
    for fam in ('maxsim_cpu', 'numpy', 'torch', 'numkong'):
        if base.startswith(fam):
            return [fam] + ([fam + '@t1'] if arm.endswith('@t1') else [])
    return [arm]


def by_workload(rows):
    out = collections.defaultdict(list)
    for r in rows:
        out[r['set']].append(r)
    return out


rng = np.random.default_rng(42)


def ratio_ci(x, y):
    lr = np.log(np.asarray(x) / np.asarray(y))
    g = math.exp(lr.mean())
    idx = rng.integers(0, len(lr), size=(10000, len(lr)))
    bs = np.exp(lr[idx].mean(1))
    return g, np.percentile(bs, 2.5), np.percentile(bs, 97.5)


base = arms[a.base]
base_w = by_workload(base['rows'])
lines = []
for w, brows in base_w.items():
    keys = [(r['set'], r['file']) for r in brows]
    bms = np.array([r['ms'] for r in brows])
    lines.append(f"\n### {w}: {len(brows)} calls, base = {a.base} (rounds {base['rounds']})\n")
    lines.append('| arm | config | p50 ms | p95 ms | total ms | ratio vs base [95% CI] | base faster on | max err | top-1 |')
    lines.append('|---|---|---|---|---|---|---|---|---|')
    fams = collections.defaultdict(list)
    for arm in arms:
        for fam in families(arm):
            fams[fam].append(arm)
    entries = []
    for fam, members in fams.items():
        cand = []
        for arm in members:
            m = {(r['set'], r['file']): r for r in arms[arm]['rows']}
            if not all(k in m for k in keys):
                continue
            rows = [m[k] for k in keys]
            cand.append((sum(r['ms'] for r in rows), arm, rows))
        if not cand:
            continue
        cand.sort()
        _, best_arm, rows = cand[0]
        entries.append((fam, best_arm, rows))
        if len(cand) > 1:
            oracle = [min(c[2][i]['ms'] for c in cand) for i in range(len(keys))]
            entries.append((fam + ' best-of', f'{len(cand)} configs, per call', [dict(rows[i], ms=oracle[i]) for i in range(len(keys))]))
    for fam, arm, rows in sorted(entries, key=lambda e: sum(r['ms'] for r in e[2])):
        ms = np.array([r['ms'] for r in rows])
        g, lo, hi = ratio_ci(ms, bms)
        win = float(np.mean(bms < ms)) * 100
        err = max(r['err'] for r in rows); top1 = np.mean([r['top1'] for r in rows]) * 100
        lines.append(f"| {fam} | {arm} | {np.percentile(ms, 50):.3f} | {np.percentile(ms, 95):.3f} | {ms.sum():.1f} | "
                     f"{g:.2f}× [{lo:.2f}, {hi:.2f}] | {win:.0f}% | {err:.1e} | {top1:.1f}% |")
text = '\n'.join(lines)
print(text)
if a.md:
    open(a.md, 'w').write(text + '\n')
