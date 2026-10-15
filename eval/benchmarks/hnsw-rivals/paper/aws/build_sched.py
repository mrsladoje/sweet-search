# Memory-budget build scheduler (PAPER_PLAN.md S4; section 2 rule 5 and section 5 item 10).
#
#   python build_sched.py --plan P [--plan P2 ...] --data DATA --machine M --repo REPO --rivals BIN
#        [--rivals-ext BIN] [--node node] [--python PY] [--results R] [--isolated] [--check]
#        [--pilot-dir DIR ...] [--estimates est.json] [--max-parallel N] [--reserve 0.10] [--shard i/n]
#
# Builds every index of the plan files (the "builds" lists, and the "ours" indexes that the ours jobs need):
#  * default: starts the next build only when its peak RSS fits in free memory minus a reserve of 10% of the
#    total (MemAvailable - reserve - growth still owed by the builds already running). The peak RSS comes from
#    build.json files (memory.maxrss_kb; ours: peak_rss_kb) of the same family and set, then of the same family
#    scaled by n, from --pilot-dir directories, else from a plain estimate (tagged "estimate" in the log).
#    A build that does not fit even alone runs alone, with a warning.
#  * --isolated: one build at a time, nothing else on the machine. These are the cost runs: only their
#    build.json times may be quoted as build cost. Each build dir gets cost-run.json {"cost_run": true|false}.
#  * --check: build nothing; exit 1 and list the builds that are missing (timing modes use it).
# The build directory of a rival build comes from paper/jobs.py build_dir (the same call as run.py): one shared
# store, DATA/builds/shared/<set>/<model>/<family>/<hash>, keyed without machine or binary. A build is made once
# and copied to every machine. --shard i/n: this machine builds only the builds with int(hash, 16) % n == i, so
# several build machines share the work without overlap (ours: the hash of the set, model and seed).
import shlex, argparse, json, os, shutil, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
PAPER = os.path.dirname(HERE)
sys.path.insert(0, PAPER)
import jobs  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--plan', action='append', required=True)
for k in ('data', 'machine', 'repo'):
    ap.add_argument('--' + k, required=True)
ap.add_argument('--rivals'); ap.add_argument('--rivals-ext')
ap.add_argument('--node', default='node'); ap.add_argument('--python', default=sys.executable)
ap.add_argument('--results'); ap.add_argument('--isolated', action='store_true'); ap.add_argument('--check', action='store_true')
ap.add_argument('--pilot-dir', action='append', default=[]); ap.add_argument('--estimates')
ap.add_argument('--max-parallel', type=int, default=4); ap.add_argument('--reserve', type=float, default=0.10)
ap.add_argument('--shard', default='0/1', help='i/n: build only the builds of shard i of n')
a = ap.parse_args()
SHARD_I, SHARD_N = (int(x) for x in a.shard.split('/'))
if not 0 <= SHARD_I < SHARD_N:
    sys.exit('--shard i/n needs 0 <= i < n')

EXT = ('diskann', 'svs')


def binary(fam):
    return a.rivals_ext if fam.startswith(EXT) else a.rivals


def runner(fam):
    return [a.python, '-I', os.path.join(PAPER, 'py5.py')] if fam in jobs.PY_FAMILIES else [binary(fam)]


def n_vectors(set_name):
    return json.load(open(os.path.join(a.data, 'sets', set_name, 'set.json')))['n_vectors']


# ---- the work list
work, seen = [], set()
for pf in a.plan:
    plan = json.load(open(pf))
    for b in plan.get('builds', []):
        if b['family'] == 'ours':
            w = dict(kind='ours', family='ours', set=b['set'], model=b['model'], seed=b.get('build_seed', 42),
                     root=b.get('index') or os.path.join(a.data, 'emb', b['model'], b['set'], 'index'), label=f"ours {b['set']}/{b['model']}")
        else:
            d = jobs.build_dir(a.data, b)
            w = dict(kind='rival', family=b['family'], set=b['set'], model=b['model'], spec=b, root=d,
                     label=f"{b['family']} {b['set']}/{b['model']} " + ','.join(f'{k}={v}' for k, v in sorted(b['build_params'].items())))
        work.append(w)
    for j in plan.get('jobs', []):
        if j['system'].startswith('ours'):
            work.append(dict(kind='ours', family='ours', set=j['set'], model=j['model'], seed=j.get('build_seed', 42),
                             root=j.get('index') or os.path.join(a.data, 'emb', j['model'], j['set'], 'index'),
                             label=f"ours {j['set']}/{j['model']}"))
