#!/usr/bin/env python3
"""Stage-1 census over the gutter A/B runs. Read-only.
Per run/cell: edits by tool, edit failures + distinct error heads, gutter line counts,
ss-read/ss-search/ss-grep output counts with body line counts and gutter presence."""
import json, os, re, sys, collections
R='/root/sweet-search-private/eval/task-completion-bench/results'
RUNS={
 'rb-codex-20260825':'codex','gab-pipe-20260825':'codex','gab-none-20260825':'codex',
 'rb-opencode-20260824':'opencode','gx-oc-pipe-20260825':'opencode','gx-oc-none-20260825':'opencode',
 'rb-claudecode-20260824':'claude','gx-cc-pipe-20260825':'claude','gx-cc-none-20260825':'claude',
}
SIX={'jashkenas__underscore-2757','pytask-dev__pytask-210','rstudio-education__gradethis-161',
 'teleporthq__teleport-code-generators-291','ontodev__robot-710','epiforecasts__scoringutils-229'}
ONLY_SIX = '--all' not in sys.argv

def walk(d):
    for root,dirs,files in os.walk(d):
        for f in files: yield os.path.join(root,f)

def jl(f):
    out=[]
    with open(f,encoding='utf8',errors='replace') as fh:
        for l in fh:
            l=l.strip()
            if not l: continue
            try: out.append(json.loads(l))
            except: pass
    return out

def text_of(c):
    if isinstance(c,str): return c
    if isinstance(c,list): return '\n'.join((x.get('text') or '') if isinstance(x,dict) else str(x) for x in c)
    if c is None: return ''
    return json.dumps(c)

# ---- generic event stream: list of {'kind':'call'|'result','tool','input','output','error'} in order
def events_codex(f):
    ev=[]; calls={}
    for d in jl(f):
        p=d.get('payload') or {}; t=p.get('type') or d.get('type')
        if t in ('function_call','custom_tool_call'):
            args=p.get('arguments') if 'arguments' in p else p.get('input')
            try: inp=json.loads(args) if isinstance(args,str) else (args or {})
            except: inp={'raw':args}
            calls[p.get('call_id') or p.get('id')]=(p.get('name'),inp)
            ev.append({'kind':'call','tool':p.get('name'),'input':inp,'id':p.get('call_id') or p.get('id')})
        elif t in ('function_call_output','custom_tool_call_output'):
            name,inp=calls.get(p.get('call_id'),(None,{}))
            out=text_of(p.get('output'))
            ev.append({'kind':'result','tool':name,'input':inp,'output':out,'id':p.get('call_id')})
    return ev

def events_opencode(f):
    ev=[]
    for d in jl(f):
        if d.get('type')!='tool_use': continue
        p=d.get('part') or {}; st=p.get('state') or {}
        inp=st.get('input') or {}
        out=text_of(st.get('output')) if st.get('status')!='error' else text_of(st.get('error') or st.get('output'))
        ev.append({'kind':'call','tool':p.get('tool'),'input':inp,'id':p.get('callID')})
        ev.append({'kind':'result','tool':p.get('tool'),'input':inp,'output':out,'id':p.get('callID'),'status':st.get('status')})
    return ev

def events_claude(f):
    ev=[]; uses={}
    for d in jl(f):
        m=d.get('message')
        if not m: continue
        for b in (m.get('content') if isinstance(m.get('content'),list) else []):
            if b.get('type')=='tool_use':
                uses[b['id']]=(b.get('name'),b.get('input') or {})
                ev.append({'kind':'call','tool':b.get('name'),'input':b.get('input') or {},'id':b['id']})
            elif b.get('type')=='tool_result':
                name,inp=uses.get(b.get('tool_use_id'),(None,{}))
                ev.append({'kind':'result','tool':name,'input':inp,'output':text_of(b.get('content')),'id':b.get('tool_use_id'),'is_error':bool(b.get('is_error'))})
    return ev

def trace_files(run,harness,cell):
    d=os.path.join(R,run,'agent-state',cell)
    for f in walk(d):
        if harness=='codex' and re.search(r'rollout-.*\.jsonl$',f): yield f
        elif harness=='opencode' and f.endswith('attempt-1.stdout.ndjson'): yield f
        elif harness=='claude' and f.endswith('.jsonl') and '/claude-home/projects/' in f and '/subagents/' not in f: yield f

APPLY_HEREDOC=re.compile(r'apply_patch\s*<<')
def is_edit(harness,e):
    t=e['tool'] or ''; inp=e['input'] or {}
    if harness=='codex':
        if t=='apply_patch': return 'apply_patch'
        cmd=str(inp.get('cmd') or inp.get('command') or '')
        if APPLY_HEREDOC.search(cmd) or cmd.lstrip().startswith('apply_patch'): return 'shell:apply_patch'
        return None
    if harness=='opencode':
        return t if t in ('apply_patch','edit','write','patch','multiedit') else None
    if harness=='claude':
        return t if t in ('Edit','MultiEdit','Write','NotebookEdit') else None

