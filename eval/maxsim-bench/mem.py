# venv/bin/python -I mem.py --arm NAME --out FILE.json --set DIR [--set DIR ...] [--threads N]
#                            [--limit N] [--stride N] [--job-key K]
#
# W11 "RAM per arm" (PAPER_PLAN.md section 7): one UNTIMED pass of one bench.py arm in a
# fresh process, apart from the timed rounds, on the same calls as the timing (same sets,
# --limit, --stride). run_matrix.py --mem runs it, with the allocator settings of memstat.py.
#
# Method (memstat.py: Linux VmRSS / VmHWM / smaps_rollup, macOS phys_footprint):
#   (macOS: RSS, see memstat.py; Linux: VmRSS)
#   1 runtime    at start: the interpreter, NumPy and this harness (reported apart)
#   2 loaded     a sample of the calls is read (the int4 store as the index holds it):
#                every call up to SS_MEM_TOKENS stored doc tokens (default 2,000,000),
#                else an evenly spaced sample that always holds the median-size and the
#                largest call. Files are read through mmap, so the read buffers leave no
#                freed heap behind that later phases could reuse unseen.
#   3 libraries  one untimed warm-up call on the smallest sampled call (the arm's library,
#                thread pools, per-thread buffers, JIT), then its copy is dropped
#   4 prepared   the arm prepares its copy of EVERY sampled call (decode, cast, pad, pack:
#                bench.py's build, which runs outside the timer there) and holds them all;
#                bench.py's per-call input cache is dropped, so what stays is what the
#                scoring call needs: copy bytes per token = (prepared - libraries) / sampled
#                tokens; intermediates (e.g. the decoded docs before packing) are in the
#                prepare peak
#   5 scoring    one scoring call on the median-size call, then one on the largest call;
#                peak temporary memory per call = phase peak - the resident memory before
#                the first scoring call (both peaks against the same base, so freed pages
#                of the first call that the second one reuses still count)
# Summary: resident bytes per stored doc token = the int4 store (arms that read it at
# scoring time: ours, the *_int4 rivals) + the arm's own copy. The rivals' decoded copies,
# made outside the timer in bench.py, count here. Computed bytes per token (int4
# ceil(dim/2) + 12, f32 4*dim, bf16 / f16 2*dim) stand beside the measured ones.
import argparse, gc, glob, json, mmap, os, platform, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import memstat  # noqa: E402

M_RUNTIME = memstat.split()
import numpy as np  # noqa: E402
from replay_py import excluded  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument('--arm', required=True)
p.add_argument('--set', action='append', required=True)
p.add_argument('--out', required=True)
p.add_argument('--threads', type=int, default=0)
p.add_argument('--limit', type=int, default=0)
p.add_argument('--stride', type=int, default=1)
p.add_argument('--job-key', default='')
a = p.parse_args()

import bench  # noqa: E402  (module import: bench.args holds the defaults)
bench.args.arm, bench.args.threads, bench.args.reps = a.arm, a.threads, 1
build, contract, clamp, precision = bench.ARMS[a.arm]
USES_STORE = a.arm == 'ours' or a.arm.endswith('_int4')
M_RUNTIME_NP = memstat.split()
TOKEN_BUDGET = int(os.environ.get('SS_MEM_TOKENS', 2_000_000))


def metas(root):
    """The calls of one set in replay_py.load_set order (EXCLUDE.json, then stride, limit)."""
    # Mirrors: eval/maxsim-bench/replay_py.py:load_set (order and exclusions)
    out, skip = [], excluded(root)
    for repo in sorted(os.listdir(root)):
        d = os.path.join(root, repo)
        if not os.path.isdir(d) or repo in ('refs-v2', 'stale'):
            continue
        for idx in sorted(glob.glob(os.path.join(d, 'index-*.jsonl'))):
            for line in open(idx):
                m = json.loads(line)
                if f"{repo}/{m['file']}" not in skip:
                    out.append((root, repo, m))
    out = out[::a.stride]
    return out[:a.limit] if a.limit else out


