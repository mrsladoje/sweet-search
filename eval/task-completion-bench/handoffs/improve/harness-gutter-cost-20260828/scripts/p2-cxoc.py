#!/usr/bin/env python3
"""p2 — independent codex + opencode apply_patch census: calls, failures, residue,
and whitespace-only mismatches. Written from scratch (does not import e1_common)."""
import os,re,json,sys,glob
from collections import defaultdict
RES='/root/sweet-search-private/eval/task-completion-bench/results'
GOLD='/root/.ss-eval/golden'
POOL=[l.strip() for l in open('/root/fresh-run/pool.txt') if l.strip()]
REPAIR=set(l.strip() for l in open('/root/fresh-run/repair-tasks.txt') if l.strip())

RUNS={
 ('codex','tab'):['fp-codex-tab-20260826'],
 ('codex','none'):['fp-codex-none-20260826'],
 ('codex','pipe'):['fp-codex-pipe-20260826'],
 ('opencode','tab'):['fp-opencode-tab-20260826','rp-oc-tab-20260827'],
 ('opencode','none'):['fp-opencode-none-20260826','rp-oc-none-20260827'],
 ('opencode','pipe'):['fp-opencode-pipe-20260826','rp-oc-pipe-20260827'],
}
RESIDUE=[('N<TAB>',re.compile(r'^\d+\t')),('N| ',re.compile(r'^\d+\| ')),('N: ',re.compile(r'^\d+: ')),('N|',re.compile(r'^\d+\|')),('N:',re.compile(r'^\d+:'))]

def jl(p):
    out=[]
    with open(p,errors='replace') as f:
        for ln in f:
            ln=ln.strip()
            if not ln: continue
            try: out.append(json.loads(ln))
            except Exception: pass
    return out

def hunk_lines(patch):
    """Return (context_and_removed_lines, all_body_lines) from an apply_patch body."""
    ctx=[]; allb=[]
    for ln in patch.split('\n'):
        if ln.startswith('*** ') or ln.startswith('@@'): continue
        if ln[:1] in (' ','-','+'):
            body=ln[1:]
            allb.append(body)
            if ln[0] in (' ','-'): ctx.append(body)
    return ctx,allb

def codex_calls(run, arm):
    base=os.path.join(RES,run,'agent-state')
    if not os.path.isdir(base): return
    for d in sorted(os.listdir(base)):
        if not d.endswith('-'+arm): continue
        task=d[:-(len(arm)+1)]
        for f in glob.glob(os.path.join(base,d,'codex-home/sessions/*/*/*/rollout-*.jsonl')):
            recs=jl(f)
            outs={}
            for r in recs:
                p=r.get('payload') or {}
                if p.get('type')=='function_call_output' or r.get('type')=='function_call_output':
                    outs[p.get('call_id') or r.get('call_id')]=p.get('output') or r.get('output')
            for r in recs:
                p=r.get('payload') or {}
                t=p.get('type') or r.get('type')
                if t not in ('function_call','custom_tool_call'): continue
                args=p.get('arguments') or p.get('input') or ''
                cmd=''
                if isinstance(args,str):
                    try: cmd=(json.loads(args) or {}).get('cmd','')
                    except Exception: cmd=args
                if isinstance(cmd,list): cmd=' '.join(cmd)
                if 'apply_patch' not in cmd: continue
                out=outs.get(p.get('call_id') or r.get('call_id')) or ''
                if isinstance(out,dict): out=json.dumps(out)
                yield task,f,cmd,str(out)

def opencode_calls(run, arm):
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
                st=part.get('state') or {}
                inp=st.get('input') or {}
                if isinstance(inp,str):
                    try: inp=json.loads(inp)
                    except Exception: inp={}
                blob = str(st.get('output') or '') + '\n' + str(st.get('error') or '') + '\nSTATUS=' + str(st.get('status'))
                yield task,f,(inp.get('patchText') if isinstance(inp,dict) else '') or '', blob

def main():
    report={}
    for (h,form),runs in RUNS.items():
        calls=0; fails=0; residue=defaultdict(int); ws_fail=0; anchor_lines=0
        seen_tasks=set(); fail_examples=[]
        for run in runs:
            arm='sweet'
            for task,f,patch,out in (codex_calls(run,arm) if h=='codex' else opencode_calls(run,arm)):
                # repair substitution for opencode
                if h=='opencode':
                    if run.startswith('rp-') and task not in REPAIR: continue
                    if run.startswith('fp-') and task in REPAIR: continue
                calls+=1; seen_tasks.add(task)
                body = patch
                if h=='codex':
                    m=re.search(r"apply_patch\s*<<\s*'?\"?(\w+)'?\"?\n(.*?)\n\1", patch, re.S)
                    body = m.group(2) if m else patch
                ctx,allb=hunk_lines(body)
                anchor_lines+=len(ctx)
                for name,rx in RESIDUE:
                    for l in ctx:
                        if rx.match(l): residue[name]+=1
                bad = ('verification failed' in out) or ('Failed to find' in out) or ('Unexpected line found' in out) or ('STATUS=error' in out) or ('No such file or directory' in out and 'apply_patch' in out)
                ok = ('Success. Updated the following files' in out) or ('STATUS=completed' in out and not ('verification failed' in out or 'Failed to find' in out))
                if bad and not ok:
                    fails+=1
                    if len(fail_examples)<4: fail_examples.append((task,out[:220].replace('\n','\\n')))
        report[(h,form)]=dict(calls=calls,fails=fails,anchor_lines=anchor_lines,residue=dict(residue),tasks=len(seen_tasks))
        print(f'{h:<9} sweet {form:<5} calls={calls:<5} failed={fails:<4} anchor_lines={anchor_lines:<6} tasks={len(seen_tasks):<3} residue={dict(residue)}')
        for t,o in fail_examples: print(f'     fail ex [{t}] {o}')
    # native arms (tab runs only)
    for h,run in (('codex','fp-codex-tab-20260826'),('opencode','fp-opencode-tab-20260826')):
        calls=0;fails=0;anchor_lines=0;residue=defaultdict(int)
        for task,f,patch,out in (codex_calls(run,'native') if h=='codex' else opencode_calls(run,'native')):
            calls+=1
            body=patch
            if h=='codex':
                m=re.search(r"apply_patch\s*<<\s*'?\"?(\w+)'?\"?\n(.*?)\n\1", patch, re.S)
                body=m.group(2) if m else patch
            ctx,_=hunk_lines(body); anchor_lines+=len(ctx)
            for name,rx in RESIDUE:
                for l in ctx:
                    if rx.match(l): residue[name]+=1
            bad=('verification failed' in out) or ('Failed to find' in out) or ('Unexpected line found' in out) or ('STATUS=error' in out)
            ok=('Success. Updated the following files' in out) or ('STATUS=completed' in out and not ('verification failed' in out or 'Failed to find' in out))
            if bad and not ok: fails+=1
        print(f'{h:<9} native      calls={calls:<5} failed={fails:<4} anchor_lines={anchor_lines:<6} residue={dict(residue)}')

main()
