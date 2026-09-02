#!/usr/bin/env python3
"""p2 — does the gutter carry fire on codex/opencode too, and is it merely FORGIVEN?

'0 whitespace failures' on codex/opencode is near-tautological: their seek trims
whitespace on pass 3, so a carried delimiter cannot produce a failure. The
testable question is whether the carry appears in the patch TEXT at all. For every
apply_patch context/removed line, find the golden line with the same stripped text
(only when that stripped text is UNIQUE in the file) and compare indentation."""
import os,re,json,glob,sys
from collections import Counter, defaultdict
RES='/root/sweet-search-private/eval/task-completion-bench/results'
GOLD='/root/.ss-eval/golden'
POOL=[l.strip() for l in open('/root/fresh-run/pool.txt') if l.strip()]
REPAIR=set(l.strip() for l in open('/root/fresh-run/repair-tasks.txt') if l.strip())
RUNS={('codex','tab'):['fp-codex-tab-20260826'],('codex','none'):['fp-codex-none-20260826'],
      ('codex','pipe'):['fp-codex-pipe-20260826'],
      ('opencode','tab'):['fp-opencode-tab-20260826','rp-oc-tab-20260827'],
      ('opencode','none'):['fp-opencode-none-20260826','rp-oc-none-20260827'],
      ('opencode','pipe'):['fp-opencode-pipe-20260826','rp-oc-pipe-20260827']}
def jl(p):
    o=[]
    with open(p,errors='replace') as f:
        for ln in f:
            ln=ln.strip()
            if not ln: continue
            try: o.append(json.loads(ln))
            except Exception: pass
    return o
_gold={}
def gold_index(task, jailpath):
    rel=re.sub(r'^/root/\.ss-eval/runs/[^/]+/','',jailpath).lstrip('/')
    base=task.rsplit('-',1)[0].lower()
    key=(base,rel)
    if key in _gold: return _gold[key]
    d=[x for x in os.listdir(GOLD) if x.split('@')[0].lower()==base]
    idx=None
    if d:
        p=os.path.join(GOLD,d[0],rel)
        if os.path.exists(p):
            lines=open(p,errors='replace').read().split('\n')
            m=defaultdict(list)
            for i,l in enumerate(lines): m[l.strip()].append(l)
            idx=m
    _gold[key]=idx
    return idx
def indent(s): return re.match(r'^[ \t]*',s).group(0)
def files_and_hunks(body):
    """yield (path, ctxline) for each context/removed line."""
    cur=None
    for ln in body.split('\n'):
        m=re.match(r'\*\*\* (?:Update|Add|Delete) File: (.+)$', ln)
        if m: cur=m.group(1).strip(); continue
        if ln.startswith('***') or ln.startswith('@@'): continue
        if ln[:1] in (' ','-') and cur: yield cur, ln[1:]
def codex_patches(run,arm):
    base=os.path.join(RES,run,'agent-state')
    if not os.path.isdir(base): return
    for d in sorted(os.listdir(base)):
        if not d.endswith('-'+arm): continue
        task=d[:-(len(arm)+1)]
        for f in glob.glob(os.path.join(base,d,'codex-home/sessions/*/*/*/rollout-*.jsonl')):
            for r in jl(f):
                p=r.get('payload') or {}
                if (p.get('type') or r.get('type')) not in ('function_call','custom_tool_call'): continue
                a=p.get('arguments') or p.get('input') or ''
                cmd=''
                if isinstance(a,str):
                    try: cmd=(json.loads(a) or {}).get('cmd','')
                    except Exception: cmd=a
                if isinstance(cmd,list): cmd=' '.join(cmd)
                if 'apply_patch' not in cmd: continue
                m=re.search(r"apply_patch\s*<<\s*'?\"?(\w+)'?\"?\n(.*?)\n\1", cmd, re.S)
                yield task,(m.group(2) if m else cmd)
def oc_patches(run,arm):
    base=os.path.join(RES,run,'agent-state')
    if not os.path.isdir(base): return
    for d in sorted(os.listdir(base)):
        if not d.endswith('-'+arm): continue
        task=d[:-(len(arm)+1)]
        for f in glob.glob(os.path.join(base,d,'opencode-retained/session-*/attempt-*.stdout.ndjson')):
            for r in jl(f):
                if r.get('type')!='tool_use': continue
                part=r.get('part') or {}
                if part.get('tool')!='apply_patch': continue
                inp=(part.get('state') or {}).get('input') or {}
                if isinstance(inp,str):
                    try: inp=json.loads(inp)
                    except Exception: inp={}
                yield task,(inp.get('patchText') if isinstance(inp,dict) else '') or ''
def run_cell(h,form,runs,arm='sweet'):
    tested=0; exact=0; carry_tab=0; carry_sp=0; other=0
    tested_tab=0; tested_sp=0
    ex=[]; oth=[]
    for run in runs:
        for task,body in (codex_patches(run,arm) if h=='codex' else oc_patches(run,arm)):
            if h=='opencode':
                if run.startswith('rp-') and task not in REPAIR: continue
                if run.startswith('fp-') and task in REPAIR: continue
            for path,ctx in files_and_hunks(body):
                if not ctx.strip(): continue
                idx=gold_index(task,path)
                if idx is None: continue
                cand=idx.get(ctx.strip())
                if not cand or len(set(cand))!=1: continue
                disk=cand[0]
                tested+=1
                di0=indent(disk)
                if di0.startswith('\t'): tested_tab+=1
                elif di0.startswith(' '): tested_sp+=1
                if disk==ctx: exact+=1; continue
                di,ci=indent(disk),indent(ctx)
                if ci==('\t'+di) or (ci.startswith('\t') and ci[1:]==di): carry_tab+=1; ex.append((task,'TAB',repr(disk[:60]),repr(ctx[:60])))
                elif ci==(' '+di) or (ci.startswith(' ') and ci[1:]==di): carry_sp+=1; ex.append((task,'SP',repr(disk[:60]),repr(ctx[:60])))
                else:
                    other+=1
                    oth.append((task,repr(disk[:55]),repr(ctx[:55])))
    print(f'{h:<9}{arm:<7}{form:<6} tested={tested:<6} exact={exact:<6} carry_TAB={carry_tab:<4} carry_SPACE={carry_sp:<4} other_indent_diff={other}')
    print('    tested split: tab-indented disk lines=%d, space-indented=%d' % (tested_tab, tested_sp))
    for e in ex: print('    carry ex',e)
    for e in oth[:6]: print('    other  ex',e)
for (h,form),runs in RUNS.items(): run_cell(h,form,runs)
run_cell('codex','-',['fp-codex-tab-20260826'],'native')
run_cell('opencode','-',['fp-opencode-tab-20260826'],'native')
