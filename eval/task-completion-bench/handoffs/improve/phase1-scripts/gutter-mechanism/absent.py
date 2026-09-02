#!/usr/bin/env python3
"""For each claude-code not-found failure whose anchor is absent from the base file: was the
anchor's first line inserted by the agent's own earlier Edit/Write in the same transcript?
Also print exact bytes for the '` please rewrite' case."""
import json, os, re, sys
sys.path.insert(0,'/tmp/gutter-inv')
from census import R, events_claude, trace_files
RUNS=['rb-claudecode-20260824','gx-cc-pipe-20260825','gx-cc-none-20260825']
for run in RUNS:
    for f in trace_files(run,'claude','rstudio-education__gradethis-161-sweet'):
        ev=events_claude(f); inserted=[]  # (idx, text)
        for idx,e in enumerate(ev):
            if e['kind']=='call' and e['tool'] in ('Edit','Write'):
                inserted.append((idx,str((e['input'] or {}).get('new_string') or (e['input'] or {}).get('content') or '')))
            if e['kind']=='result' and e['tool']=='Edit' and e.get('is_error') and 'String to replace not found' in (e['output'] or ''):
                old=str((e['input'] or {}).get('old_string',''))
                first=next((x for x in old.split('\n') if x.strip()),'')
                prior=[i for i,t in inserted if i<idx and first.strip() and first.strip() in t]
                tag='AGENT-INSERTED-EARLIER' if prior else 'not-from-own-edit'
                print(f"{run} {os.path.basename(f)[:8]} :: {first[:60]!r} -> {tag} (prior inserts: {len(prior)})")
                if '` please rewrite' in first:
                    # find the last shown line for it
                    for j in range(idx-1,-1,-1):
                        o=ev[j].get('output') or ''
                        for ln in o.split('\n'):
                            if '` please rewrite with `' in ln:
                                print("    SHOWN :",repr(ln)); print("    ANCHOR:",repr(first)); break
                        else: continue
                        break
