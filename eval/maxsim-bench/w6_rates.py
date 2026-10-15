# python3 w6_rates.py <results/MACHINE> [<results/MACHINE> ...] --out w6-rates.json
#
# The W6 open-loop rates for FREEZE.json (freeze_check.py --w6-rates), from the dev
# design-mode runs (groups dev-conc-<set>): per machine type and workload family, 25 / 50 /
# 75 % of the closed-loop saturation throughput (the largest over callers and executors) of
# the SLOWEST rival arm measured there. Our arms (ours*, node:*) are never read, so the
# rates do not depend on our kernel: a kernel change after S5 does not change them.
import argparse, glob, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import results_lib as rl  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument('machine_dir', nargs='+')
p.add_argument('--out', required=True)
a = p.parse_args()
out, src = {}, {}
for md in a.machine_dir:
    mtype = re.sub(r'^(intel|amd|arm)-\d+$', r'\1', os.path.basename(md.rstrip('/')))
    for f in sorted(glob.glob(os.path.join(md, 'dev-conc-*', '*', '*.conc.json'))):
        d = json.load(open(f))
        arm = d['arm']
        if arm.startswith(('ours', 'node:')) or not d.get('complete'):
            continue
        fam = rl.family(d['set'])
        sat = max(r['throughput'] for r in d['runs'] if r['type'] == 'closed')
        cur = src.setdefault(mtype, {}).get(fam)
        if cur is None or sat < cur[1]:
            src[mtype][fam] = (arm, sat)
for mtype, fams in src.items():
    out[mtype] = {fam: [round(x * sat, 3) for x in (0.25, 0.5, 0.75)] for fam, (arm, sat) in fams.items()}
json.dump(dict(rates=out, slowest={m: {f: dict(arm=x[0], saturation_per_s=x[1]) for f, x in v.items()} for m, v in src.items()},
               rule='per machine type and family: 25/50/75 % of the closed-loop saturation throughput of the slowest rival arm (dev design runs; ours and node arms excluded)'),
          open(a.out, 'w'), indent=1)
print(json.dumps(out))
