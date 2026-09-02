import json, random
p='/root/sweet-search-private/eval/task-completion-bench/results/fp-claudecode-tab-20260826/rows.json'
rows=[r for r in json.load(open(p)) if r.get('harness')=='claude-code' or True]
def parts(r):
    u=r.get('usage') or {}
    return (u.get('input_tokens') or 0, u.get('cache_creation_input_tokens') or 0,
            u.get('cache_read_input_tokens') or 0, u.get('output_tokens') or 0)
agg={}
for arm in ('native','sweet'):
    rs=[r for r in rows if r.get('arm')==arm]
    F=W=R=O=0
    for r in rs:
        f,w,rd,o=parts(r); F+=f; W+=w; R+=rd; O+=o
    agg[arm]=dict(n=len(rs),fresh=F,write=W,read=R,out=O)
    print(arm, agg[arm], "ingest=",F+W)
print()
# ratio-form pricing: cost / p_in  (per million).  read=0.10x, write=Kw, out=Ko
def price(a,Kw,Ko):
    d=agg[a]; return (d['fresh'] + Kw*d['write'] + 0.10*d['read'] + Ko*d['out'])/d['n']
vect=[('luna as SHIPPED (write 1.25x, out 6.0x)',1.25,6.0),
      ('luna NO write surcharge (1.00x, out 6.0x)',1.00,6.0),
      ('Anthropic 5m  (write 1.25x, out 5.0x)',1.25,5.0),
      ('Anthropic 1h  (write 2.00x, out 5.0x)',2.00,5.0),
      ('Fable5.1 5m (write1.25x, read0.025x?, out5x) -- approx',1.25,5.0)]
print(f"{'vector':52s} {'native':>14s} {'sweet':>14s} {'sweet-native':>12s}")
for name,Kw,Ko in vect[:4]:
    n=price('native',Kw,Ko); s=price('sweet',Kw,Ko)
    print(f"{name:52s} {n:14.2f} {s:14.2f} {(s-n)/n*100:+11.2f}%")
# Fable-ish: read 0.025x
def price2(a,Kw,Kr,Ko):
    d=agg[a]; return (d['fresh'] + Kw*d['write'] + Kr*d['read'] + Ko*d['out'])/d['n']
for name,Kw,Kr,Ko in [('Fable5.1 5m (w1.25,r0.025,o5)',1.25,0.025,5.0)]:
    n=price2('native',Kw,Kr,Ko); s=price2('sweet',Kw,Kr,Ko)
    print(f"{name:52s} {n:14.2f} {s:14.2f} {(s-n)/n*100:+11.2f}%")
print()
# shares vs the brief's rounded table (main-thread only)
for arm in ('native','sweet'):
    d=agg[arm]; tot=(d['fresh']+1.25*d['write'])*0.10 + d['read']*0.01 + d['out']*0.60
    ing=(d['fresh']+1.25*d['write'])*0.10; res=d['read']*0.01; out=d['out']*0.60
    print(f"{arm}: main-only $/rollout(luna shipped)={tot/d['n']/1e6:.6f}  ingest%={ing/tot*100:.1f} resid%={res/tot*100:.1f} out%={out/tot*100:.1f}")
    print(f"    resends per ingested token = {d['read']/(d['fresh']+d['write']):.2f}; ingest tokens/rollout={(d['fresh']+d['write'])/d['n']:.0f}")
print()
# bootstrap on paired task means of costRealizedMainOnlyUsd
import collections
by=collections.defaultdict(dict)
for r in rows:
    by[(r['taskId'],r['rep'])][r['arm']]=r.get('costRealizedMainOnlyUsd')
tasks=sorted({t for (t,_) in by})
def cellmean(sample):
    tn=ts=0.0;c=0
    for t in sample:
        for rep in range(3):
            d=by.get((t,rep))
            if not d or d.get('native') is None or d.get('sweet') is None: continue
            tn+=d['native']; ts+=d['sweet']; c+=1
    return (ts-tn)/tn*100 if tn else None
print("point estimate main-only delta:", f"{cellmean(tasks):+.2f}%", "over", len(tasks),"tasks")
random.seed(42)
b=[cellmean([random.choice(tasks) for _ in tasks]) for _ in range(4000)]
b=[x for x in b if x is not None]; b.sort()
print(f"task-bootstrap 95% CI: [{b[int(0.025*len(b))]:+.2f}%, {b[int(0.975*len(b))]:+.2f}%]  (n={len(tasks)} tasks x3 reps)")
