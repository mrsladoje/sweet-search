import os,re,json,glob
RES='/root/sweet-search-private/eval/task-completion-bench/results'
GOLD='/root/.ss-eval/golden'
def jl(p):
    o=[]
    with open(p,errors='replace') as f:
        for ln in f:
            ln=ln.strip()
            if not ln: continue
            try: o.append(json.loads(ln))
            except Exception: pass
    return o
def esc(s): return s.replace('\\','\\\\').replace('\t','\\t')

TARGETS=[('opencode','fp-opencode-tab-20260826','apigee__registry-961-sweet','\t\t\treturn nil, err'),
         ('codex','fp-codex-tab-20260826','devlooped__moq-1262-sweet','\t\t\t\tif (x is MemberExpression)')]

for h,run,d,needle in TARGETS:
    print('='*100); print(h,run,d,'| needle',repr(esc(needle)))
    base=os.path.join(RES,run,'agent-state',d)
    if h=='opencode':
        files=glob.glob(os.path.join(base,'opencode-retained/session-*/attempt-*.stdout.ndjson'))
    else:
        files=glob.glob(os.path.join(base,'codex-home/sessions/*/*/*/rollout-*.jsonl'))
    for f in files:
        recs=jl(f)
        found=False
        prior=[]
        for r in recs:
            if h=='opencode':
                if r.get('type')!='tool_use': continue
                part=r.get('part') or {}
                st=part.get('state') or {}
                inp=st.get('input') or {}
                if isinstance(inp,str):
                    try: inp=json.loads(inp)
                    except Exception: inp={}
                if part.get('tool')=='apply_patch':
                    pt=(inp.get('patchText') or '') if isinstance(inp,dict) else ''
                    if needle in pt:
                        found=True
                        print(' PATCH in', os.path.basename(os.path.dirname(f)))
                        print('   status =', st.get('status'), '| error =', str(st.get('error'))[:120])
                        for ln in pt.split('\n'):
                            if needle in ln: print('   patch line', repr(esc(ln))[:100])
                        for pl in prior[-4:]:
                            print('   prior showing:', pl)
                        prior=[]
                else:
                    out=str(st.get('output') or '')
                    cmd=json.dumps(inp)[:120]
                    for ln in out.split('\n'):
                        if needle.strip() and needle.strip() in ln:
                            prior.append(f'[{part.get("tool")}] {cmd[:70]} -> {repr(esc(ln))[:90]}')
                            break
            else:
                p=r.get('payload') or {}
                t=p.get('type') or r.get('type')
                if t in ('function_call','custom_tool_call'):
                    a=p.get('arguments') or p.get('input') or ''
                    cmd=''
                    if isinstance(a,str):
                        try: cmd=(json.loads(a) or {}).get('cmd','')
                        except Exception: cmd=a
                    if isinstance(cmd,list): cmd=' '.join(cmd)
                    if 'apply_patch' in cmd and needle in cmd:
                        found=True
                        print(' PATCH in', os.path.basename(f), 'call', p.get('call_id'))
                        for ln in cmd.split('\n'):
                            if needle in ln: print('   patch line', repr(esc(ln))[:100])
                        for pl in prior[-4:]: print('   prior showing:', pl)
                        globals()['pending']=p.get('call_id')
                        prior=[]
                elif t=='function_call_output':
                    out=p.get('output') or ''
                    if isinstance(out,dict): out=json.dumps(out)
                    out=str(out)
                    if globals().get('pending')==(p.get('call_id')):
                        print('   OUTCOME:', out[:200].replace('\n','\\n'))
                        globals()['pending']=None
                    for ln in out.split('\n'):
                        if needle.strip() in ln:
                            prior.append(repr(esc(ln))[:100]); break
        if found: break
