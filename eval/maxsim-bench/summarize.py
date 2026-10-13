# python3 summarize.py <results/PREFIX> [--md out.md]
# Publication tables for one platform from results/PREFIX-{warm,cold,tiers}/ (final.sh).
# Per arm and call: median over rounds. Ratios: geometric mean over calls of
# (other / ours) with a 95% bootstrap CI (10,000 resamples, seed 42); > 1 = ours faster.
# Rivals: each library at its fastest configuration per workload (lowest total time on
# the reported calls, which can only favour it); "exact" excludes NumKong, whose
# kernel is approximate.
import argparse, collections, glob, json, math, os, re, sys
import numpy as np

p = argparse.ArgumentParser()
p.add_argument('prefix')
p.add_argument('--md')
a = p.parse_args()
rng = np.random.default_rng(42)
out = []
say = out.append

LIBS = {'numpy': 'NumPy', 'torch': 'PyTorch', 'maxsim_cpu': 'maxsim-cpu', 'numkong': 'NumKong (approx.)'}
FIXED = {'ours': 'sweet kernel', 'ours@t1': 'sweet kernel, 1 thread', 'node-production': 'sweet, production path (Node)',
         'node-legacy': 'previous production path', 'node-prewarm': 'sweet, production path + prewarm',
         'node-wasm': 'WASM tier', 'node-js': 'plain-JS tier'}


def load(dir_):
    runs = collections.defaultdict(list)
    for f in sorted(glob.glob(os.path.join(dir_, '*.r*.json'))):
        runs[re.sub(r'\.r\d+\.json$', '', os.path.basename(f))].append(json.load(open(f)))
    arms = {}
    for arm, rs in runs.items():
        keyed = [{(c['set'], c['file']): c for c in r['calls']} for r in rs]
        rows = {}
        for k, c in keyed[0].items():
            ms = [kd[k]['ms'] for kd in keyed if k in kd]
            rows[k] = dict(c, ms=float(np.median(ms)))
        arms[arm] = dict(rows=rows, env=rs[0]['env'], rounds=len(rs))
    return arms


def lib_of(arm):
    for lib in LIBS:
        if arm.split('@')[0].startswith(lib):
            return lib
    return None


def ratio(o, b):
    lr = np.log(np.asarray(o) / np.asarray(b))
    bs = np.exp(lr[rng.integers(0, len(lr), size=(10000, len(lr)))].mean(1))
    return math.exp(lr.mean()), np.percentile(bs, 2.5), np.percentile(bs, 97.5)


def best_config(arms, lib, keys, single=None, int4=False):
    cands = []
    for arm, d in arms.items():
        if lib_of(arm) != lib or ('_int4' in arm) != int4:
            continue
        if single is not None and arm.endswith('@t1') != single:
            continue
        if not all(k in d['rows'] for k in keys):
            continue
        cands.append((sum(d['rows'][k]['ms'] for k in keys), arm))
    return min(cands)[1] if cands else None


def table(arms, keys, base, rows_spec, title):
    if base not in arms or not keys:
        say(f'\n**{title}**: (no results yet)')
        return
    b = np.array([arms[base]['rows'][k]['ms'] for k in keys])
    say(f'\n**{title}** ({len(keys)} calls; ratio = other / {FIXED.get(base, base)}, > 1 = sweet faster)\n')
    say('| | config | p50 ms | p95 ms | total s | ratio [95% CI] | sweet faster on | max abs err | top-1 = exact |')
    say('|---|---|--:|--:|--:|--:|--:|--:|--:|')
    for label, arm in rows_spec:
        if arm is None or arm not in arms:
            continue
        rs = [arms[arm]['rows'][k] for k in keys]
        ms = np.array([r['ms'] for r in rs])
        g, lo, hi = ratio(ms, b)
        rat = '1' if arm == base else f'{g:.2f}× [{lo:.2f}, {hi:.2f}]'
        win = '' if arm == base else f'{np.mean(b < ms) * 100:.0f}%'
        say(f"| {label} | `{arm}` | {np.percentile(ms, 50):.3f} | {np.percentile(ms, 95):.3f} | {ms.sum() / 1e3:.2f} | {rat} | {win} | "
            f"{max(r['err'] for r in rs):.1e} | {np.mean([r['top1'] for r in rs]) * 100:.1f}% |")


