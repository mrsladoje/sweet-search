# python3 summarize.py <results/MACHINE> --mode smoke|dev|heldout|replica [--shortlist FILE] [--md out.md]
#                      [--allow-incomplete] [--merge-shards]
#
# --merge-shards: <results/MACHINE> names a machine type (results/intel); the S8 shards
# results/intel-1..n are read together (each set lives on one shard) and a table lists the
# shard and host of every set.
#
# Tables for one machine from the run.sh layout <results>/<machine>/<tag>/<group>/.
# It refuses to run unless check_complete.py passes on the mode's tags (--allow-incomplete
# only for looking at a dev run in progress; its output says so).
#
# Per arm and call: median over the (round, process) runs. Ratios: geometric mean over
# calls of (other / sweet), > 1 = sweet faster, with the two uncertainty numbers apart:
# the workload interval (cluster bootstrap, results_lib.py) and the execution spread (the
# ratio per process repetition: min-max). Latency columns name their statistic: "p50" and
# "p95 of per-call medians" describe typical and heavy calls; "per-request p95 / p99" are
# over every individual timing and are the only tail latencies.
#
# Rival configuration per library, input type and workload family: from the frozen
# shortlist.json (made on dev data, make_shortlist.py). The column "post hoc" gives the
# library's fastest configuration on the reported calls themselves, as a secondary view.
# dev mode, A/A group: writes noise-<machine>.json (cv, noise band n, repetition count R).
import argparse, collections, glob, json, math, os, re, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import results_lib as rl  # noqa: E402
from check_complete import check  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument('machine_dir')
p.add_argument('--mode', required=True)
p.add_argument('--shortlist')
p.add_argument('--md')
p.add_argument('--allow-incomplete', action='store_true')
p.add_argument('--merge-shards', action='store_true')
a = p.parse_args()

HERE = os.path.dirname(os.path.abspath(__file__))
machine = os.path.basename(a.machine_dir.rstrip('/'))
TAGS = {'smoke': dict(warm='smoke', mem='smoke-mem'), 'dev': dict(warm='dev-warm', parked='dev-parked', tiers='dev-tiers', aa='dev-aa', mem='dev-mem'),
        'heldout': dict(warm='ho-warm', parked='ho-parked', tiers='ho-tiers', mem='ho-mem'), 'replica': dict(warm='ho-warm', mem='ho-mem')}[a.mode]
ROOTS = ([d for d in sorted(glob.glob(a.machine_dir.rstrip('/') + '-*'), key=lambda x: int(x.rsplit('-', 1)[1]) if x.rsplit('-', 1)[1].isdigit() else 0)
          if re.search(r'-\d+$', d)] if a.merge_shards else [a.machine_dir])
if not ROOTS:
    sys.exit(f'summarize: no shard directories {a.machine_dir}-<k>')
dirs = [os.path.join(r, t) for r in ROOTS for t in TAGS.values() if os.path.isdir(os.path.join(r, t))]
n, problems = check(dirs) if dirs else (0, ['no result directories'])
if problems and not a.allow_incomplete:
    print('\n'.join(problems[:20])); sys.exit(f'summarize: {len(problems)} of {n} jobs incomplete; run check_complete.py')
sl = rl.load_shortlist(a.shortlist or os.path.join(HERE, f'shortlist-{machine}.json'))
out = []
say = out.append
if problems:
    say(f'**INCOMPLETE: {len(problems)} of {n} jobs missing or invalid (--allow-incomplete). Not for publication.**\n')


def merged_tag(t):
    """One tag over every root (shards hold disjoint sets): rows, repetitions and rounds united."""
    out = {}
    for r in ROOTS:
        if not os.path.isdir(os.path.join(r, t)):
            continue
        for arm, d in rl.load_tag(os.path.join(r, t)).items():
            if arm in out:
                out[arm]['rows'].update(d['rows'])
                out[arm]['procs'] = sorted(set(out[arm]['procs']) | set(d['procs']))
                out[arm]['rounds'] = sorted(set(out[arm]['rounds']) | set(d['rounds']))
            else:
                out[arm] = d
    return out


data = {k: merged_tag(t) for k, t in TAGS.items() if k != 'mem' and any(os.path.isdir(os.path.join(r, t)) for r in ROOTS)}
warm = data.get('warm', {})
env = warm.get('ours', {}).get('env', {})
say(f"## {machine}: {env.get('cpu', '?')}, {env.get('cpu_count', '?')} logical CPUs, {env.get('platform', '?')}")
say(f"Python {env.get('python')}, NumPy {env.get('numpy')}; rounds {warm.get('ours', {}).get('rounds')}, "
    f"process repetitions {len(warm.get('ours', {}).get('procs', []))}; shortlist: {'frozen' if sl else 'none (post hoc only)'}")


