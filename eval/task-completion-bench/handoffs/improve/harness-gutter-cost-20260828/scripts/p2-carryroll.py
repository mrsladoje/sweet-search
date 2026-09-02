import os,re,json,glob
from collections import defaultdict
RES='/root/sweet-search-private/eval/task-completion-bench/results'
GOLD='/root/.ss-eval/golden'
REPAIR=set(l.strip() for l in open('/root/fresh-run/repair-tasks.txt') if l.strip())
def jl(p):
    o=[]
    with open(p,errors='replace') as f:
        for ln in f:
            ln=ln.strip()
            if not ln: continue
            try: o.append(json.loads(ln))
            except Exception: pass
    return o
def indent(s): return re.match(r'^[ \t]*',s).group(0)
_g={}
def gidx(task,jp):
    rel=re.sub(r'^/root/\.ss-eval/runs/[^/]+/','',jp).lstrip('/')
    base=task.rsplit('-',1)[0].lower(); k=(base,rel)
    if k in _g: return _g[k]
    d=[x for x in os.listdir(GOLD) if x.split('@')[0].lower()==base]; idx=None
    if d:
        p=os.path.join(GOLD,d[0],rel)
        if os.path.exists(p):
            m=defaultdict(list)
            for l in open(p,errors='replace').read().split('\n'): m[l.strip()].append(l)
            idx=m
    _g[k]=idx; return idx
def hunks(body):
    cur=None
    for ln in body.split('\n'):
        m=re.match(r'\*\*\* (?:Update|Add|Delete) File: (.+)$',ln)
        if m: cur=m.group(1).strip(); continue
        if ln.startswith('***') or ln.startswith('@@'): continue
        if ln[:1] in (' ','-') and cur: yield cur,ln[1:]
def cells():
    yield 'codex','tab',['fp-codex-tab-20260826']
    yield 'codex','none',['fp-codex-none-20260826']
    yield 'codex','pipe',['fp-codex-pipe-20260826']
    yield 'opencode','tab',['fp-opencode-tab-20260826','rp-oc-tab-20260827']
    yield 'opencode','none',['fp-opencode-none-20260826','rp-oc-none-20260827']
    yield 'opencode','pipe',['fp-opencode-pipe-20260826','rp-oc-pipe-20260827']
for h,form,runs in cells():
    carry_rolls=set(); carry_tasks=set(); nlines=0; all_rolls=set()
    for run in runs:
        base=os.path.join(RES,run,'agent-state')
        if not os.path.isdir(base): continue
        for d in sorted(os.listdir(base)):
            if not d.endswith('-sweet'): continue
            task=d[:-6]
            if run.startswith('rp-') and task not in REPAIR: continue
            if run.startswith('fp-') and task in REPAIR and h=='opencode': continue
            pat = 'codex-home/sessions/*/*/*/rollout-*.jsonl' if h=='codex' else 'opencode-retained/session-*/attempt-*.stdout.ndjson'
            for f in glob.glob(os.path.join(base,d,pat)):
                all_rolls.add(f)
                bodies=[]
                for r in jl(f):
                    if h=='codex':
                        p=r.get('payload') or {}
                        if (p.get('type') or r.get('type')) not in ('function_call','custom_tool_call'): continue
                        a=p.get('arguments') or p.get('input') or ''
                        cmd=''
                        if isinstance(a,str):
                            try: cmd=(json.loads(a) or {}).get('cmd','')
                            except Exception: cmd=a
                        if isinstance(cmd,list): cmd=' '.join(cmd)
                        if 'apply_patch' not in cmd: continue
                        m=re.search(r"apply_patch\s*<<\s*'?\"?(\w+)'?\"?\n(.*?)\n\1",cmd,re.S)
                        bodies.append(m.group(2) if m else cmd)
                    else:
                        if r.get('type')!='tool_use': continue
                        part=r.get('part') or {}
                        if part.get('tool')!='apply_patch': continue
                        inp=(part.get('state') or {}).get('input') or {}
                        if isinstance(inp,str):
                            try: inp=json.loads(inp)
                            except Exception: inp={}
                        bodies.append((inp.get('patchText') if isinstance(inp,dict) else '') or '')
                for b in bodies:
                    for path,ctx in hunks(b):
                        if not ctx.strip(): continue
                        idx=gidx(task,path)
                        if idx is None: continue
                        c=idx.get(ctx.strip())
                        if not c or len(set(c))!=1: continue
                        disk=c[0]
                        if disk==ctx: continue
                        di,ci=indent(disk),indent(ctx)
                        if ci.startswith('\t') and ci[1:]==di:
                            nlines+=1; carry_rolls.add(f); carry_tasks.add(task)
    print(f'{h:<9} sweet {form:<5} tab-carry lines={nlines:<4} rollouts with >=1 carry={len(carry_rolls)}/{len(all_rolls)} tasks={sorted(carry_tasks)}')
