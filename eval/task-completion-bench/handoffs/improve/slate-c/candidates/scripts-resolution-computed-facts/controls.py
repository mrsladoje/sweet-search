import json, sys, re, os, collections
sys.path.insert(0, '/tmp/wf-slatec/resolution-computed-facts')
import census_edited_functions as C, coherence_face as F
R = C.R
# --- dashbitco positive control for the coherence face
root = '/root/.ss-eval/golden/dashbitco__nimble_options@5270554b86676476b3e63d91f54c0d340a67102c'
files = C.repo_files(root)
print('dashbitco golden files:', len(files))
for run in ('sb-opencode-20260811', 'sb-codex-20260811', 'sb-claudecode-20260811'):
    rows = json.load(open(f'{R}/{run}/rows.json')); rows = rows if isinstance(rows, list) else rows.get('rows', rows)
    rmap = {((r.get('taskId') or r.get('instance_id')), r['arm'], int(r.get('rep', 0))): r for r in rows}
    for arm in ('sweet', 'native'):
        for rep, pf in ((0, f'{R}/{run}/{arm}/patches.json'), (1, f'{R}/{run}/{arm}/rep-1/patches.json')):
            if not os.path.exists(pf): continue
            for e in json.load(open(pf)):
                if 'nimble' not in e['instance_id']: continue
                facts = F.run_patch(root, e['patch'], 'ex', files)
                res = rmap.get((e['instance_id'], arm, rep), {}).get('resolved')
                cl = [(c['literal'], c['siblings'], c['declaration'], c['consumers']) for c in facts['closure']]
                added = [l for _, l in F.added_lines(e['patch'])]
                touches_decl = any('@basic_types' in l for l in added)
                print(f"{run[3:11]:9s} {arm:6s} r{rep} resolved={res!s:5s} patchTouches@basic_types={touches_decl!s:5s} closure={cl[:2]}")
# --- awslabs observation-site rendering restricted to expect(...) arguments
root2 = [l.split('\t') for l in open('/tmp/wf-slatec/resolution-computed-facts/tasks-safe.tsv')]
tasks = json.load(open(f'{R}/fp-codex-tab-20260826/sweet/tasks.json'))
t = [x for x in tasks if x['instance_id'].startswith('awslabs')][0]
groot = f"{C.GOLD}/{t['repo'].replace('/', '__')}@{t['base_commit']}"
acc = collections.Counter(); n = 0
for p in C.repo_files(groot):
    rel = os.path.relpath(p, groot)
    if not C.TEST_MARK.search(rel): continue
    lines = C.read_src(p).split('\n')
    for i, l in enumerate(lines):
        if re.search(r'\.putDimensions\s*\(', l):
            n += 1
            win = '\n'.join(lines[i:i + 10])
            for m in re.finditer(r'expect\(\s*([\w.]+)\.(\w+)\s*\(', win):
                acc[m.group(2)] += 1
print('awslabs: test call sites of putDimensions =', n, '; accessor inside expect(...) after the call:', acc.most_common(5))
# --- b2 Jam indirect dispatch check
b2 = '/root/.ss-eval/golden/bfgroup__b2@7cf7bdabb3' 
b2 = [d for d in os.listdir(C.GOLD) if d.startswith('bfgroup__b2@7cf7bdab')][0]
b2 = f'{C.GOLD}/{b2}'
for pat, f in (('indirect.call', 'src/build/property.jam'), ('indirect.make', 'src/build/configure.jam'), ('rule check ', 'src/build/configure.jam'), ('check-target-builds', 'src/build/configure.jam')):
    src = C.read_src(f'{b2}/{f}').split('\n')
    hits = [(i + 1, l.strip()[:110]) for i, l in enumerate(src) if pat in l]
    print(f'b2 {f} {pat!r}:', hits[:4])
