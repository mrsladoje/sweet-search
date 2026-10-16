# python3 concurrency.py --group-json '<plan_groups.py line>' --machine NAME [--results DIR] [--limit N]
#        or: --set DIR --arm ARM [--arm ...] --mode design|frozen [--rates r1,r2,r3] --tag TAG ...
#
# W6, parallel callers (PAPER_PLAN.md section 7). Timing only; accuracy is checked by the
# matrix runs. Two executors per arm:
#   threads  N caller threads in ONE process (the library's own pool is shared, as in one
#            service process; ctypes and the BLAS calls release the GIL)
#   procs    one process per caller, each with a thread budget of max(1, cores // N);
#            each process holds only the calls it serves
#
# Closed-loop saturation (both modes): N in {1, 4, 16} callers, each replays its share of
# the set back to back. Reported: throughput, and per-request p50 / p99 from every
# individual timing. This is "closed-loop saturation", not a service latency.
#
# Open-loop, equal traffic (frozen mode): one Poisson arrival trace per rate (seed 42; the
# same timestamps and the same call order for every arm), 16 workers. Latency = completion
# minus scheduled arrival, so it includes queueing. Rates are absolute and common to all
# arms on a machine (FREEZE.json w6_rates: 25 / 50 / 75 % of the closed-loop saturation
# throughput of the slowest shortlisted arm, measured here in design mode on dev). The
# threads executor uses one shared queue; the procs executor assigns each call to one
# process (static assignment, one queue per process): the output names the executor.
import argparse, ctypes, gc, hashlib, json, multiprocessing as mp, os, queue, sys, threading, time
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import jobs  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument('--group-json')
p.add_argument('--machine')
p.add_argument('--results', default=os.path.join(HERE, 'results'))
p.add_argument('--set')
p.add_argument('--arm', action='append', default=[])
p.add_argument('--mode', default='design')
p.add_argument('--rates', default='')
p.add_argument('--tag', default='conc')
p.add_argument('--callers', default='1,4,16')
p.add_argument('--executors', default='threads,procs')
p.add_argument('--requests', type=int, default=0, help='open loop: requests per rate (0 = 2 x calls)')
p.add_argument('--limit', type=int, default=0)
CORES = os.cpu_count()


def load(root, limit, share=None):
    from replay_py import load_set
    calls = load_set(root)
    if limit:
        calls = calls[:limit]
    calls = [c for i, c in enumerate(calls) if share is None or i % share[1] == share[0]]
    if share is not None:
        # the arrays are views into whole index files; a caller copies out its own calls so
        # the rest of the set is freed (16 callers x the whole set ran out of RAM on 32 GB)
        calls = [dict(c, q=c['q'].copy(), cands=[dict(x, raw=x['raw'].copy(), mn=x['mn'].copy(), sc=x['sc'].copy(),
                                                      nr=x['nr'].copy()) for x in c['cands']]) for c in calls]
        trim()
    return calls


def trim():
    """Give freed heap back to the OS (glibc keeps it otherwise), so callers fit beside the parent."""
    gc.collect()
    try:
        ctypes.CDLL('libc.so.6').malloc_trim(0)
    except (OSError, AttributeError):
        pass


def builder(arm, threads):
    """A run() factory for one arm spec; the thread budget is set before the first build."""
    ps = jobs.parse_spec(arm)
    t = ps['threads'] or threads
    if ps['arm'] == 'ours' and t:
        os.environ['SS_MAXSIM_THREADS'] = str(t)
    import bench
    bench.args.threads = t
    return bench.ARMS[ps['arm']][0]


def _proc_worker(arm, threads, root, limit, share, schedule, t0_ns, q):
    """One caller process: closed loop (schedule None) or its share of an open-loop trace."""
    parent = os.getppid()
    build = builder(arm, threads)
    calls = load(root, limit, share)
    runs = [build(c) for c in calls]
    for r in runs[:1]:
        r()
    lat = []
    if schedule is None:
        q.put(('ready', None)); start = q_wait(parent)
        for r in runs:
            t = time.perf_counter_ns(); r(); lat.append(time.perf_counter_ns() - t)
        q.put(('done', (lat, time.perf_counter_ns())))
        return
    q.put(('ready', None)); start = q_wait(parent)
    for when, idx in schedule:
        while time.perf_counter_ns() < start + when:
            pass
        runs[idx]()
        lat.append(time.perf_counter_ns() - (start + when))
    q.put(('done', (lat, time.perf_counter_ns())))


