import json, os, glob, collections
B='/root/sweet-search-private/eval/task-completion-bench/results/fp-claudecode-tab-20260826/agent-state'
files=[f for f in glob.glob(B+'/*/claude-home/projects/*/*.jsonl') if '/subagents/' not in f]
stat=collections.Counter(); wasted=collections.Counter(); filect=collections.Counter()
toolcalls=collections.Counter()
for f in files:
    arm='sweet' if '-sweet/' in f else ('native' if '-native/' in f else '?')
    # map tool_use_id -> parent assistant message id
    parent={}; err=collections.defaultdict(int); tot=collections.defaultdict(int)
    hit=False
    try: lines=open(f, errors='replace').read().splitlines()
    except Exception: continue
    for ln in lines:
        if not ln.strip(): continue
        try: o=json.loads(ln)
        except Exception: continue
        m=o.get('message') or {}
        if m.get('role')=='assistant' and isinstance(m.get('content'),list):
            mid=m.get('id')
            for c in m['content']:
                if isinstance(c,dict) and c.get('type')=='tool_use':
                    parent[c.get('id')]=mid; tot[mid]+=1
                    if c.get('name')=='Read': toolcalls[(arm,'Read')]+=1
        if m.get('role')=='user' and isinstance(m.get('content'),list):
            for c in m['content']:
                if isinstance(c,dict) and c.get('type')=='tool_result':
                    txt=json.dumps(c.get('content'))
                    if 'Invalid pages parameter' in txt:
                        stat[arm]+=1; hit=True
                        mid=parent.get(c.get('tool_use_id'))
                        if mid is not None: err[mid]+=1
    if hit: filect[arm]+=1
    for mid,n in err.items():
        if n>0 and n==tot.get(mid,0): wasted[arm]+=1
print("main-thread files:",len(files), collections.Counter('sweet' if '-sweet/' in f else 'native' for f in files))
print("failed Read calls (Invalid pages):", dict(stat))
print("files containing >=1:", dict(filect))
print("wholly-wasted requests (all tool_use in the request failed that way):", dict(wasted))
print("total Read tool_use calls:", dict(toolcalls))
for a in ('native','sweet'):
    print(f"{a}: {wasted[a]/66:.2f} wasted requests per rollout (66 rollouts)")
