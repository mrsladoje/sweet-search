# Recompute the memory column of an analysis JSON (comparison B rows) with analyze.py's mem_kb rule, from the
# result headers only (no lists, no bootstrap). For JSON files written before the mem_kb fix (Linux records keep
# smaps_rollup 'Rss', not 'rss_kb'; macOS rivals now use the physical footprint).
#   python mem_patch.py --results RESULTS --json J.json [--json J2.json ...]
import argparse, collections, glob, json, os, statistics as st

FIELDS = ('family', 'build_params', 'search', 'gen', 'C', 'H', 'ef', 'S1', 'EF')
ap = argparse.ArgumentParser(); ap.add_argument('--results', required=True); ap.add_argument('--json', action='append', required=True)
a = ap.parse_args()


def mtype(name):
    if name.startswith(('ho-', 'hr-')):
        return name.split('-')[1]
    return {'box': 'box', 'mac': 'mac', 'mac-local': 'mac'}.get(name)


def pkey(system, d):
    return json.dumps({'system': system, **{f: d[f] for f in FIELDS if f in d and d[f] is not None}}, sort_keys=True)


def mem_kb(r):
    m = (r.get('memory') or {}).get('after') or {}
    for k in ('phys_footprint_kb', 'Rss', 'rss_kb'):
        if m.get(k) not in (None, ''):
            return int(m[k])
    return None


mem = collections.defaultdict(list)
for md in glob.glob(os.path.join(a.results, '*')):
    t = mtype(os.path.basename(md))
    if not t:
        continue
    for f in glob.glob(os.path.join(md, '*', '*', '*.json')):
        if f.endswith('.key.json'):
            continue
        try:
            r = json.load(open(f))
        except Exception:
            continue
        if not r.get('complete') or r.get('split') != 'ho' or 'key' not in r or r['key'].get('kind') != 'timing' or r['comparison'] != 'B':
            continue
        d = dict(r.get('params') or {}); d.update(r['key'])
        x = mem_kb(r)
        if x:
            mem[(t, r['set'], r['model'], pkey(r['system'], d))].append(x)
for jf in a.json:
    J = json.load(open(jf)); n = 0
    for row in J['B']:
        v = mem.get((row['type'], row['set'], row['model'], pkey(row['point']['system'], row['point'])))
        row['rss_mb'] = st.median(v) / 1024 if v else None; n += bool(v)
    json.dump(J, open(jf, 'w'), indent=0, default=float)
    print(f'{jf}: memory set on {n} of {len(J["B"])} B rows')
