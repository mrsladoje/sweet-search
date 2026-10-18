# The Python runner for adapters that exist only in Python (ScaNN): the same commands, timing protocol and
# record format as rivals5.cpp (DESIGN.md 5). The (A) screen and rescoring and the query order come from
# librescore5.so (rescore_capi.cpp = shared_rescore.h), so no second implementation exists. The Python loop
# around each call is part of the timed path (py_overhead.py measures it; reported per machine).
#   python py5.py build --data D --set S --model M --family scann --params k=v,... --threads T --seed s --dir OUT
#   python py5.py query --data D --set S --model M --split dev|ho --family scann --dir OUT --search k=v,...
#                       --comparison A|B [--C n --H n] [--kv n] --round r --out <stem> [--key f --job-hash h]
#                       [--heldout] [--cold] [--limit n]
import ctypes, hashlib, json, os, resource, sys, time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'adapters'))
FAMILIES = {'scann': lambda: __import__('scann_adapter').ScannAdapter()}


def parse(argv):
    a, i = {}, 0
    while i < len(argv):
        k = argv[i][2:]
        if k in ('heldout', 'cold', 'stages'):
            a[k] = True; i += 1
        else:
            a[k] = argv[i + 1]; i += 2
    return a


def params(s):
    return dict(kv.split('=', 1) for kv in (s or '').split(',') if kv)


def memory():
    m = {'maxrss_kb': str(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // (1024 if sys.platform == 'darwin' else 1))}
    ru = resource.getrusage(resource.RUSAGE_SELF); m['majflt'] = str(ru.ru_majflt); m['minflt'] = str(ru.ru_minflt)
    try:
        rss = anon = None
        for l in open('/proc/self/smaps_rollup'):
            if l.rstrip().endswith('kB'):
                k, v = l.split(':'); v = int(v.split()[0]); m[k] = str(v)
                rss = v if k == 'Rss' else rss; anon = v if k == 'Anonymous' else anon
        if rss is not None:
            m['file_backed_kb'] = str(rss - (anon or 0))
    except OSError:
        pass
    return m


def lib():
    L = ctypes.CDLL(os.environ['LIBRESCORE5'])  # build-rivals5.sh writes it next to rivals5; run.py sets the path
    L.r5_new.restype = ctypes.c_void_p
    L.r5_new.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, ctypes.c_int]
    L.r5_query.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p]
    L.r5_run.restype = ctypes.c_size_t
    L.r5_run.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t, ctypes.c_size_t, ctypes.c_void_p, ctypes.c_void_p]
    L.r5_perm.argtypes = [ctypes.c_size_t, ctypes.c_uint64, ctypes.c_void_p]
    return L


def perm(L, n, seed):
    out = np.empty(n, dtype=np.uint64)
    L.r5_perm(n, seed, out.ctypes.data)
    return out.astype(np.int64)


def normed(x):
    x = np.array(x, dtype=np.float32)
    n = np.sqrt((x.astype(np.float64) ** 2).sum(1)).astype(np.float32)
    return x / np.where(n > 0, n, 1)[:, None]


def build(a):
    emb = f"{a['data']}/emb/{a['model']}/{a['set']}"
    X = normed(np.fromfile(f'{emb}/corpus.f32', dtype=np.float32).reshape(-1, 768))
    ad, p = FAMILIES[a['family']](), params(a.get('params'))
    os.makedirs(a['dir'], exist_ok=True)
    t0 = time.perf_counter()
    ad.build(X, p, int(a.get('threads', os.cpu_count())), int(a.get('seed', 42)), a['dir'])
    bs = time.perf_counter() - t0
    files = {os.path.basename(f): dict(bytes=os.path.getsize(f), sha256=hashlib.sha256(open(f, 'rb').read()).hexdigest())
             for f in ad.files(a['dir'])}
    open(os.path.join(a['dir'], 'build.params'), 'w').write(','.join(f'{k}={v}' for k, v in sorted(p.items())))
    rec = dict(family=a['family'], set=a['set'], model=a['model'], params=p, threads=int(a.get('threads', os.cpu_count())),
               seed=int(a.get('seed', 42)), n=len(X), build_s=bs, bytes=sum(f['bytes'] for f in files.values()), files=files,
               memory=memory(), info={})
    json.dump(rec, open(os.path.join(a['dir'], 'build.json.tmp'), 'w'))
    os.replace(os.path.join(a['dir'], 'build.json.tmp'), os.path.join(a['dir'], 'build.json'))
    print(f"built {a['family']} {a['set']}/{a['model']} n={len(X)} in {bs:.1f} s")


