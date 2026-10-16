# Plan files for run.py (DESIGN.md 5; PAPER_PLAN.md S4, S5b, S6, S8) from the declared grids (grid.py).
#   --mode build    every (B) and (A) build of every present (set, model) on this machine (no timing)
#   --mode smoke    one cheap build and point per family on gcsn, --limit queries (default 50), dev
#   --mode dev      the dev sweep: (B) every build x search point; (A) every generator x budget x effort; 1 round
#   --mode aa       the A/A runs for R (PAPER_PLAN 10): two arms of one build, 5 rounds, ours and the fastest rivals
#   --mode heldout  the frozen points of shortlist.json for (B) and the full (A) grid, R rounds (+ cold start)
# One plan file per (set, model) so a failed set does not stop the others. Families that did not build on the
# machine (RESULTS/<machine>/families.txt, written by bootstrap.sh) are left out and listed.
# usage: python plan.py --mode M --machine X --data D --out DIR [--limit N] [--families F] [--shortlist S]
#        [--rounds R] [--sets a,b] [--models a,b]
import argparse, json, math, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from grid import SETS, MODELS, BUDGETS, A_GENERATORS, EF_SWEEP, REFINE, HNSW_BUILD, builds, nlists, nprobes  # noqa: E402

ap = argparse.ArgumentParser()
for k in ('mode', 'machine', 'data', 'out'):
    ap.add_argument('--' + k, required=True)
ap.add_argument('--limit', type=int)
ap.add_argument('--families')
ap.add_argument('--shortlist')
ap.add_argument('--rounds', type=int, default=5)
ap.add_argument('--sets')
ap.add_argument('--models')
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)
fam_ok = None
if a.families and os.path.exists(a.families):
    fam_ok = {l.strip() for l in open(a.families) if l.strip()} | {'ours', 'ours_scan', 'ours_walk'}
FLOAT = {'faiss_hnsw_flat', 'faiss_hnsw_sq8', 'faiss_rabitq_flat', 'faiss_rabitq_ivf', 'faiss_rabitq_hnsw', 'faiss_ivfpq_fs'}
GRAPH_EF = {'faiss_hnsw_flat', 'faiss_hnsw_sq8', 'faiss_bin_hnsw', 'faiss_rabitq_hnsw', 'hnswlib_f32', 'usearch_f16',
            'usearch_i8', 'usearch_i8_rescore', 'usearch_b1_rescore'}
EFFORT_KEY = {'diskann_vamana': 'L', 'svs_vamana_f32': 'window', 'svs_vamana_lvq': 'window', 'svs_vamana_leanvec': 'window'}
skipped = set()


def present(s, m):
    return os.path.exists(os.path.join(a.data, 'emb', m, s, 'model.json'))


def k_v(s, m):
    st = json.load(open(os.path.join(a.data, 'sets', s, 'set.json')))
    kv = st.get('k_v')
    if isinstance(kv, dict):
        kv = kv.get(m)
    if not kv:
        sys.exit(f'{s}/{m}: no k_v in set.json (run kv.py on dev and record it before the dev sweep)')
    return int(kv) + (1 if st.get('self_match') else 0)


def ok(fam):
    if fam_ok is not None and fam not in fam_ok:
        skipped.add(fam)
        return False
    return True