def load(root, repo, m):
    """One call, as replay_py.load_set builds it, read through mmap."""
    with open(os.path.join(root, repo, m['file']), 'rb') as f, mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as mm:
        off = 0

        def take(n, dt):
            nonlocal off
            x = np.frombuffer(mm, dt, n // np.dtype(dt).itemsize, off).copy(); off += n
            return x
        nq, dim = m['numQ'], m['dim']
        q = take(nq * dim * 4, np.float32).reshape(nq, dim)
        cands = []
        for c in m['cands']:
            nt = c['nt']
            raw = take(c['tb'], np.uint8)
            cands.append(dict(kind=m['kind'], raw=raw, nt=nt, mn=take(nt * 4, np.float32), sc=take(nt * 4, np.float32), nr=take(nt * 4, np.float32)))
    return dict(set=os.path.basename(root.rstrip('/')), repo=repo, file=m['file'], kind=m['kind'], q=q, nq=nq, dim=dim, cands=cands)


def ntok(m):
    return sum(c['nt'] for c in m['cands'])


def collect():
    gc.collect(); gc.collect()


def drop(call):
    for k in [k for k in call if k.startswith('in_')]:
        call.pop(k)


# ---- 2 sample and load
allm = [x for root in a.set for x in metas(root)]
tok_all = sum(ntok(m) for _, _, m in allm)
if tok_all <= TOKEN_BUDGET:
    pick = list(range(len(allm)))
else:
    order = sorted(range(len(allm)), key=lambda i: (ntok(allm[i][2]), i))
    must = {order[len(order) // 2], order[-1]}
    step = tok_all / TOKEN_BUDGET
    pick = sorted(must | {int(k * step) for k in range(int(len(allm) / step))})
    pick = [i for i in pick if i < len(allm)]
calls = [load(*allm[i]) for i in pick]
collect()
M_LOADED = memstat.split()
toks = [ntok(c) for c in calls]
tok = sum(toks) or 1
stb = int(sum(x['raw'].nbytes + x['mn'].nbytes + x['sc'].nbytes + x['nr'].nbytes for c in calls for x in c['cands']))
dims = sorted({c['dim'] for c in calls})
by_size = sorted(range(len(calls)), key=lambda i: (toks[i], i))

# ---- 3 warm-up on the smallest call
if calls:
    w = calls[by_size[0]]
    run = build(w); run(); del run; drop(w)
collect()
M_LIBS = memstat.split()

# ---- 4 prepared copies of every sampled call, held at once
memstat.reset_peak()
runs = []
for c in calls:
    runs.append(build(c))
    drop(c)  # bench.py's per-call input cache: what the scoring call needs stays in its closure
collect()
M_PREP = memstat.split()
prep_peak = memstat.peak() - M_LIBS['resident']

# ---- 5 scoring: the median-size call, then the largest call, against one base
temps = {}
base = memstat.current()
for label, i in (('p50', by_size[len(by_size) // 2] if calls else None), ('max', by_size[-1] if calls else None)):
    if i is None:
        continue
    memstat.reset_peak()
    runs[i]()
    temps[label] = dict(temp=max(0, memstat.peak() - base), tokens=toks[i], pool=len(calls[i]['cands']), nq=calls[i]['nq'])
M_SCORED = memstat.split()
n_runs = len(runs)
del runs

store_pt = stb / tok
copy_pt = (M_PREP['resident'] - M_LIBS['resident']) / tok
dim = dims[0] if len(dims) == 1 else None
summary = dict(
    runtime_bytes=M_RUNTIME['resident'], runtime_numpy_bytes=M_RUNTIME_NP['resident'],
    loaded_delta_bytes=M_LOADED['resident'] - M_RUNTIME_NP['resident'], library_delta_bytes=M_LIBS['resident'] - M_LOADED['resident'],
    calls_selected=len(allm), calls_sampled=len(calls), tokens_selected=tok_all, tokens=tok, stored_bytes=stb,
    store_bytes_per_token=store_pt, loaded_bytes_per_token=(M_LOADED['resident'] - M_RUNTIME_NP['resident']) / tok,
    uses_store=USES_STORE, arm_copy_bytes_per_token=copy_pt, resident_bytes_per_token=copy_pt + (store_pt if USES_STORE else 0.0),
    prep_peak_bytes=prep_peak, score_temp=temps,
    computed_bytes_per_token=(dict(int4=(dim + 1) // 2 + 12, f32=4 * dim, bf16=2 * dim, f16=2 * dim) if dim else None))
env = dict(arm=a.arm, threads=a.threads, sets=a.set, platform=platform.platform(), machine=platform.machine(),
           python=sys.version.split()[0], numpy=np.__version__, cpu_count=os.cpu_count(), source=memstat.SOURCE,
           malloc_env=memstat.env(), token_budget=TOKEN_BUDGET, instance=os.environ.get('SS_INSTANCE_ID', platform.node()),
           started=time.strftime('%Y-%m-%dT%H:%M:%S'))
env.update({k: v for k, v in bench.env_info().items() if k in ('torch', 'maxsim_cpu', 'numkong', 'threadpools', 'rivals_rs')})
out = dict(kind='mem', env=env, arm=a.arm, contract=contract, clamp=clamp, precision=precision, job_key=a.job_key,
           readings=dict(runtime=M_RUNTIME, runtime_numpy=M_RUNTIME_NP, loaded=M_LOADED, libraries=M_LIBS, prepared=M_PREP, scored=M_SCORED),
           summary=summary, sampled=[dict(set=c['set'], repo=c['repo'], file=c['file'], tokens=t) for c, t in zip(calls, toks)],
           n_calls=len(allm), complete=n_runs == len(calls))
tmp = a.out + '.tmp'
with open(tmp, 'w') as f:
    json.dump(out, f)
os.replace(tmp, a.out)
t = summary['score_temp']
print(f"mem {a.arm} calls={len(allm)} sampled={len(calls)} resident={summary['resident_bytes_per_token']:.1f} B/token (store {store_pt:.1f}, copy {copy_pt:.1f}) "
      f"temp p50={t.get('p50', {}).get('temp', 0) / 1024:.0f} KiB max={t.get('max', {}).get('temp', 0) / 1048576:.2f} MiB libs={summary['library_delta_bytes'] / 1048576:.0f} MiB")
