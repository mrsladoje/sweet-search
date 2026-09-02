#!/usr/bin/env python3
"""Conservative variant: scale BODY chars only (first gutter line -> cut), excluding the
rank header and any leading graph-edge lines, so the per-line rate is not inflated."""
import json, os, re, sys, statistics, collections
sys.path.insert(0,'/tmp/fp-inv/e1')
from importlib.machinery import SourceFileLoader
from e1_common import pool, transcripts, events_codex, cmd_of
t1 = SourceFileLoader('t1c','/tmp/fp-inv/trunc/t1-census.py').load_module()
MARK=t1.MARK
H_RANK=re.compile(r'^## #(\d+) (\S+?):(\d+)-(\d+)(?: \[([^\]]*)\])? \(([^)]*)\)',re.M)
GUT=re.compile(r'^\s*(\d+)\t',re.M)
rows=[]
for task in pool():
    for path,_ in transcripts('fp-codex-tab-20260826','codex',f'{task}-sweet'):
        ev,_t=events_codex(path)
        for i,e in enumerate([x for x in ev if x.get('kind')=='result']):
            out=e.get('output') or ''; ms=list(MARK.finditer(out))
            if not ms: continue
            cmd=cmd_of('codex',e)
            if 'ss-search' not in cmd: continue
            head=out[:ms[0].start()]; hs=list(H_RANK.finditer(head))
            if not hs: continue
            h=hs[-1]; rank=int(h.group(1)); lo=int(h.group(3)); hi=int(h.group(4))
            blk=head[h.start():]; g=list(GUT.finditer(blk))
            if not g: continue
            before_n=int(g[-1].group(1))
            if before_n>=hi: continue                      # body already complete at the cut
            body=blk[g[0].start():]                        # first numbered line -> cut
            dl=before_n-lo+1
            if dl<=0: continue
            rows.append(dict(task=task,transcript=os.path.basename(path),call=i,rank=rank,
                subcmds=len(t1.split_subcmds(cmd)),lo=lo,hi=hi,decl=hi-lo+1,delivered=dl,
                body_chars=len(body),cpl=len(body)/dl,est_body=int(round(len(body)/dl*(hi-lo+1)))))
def rep(sel,lbl):
    print('\n== %s n=%d'%(lbl,len(sel)))
    if not sel: return
    e=sorted(r['est_body'] for r in sel)
    print('  est COMPLETE BODY chars (conservative): median %d p10 %d max %d'%(statistics.median(e),e[int(.1*(len(e)-1))],e[-1]))
    for cap in (4800,5190):
        print('  > %d chars: %d of %d'%(cap,sum(1 for x in e if x>cap),len(e)))
    print('  chars/line median %.1f'%statistics.median([r['cpl'] for r in sel]))
rep(rows,'all in-body ss-search cuts')
rep([r for r in rows if r['subcmds']==1],'single-command (addressable)')
rep([r for r in rows if r['rank']==1],'rank 1')
rep([r for r in rows if r['rank']==1 and r['subcmds']==1],'rank 1, single command')
json.dump(rows,open('/tmp/wf-slatec/c07-history/c07-rank1b.json','w'),indent=1)