def b_points(fam, bp, n, kv):
    """(B) search points of one build: the library's own effort and refine knobs."""
    if fam == 'faiss_exact':
        return [{}]
    if fam == 'faiss_bin_flat':
        return [dict(refine=kv * r) for r in REFINE]
    if fam == 'faiss_rabitq_flat':
        return [dict(refine=r) for r in REFINE]
    if fam in ('faiss_rabitq_ivf', 'faiss_ivfpq_fs'):
        # powers of two up to nlist/2, then nlist/2 and every list (S5b: the grid must reach the high fractions)
        probes = sorted(set(nprobes(bp['nlist'])) | {bp['nlist'] // 2, bp['nlist']})
        return [dict(nprobe=p, refine=r) for p in probes for r in (5, 20)]
    if fam == 'faiss_bin_hnsw':
        return [dict(ef=e, refine=kv * r) for e in EF_SWEEP for r in (5, 20)]
    if fam in ('faiss_hnsw_sq8', 'faiss_rabitq_hnsw'):
        return [dict(ef=e, refine=r) for e in EF_SWEEP for r in (2, 10)]
    if fam in ('usearch_i8_rescore', 'usearch_b1_rescore'):
        return [dict(ef=e, rescore=kv * r) for e in EF_SWEEP for r in (5, 20)]
    if fam in EFFORT_KEY:
        return [{EFFORT_KEY[fam]: e} for e in EF_SWEEP if e >= kv]
    if fam == 'scann':
        if bp.get('mode') != 'tree_ah':
            return [dict(reorder=kv * r) for r in (5, 20, 50)] if bp.get('mode') == 'ah' else [{}]
        return [dict(leaves_to_search=max(1, int(bp['leaves'] * f)), reorder=kv * r) for f in (0.01, 0.03, 0.1, 0.3, 0.5, 1.0) for r in (10, 50)]
    return [dict(ef=e) for e in EF_SWEEP if e >= kv]


def a_effort(gen, C, n, bp):
    """(A) the smallest effort that returns C candidates, and twice it (DESIGN.md 5.2)."""
    if gen in ('faiss_bin_flat', 'faiss_rabitq_flat', 'ours_scan'):
        return [{}]
    if gen in GRAPH_EF or gen == 'ours_walk':
        return [dict(ef=C), dict(ef=2 * C)]
    if gen in EFFORT_KEY:
        return [{EFFORT_KEY[gen]: C}, {EFFORT_KEY[gen]: 2 * C}]
    if gen == 'faiss_rabitq_ivf':  # lists of n/nlist vectors on average; 3x margin for uneven lists
        p = min(bp['nlist'], max(1, math.ceil(3 * C * bp['nlist'] / n)))
        return [dict(nprobe=p), dict(nprobe=min(bp['nlist'], 2 * p))]
    if gen == 'scann':
        if bp.get('mode') != 'tree_ah':
            return [dict(reorder=C)]
        p = min(bp['leaves'], max(1, math.ceil(3 * C * bp['leaves'] / n)))
        return [dict(leaves_to_search=p, reorder=C), dict(leaves_to_search=min(bp['leaves'], 2 * p), reorder=C)]
    raise KeyError(gen)


def a_build(gen, s, m):
    """The build an (A) generator uses: the plan's mid build (M 32, efC 800 / R 64 L 200 / sqrt(n) lists)."""
    n = SETS[s][0]
    if gen in ('faiss_bin_flat', 'faiss_rabitq_flat'):
        return {}
    if gen == 'faiss_rabitq_ivf':
        return dict(nlist=nlists(n)[0])
    if gen == 'diskann_vamana':
        return dict(R=64, L=200, alpha=1.2)
    if gen == 'scann':
        if n < 20000:
            return dict(mode='brute')
        if n < 100000:
            return dict(mode='ah')
        return dict(mode='tree_ah', leaves=int(math.sqrt(n)), soar=0)
    return dict(M=32, efC=800)


def job(s, m, split, comp, system, rnd, **kw):
    j = dict(set=s, model=m, split=split, comparison=comp, system=system, round=rnd, kind=kw.pop('kind', 'timing'), build_seed=42)
    if a.limit:
        j['options'] = dict(limit=a.limit)
    j.update(kw)
    return j


def write(name, step, bl, jobs):
    json.dump(dict(step=step, builds=bl, jobs=jobs), open(os.path.join(a.out, name + '.json'), 'w'), indent=0)


sets = a.sets.split(',') if a.sets else list(SETS)
models = a.models.split(',') if a.models else MODELS
pairs = [(s, m) for s in sets for m in models if present(s, m)]
if a.mode == 'smoke':
    pairs = [(s, m) for s, m in pairs if s == 'gcsn'][:1]
    a.limit = a.limit or 50
for s, m in pairs:
    n = SETS[s][0]
    tag = f'{s}--{m}'
    if a.mode in ('build', 'dev', 'smoke'):
        bl = [dict(set=s, model=m, family=f, build_params=bp, build_seed=42) for f, bp in builds(s, a.machine)
              if f != 'ours' and ok(f)]
        if a.mode == 'smoke':  # one build per family
            seen, small = set(), []
            for b in bl:
                if b['family'] not in seen:
                    seen.add(b['family']); small.append(b)
            bl = small
        for g in A_GENERATORS:  # the (A) builds, which the (B) list may not hold
            if g.startswith('ours') or not ok(g):
                continue
            ab = dict(set=s, model=m, family=g, build_params=a_build(g, s, m), build_seed=42)
            if ab not in bl:
                bl.append(ab)
        if a.mode == 'build':  # our index too: the build plans hold no ours jobs that would ask for it
            write(tag, f'build-{tag}', [dict(set=s, model=m, family='ours', build_seed=42)] + bl, [])
            continue
        kv = k_v(s, m)
        jobs = []
        for b in bl:
            pts = b_points(b['family'], b['build_params'], n, kv)
            for sp in (pts[:1] if a.mode == 'smoke' else pts):
                jobs.append(job(s, m, 'dev', 'B', b['family'], 0, family=b['family'], build_params=b['build_params'], search=sp, kv=kv))
        jobs.append(job(s, m, 'dev', 'B', 'ours_cascade', 0, kv=kv))
        for S1 in ([400] if a.mode == 'smoke' else [50, 100, 150, 200, 300, 400, 600, 1000]):
            if S1 != 400:
                jobs.append(job(s, m, 'dev', 'B', 'ours_cascade', 0, kv=kv, S1=S1, EF=max(S1, 50)))
        budgets = BUDGETS[:1] if a.mode == 'smoke' else BUDGETS
        for g in A_GENERATORS:
            if not ok(g):
                continue
            bp = a_build(g, s, m)
            for C, H in budgets:
                for eff in a_effort(g, C, n, bp):
                    if g.startswith('ours'):
                        jobs.append(job(s, m, 'dev', 'A', g, 0, gen=g[5:], C=C, H=H, **({'ef': eff['ef']} if 'ef' in eff else {})))
                    else:
                        jobs.append(job(s, m, 'dev', 'A', g, 0, family=g, build_params=bp, search=eff, C=C, H=H))
        write(tag, f'{a.mode}-{tag}', [] if a.mode == 'dev' else bl, jobs)
    elif a.mode == 'aa':
        kv = k_v(s, m)
        jobs = [job(s, m, 'dev', 'B', 'ours_cascade', r, kv=kv, options=dict(arm=arm)) for r in range(5) for arm in ('a1', 'a2')]
        write(tag, f'aa-{tag}', [], jobs)
    elif a.mode == 'heldout':
        if not a.shortlist:
            sys.exit('--mode heldout needs --shortlist (frozen at S7)')
        sl = json.load(open(a.shortlist)).get(s, {}).get(m)
        if not sl:
            continue
        kv = sl['k_v']
        jobs = []
        for r in range(a.rounds):
            for p in sl['points']:  # {"system", "family"?, "build_params"?, "search"?, ours knobs?}
                jobs.append(job(s, m, 'ho', 'B', p['system'], r, kv=kv, **{k: v for k, v in p.items() if k != 'system'}))
            for p in sl['A']:
                jobs.append(job(s, m, 'ho', 'A', p['system'], r, **{k: v for k, v in p.items() if k != 'system'}))
        for p in sl['points']:
            jobs.append(job(s, m, 'ho', 'B', p['system'], 0, kind='cold', kv=kv, **{k: v for k, v in p.items() if k != 'system'}))
        write(tag, f'heldout-{tag}', [], jobs)
    else:
        sys.exit(f'unknown mode {a.mode}')
if skipped:
    print('left out (not built on this machine):', ' '.join(sorted(skipped)))
print(f'{a.mode}: {len(pairs)} plan files in {a.out}')
