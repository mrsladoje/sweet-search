#!/usr/bin/env python3
"""harness_prompt_check.py -- do the harness prompts mandate the plan tool? Read-only.
codex: developer/system messages in the rollout jsonl. opencode: sqlite db message/part rows or
generated config. claude-code: system prompt is not stored in the transcript (reported as absent)."""
import json, os, re, sys, glob, sqlite3
R = '/root/sweet-search-private/eval/task-completion-bench/results'
cell = R + '/fp-codex-tab-20260826/agent-state/absinthe-graphql__absinthe-998-native/codex-home/sessions'
f = sorted(glob.glob(cell + '/**/rollout-*.jsonl', recursive=True))[0]
print('== codex developer/system messages (first native rollout):', f.split('/')[-1])
for l in open(f):
    l = l.strip()
    if not l:
        continue
    d = json.loads(l); p = d.get('payload') or {}
    if d.get('type') == 'response_item' and p.get('type') == 'message' and p.get('role') in ('developer', 'system'):
        txt = '\n'.join(c.get('text', '') for c in p.get('content', []))
        print('ROLE', p.get('role'), 'chars', len(txt))
        for m in re.finditer(r'[^\n]*(?:update_plan|plan)[^\n]*', txt):
            print('   ', m.group(0)[:260])
    if d.get('type') == 'session_meta':
        print('session_meta keys:', sorted(p.keys()))
        ins = p.get('base_instructions') or p.get('instructions') or ''
        if ins:
            print('base_instructions chars', len(str(ins)))
            for m in re.finditer(r'[^\n]*(?:update_plan|plan)[^\n]*', str(ins)):
                print('   [base]', m.group(0)[:260])
# also: is there a tools list with update_plan description anywhere in the jsonl?
s = open(f).read()
for m in re.finditer(r'.{0,120}update_plan.{0,200}', s):
    t = m.group(0)
    if 'function_call' in t:
        continue
    print('   [raw]', t[:320].replace('\\n', ' '))
    break
print()
print('== opencode: sqlite db')
db = R + '/fp-opencode-tab-20260826/agent-state/absinthe-graphql__absinthe-998-native/opencode-data/opencode.db'
try:
    con = sqlite3.connect('file:' + db + '?mode=ro', uri=True)
    cur = con.cursor()
    tabs = [r[0] for r in cur.execute("select name from sqlite_master where type='table'")]
    print('tables:', tabs)
    for t in tabs:
        cols = [c[1] for c in cur.execute('pragma table_info(%s)' % t)]
        n = cur.execute('select count(*) from %s' % t).fetchone()[0]
        print('  ', t, n, cols)
    hits = 0
    for t in tabs:
        cols = [c[1] for c in cur.execute('pragma table_info(%s)' % t)]
        for c in cols:
            try:
                for row in cur.execute("select %s from %s where %s like '%%todowrite%%' limit 3" % (c, t, c)):
                    v = str(row[0])
                    for m in re.finditer(r'.{0,160}todowrite.{0,200}', v, re.I):
                        print('   [%s.%s]' % (t, c), m.group(0)[:360].replace('\n', ' '))
                        hits += 1
                        break
                    if hits > 6:
                        break
            except Exception as e:
                pass
    print('todowrite hits:', hits)
except Exception as e:
    print('db error', e)
g = glob.glob(R + '/fp-opencode-tab-20260826/agent-state/absinthe-graphql__absinthe-998-native/opencode-retained/*/opencode.generated.json')
if g:
    d = json.load(open(g[0]))
    print('generated.json keys:', list(d.keys()))
    s = json.dumps(d)
    for m in re.finditer(r'.{0,100}(?:todowrite|todo).{0,160}', s, re.I):
        print('   [cfg]', m.group(0)[:300])
print()
print('== claude-code: any TodoWrite guidance text in the main transcript (system prompt is not persisted; expect none)')
cc = glob.glob(R + '/fp-claudecode-tab-20260826/agent-state/absinthe-graphql__absinthe-998-native/claude-home/projects/*/*.jsonl')[0]
s = open(cc).read()
print('TodoWrite mentions in transcript text:', len(re.findall(r'TodoWrite', s)))
for m in re.finditer(r'.{0,120}TodoWrite.{0,200}', s):
    t = m.group(0)
    if '"name": "TodoWrite"' in t or '"name":"TodoWrite"' in t:
        continue
    print('   [cc]', t[:320].replace('\\n', ' '))
    break
