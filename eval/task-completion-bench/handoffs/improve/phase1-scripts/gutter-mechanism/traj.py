#!/usr/bin/env python3
"""Tool-call storyline for specific cells: opencode pytask TAB vs PIPE, codex gradethis TAB."""
import json, os, re, sys
sys.path.insert(0,'/tmp/gutter-inv')
from census import R, events_codex, events_opencode, trace_files
def story(run,harness,cell,maxn=40):
    for f in sorted(trace_files(run,harness,cell)):
        rd=re.search(r'runs/r(\d+)-\d+',open(f,encoding='utf8',errors='replace').read(20000)); 
        print(f"\n--- {run} {cell} {os.path.basename(f)[:30]}")
        ev={'codex':events_codex,'opencode':events_opencode}[harness](f)
        k=0
        for e in ev:
            if e['kind']!='result': continue
            inp=e['input'] or {}; cmd=str(inp.get('cmd') or inp.get('command') or inp.get('patchText') or '')
            out=(e['output'] or '').replace('\n',' ⏎ ')
            if e['tool'] in ('todowrite','update_plan'): continue
            if 'Begin Patch' in cmd:
                files=re.findall(r'\*\*\* Update File: (\S+)',cmd); hunks=cmd.count('\n@@')
                print(f"  [{e['tool']}] PATCH files={files} hunks={hunks} -> {out[:110]}")
            else:
                print(f"  [{e['tool']}] {cmd[:110]!r} -> {out[:90]}")
            k+=1
            if k>=maxn: print("  ..."); break
story('rb-opencode-20260824','opencode','pytask-dev__pytask-210-sweet')
story('gx-oc-pipe-20260825','opencode','pytask-dev__pytask-210-sweet')
