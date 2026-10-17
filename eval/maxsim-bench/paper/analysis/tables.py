# venv/bin/python -I paper/analysis/tables.py
#
# Post-freeze analysis code (not frozen). From the load.py caches, writes tables/*.json and
# tables/*.md: the cross-machine speed table (frozen shortlist, both uncertainty numbers),
# the pool-parked, one-thread and int4-self views, the replica host-to-host spread, the
# size sweep, and every cell where a rival is faster than the sweet kernel. Aggregates only.
import os, sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (PLATFORMS, SHORT, LIB_NAME, available, cache, frozen_rivals, beir_sets, sweep_sets, ratio,
                    arm_stats, fmt_ratio, dump, parse_cell, OUT)  # noqa: E402

WORKLOADS = [('agent-ho', 'agent', lambda c: ['agent-ho']), ('gcsn-ho', 'gcsn', lambda c: ['gcsn-ho']),
             ('beir', 'beir', beir_sets)]
EXACT = ('f32',)
FIXED = [('node-production', 'sweet, production path (Node)'), ('node-legacy', 'previous production path')]


def workload_rows(c, sets, fam, platform, base='ours', single=False, int4=False, fixed=()):
    rows = []
    for arm, label in fixed:
        r = ratio(c, sets, arm, base)
        if r:
            rows.append(dict(label=label, lib=arm, itype='', arm=arm, **r, **(arm_stats(c, sets, arm) or {})))
    for lib, it, arm in frozen_rivals(platform, fam, single):
        if (it == 'int4-self') != int4:
            continue
        r = ratio(c, sets, arm, base)
        st = arm_stats(c, sets, arm) or {}
        if r is None:
            rows.append(dict(label=f'{LIB_NAME.get(lib, lib)}, {it}', lib=lib, itype=it, arm=arm, missing=True))
            continue
        rows.append(dict(label=f'{LIB_NAME.get(lib, lib)}, {it}', lib=lib, itype=it, arm=arm, **r, **st))
    return rows


def best_exact(rows):
    ex = [r for r in rows if r.get('itype') in EXACT and r.get('lib') != 'numkong' and 'ratio' in r]
    return min(ex, key=lambda r: r['ratio']) if ex else None


def main():
    res = {'warm': {}, 'parked': {}, 'single': {}, 'int4': {}, 'replica': {}, 'sweep': {}, 'losses': [], 'tiers': {}}
    for p in PLATFORMS:
        if not available(p):
            continue
        w, pk = cache(p, 'ho-warm'), cache(p, 'ho-parked')
        for name, fam, sets_of in WORKLOADS:
            sets = sets_of(w)
            res['warm'].setdefault(p, {})[name] = workload_rows(w, sets, fam, p, fixed=FIXED)
            res['single'].setdefault(p, {})[name] = workload_rows(w, sets, fam, p, base='ours@t1', single=True)
            res['int4'].setdefault(p, {})[name] = workload_rows(w, sets, fam, p, int4=True)
            psets = [s for s in sets_of(pk)] if name == 'beir' else ([name] if name in pk else [])
            if psets:
                res['parked'].setdefault(p, {})[name] = dict(sets=psets, rows=workload_rows(
                    pk, psets, fam, p, fixed=[('node-production', 'sweet, production path (Node)'),
                                             ('node-prewarm', 'sweet, production path + prewarm')]))
        # product fallback tiers (every 4th call), against the native production path
        tc = cache(p, 'ho-tiers')
        for name in ('agent-ho', 'gcsn-ho'):
            if name in tc:
                res['tiers'].setdefault(p, {})[name] = [dict(arm=a, **ratio(tc, [name], a, 'node-production')) for a in ('node-wasm', 'node-js')
                                                        if a in tc[name]['arms']]
        # replica: the same frozen configurations on a second host of the type
        if available(f'{p}-replica'):
            rc = cache(f'{p}-replica', 'ho-warm')
            for name, fam, _ in WORKLOADS[:2]:
                rows = []
                for r0 in workload_rows(w, [name], fam, p, fixed=FIXED):
                    r1 = ratio(rc, [name], r0['arm'])
                    if r1 and 'ratio' in r0:
                        rows.append(dict(label=r0['label'], arm=r0['arm'], shard=r0['ratio'], replica=r1['ratio'],
                                         replica_lo=r1['lo'], replica_hi=r1['hi'], rel_diff=r1['ratio'] / r0['ratio'] - 1))
                ours0, ours1 = w[name]['arms']['ours']['ms'], rc[name]['arms']['ours']['ms']
                res['replica'].setdefault(p, {})[name] = dict(rows=rows, ours_p50_shard=float(np.median(ours0)),
                                                             ours_p50_replica=float(np.median(ours1)),
                                                             ours_geomean_replica_over_shard=float(np.exp(np.mean(np.log(ours1 / ours0)))))
        # sweep: per cell, every frozen rival and the fastest exact one
        cells = {}
        for s in sweep_sets(w):
            rows = workload_rows(w, [s], 'sweep', p)
            b = best_exact(rows)
            q, d, ln = parse_cell(s)
            cells[s] = dict(q=q, docs=d, len=ln, calls=len(w[s]['arms']['ours']['ms']),
                            ours_p50=float(np.median(w[s]['arms']['ours']['ms'])),
                            best=None if not b else dict(lib=b['lib'], arm=b['arm'], ratio=b['ratio'], lo=b['lo'], hi=b['hi'],
                                                         spread=b['spread']),
                            rows=[dict(lib=r['lib'], itype=r['itype'], arm=r['arm'], ratio=r.get('ratio'), lo=r.get('lo'), hi=r.get('hi'),
                                       spread=r.get('spread')) for r in rows])
        res['sweep'][p] = cells
        # losses: every cell where a frozen rival configuration is faster
        def add(mode, where, rows):
            for r in rows:
                if r.get('ratio') is not None and r['ratio'] < 1 and r.get('lib') not in ('node-production', 'node-legacy', 'node-prewarm'):
                    res['losses'].append(dict(platform=p, mode=mode, where=where, label=r['label'], arm=r['arm'], ratio=r['ratio'],
                                              lo=r['lo'], hi=r['hi'], spread=r.get('spread'), significant=r['hi'] < 1))
        for name in res['warm'][p]:
            add('warm', name, res['warm'][p][name])
            add('one thread', name, res['single'][p][name])
            add('int4-self', name, res['int4'][p][name])
            if name in res['parked'].get(p, {}):
                add('pool-parked', name, res['parked'][p][name]['rows'])
        for s, cell in cells.items():
            add('warm sweep', s, [dict(label=f"{LIB_NAME.get(r['lib'], r['lib'])}, {r['itype']}", **r) for r in cell['rows']])
    dump('speed.json', res)
    write_md(res)


