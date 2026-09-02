import os,re,json,glob
from collections import Counter
RES='/root/sweet-search-private/eval/task-completion-bench/results'
def jl(p):
    out=[]
    with open(p,errors='replace') as f:
        for ln in f:
            ln=ln.strip()
            if not ln: continue
            try: out.append(json.loads(ln))
            except Exception: pass
    return out
keys=Counter(); statuses=Counter(); errsamples=[]
n=0
for run in ['fp-opencode-none-20260826','rp-oc-none-20260827','fp-opencode-tab-20260826']:
    base=os.path.join(RES,run,'agent-state')
    if not os.path.isdir(base): continue
    for d in sorted(os.listdir(base)):
        if not d.endswith('-sweet'): continue
        for f in glob.glob(os.path.join(base,d,'opencode-retained/session-*/attempt-*.stdout.ndjson')):
            for r in jl(f):
                if r.get('type')!='tool_use': continue
                part=r.get('part') or {}
                if part.get('tool')!='apply_patch': continue
                st=part.get('state') or {}
                n+=1
                keys.update(st.keys())
                statuses.update([st.get('status')])
                blob=json.dumps(st)
                if 'verification failed' in blob or 'Failed to find' in blob or 'error' in str(st.get('status','')):
                    if len(errsamples)<6: errsamples.append((run,d,{k:(str(v)[:300]) for k,v in st.items()}))
print('apply_patch state records:',n)
print('state keys:',keys)
print('statuses:',statuses)
for run,d,s in errsamples:
    print('---',run,d); print(json.dumps(s,indent=1)[:900])
