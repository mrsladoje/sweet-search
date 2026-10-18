# venv/bin/python -I paper/analysis/mktex.py
#
# Post-freeze analysis code (not frozen). Turns the aggregate tables (tables/*.json) into
#   paper/numbers.tex           one macro per number used in the prose: \N{key}
#   paper/tables/*.tex          the bodies of the paper's tables
#   paper/analysis/RESULTS-paper.md   every number with its key, value, source file and the command
# A platform without results yet (the EPYC box) gets \TODO{epyc} cells.
import json, os, statistics, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
T = os.path.join(HERE, 'tables')
PAPER = os.path.dirname(HERE)
TEX = os.path.join(PAPER, 'tables')
PLAT = ['intel', 'amd', 'arm', 'm3max', 'epyc']
PN = {'intel': 'Xeon 6 (Granite Rapids)', 'amd': 'EPYC 9R45 (Zen 5)', 'arm': 'Graviton4', 'm3max': 'Apple M3 Max', 'epyc': 'EPYC 7003 (Zen 3)'}
LIBN = {'numpy': 'NumPy', 'numpy+blis': 'NumPy (BLIS)', 'torch': 'PyTorch', 'maxsim_cpu': 'maxsim-cpu', 'nextplaid': 'NextPlaid', 'numkong': 'NumKong'}
PS = {'intel': 'Intel', 'amd': 'AMD', 'arm': 'Graviton4', 'm3max': 'M3 Max', 'epyc': 'EPYC'}
NUM = []   # (key, value, source, note)
CMD = {
    'speed.json': 'venv/bin/python -I paper/analysis/load.py intel amd arm m3max epyc {intel,amd,arm}-replica && venv/bin/python -I paper/analysis/tables.py',
    'conc.json': 'venv/bin/python -I paper/analysis/conc.py',
    'conc2.json': 'venv/bin/python -I paper/analysis/conc2.py',
    'floor.json': 'venv/bin/python -I paper/analysis/floor_collect.py',
    'beir_lengths.json': 'venv/bin/python -I paper/analysis/beir_lengths.py',
    'checks.json': 'venv/bin/python -I paper/analysis/checks_collect.py   (after rerun/f32direct.py and rerun/colbert300.py on the M3 Max)',
    'rerun_beir.json': 'venv/bin/python -I paper/analysis/rerun_beir.py   (after load.py intel-r2 amd-r2 arm-r2)',
    'memory.json': 'venv/bin/python -I paper/analysis/memory.py',
    'contract_effects.json': 'venv/bin/python -I paper/analysis/contract_effects.py',
    'quality_extra.json': 'venv/bin/python -I paper/analysis/quality_extra.py',
    'budget.json': 'venv/bin/python -I paper/analysis/budget.py',
    'workload.json': 'venv/bin/python -I paper/analysis/workload.py',
    'machines.json': 'venv/bin/python -I paper/analysis/machines.py',
    'quality_primary.json': 'venv/bin/python -I quality.py FREEZE.json --prep PREP --results <platform BEIR folder> --out <dir>/<platform> --kernel ours; then paper/analysis/quality_collect.py',
    'counts.json': 'check_complete.py / paper/analysis/local_complete.py (logs in paper/analysis/logs/)',
}


def load(name):
    p = os.path.join(T, name)
    return json.load(open(p)) if os.path.exists(p) else {}


def put(key, value, source, note=''):
    NUM.append((key, value, source, note))
    return value


def f2(x):
    return f'{x:.2f}'


ARM_NAME = [('numpy_packed_int4', 'NumPy int4-self'), ('numpy_packed_t', 'NumPy (transposed)'), ('numpy_packed', 'NumPy'),
            ('numpy_perdoc', 'NumPy (per document)'), ('torch_pad_bmm', 'PyTorch padded bmm'), ('torch_pad_flat', 'PyTorch padded flat'),
            ('torch_colbert_packed', 'PyTorch colbert-ai packed'), ('torch_segment_reduce', 'PyTorch segment-reduce'),
            ('torch_pylate', 'PyLate'), ('maxsim_cpu_variable_int4', 'maxsim-cpu int4-self'), ('maxsim_cpu_variable', 'maxsim-cpu list'),
            ('maxsim_cpu_3d', 'maxsim-cpu 3D'), ('nextplaid', 'NextPlaid'), ('numkong_native', 'NumKong'), ('numkong', 'NumKong (Python)')]


def tx(name):
    """A result-file arm name as reader-facing text (the terminology table in the appendix lists them)."""
    base = name.split('+')[0].split('@')[0]
    lab = next((v for k, v in ARM_NAME if base.startswith(k)), base.replace('_', '-'))
    for suf in ('_bf16', '_f16', '_f32'):
        if base.endswith(suf) and not lab.endswith(suf[1:]):
            lab += ' ' + suf[1:]
    if '+blis' in name:
        lab += ' (BLIS)'
    m = __import__('re').search(r'@t?(\d+)', name)
    if m:
        lab += f', {m.group(1)} thr.'
    return lab


def todo(p):
    return r'\TODO{' + p + '}'


# ------------------------------------------------------------------ speed
SPEED = load('speed.json')
LIBCOLS = [('numpy', 'f32', 'NumPy'), ('torch', 'f32', 'PyTorch'), ('torch', 'bf16', 'PyTorch bf16'), ('maxsim_cpu', 'f32', 'maxsim-cpu'),
           ('nextplaid', 'f32', 'NextPlaid'), ('numkong', '*', 'NumKong$^\\dagger$')]
WL = [('agent-ho', 'agent'), ('gcsn-ho', 'GCSN'), ('beir', 'BEIR')]


def pick(rows, lib, it):
    c = [r for r in rows if r.get('lib') == lib and 'ratio' in r and (it == '*' or r.get('itype') == it)]
    if lib == 'numkong' and c:
        return min(c, key=lambda r: r['ratio'])
    return c[0] if c else None


def cell(r, key):
    if not r:
        return '--'
    defective = key.split('.')[1] == 'intel' and '.numkong.' in key   # NaN / garbage outputs on Intel (AMX defect)
    put(key, f2(r['ratio']), 'speed.json', f"[{f2(r['lo'])}, {f2(r['hi'])}] spread {f2(r['spread'][0]) if r.get('spread') else ''}-{f2(r['spread'][1]) if r.get('spread') else ''} arm {r['arm']}")
    put(key + '.lo', f2(r['lo']), 'speed.json'); put(key + '.hi', f2(r['hi']), 'speed.json')
    if r.get('spread'):
        put(key + '.slo', f2(r['spread'][0]), 'speed.json'); put(key + '.shi', f2(r['spread'][1]), 'speed.json')
    s = f"{r['ratio']:.2f}"
    if r.get('rival_faster', r['hi'] < 1):   # the full rule of Section 5 (interval, leave-one-process-out and single-process estimates all below 1)
        s = r'\loss{' + s + '}'
    if defective:
        s += r'$^\ast$'
    return r'\rr{' + s + '}{' + f2(r['lo']) + '}{' + f2(r['hi']) + '}'


def speed_table(mode, fname, extra=()):
    data = SPEED.get(mode, {})
    L = []
    for p in PLAT:
        if p not in data:
            L.append(f'{PS[p]} & \\multicolumn{{{2 + len(LIBCOLS) + len(extra)}}}{{l}}{{{todo("epyc")}}} \\\\')
            continue
        first = True
        for w, wl in WL:
            d = data[p].get(w)
            rows = d['rows'] if isinstance(d, dict) else d
            if not rows:
                continue
            calls = next((r['calls'] for r in rows if 'calls' in r), '')
            cells = [cell(pick(rows, lib, it), f'{mode}.{p}.{w}.{lib}.{it.replace("*", "best")}') for lib, it, _ in LIBCOLS]
            for arm, _lab in extra:
                r = next((x for x in rows if x.get('arm') == arm and 'ratio' in x), None)
                cells.append(cell(r, f'{mode}.{p}.{w}.{arm}'))
            L.append(f"{PS[p] if first else ''} & {wl} & {calls} & " + ' & '.join(cells) + r' \\')
            first = False
        L.append(r'\addlinespace')
    open(os.path.join(TEX, fname), 'w').write('\n'.join(L) + '\n')


