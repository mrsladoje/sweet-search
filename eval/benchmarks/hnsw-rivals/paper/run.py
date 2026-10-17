# The runner (PAPER_PLAN.md section 5 items 1-3, 7, 8, 10). One step = one plan file:
#   {"step": "dev-smoke", "builds": [<build spec>...], "jobs": [<job spec>...]}
# build spec: {machine, set, model, family, build_params, build_seed, threads}
# job spec:   {machine, set, model, split, comparison, system, round, kind: timing|cold|native,
#              [family, build_params, build_seed, search] (rivals) | [gen, C, H, ef] / [kv, S1, EF] (ours),
#              [C, H] (A), [kv] (B), [options: {limit}]}
# Order: builds (each in isolation, reused when build.json matches), then the keys of every job
# -> RESULTS/<machine>/jobs-expected-<step>.json, then the jobs in plan order. A result is reused only on a
# full key match and a valid record (jobs.validate); otherwise it moves to stale/ and the job runs again.
# A failed job is recorded and the others still run; the exit code is non-zero when any job failed or
# check_complete.py does not pass. One runner per machine (lock file). Dev mode refuses held-out jobs;
# --heldout refuses dev jobs and needs FREEZE.json matching the code (freeze_check.py).
#
# usage: python run.py --plan P --data DATA --results R --machine M --repo REPO --rivals BIN [--rivals-ext BIN] [--heldout --freeze F]
#        [--node node] [--py python] [--scann PY]
import argparse, fcntl, json, os, shutil, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import jobs  # noqa: E402

ap = argparse.ArgumentParser()
for a in ('plan', 'data', 'results', 'machine', 'repo', 'rivals'):
    ap.add_argument('--' + a, required=a != 'rivals')
ap.add_argument('--rivals-ext', help='rivals5-ext (DiskANN, SVS)')
ap.add_argument('--heldout', action='store_true')
ap.add_argument('--freeze')
ap.add_argument('--node', default='node')
ap.add_argument('--python', default=sys.executable, help='the venv that runs py5.py (ScaNN)')
a = ap.parse_args()
plan = json.load(open(a.plan))
out = os.path.join(a.results, a.machine)
os.makedirs(out, exist_ok=True)
LOG = open(os.path.join(out, 'run.log'), 'a')


def say(*x):
    line = time.strftime('%Y-%m-%dT%H:%M:%S ') + ' '.join(str(v) for v in x)
    print(line, flush=True)
    LOG.write(line + '\n'); LOG.flush()


lock = open(os.path.join(a.results, f'.lock-{a.machine}'), 'w')
try:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
except OSError:
    sys.exit(f'another runner holds the lock of machine {a.machine}')

if a.heldout:
    if not a.freeze or subprocess.run([sys.executable, '-I', os.path.join(HERE, 'freeze_check.py'), a.freeze, a.repo]).returncode:
        sys.exit('held-out mode refused: FREEZE.json missing or the code does not match it')
for j in plan['jobs']:
    if (j['split'] == 'ho') != a.heldout:
        sys.exit(f"{'dev' if not a.heldout else 'held-out'} mode refuses a job on split {j['split']}")
    if a.heldout and j.get('options', {}).get('limit'):
        sys.exit('held-out jobs run the whole split')


def n_queries(job):
    n = sum(1 for l in open(os.path.join(a.data, 'sets', job['set'], 'queries.jsonl'))
            if l.strip() and json.loads(l)['split'] == job['split'])
    lim = job.get('options', {}).get('limit')
    return min(n, lim) if lim else n


EXT = ('diskann', 'svs')  # families linked into rivals5-ext (MKL ILP64 and libsvs; FAISS uses OpenBLAS)


def binary(fam):
    return a.rivals_ext if fam.startswith(EXT) else a.rivals


def runner(fam):
    """The command that runs a family: rivals5 / rivals5-ext, or py5.py for the Python-only adapters."""
    return [a.python, '-I', os.path.join(HERE, 'py5.py')] if fam in jobs.PY_FAMILIES else [binary(fam)]


def build_dir(b):
    return jobs.build_dir(a.data, b)


failed = []
# ---- builds (isolated: nothing else runs on this machine meanwhile; the lock holds that)
for b in plan.get('builds', []):
    d = build_dir(b)
    if os.path.exists(os.path.join(d, 'build.json')):
        say('reuse build', d); continue
    if os.path.exists(d):
        shutil.move(d, d + f'.stale-{int(time.time())}')
    os.makedirs(d)
    params = ','.join(f'{k}={v}' for k, v in sorted(b['build_params'].items()))
    cmd = runner(b['family']) + ['build', '--data', a.data, '--set', b['set'], '--model', b['model'], '--family', b['family'],
           '--params', params, '--threads', str(b.get('threads', os.cpu_count())), '--seed', str(b['build_seed']), '--dir', d]
    say('build', b['family'], b['set'], b['model'], params)
    r = subprocess.run(cmd, capture_output=True, text=True)
    say(r.stdout.strip() or r.stderr.strip()[-300:])
    if r.returncode:
        failed.append(f"build {b['family']} {b['set']}/{b['model']} {params}")

