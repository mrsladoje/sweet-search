#!/usr/bin/env python3
"""codex exec_command truncation: shape, counts per condition, and token cost of identical
ss-read commands across TAB/PIPE/NONE (codex reports 'Original token count' per output)."""
import json, os, re, sys, collections
sys.path.insert(0,'/tmp/gutter-inv')
from census import R, SIX, events_codex, trace_files
COND={'TAB':'rb-codex-20260825','PIPE':'gab-pipe-20260825','NONE':'gab-none-20260825'}
tok=collections.defaultdict(dict)  # cmd -> cond -> [token counts]
trunc=collections.Counter(); calls=collections.Counter(); shown=False
for cond,run in COND.items():
    asd=os.path.join(R,run,'agent-state')
    for cell in sorted(os.listdir(asd)):
        m=re.match(r'(.*)-(sweet|native)$',cell)
        if not m or m.group(1) not in SIX: continue
        arm=m.group(2)
        if arm!='sweet' and cond!='TAB': continue
        for f in trace_files(run,'codex',cell):
            for e in events_codex(f):
                if e['kind']!='result' or e['tool']!='exec_command': continue
                out=e['output'] or ''; inp=e['input'] or {}
                cmd=str(inp.get('cmd','')); cap=inp.get('max_output_tokens')
                key=f"{cond}/{arm}"
                calls[key]+=1
                mt=re.search(r'Original token count: (\d+)',out)
                if 'Warning: truncated output' in out:
                    trunc[key]+=1
                    if re.search(r'\bss-read\b',cmd): trunc[key+'/ss-read']+=1
                    if not shown:
                        shown=True
                        print("=== TRUNCATION SHAPE (first truncated output), cmd=",cmd[:100],"cap=",cap)
                        print(repr(out[:900])); print('   ...'); print(repr(out[-700:]))
                if arm=='sweet' and re.fullmatch(r"\s*ss-read \S+ \d+ \d+\s*",cmd) and mt:
                    tok[cmd.strip()].setdefault(cond,[]).append(int(mt.group(1)))
print("\n=== exec_command calls and truncations per condition/arm")
for k in sorted(calls): print(f"  {k:12s} calls={calls[k]:4d} truncated={trunc[k]:3d} truncated-ss-read={trunc[k+'/ss-read']:3d}")
print("\n=== identical ss-read commands seen in >=2 conditions: reported token counts")
n=0
for cmd,d in tok.items():
    if len(d)>=2:
        n+=1
        print(f"  {cmd:55s} "+"  ".join(f"{c}={min(v)}" for c,v in sorted(d.items())))
        if n>=25: break
# aggregate ratio
ratios=collections.defaultdict(list)
for cmd,d in tok.items():
    if 'NONE' in d:
        for c in ('TAB','PIPE'):
            if c in d: ratios[c].append(min(d[c])/max(1,min(d['NONE'])))
for c,v in ratios.items(): print(f"  mean token ratio {c}/NONE over {len(v)} identical reads: {sum(v)/len(v):.3f}")
