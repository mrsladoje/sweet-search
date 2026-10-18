# Post-freeze experiments (plans/p-*; make_post_plans.py) -> post.json + POST-RESULTS.md. Reported apart from the
# pre-registered results. No selection: every planned point is reported.
#  PA  per CPU type, set, generator configuration: median over rounds of the per-round median of each stage
#      (conv, gen, shared = screen + rescoring), the total, and retained quality (round 0 lists)
#  PB  per CPU type, set, model: our frozen point vs the dev-fastest rival (median ratio, bootstrap over rounds),
#      slow rounds (> 3x the fastest round) with the major page faults of the timed pass, the native share of our
#      time (kind native), and our shipped default (S1 = EF = 400)
#   python post_analyze.py --data DATA --results RESULTS --out-json post.json --out-md POST-RESULTS.md
import argparse, collections, glob, json, os, statistics as st, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import quality as Q  # noqa: E402
from paperlib import ratio_ci  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--data', required=True); ap.add_argument('--results', required=True)
ap.add_argument('--out-json', required=True); ap.add_argument('--out-md', required=True)
a = ap.parse_args()


def conf(r):
    k = r['key']; o = k.get('options') or {}
    return json.dumps(dict(system=r['system'], build=k.get('build_params'), search=k.get('search'), ef=k.get('ef'), gen=k.get('gen'),
                           S1=k.get('S1'), EF=k.get('EF'), env=o.get('env'), kind=k.get('kind')), sort_keys=True)


def faults(r):
    m = r.get('memory') or {}
    try:
        return int(m['after']['majflt']) - int(m['loaded']['majflt'])
    except Exception:
        return None


recs = collections.defaultdict(list)
for md in glob.glob(os.path.join(a.results, 'hp-*')):
    t = os.path.basename(md).split('-')[1]
    for fn in glob.glob(os.path.join(md, '*', '*', '*.json')):
        if fn.endswith('.key.json'):
            continue
        try:
            r = json.load(open(fn))
        except Exception:
            continue
        if r.get('complete') and r.get('split') == 'ho':
            recs[(t, r['comparison'], r['set'], r['model'], conf(r))].append((r['round'], fn, r))
print(f'{sum(len(v) for v in recs.values())} records, {len(recs)} points', file=sys.stderr)

qx_cache, qual_cache = {}, {}


def share(s, m, fn):
    if (s, m) not in qx_cache:
        S = Q.load_set(a.data, s); qidx = Q.split_index(S, 'ho')
        qx_cache[(s, m)] = (S, qidx, Q.exact_quality(S, a.data, m, 'ho'))
    S, qidx, qx = qx_cache[(s, m)]
    if fn not in qual_cache:
        rec, v, sc = Q.read_record(fn)
        if rec['n_queries'] != len(qidx):  # a partial record (test runs with --limit)
            return float('nan')
        qual_cache[fn] = float(Q.eval_lists_fast(S, qidx, v, sc)['q'].mean() / qx.mean())
    return qual_cache[fn]


PA, PB = [], []
for (t, comp, s, m, c), rs in sorted(recs.items()):
    rs.sort(key=lambda x: x[0]); cd = json.loads(c)
    meds = [float(np.median(r['timings_ns'])) / 1e3 for _, _, r in rs]
    row = dict(type=t, set=s, model=m, conf=cd, rounds=len(rs), us=float(np.median(meds)), round_us=meds,
               faults=[faults(r) for _, _, r in rs])
    if comp == 'A':
        sg = [r.get('stage_ns') or {} for _, _, r in rs]
        for k in ('conv', 'gen', 'screen', 'rescore', 'rest'):
            v = [float(np.median(x[k])) / 1e3 for x in sg if k in x]
            if v:
                row[k] = float(np.median(v))
        if 'rest' not in row and 'screen' in row:
            row['rest'] = row['screen'] + row['rescore']
        row['share'] = share(s, m, rs[0][1])
        PA.append(row)
    else:
        if cd['kind'] == 'native':
            row['native_share'] = float(np.median([np.sum(r['native_ns']) / np.sum(r['timings_ns']) for _, _, r in rs if r.get('native_ns')]))
        else:
            row['share'] = share(s, m, rs[0][1])
        lo = min(meds); row['slow'] = sum(1 for x in meds if x > 3 * lo)
        PB.append(row)
json.dump(dict(PA=PA, PB=PB), open(a.out_json, 'w'), indent=0)

# ---- markdown
out = ['# Post-freeze experiments (held-out queries; reported apart from the pre-registered results)', '']
out += ['## (A) stage clocks, C 400 / H 100', '', '| CPU | Set | Generator | Build | Effort | Env | Rounds | conv µs | gen µs | shared µs | total µs | Retained |',
        '|---|---|---|---|---|---|---:|---:|---:|---:|---:|---:|']
for r in PA:
    c = r['conf']
    eff = c['search'] or ({'ef': c['ef']} if c['ef'] else {})
    out.append(f"| {r['type']} | {r['set']} | {c['system']} | {c['build'] or ''} | {eff} | {'fixed' if c['env'] else ''} | {r['rounds']} | "
               f"{r.get('conv', float('nan')):.1f} | {r.get('gen', float('nan')):.1f} | {r.get('rest', float('nan')):.1f} | {r['us']:.1f} | {r['share']:.4f} |")
out += ['', '## (B) Quora and csn1m, f = 0.99', '', '| CPU | Set | Model | System | Kind | S1 | Rounds | µs | Slow rounds | Faults per round | Retained / native share |',
        '|---|---|---|---|---|---:|---:|---:|---:|---|---:|']
for r in PB:
    c = r['conf']
    out.append(f"| {r['type']} | {r['set']} | {r['model']} | {c['system']} | {c['kind']} | {c['S1'] or ''} | {r['rounds']} | {r['us']:.1f} | {r['slow']} | "
               f"{r['faults']} | {r.get('share', r.get('native_share', float('nan'))):.4f} |")
open(a.out_md, 'w').write('\n'.join(out) + '\n')
print(f'wrote {a.out_md}: {len(PA)} A points, {len(PB)} B points', file=sys.stderr)
