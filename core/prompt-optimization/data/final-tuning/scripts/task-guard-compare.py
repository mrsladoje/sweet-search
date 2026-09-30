#!/usr/bin/env python3
"""Read-out for the task-bench guard of SS_VARIANT_CC_RULES_IN_PROMPT (see ../TASK-GUARD.md).

Usage: task-guard-compare.py <eval/task-completion-bench/results/tg-<stamp>.manifest>
The manifest (written by task-guard.sh) has one line per finished leg: `<run id> <base|var> <cell A|B> <rep>`.
Reads each leg's rows.json and turns files; prints per-arm totals, paired cost ratios (bootstrap, seed 42),
a per-task table and automatic red flags. Solves come first; cost is direction only (MDE far above the expected effect).
"""
import json, os, random, math, sys
from collections import defaultdict

LOTTERY = {'smooth-code__svgr-10', 'joshuakgoldberg__bingo-271'}  # solve lottery / never-solved, see HILLCLIMB.md


def load(manifest):
    bench = os.environ.get('GUARD_BENCH') or os.path.dirname(os.path.dirname(os.path.abspath(manifest)))
    legs = []
    for line in open(manifest):
        parts = line.split()
        if len(parts) < 4 or parts[0].startswith('#'):
            continue
        run, arm, cell, rep = parts[:4]
        d = os.path.join(bench, 'results', run)
        p = os.path.join(d, 'rows.json')
        if not os.path.exists(p):
            print(f'  (no rows.json for {run} {arm} {cell} rep{rep})')
            continue
        for r in json.load(open(p)):
            if r.get('arm') != 'sweet':
                continue
            r = dict(r)
            r['_arm'], r['_cell'], r['_rep'], r['_dir'] = arm, cell, int(rep), d
            legs.append(r)
    return legs


def first_request(r):
    f = os.path.join(r['_dir'], 'turns', f"{r['taskId']}-sweet.jsonl")
    if not os.path.exists(f):
        return None
    for line in open(f):
        o = json.loads(line)
        if o.get('t') == 1:
            return o
    return None


def cost(r):
    return float(r.get('idealCostUsd') or 0)


def geo_ci(pairs, n=5000, seed=42):
    # pairs: list of (base_cost, var_cost); geometric mean of var/base, bootstrap over pairs
    lr = [math.log(v / b) for b, v in pairs if b > 0 and v > 0]
    if not lr:
        return None
    rnd = random.Random(seed)
    means = sorted(sum(rnd.choice(lr) for _ in lr) / len(lr) for _ in range(n))
    return math.exp(sum(lr) / len(lr)) - 1, math.exp(means[int(0.025 * n)]) - 1, math.exp(means[int(0.975 * n) - 1]) - 1, len(lr)


