#!/usr/bin/env python3
"""p2 v2 — per-case raw bytes with block provenance (which tool produced it,
whether it is an error echo) and an exact anchor-vs-disk indent diff."""
import json, sys, os, re, glob, argparse

RES = '/root/sweet-search-private/eval/task-completion-bench/results'
GOLD = '/root/.ss-eval/golden'

def esc(s): return s.replace('\\','\\\\').replace('\t','\\t')
def ind(s):
    m = re.match(r'^[ \t]*', s).group(0)
    return f"{len(m)}ch[{esc(m)}]"

def load_jsonl(p):
    out=[]
    with open(p,'r',errors='replace') as f:
        for ln in f:
            ln=ln.strip()
            if not ln: continue
            try: out.append(json.loads(ln))
            except Exception: pass
    return out

def cc_blocks(recs):
    seen_use, seen_res = {}, set()
    order=[]
    for r in recs:
        msg=r.get('message') or {}
        c=msg.get('content')
        if not isinstance(c,list): continue
        for b in c:
            if not isinstance(b,dict): continue
            t=b.get('type')
            if t=='tool_use':
                if b.get('id') in seen_use: continue
                seen_use[b.get('id')]=b.get('name')
                order.append(('use',b))
            elif t=='tool_result':
                if b.get('tool_use_id') in seen_res: continue
                seen_res.add(b.get('tool_use_id'))
                order.append(('res',b))
    return order, seen_use

def res_text(b):
    c=b.get('content')
    if isinstance(c,str): return c
    if isinstance(c,list): return '\n'.join(x.get('text','') for x in c if isinstance(x,dict))
    return ''

def tool_of(b, names):
    return names.get(b.get('tool_use_id'), '?')

def find_gold(task, path):
    rel=re.sub(r'^/root/\.ss-eval/runs/[^/]+/','',path)
    base=task.rsplit('-',1)[0].lower()
    for d in os.listdir(GOLD):
        if d.split('@')[0].lower()==base:
            gp=os.path.join(GOLD,d,rel)
            if os.path.exists(gp): return gp
    return None

def run(c):
    tr=os.path.join(RES,c['transcript'])
    recs=load_jsonl(tr)
    order,names=cc_blocks(recs)
    idx=None
    for n,(k,b) in enumerate(order):
        if k=='use' and b.get('id')==c['call_id']: idx=n;break
    if idx is None: print('!! not found',c['call_id']); return
    use=order[idx][1]; inp=use.get('input') or {}
    old=inp.get('old_string') or ''
    fp=inp.get('file_path','')
    print('='*100)
    print('CASE',c.get('idx'),c['transcript'].split('/')[0],'|',c['transcript'].split('/')[2])
    print('CALL',c['call_id'],'tool',use.get('name'),'file',fp)
    gp=find_gold(c['task'],fp)
    disk=open(gp,'r',errors='replace').read().split('\n') if gp else None
    print('GOLD',gp)
    # locate the anchor in the golden by its first line's stripped text
    alines=old.split('\n')
    base=None
    if disk:
        probe=alines[0].strip()
        cand=[i+1 for i,l in enumerate(disk) if l.strip()==probe and probe]
        base=cand[0] if cand else None
        print('anchor first line occurs at disk lines',cand[:6],'(n=%d)'%len(cand))
    print('--- anchor vs disk, indent compared ---')
    for j,ln in enumerate(alines):
        dl = disk[base-1+j] if (disk and base and base-1+j < len(disk)) else None
        same = (dl==ln)
        mark='==' if same else '!!'
        print(f'  {mark} a{j:<2} anchor {ind(ln):<14} {esc(ln)[:80]!r}')
        if not same and dl is not None:
            print(f'        disk{base+j:<5} {ind(dl):<14} {esc(dl)[:80]!r}')
    print('--- earlier tool_results containing the anchor first line ---')
    probe=alines[0].strip()
    hits=0
    for n in range(idx-1,-1,-1):
        k,b=order[n]
        if k!='res': continue
        txt=res_text(b)
        if probe and probe in txt:
            tn=tool_of(b,names)
            err = 'tool_use_error' in txt or b.get('is_error')
            for l in txt.split('\n'):
                if probe in l:
                    print(f'  block{n:<4} tool={tn:<12} err={bool(err)!s:<5} {ind(l):<14} {esc(l)[:90]!r}')
                    break
            hits+=1
            if hits>=6: break
    if hits==0: print('  (never shown)')
    print()

if __name__=='__main__':
    ap=argparse.ArgumentParser(); ap.add_argument('--cases',required=True)
    a=ap.parse_args()
    for c in json.load(open(a.cases)): run(c)