def write_md(res):
    L = ['# Speed tables (held-out; agent-ho, gcsn-ho and sweep-ho previously examined; BEIR fresh)', '',
         'ratio = rival / sweet kernel, geometric mean over calls; > 1 = sweet faster. [workload 95% CI: cluster bootstrap, '
         '10,000 resamples, seed 42] (execution spread: min–max over the R = 5 process repetitions).', '']
    for mode in ('warm', 'single', 'int4'):
        L += [f'## {mode}', '']
        for p, ws in res[mode].items():
            for name, rows in ws.items():
                L.append(f'### {SHORT[p]} — {name}')
                L.append('| config | arm | calls | clusters | ratio [CI] (spread) | sweet faster on | max err | top-1 = S |')
                L.append('|---|---|--:|--:|--:|--:|--:|--:|')
                for r in rows:
                    if r.get('missing'):
                        L.append(f"| {r['label']} | `{r['arm']}` | — | — | not run | | | |"); continue
                    L.append(f"| {r['label']} | `{r['arm']}` | {r['calls']} | {r['clusters']} | {fmt_ratio(r)} | {r['faster_share']*100:.0f}% | "
                             f"{r.get('err', float('nan')):.1e} | {r.get('top1_S', float('nan'))*100:.1f}% |")
                L.append('')
    L += ['## pool-parked (5 ms busy gap before each call)', '']
    for p, ws in res['parked'].items():
        for name, d in ws.items():
            L.append(f"### {SHORT[p]} — {name} ({len(d['sets'])} sets)")
            L.append('| config | arm | calls | ratio [CI] (spread) |'); L.append('|---|---|--:|--:|')
            for r in d['rows']:
                L.append(f"| {r['label']} | `{r['arm']}` | {r.get('calls', '—')} | {fmt_ratio(r) if 'ratio' in r else 'not run'} |")
            L.append('')
    L += ['## replica host-to-host', '', '| platform | set | config | ratio shard host | ratio replica host | relative difference |', '|---|---|---|--:|--:|--:|']
    for p, ws in res['replica'].items():
        for name, d in ws.items():
            for r in d['rows']:
                L.append(f"| {SHORT[p]} | {name} | {r['label']} | {r['shard']:.3f} | {r['replica']:.3f} | {r['rel_diff']*100:+.1f}% |")
            L.append(f"| {SHORT[p]} | {name} | sweet kernel p50 ms (shard / replica) | {d['ours_p50_shard']:.4f} | {d['ours_p50_replica']:.4f} | "
                     f"{(d['ours_geomean_replica_over_shard']-1)*100:+.1f}% (geomean) |")
    L += ['', f"## losses: {len(res['losses'])} (platform, mode, set or cell, configuration) cases with ratio < 1", '',
          '| platform | mode | where | config | ratio [CI] (spread) | CI below 1 |', '|---|---|---|---|--:|---|']
    for x in sorted(res['losses'], key=lambda x: (x['platform'], x['mode'], x['where'], x['ratio'])):
        L.append(f"| {SHORT[x['platform']]} | {x['mode']} | {x['where']} | {x['label']} | {fmt_ratio(x)} | {'yes' if x['significant'] else 'no'} |")
    open(os.path.join(OUT, 'speed.md'), 'w').write('\n'.join(L) + '\n')


if __name__ == '__main__':
    main()
