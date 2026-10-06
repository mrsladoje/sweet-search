import json,glob,re,shlex,collections,sys,os
R=os.path.join(os.path.dirname(os.path.abspath(__file__)),'../../core/prompt-optimization/data')
H=json.load(open(R+'/final-run/questions-heldout.json'))
ho=set(H['ids']['easy'])|set(H['ids'].get('hard',[]))|set(i for v in H['ids'].values() for i in v)
REPOS=['composer','dgraph','drogon','grdb','jj','ocelot','okhttp','sequel','tortoise-orm','typedoc','zipkin']
out=collections.defaultdict(list); seen=set(); skipped=collections.Counter()
for f in sorted(glob.glob(R+'/results/r282-*/captures/sweet.*.json')):
  if 'ho' in f.split('/')[-3]: continue
  d=json.load(open(f))
  if d['id'] in ho: skipped['heldout']+=1; continue
  m=re.match(r'r3h?b?-(.+)-\d+$',d['id'])
  if not m or m.group(1) not in REPOS: continue
  repo=m.group(1)
  for c in d.get('calls',[]):
    if c.get('kind')!='ss': continue
    cmd=c['command']
    try: toks=shlex.split(cmd,posix=True)
    except Exception: skipped['shlex']+=1; continue
    # first ss-search/semantic/find segment
    i=next((k for k,t in enumerate(toks) if re.search(r'(^|/)ss-(search|semantic|find)$',t)),None)
    if i is None: continue
    tool=toks[i].split('/')[-1]; args=[]
    for t in toks[i+1:]:
      if t in('|','&&',';','||','2>&1') or t.startswith('>') or t.startswith('2>'): break
      args.append(t)
    key=(repo,tool,tuple(args))
    if key in seen: continue
    seen.add(key); out[repo].append({'tool':tool,'args':args,'qid':d['id']})
tot=sum(len(v) for v in out.values())
print('unique calls',tot,{k:len(v) for k,v in out.items()}, dict(skipped))
print(collections.Counter(c['tool'] for v in out.values() for c in v))
dest=sys.argv[1] if len(sys.argv)>1 else 'calls.json'
os.makedirs(os.path.dirname(os.path.abspath(dest)),exist_ok=True)
json.dump(out,open(dest,'w'))
