import json,glob,re,random,statistics as st,sys
P={'in':4.0,'cr':0.20,'cw':5.0,'out':20.0}   # Opus 5.5 list, cache write 1.25x
EDIT_TOOLS={'Edit','Write','MultiEdit','NotebookEdit'}
EDIT_BASH=re.compile(r"sed\s+-i|perl\s+-p?i|\btee\b|cat\s*>|>\s*[\w./-]+\.\w+\s*<<|<<\s*'?EOF'?\s*>|\bpatch\b|git\s+apply|python3?\s+-\s*<<|\.write\(|open\([^)]*['\"]w")
runs=sys.argv[1:]
rows={}
for run in runs:
  for r in json.load(open(run+'/rows.json')): rows[(r['taskId'],r['arm'])]=(run,r)
tasks=sorted(t for t in {k[0] for k in rows} if (t,'native') in rows and (t,'sweet') in rows)
def split(run,t,arm):
  f=[x for x in glob.glob(f'{run}/agent-state/{t}-{arm}/claude-home/projects/*/*.jsonl')]
  if not f: return None
  recs=[json.loads(l) for l in open(f[0]) if l.strip()]
  seen=set(); pre=post=0.0; edited=False; calls=[0,0]; ss=[0,0]
  for r in recs:
    if r.get('type')!='assistant': continue
    m=r.get('message') or {}; mid=m.get('id') or r.get('requestId')
    blocks=m.get('content') if isinstance(m.get('content'),list) else []
    is_edit=False
    for b in blocks:
      if b.get('type')!='tool_use': continue
      inp=b.get('input') or {}; cmd=str(inp.get('command',''))
      ph=1 if edited else 0; calls[ph]+=1
      if 'ss-' in cmd: ss[ph]+=1
      if b.get('name') in EDIT_TOOLS or (b.get('name')=='Bash' and EDIT_BASH.search(cmd)): is_edit=True
    if mid and mid in seen:
      if is_edit: edited=True
      continue
    if mid: seen.add(mid)
    u=m.get('usage') or {}
    c=(u.get('input_tokens',0)*P['in']+u.get('cache_read_input_tokens',0)*P['cr']+u.get('cache_creation_input_tokens',0)*P['cw']+u.get('output_tokens',0)*P['out'])/1e6
    # the message that makes the first edit is counted in the retrieval phase (it decided the edit)
    if edited: post+=c
    else: pre+=c
    if is_edit: edited=True
  return dict(pre=pre,post=post,edited=edited,callsPre=calls[0],callsPost=calls[1],ssPre=ss[0],ssPost=ss[1])
D={}
for t in tasks:
  a={arm:split(*[rows[(t,arm)][0]],t,arm) for arm in ('native','sweet')}
  if all(a.values()): D[t]=a
def boot(k,T):
  random.seed(42); out=[]
  for _ in range(4000):
    x=[random.choice(T) for _ in T]; n=sum(D[i]['native'][k] for i in x); s=sum(D[i]['sweet'][k] for i in x); out.append(100*(s/n-1) if n else 0)
  out.sort(); return out[100],out[3900]
T=list(D)
print('tasks',len(T),'rollouts with an edit: native',sum(D[t]['native']['edited'] for t in T),'sweet',sum(D[t]['sweet']['edited'] for t in T))
for k,name in [('pre','retrieval phase (up to first edit)'),('post','fix + verify phase (after first edit)')]:
  n=sum(D[t]['native'][k] for t in T); s=sum(D[t]['sweet'][k] for t in T); lo,hi=boot(k,T)
  print(f"{name:40s} native ${n:7.2f} sweet ${s:7.2f} {100*(s/n-1):+.1f}% CI[{lo:+.1f},{hi:+.1f}] sweet cheaper on {sum(D[t]['sweet'][k]<D[t]['native'][k] for t in T)}/{len(T)} share of native total {100*n/(sum(D[t]['native']['pre']+D[t]['native']['post'] for t in T)):.0f}%")
tn=sum(D[t]['native']['pre']+D[t]['native']['post'] for t in T); ts=sum(D[t]['sweet']['pre']+D[t]['sweet']['post'] for t in T)
print(f"total (check vs rows) native ${tn:.2f} sweet ${ts:.2f} {100*(ts/tn-1):+.1f}%")
for k in ['callsPre','callsPost','ssPre','ssPost']:
  print(k,'native',sum(D[t]['native'][k] for t in T),'sweet',sum(D[t]['sweet'][k] for t in T))
