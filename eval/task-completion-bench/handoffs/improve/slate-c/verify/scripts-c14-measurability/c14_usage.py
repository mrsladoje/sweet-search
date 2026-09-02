import json
p='/root/sweet-search-private/eval/task-completion-bench/results/fp-claudecode-tab-20260826/rows.json'
rows=json.load(open(p))
print("sample usage native:", json.dumps(next(r['usage'] for r in rows if r['arm']=='native'), indent=0)[:400])
print("sample usage sweet :", json.dumps(next(r['usage'] for r in rows if r['arm']=='sweet'), indent=0)[:400])