def query(a):
    tp = time.perf_counter()
    split, rnd, comp = a['split'], int(a['round']), a['comparison']
    if bool(a.get('heldout')) != (split == 'ho'):
        sys.exit('--heldout must be given exactly for the held-out split')
    if a.get('heldout') and a.get('limit'):
        sys.exit('held-out runs execute the whole split')
    sd, emb = f"{a['data']}/sets/{a['set']}", f"{a['data']}/emb/{a['model']}/{a['set']}"
    splits = [json.loads(l)['split'] for l in open(f'{sd}/queries.jsonl') if l.strip()]
    Q = np.fromfile(f'{emb}/queries.f32', dtype=np.float32).reshape(-1, 768)
    rows = [i for i, s in enumerate(splits) if s == split]
    warm = [i for i, s in enumerate(splits) if s == 'dev']
    if a.get('limit'):
        rows = rows[:int(a['limit'])]
    nq = len(rows)
    L = lib()
    ex = json.load(open(f'{emb}/export/export.json'))
    tl = time.perf_counter()
    ad = FAMILIES[a['family']]()
    bp, sp = params(open(os.path.join(a['dir'], 'build.params')).read()), params(a.get('search'))
    ad.load(a['dir'], None, bp)
    ad.set_search(sp)
    r5 = None
    if comp == 'A':
        C, H = int(a['C']), int(a['H'])
        assert C >= H >= 10, 'A needs C >= H >= 10'
        i8 = np.memmap(f'{emb}/export/int8.i8', dtype=np.int8, mode='r')
        f16 = np.memmap(f'{emb}/export/f16.u16', dtype=np.uint16, mode='r')
        r5 = L.r5_new(i8.ctypes.data, ex['int8_width'], f16.ctypes.data, ex['code_bytes'] * 8)
        Lw, K = H, C
    else:
        Lw = K = int(a['kv'])
    load_s = time.perf_counter() - tl
    mem_loaded = memory()
    code = np.zeros(96, dtype=np.uint8)
    cand = np.empty(K, dtype=np.int64); ids = np.empty(Lw, dtype=np.int64); sc = np.empty(Lw, dtype=np.float64)

    stages = bool(a.get('stages')); last = [0, 0, 0]; pc = time.perf_counter_ns  # post-freeze: conv | gen | rest

    def one(r):
        c0 = pc()
        q = Q[r]
        n = float(np.sqrt(np.dot(q.astype(np.float64), q)))
        qn = (q / np.float32(n)) if n > 0 else q
        if comp == 'A':
            L.r5_query(r5, q.ctypes.data, code.ctypes.data)
            c1 = pc()
            got_ids, _ = ad.search(qn, K)
            cand[:] = -1; cand[:len(got_ids)] = got_ids
            c2 = pc()
            n_ = L.r5_run(r5, cand.ctypes.data, len(got_ids), Lw, ids.ctypes.data, sc.ctypes.data)
            if stages:
                last[0], last[1], last[2] = c1 - c0, c2 - c1, pc() - c2
            return n_
        got_ids, got_sc = ad.search(qn, K)
        m = min(len(got_ids), Lw)
        ids[:m] = got_ids[:m]; sc[:m] = got_sc[:m]
        return m

    mem_timed = None
    if not a.get('cold'):
        w = perm(L, len(warm), 7)
        for i in range(min(500, len(warm))):
            one(warm[w[i]])
    mem_timed = memory()  # replication: faults of the timed pass alone (after any warm-up)
    lv = np.full((nq, Lw), -1, dtype=np.int32); ls = np.full((nq, Lw), np.nan, dtype=np.float32)
    tns = [-1] * nq; short = 0; first = -1
    stg = [[-1] * nq for _ in range(3)] if stages else None
    for qi in perm(L, nq, 42 + rnd):
        ids[:] = -1; sc[:] = np.nan
        s = time.perf_counter_ns()
        n = one(rows[qi])
        ns = time.perf_counter_ns() - s
        tns[qi] = ns; first = ns if first < 0 else first; short += n < Lw
        if stg:
            stg[0][qi], stg[1][qi], stg[2][qi] = last
        lv[qi, :n] = ids[:n]; ls[qi, :n] = sc[:n]
    mem_after = memory()
    stem = a['out']; os.makedirs(os.path.dirname(stem), exist_ok=True)
    blob = lv.tobytes() + ls.tobytes()
    open(stem + '.lists.bin.tmp', 'wb').write(blob); os.replace(stem + '.lists.bin.tmp', stem + '.lists.bin')
    pr = dict(sp); pr.update(dict(C=str(C), H=str(H)) if comp == 'A' else dict(kv=str(Lw)))
    rec = dict(job_hash=a.get('job-hash'), key=json.load(open(a['key'])) if a.get('key') else None, complete=True,
               system=a['family'], comparison=comp, set=a['set'], model=a['model'], split=split, round=rnd, params=pr,
               build_params=bp, L=Lw, n_queries=nq, order_seed=42 + rnd, warmup=0 if a.get('cold') else min(500, len(warm)),
               cold=bool(a.get('cold')), timings_ns=tns, first_query_ns=first, lists_sha256=hashlib.sha256(blob).hexdigest(),
               short_lists=int(short), memory=dict(loaded=mem_loaded, timed=mem_timed, after=mem_after), keeps_originals=True, load_s=load_s,
               process_s=time.perf_counter() - tp, info=ad.info(), harness='python',
               **({'stage_ns': dict(conv=stg[0], gen=stg[1], rest=stg[2])} if stg else {}))
    json.dump(rec, open(stem + '.json.tmp', 'w')); os.replace(stem + '.json.tmp', stem + '.json')
    msg = f"{a['family']} {comp} {a['set']}/{a['model']}/{split} r{rnd} nq={nq} short={short}"
    print(msg + ('' if a.get('heldout') else f' p50 {sorted(tns)[nq // 2] / 1e3:.1f} us'))


if __name__ == '__main__':
    cmd, a = sys.argv[1], parse(sys.argv[2:])
    {'build': build, 'query': query}[cmd](a)
