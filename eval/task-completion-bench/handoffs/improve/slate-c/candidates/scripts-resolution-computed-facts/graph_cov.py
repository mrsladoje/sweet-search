import sqlite3, os, collections, re, glob
GOLD='/root/.ss-eval/golden'
rows=[l.rstrip('\n').split('\t') for l in open('/tmp/wf-slatec/resolution-computed-facts/tasks-safe.tsv')]
import json
tasks=json.load(open('/root/sweet-search-private/eval/task-completion-bench/results/fp-codex-tab-20260826/sweet/tasks.json'))
print('task | lang | entities | calls | calls-by-source-ext (top) | #private-method defs in JS/TS src')
for t in tasks:
    root=f"{GOLD}/{t['repo'].replace('/','__')}@{t['base_commit']}"
    db=f'{root}/.sweet-search/code-graph.db'
    if not os.path.exists(db): print(t['instance_id'], 'NO GRAPH DB'); continue
    con=sqlite3.connect(f'file:{db}?mode=ro', uri=True)
    ents=con.execute('select count(*) from entities').fetchone()[0]
    calls=con.execute("select count(*) from relationships where type='calls'").fetchone()[0]
    byext=collections.Counter()
    for (fp,) in con.execute("select e.file_path from relationships r join entities e on e.id=r.source_id where r.type='calls'"):
        byext[os.path.splitext(fp)[1]]+=1
    con.close()
    priv=0
    if t['language'] in ('js','ts'):
        for p in glob.glob(f'{root}/**/*.[jt]s', recursive=True):
            if '/node_modules/' in p or '/dist/' in p: continue
            try: priv+=len(re.findall(r'^\s*(?:static\s+)?(?:async\s+)?#[A-Za-z_]\w*\s*\(', open(p,encoding='utf-8',errors='replace').read(), re.M))
            except Exception: pass
    print(f"{t['instance_id'][:40]:40s} {t['language']:7s} {ents:7d} {calls:7d} {dict(byext.most_common(3))} {priv}")
