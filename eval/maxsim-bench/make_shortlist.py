# python3 make_shortlist.py <results/MACHINE> [--out shortlist-MACHINE.json]
#
# The rival shortlist of one machine, from its dev warm results only (tag dev-warm):
# per workload family (agent, gcsn, sweep) x library x input type, the two fastest
# configurations (total of per-call medians over the family's dev calls) and the
# fastest single-thread one. "beir" has no dev data; it takes the configurations
# ranked on the 32-query-token sweep cells, the shape of the BEIR queries. Frozen at S7.
import argparse, json, os, re, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import results_lib as rl  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument('machine_dir')
p.add_argument('--out')
a = p.parse_args()
machine = os.path.basename(a.machine_dir.rstrip('/'))
warm = rl.load_tag(os.path.join(a.machine_dir, 'dev-warm'))
if not warm:
    sys.exit('no dev-warm results')
for arm in warm:
    for k in warm[arm]['rows']:
        if not k[0].endswith('-dev') and rl.family(k[0]) != 'sweep':
            sys.exit(f'refusing: {k[0]} is not a dev set')


def to_spec(f):
    base, t, env = rl.arm_base(f)
    return base + (f'@{t}' if t else '') + (f'%{env}' if env else '')


def rank(keys_of):
    fams = {}
    for fam, keys in keys_of.items():
        by = {}
        for arm, d in warm.items():
            lib = rl.library(arm)
            if not lib or not keys or not all(k in d['rows'] for k in keys):
                continue
            by.setdefault(lib, {}).setdefault(rl.input_type(arm, d['precision']), []).append((sum(d['rows'][k]['ms'] for k in keys), arm))
        fams[fam] = {}
        for lib, types in by.items():
            fams[fam][lib] = {}
            for it, c in types.items():
                c.sort()
                singles = [x for x in c if rl.arm_base(x[1])[1] == 1]
                fams[fam][lib][it] = dict(primary=to_spec(c[0][1]), also=[to_spec(x[1]) for x in c[1:2]],
                                          single=to_spec(singles[0][1]) if singles else None,
                                          total_ms={to_spec(x[1]): round(x[0], 3) for x in c})
    return fams


keys = {}
for k in warm['ours']['rows']:
    keys.setdefault(rl.family(k[0]), []).append(k)
keys['beir'] = [k for k in keys.get('sweep', []) if k[0].startswith('q32-')]
out = dict(machine=machine, made=time.strftime('%Y-%m-%dT%H:%M:%S'), source='dev-warm', families=rank(keys),
           rule='per family x library x input type: two fastest by total of per-call medians, plus the fastest one-thread configuration; beir = 32-query-token sweep cells')
dest = a.out or os.path.join(os.path.dirname(os.path.abspath(__file__)), f'shortlist-{machine}.json')
json.dump(out, open(dest, 'w'), indent=1)
print(f'{dest}: ' + ', '.join(f'{f}: {len(v)} libraries' for f, v in out['families'].items()))