# ---- keys of every job, written before any job runs
expected = []
for j in plan['jobs']:
    if not j['system'].startswith('ours'):
        bspec = dict(set=j['set'], model=j['model'], family=j['family'], build_params=j['build_params'], build_seed=j['build_seed'])
        j['build_dir'] = build_dir(bspec); j['binary'] = binary(j['family']); j['python'] = a.python
        if not os.path.exists(os.path.join(j['build_dir'], 'build.json')):
            failed.append(f"job without its build: {j['family']} {j['build_params']}"); say('FAILED', failed[-1]); continue
    j['machine'] = a.machine
    h, key = jobs.job_key(j, a.data, a.repo)
    j['_hash'], j['_key'], j['_n'] = h, key, n_queries(j)
    expected.append(dict(file=os.path.relpath(jobs.result_path(a.results, j, h), a.results), job_hash=h, key=key, n_queries=j['_n']))
ef = os.path.join(out, f"jobs-expected-{plan['step']}.json")
json.dump(dict(step=plan['step'], machine=a.machine, heldout=a.heldout, jobs=expected), open(ef + '.tmp', 'w'))
os.replace(ef + '.tmp', ef)
say(f"step {plan['step']}: {len(expected)} jobs expected ({ef})")

# ---- the jobs
for j in plan['jobs']:
    if '_hash' not in j:
        continue
    path = jobs.result_path(a.results, j, j['_hash'])
    why = jobs.validate(path, j['_hash'], j['_key'], j['_n'])
    if not why:
        say('reuse', os.path.basename(path)); continue
    if why != 'missing':
        st = os.path.join(os.path.dirname(path), 'stale'); os.makedirs(st, exist_ok=True)
        for ext in ('.json', '.lists.bin'):
            p = path[:-5] + ext
            if os.path.exists(p):
                shutil.move(p, os.path.join(st, os.path.basename(p) + f'.{int(time.time())}'))
        say(f'stale {os.path.basename(path)} ({why})')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    kf = path[:-5] + '.key.json'
    json.dump(j['_key'], open(kf, 'w'), sort_keys=True, separators=(',', ':'))
    stem = path[:-5]
    common = ['--data', a.data, '--set', j['set'], '--model', j['model'], '--split', j['split'], '--round', str(j['round']),
              '--out', stem, '--key', kf, '--job-hash', j['_hash']]
    if a.heldout:
        common.append('--heldout')
    if j.get('kind') == 'cold':
        common.append('--cold')
        if sys.platform.startswith('linux'):
            subprocess.run(['sync']); open('/proc/sys/vm/drop_caches', 'w').write('3\n')
        else:
            subprocess.run(['sudo', '-n', 'purge'])
    if j.get('pagecache') == 'warm' and j.get('kind') != 'cold':
        # every file the timed process maps or reads (index, our vector file, the shared export) is read once
        # here, so a memory-mapped index starts in the page cache like an in-memory one (S5b: our 1M timings
        # were read from disk after rival jobs had pushed the pages out)
        warm_s = time.time()
        roots = [j['build_dir']] if 'build_dir' in j else [j.get('index') or os.path.join(a.data, 'emb', j['model'], j['set'], 'index')]
        roots.append(os.path.join(a.data, 'emb', j['model'], j['set'], 'export'))
        nb = 0
        for root in roots:
            for dp, _, fs in os.walk(root):
                for fn in fs:
                    with open(os.path.join(dp, fn), 'rb') as fh:
                        while True:
                            b = fh.read(1 << 24)
                            if not b:
                                break
                            nb += len(b)
        say(f'page cache: read {nb / 1e9:.2f} GB in {time.time() - warm_s:.1f} s before the job')
    if j.get('options', {}).get('limit'):
        common += ['--limit', str(j['options']['limit'])]
    if j['system'].startswith('ours'):
        cmd = [a.node, os.path.join(HERE, 'ours5.mjs'), '--mode', j['comparison']] + common
        for k in ('gen', 'C', 'H', 'ef', 'kv', 'S1', 'EF', 'index'):
            if k in j:
                cmd += [f'--{k}', str(j[k])]
        if j.get('kind') == 'native':
            cmd.append('--native-split')
        env = dict(os.environ, R=a.repo)
    else:
        cmd = runner(j['family']) + ['query', '--family', j['family'], '--dir', j['build_dir'], '--comparison', j['comparison'],
               '--search', ','.join(f'{k}={v}' for k, v in sorted(j.get('search', {}).items()))] + common
        for k in ('C', 'H', 'kv'):
            if k in j:
                cmd += [f'--{k}', str(j[k])]
        env = dict(os.environ, LIBRESCORE5=os.path.join(os.path.dirname(os.path.abspath(a.rivals)), 'librescore5.so'))
    r = subprocess.run(cmd, capture_output=True, text=True, env=env)
    msg = [l for l in r.stdout.splitlines() if l and not l.startswith('[')]
    if r.returncode or jobs.validate(path, j['_hash'], j['_key'], j['_n']):
        failed.append(f"{j['system']} {j['set']}/{j['split']} r{j['round']} {os.path.basename(path)}")
        say('FAILED', failed[-1], f'exit {r.returncode}:', (r.stderr or '').strip()[-400:])
    else:
        say((msg or ['ok'])[-1])

rc = subprocess.run([sys.executable, '-I', os.path.join(HERE, 'check_complete.py'), ef]).returncode
if failed or rc:
    say(f'FAILED: {len(failed)} of {len(expected)} jobs' + ('' if not rc else '; check_complete did not pass'))
    sys.exit(1)
say(f"step {plan['step']} complete: {len(expected)} jobs")