uniq = []
for w in work:
    if w['root'] not in seen:
        seen.add(w['root']); uniq.append(w)
work = uniq


def shard_of(w):
    key = os.path.basename(w['root']) if w['kind'] == 'rival' else jobs.sha_json([w['set'], w['model'], w['seed'], os.path.basename(w['root'])])
    return int(key, 16) % SHARD_N


if SHARD_N > 1 and not a.check:
    print(f'shard {SHARD_I}/{SHARD_N}: {sum(shard_of(w) == SHARD_I for w in work)} of {len(work)} builds belong to this machine', flush=True)
    work = [w for w in work if shard_of(w) == SHARD_I]


def done(w):
    bj = os.path.join(w['root'], 'build.json')
    if not os.path.exists(bj):
        return False
    if w['kind'] == 'ours':
        try:
            return json.load(open(bj)).get('seed') == w['seed'] and os.path.exists(export_json(w))
        except Exception:
            return False
    return True


def export_json(w):
    """The export of our index (codes, int8 rows, f16 vectors: functions of the vectors only), which the
    binary rival builds read their codes from and the (A) path reads its rows from."""
    return os.path.join(a.data, 'emb', w['model'], w['set'], 'export', 'export.json')


def ready(w):
    """A rival build waits for the export of its set and model (made right after our index)."""
    return w['kind'] == 'ours' or os.path.exists(export_json(w))


todo = [w for w in work if not done(w)]
print(f'{len(work)} builds in the plans, {len(work) - len(todo)} present, {len(todo)} to build', flush=True)
if a.check:
    for w in todo:
        print('MISSING', w['label'])
    sys.exit(1 if todo else 0)
if not todo:
    sys.exit(0)

# ---- peak RSS: pilot / earlier build.json files, else an estimate
est_over = json.load(open(a.estimates)) if a.estimates else {}
known = []  # (family, set, n, peak_kb)
for root in [os.path.join(a.data, 'builds')] + a.pilot_dir + [os.path.join(a.data, 'emb')]:
    for d, _, fs in os.walk(root):
        if 'build.json' in fs:
            try:
                b = json.load(open(os.path.join(d, 'build.json')))
                kb = int(b['peak_rss_kb']) if 'peak_rss_kb' in b else int(b['memory']['maxrss_kb'])
                fam = b.get('family', 'ours'); n = b.get('n')
                known.append((fam, b['set'], n, kb))
            except Exception:
                pass


def peak_kb(w):
    fam, s = w['family'], w['set']
    if fam in est_over and s in est_over[fam]:
        return int(est_over[fam][s]), 'estimates file'
    same = [k for k in known if k[0] == fam and k[1] == s]
    if same:
        return max(k[3] for k in same), 'build.json, same family and set'
    n = n_vectors(s)
    other = [(k[3] / k[2]) for k in known if k[0] == fam and k[2]]
    if other:
        return int(max(other) * n), 'build.json, same family, scaled by n'
    return int(n * 768 * 4 * 2 / 1024 + 512 * 1024), 'estimate: 2 x float32 corpus + 512 MB'


for w in todo:
    w['est_kb'], w['est_src'] = peak_kb(w)
todo.sort(key=lambda w: -w['est_kb'])


def meminfo():
    m = {}
    for l in open('/proc/meminfo'):
        k, v = l.split(':'); m[k] = int(v.split()[0])
    return m


def rss_kb(pid):
    try:
        for l in open(f'/proc/{pid}/status'):
            if l.startswith('VmRSS:'):
                return int(l.split()[1])
    except OSError:
        pass
    return 0


def command(w):
    d = w['root']
    if w['kind'] == 'ours':
        b_ours = [a.node, os.path.join(PAPER, 'build_ours.mjs'), a.data, w['set'], w['model'], '--out', d, '--seed', str(w['seed'])]
        exp = [a.node, os.path.join(PAPER, 'export_index.mjs'), a.data, w['set'], w['model'], d]
        return ['bash', '-c', ' '.join(map(shlex.quote, b_ours)) + ' && ' + ' '.join(map(shlex.quote, exp))]
    b = w['spec']
    params = ','.join(f'{k}={v}' for k, v in sorted(b['build_params'].items()))
    return runner(b['family']) + ['build', '--data', a.data, '--set', b['set'], '--model', b['model'], '--family', b['family'],
            '--params', params, '--threads', str(b.get('threads', os.cpu_count())), '--seed', str(b['build_seed']), '--dir', d]


