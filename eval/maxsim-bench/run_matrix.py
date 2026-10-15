# python3 run_matrix.py --machine NAME --tag TAG --set DIR [--set DIR ...] --arm SPEC [--arm SPEC ...]
#                        [--group NAME] [--rounds 2] [--procs 1] [--reps 5] [--gap-ms 0] [--max-busy P]
#                        [--limit N] [--stride N] [--prewarm-lead-us U] [--keep-scores] [--mem] [--results DIR] [--dry-run]
#
# Runs every arm on the same calls, ONE ARM PER PROCESS: for each process repetition p
# (--procs, the R of PAPER_PLAN.md), --rounds rounds: round 0 in the given order, round 1
# reversed, later rounds shuffled (seed 42). Slow drift (thermal state, background load)
# therefore hits every arm about equally.
#
# Results: <results>/<machine>/<tag>/<group>/<arm>.r<round>.p<proc>.json, each holding its
# job key (jobs.py). The group name comes from the sets (or --group), so two set groups
# under one tag never share files. A file is reused only if it holds the same key and
# validates (complete, every call, every timing); anything else moves to stale/ and runs
# again. <group>/jobs.json lists every job of the last invocation (check_complete.py).
#
# Fails loudly: before any arm, the contract references of every set are built or checked
# (contracts.py --ensure). An arm that exits non-zero or writes an invalid file is a
# failure; the remaining arms still run, then the script exits 1 and prints FAILED. It
# prints "matrix complete" only when every job validates.
#
# Arm specs: "<bench.py arm>[@threads][%env]" (e.g. ours, ours@1, maxsim_cpu_3d@12,
# numpy_packed%mkl = NumPy from venv-mkl), "ours~VARIANT[@threads]" (our kernel from
# $SS_CAPI_DIR/VARIANT.{dylib,so}) or "node:<bench-node.mjs arm>" (node:production, ...).
# --max-busy P: before each run, wait until the machine's CPU use (sampled over 1 s, % of
# all CPUs) is below P (logged); 0 = don't wait. One matrix per machine: a lock file.
# --mem: the W11 RAM pass instead of the timing (mem.py / mem-node.mjs, untimed, one process
# per arm, one round, one repetition), with the allocator settings of memstat.py; job kind
# 'mem' (jobs.validate).
import argparse, fcntl, hashlib, json, os, random, shutil, subprocess, sys, tempfile, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jobs  # noqa: E402
from replay_py import count_calls  # noqa: E402
from set_manifest import set_hash  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument('--machine', required=True)
p.add_argument('--tag', required=True)
p.add_argument('--group')
p.add_argument('--set', action='append', required=True)
p.add_argument('--arm', action='append', required=True)
p.add_argument('--rounds', type=int, default=2)
p.add_argument('--procs', type=int, default=1)
p.add_argument('--reps', type=int, default=5)
p.add_argument('--gap-ms', type=float, default=0.0)
p.add_argument('--max-busy', type=float, default=0.0)
p.add_argument('--limit', type=int, default=0)
p.add_argument('--stride', type=int, default=1)
p.add_argument('--prewarm-lead-us', type=float, default=0.0)
p.add_argument('--keep-scores', action='store_true')
p.add_argument('--mem', action='store_true')
p.add_argument('--results', default=os.path.join(jobs.HERE, 'results'))
p.add_argument('--dry-run', action='store_true')
a = p.parse_args()
if a.mem:
    a.rounds, a.procs, a.reps = 1, 1, 1

HERE = jobs.HERE
sets = [os.path.abspath(s) for s in a.set]
names = [os.path.basename(s.rstrip('/')) for s in sets]


def group_name():
    if a.group:
        return a.group
    if len(sets) == 1:
        return names[0]
    h = hashlib.sha256('\n'.join(sorted(names)).encode()).hexdigest()[:8]
    parents = {os.path.dirname(s.rstrip('/')) for s in sets}
    if len(parents) == 1:
        return f'{os.path.basename(parents.pop())}-{len(sets)}sets-{h}'
    return '+'.join(names) if len(sets) <= 3 else f'{names[0]}-{len(sets)}sets-{h}'