warm = load(a.prefix + '-warm') if os.path.isdir(a.prefix + '-warm') else {}
cold = load(a.prefix + '-cold') if os.path.isdir(a.prefix + '-cold') else {}
tiers = load(a.prefix + '-tiers') if os.path.isdir(a.prefix + '-tiers') else {}
env = warm.get('ours', {}).get('env', {})
say(f"## {a.prefix}: {env.get('cpu', '?')}, {env.get('cpu_count', '?')} logical CPUs, {env.get('platform', '?')}")
say(f"Python {env.get('python')}, NumPy {env.get('numpy')}; rounds: {warm.get('ours', {}).get('rounds')}")

replay = ['agent-ho', 'gcsn-ho']
for s in replay:
    if not warm:
        break
    keys = [k for k in warm['ours']['rows'] if k[0] == s]
    spec = [(FIXED['ours'], 'ours'), (FIXED['node-production'], 'node-production'), (FIXED['node-legacy'], 'node-legacy')]
    spec += [(LIBS[l], best_config(warm, l, keys)) for l in LIBS]
    table(warm, keys, 'ours', spec, f'{s}, warm (back-to-back)')
    spec = [(FIXED['ours'], 'ours')] + [(LIBS[l] + ', dequantizes int4 itself', best_config(warm, l, keys, int4=True)) for l in ('numpy', 'maxsim_cpu')]
    table(warm, keys, 'ours', spec, f'{s}, rivals given the same int4 storage (dequantization inside their timed call)')
    spec = [(FIXED['ours@t1'], 'ours@t1')] + [(LIBS[l], best_config(warm, l, keys, single=True)) for l in LIBS]
    table(warm, keys, 'ours@t1', spec, f'{s}, one thread each')
    if cold:
        ck = [k for k in cold['ours']['rows'] if k[0] == s]
        spec = [(FIXED['ours'], 'ours'), (FIXED['node-production'], 'node-production'), (FIXED['node-prewarm'], 'node-prewarm'), (FIXED['node-legacy'], 'node-legacy')]
        spec += [(LIBS[l], best_config(cold, l, ck)) for l in LIBS]
        table(cold, ck, 'ours', spec, f'{s}, cold (5 ms of busy main thread before every call)')
    if tiers:
        tk = [k for k in tiers['node-production']['rows'] if k[0] == s]
        spec = [(FIXED['node-production'], 'node-production'), (FIXED['node-wasm'], 'node-wasm'), (FIXED['node-js'], 'node-js')]
        table(tiers, tk, 'node-production', spec, f'{s}, native vs the fallback tiers (every 4th call)')

# size sweep: one matrix per query length; cell = fastest exact rival / ours (geomean)
cells = sorted({k[0] for k in warm.get('ours', {}).get('rows', {}) if k[0].startswith('q')})
if cells:
    say('\n**Size sweep (held-out embeddings):** per cell, the fastest exact rival (any library, any configuration) / sweet, geometric mean over the cell\'s calls; > 1 = sweet faster. In brackets: which library.\n')
    parse = lambda c: re.match(r'q(\d+)-d(\d+)-len(\w+)', c).groups()
    nqs = sorted({int(parse(c)[0]) for c in cells}); pools = sorted({int(parse(c)[1]) for c in cells}); lens = ['nat', '32', '128', '512']
    short = {'numpy': 'np', 'torch': 'pt', 'maxsim_cpu': 'mx', 'numkong': 'nk'}
    for nq in nqs:
        say(f'\n{nq} query tokens\n')
        say('| docs \\ doc tokens | ' + ' | '.join('natural' if l == 'nat' else l for l in lens) + ' |')
        say('|--:|' + '--:|' * len(lens))
        for pool in pools:
            row = []
            for ln in lens:
                c = f'q{nq}-d{pool}-len{ln}'
                if c not in cells:
                    row.append('—'); continue
                keys = [k for k in warm['ours']['rows'] if k[0] == c]
                b = np.array([warm['ours']['rows'][k]['ms'] for k in keys])
                best = None
                for l in ('numpy', 'torch', 'maxsim_cpu'):
                    arm = best_config(warm, l, keys)
                    if arm:
                        t = np.array([warm[arm]['rows'][k]['ms'] for k in keys])
                        if best is None or t.sum() < best[0]:
                            best = (t.sum(), l, math.exp(np.mean(np.log(t / b))))
                row.append(f'{best[2]:.2f} ({short[best[1]]})' if best else '—')
            say(f'| {pool} | ' + ' | '.join(row) + ' |')
    say('\nnp = NumPy, pt = PyTorch, mx = maxsim-cpu.')

text = '\n'.join(out)
print(text)
if a.md:
    open(a.md, 'w').write(text + '\n')