def table(arms, keys, base, spec, title):
    if base not in arms or not keys:
        return
    brows = [arms[base]['rows'][k] for k in keys]
    b = np.array([r['ms'] for r in brows])
    clusters = [rl.cluster_of(r) for r in brows]
    say(f'\n**{title}** ({len(keys)} calls; ratio = other / {rl.FIXED.get(base, base)}, > 1 = sweet faster)\n')
    say('| | config | p50 ms | p95 of per-call medians | per-request p95 / p99 ms | ratio [workload 95% CI] | execution spread | '
        'post hoc | sweet faster on | max err (own contract) | input rounding | top-1 = S ref |')
    say('|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|')
    for label, arm, posthoc in spec:
        if arm is None or arm not in arms or not all(k in arms[arm]['rows'] for k in keys):
            continue
        rs = [arms[arm]['rows'][k] for k in keys]
        ms = np.array([r['ms'] for r in rs])
        g, lo, hi, nc = rl.cluster_bootstrap(ms, b, clusters)
        pp = rl.per_proc_ratios(arms[arm], arms[base], keys) if arm != base else []
        spread = f'{min(pp):.2f}-{max(pp):.2f} (R={len(pp)})' if len(pp) > 1 else ''
        ph = ''
        if posthoc and posthoc != arm and posthoc in arms:
            ph = f"{rl.geomean_ratio([arms[posthoc]['rows'][k]['ms'] for k in keys], b):.2f}× `{posthoc}`"
        _, q95, q99 = rl.per_request(rs)
        say(f"| {label} | `{arm}` | {np.percentile(ms, 50):.3f} | {np.percentile(ms, 95):.3f} | {q95:.3f} / {q99:.3f} | "
            + ('1' if arm == base else f'{g:.2f}× [{lo:.2f}, {hi:.2f}] ({nc} clusters)') + f" | {spread} | {ph} | "
            + ('' if arm == base else f'{np.mean(b < ms) * 100:.0f}%') + f" | {max(r['err'] for r in rs):.1e} | "
            f"{max(r.get('err_input', 0) for r in rs):.1e} | {np.mean([r['top1_S'] for r in rs]) * 100:.1f}% |")


def rival_rows(arms, keys, fam, single=False, int4=False):
    """(label, frozen config, post-hoc config) per library and input type."""
    rows = []
    by = {}
    for arm, d in arms.items():
        lib = rl.library(arm)
        if not lib or (single and rl.arm_base(arm)[1] != 1):
            continue
        it = rl.input_type(arm, d['precision'])
        if (it == 'int4-self') != int4:
            continue
        if all(k in d['rows'] for k in keys):
            by.setdefault((lib, it), []).append((sum(d['rows'][k]['ms'] for k in keys), arm))
    for (lib, it), cands in sorted(by.items()):
        posthoc = min(cands)[1]
        frozen = rl.spec_to_file(rl.shortlist_pick(sl, fam, lib, it, single) or '') or None
        rows.append((f"{rl.LIB_LABEL.get(lib, lib)}, {it}", frozen if sl else posthoc, posthoc))
    return rows


def set_names(arms, base):
    return sorted({k[0] for k in arms.get(base, {}).get('rows', {})})


for s in [x for x in set_names(warm, 'ours') if rl.family(x) != 'sweep']:
    fam = rl.family(s)
    keys = [k for k in warm['ours']['rows'] if k[0] == s]
    fixed = [(rl.FIXED[x], x, None) for x in ('ours', 'node-production', 'node-legacy')]
    table(warm, keys, 'ours', fixed + rival_rows(warm, keys, fam), f'{s}, warm (back-to-back), all cores')
    table(warm, keys, 'ours', fixed[:1] + rival_rows(warm, keys, fam, int4=True), f'{s}, rivals given the same int4 storage (decoding inside their timed call)')
    if 'ours@t1' in warm:
        table(warm, keys, 'ours@t1', [('sweet kernel, 1 thread', 'ours@t1', None)] + rival_rows(warm, keys, fam, single=True), f'{s}, one thread each')
    parked = data.get('parked', {})
    if 'ours' in parked:
        pk = [k for k in parked['ours']['rows'] if k[0] == s]
        fixed = [(rl.FIXED[x], x, None) for x in ('ours', 'node-production', 'node-prewarm', 'node-legacy')]
        table(parked, pk, 'ours', fixed + rival_rows(parked, pk, fam), f'{s}, pool-parked (5 ms busy gap before each call)')
    tiers = data.get('tiers', {})
    if 'node-production' in tiers:
        tk = [k for k in tiers['node-production']['rows'] if k[0] == s]
        table(tiers, tk, 'node-production', [(rl.FIXED[x], x, None) for x in ('node-production', 'node-wasm', 'node-js')],
              f'{s}, native vs the fallback tiers (every 4th call)')

