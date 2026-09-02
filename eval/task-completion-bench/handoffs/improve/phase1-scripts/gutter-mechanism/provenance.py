#!/usr/bin/env python3
"""Every edit on the six tasks: which prior tool output showed the anchor's first line,
in what gutter form, from how long a block; plus per-rollout failure grouping."""
import json, os, re, sys, collections
sys.path.insert(0,'/tmp/gutter-inv')
from census import (R, RUNS, SIX, jl, events_codex, events_opencode, events_claude, trace_files, is_edit, classify_fail)
from forensics import anchors_for, strip_gutter
ANCHOR_FAIL={'cc:not-found','ap:expected-lines','ap:context','oc:oldstring-notfound'}
def surface_of(harness,e):
    t=e['tool'] or ''; inp=e['input'] or {}
    cmd=str(inp.get('cmd') or inp.get('command') or '')
    if harness=='claude' and t=='Read': return 'native-Read'
    if harness=='opencode' and t=='read': return 'native-read'
    if harness=='opencode' and t=='grep': return 'native-grep'
    for s in ('ss-read','ss-grep','ss-search','ss-semantic','ss-find','ss-trace'):
        if re.search(r'\b'+s+r'\b',cmd): return s
    m=re.search(r'\b(cat|sed|nl|head|tail|grep|rg|awk|git)\b',cmd)
    if m: return 'shell:'+m.group(1)
    if t in ('exec_command','bash','Bash'): return 'shell:other'
    if is_edit(harness,e): return 'edit-snippet'
    return 'other:'+t
def block_len_around(lines,k):
    """length of the fenced block containing line k (or a run of gutter lines)"""
    a=k
    while a>0 and not lines[a-1].startswith('```'): a-=1
    b=k
    while b<len(lines)-1 and not lines[b+1].startswith('```'): b+=1
    return b-a+1
def main():
    per=collections.defaultdict(collections.Counter)
    rollout_fails=collections.defaultdict(list)
    never=[]
    for run,harness in RUNS.items():
        asd=os.path.join(R,run,'agent-state')
        if not os.path.isdir(asd): continue
        for cell in sorted(os.listdir(asd)):
            m=re.match(r'(.*)-(sweet|native)$',cell)
            if not m: continue
            task,arm=m.groups()
            if task not in SIX: continue
            key=f"{harness}/{arm}/{run}"
            for f in trace_files(run,harness,cell):
                ev={'codex':events_codex,'opencode':events_opencode,'claude':events_claude}[harness](f)
                shown=[]; nfail=0; nedit=0
                for idx,e in enumerate(ev):
                    if e['kind']!='result': continue
                    out=e.get('output') or ''
                    surf=surface_of(harness,e)
                    if out: shown.append((idx,surf,out.split('\n')))
                    et=is_edit(harness,e)
                    if not et: continue
                    fails=[k for k in classify_fail(harness,e) if k in ANCHOR_FAIL]
                    for (fp,anchor,hdr,raw) in anchors_for(harness,e):
                        first=next((x for x in anchor if x.strip()),'')
                        if not first: continue
                        nedit+=1
                        if fails: nfail+=1
                        hit=None
                        for (sidx,surf,ls) in reversed(shown):
                            for k,l in enumerate(ls):
                                if l.strip()==first.strip() or strip_gutter(l).strip()==first.strip():
                                    g='tab' if re.match(r'^\s*\d+\t',l) else 'pipe' if re.match(r'^\d+\| ',l) else 'grep' if re.match(r'^[^\s:]+:\d+[:-]',l) else 'none'
                                    bl=block_len_around(ls,k)
                                    hit=(surf,g,bl); break
                            if hit: break
                        if hit:
                            surf,g,bl=hit
                            per[key][f"{surf}/{g}/{'<15' if bl<15 else '>=15'}"]+=1
                            if fails: per[key][f"FAIL@{surf}/{g}"]+=1
                        else:
                            per[key]['NEVER-SHOWN']+=1
                            if fails: per[key]['FAIL@NEVER-SHOWN']+=1
                            never.append((key,task,first[:80]))
                if nfail: rollout_fails[key].append((task,os.path.basename(f)[:40],nfail,nedit))
                per[key]['rollouts']+=1
                per[key]['rollouts-with-anchor-fail']+= 1 if nfail else 0
    for k in sorted(per):
        print(f"\n== {k}")
        for kk,v in sorted(per[k].items(), key=lambda x:(-x[1],x[0])): print(f"   {v:4d}  {kk}")
    print("\n== rollouts with >=1 anchor failure (task, file, fails, edits)")
    for k in sorted(rollout_fails):
        for r in rollout_fails[k]: print(f"   {k}: {r}")
    print("\n== NEVER-SHOWN anchors (first line) sample")
    for x in never[:40]: print("   ",x)
if __name__=="__main__": main()
