#!/usr/bin/env python3
"""For apply_patch failures whose quoted lines DO exist verbatim in the base file: are the
patch's chunks out of file order (apply_patch seeks forward from a moving index)?"""
import json, os, re, sys
sys.path.insert(0,'/tmp/gutter-inv')
from census import R, SIX, events_codex, events_opencode, trace_files, is_edit
from forensics import golden_for, resolve, patch_chunks
CASES=[('rb-codex-20260825','codex','rstudio-education__gradethis-161-sweet'),
       ('gx-oc-none-20260825','opencode','rstudio-education__gradethis-161-sweet'),
       ('rb-opencode-20260824','opencode','rstudio-education__gradethis-161-sweet'),
       ('rb-codex-20260825','codex','rstudio-education__gradethis-161-native')]
for run,h,cell in CASES:
    task=cell.rsplit('-',1)[0]; gold=golden_for(task)
    for f in trace_files(run,h,cell):
        ev={'codex':events_codex,'opencode':events_opencode}[h](f)
        for e in ev:
            if e['kind']!='result' or not is_edit(h,e): continue
            out=e['output'] or ''
            if 'Failed to find expected lines' not in out: continue
            inp=e['input'] or {}
            src=str(inp.get('cmd') or inp.get('patchText') or '')
            m=re.search(r'\*\*\* Begin Patch.*?\*\*\* End Patch',src,re.S)
            if not m: continue
            chunks=patch_chunks(m.group(0))
            byfile={}
            for fp,anchor,hdr,raw in chunks: byfile.setdefault(fp,[]).append(anchor)
            for fp,ancs in byfile.items():
                abs_=resolve(gold,fp)
                if not abs_: continue
                sl=open(abs_,encoding='utf8',errors='replace').read().split('\n')
                pos=[]
                for a in ancs:
                    first=next((x for x in a if x.strip()),None)
                    idx=[i+1 for i,l in enumerate(sl) if first is not None and l.strip()==first.strip()]
                    pos.append(idx[:3])
                quoted=re.search(r'Failed to find expected lines in \S+:\n([^\n]*)',out)
                q=quoted.group(1)[:60] if quoted else None
                print(f"{run} {os.path.basename(f)[:14]} {os.path.basename(fp)}: chunk first-line positions in base = {pos}  failed-quoted={q!r}")
