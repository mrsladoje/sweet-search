# S6 / S8 plans for the secondary platforms (box, Mac; owner 10-16: reduced grid): from one AWS type's
# shortlist, the operating points of comparison (B) of the systems this machine can run, for one model per
# set kind (CodeRankEmbed for code sets, bge-base-en-v1.5 for BEIR), comparison (A) at one budget (C 400, H 100),
# plus the A/A jobs (R) on dev.
# Also prints the builds the plans need (to copy them to the machine first).
#   python make_local_plans.py --shortlist shortlist-arm.json --families families-mac.txt --machine mac
#          --split dev|ho [--rounds 5] [--out plans/local-mac]
import argparse, json, os, sys

ap = argparse.ArgumentParser()
ap.add_argument('--shortlist', required=True); ap.add_argument('--families', required=True); ap.add_argument('--machine', required=True)
ap.add_argument('--split', default='dev'); ap.add_argument('--rounds', type=int, default=5); ap.add_argument('--out')
a = ap.parse_args()
fam_ok = {l.strip() for l in open(a.families) if l.strip()} | {'ours_cascade'}
sl = json.load(open(a.shortlist))
MODEL = {'code': 'CodeRankEmbed', 'beir': 'bge-base-en-v1.5'}
out = a.out or os.path.join(os.path.dirname(os.path.abspath(__file__)), 'plans', f'local-{a.machine}')
mode = 'dev' if a.split == 'dev' else 'heldout'
os.makedirs(os.path.join(out, mode), exist_ok=True)
if mode == 'dev':
    os.makedirs(os.path.join(out, 'aa'), exist_ok=True)
need = []
for s, per in sl.items():
    if s == 'meta':
        continue
    kind = 'beir' if s in ('quora', 'fiqa') else 'code'
    m = MODEL[kind]
    if m not in per:
        continue
    e = per[m]
    base = dict(set=s, model=m, split=a.split, build_seed=42)
    jobs = []
    rounds = 1 if mode == 'dev' else a.rounds
    for p in e['points']:
        fam = p.get('family', p['system'])
        if p['system'] not in fam_ok and fam not in fam_ok:
            continue
        for r in range(rounds):
            jobs.append(dict(base, comparison='B', round=r, kind='timing', kv=e['k_v'], **p))
        if p['system'] != 'ours_cascade':
            need.append(dict(set=s, model=m, family=p['family'], build_params=p['build_params'], build_seed=42))
    # (A), reduced: one budget (C 400, H 100) for every generator this machine runs, at its declared efforts
    for p in e['A']:
        g = p.get('family', p['system'])
        if p.get('C') == 400 and p.get('H') == 100 and (p['system'] in fam_ok or g in fam_ok or p['system'].startswith('ours')):
            for r in range(rounds):
                jobs.append(dict(base, comparison='A', round=r, kind='timing', **p))
            if not p['system'].startswith('ours') and 'build_params' in p:
                need.append(dict(set=s, model=m, family=p['family'], build_params=p['build_params'], build_seed=42))
    if mode == 'heldout':
        for p in e['points']:
            if p['system'] in fam_ok or p.get('family') in fam_ok:
                jobs.append(dict(base, comparison='B', round=0, kind='cold', kv=e['k_v'], **p))
    json.dump(dict(step=f'{mode}-{a.machine}-{s}--{m}', builds=[], jobs=jobs), open(os.path.join(out, mode, f'{s}--{m}.json'), 'w'), indent=0)
    if mode == 'dev':
        aa = [dict(base, comparison='B', system='ours_cascade', round=r, kind='timing', kv=e['k_v'], options=dict(arm=arm))
              for r in range(5) for arm in ('a1', 'a2')]
        json.dump(dict(step=f'aa-{a.machine}-{s}--{m}', builds=[], jobs=aa), open(os.path.join(out, 'aa', f'{s}--{m}.json'), 'w'), indent=0)
    print(f'{s}/{m}: {len(jobs)} jobs', file=sys.stderr)
uniq = {json.dumps(b, sort_keys=True): b for b in need}
json.dump(list(uniq.values()), open(os.path.join(out, f'builds-{a.split}.json'), 'w'), indent=0)
print(f'{len(uniq)} rival builds needed -> {out}/builds-{a.split}.json', file=sys.stderr)