log_path = os.path.join(a.results or a.data, a.machine, 'build-sched.jsonl') if a.results else None
if log_path:
    os.makedirs(os.path.dirname(log_path), exist_ok=True)


def record(**kw):
    kw['t'] = time.strftime('%Y-%m-%dT%H:%M:%S')
    if log_path:
        open(log_path, 'a').write(json.dumps(kw) + '\n')


running, failed = [], []   # running: dict(w, proc, t0, log)
maxpar = 1 if a.isolated else a.max_parallel
env = dict(os.environ, R=a.repo)
print(f"mode {'isolated (cost runs)' if a.isolated else 'memory-admitted, up to %d at once' % maxpar}", flush=True)


def start(w, why):
    d = w['root']
    if w['kind'] == 'rival':
        if os.path.exists(d):
            shutil.move(d, d + f'.stale-{int(time.time())}')
        os.makedirs(d)
    else:
        if os.path.islink(d):
            sys.exit(f"{d} is a symbolic link: refusing to build into {os.path.realpath(d)}")
        os.makedirs(d, exist_ok=True)
    cmd = command(w)
    lf = open(os.path.join(d, 'build.stdout'), 'w')
    p = subprocess.Popen(cmd, stdout=lf, stderr=subprocess.STDOUT, env=env)
    mi = meminfo()
    running.append(dict(w=w, p=p, t0=time.time(), lf=lf))
    print(f"start  {w['label']}  est {w['est_kb'] // 1024} MB ({w['est_src']})  {why}; "
          f"available {mi['MemAvailable'] // 1024} MB, {len(running)} running", flush=True)
    record(event='start', label=w['label'], est_kb=w['est_kb'], est_src=w['est_src'], mem_available_kb=mi['MemAvailable'],
           concurrent=len(running), isolated=a.isolated)


def reap():
    for r in list(running):
        rc = r['p'].poll()
        if rc is None:
            r['peak_seen'] = max(r.get('peak_seen', 0), rss_kb(r['p'].pid))
            continue
        running.remove(r); r['lf'].close()
        w = r['w']; d = w['root']
        ok = rc == 0 and os.path.exists(os.path.join(d, 'build.json'))
        tag = dict(cost_run=bool(a.isolated), isolated=a.isolated, machine=a.machine, seconds=round(time.time() - r['t0'], 1))
        if ok:
            json.dump(tag, open(os.path.join(d, 'cost-run.json'), 'w'))
        else:
            failed.append(w['label'])
        print(f"{'done  ' if ok else 'FAILED'} {w['label']}  exit {rc}  {tag['seconds']} s  "
              f"{'cost run' if a.isolated and ok else ''}", flush=True)
        record(event='end', label=w['label'], exit=rc, ok=ok, **tag)


pending = list(todo)
while pending or running:
    reap()
    if pending and len(running) < maxpar:
        mi = meminfo()
        reserve = a.reserve * mi['MemTotal']
        owed = sum(max(0, r['w']['est_kb'] - rss_kb(r['p'].pid)) for r in running)
        room = mi['MemAvailable'] - reserve - owed
        pick = None
        avail = [w for w in pending if ready(w)]
        if not avail and not running:
            sys.exit('rival builds wait for an export that no pending build makes: build our index of that set first')
        if (a.isolated or not running) and avail:
            pick = avail[0]
            if pick['est_kb'] > room:
                print(f"warning: {pick['label']} needs about {pick['est_kb'] // 1024} MB, room is {int(room) // 1024} MB: runs alone", flush=True)
        else:
            pick = next((w for w in avail if w['est_kb'] <= room), None)
        if pick:
            pending.remove(pick)
            start(pick, f"room {int(room) // 1024} MB")
            continue
    time.sleep(2)
if failed:
    print('FAILED builds: ' + '; '.join(failed)); sys.exit(1)
print(f'all {len(todo)} builds finished')
