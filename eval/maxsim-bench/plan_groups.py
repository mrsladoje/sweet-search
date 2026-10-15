# python3 plan_groups.py <mode> --machine NAME --replay ROOT [--shortlist FILE] [--beir ROOT] [--limit N]
# python3 plan_groups.py heldout --machine TYPE --replay ROOT --shortlist FILE --beir ROOT --R N --print-shards N
#                        [--weights FILE]      (S7: the shard table for FREEZE.json; see "Shards" below)
#
# Prints the job groups of one run.sh mode as JSON lines: {"name": ..., "kind": "matrix" |
# "concurrency", "args": [...]}. run.sh runs them in order; each matrix group is one
# run_matrix.py call (one set group, its arms, rounds, process repetitions).
#
# Modes (PAPER_PLAN.md section 8):
#   smoke    --limit 20 on agent-dev, a few arms of every kind; a W11 group (smoke-mem)
#   dev      the full dev matrix: every rival configuration, warm and pool-parked, the
#            fallback tiers, the A/A noise check (5 process repetitions), W6 on dev.
#            Refuses any held-out or BEIR set.
#   heldout  agent-ho, gcsn-ho, every sweep-ho cell, every BEIR set; arms from the
#            frozen shortlist.json; R = FREEZE.json "R" process repetitions x 2 rounds;
#            W6 on agent-ho / gcsn-ho. run.sh checks FREEZE.json first.
#   replica  warm part of agent-ho + gcsn-ho only (second instance of a type)
#   file:F   the groups in file F (JSON lines), for tests and ad-hoc runs
# W11 (RAM per arm): in dev, heldout and replica, one untimed run_matrix.py --mem group per
# set (the same sets as the timing; arms: ours, the Node production and previous paths, and
# the rival configurations: every one on dev, the shortlisted ones held-out).
#
# Shards (S8, PAPER_PLAN.md 9a F3): held-out and replica groups always hold ONE set (or one
# BEIR set, one W6 run, one W11 set), so a set never splits between hosts. With
# --print-shards N the groups are assigned to N machines of one type by longest
# processing time first (estimated seconds per group: --weights FILE {"<group id>": seconds},
# from the S5 dev timings scaled by call counts; a group without a weight gets the proxy
# calls x mean(query tokens x doc tokens) x arms x process repetitions x rounds x (reps + 1),
# scaled to seconds by the median of the given weights, else unscaled) and the table is
# printed: {"<type>": {"n", "assign": {"<group id>": k}, "load": [...]}}; freeze_check.py
# --shards puts it into FREEZE.json. A machine named <type>-<k> (intel-2) runs only the
# groups of shard k of its type from FREEZE.json "shards"; a group missing from the table
# stops the plan (nothing is dropped silently). Group id = "<tag>/<set name>".
#
# Arms that cannot run on this machine (library not installed, no shim, no legacy addon)
# are left out and listed in <results>/<machine>/missing-arms.txt by run.sh.
import argparse, json, os, re, subprocess, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jobs  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument('mode')
p.add_argument('--machine', required=True)
p.add_argument('--replay', required=True)
p.add_argument('--beir', default='')
p.add_argument('--shortlist', default='')
p.add_argument('--freeze', default='')
p.add_argument('--limit', type=int, default=0)
p.add_argument('--R', type=int, default=0, help='without FREEZE.json (before S7: --print-shards, shard_weights.py): the repetition count')
p.add_argument('--print-shards', type=int, default=0)
p.add_argument('--weights', default='')
a = p.parse_args()
m = re.match(r'(.+)-(\d+)$', a.machine)
MTYPE, SHARD_K = (m.group(1), int(m.group(2))) if m and m.group(1) in ('intel', 'amd', 'arm') else (a.machine, 0)

R = a.replay


def physical_cores():
    try:
        if sys.platform == 'darwin':
            return int(subprocess.run(['sysctl', '-n', 'hw.perflevel0.physicalcpu'], capture_output=True, text=True).stdout)
        out = subprocess.run(['lscpu', '-p=CORE,SOCKET'], capture_output=True, text=True).stdout
        return len({l for l in out.splitlines() if not l.startswith('#')})
    except Exception:
        return os.cpu_count()


PHYS = physical_cores()
LOGICAL = os.cpu_count()