out_dir = os.path.join(a.results, a.machine, a.tag, group_name())
os.makedirs(out_dir, exist_ok=True)
log = open(os.path.join(out_dir, 'matrix.log'), 'a')


def say(msg):
    line = f"{time.strftime('%H:%M:%S')} {msg}"
    print(line, flush=True); log.write(line + '\n'); log.flush()


lock = open(os.path.join(tempfile.gettempdir(), 'maxsim-bench-matrix.lock'), 'w')
try:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    say('another run_matrix.py holds the machine lock; one benchmark per machine'); sys.exit(1)


def cpu_busy():
    """% of all CPUs in use over the next second."""
    if sys.platform == 'darwin':
        out = subprocess.run(['top', '-l', '2', '-s', '1', '-n', '0'], capture_output=True, text=True).stdout
        idle = [l for l in out.splitlines() if l.startswith('CPU usage')][-1].split(',')[-1]
        return 100.0 - float(idle.strip().split('%')[0])
    def snap():
        v = [int(x) for x in open('/proc/stat').readline().split()[1:]]
        return sum(v), v[3] + v[4]
    t0, i0 = snap(); time.sleep(1); t1, i1 = snap()
    return 100.0 * (1 - (i1 - i0) / max(1, t1 - t0))


# 1. references (untimed, own process), set hashes, expected call counts
r = subprocess.run([jobs.python_for(None), '-I', os.path.join(HERE, 'contracts.py'), '--ensure'] + sets, capture_output=True, text=True)
if r.returncode != 0:
    say(f'FAILED: contract references: {r.stderr.strip()[-400:]}'); sys.exit(1)
for line in r.stdout.splitlines():
    say(line)
hashes = [set_hash(s) for s in sets]
expected = sum(count_calls(s, a.limit, a.stride) for s in sets)
options = dict(reps=a.reps, gap_ms=a.gap_ms, limit=a.limit, stride=a.stride, prewarm_lead_us=a.prewarm_lead_us,
               keep_scores=a.keep_scores, prep_us=os.environ.get('PREP_US', ''), ss_maxsim_threads=os.environ.get('SS_MAXSIM_THREADS', ''))
MEM_ENV = {'MallocLargeCache': '0'} if sys.platform == 'darwin' else {'MALLOC_MMAP_THRESHOLD_': '65536'}
if a.mem:  # W11: the pass's own code and allocator settings are part of the job identity
    options.update(mem=True, mem_env=MEM_ENV, mem_tokens=os.environ.get('SS_MEM_TOKENS', ''),
                   mem_code={f: jobs.sha_file(os.path.join(HERE, f)) for f in ('mem.py', 'memstat.py', 'mem-node.mjs')})

# 2. the job list
rng = random.Random(42)
job_list = []
for proc in range(a.procs):
    for rd in range(a.rounds):
        order = list(a.arm) if rd == 0 else list(reversed(a.arm)) if rd == 1 else rng.sample(a.arm, len(a.arm))
        for spec in order:
            spec_opts = dict(options, threads=jobs.parse_spec(spec)['threads'])
            contract = jobs.contract_of(spec)
            key, blob = jobs.job_key(sets, hashes, spec, spec_opts, contract)
            job_list.append(dict(file=f'{jobs.file_name(spec)}.r{rd}.p{proc}.json', key=key, arm=spec, round=rd, proc=proc,
                                 expected_calls=expected, reps=a.reps, sets=sets, identity=blob, kind='mem' if a.mem else 'matrix'))
