# Post hoc runs after the reviews of draft 8 (descriptive, reported apart; record POSTHOCFREEZE.json):
#  repp-<type>-i<k>  the six replication tests again, held-out, the same paired blocks, seeds and instances per type, with
#                    our index preloaded into anonymous memory (SS_HNSW_PRELOAD=1) on every job of ours
#  strong-<type>     one instance per type, held-out, 5 rounds, both replication sets:
#                    (A) C 400 with the shared path's SIMD kernels (SS_FIX_SHARED_SIMD=1), H 100 (int8 screen) and H 400
#                        with no int8 stage at all (SS_FIX_NO_INT8=1), for our walk (preloaded) and the rival graph and
#                        flat generators at their replication builds, effort 400, FAISS binary flat with counting top-k
#                    (B) the refining dev-chosen rivals with float32 and with float16 refine (SS_FIX_REFINE_F16=1), and ours
#                  dev: perf profiles on MS MARCO 1M: our walk (fixed ef 400, and adaptive) and FAISS binary HNSW (M 64,
#                       ef 400): perf stat on the full dev split and on one query (load and warm-up only), perf record
#   python make_posthoc_plans.py
import copy, glob, json, os, random

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL, PRE = 'bge-base-en-v1.5', {'SS_HNSW_PRELOAD': '1'}
n = 0
for t in ('intel', 'amd', 'arm'):
    for k in range(6):
        src = os.path.join(HERE, 'plans', f'rep-{t}-i{k}', 'heldout'); dst = os.path.join(HERE, 'plans', f'repp-{t}-i{k}', 'heldout')
        os.makedirs(dst, exist_ok=True)
        for f in sorted(glob.glob(os.path.join(src, '*.json'))):
            p = json.load(open(f)); p['step'] = p['step'].replace('rep-heldout', 'repp-heldout')
            for j in p['jobs']:
                if j['system'].startswith('ours'):
                    o = j.setdefault('options', {}); o['env'] = {**(o.get('env') or {}), **PRE}
            json.dump(p, open(os.path.join(dst, os.path.basename(f)), 'w'), indent=0); n += len(p['jobs'])

GRAPHS = {'faiss_bin_hnsw': {'M': 64, 'efC': 800}, 'usearch_b1_rescore': {'M': 32, 'efC': 800}, 'faiss_hnsw_flat': {'M': 64, 'efC': 800},
          'hnswlib_f32': {'M': 64, 'efC': 200}}
SIMD, BYP = {'SS_FIX_SHARED_SIMD': '1'}, {'SS_FIX_SHARED_SIMD': '1', 'SS_FIX_NO_INT8': '1'}
for t in ('intel', 'amd', 'arm'):
    out = os.path.join(HERE, 'plans', f'strong-{t}'); os.makedirs(os.path.join(out, 'heldout'), exist_ok=True); os.makedirs(os.path.join(out, 'dev'), exist_ok=True)
    gens = dict(GRAPHS)
    if t != 'arm':
        gens['diskann_vamana'] = {'L': 200, 'R': 96, 'alpha': 1.2}
    for r in range(5):
        js = []
        for s in ('cqadup', 'msmarco1m'):
            A = dict(set=s, model=MODEL, split='ho', build_seed=42, kind='timing', pagecache='warm', comparison='A', C=400, round=r)
            for H, env in ((100, SIMD), (400, BYP)):
                js.append(dict(A, H=H, system='ours_walk', gen='walk', ef=400, options={'stages': 1, 'env': {**PRE, **({'SS_FIX_NO_INT8': '1'} if H == 400 else {})}}))
                for f, bp in gens.items():
                    sp = {'L': 400} if f == 'diskann_vamana' else {'ef': 400}
                    js.append(dict(A, H=H, system=f, family=f, build_params=bp, search=sp, options={'stages': 1, 'env': env}))
                js.append(dict(A, H=H, system='faiss_bin_flat', family='faiss_bin_flat', build_params={}, search={'use_heap': 0}, options={'stages': 1, 'env': env}))
            sl = json.load(open(os.path.join(HERE, 'shortlists', f'shortlist-rep-{t}.json')))[s]
            B = dict(set=s, model=MODEL, split='ho', build_seed=42, kind='timing', pagecache='warm', comparison='B', kv=sl['k_v'], round=r)
            rv = next(p for p in sl['points'] if p['system'] == sl['rival']); o = next(p for p in sl['points'] if p['system'] == 'ours_cascade')
            if (rv.get('search') or {}).get('refine') or (rv.get('search') or {}).get('rescore'):
                for env in ({}, {'SS_FIX_REFINE_F16': '1'}):
                    js.append(dict(B, **rv, options={'env': env} if env else {}))
                js.append(dict(B, **o, options={'env': PRE}))
        for j in js:  # the replication's fault rule on every job
            j['options'] = {**(j.get('options') or {}), 'faultcheck': 1}
        random.Random(5000 + r).shuffle(js)
        json.dump(dict(step=f'strong-{t}-r{r}', builds=[], jobs=js), open(os.path.join(out, 'heldout', f'strong--r{r}.json'), 'w'), indent=0); n += len(js)
    D = dict(set='msmarco1m', model=MODEL, split='dev', build_seed=42, kind='timing', pagecache='warm', comparison='A', C=400, H=100, round=0)
    js = []
    for perf, lim in (('stat', None), ('stat', 1), ('record', None)):
        o = lambda env: {'stages': 1, 'perf': perf, 'env': env, **({'limit': lim} if lim else {})}
        js.append(dict(D, system='ours_walk', gen='walk', ef=400, options=o({**PRE, **SIMD, 'SS_FIX_HNSW_ADAPTIVE': '0', 'SS_FIX_HNSW_HUGE': '0'})))
        js.append(dict(D, system='ours_walk', gen='walk', ef=400, options=o({**PRE})))
        js.append(dict(D, system='faiss_bin_hnsw', family='faiss_bin_hnsw', build_params={'M': 64, 'efC': 800}, search={'ef': 400}, options=o(SIMD)))
    json.dump(dict(step=f'strong-perf-{t}', builds=[], jobs=js), open(os.path.join(out, 'dev', 'perf.json'), 'w'), indent=0); n += len(js)
print(n, 'jobs')