def available(spec):
    ps = jobs.parse_spec(spec)
    if ps['node']:
        if ps['arm'] == 'legacy':
            return os.path.exists(os.environ.get('LEGACY_ADDON', '/nonexistent'))
        return True
    py = jobs.python_for(ps['env'])
    if not os.path.exists(py):
        return False
    pk = jobs.package_versions(py)
    need = {'maxsim_cpu': 'maxsim-cpu', 'torch': 'torch', 'numkong_f': 'numkong', 'numkong_b': 'numkong'}
    for prefix, pkg in need.items():
        if ps['arm'].startswith(prefix) and pkg not in pk:
            return False
    if ps['arm'].startswith(('nextplaid', 'numkong_native')):
        return os.path.exists(os.environ.get('SS_RIVALS_RS') or os.path.join(jobs.HERE, 'rivals-rs', 'target', 'release', 'librivals_rs' + jobs.EXT))
    return True


def threads_variants(arm):
    """Default, one per physical core (if that differs from all logical CPUs), and 1."""
    v = [arm, f'{arm}@1']
    if PHYS != LOGICAL:
        v.insert(1, f'{arm}@{PHYS}')
    return v


# Every configuration on dev; the shortlist picks from these.
# numpy_packed_f16 is left out: NumPy has no float16 BLAS; on agent-dev (Mac, S1) it was
# ~280x slower than float32 (the plan keeps it only if not much slower). bench.py keeps it.
RIVALS = (threads_variants('numpy_packed') + ['numpy_packed_t', 'numpy_perdoc', 'numpy_packed_int4']
          + threads_variants('maxsim_cpu_variable') + ['maxsim_cpu_3d', 'maxsim_cpu_variable_int4']
          + threads_variants('torch_pad_bmm') + ['torch_pad_flat', 'torch_colbert_packed', 'torch_segment_reduce', 'torch_pylate',
                                                 'torch_pad_bmm_bf16', 'torch_pad_flat_bf16']
          + threads_variants('nextplaid')
          + [f'numkong_{d}' for d in ('f16', 'bf16', 'f32')] + ['numkong_f16@1']
          + [f'numkong_native_{d}' for d in ('f16', 'bf16', 'f32')] + ['numkong_native_f16@1'])
if os.path.exists(jobs.python_for('mkl')):
    RIVALS += ['numpy_packed%mkl', f'numpy_packed@{PHYS}%mkl', 'numpy_packed@1%mkl']
if os.path.exists(jobs.python_for('blis')):
    RIVALS += ['numpy_packed%blis', 'numpy_packed@1%blis']
OURS = ['ours', 'ours@1'] + ([f'ours@{PHYS}'] if PHYS != LOGICAL else [])
NODE = ['node:production', 'node:legacy']
PARKED_OURS = ['ours', 'node:production', 'node:prewarm', 'node:legacy']
TIERS = ['node:production', 'node:wasm', 'node:js']
# W11: one configuration per rival on dev (thread variants hold the same copy); held-out:
# the shortlisted configurations, as timed.
MEM_DEV = ['ours', 'node:production', 'node:legacy'] + [x for x in RIVALS if '@' not in x]


def keep(arms):
    return [x for x in arms if available(x)]


def missing(arms):
    return sorted({x for x in arms if not available(x)})


def cells(root):
    return sorted(os.path.join(root, c) for c in os.listdir(root) if os.path.isdir(os.path.join(root, c)))


def mem_groups(name, sets, arms):
    return [matrix(name, [s], arms, '--mem', rounds=1, procs=1, reps=1) for s in sets]


def matrix(name, sets, arms, *extra, rounds=2, procs=1, reps=5):
    args = ['--tag', name] + [x for s in sets for x in ('--set', s)] + [x for arm in keep(arms) for x in ('--arm', arm)]
    args += ['--rounds', str(rounds), '--procs', str(procs), '--reps', str(reps)] + list(extra)
    if a.limit:
        args += ['--limit', str(a.limit)]
    return dict(name=name, kind='matrix', args=args, missing=missing(arms))


# W6 (parallel callers): ours and one configuration per library, all cores. Dev: the
# default configuration; held-out: the frozen primary f32 configuration (NumKong: f16).
W6_DEV = ['numpy_packed', 'torch_pad_bmm', 'maxsim_cpu_variable', 'nextplaid', 'numkong_native_f16']


def w6_frozen():
    s = json.load(open(a.shortlist))
    out = []
    for fam in ('agent', 'gcsn'):
        for lib, types in s['families'].get(fam, {}).items():
            cfg = types.get('f16' if lib == 'numkong' else 'f32')
            if cfg and cfg['primary'] not in out:
                out.append(cfg['primary'])
    return out


