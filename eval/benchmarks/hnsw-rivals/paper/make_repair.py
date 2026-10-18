# Repair plans (S5b): the planned jobs of one CPU type that have no complete record on any machine of that
# type (a failed or skipped job, a plan cut by a restart). A job is matched to a record by (set, model, split,
# comparison, round, kind, A/A arm, point), the point as in dev_select.py (system + family, build_params,
# search, gen, C, H, ef, S1, EF; our records written before those knobs were in the job key carry them in
# params). Writes plans/r-<type>/<mode>/<set>--<model>.json with the missing jobs only.
#   python make_repair.py --results RESULTS --type intel [--machines 'dev-intel-*'] [--modes dev,aa] [--out plans]
import argparse, fnmatch, glob, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
POINT_FIELDS = ('family', 'build_params', 'search', 'gen', 'C', 'H', 'ef', 'S1', 'EF')

ap = argparse.ArgumentParser()
ap.add_argument('--results', required=True); ap.add_argument('--type', required=True); ap.add_argument('--machines')
ap.add_argument('--modes', default='dev,aa'); ap.add_argument('--out', default=os.path.join(HERE, 'plans'))
ap.add_argument('--src', help="plan folder prefix (default q-<type>; h-<type> for held-out)"); ap.add_argument('--prefix', default='r')
a = ap.parse_args()


def base(set_, model, split, comp, rnd, kind, arm, system):
    return json.dumps([set_, model, split, comp, rnd, kind, arm, system])


def rec_point(r):
    k, p = r['key'], dict(r.get('params') or {})
    return {f: k.get(f, p.get(f)) for f in POINT_FIELDS if k.get(f, p.get(f)) is not None}


have = {}  # base -> list of record points; a job matches a record whose values equal every point field of the job
pat = a.machines or f'dev-{a.type}-*'
n_rec = 0
for md in glob.glob(os.path.join(a.results, '*')):
    if not fnmatch.fnmatch(os.path.basename(md), pat):
        continue
    for f in glob.glob(os.path.join(md, '*', '*', '*.json')):
        try:
            r = json.load(open(f))
        except Exception:
            continue
        if r.get('complete') and 'key' in r and len(r.get('timings_ns') or []) == r.get('n_queries'):
            k = r['key']
            have.setdefault(base(r['set'], r['model'], r['split'], r['comparison'], r['round'], k.get('kind', 'timing'),
                                 (k.get('options') or {}).get('arm'), r['system']), []).append(rec_point(r))
            n_rec += 1


def done(j):
    b = base(j['set'], j['model'], j['split'], j['comparison'], j['round'], j.get('kind', 'timing'),
             (j.get('options') or {}).get('arm'), j['system'])
    want = {f: j[f] for f in POINT_FIELDS if f in j}
    return any(all(rp.get(f) == v for f, v in want.items()) for rp in have.get(b, []))


tot = miss = 0
for mode in a.modes.split(','):
    out = os.path.join(a.out, f'{a.prefix}-{a.type}', mode); os.makedirs(out, exist_ok=True)
    groups = {}
    for p in sorted(glob.glob(os.path.join(HERE, 'plans', a.src or f'q-{a.type}', mode, '*.json'))):
        for j in json.load(open(p))['jobs']:
            tot += 1
            if not done(j):
                groups.setdefault(f"{j['set']}--{j['model']}", []).append(j)
    for tag, js in sorted(groups.items()):
        json.dump(dict(step=f'repair-{mode}-{tag}', builds=[], jobs=js), open(os.path.join(out, tag + '.json'), 'w'), indent=0)
        miss += len(js)
        print(f'{mode} {tag}: {len(js)} missing')
print(f'{a.type}: {miss} of {tot} planned jobs have no complete record ({n_rec} records)', file=sys.stderr)
