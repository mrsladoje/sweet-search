#!/usr/bin/env python3
"""codex: (1) truncation shape inside an ss-read output; (2) tokens-per-line by condition from
codex's own 'Original token count' over every plain ss-read call; (3) share of ss-read outputs over the cap."""
import json, os, re, sys, collections
sys.path.insert(0,'/tmp/gutter-inv')
from census import R, SIX, events_codex, trace_files
COND={'TAB':'rb-codex-20260825','PIPE':'gab-pipe-20260825','NONE':'gab-none-20260825'}
shape_done=False
stats=collections.defaultdict(lambda: {'n':0,'tok':0,'lines':0,'trunc':0,'over2500':0})
for cond,run in COND.items():
    asd=os.path.join(R,run,'agent-state')
    for cell in sorted(os.listdir(asd)):
        m=re.match(r'(.*)-(sweet)$',cell)
        if not m or m.group(1) not in SIX: continue
        for f in trace_files(run,'codex',cell):
            for e in events_codex(f):
                if e['kind']!='result' or e['tool']!='exec_command': continue
                out=e['output'] or ''; cmd=str((e['input'] or {}).get('cmd',''))
                if not re.fullmatch(r"\s*ss-read \S+( \d+( \d+)?)?\s*",cmd): continue
                mt=re.search(r'Original token count: (\d+)',out)
                if not mt: continue
                tokc=int(mt.group(1))
                body=out.split('Output:\n',1)[1] if 'Output:\n' in out else out
                nl=body.count('\n')
                s=stats[cond]; s['n']+=1; s['tok']+=tokc; s['lines']+=nl
                tr='Warning: truncated output' in out
                if tr: s['trunc']+=1
                if tokc>2500: s['over2500']+=1
                if tr and not shape_done and re.search(r'^\d+(\t|\| )',body,re.M):
                    shape_done=True
                    ls=body.split('\n')
                    print(f"=== TRUNCATION SHAPE in ss-read output ({cond}) cmd={cmd.strip()} tokens={tokc} lines={nl}")
                    prev=None
                    for i,l in enumerate(ls):
                        mm=re.match(r'^(\d+)(\t|\| )',l)
                        if mm:
                            n=int(mm.group(1))
                            if prev is not None and n!=prev+1:
                                for k in range(max(0,i-3),min(len(ls),i+3)): print(f"   {k:4d} {ls[k][:100]!r}")
                                print("   (line-number jump: %d -> %d)"%(prev,n))
                            prev=n
                    print("   head:",repr(body[:200])); print("   tail:",repr(body[-200:]))
print("\n=== plain ss-read calls per condition (sweet, six tasks): codex-reported tokens")
for c in ('NONE','TAB','PIPE'):
    s=stats[c]
    if s['n']: print(f"  {c:5s} n={s['n']:3d} tokens/line={s['tok']/max(1,s['lines']):.3f} mean_tokens={s['tok']/s['n']:.0f} mean_lines={s['lines']/s['n']:.0f} truncated={s['trunc']} over2500tok={s['over2500']}")