def w6_rates(fz, s):
    """The frozen W6 rates of this machine type for the set's family (w6_rates.py output)."""
    w = fz.get('w6_rates', {})
    r = w.get('rates', w).get(MTYPE)
    if isinstance(r, dict):
        fam = os.path.basename(s.rstrip('/')).split('-')[0]
        return r.get(fam)
    return r


def shortlisted():
    """Rival configurations from the frozen shortlist, every workload family."""
    s = json.load(open(a.shortlist))
    out = []
    for fam in s['families'].values():
        for lib in fam.values():
            for cfg in lib.values():
                out += [cfg['primary']] + cfg.get('also', []) + ([cfg['single']] if cfg.get('single') else [])
    return sorted(set(out), key=out.index)


groups = []
if a.mode.startswith('file:'):  # a hand-written group list (test_harness.sh, ad-hoc runs)
    print(open(a.mode[5:]).read().strip())
    sys.exit(0)
dev = [f'{R}/agent-dev', f'{R}/gcsn-dev']
ho = [f'{R}/agent-ho', f'{R}/gcsn-ho']
if a.mode == 'smoke':
    arms = ['ours', 'node:production', 'numpy_packed', 'torch_pad_bmm', 'maxsim_cpu_variable', 'numkong_native_f16', 'nextplaid@1']
    groups.append(matrix('smoke', [f'{R}/agent-dev'], arms, '--limit', '20', reps=3))
    groups.append(matrix('smoke-mem', [f'{R}/agent-dev'], ['ours', 'node:production', 'numpy_packed', 'torch_pad_bmm'], '--mem', '--limit', '20', rounds=1, reps=1))
elif a.mode == 'dev':
    for s in dev + cells(f'{R}/sweep-dev'):
        if '-ho' in os.path.basename(s) or os.path.basename(s).startswith('beir-'):
            sys.exit(f'dev mode refuses {s}')
    groups.append(matrix('dev-warm', dev, OURS + NODE + RIVALS))
    groups.append(matrix('dev-warm', cells(f'{R}/sweep-dev'), OURS + RIVALS))
    groups.append(matrix('dev-parked', dev, PARKED_OURS + RIVALS, '--gap-ms', '5', reps=3))
    groups.append(matrix('dev-tiers', dev, TIERS, '--stride', '4', reps=3))
    # A/A noise check: the same build as two arms (ours~aa is a byte copy of the library).
    groups.append(dict(matrix('dev-aa', dev, ['ours', 'ours~aa'], procs=5), setup='aa-copy'))
    for s in dev:
        groups.append(dict(name=f'dev-conc-{os.path.basename(s)}', kind='concurrency', set=s, arms=keep(['ours'] + W6_DEV), mode='design'))
    groups += mem_groups('dev-mem', dev + cells(f'{R}/sweep-dev'), MEM_DEV)
elif a.mode in ('heldout', 'replica'):
    if not a.shortlist or not (a.freeze or a.R):
        sys.exit(f'{a.mode} needs --shortlist and --freeze (or --R with --print-shards)')
    fz = json.load(open(a.freeze)) if a.freeze else dict(R=a.R)
    Rn = int(fz['R'])
    riv = shortlisted()
    one = lambda name, sets, arms, *extra, **kw: [matrix(name, [s], arms, *extra, **kw) for s in sets]
    groups += one('ho-warm', ho, OURS + NODE + riv, procs=Rn)
    if a.mode == 'heldout':
        groups += one('ho-warm', cells(f'{R}/sweep-ho'), OURS + riv, procs=Rn)
        beir = cells(a.beir) if a.beir else []
        groups += one('ho-warm', beir, OURS + ['node:production'] + riv, '--keep-scores', procs=Rn)
        groups += one('ho-parked', ho, PARKED_OURS + riv, '--gap-ms', '5', procs=Rn, reps=3)
        bp = [s for s in beir if s.endswith(('-k25', '-k100'))]
        groups += one('ho-parked', bp, PARKED_OURS + riv, '--gap-ms', '5', '--keep-scores', procs=Rn, reps=3)
        groups += one('ho-tiers', ho, TIERS, '--stride', '4', reps=3)
        for s in ho:
            groups.append(dict(name=f'ho-conc-{os.path.basename(s)}', kind='concurrency', set=s, arms=keep(['ours'] + w6_frozen()), mode='frozen',
                               rates=w6_rates(fz, s)))
        groups += mem_groups('ho-mem', ho + cells(f'{R}/sweep-ho') + beir, ['ours', 'ours@1', 'node:production', 'node:legacy'] + riv)
    else:
        groups += mem_groups('ho-mem', ho, ['ours', 'node:production'] + riv)
else:
    sys.exit(f'unknown mode {a.mode}')