tmp = os.path.join(out_dir, 'jobs.json.tmp')
json.dump(dict(machine=a.machine, tag=a.tag, group=group_name(), jobs=job_list), open(tmp, 'w'), indent=1)
os.replace(tmp, os.path.join(out_dir, 'jobs.json'))
say(f"start machine={a.machine} tag={a.tag} group={group_name()} arms={a.arm} sets={len(sets)} calls={expected} "
    f"procs={a.procs} rounds={a.rounds} reps={a.reps} gap={a.gap_ms} jobs={len(job_list)}")
if a.dry_run:
    sys.exit(0)

# 3. run
failed = []
for j in job_list:
    dest = os.path.join(out_dir, j['file'])
    why = jobs.validate(dest, j['key'], j['expected_calls'], j['reps'], j['kind'])
    if not why:
        say(f"reuse {j['file']}"); continue
    if why != 'missing':
        st = os.path.join(out_dir, 'stale'); os.makedirs(st, exist_ok=True)
        shutil.move(dest, os.path.join(st, f"{j['file']}.{time.strftime('%Y%m%dT%H%M%S')}"))
        say(f"stale {j['file']} ({why}) -> stale/")
    for leftover in (dest + '.tmp',):
        if os.path.exists(leftover):
            os.remove(leftover)
    spec = j['arm']; ps = jobs.parse_spec(spec)
    if a.max_busy:
        t0 = time.time()
        while (busy := cpu_busy()) > a.max_busy:
            time.sleep(10)
        say(f'cpu busy {busy:.1f}% before {spec}' + (f' (waited {time.time() - t0:.0f}s)' if time.time() - t0 > 2 else ''))
    common = ['--out', dest, '--reps', str(a.reps), '--gap-ms', str(a.gap_ms), '--limit', str(a.limit), '--stride', str(a.stride), '--job-key', j['key']]
    common += ['--keep-scores'] if a.keep_scores else []
    setargs = [x for s in sets for x in ('--set', s)]
    env = dict(os.environ)
    if a.mem:
        env.update(MEM_ENV)
        mcommon = ['--out', dest, '--limit', str(a.limit), '--stride', str(a.stride), '--job-key', j['key']]
        if ps['node']:
            cmd = ['node', '--expose-gc', os.path.join(HERE, 'mem-node.mjs'), '--arm', ps['arm']] + mcommon + setargs
        else:
            if ps['variant']:
                env['SS_CAPI'] = os.path.join(os.environ['SS_CAPI_DIR'], ps['variant'] + jobs.EXT)
            cmd = [jobs.python_for(ps['env']), '-I', os.path.join(HERE, 'mem.py'), '--arm', ps['arm'], '--threads', str(ps['threads'])] + mcommon + setargs
    elif ps['node']:
        cmd = ['node', os.path.join(HERE, 'bench-node.mjs'), '--arm', ps['arm']] + common + setargs
    else:
        if ps['variant']:
            env['SS_CAPI'] = os.path.join(os.environ['SS_CAPI_DIR'], ps['variant'] + jobs.EXT)
        cmd = [jobs.python_for(ps['env']), '-I', os.path.join(HERE, 'bench.py'), '--arm', ps['arm'], '--threads', str(ps['threads']),
               '--prewarm-lead-us', str(a.prewarm_lead_us)] + common + setargs
    res = subprocess.run(cmd, capture_output=True, text=True, env=env)
    tail = (res.stdout.strip().splitlines() or [''])[-1]
    why = jobs.validate(dest, j['key'], j['expected_calls'], j['reps'], j['kind']) if res.returncode == 0 else f'exit {res.returncode}'
    if why:
        failed.append(j['file'])
        say(f"r{j['round']} p{j['proc']} {spec}: FAILED ({why}) {res.stderr.strip()[-400:]}")
    else:
        say(f"r{j['round']} p{j['proc']} {spec}: {tail}")

if failed:
    say(f'FAILED: {len(failed)} of {len(job_list)} jobs: {" ".join(failed)}')
    sys.exit(1)
say(f'matrix complete: {len(job_list)} jobs in {out_dir}')