def q_wait(parent):
    # The parent writes the common start time into a file-backed value; poll it. A caller
    # whose parent died exits (it would otherwise poll for ever and hold its memory).
    while True:
        if os.getppid() != parent:
            os._exit(1)
        v = os.environ.get('SS_CONC_START_FILE')
        if v and os.path.exists(v):
            try:
                return int(open(v).read())
            except ValueError:
                pass
        time.sleep(0.001)


def run_procs(arm, root, limit, n, schedule_for=None):
    ctx = mp.get_context('spawn')
    startf = os.path.join(os.environ.get('TMPDIR', '/tmp'), f'conc-start-{os.getpid()}-{time.time_ns()}')
    os.environ['SS_CONC_START_FILE'] = startf
    budget = max(1, CORES // n)
    trim()
    qs, ps = [], []
    # start the callers one at a time: each loads the whole set before it keeps its share,
    # so at most one caller holds the whole set at once. Timing starts after all are ready.
    for w in range(n):
        q = ctx.Queue()
        sched = schedule_for(w) if schedule_for else None
        pr = ctx.Process(target=_proc_worker, args=(arm, budget, root, limit, (w, n), sched, 0, q))
        pr.start(); qs.append(q); ps.append(pr)
        while True:
            try:
                assert q.get(timeout=5)[0] == 'ready'; break
            except queue.Empty:
                if not pr.is_alive():
                    for x in ps:
                        x.kill()
                    raise RuntimeError(f'{arm}: caller {w} died before it was ready (exit {pr.exitcode})')
    start = time.perf_counter_ns() + 50_000_000
    open(startf + '.tmp', 'w').write(str(start)); os.replace(startf + '.tmp', startf)
    lat, end = [], 0
    for q in qs:
        kind, (l, e) = q.get()
        lat += l; end = max(end, e)
    for pr in ps:
        pr.join()
    os.remove(startf)
    if any(pr.exitcode != 0 for pr in ps):
        raise RuntimeError(f'{arm}: a caller process failed')
    return lat, end - start, budget


def run_threads(arm, calls, n, schedule=None):
    build = builder(arm, 0)
    runs = [build(c) for c in calls]
    for r in runs:
        r()
    lat = [[] for _ in range(n)]
    barrier = threading.Barrier(n + 1)
    start_box = {}
    if schedule is None:
        def worker(w):
            mine = runs[w::n]
            barrier.wait()
            for r in mine:
                t = time.perf_counter_ns(); r(); lat[w].append(time.perf_counter_ns() - t)
    else:
        jobsq = queue.Queue()
        def worker(w):
            barrier.wait()
            while True:
                item = jobsq.get()
                if item is None:
                    return
                when, idx = item
                runs[idx]()
                lat[w].append(time.perf_counter_ns() - (start_box['t'] + when))
    th = [threading.Thread(target=worker, args=(w,)) for w in range(n)]
    for t in th:
        t.start()
    start_box['t'] = time.perf_counter_ns()
    barrier.wait()
    if schedule is not None:
        for when, idx in schedule:
            while time.perf_counter_ns() < start_box['t'] + when:
                pass
            jobsq.put((when, idx))
        for _ in th:
            jobsq.put(None)
    for t in th:
        t.join()
    return [x for l in lat for x in l], time.perf_counter_ns() - start_box['t'], 0


def trace(rate, n_req, n_calls, seed=42):
    """Poisson arrivals (ns offsets) and the call index of each request; the same for every arm."""
    rng = np.random.default_rng(seed)
    gaps = rng.exponential(1e9 / rate, n_req)
    order = np.concatenate([rng.permutation(n_calls) for _ in range(-(-n_req // n_calls))])[:n_req]
    return [(int(t), int(i)) for t, i in zip(np.cumsum(gaps), order)]


def main(a, group):
    root, arms, mode = group['set'], group['arms'], group.get('mode', 'design')
    rates = group.get('rates') or []
    callers = [int(x) for x in a.callers.split(',')]
    execs = a.executors.split(',')
    name = group['name']
    out_dir = os.path.join(a.results, a.machine, name, os.path.basename(root.rstrip('/')))
    os.makedirs(out_dir, exist_ok=True)
    from set_manifest import set_hash
    sh = set_hash(root)
    calls = load(root, a.limit)
    n_req = a.requests or 2 * len(calls)
    job_list, failed = [], []
    for arm in arms:
        spec_runs = [('closed', e, n, None) for e in execs for n in callers] + [('open', e, 16, r) for e in execs for r in rates]
        blob = dict(set=[os.path.basename(root), sh], arm=arm, binaries=jobs.binaries(arm), mode=mode, runs=[list(x) for x in spec_runs],
                    limit=a.limit, requests=n_req, instance=jobs.instance_id(), script=jobs.sha_file(os.path.abspath(__file__)))
        key = hashlib.sha256(json.dumps(blob, sort_keys=True).encode()).hexdigest()
        dest = os.path.join(out_dir, jobs.file_name(arm) + '.conc.json')
        job_list.append(dict(file=os.path.basename(dest), key=key, arm=arm, kind='concurrency', expected_calls=len(spec_runs), reps=0, identity=blob))
        if not jobs.validate(dest, key, len(spec_runs), 0, 'concurrency'):
            print(f'reuse {dest}'); continue
        res = dict(arm=arm, set=os.path.basename(root), job_key=key, complete=False, cores=CORES, runs=[])
        try:
            for kind, ex, n, rate in spec_runs:
                if kind == 'closed':
                    lat, wall, budget = run_threads(arm, calls, n) if ex == 'threads' else run_procs(arm, root, a.limit, n)
                else:
                    tr = trace(rate, n_req, len(calls))
                    if ex == 'threads':
                        lat, wall, budget = run_threads(arm, calls, n, tr)
                    else:
                        # static assignment: call i is served by process i % n; requests keep their times
                        per = lambda w, tr=tr, n=n: [(t, i // n) for t, i in tr if i % n == w]
                        lat, wall, budget = run_procs(arm, root, a.limit, n, per)
                la = np.asarray(lat, float)
                res['runs'].append(dict(type=kind, executor=ex, callers=n, rate=rate, thread_budget=budget, n=len(lat), wall_ns=wall,
                                        throughput=len(lat) / (wall / 1e9), p50_ms=float(np.percentile(la, 50)) / 1e6,
                                        p99_ms=float(np.percentile(la, 99)) / 1e6, lat_ns=[int(x) for x in lat]))
                print(f'{arm} {kind} {ex} n={n} rate={rate}: {len(lat)} requests', flush=True)
                # rival_inputs caches each call's decoded inputs in the call dict; in the
                # parent that is the whole set in f32 (9.4 GB on agent-ho), and 16 caller
                # processes beside it ran out of RAM on 32 GB. Drop it after every run.
                for c in calls:
                    for k in [k for k in c if k.startswith('in_')]:
                        del c[k]
                trim()
        except Exception as e:
            failed.append(arm); print(f'FAILED {arm}: {e}', flush=True); continue
        res['complete'] = True
        json.dump(res, open(dest + '.tmp', 'w')); os.replace(dest + '.tmp', dest)
    json.dump(dict(machine=a.machine, tag=name, jobs=job_list), open(os.path.join(out_dir, 'jobs.json'), 'w'), indent=1)
    if failed:
        print(f'FAILED: {failed}'); sys.exit(1)
    print(f'concurrency complete: {len(arms)} arms in {out_dir}')


if __name__ == '__main__':
    a = p.parse_args()
    if a.group_json:
        g = json.loads(a.group_json)
    else:
        g = dict(name=a.tag, set=a.set, arms=a.arm, mode=a.mode, rates=[float(x) for x in a.rates.split(',') if x])
    main(a, g)
