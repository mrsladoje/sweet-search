import json, re, sys
sys.path.insert(0, '/tmp/wf-slatec/resolution-computed-facts')
import census_edited_functions as C
R = C.R
for task, rel_hint in [('final-form__final-form-64', None), ('apigee__registry-961', None), ('celestiaorg__nmt-192', None)]:
    ps = [p for p in json.load(open(f'{R}/fp-codex-tab-20260826/native/patches.json')) if p['instance_id'] == task]
    patch = ps[0]['patch']
    touched = C.parse_diff(patch)
    tasks = json.load(open(f'{R}/fp-codex-tab-20260826/sweet/tasks.json'))
    t = [x for x in tasks if x['instance_id'] == task][0]
    root = f"{C.GOLD}/{t['repo'].replace('/', '__')}@{t['base_commit']}"
    for rel, lns in touched.items():
        p = f'{root}/{rel}'
        lang = C.lang_of(rel)
        try: lines = open(p, encoding='utf-8', errors='replace').read().split('\n')
        except Exception as e: print(task, rel, 'ERR', e); continue
        fns = C.functions_in_file(lines, lang)
        print(task, rel, lang, 'touched', sorted(lns)[:6], 'fns', len(fns))
        for ln in sorted(lns)[:2]:
            print('   line', ln, ':', lines[ln-1][:100])
        near = [f for f in fns if abs(f[2] - min(lns)) < 400]
        print('   near fns:', [(f[0], f[2]+1, f[3]+1) for f in near[:8]])
        # show candidate header lines above the first touched line
        i = min(lns) - 1
        while i > 0 and not re.match(r'^\s*(export |func |public |private |def |[A-Za-z_$][\w$]*\s*\()', lines[i]): i -= 1
        print('   nearest header-ish line', i+1, ':', lines[i][:120])
