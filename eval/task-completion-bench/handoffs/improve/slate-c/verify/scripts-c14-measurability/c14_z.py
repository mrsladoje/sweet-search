import json
base='/root/sweet-search-private/eval/task-completion-bench/results/fp-claudecode-tab-20260826'
rows=json.load(open(base+'/rows.json'))
def luna(u):
    return ((u.get('input_tokens') or 0)*0.10 + (u.get('cache_creation_input_tokens') or 0)*0.125
            + (u.get('cache_read_input_tokens') or 0)*0.01 + (u.get('output_tokens') or 0)*0.60)/1e6
bad=set()
for r in rows:
    u=r.get('usage') or {}; y=r.get('costRealizedMainOnlyUsd')
    if isinstance(y,(int,float)) and abs(luna(u)-y)>1e-6: bad.add((r['taskId'],r['arm'],r['rep']))
# drop the whole task x rep CELL (both arms) so the exclusion is balanced
badcells={(t,rep) for (t,a,rep) in bad}
agg={}
for arm in ('native','sweet'):
    F=W=R=O=0; n=0
    for r in rows:
        if r['arm']!=arm: continue
        if (r['taskId'],r['rep']) in badcells: continue
        u=r.get('usage') or {}
        F+=u.get('input_tokens') or 0; W+=u.get('cache_creation_input_tokens') or 0
        R+=u.get('cache_read_input_tokens') or 0; O+=u.get('output_tokens') or 0; n+=1
    agg[arm]=dict(n=n,fresh=F,write=W,read=R,out=O)
print("balanced-exclusion cells dropped:",len(badcells),"->",agg['native']['n'],"rows/arm")
def price(a,Kw,Kr,Ko):
    d=agg[a]; return (d['fresh']+Kw*d['write']+Kr*d['read']+Ko*d['out'])/d['n']
print(f"{'vector':46s} {'sweet-native':>12s}")
for name,Kw,Kr,Ko in [('luna as SHIPPED (w1.25, r0.10, o6.0)',1.25,0.10,6.0),
                      ('luna w/o write surcharge (w1.00)',1.00,0.10,6.0),
                      ('Anthropic 5m (w1.25, r0.10, o5.0)',1.25,0.10,5.0),
                      ('Anthropic 1h (w2.00, r0.10, o5.0)',2.00,0.10,5.0),
                      ('Fable5.1 5m (w1.25, r0.025, o5.0)',1.25,0.025,5.0)]:
    n=price('native',Kw,Kr,Ko); s=price('sweet',Kw,Kr,Ko)
    print(f"{name:46s} {(s-n)/n*100:+11.2f}%")
d=agg['native']; e=agg['sweet']
print("ingest/rollout native %.0f sweet %.0f (+%.1f%%)"%((d['fresh']+d['write'])/d['n'],(e['fresh']+e['write'])/e['n'],
      ((e['fresh']+e['write'])/e['n'])/((d['fresh']+d['write'])/d['n'])*100-100))
print("resends/ingested native %.2f sweet %.2f (%.1f%%)"%(d['read']/(d['fresh']+d['write']), e['read']/(e['fresh']+e['write']),
      (e['read']/(e['fresh']+e['write']))/(d['read']/(d['fresh']+d['write']))*100-100))