# ------------------------------------------------------------------ main
def np_median(x):
    x = sorted(x)
    n = len(x)
    return x[n // 2] if n % 2 else (x[n // 2 - 1] + x[n // 2]) / 2


def cache_agent_sizes():
    import pickle, collections
    f = os.path.expanduser('~/.ss-eval/maxsim-analysis/cache/intel-ho-warm.pkl')
    if not os.path.exists(f):
        return None
    c = pickle.load(open(f, 'rb'))['agent-ho']['clusters']
    return list(collections.Counter(x for x in c).values())


def main():
    os.makedirs(TEX, exist_ok=True)
    speed_table('warm', 'warm.tex', extra=[('node-legacy', 'prev. path'), ('node-production', 'prod. path')])
    speed_table('parked', 'parked.tex', extra=[('node-prewarm', 'prewarm'), ('node-production', 'prod. path')])
    speed_table('single', 'single.tex')
    speed_table('int4', 'int4.tex')
    # int4-self compact: numpy/maxsim-cpu int4 rows
    rows = []
    for p in PLAT:
        d = SPEED.get('int4', {}).get(p)
        if not d:
            rows.append(f'{PS[p]} & {todo("epyc")} & & \\\\'); continue
        for w, wl in WL:
            cs = []
            for lib in ('numpy', 'maxsim_cpu'):
                r = pick(d.get(w, []), lib, 'int4-self')
                cs.append(cell(r, f'int4.{p}.{w}.{lib}'))
            rows.append(f'{PS[p] if w == "agent-ho" else ""} & {wl} & ' + ' & '.join(cs) + r' \\')
    open(os.path.join(TEX, 'int4self.tex'), 'w').write('\n'.join(rows) + '\n')

    # ranges over platforms (and workloads) for prose: range.<name>.min / .max, with where each end is
    def rng(name, items, fmt=f2):
        items = [x for x in items if x[0] is not None]
        if not items:
            return
        lo, hi = min(items), max(items)
        put(f'range.{name}.min', fmt(lo[0]), 'speed.json / conc.json', lo[1]); put(f'range.{name}.max', fmt(hi[0]), 'speed.json / conc.json', hi[1])

    def rows_of(mode, p, w):
        d = SPEED.get(mode, {}).get(p, {}).get(w)
        return (d['rows'] if isinstance(d, dict) else d) or []

    def arm_ratio(mode, p, w, pred):
        r = next((x for x in rows_of(mode, p, w) if pred(x) and 'ratio' in x), None)
        return (r['ratio'], f'{p} {w} {r["arm"]}') if r else (None, '')
    P4 = [p for p in PLAT if p in SPEED.get('warm', {})]
    LINUX = [p for p in P4 if p in ('intel', 'amd', 'arm', 'epyc')]
    for arm in ('node-production', 'node-legacy'):
        rng(f'warm.{arm}', [arm_ratio('warm', p, w, lambda x, a=arm: x['arm'] == a) for p in P4 for w in ('agent-ho', 'gcsn-ho', 'beir')])
    rng('parked.prewarm.agent', [arm_ratio('parked', p, 'agent-ho', lambda x: x['arm'] == 'node-prewarm') for p in P4])
    rng('int4self', [arm_ratio('int4', p, w, lambda x, l=lib: x.get('lib') == l) for p in P4 for w in ('agent-ho', 'gcsn-ho', 'beir')
                     for lib in ('numpy', 'maxsim_cpu')])
    rng('single.numpy.linux.agentgcsn', [arm_ratio('single', p, w, lambda x: x.get('lib') == 'numpy') for p in LINUX for w in ('agent-ho', 'gcsn-ho')])
    rng('single.exact.linux.agentgcsn', [(min((x['ratio'], f"{p} {w} {x['arm']}") for x in rows_of('single', p, w)
                                              if 'ratio' in x and x.get('lib') not in ('numkong',)) if rows_of('single', p, w) else (None, ''))
                                         for p in LINUX for w in ('agent-ho', 'gcsn-ho')])
    for w in ('agent-ho', 'gcsn-ho'):
        for a in ('node-wasm', 'node-js'):
            rng(f'tiers.{w}.{a}', [(r['ratio'], f'{p}') for p, ws in SPEED.get('tiers', {}).items() for r in ws.get(w, []) if r['arm'] == a],
                fmt=lambda x: f'{x:.0f}')
    for p, ws in SPEED.get('tiers', {}).items():
        for w, rows in ws.items():
            for r in rows:
                put(f"tiers.{p}.{w}.{r['arm']}", f"{r['ratio']:.0f}" if r['ratio'] >= 10 else f2(r['ratio']), 'speed.json', 'tier / native production path')
    # fastest frozen rival per platform and workload: f32 input, and any input type (NumKong apart)
    for mode in ('warm', 'single', 'parked'):
        for kind, ok in (('f32', lambda r: r.get('itype') == 'f32'), ('any', lambda r: r.get('itype') in ('f32', 'bf16', 'f16'))):
            for w, _ in WL:
                vals = []
                for p, ws in SPEED.get(mode, {}).items():
                    d = ws.get(w)
                    rows = d['rows'] if isinstance(d, dict) else d
                    c = [r for r in rows or [] if 'ratio' in r and ok(r) and r.get('lib') not in ('numkong', 'numpy+blis', None)
                         and not str(r.get('arm', '')).startswith('node')]
                    if not c:
                        continue
                    b = min(c, key=lambda r: r['ratio'])
                    put(f'best.{mode}.{p}.{w}.{kind}', f2(b['ratio']), 'speed.json', b['arm'])
                    put(f'best.{mode}.{p}.{w}.{kind}.lib', b['label'].split(',')[0] + ('' if b.get('itype') == 'f32' else f" ({b['itype']})"), 'speed.json')
                    vals.append(b['ratio'])
                if vals:
                    put(f'best.{mode}.{w}.{kind}.min', f2(min(vals)), 'speed.json'); put(f'best.{mode}.{w}.{kind}.max', f2(max(vals)), 'speed.json')
                    nointel = [float(v) for k_, v, _, _ in NUM if k_.startswith(f'best.{mode}.') and k_.endswith(f'.{w}.{kind}') and '.intel.' not in k_]
                    if nointel:
                        put(f'best.{mode}.{w}.{kind}.nointel.min', f2(min(nointel)), 'speed.json'); put(f'best.{mode}.{w}.{kind}.nointel.max', f2(max(nointel)), 'speed.json')
    # sweep summary numbers
    for p, cells in SPEED.get('sweep', {}).items():
        n = len(cells); lose = [c for c in cells.values() if c['best'] and c['best']['ratio'] < 1]
        put(f'sweep.{p}.cells', str(n), 'speed.json'); put(f'sweep.{p}.lose', str(len(lose)), 'speed.json', 'cells where the fastest frozen exact f32 rival is faster')
        if lose:
            w = min(lose, key=lambda c: c['best']['ratio'])
            put(f'sweep.{p}.worst', f2(w['best']['ratio']), 'speed.json', f"q{w['q']} d{w['docs']} len{w['len']} {w['best']['lib']}")
            put(f'sweep.{p}.worstcell', f"{w['q']} query tokens, {w['docs']} docs, {w['len'] if w['len'] != 'nat' else 'natural'} doc tokens", 'speed.json')
        anyw = [(r['ratio'], c, r) for c in cells.values() for r in c['rows'] if r.get('ratio') and r['itype'] in ('f32', 'bf16') and r['lib'] != 'numkong']
        if anyw:
            v, c, r = min(anyw, key=lambda x: x[0])
            put(f'sweep.{p}.worstany', f2(v), 'speed.json', f"{r['arm']} q{c['q']} d{c['docs']} len{c['len']}")
            put(f'sweep.{p}.worstany.where', f"{c['q']} query tokens, {c['docs']} docs, {c['len'] if c['len'] != 'nat' else 'natural'} doc tokens, {tx(r['arm'])}", 'speed.json')
            put(f'sweep.{p}.loseany', str(sum(1 for c in cells.values() if any(r.get('ratio') and r['ratio'] < 1 and r['itype'] in ('f32', 'bf16') and r['lib'] != 'numkong' for r in c['rows']))), 'speed.json', 'cells where some exact rival of any input type is faster')
        put(f'nksweep.{p}', str(sum(1 for c in cells.values() if any(r.get('ratio') and r['ratio'] < 1 and r['lib'] == 'numkong' for r in c['rows']))),
            'speed.json', 'sweep cells where a NumKong configuration is faster')
        win = [c['best']['ratio'] for c in cells.values() if c['best'] and c['best']['ratio'] >= 1]
        if win:
            put(f'sweep.{p}.maxwin', f2(max(win)), 'speed.json')
    # losses table (exact rivals; NumKong summarized apart)
    losses = SPEED.get('losses', [])
    import collections
    agg = collections.defaultdict(list)
    for x in losses:
        agg[(x['platform'], x['mode'], 'NumKong' if 'NumKong' in x['label'] else 'exact')].append(x)
    L = []
    for p in PLAT:
        if p not in SPEED.get('warm', {}):
            L.append(f'{PS[p]} & \\multicolumn{{4}}{{l}}{{{todo("epyc")}}} \\\\'); continue
        first = True
        for mode in ('warm', 'warm BEIR set', 'warm sweep', 'pool-parked', 'one thread'):
            for kind in ('exact', 'NumKong'):
                v = agg.get((p, mode, kind))
                if not v:
                    continue
                libs = collections.Counter(x['label'].replace('(approx.)', '').replace('  ', ' ').strip() for x in v)
                w = min(v, key=lambda x: x['ratio'])
                where = w['where'] if mode != 'warm sweep' else w['where']
                L.append(f"{PS[p] if first else ''} & {mode} & {'NumKong' if kind == 'NumKong' else 'exact'} & {len(v)} ({sum(x['significant'] for x in v)}) & "
                         f"{', '.join(sorted(set(k.split(',')[0] for k in libs)))} & {w['ratio']:.2f} ({where.replace('_', '-')}) \\\\")
                first = False
        L.append(r'\addlinespace')
    open(os.path.join(TEX, 'losses.tex'), 'w').write('\n'.join(L) + '\n')
    put('losses.total', str(len(losses)), 'speed.json', 'all (platform, mode, set/cell, frozen config) with ratio < 1')
    flips = []
    for p_, ws in SPEED.get('warm', {}).items():
        for w_ in ('agent-ho', 'gcsn-ho', 'beir'):
            for r in ws.get(w_, []):
                if 'total_ratio' in r and r.get('lib') not in ('node-production', 'node-legacy') and (r['total_ratio'] < 1) != (r['ratio'] < 1):
                    flips.append(f"{PS[p_]} {w_.replace('-ho', '')} {r['label'].replace(' (approx.)', '')} ({r['ratio']:.2f} geometric, {r['total_ratio']:.2f} total)")
    put('totalflip.n', str(len(flips)), 'speed.json', 'warm rows whose total-time ratio lies on the other side of 1 than the geometric mean')
    put('totalflip.list', '; '.join(flips) if flips else 'none', 'speed.json')
    rows_all = [r for p_, ws in SPEED.get('warm', {}).items() for w_ in ('agent-ho', 'gcsn-ho', 'beir') for r in ws.get(w_, []) if 'spread_frozen' in r and r.get('spread_frozen')]
    put('spread.outside.n', str(sum(1 for r in rows_all if r.get('outside_frozen_spread'))), 'speed.json', 'warm rows whose ratio lies outside the frozen per-process range')
    put('spread.rows.n', str(len(rows_all)), 'speed.json')
    bs = collections.Counter((x['platform'], x['label']) for x in losses if x['mode'] == 'warm BEIR set' and x['significant'])
    for (p_, lab), n in bs.items():
        key = lab.replace(' (approx.)', '').replace(', ', '.').replace(' ', '')
        put(f'beirset.{p_}.{key}', str(n), 'speed.json', f'BEIR sets (of 20) where {lab} is faster')
    # BEIR on a second instance (post-freeze rerun, rerun_beir.py)
    RB = load('rerun_beir.json')
    if RB:
        import statistics
        cf = [x for p in RB for g in ('k100', 'k25') if g in RB[p] for x in RB[p][g]['configs']]
        rows_ = [x for p in RB for g in ('k100', 'k25') if g in RB[p] for x in RB[p][g]['rows']]
        put('rbeir.n', str(len(cf)), 'rerun_beir.json', 'frozen rival configurations compared (3 cloud CPUs x 2 set groups)')
        put('rbeir.median', f"{statistics.median(abs(x['rel_diff']) for x in cf) * 100:.1f}", 'rerun_beir.json', 'median |relative difference| of a ratio, %')
        put('rbeir.max', f"{max(abs(x['rel_diff']) for x in cf) * 100:.1f}", 'rerun_beir.json', 'max |relative difference| of a ratio, %')
        put('rbeir.flips', str(sum(x['side_change'] for x in cf) + sum(x['side_change'] for x in rows_)), 'rerun_beir.json', 'ratios that cross 1')
        ob = [abs(RB[p][g]['ours_rerun_over_first'] - 1) * 100 for p in RB for g in ('k100', 'k25') if g in RB[p]]
        put('rbeir.oursmax', f'{max(ob):.1f}', 'rerun_beir.json', 'max |difference| of the kernel geomean latency between instances, %')
        bad = sorted({a for p in RB for a, v in RB[p].get('scores', {}).items() if v['bit_equal_share'] < 1 and not a.startswith('numkong')})
        assert all(RB[p]['scores']['ours']['bit_equal_share'] == 1 for p in RB), 'kernel scores differ between instances'
        put('rbeir.nonbitequal', ', '.join(bad) or 'none', 'rerun_beir.json', 'non-NumKong arms whose scores differ from the first run')
    # replica spread
    rep = SPEED.get('replica', {})
    allr = [r['rel_diff'] for p in rep for w in rep[p] for r in rep[p][w]['rows']]
    if allr:
        import statistics
        put('replica.maxabs', f'{max(abs(x) for x in allr) * 100:.1f}', 'speed.json', 'max |relative difference| of a ratio between shard and replica instance, %')
        put('replica.median', f'{statistics.median(abs(x) for x in allr) * 100:.1f}', 'speed.json', 'median |relative difference|, %')
        put('replica.n', str(len(allr)), 'speed.json')
        flips = sum(1 for p in rep for w in rep[p] for r in rep[p][w]['rows'] if (r['shard'] - 1) * (r['replica'] - 1) < 0)
        put('replica.flips', str(flips), 'speed.json', 'ratios that cross 1 between instances')
        ours = [abs(rep[p][w]['ours_geomean_replica_over_shard'] - 1) * 100 for p in rep for w in rep[p]]
        put('replica.oursmax', f'{max(ours):.1f}', 'speed.json', 'max |difference| of the kernel geomean latency between instances, %')
        R = []
        for p in PLAT:
            if p not in rep:
                continue
            for w in ('agent-ho', 'gcsn-ho'):
                d = rep[p][w]
                xs = [abs(r['rel_diff']) * 100 for r in d['rows']]
                R.append(f"{PS[p]} & {w} & {len(xs)} & {statistics.median(xs):.1f} & {max(xs):.1f} & {(d['ours_geomean_replica_over_shard'] - 1) * 100:+.1f} \\\\")
        open(os.path.join(TEX, 'replica.tex'), 'w').write('\n'.join(R) + '\n')

    # robustness of the warm agent and BEIR ratios: per-repository range, leave-one-repository-out range,
    # total-time ratio (sum of rival call times / sum of sweet call times) beside the geometric mean
    rows = []
    for p in PLAT:
        if p not in SPEED.get('warm', {}):
            rows.append(f'{PS[p]} & \\multicolumn{{6}}{{l}}{{{todo("epyc")}}} \\\\'); continue
        first = True
        for w, wl in (('agent-ho', 'agent'), ('gcsn-ho', 'GCSN'), ('beir', 'BEIR')):
            for r in SPEED['warm'][p][w]:
                if 'ratio' not in r or r.get('lib') in ('node-production', 'node-legacy', 'numkong') or r.get('itype') not in ('f32',):
                    continue
                rr = r.get('repo_range'); lo_ = r.get('repo_loo')
                put(f'robust.{p}.{w}.{r["lib"]}.total', f2(r['total_ratio']), 'speed.json', 'total-time ratio')
                rows.append(f"{PS[p] if first else ''} & {wl} & {LIBN.get(r['lib'], r['lib'])} & {r['ratio']:.2f} & {r['total_ratio']:.2f} & "
                            + (f"{rr[0]:.2f}--{rr[1]:.2f} & {lo_[0]:.2f}--{lo_[1]:.2f}" if rr else '-- & --') + r' \\')
                first = False
        rows.append(r'\addlinespace')
    open(os.path.join(TEX, 'robust.tex'), 'w').write('\n'.join(rows) + '\n')
    tot_lt1 = [(p, w, r['lib']) for p in SPEED.get('warm', {}) for w in ('agent-ho', 'gcsn-ho', 'beir') for r in SPEED['warm'][p][w]
               if 'total_ratio' in r and r.get('itype') == 'f32' and r.get('lib') != 'numkong' and (r['total_ratio'] < 1) != (r['ratio'] < 1)]
    put('robust.signflips', str(len(tot_lt1)), 'speed.json', 'exact f32 rows where total-time and geometric-mean ratios fall on different sides of 1: ' + str(tot_lt1))

    # agent repository weights (cluster sizes) and the effective number of clusters
    wa = cache_agent_sizes()
    if wa:
        tot = sum(wa); sh = sorted((x / tot for x in wa), reverse=True)
        put('agent.repos.min', str(min(wa)), 'load.py cache', 'calls of the smallest repository'); put('agent.repos.max', str(max(wa)), 'load.py cache')
        put('agent.repos.top5', f'{sum(sh[:5]) * 100:.0f}', 'load.py cache', 'share of calls in the 5 largest repositories, %')
        put('agent.repos.eff', f'{1 / sum(x * x for x in sh):.1f}', 'load.py cache', 'effective number of clusters, 1 / sum of squared shares')
    # ------------------------------------------------------------------ quality
    BL = load('beir_lengths.json')
    for ds in ('scifact', 'nfcorpus'):
        put(f'beir.cut.{ds}', f"{BL[ds]['cut_180'] * 100:.0f}", 'beir_lengths.json', 'share of documents cut by the 180-token limit (ColBERTv2), %')
    # review checks on the M3 Max (checks_collect.py): ColBERTv2 at 300 tokens; rivals on original float32 vectors
    CK = load('checks.json')
    for k_, v in CK.get('colbert300', {}).get('results', {}).items():
        ds, L_ = k_.split('|')
        put(f'c300.{ds}.{L_}', f"{v['ndcg10']:.3f}", 'checks.json', 'contract F nDCG@10, ColBERTv2 documents encoded at this length')
        put(f'c300.{ds}.{L_}.tokens', f"{v['mean_doc_tokens']:.0f}", 'checks.json', 'mean document tokens')
    # checks of 2026-10-18 (post_checks.py): int4 at 300 tokens, concurrent scores, pipeline stage shares
    PC = load('post_checks.json')
    sd = lambda x: f'{x:+.4f}'.replace('-0.0000', '0.0000').replace('+0.0000', '0.0000')
    for k_, v in PC.get('int4_300', {}).get('results', {}).items():
        ds, L_ = k_.split('|')
        for t_ in ('K', 'F', 'C-b'):
            put(f'i300.{ds}.{L_}.{t_}', f"{v['ndcg10'][t_]:.3f}", 'post_checks.json', 'nDCG@10')
        for t_, n_ in (('K_vs_F', 'KF'), ('Cb_vs_F', 'CbF')):
            t = v[t_]
            put(f'i300.{ds}.{L_}.{n_}', sd(t['mean_diff']), 'post_checks.json', t_ + ' mean difference')
            put(f'i300.{ds}.{L_}.{n_}.lo', sd(t['ci95'][0]), 'post_checks.json'); put(f'i300.{ds}.{L_}.{n_}.hi', sd(t['ci95'][1]), 'post_checks.json')
            put(f'i300.{ds}.{L_}.{n_}.pass', 'yes' if t['no_material_loss'] else 'no', 'post_checks.json', 'margin 0.01')
    CC = PC.get('conc_check', {})
    if CC:
        put('cc.ok', 'all' if all(c['ok'] for c in CC.values()) else 'NOT ALL', 'post_checks.json')
        put('cc.differ', str(sum(c['calls_differing'] for c in CC.values())), 'post_checks.json', 'calls whose concurrent scores differ from one-at-a-time scores')
        put('cc.arms', str(len({a for c in CC.values() for a in c['arms']})), 'post_checks.json', 'configurations checked')
        put('cc.rows', str(sum(c['rows'] for c in CC.values())), 'post_checks.json', 'configuration x executor x callers runs')
    PP = PC.get('pipeline')
    if PP:
        cw = PP['calls_with_maxsim']
        put('pipe.calls', str(cw['calls']), 'post_checks.json', 'held-out agent calls that ran MaxSim')
        put('pipe.calls.all', str(PP['all_calls']['calls']), 'post_checks.json'); put('pipe.passes', str(PP['passes']), 'post_checks.json')
        put('pipe.total.med', f"{cw['total_ms']['median']:.1f}", 'post_checks.json', 'ms'); put('pipe.total.p90', f"{cw['total_ms']['p90']:.1f}", 'post_checks.json', 'ms')
        for s_, v in cw['stages'].items():
            put(f'pipe.{s_}.med', f"{v['share_median'] * 100:.1f}", 'post_checks.json', 'median share, %')
            put(f'pipe.{s_}.p90', f"{v['share_p90'] * 100:.1f}", 'post_checks.json', 'p90 share, %')
            put(f'pipe.{s_}.sum', f"{v['share_of_summed_time'] * 100:.1f}", 'post_checks.json', 'share of the summed time, %')
            put(f'pipe.{s_}.ms', f"{v['ms_median']:.2f}", 'post_checks.json', 'median ms')
    M3 = PC.get('m3conc')
    if M3:
        sp = lambda v: (max(v.values()) - min(v.values())) / sorted(v.values())[1] * 100
        first = M3['closed']['agent-ho|ours|threads|1']
        put('m3c.first.ours', f"{first['pass0'] / 1000:.1f}", 'post_checks.json', 'kernel, agent, threads, 1 caller, first arm of the recheck (pass 0), kcalls/s')
        put('m3c.other.ours.lo', f"{min(first['pass1'], first['pass2']) / 1000:.1f}", 'post_checks.json')
        put('m3c.other.ours.hi', f"{max(first['pass1'], first['pass2']) / 1000:.1f}", 'post_checks.json')
        rest = [sp(v) for k, v in M3['closed'].items() if not k.startswith('agent-ho|ours|')]
        put('m3c.rest.spread.median', f'{statistics.median(rest):.1f}', 'post_checks.json', 'closed-loop cells except the kernel on agent calls: (max - min) / median over the passes, %')
        put('m3c.ours.gcsn.spread.max', f"{max(sp(v) for k, v in M3['closed'].items() if k.startswith('gcsn-ho|ours|')):.0f}", 'post_checks.json')
        put('m3c.ours.agent.later.spread.max', f"{max(abs(v['pass1'] - v['pass2']) / min(v['pass1'], v['pass2']) * 100 for k, v in M3['closed'].items() if k.startswith('agent-ho|ours|')):.0f}",
            'post_checks.json', 'passes 1 and 2, %')
        put('m3c.numpy.spread.max', f"{max(sp(v) for k, v in M3['closed'].items() if '|numpy' in k):.0f}", 'post_checks.json')
        put('m3c.busy.lo', f"{M3['quiet_busy_pct'][0]:.0f}", 'post_checks.json', 'CPU use at the quiet checks, % of all cores')
        put('m3c.busy.hi', f"{M3['quiet_busy_pct'][1]:.0f}", 'post_checks.json')
    EW = PC.get('epyc_warmup')
    if EW:
        nk, us = EW['p50_by_warmup']['numkong_native_f32'], EW['p50_by_warmup']['ours']
        for w in ('1', '50', '200'):
            put(f'nkw.nk.{w}', f'{nk[w]:.0f}', 'post_checks.json', f'NumKong native f32, EPYC, median over development agent calls after {w} warm-up calls, us')
        put('nkw.ours.min', f'{min(us.values()):.0f}', 'post_checks.json'); put('nkw.ours.max', f'{max(us.values()):.0f}', 'post_checks.json')
        if EW.get('calls'):
            put('nkw.calls', str(EW['calls']), 'post_checks.json')
    EP = PC.get('epyc_protocols')
    if EP:
        m = {a: {p: sum(v) / len(v) for p, v in x.items()} for a, x in EP['summary'].items()}
        exact = [a for a in m if a not in ('ours', 'numkong_native_f32')]
        for a in m:
            for p_ in ('main', 'A', 'Aw', 'B'):
                put(f'prot.{a}.{p_}', f'{m[a][p_]:.0f}', 'post_checks.json', 'EPYC, development agent calls, median per call, us (mean of runs)')
        nk = m['numkong_native_f32']; us = m['ours']
        put('prot.nk.handicap', f"{nk['main'] / nk['A']:.2f}", 'post_checks.json', 'NumKong main / A')
        put('prot.nk.main.ratio', f"{nk['main'] / us['main']:.2f}", 'post_checks.json'); put('prot.nk.A.ratio', f"{nk['A'] / us['A']:.2f}", 'post_checks.json')
        put('prot.nk.Aw.ratio', f"{nk['Aw'] / us['Aw']:.2f}", 'post_checks.json')
        for p_ in ('main', 'A'):
            r = [m[a][p_] / us[p_] for a in exact]
            put(f'prot.exact.{p_}.min', f'{min(r):.2f}', 'post_checks.json', 'exact rival / ours'); put(f'prot.exact.{p_}.max', f'{max(r):.2f}', 'post_checks.json')
        r = [m[a]['A'] / m[a]['main'] for a in exact]
        put('prot.exact.slowA.min', f'{min(r):.1f}', 'post_checks.json', 'exact rival A / main'); put('prot.exact.slowA.max', f'{max(r):.1f}', 'post_checks.json')
    if CK.get('f32direct'):
        fd = CK['f32direct']
        r = [(a['p95_ratio_original_over_decoded'], f'{c} {n}') for c, cv in fd['cells'].items() for n, a in cv['arms'].items()]
        put('f32d.ratio.min', f'{min(r)[0]:.2f}', 'checks.json', min(r)[1]); put('f32d.ratio.max', f'{max(r)[0]:.2f}', 'checks.json', max(r)[1])
        put('f32d.n', str(len(r)), 'checks.json', 'rival-set pairs'); put('f32d.k', str(fd['k']), 'checks.json')
        put('f32d.maxdiff', f"{max(c['max_abs_decoded_minus_original'] for c in fd['cells'].values()):.3f}", 'checks.json', 'max |decoded - original| of one coordinate')
        for c, cv in fd['cells'].items():
            ds, mk = c.split('|')
            o = [a['original']['ndcg10'] for a in cv['arms'].values()]
            put(f'f32d.{ds}.{mk}.orig', f'{o[0]:.3f}', 'checks.json', 'nDCG@10 of the rivals on the original vectors (equal for all arms: ' + ('yes' if max(o) - min(o) < 1e-9 else 'no') + ')')
    QP = load('quality_primary.json')
    rows = []
    for ds, mk in (('scifact', 'colbertv2'), ('nfcorpus', 'colbertv2'), ('scifact', 'answersmall'), ('nfcorpus', 'answersmall')):
        cells_ = []
        base = None
        for p in PLAT:
            t = next((x for x in QP.get(p, {}).get('primary', []) if x['dataset'] == ds and x['model'] == mk), None)
            if not t:
                cells_.append(todo('epyc')); continue
            k = f'q.{p}.{ds}.{mk}'
            put(k + '.diff', f"{t['mean_diff']:+.4f}", 'quality_primary.json'); put(k + '.lo', f"{t['ci95'][0]:+.4f}", 'quality_primary.json')
            put(k + '.hi', f"{t['ci95'][1]:+.4f}", 'quality_primary.json'); put(k + '.rel', f"{t['rel_diff'] * 100:+.2f}", 'quality_primary.json')
            put(k + '.relabs', f"{abs(t['rel_diff']) * 100:.2f}", 'quality_primary.json', 'absolute relative difference, %')
            put(k + '.p', f"{t['p_holm']:.4f}", 'quality_primary.json', 'Holm-adjusted one-sided p')
            put(k + '.F', f"{t['mean_b']:.4f}", 'quality_primary.json'); put(k + '.K', f"{t['mean_a']:.4f}", 'quality_primary.json')
            ok = t['no_material_loss'] and t['noninferior_holm_0.05']
            cells_.append(f"{t['ci95'][0]:+.4f} & {t['p_holm']:.4f} & {'\\cmark' if ok else '\\xmark'}")
            base = t
        # the kernel's nDCG@10 is the same on every CPU, so the five per-CPU results are one column
        if len(set(cells_)) != 1:
            sys.exit(f'primary test differs between CPUs for {ds} {mk}: {cells_}')
        mname = 'ColBERTv2' if mk == 'colbertv2' else 'AnswerAI-small'
        rows.append(f"{'SciFact' if ds == 'scifact' else 'NFCorpus'} & {mname} & {base['n']} & {base['mean_b']:.4f} & {base['mean_a']:.4f} & {base['mean_diff']:+.4f} "
                    f"& {base['rel_diff'] * 100:+.2f}\\% & " + cells_[0] + r' \\')
    open(os.path.join(TEX, 'primary.tex'), 'w').write('\n'.join(rows) + '\n')
    # effect decomposition at k = 100
    QX = load('quality_extra.json')
    rows = []
    for ds in ('scifact', 'nfcorpus'):
        for mk in ('colbertv2', 'answersmall'):
            c = QP.get('intel', {}).get('cells', {}).get(f'{ds}|{mk}|k100', {})
            src = c.get('sources', {})
            if not src:
                continue
            nk = {p: QP[p]['cells'][f'{ds}|{mk}|k100']['sources'].get('rival:numkong_native_f32', {}).get('ndcg10') for p in QP}
            refs = QX['refs'][f'{ds}|{mk}|k100']
            key = f'nd.{ds}.{mk}'
            vals = dict(bm25=QX['bm25'][f'{ds}|{mk}|k100'], F=src['F']['ndcg10'], Fc=src['F+c']['ndcg10'], Qc=src['Q+c']['ndcg10'], K=src['K']['ndcg10'],
                        Cb=refs['C-b-noclamp'], Ca=refs['C-a-f32-noclamp'], NK=nk.get('amd'))
            for k_, v in vals.items():
                if v is not None:
                    put(f'{key}.{k_}', f'{v:.4f}', 'quality_primary.json / quality_extra.json')
            rows.append(f"{'SciFact' if ds == 'scifact' else 'NFCorpus'} & {'ColBERTv2' if mk == 'colbertv2' else 'AnswerAI-small'} & " +
                        ' & '.join(f'{vals[k_]:.4f}' for k_ in ('bm25', 'F', 'Fc', 'Qc', 'K', 'Cb', 'Ca')) + f" & {vals['NK']:.4f} \\\\")
    open(os.path.join(TEX, 'effects.tex'), 'w').write('\n'.join(rows) + '\n')
    # cross-platform kernel agreement
    kap = QX.get('kernel_across_platforms', {})
    eqx = [v['bit_equal_share'] for c in kap.values() for pair, v in c.items() if pair.split()[0] in ('amd', 'epyc')]
    neq = [v['bit_equal_share'] for c in kap.values() for pair, v in c.items() if pair.split()[0] in ('arm', 'm3max')]
    mx = max(v['max_abs'] for c in kap.values() for v in c.values()) if kap else 0
    sr = min(v['same_ranking_share'] for c in kap.values() for v in c.values()) if kap else 0
    put('xplat.x86equal', f'{min(eqx) * 100:.0f}' if eqx else '?', 'quality_extra.json', 'AMD vs Intel bit-equal share, %')
    put('xplat.armequal.lo', f'{min(neq) * 100:.0f}' if neq else '?', 'quality_extra.json'); put('xplat.armequal.hi', f'{max(neq) * 100:.0f}' if neq else '?', 'quality_extra.json')
    put('xplat.maxabs', f'{mx:.1e}', 'quality_extra.json'); put('xplat.sameranking.min', f'{sr * 100:.1f}', 'quality_extra.json')
    kw = QX.get('kernel_within_cpu', {})
    if kw:
        put('xplat.files', f"{kw['files']:,}", 'quality_extra.json', f"bit-equal {kw['bit_equal']} of {kw['scores']}")
        put('xplat.scores', f"{kw['scores'] / 1e6:.0f}", 'quality_extra.json', 'million scores')
        put('xplat.withinequal', 'yes' if kw['bit_equal'] == kw['scores'] else 'NO', 'quality_extra.json')
    for k_, v in QX.get('score_margins', {}).items():
        ds, mk = k_.split('|')
        put(f'margin.{ds}.{mk}', f"{v['top1_top10_gap_median'] * 100:.1f}", 'quality_extra.json', '(top1 - top10) / top1 under F, median over queries, %')
    for cell_, d in QX.get('posthoc_tests', {}).items():
        ds, mk, _ = cell_.split('|')
        t = d['C-b - F']
        put(f'ph.{ds}.{mk}.Cb.diff', f"{t['mean_diff']:+.4f}", 'quality_extra.json'); put(f'ph.{ds}.{mk}.Cb.lo', f"{t['ci95'][0]:+.4f}", 'quality_extra.json')
        put(f'ph.{ds}.{mk}.Cb.hi', f"{t['ci95'][1]:+.4f}", 'quality_extra.json')
    for k_, v in QX.get('int4_diagnostic', {}).items():
        ds_, mk_ = k_.split('|')
        put(f'int4diag.{ds_}.{mk_}.lenp10', f"{v['decoded_over_stored_p10']:.3f}", 'quality_extra.json'); put(f'int4diag.{ds_}.{mk_}.lenp90', f"{v['decoded_over_stored_p90']:.3f}", 'quality_extra.json')
    for k_, v in QX.get('int4_diagnostic', {}).items():
        ds, mk = k_.split('|')
        put(f'int4diag.{ds}.{mk}.relerr', f"{v['rel_err_median']:.3f}", 'quality_extra.json'); put(f'int4diag.{ds}.{mk}.cos', f"{v['cos_median']:.4f}", 'quality_extra.json')

    NAN = load('nan.json')
    for p, d in NAN.items():
        for k_, v in d.items():
            if k_.startswith('_'):
                continue
            arm, tag, fam = k_.split('|')
            put(f'nan.{p}.{arm}.{tag}.{fam}', f"{v['nan'] / v['runs'] * 100:.1f}", 'nan.json', f"{v['nan']} of {v['runs']} call runs")
    put('nan.platforms', ', '.join(p for p, d in NAN.items() if len(d) > 1) or 'none', 'nan.json', 'platforms with any NaN score')

    NKC = load('numkong_check.json').get('results', {})
    if NKC:
        for kind in ('random', 'clustered'):
            v = [x for k_, x in NKC.items() if f'|{kind}|' in k_]
            put(f'nkcheck.{kind}.rho.min', f"{min(x['spearman_median'] for x in v):.2f}", 'numkong_check.json')
            put(f'nkcheck.{kind}.rho.max', f"{max(x['spearman_median'] for x in v):.2f}", 'numkong_check.json')
            put(f'nkcheck.{kind}.top1.min', f"{min(x['top1_agreement'] for x in v) * 100:.0f}", 'numkong_check.json')
            put(f'nkcheck.{kind}.top1.max', f"{max(x['top1_agreement'] for x in v) * 100:.0f}", 'numkong_check.json')
            put(f'nkcheck.{kind}.gap', f"{np_median([x['top1_top10_gap_median'] for x in v]) * 100:.1f}", 'numkong_check.json')
        put('nkcheck.adapter', f"{max(x['adapter_vs_python_max_abs'] or 0 for x in NKC.values()):.1g}", 'numkong_check.json', 'max |rust loop - python API|')
    NKG = load('numkong_gap.json').get('rows', [])
    if NKG:
        low = [r for r in NKG if r['gap_median'] < 0.005]
        put('nkgap.low.rho.max', f"{max(r['spearman_median'] for r in low):.2f}", 'numkong_gap.json', 'max median rank correlation at gaps below 0.5%')
        rnd = [r for r in NKG if r['noise'] is None]
        put('nkgap.random.rho.min', f"{min(r['spearman_median'] for r in rnd):.2f}", 'numkong_gap.json'); put('nkgap.random.rho.max', f"{max(r['spearman_median'] for r in rnd):.2f}", 'numkong_gap.json')
        put('nkgap.random.gap', f"{min(r['gap_median'] for r in rnd) * 100:.1f}", 'numkong_gap.json', 'median gap of the random points, %')
        put('nkgap.levels', str(len({r['noise'] for r in NKG})), 'numkong_gap.json')

    nk1 = [(r['top1'], p_, w_) for p_, ws in SPEED.get('warm', {}).items() if p_ != 'intel' for w_ in ('agent-ho', 'beir') for r in ws.get(w_, [])
           if r.get('lib') == 'numkong' and 'top1' in r]
    for w_ in ('agent-ho', 'beir'):
        v = [x[0] for x in nk1 if x[2] == w_]
        if v:
            put(f'nk.top1own.{w_}.min', f'{min(v) * 100:.0f}', 'speed.json', 'NumKong top-1 vs its own contract reference (non-AMX CPUs)')
            put(f'nk.top1own.{w_}.max', f'{max(v) * 100:.0f}', 'speed.json')
    # ------------------------------------------------------------------ contract effects
    CE = load('contract_effects.json')
    rows = []
    for g, d in CE.items():
        for name, e in d['effects'].items():
            rows.append(f"{g.replace('beir (20 sets)', 'BEIR (20 sets)')} & {name} & {e['calls_with_2plus']} & {e['max_abs']:.1e} & {e['top1_agree'] * 100:.2f}\\% & {e['top10_overlap'] * 100:.2f}\\% \\\\")
            put(f"ce.{g.split(' ')[0]}.{name.split(' (')[0].replace(' ', '-')}.top1", f"{e['top1_agree'] * 100:.2f}", 'contract_effects.json', name)
            put(f"ce.{g.split(' ')[0]}.{name.split(' (')[0].replace(' ', '-')}.maxabs", f"{e['max_abs']:.1e}", 'contract_effects.json', name)
        rows.append(r'\addlinespace')
    open(os.path.join(TEX, 'contract_effects.tex'), 'w').write('\n'.join(rows) + '\n')

    # ------------------------------------------------------------------ correctness per arm (agent-ho + BEIR, warm)
    rows = []
    for p in PLAT:
        d = SPEED.get('warm', {}).get(p)
        if not d:
            rows.append(f'{PS[p]} & \\multicolumn{{6}}{{l}}{{{todo("epyc")}}} \\\\'); continue
        first = True
        seen = set()
        for w in ('agent-ho', 'beir'):
            for r in d[w]:
                if 'ratio' not in r or r['arm'] in seen and w == 'beir':
                    pass
                if 'ratio' not in r:
                    continue
                lab = r['label'].replace('(approx.)', '').replace('_', '-')
                rows.append(f"{PS[p] if first else ''} & {w} & {lab} & {r.get('contract', '')}{'+c' if r.get('clamp') else ''} & {r.get('err', 0):.1e} & "
                            f"{r.get('err_input', 0):.1e} & {r.get('top1_S', 0) * 100:.1f}\\% \\\\")
                first = False
        rows.append(r'\addlinespace')
    open(os.path.join(TEX, 'correctness.tex'), 'w').write('\n'.join(rows) + '\n')

    # ------------------------------------------------------------------ memory
    MEM = load('memory.json')
    ARMS = [('ours', 'sweet kernel'), ('node:production', 'production path'), ('numpy_packed', 'NumPy f32'), ('torch_pad_bmm', 'PyTorch f32 (padded)'),
            ('torch_pad_bmm_bf16', 'PyTorch bf16 (padded)'), ('maxsim_cpu_variable', 'maxsim-cpu f32'), ('nextplaid', 'NextPlaid f32'),
            ('numkong_native_bf16', 'NumKong bf16'), ('numkong_native_f32', 'NumKong f32'), ('numpy_packed_int4', 'NumPy int4-self')]
    rows = []
    for arm, lab in ARMS:
        cs = []
        for p in PLAT:
            r = MEM.get(p, {}).get('agent-ho', {}).get(arm)
            if p not in MEM:
                cs.append(todo('epyc')); continue
            if not r:
                cs.append('--'); continue
            cs.append(f"{r['resident_B_per_token']:.0f} / {r['temp_largest_call_MiB']:.1f}")
            put(f'mem.{p}.{arm}.bpt', f"{r['resident_B_per_token']:.0f}", 'memory.json')
            put(f'mem.{p}.{arm}.tmp', f"{r['temp_largest_call_MiB']:.1f}", 'memory.json')
        rows.append(f'{lab} & ' + ' & '.join(cs) + r' \\')
    open(os.path.join(TEX, 'memory.tex'), 'w').write('\n'.join(rows) + '\n')
    for p in MEM:
        r = MEM[p].get('beir-dim96', {}).get('ours')
        if r:
            put(f'mem.{p}.ours.bpt96', f"{r['resident_B_per_token']:.0f}", 'memory.json')

    # ------------------------------------------------------------------ parallel callers
    # Main text: the post-freeze rerun with the fixed harness (conc2.json, median of 3 runs).
    # Appendix: the frozen single runs with their correction (conc.json), keys 'concf.*'.
    exact = lambda a: a != 'ours' and not a.startswith('numkong')
    nk = lambda a: a.startswith('numkong')

    def explicit_threads(a):
        m = __import__('re').search(r'@(\d+)', a)
        return int(m.group(1)) if m else 0

    def conc_block(CC, kp, texname, rerun):
        rows, n1, corr_share, over, spread = [], [], [], [], []
        for p in PLAT:
            if p not in CC:
                rows.append(f'{PS[p]} & \\multicolumn{{16}}{{l}}{{{todo("parallel-caller rerun")}}} \\\\'); continue
            cores = next(iter(next(iter(CC[p].values())).values()))['cores']
            for fam in ('agent', 'gcsn'):
                arms = CC[p].get(fam, {})
                if not arms:
                    rows.append(f"{PS[p] if fam == 'agent' else ''} & {fam} & \\multicolumn{{15}}{{l}}{{{todo('parallel-caller rerun')}}} \\\\"); continue

                def best(pred, n, ex):
                    v = [(r['throughput'], a) for a, d in arms.items() if pred(a) for r in d['runs']
                         if r['type'] == 'closed' and r['callers'] == n and r['executor'] == ex]
                    return max(v) if v else None
                for a, d in arms.items():
                    for r in d['runs']:
                        if r.get('corrected') and a == 'ours':
                            corr_share.append(50e6 / (r['wall_ns'] + 50e6))
                        if not rerun and r['type'] == 'closed' and r['executor'] == 'procs' and r['callers'] * max(explicit_threads(a), 1) > cores:
                            over.append(f'{p} {fam} {a} n={r["callers"]}')
                        if rerun and a == 'ours' and r['type'] == 'closed':
                            lo_, hi_ = r['throughput_range']
                            spread.append(((hi_ - lo_) / r['throughput'], f"{p} {fam} {r['executor']} n={r['callers']}"))
                cs = []
                for n in (1, 16):
                    for ex in ('procs', 'threads'):
                        o, e, k = best(lambda a: a == 'ours', n, ex), best(exact, n, ex), best(nk, n, ex)
                        r_e, r_k = o[0] / e[0], o[0] / k[0]
                        put(f'{kp}.{p}.{fam}.n{n}.{ex}.ours', f'{o[0] / 1000:.1f}', texname, 'kcalls/s')
                        put(f'{kp}.{p}.{fam}.n{n}.{ex}.exactratio', f2(r_e), texname, f'ours / {e[1]}')
                        put(f'{kp}.{p}.{fam}.n{n}.{ex}.nk', f2(r_k), texname, f'ours / {k[1]}')
                        flag = '$^\\ddagger$' if not rerun and ex == 'procs' and n > 1 and n * max(explicit_threads(e[1]), 1) > cores else ''
                        cs += [f'{o[0] / 1000:.1f}', ('\\loss{' if r_e < 1 else '{') + f'{r_e:.2f}}}{flag}', ('\\loss{' if r_k < 1 else '{') + f'{r_k:.2f}}}']
                    if n == 1:
                        for ex in ('threads', 'procs'):
                            o1 = best(lambda a: a == 'ours', 1, ex); e1 = best(exact, 1, ex)
                            n1.append((o1[0] / e1[0], f'{p} {fam} {ex}'))
                rates = sorted({r['rate'] for d in arms.values() for r in d['runs'] if r['type'] != 'closed' and r['rate']})
                top = rates[-1]
                op = {a: min((r for r in d['runs'] if r['type'] != 'closed' and r['rate'] == top), key=lambda r: r['p99_ms']) for a, d in arms.items()}
                exa = min((v['p99_ms'], a) for a, v in op.items() if exact(a))
                achieved = (lambda r: r['achieved_rate']) if rerun else (lambda r: r['n'] / (r['wall_ns'] / 1e9) if r.get('wall_ns') else float('inf'))
                ov_o = '$^\\S$' if achieved(op['ours']) < 0.95 * top else ''      # the arm did not keep up with the offered rate
                ov_e = '$^\\S$' if achieved(op[exa[1]]) < 0.95 * top else ''
                put(f'{kp}.{p}.{fam}.open.achieved.ours', f"{achieved(op['ours']):.0f}", texname, 'calls/s achieved at the top rate')
                put(f'{kp}.{p}.{fam}.open.rate', f'{top:.0f}', texname); put(f'{kp}.{p}.{fam}.open.ours', f"{op['ours']['p99_ms']:.2f}", texname)
                put(f'{kp}.{p}.{fam}.open.exact', f'{exa[0]:.2f}', texname, exa[1])
                cs += [f'{top:.0f}', f"{op['ours']['p99_ms']:.2f}{ov_o}", ('\\loss{' if exa[0] < op['ours']['p99_ms'] else '{') + f'{exa[0]:.2f}}}{ov_e}']
                lab = PS[p] + ('$^\\diamond$' if rerun and p == 'm3max' else '')   # M3 Max: the recheck (post_checks.py)
                rows.append(f"{lab if fam == 'agent' else ''} & {fam} & " + ' & '.join(cs) + r' \\')
            rows.append(r'\addlinespace')
        open(os.path.join(TEX, kp + '.tex'), 'w').write('\n'.join(rows) + '\n')
        if n1:
            for ex in ('threads', 'procs'):
                v = [x for x in n1 if x[1].endswith(ex)]
                sfx = '' if ex == 'threads' else '.procs'
                put(f'range.{kp}.n1{sfx}.min', f2(min(v)[0]), texname, min(v)[1]); put(f'range.{kp}.n1{sfx}.max', f2(max(v)[0]), texname, max(v)[1])
        if corr_share:
            put(f'{kp}.corr.share.min', f'{min(corr_share) * 100:.0f}', texname, 'share of the corrected wall time that the 50 ms term makes up, kernel procs runs')
            put(f'{kp}.corr.negative', str(sum(1 for x in corr_share if x > 1)), texname, 'kernel procs closed-loop runs whose recorded wall time was negative')
            put(f'{kp}.corr.runs', str(len(corr_share)), texname)
        if not rerun:
            put(f'{kp}.oversub.n', str(len(over)), texname, '; '.join(over[:40]))
        if spread:
            put(f'{kp}.ours.spread.max', f'{max(spread)[0] * 100:.0f}', texname, 'largest (max - min) / median of the kernel closed-loop throughput over the 3 runs, %; ' + max(spread)[1])
            put(f'{kp}.ours.spread.median', f'{statistics.median(x for x, _ in spread) * 100:.1f}', texname, 'median of the same, %')
            sp2 = [x for x in spread if not x[1].startswith('m3max')]
            if sp2:
                put(f'{kp}.ours.spread.nom3.max', f'{max(sp2)[0] * 100:.0f}', texname, 'the same maximum without the M3 Max, %; ' + max(sp2)[1])
        if rerun:
            drop, agree, kl, ol = [], [], {}, 0
            for p in CC:
                for fam, arms in CC[p].items():
                    o = {(r['executor'], r['callers']): r for r in arms['ours']['runs'] if r['type'] == 'closed'}
                    drop.append((1 - o[('threads', 16)]['throughput'] / o[('threads', 1)]['throughput'], f'{p} {fam}'))
                    if p != 'm3max':
                        a_, b_ = o[('procs', 1)]['throughput'], o[('threads', 1)]['throughput']
                        agree.append((abs(a_ - b_) / min(a_, b_), f'{p} {fam}'))
                    lo_, hi_ = o[('threads', 1)]['throughput_range']
                    put(f'{kp}.{p}.{fam}.ours.t1.lo', f'{lo_ / 1000:.1f}', texname, 'lowest of the 3 runs, kcalls/s'); put(f'{kp}.{p}.{fam}.ours.t1.hi', f'{hi_ / 1000:.1f}', texname)
                    for n in (1, 16):
                        for ex in ('procs', 'threads'):
                            k_ = f'{kp}.{p}.{fam}.n{n}.{ex}.nk'
                            if any(x[0] == k_ and float(x[1]) < 1 for x in NUM):
                                kl.setdefault(f'n{n}.{ex}', []).append(f'{p} {fam}')
                    if any(x[0] == f'{kp}.{p}.{fam}.open.exact' and float(x[1]) < float(next(y[1] for y in NUM if y[0] == f'{kp}.{p}.{fam}.open.ours')) for x in NUM):
                        ol += 1
            put(f'{kp}.thrdrop.min', f'{min(drop)[0] * 100:.0f}', texname, 'kernel throughput loss from 1 to 16 callers in one process, %: ' + min(drop)[1])
            put(f'{kp}.thrdrop.max', f'{max(drop)[0] * 100:.0f}', texname, max(drop)[1])
            put(f'{kp}.thrdrop.neg', str(sum(x <= 0 for x, _ in drop)), texname, 'pairs where 16 callers in one process did not lower the kernel throughput')
            put(f'{kp}.n1.agree.max', f'{max(agree)[0] * 100:.0f}', texname, 'largest procs-threads difference of the kernel at one caller, all CPUs but the M3 Max, %: ' + max(agree)[1])
            for k_, v in kl.items():
                put(f'{kp}.{k_}.nklost', str(len(v)), texname, ', '.join(v))
            for n in (1, 16):
                for ex in ('procs', 'threads'):
                    if f'n{n}.{ex}' not in kl:
                        put(f'{kp}.n{n}.{ex}.nklost', '0', texname)
            put(f'{kp}.open.lost', str(ol), texname, 'pairs where the best exact rival had the lower p99 at the top rate')
        # counts of 16-caller pairs where an exact rival beats sweet, per executor
        for ex in ('procs', 'threads'):
            lost = [k_ for k_, v, _, _ in NUM if k_.startswith(kp + '.') and k_.endswith(f'.n16.{ex}.exactratio') and float(v) < 1]
            put(f'{kp}.n16.{ex}.lost', str(len(set(lost))), texname, ', '.join(sorted(set(lost))))
            put(f'{kp}.pairs', str(sum(1 for p in PLAT if p in CC for fam in ('agent', 'gcsn') if CC[p].get(fam))), texname, 'CPU-workload pairs with results')
    conc_block(load('conc2.json'), 'conc', 'conc2.json', True)
    conc_block(load('conc.json'), 'concf', 'conc.json', False)

    # ------------------------------------------------------------------ fixed cost per call (floor_collect.py)
    FL = load('floor.json')
    rows, shares = [], {}
    for p in PLAT:
        if p not in FL:
            rows.append(f'{PS[p]} & \\multicolumn{{6}}{{l}}{{{todo("fixed-cost run")}}} \\\\'); continue
        d = FL[p]; cells = []
        for lib in ('ours', 'numpy', 'torch', 'maxsim_cpu', 'nextplaid', 'numkong'):
            a = 'ours' if lib == 'ours' else d['primary'].get(lib)
            v = d['arms'].get(a) if a else None
            if not v:
                cells.append('--'); continue
            put(f'floor.{p}.{lib}.us', f"{v['floor_us']:.1f}", 'floor.json', a); put(f'floor.{p}.{lib}.med', f"{v['median_us']:.0f}", 'floor.json', a)
            put(f'floor.{p}.{lib}.share', f"{v['share'] * 100:.0f}", 'floor.json', f'{a}: floor / median call, %')
            shares.setdefault(lib, []).append((v['share'] * 100, p))
            cells.append(f"{v['floor_us']:.1f} / {v['median_us']:.0f} ({v['share'] * 100:.0f}\\%)")
        rows.append(f'{PS[p]} & ' + ' & '.join(cells) + r' \\')
    open(os.path.join(TEX, 'floor.tex'), 'w').write('\n'.join(rows) + '\n')
    if FL:
        sh_ = next(iter(FL.values()))['median_shape']
        put('floor.shape.nq', str(sh_['nq']), 'floor.json'); put('floor.shape.pool', str(sh_['pool']), 'floor.json'); put('floor.shape.tokens', f"{sh_['tokens']:,}", 'floor.json')
    # a rival's median call minus its floor, over the kernel's median call: above 1 means the rival's
    # time without its fixed cost is still longer than the kernel's whole call
    beyond = []
    for p, d in FL.items():
        o = d['arms'].get('ours')
        for lib, a in d['primary'].items():
            v = d['arms'].get(a)
            if o and v and v['median_us'] > o['median_us']:          # only pairs where the kernel's median call is shorter
                beyond.append(((v['median_us'] - v['floor_us']) / o['median_us'], f'{p} {a}'))
            elif o and v:
                put(f'floor.{p}.{lib}.faster', 'yes', 'floor.json', f'{a}: median call shorter than the kernel\'s')
    if beyond:
        put('floor.beyond.min', f'{min(beyond)[0]:.2f}', 'floor.json', 'min over CPUs and libraries of (rival median - rival floor) / kernel median: ' + min(beyond)[1])
        put('floor.beyond.below1', str(sum(x < 1 for x, _ in beyond)), 'floor.json', ', '.join(n for x, n in beyond if x < 1) or 'none')
        put('floor.beyond.n', str(len(beyond)), 'floor.json', 'CPU-library pairs where the kernel\'s median call is shorter')
    # the main run's median call (held-out agent calls) of the kernel and of NumKong's native float32 loop, beside the
    # fixed-cost run's single median call: the two runs disagree on the EPYC (Section 6.8)
    for p in PLAT:
        nk = [x for x in SPEED.get('warm', {}).get(p, {}).get('agent-ho', []) if x.get('arm') == 'numkong_native_f32']
        if nk:
            put(f'p50.{p}.agent.ours', f"{nk[0]['p50_base'] * 1000:.0f}", 'speed.json', 'main run: median over calls of the kernel latency, us')
            put(f'p50.{p}.agent.numkong', f"{nk[0]['p50_arm'] * 1000:.0f}", 'speed.json', 'main run: median over calls of numkong_native_f32 latency, us')
    ex = [x for lib in ('numpy', 'torch', 'maxsim_cpu', 'nextplaid') for x in shares.get(lib, [])]
    if ex:
        put('range.floor.exact.min', f'{min(ex)[0]:.0f}', 'floor.json', 'exact rivals: ' + min(ex)[1]); put('range.floor.exact.max', f'{max(ex)[0]:.0f}', 'floor.json', 'exact rivals: ' + max(ex)[1])
    for lib, v in shares.items():
        put(f'range.floor.{lib}.min', f'{min(v)[0]:.0f}', 'floor.json', min(v)[1]); put(f'range.floor.{lib}.max', f'{max(v)[0]:.0f}', 'floor.json', max(v)[1])

    # ------------------------------------------------------------------ budget (one line per platform and cell at 0.25 / 0.5 ms)
    BD = load('budget.json')
    rows = []
    for p in PLAT:
        if p not in BD:
            rows.append(f'{PS[p]} & \\multicolumn{{6}}{{l}}{{{todo("epyc")}}} \\\\'); continue
        first = True
        for cellk in ('scifact|colbertv2', 'nfcorpus|answersmall'):
            d = BD[p][cellk]
            cs = []
            for X in ('0.25', '0.5'):
                row = d['budget'][X]
                o = row.get('ours')
                ex = [(v['k'], v['ndcg10'], a) for a, v in row.items() if v and a not in ('ours', 'f32store') and not a.startswith('numkong') and 'int4' not in a]
                bex = max(ex) if ex else None
                nkk = [(v['k'], v['ndcg10'], a) for a, v in row.items() if v and a.startswith('numkong')]
                bnk = max(nkk) if nkk else None   # largest k, as in the caption (ties: better quality)
                fmt = lambda t: '--' if not t else f'{t[0]} ({t[1]:.3f})'
                fs = row.get('f32store')
                cs += [fmt(None if not o else (o['k'], o['ndcg10'])), fmt(bex) + ('' if not bex else f" {tx(bex[2])}"), fmt(bnk),
                       fmt(None if not fs else (fs['k'], fs['ndcg10']))]
                put(f'budget.{p}.{cellk.replace("|", ".")}.{X}.ours', str(o['k']) if o else '--', 'budget.json')
            ds, mk = cellk.split('|')
            rows.append(f"{PS[p] if first else ''} & {'SciFact' if ds == 'scifact' else 'NFCorpus'}, {'ColBERTv2' if mk == 'colbertv2' else 'AA-small'} & " + ' & '.join(cs) + r' \\')
            first = False
        rows.append(r'\addlinespace')
    open(os.path.join(TEX, 'budget.tex'), 'w').write('\n'.join(rows) + '\n')

    # ------------------------------------------------------------------ workload, machines, counts
    WK = load('workload.json')
    rows = []
    for n, d in WK.items():
        g = lambda dd, ks: ' / '.join(f'{dd[k]:.0f}' for k in ks)
        rows.append(f"{n} & {d['calls']} & {g(d['query_tokens'], ('p10', 'p50', 'p90'))} & {g(d['pool'], ('p10', 'p50', 'p90', 'max'))} & "
                    f"{g(d['doc_tokens_per_candidate'], ('p10', 'p50', 'p90'))} & {g(d['doc_tokens_per_call'], ('p50', 'p90', 'max'))} \\\\")
        key = n.split(' ')[0]
        put(f'wl.{key}.calls', str(d['calls']), 'workload.json')
        for f_, k_ in (('query_tokens', 'q'), ('pool', 'pool'), ('doc_tokens_per_candidate', 'dt')):
            put(f'wl.{key}.{k_}50', f"{d[f_]['p50']:.0f}", 'workload.json')
    open(os.path.join(TEX, 'workload.tex'), 'w').write('\n'.join(rows) + '\n')

    for p in PLAT:
        f = os.path.expanduser(f'~/.ss-eval/maxsim-cloud/s5-dev/{p}/noise-{p}.json')
        if os.path.exists(f):
            nz = json.load(open(f))
            put(f'noise.{p}', f"{nz['noise_band'] * 100:.1f}", f's5-dev/{p}/noise-{p}.json (dev A/A run)', f"cv {nz['cv']:.4f}, rule R {nz['R']}")
    CT = load('counts.json')
    for k_, v in CT.items():
        put(f'count.{k_}', str(v), 'counts.json')

    # ------------------------------------------------------------------ write numbers.tex and RESULTS-paper.md
    seen = {}
    for k_, v, s, n in NUM:
        seen[k_] = (v, s, n)
    with open(os.path.join(PAPER, 'numbers.tex'), 'w') as f:
        f.write('% Generated by paper/analysis/mktex.py. Do not edit by hand.\n')
        for k_, (v, s, n) in sorted(seen.items()):
            f.write(f'\\defnum{{{k_}}}{{{v}}}\n')
    L = ['# RESULTS-paper.md — every number in the paper, its source and the command', '',
         'Generated by `venv/bin/python -I paper/analysis/mktex.py` (post-freeze analysis code). In the LaTeX, a number '
         'appears as `\\N{key}` (prose) or inside a generated table in `paper/tables/*.tex`; both come from the JSON files below.', '',
         '## Commands per source file', '', '| source | command (from eval/maxsim-bench) |', '|---|---|']
    for s, c in CMD.items():
        L.append(f'| `tables/{s}` | `{c}` |')
    L += ['', '## Generated tables', '', '| table file | source |', '|---|---|',
          '| warm.tex, parked.tex, single.tex, int4self.tex, losses.tex, replica.tex | speed.json |',
          '| primary.tex | quality_primary.json |', '| effects.tex | quality_primary.json + quality_extra.json |',
          '| contract_effects.tex | contract_effects.json |', '| correctness.tex | speed.json |', '| memory.tex | memory.json |',
          '| conc.tex | conc.json |', '| budget.tex | budget.json |', '| workload.tex | workload.json |', '',
          f'## Prose numbers ({len(seen)})', '', '| key | value | source | note |', '|---|--:|---|---|']
    for k_, (v, s, n) in sorted(seen.items()):
        L.append(f'| `{k_}` | {v} | `tables/{s}` | {n} |')
    open(os.path.join(HERE, 'RESULTS-paper.md'), 'w').write('\n'.join(L) + '\n')
    print(f'{len(seen)} numbers; tables in {TEX}')


if __name__ == '__main__':
    main()