cells = [x for x in set_names(warm, 'ours') if rl.family(x) == 'sweep']
if cells:
    say('\n**Size sweep:** per cell, the fastest of the shortlisted exact rival configurations (f32 input, one per library; '
        'NumKong excluded as approximate) / sweet, geometric mean over the cell\'s calls; > 1 = sweet faster.\n')
    import re
    parse = lambda c: re.match(r'q(\d+)-d(\d+)-len(\w+)', c).groups()
    nqs = sorted({int(parse(c)[0]) for c in cells}); pools = sorted({int(parse(c)[1]) for c in cells})
    lens = [l for l in ('nat', '32', '128', '512') if any(parse(c)[2] == l for c in cells)]
    short = {'numpy': 'np', 'torch': 'pt', 'maxsim_cpu': 'mx', 'nextplaid': 'npl'}
    for nq in nqs:
        say(f'\n{nq} query tokens\n')
        say('| docs \\ doc tokens | ' + ' | '.join('natural' if l == 'nat' else l for l in lens) + ' |')
        say('|--:|' + '--:|' * len(lens))
        for pool in pools:
            row = []
            for ln in lens:
                c = f'q{nq}-d{pool}-len{ln}'
                keys = [k for k in warm['ours']['rows'] if k[0] == c]
                if not keys:
                    row.append('—'); continue
                b = np.array([warm['ours']['rows'][k]['ms'] for k in keys])
                best = None
                for label, arm, posthoc in rival_rows(warm, keys, 'sweep'):
                    lib = rl.library(posthoc)
                    if lib in ('numkong',) or not label.endswith(', f32') or arm not in warm:
                        continue
                    t = np.array([warm[arm]['rows'][k]['ms'] for k in keys])
                    if best is None or t.sum() < best[0]:
                        best = (t.sum(), lib, rl.geomean_ratio(t, b))
                row.append(f'{best[2]:.2f} ({short.get(best[1], best[1])})' if best else '—')
            say(f'| {pool} | ' + ' | '.join(row) + ' |')
    say('\nnp = NumPy, pt = PyTorch, mx = maxsim-cpu, npl = NextPlaid.')

if a.merge_shards:
    say('\n**Shards and hosts:** every set ran whole on one machine; host = EC2 placement host ID from machine.txt.\n')
    say('| set | machine | instance | host |')
    say('|---|---|---|---|')
    for r in ROOTS:
        mt = os.path.join(r, 'machine.txt')
        kv = dict(l.strip().split('=', 1) for l in open(mt) if '=' in l and not l.startswith(' ')) if os.path.exists(mt) else {}
        names = set()
        for t in TAGS.values():
            for jf in glob.glob(os.path.join(r, t, '*', 'jobs.json')):
                names.add(os.path.basename(os.path.dirname(jf)))
        for nm in sorted(names):
            say(f"| {nm} | {os.path.basename(r)} | {kv.get('instance-id', '?')} | {kv.get('placement/host-id', '?')} |")

