#!/usr/bin/env python3
"""codex sweet, six tasks: for every edit anchor never shown by any tool output, was its line
inside a span that a prior ss-read output had truncated away (middle-out cap)?"""
import json, os, re, sys, collections
sys.path.insert(0,'/tmp/gutter-inv')
from census import R, SIX, events_codex, trace_files, is_edit
from forensics import golden_for, resolve, anchors_for, strip_gutter
COND={'TAB':'rb-codex-20260825','PIPE':'gab-pipe-20260825','NONE':'gab-none-20260825'}
res=collections.Counter()
for cond,run in COND.items():
    asd=os.path.join(R,run,'agent-state')
    for cell in sorted(os.listdir(asd)):
        m=re.match(r'(.*)-(sweet)$',cell)
        if not m or m.group(1) not in SIX: continue
        task=m.group(1); gold=golden_for(task)
        for f in trace_files(run,'codex',cell):
            ev=events_codex(f); shown=[]; gaps=[]  # gaps: (file, lo, hi) line ranges dropped by truncation
            for idx,e in enumerate(ev):
                if e['kind']!='result': continue
                out=e['output'] or ''; cmd=str((e['input'] or {}).get('cmd',''))
                if out: shown.append(out.split('\n'))
                if 'Warning: truncated output' in out:
                    cur=None; prev=None
                    for ln in out.split('\n'):
                        h=re.match(r'^# ss-read (\S+)',ln)
                        if h: cur=h.group(1); prev=None; continue
                        g=re.match(r'^(\d+)(\t|\| )',ln)
                        if g and cur:
                            n=int(g.group(1))
                            if prev is not None and n>prev+1: gaps.append((cur,prev,n))
                            prev=n
                        elif cur and '…' in ln and 'tokens truncated' in ln and not g:
                            pass
                    if cond=='NONE':  # no numbers: record the file as 'truncated somewhere'
                        for h in re.findall(r'^# ss-read (\S+)',out,re.M): gaps.append((h,-1,-1))
                if not is_edit('codex',e): continue
                for (fp,anchor,hdr,raw) in anchors_for('codex',e):
                    first=next((x for x in anchor if x.strip()),'')
                    if not first: continue
                    seen=any(any(l.strip()==first.strip() or strip_gutter(l).strip()==first.strip() for l in ls) for ls in shown[:-1] if True)
                    if seen: res[cond+':shown']+=1; continue
                    res[cond+':never-shown']+=1
                    abs_=resolve(gold,fp)
                    if not abs_: res[cond+':never-shown:no-golden']+=1; continue
                    sl=open(abs_,encoding='utf8',errors='replace').read().split('\n')
                    pos=[i+1 for i,l in enumerate(sl) if l.strip()==first.strip()]
                    base=os.path.basename(fp)
                    hit=any(os.path.basename(g[0])==base and (g[1]==-1 or any(g[1]<p<g[2] for p in pos)) for g in gaps)
                    res[cond+(':never-shown:IN-TRUNCATED-SPAN' if hit else ':never-shown:not-in-truncated-span')]+=1
for k,v in sorted(res.items()): print(f"  {v:4d} {k}")
