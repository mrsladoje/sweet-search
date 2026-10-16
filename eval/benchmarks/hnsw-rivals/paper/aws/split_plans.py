# Spreads the plan files of one mode over several machines of one CPU type (one benchmark per machine, PAPER_PLAN
# rule 5): plan.py writes one file per (set, model); this script assigns whole files to machines <type>-0 .. <type>-(k-1)
# by longest-processing-time first, with the hours per (set, model) from WORKLOAD.md (dev or held-out column), ties by
# name. Output: plans/<type>-<i>/<mode>/*.json (run.sh reads plans/$MACHINE/<mode> first) and a summary per machine.
# usage: python split_plans.py --mode dev --type intel --k 6 --data DATA [--families F] [--out PLANS_ROOT]
import argparse, glob, json, os, re, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__)); PAPER = os.path.dirname(HERE)
ap = argparse.ArgumentParser()
ap.add_argument('--mode', required=True); ap.add_argument('--type', required=True); ap.add_argument('--k', type=int, required=True)
ap.add_argument('--data', required=True); ap.add_argument('--families'); ap.add_argument('--out', default=os.path.join(PAPER, 'plans'))
ap.add_argument('--extra', nargs=argparse.REMAINDER, default=[], help='further plan.py arguments')
a = ap.parse_args()

col = 'Held-out h / machine' if a.mode == 'heldout' else 'Dev h / machine'
rows = [l for l in open(os.path.join(PAPER, 'WORKLOAD.md')) if l.startswith('| ')]
head = [c.strip() for c in rows[0].strip('|\n').split('|')]
hours = {}
for l in rows[1:]:
    c = [x.strip() for x in l.strip('|\n').split('|')]
    if len(c) == len(head) and c[0] and not c[0].startswith('**'):
        hours[(c[0], c[1])] = float(c[head.index(col)])

tmp = tempfile.mkdtemp()
cmd = [sys.executable, os.path.join(PAPER, 'plan.py'), '--mode', a.mode, '--machine', a.type, '--data', a.data, '--out', tmp]
if a.families:
    cmd += ['--families', a.families]
subprocess.run(cmd + a.extra, check=True)
files = sorted(glob.glob(os.path.join(tmp, '*.json')))
def key(p):
    s, m = os.path.basename(p)[:-5].split('--')
    return (s, m)
missing = [key(p) for p in files if key(p) not in hours]
if missing:
    sys.exit(f'no hours in WORKLOAD.md for {missing}')
files.sort(key=lambda p: (-hours[key(p)], os.path.basename(p)))
load = [0.0] * a.k; asg = [[] for _ in range(a.k)]
for p in files:
    i = min(range(a.k), key=lambda j: (load[j], j))
    asg[i].append(p); load[i] += hours[key(p)]
for i in range(a.k):
    d = os.path.join(a.out, f'{a.type}-{i}', a.mode)
    shutil.rmtree(d, ignore_errors=True); os.makedirs(d)
    for p in asg[i]:
        shutil.copy(p, d)
    print(f"{a.type}-{i}: {load[i]:.1f} h  {' '.join(os.path.basename(p)[:-5] for p in asg[i])}")
shutil.rmtree(tmp)