mem_files = [f for r in ROOTS for f in sorted(glob.glob(os.path.join(r, TAGS.get('mem', '-'), '*', '*.r0.p0.json')))]
if mem_files:
    rows = collections.defaultdict(dict)
    for f in mem_files:
        d = json.load(open(f))
        rows[os.path.basename(os.path.dirname(f))][d['arm']] = d
    mib = lambda x: x / 1048576
    say('\n**W11, RAM per arm** (untimed pass in a fresh process; resident memory of the process, not cache traffic; '
        f"{next(iter(next(iter(rows.values())).values()))['env'].get('source')}). Resident B/token = the int4 store (arms that read it "
        'when scoring) + the arm\'s own prepared copy (decode, cast, pad, pack; made outside the timer in the timing runs). '
        'Peak temporary = the peak above the resident memory before scoring, for one call. Computed bytes beside, never instead.\n')
    def mem_table(title, sets):
        say(f'\n{title}\n')
        say('| arm | threads | resident B/token | store | own copy | computed (int4 / f32 / bf16) | prepare peak MiB | temp p50-size call KiB | temp largest call MiB | library MiB | calls sampled / selected |')
        say('|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|')
        arms = sorted({x for s_ in sets for x in rows[s_]}, key=lambda x: (x != 'ours', not x.startswith('node:'), x))
        for arm in arms:
            ds = [rows[s_][arm] for s_ in sets if arm in rows[s_]]
            med = lambda f: float(np.median([f(d['summary']) for d in ds]))
            c = ds[0]['summary'].get('computed_bytes_per_token') or {}
            st = ds[0]['summary']
            say(f"| `{arm}` | {ds[0]['env'].get('threads', '') or 'default'} | {med(lambda x: x['resident_bytes_per_token']):.1f} | "
                f"{med(lambda x: x['store_bytes_per_token'] if x['uses_store'] else 0):.1f} | {med(lambda x: x['arm_copy_bytes_per_token']):.1f} | "
                f"{c.get('int4', '?')} / {c.get('f32', '?')} / {c.get('bf16', '?')} | {max(mib(d['summary']['prep_peak_bytes']) for d in ds):.1f} | "
                f"{med(lambda x: x['score_temp'].get('p50', {}).get('temp', 0)) / 1024:.0f} | {max(mib(d['summary']['score_temp'].get('max', {}).get('temp', 0)) for d in ds):.2f} | "
                f"{med(lambda x: x['library_delta_bytes']) / 1048576:.0f} | " + ('' if len(ds) > 1 else f"{st['calls_sampled']} / {st['calls_selected']}") + ' |')
        rt = [d['summary'].get('runtime_bytes', 0) for s_ in sets for d in rows[s_].values()]
        say(f'\nRuntime baseline (interpreter / Node at start, apart from the arm): median {np.median(rt) / 1048576:.0f} MiB.')
    sweeps = sorted(x for x in rows if rl.family(x) == 'sweep')
    for s_ in sorted(x for x in rows if rl.family(x) != 'sweep'):
        mem_table(f'{s_}', [s_])
    if sweeps:
        mem_table(f'size sweep ({len(sweeps)} cells; median per cell, peaks = largest over cells)', sweeps)

aa = data.get('aa', {})
if 'ours' in aa and 'ours~aa' in aa:
    noise = {}
    for s in set_names(aa, 'ours'):
        keys = [k for k in aa['ours']['rows'] if k[0] == s]
        ratios = rl.per_proc_ratios(aa['ours~aa'], aa['ours'], keys)
        lat = {arm: [] for arm in ('ours', 'ours~aa')}
        for arm in lat:
            for p_ in aa[arm]['procs']:
                lat[arm].append(math.exp(np.mean([math.log(np.median([v for (rd, pp), v in aa[arm]['rows'][k]['runs'].items() if pp == p_])) for k in keys])))
        cv_ratio = float(np.std(ratios, ddof=1) / np.mean(ratios)) if len(ratios) > 1 else float('nan')
        cv_lat = max(float(np.std(v, ddof=1) / np.mean(v)) for v in lat.values() if len(v) > 1)
        noise[s] = dict(cv_ratio=cv_ratio, cv_set_geomean=cv_lat, procs=len(ratios), aa_ratio_per_proc=ratios)
    cv = max(max(v['cv_ratio'], v['cv_set_geomean']) for v in noise.values())
    band = max(0.01, 2 * cv)
    R = min(8, max(3, math.ceil((cv / 0.01) ** 2)))
    res = dict(machine=machine, sets=noise, cv=cv, noise_band=band, R=R,
               rule='cv = largest coefficient of variation over the A/A sets (set geometric mean per process repetition, and the A/A ratio); n = max(1%, 2 cv); R = clamp(ceil((cv / 0.01)^2), 3, 8)')
    json.dump(res, open(os.path.join(a.machine_dir, f'noise-{machine}.json'), 'w'), indent=1)
    say(f'\n**A/A noise check:** cv = {cv:.4f}, noise band n = {band:.4f}, R = {R} (this machine; the final R is the largest of the five machines).')

text = '\n'.join(out)
print(text)
if a.md:
    open(a.md, 'w').write(text + '\n')