FAIL_PATTERNS=[
 ('cc:not-found',re.compile(r'String to replace not found in file',re.I)),
 ('cc:not-unique',re.compile(r'Found \d+ matches of the string to replace',re.I)),
 ('cc:file-unread',re.compile(r'File has not been read yet',re.I)),
 ('cc:modified-since-read',re.compile(r'has been modified since read',re.I)),
 ('ap:expected-lines',re.compile(r'Failed to find expected lines',re.I)),
 ('ap:context',re.compile(r'Failed to find context',re.I)),
 ('ap:verification',re.compile(r'apply_patch verification failed',re.I)),
 ('ap:invalid',re.compile(r'[Ii]nvalid patch|Invalid hunk|Unexpected line|patch rejected|Failed to parse',re.I)),
 ('oc:oldstring-notfound',re.compile(r'Could not find oldString|oldString not found',re.I)),
 ('oc:multiple',re.compile(r'Found multiple matches',re.I)),
 ('oc:disproportionate',re.compile(r'Refusing replacement',re.I)),
 ('generic:error',re.compile(r'^\s*(Error|error):',re.M)),
]
def classify_fail(harness,e):
    out=e.get('output') or ''
    hits=[k for k,rx in FAIL_PATTERNS if rx.search(out)]
    if harness=='claude' and e.get('is_error') and not hits: hits=['cc:other-error']
    if harness=='opencode' and e.get('status')=='error' and not hits: hits=['oc:other-error']
    if harness=='codex' and not hits:
        m=re.search(r'[Ee]xited with code (\d+)|exit code:? (\d+)',out)
        if m and (m.group(1) or m.group(2))!='0': hits=['cx:nonzero-exit']
    return hits

GUT_TAB=re.compile(r'^\s*\d+\t'); GUT_PIPE=re.compile(r'^\s*\d+\| ')
SSREAD_HDR=re.compile(r'^# ss-read (\S+)(?: \((?:lines (\d+)-(\d+) of )?(\d+) lines?\))?',re.M)

def scan_output_surfaces(out, acc):
    """count ss-read blocks, body line counts, gutter presence; ss-search/ss-grep blocks"""
    lines=out.split('\n')
    i=0
    while i<len(lines):
        ln=lines[i]
        if ln.startswith('# ss-read '):
            # next line should be a fence
            j=i+1
            while j<len(lines) and not lines[j].startswith('```'): j+=1
            k=j+1
            body=[]
            while k<len(lines) and not lines[k].startswith('```'):
                body.append(lines[k]); k+=1
            n=len(body)
            g='tab' if body and GUT_TAB.match(body[0]) else ('pipe' if body and GUT_PIPE.match(body[0]) else 'none')
            acc['ssread'].append({'lines':n,'gutter':g,'hdr':ln[:120]})
            i=k+1; continue
        if ln.startswith('# sweet-search: routed='): acc['sssearch']+=1
        if ln.startswith('# ss-grep:'): acc['ssgrep']+=1
        if ln.startswith('# ss-find') or ln.startswith('# ss-semantic'): acc['ssother']+=1
        i+=1
    for ln in lines:
        if GUT_TAB.match(ln): acc['tab']+=1
        elif GUT_PIPE.match(ln): acc['pipe']+=1

def main():
    summary={}
    for run,harness in RUNS.items():
        asd=os.path.join(R,run,'agent-state')
        if not os.path.isdir(asd): print('MISSING',run); continue
        for cell in sorted(os.listdir(asd)):
            m=re.match(r'(.*)-(sweet|native)$',cell)
            if not m: continue
            task,arm=m.groups()
            if ONLY_SIX and task not in SIX: continue
            key=(run,harness,arm)
            s=summary.setdefault(key,{'rollouts':0,'edits':collections.Counter(),'fails':collections.Counter(),
                'fail_examples':[],'tab':0,'pipe':0,'ssread':[],'sssearch':0,'ssgrep':0,'ssother':0,'tools':collections.Counter()})
            for f in trace_files(run,harness,cell):
                s['rollouts']+=1
                ev={'codex':events_codex,'opencode':events_opencode,'claude':events_claude}[harness](f)
                for e in ev:
                    if e['kind']=='call': s['tools'][e['tool']]+=1
                    if e['kind']!='result': continue
                    et=is_edit(harness,e)
                    if et:
                        s['edits'][et]+=1
                        fl=classify_fail(harness,e)
                        for k in fl: s['fails'][k]+=1
                        if fl:
                            s['fail_examples'].append({'task':task,'file':f.replace(R+'/',''),'tool':et,'kinds':fl,
                                'out_head':(e.get('output') or '')[:300]})
                    scan_output_surfaces(e.get('output') or '', s)
    for key,s in sorted(summary.items()):
        run,harness,arm=key
        sr=s['ssread']; n=len(sr)
        short=sum(1 for x in sr if x['lines']<15); gut=collections.Counter(x['gutter'] for x in sr)
        print(f"\n=== {run} [{harness}/{arm}] rollouts={s['rollouts']}")
        print(f"  tools: {dict(s['tools'].most_common(8))}")
        print(f"  edits: {dict(s['edits'])}   FAILS: {dict(s['fails'])}")
        print(f"  gutter lines: tab={s['tab']} pipe={s['pipe']}")
        print(f"  ss-read blocks={n}  sub15={short}  gutter={dict(gut)}  ss-search={s['sssearch']} ss-grep={s['ssgrep']} other={s['ssother']}")
        if sr:
            ls=sorted(x['lines'] for x in sr)
            print(f"  ss-read body lines: min={ls[0]} p50={ls[len(ls)//2]} p90={ls[int(len(ls)*.9)]} max={ls[-1]}")
        for ex in s['fail_examples'][:40]:
            print(f"   FAIL {ex['task']} {ex['tool']} {ex['kinds']} :: {ex['out_head'][:200]!r}")
    with open('/tmp/gutter-inv/census.json','w') as fh:
        json.dump({f"{k[0]}|{k[1]}|{k[2]}":{kk:(dict(v) if isinstance(v,collections.Counter) else v) for kk,v in s.items()} for k,s in summary.items()},fh)
if __name__=="__main__": main()
