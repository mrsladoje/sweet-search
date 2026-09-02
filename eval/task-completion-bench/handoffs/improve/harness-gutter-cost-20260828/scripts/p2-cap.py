import os,re,json,glob
RES='/root/sweet-search-private/eval/task-completion-bench/results'
runs=['fp-codex-tab-20260826','fp-codex-none-20260826','fp-codex-pipe-20260826']
maxun=0; mintr=10**9; ntr=0; nun=0; samples=[]
for run in runs:
    base=os.path.join(RES,run,'agent-state')
    if not os.path.isdir(base): continue
    for d in sorted(os.listdir(base)):
        for f in glob.glob(os.path.join(base,d,'codex-home/sessions/*/*/*/rollout-*.jsonl')):
            with open(f,errors='replace') as fh:
                for ln in fh:
                    if 'Original token count' not in ln: continue
                    try: r=json.loads(ln)
                    except Exception: continue
                    p=r.get('payload') or {}
                    out=p.get('output') or ''
                    if isinstance(out,dict): out=json.dumps(out)
                    out=str(out)
                    m=re.search(r'Original token count: (\d+)', out)
                    if not m: continue
                    n=int(m.group(1))
                    tr = 'truncated output' in out or 'tokens truncated' in out
                    if tr:
                        ntr+=1; mintr=min(mintr,n)
                    else:
                        nun+=1; maxun=max(maxun,n)
print('codex epoch C: outputs with a token-count header: untruncated',nun,'truncated',ntr)
print('largest UNtruncated token count:',maxun)
print('smallest TRUNCATED token count :',mintr)