def gid(g):
    """Group id: '<tag>/<set name>' (matrix groups hold one set here), or the W6 group name."""
    if g['kind'] != 'matrix':
        return g['name']
    sets = [g['args'][i + 1] for i, x in enumerate(g['args']) if x == '--set']
    assert len(sets) == 1, g['name']
    return f"{g['name']}/{os.path.basename(sets[0].rstrip('/'))}"


_work = {}


def load_set_meta(root, limit=0, stride=1):
    """Sum over the calls a run sees of (query tokens x doc tokens), from the index files."""
    # Mirrors: eval/maxsim-bench/replay_py.py:count_calls (order, exclusions, stride, limit)
    key = (root, limit, stride)
    if key not in _work:
        import glob
        from replay_py import excluded
        skip, w = excluded(root), []
        for repo in sorted(os.listdir(root)):
            d = os.path.join(root, repo)
            if not os.path.isdir(d) or repo in ('refs-v2', 'stale'):
                continue
            for idx in sorted(glob.glob(os.path.join(d, 'index-*.jsonl'))):
                for line in open(idx):
                    if line.strip():
                        m = json.loads(line)
                        if f"{repo}/{m['file']}" not in skip:
                            w.append(m['numQ'] * sum(c['nt'] for c in m['cands']))
        w = w[::stride]
        _work[key] = sum(w[:limit] if limit else w)
    return _work[key]


def proxy(g):
    """Relative cost of a group without a measured weight (see the header)."""
    if g['kind'] != 'matrix':
        work, n_arms, factor = load_set_meta(g['set'], a.limit, 1), len(g['arms']), 6 * Rn_or1()
        return work * n_arms * factor
    ar = g['args']
    val = lambda k, d: int(ar[ar.index(k) + 1]) if k in ar else d
    sets = [ar[i + 1] for i, x in enumerate(ar) if x == '--set']
    work = sum(load_set_meta(s, val('--limit', 0), val('--stride', 1)) for s in sets)
    n_arms = sum(1 for x in ar if x == '--arm')
    if '--mem' in ar:
        return work * n_arms * 2
    return work * n_arms * val('--procs', 1) * val('--rounds', 2) * (val('--reps', 5) + 1)


def Rn_or1():
    return int(Rn) if a.mode in ('heldout', 'replica') else 1


if a.print_shards or SHARD_K:
    if a.mode not in ('heldout', 'replica'):
        sys.exit('shards are for heldout and replica only')
    ids = [gid(g) for g in groups]
    if len(set(ids)) != len(ids):
        sys.exit('duplicate group ids: ' + ', '.join(sorted({i for i in ids if ids.count(i) > 1})))
if a.print_shards:
    n = a.print_shards
    w = json.load(open(a.weights)) if a.weights else {}
    raw = {gid(g): proxy(g) for g in groups}
    scale = 1.0
    known = [(w[i], raw[i]) for i in raw if i in w and raw[i] > 0]
    if known:
        scale = sorted(x / y for x, y in known)[len(known) // 2]
    est = {i: float(w[i]) if i in w else raw[i] * scale for i in raw}
    load = [0.0] * n
    assign = {}
    for i in sorted(est, key=lambda i: (-est[i], i)):
        k = min(range(n), key=lambda j: (load[j], j))
        assign[i] = k + 1
        load[k] += est[i]
    print(json.dumps({MTYPE: dict(n=n, assign=assign, load=load, unit='seconds' if known else 'proxy units',
                                  weights=os.path.basename(a.weights) if a.weights else None, measured=len(known), groups=len(est))}, indent=1))
    sys.exit(0)
if SHARD_K:
    tab = fz.get('shards', {}).get(MTYPE)
    if not tab:
        sys.exit(f'{a.machine}: FREEZE.json has no shard table for {MTYPE}')
    if SHARD_K > tab['n']:
        sys.exit(f"{a.machine}: shard {SHARD_K} > n = {tab['n']}")
    lost = [gid(g) for g in groups if gid(g) not in tab['assign']]
    if lost:
        sys.exit(f'{a.machine}: groups missing from the frozen shard table: {lost[:5]}')
    groups = [g for g in groups if tab['assign'][gid(g)] == SHARD_K]
elif a.mode in ('heldout', 'replica') and fz.get('shards', {}).get(MTYPE, {}).get('n', 1) > 1:
    sys.exit(f"{a.machine}: FREEZE.json shards {MTYPE} into {fz['shards'][MTYPE]['n']} machines; name the machine {MTYPE}-<k>")

for g in groups:
    print(json.dumps(g))