def main(manifest):
    rows = load(manifest)
    if not rows:
        print('no rows'); return
    by = defaultdict(list)
    for r in rows:
        by[r['_arm']].append(r)
    print(f"{'arm':5} {'n':>3} {'solved':>6} {'ideal$':>7} {'real$':>7} {'turns':>5} {'calls':>5} {'ss':>4} {'natG':>4} {'natR':>4} {'bash':>4} {'subag':>5} {'degen':>5} {'noVerd':>6} {'ungr':>4} {'r1 cacheW':>9} {'r1 in':>6}")
    tot = {}
    for arm in ('base', 'var'):
        rs = by.get(arm, [])
        if not rs:
            continue
        s = lambda k: sum(int(r.get(k) or 0) for r in rs)
        tc = lambda k: sum(int((r.get('toolCounts') or {}).get(k) or 0) for r in rs)
        fr = [first_request(r) for r in rs]; fr = [x for x in fr if x]
        cw = sum(x.get('cacheWrite', 0) for x in fr) / max(len(fr), 1)
        fin = sum(x.get('in', 0) for x in fr) / max(len(fr), 1)
        solved = sum(1 for r in rs if r.get('resolved') is True)
        ungraded = sum(1 for r in rs if r.get('resolved') is None)
        degen = sum(1 for r in rs if r.get('degenReran') or r.get('degenerate'))
        tot[arm] = dict(n=len(rs), solved=solved, ss=tc('ss'), nat=tc('nativeGrep') + tc('nativeRead'), calls=s('calls'), sub=s('sidechainCount'), degen=degen, cw=cw)
        print(f"{arm:5} {len(rs):>3} {solved:>6} {sum(cost(r) for r in rs):7.3f} {sum(float(r.get('costRealizedUsd') or 0) for r in rs):7.3f} {s('idealTurns'):>5} {s('calls'):>5} {tc('ss'):>4} {tc('nativeGrep'):>4} {tc('nativeRead'):>4} {tc('bash'):>4} {s('sidechainCount'):>5} {degen:>5} {s('rtNoVerdict'):>6} {ungraded:>4} {cw:9.0f} {fin:6.0f}")

    # paired by (task, rep)
    key = lambda r: (r['taskId'], r['_rep'])
    b = {key(r): r for r in by.get('base', [])}; v = {key(r): r for r in by.get('var', [])}
    common = sorted(set(b) & set(v))
    pairs = [(cost(b[k]), cost(v[k])) for k in common]
    print(f"\npaired (task, rep) pairs: {len(common)} of base {len(b)} / var {len(v)}")
    for label, sel in (('all', lambda k: True), ('without svgr+bingo', lambda k: k[0] not in LOTTERY)):
        ps = [(cost(b[k]), cost(v[k])) for k in common if sel(k)]
        g = geo_ci(ps)
        if g:
            print(f"  ideal$ var/base geo-mean [{label}]: {g[0]*100:+.1f}%  95% CI [{g[1]*100:+.1f}, {g[2]*100:+.1f}]  n={g[3]}   (MDE at this n is 15-28%: a CI that spans 0 is expected)")
    tb = sum(x for x, _ in pairs); tv = sum(y for _, y in pairs)
    print(f"  sum ideal$ over pairs: base {tb:.3f} var {tv:.3f} ({(tv/tb-1)*100 if tb else 0:+.1f}%)")

    # per task
    print('\nper task (solved/n, mean ideal$, mean calls, ss share of ss+native search/read, patch files)')
    tasks = sorted({r['taskId'] for r in rows})
    flags = []
    for t in tasks:
        line = f"{t[:38]:38}"
        rec = {}
        for arm in ('base', 'var'):
            rs = [r for r in by.get(arm, []) if r['taskId'] == t]
            if not rs:
                line += ' | ' + ' ' * 40; continue
            k = sum(1 for r in rs if r.get('resolved') is True)
            ss = sum((r.get('toolCounts') or {}).get('ss', 0) for r in rs)
            nat = sum((r.get('toolCounts') or {}).get('nativeGrep', 0) + (r.get('toolCounts') or {}).get('nativeRead', 0) for r in rs)
            pf = [int(r.get('patchFiles') or 0) for r in rs]
            rec[arm] = (k, len(rs), ss, nat, pf, sum(int(r.get('calls') or 0) for r in rs) / len(rs))
            line += f" | {arm}: {k}/{len(rs)} ${sum(cost(r) for r in rs)/len(rs):.3f} c={rec[arm][5]:.0f} ss={ss}/{ss+nat} pf={pf}"
        print(line)
        if 'base' in rec and 'var' in rec:
            if rec['var'][0] < rec['base'][0]:
                flags.append(f"SOLVE LOSS {t}: var {rec['var'][0]}/{rec['var'][1]} < base {rec['base'][0]}/{rec['base'][1]}")
            if sorted(set(rec['var'][4])) != sorted(set(rec['base'][4])) and rec['var'][0] <= rec['base'][0]:
                flags.append(f"PATCH-FILES differ {t}: base {rec['base'][4]} var {rec['var'][4]} (wrong-file edit? read the patches)")
    # arm-level flags
    if 'base' in tot and 'var' in tot:
        tb_, tv_ = tot['base'], tot['var']
        if tv_['solved'] < tb_['solved']:
            flags.append(f"SOLVES lower: var {tv_['solved']}/{tv_['n']} vs base {tb_['solved']}/{tb_['n']}")
        sh = lambda d: d['ss'] / max(d['ss'] + d['nat'], 1)
        if sh(tv_) < sh(tb_) - 0.05:
            flags.append(f"ss-* share of search/read calls fell: base {sh(tb_):.2f} var {sh(tv_):.2f} (native fallbacks up)")
        if tv_['sub'] > tb_['sub']:
            flags.append(f"subagent requests up: base {tb_['sub']} var {tv_['sub']} (the variant's subagents carry NO rules)")
        if tv_['degen'] > tb_['degen']:
            flags.append(f"degenerate/re-run rollouts up: base {tb_['degen']} var {tv_['degen']}")
        if tv_['calls'] > 1.15 * tb_['calls']:
            flags.append(f"tool calls up {tv_['calls']/tb_['calls']-1:+.0%} (base {tb_['calls']} var {tv_['calls']})")
        if not (tv_['cw'] < tb_['cw']):
            flags.append(f"MECHANISM NOT SEEN: mean request-1 cache-write tokens base {tb_['cw']:.0f} var {tv_['cw']:.0f} (expected var lower by ~1.4-2k)")
    for r in rows:
        if r.get('resolved') is None or r.get('shimTampered') or r.get('rtInfra'):
            flags.append(f"INFRA {r['taskId']} {r['_arm']} rep{r['_rep']}: resolved={r.get('resolved')} shimTampered={r.get('shimTampered')} rtInfra={r.get('rtInfra')}")
    print('\nRED FLAGS' if flags else '\nred flags: none')
    for f in flags:
        print('  -', f)


if __name__ == '__main__':
    main(sys.argv[1])
