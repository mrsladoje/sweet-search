# venv/bin/python -I paper/analysis/mktex.py
#
# Post-freeze analysis code (not frozen). Turns the aggregate tables (tables/*.json) into
#   paper/numbers.tex           one macro per number used in the prose: \N{key}
#   paper/tables/*.tex          the bodies of the paper's tables
#   paper/analysis/RESULTS-paper.md   every number with its key, value, source file and the command
# A platform without results yet (the EPYC box) gets \TODO{epyc} cells.
import json, os, sys

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
    put(key, f2(r['ratio']), 'speed.json', f"[{f2(r['lo'])}, {f2(r['hi'])}] spread {f2(r['spread'][0]) if r.get('spread') else ''}-{f2(r['spread'][1]) if r.get('spread') else ''} arm {r['arm']}")
    put(key + '.lo', f2(r['lo']), 'speed.json'); put(key + '.hi', f2(r['hi']), 'speed.json')
    if r.get('spread'):
        put(key + '.slo', f2(r['spread'][0]), 'speed.json'); put(key + '.shi', f2(r['spread'][1]), 'speed.json')
    s = f"{r['ratio']:.2f}"
    if r['hi'] < 1:
        s = r'\loss{' + s + '}'
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
        for mode in ('warm', 'warm sweep', 'pool-parked', 'one thread'):
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
    bs = collections.Counter((x['platform'], x['label']) for x in losses if x['mode'] == 'warm BEIR set' and x['significant'])
    for (p_, lab), n in bs.items():
        key = lab.replace(' (approx.)', '').replace(', ', '.').replace(' ', '')
        put(f'beirset.{p_}.{key}', str(n), 'speed.json', f'BEIR sets (of 20) where {lab} is faster')
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
            cells_.append(f"{t['ci95'][0]:+.4f} / {t['p_holm']:.4f} {'\\cmark' if ok else '\\xmark'}")
            base = t
        mname = 'ColBERTv2' if mk == 'colbertv2' else 'AnswerAI-small'
        rows.append(f"{'SciFact' if ds == 'scifact' else 'NFCorpus'} & {mname} & {base['n']} & {base['mean_b']:.4f} & {base['mean_a']:.4f} & {base['mean_diff']:+.4f} "
                    f"& {base['rel_diff'] * 100:+.2f}\\% & " + ' & '.join(cells_) + r' \\')
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
    CC = load('conc.json')
    rows = []
    CONC_N1 = []
    corr_share = []
    over = []
    exact = lambda a: a != 'ours' and not a.startswith('numkong')
    nk = lambda a: a.startswith('numkong')

    def explicit_threads(a):
        m = __import__('re').search(r'@(\d+)', a)
        return int(m.group(1)) if m else 0
    for p in PLAT:
        if p not in CC:
            rows.append(f'{PS[p]} & \\multicolumn{{10}}{{l}}{{{todo("epyc")}}} \\\\'); continue
        cores = next(iter(next(iter(CC[p].values())).values()))['cores']
        for fam in ('agent', 'gcsn'):
            arms = CC[p].get(fam, {})

            def best(pred, n, ex):
                v = [(r['throughput'], a) for a, d in arms.items() if pred(a) for r in d['runs']
                     if r['type'] == 'closed' and r['callers'] == n and r['executor'] == ex]
                return max(v) if v else None
            for a, d in arms.items():
                for r in d['runs']:
                    if r.get('corrected') and a == 'ours':
                        corr_share.append(50e6 / (r['wall_ns'] + 50e6))
                    if r['type'] == 'closed' and r['executor'] == 'procs' and r['callers'] * max(explicit_threads(a), 1) > cores:
                        over.append(f'{p} {fam} {a} n={r["callers"]}')
            cs = []
            for n in (1, 16):
                for ex in ('procs', 'threads'):
                    o, e, k = best(lambda a: a == 'ours', n, ex), best(exact, n, ex), best(nk, n, ex)
                    r_e, r_k = o[0] / e[0], o[0] / k[0]
                    put(f'conc.{p}.{fam}.n{n}.{ex}.ours', f'{o[0] / 1000:.1f}', 'conc.json', 'kcalls/s')
                    put(f'conc.{p}.{fam}.n{n}.{ex}.exactratio', f2(r_e), 'conc.json', f'ours / {e[1]}')
                    put(f'conc.{p}.{fam}.n{n}.{ex}.nk', f2(r_k), 'conc.json', f'ours / {k[1]}')
                    flag = '$^\\ddagger$' if ex == 'procs' and n > 1 and n * max(explicit_threads(e[1]), 1) > cores else ''
                    cs += [f'{o[0] / 1000:.1f}', ('\\loss{' if r_e < 1 else '{') + f'{r_e:.2f}}}{flag}', ('\\loss{' if r_k < 1 else '{') + f'{r_k:.2f}}}']
                if n == 1:
                    o1 = best(lambda a: a == 'ours', 1, 'threads'); e1 = best(exact, 1, 'threads')
                    CONC_N1.append((o1[0] / e1[0], f'{p} {fam} threads'))
            rates = sorted({r['rate'] for d in arms.values() for r in d['runs'] if r['type'] != 'closed' and r['rate']})
            top = rates[-1]
            cap = {a: max(r['throughput'] for r in d['runs'] if r['type'] == 'closed') for a, d in arms.items()}
            op = {a: min((r for r in d['runs'] if r['type'] != 'closed' and r['rate'] == top), key=lambda r: r['p99_ms']) for a, d in arms.items()}
            exa = min((v['p99_ms'], a) for a, v in op.items() if exact(a))
            ov_o = '$^\\S$' if top > cap['ours'] else ''
            ov_e = '$^\\S$' if top > cap[exa[1]] else ''
            put(f'conc.{p}.{fam}.open.rate', f'{top:.0f}', 'conc.json'); put(f'conc.{p}.{fam}.open.ours', f"{op['ours']['p99_ms']:.2f}", 'conc.json')
            put(f'conc.{p}.{fam}.open.exact', f'{exa[0]:.2f}', 'conc.json', exa[1])
            cs += [f'{top:.0f}', f"{op['ours']['p99_ms']:.2f}{ov_o}", ('\\loss{' if exa[0] < op['ours']['p99_ms'] else '{') + f'{exa[0]:.2f}}}{ov_e}']
            rows.append(f"{PS[p] if fam == 'agent' else ''} & {fam} & " + ' & '.join(cs) + r' \\')
        rows.append(r'\addlinespace')
    open(os.path.join(TEX, 'conc.tex'), 'w').write('\n'.join(rows) + '\n')
    if CONC_N1:
        put('range.conc.n1.min', f2(min(CONC_N1)[0]), 'conc.json', min(CONC_N1)[1]); put('range.conc.n1.max', f2(max(CONC_N1)[0]), 'conc.json', max(CONC_N1)[1])
    if corr_share:
        put('conc.corr.share.min', f'{min(corr_share) * 100:.0f}', 'conc.json', 'share of the corrected wall time that the 50 ms term makes up, kernel procs runs')
        put('conc.corr.negative', str(sum(1 for x in corr_share if x > 1)), 'conc.json', 'kernel procs closed-loop runs whose recorded wall time was negative')
        put('conc.corr.runs', str(len(corr_share)), 'conc.json')
    put('conc.oversub.n', str(len(over)), 'conc.json', '; '.join(over[:40]))
    # counts of 16-caller pairs where an exact rival beats sweet, per executor
    for ex in ('procs', 'threads'):
        lost = [k_ for k_, v, _, _ in NUM if k_.endswith(f'.n16.{ex}.exactratio') and float(v) < 1]
        put(f'conc.n16.{ex}.lost', str(len(set(lost))), 'conc.json', ', '.join(sorted(set(lost))))

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
                bnk = max(nkk, key=lambda x: x[1]) if nkk else None
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
