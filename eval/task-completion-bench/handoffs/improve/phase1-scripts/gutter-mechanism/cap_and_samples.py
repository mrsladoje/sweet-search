#!/usr/bin/env python3
import json, os, re, sys, collections
sys.path.insert(0,'/tmp/gutter-inv')
from census import R, SIX, events_codex, events_claude, trace_files
# 1) pin the codex cap empirically over ALL exec_command outputs in the 6-task cells (3 runs, both arms)
mx_ok=0; mn_tr=10**9; n=0
for run in ('rb-codex-20260825','gab-pipe-20260825','gab-none-20260825'):
    asd=os.path.join(R,run,'agent-state')
    for cell in os.listdir(asd):
        m=re.match(r'(.*)-(sweet|native)$',cell)
        if not m or m.group(1) not in SIX: continue
        for f in trace_files(run,'codex',cell):
            for e in events_codex(f):
                if e['kind']!='result' or e['tool']!='exec_command': continue
                out=e['output'] or ''
                mt=re.search(r'Original token count: (\d+)',out)
                if not mt: continue
                t=int(mt.group(1)); n+=1
                if 'Warning: truncated output' in out: mn_tr=min(mn_tr,t)
                else: mx_ok=max(mx_ok,t)
print(f"codex cap pin: outputs={n} max untruncated tokens={mx_ok}  min truncated tokens={mn_tr}")
# 2) an ss-search output sample from codex sweet (to see whether hits carry a gutter)
done=False
asd=os.path.join(R,'rb-codex-20260825','agent-state')
for cell in sorted(os.listdir(asd)):
    if done or not cell.endswith('-sweet'): continue
    for f in trace_files('rb-codex-20260825','codex',cell):
        for e in events_codex(f):
            if e['kind']!='result' or e['tool']!='exec_command': continue
            cmd=str((e['input'] or {}).get('cmd',''))
            if re.fullmatch(r'\s*ss-search [^;&|]*',cmd) and '## #' in (e['output'] or ''):
                out=e['output']; i=out.find('## #1'); print("\n=== ss-search sample:",cmd.strip()[:80]); print(out[i:i+900]); done=True; break
        if done: break
# 3) map claude PIPE failures to rundir + resolution
rows=json.load(open(os.path.join(R,'gx-cc-pipe-20260825','rows.json')))
byrep={(r['taskId'],r.get('rep')):r for r in rows}
asd=os.path.join(R,'gx-cc-pipe-20260825','agent-state','rstudio-education__gradethis-161-sweet')
print("\n=== claude PIPE gradethis: failures per transcript")
for f in trace_files('gx-cc-pipe-20260825','claude','rstudio-education__gradethis-161-sweet'):
    rd=re.search(r'runs-r(\d+)-(\d+)',f); rep=int(rd.group(1)) if rd else None
    fails=[]
    for e in events_claude(f):
        if e['kind']=='result' and e['tool']=='Edit' and e.get('is_error') and 'String to replace not found' in (e['output'] or ''):
            fails.append(str((e['input'] or {}).get('old_string',''))[:50])
    r=byrep.get(('rstudio-education__gradethis-161',rep),{})
    print(f"  rep{rep} {os.path.basename(f)[:12]} resolved={r.get('resolved')} f2p={r.get('f2pFrac')} not-found={len(fails)} :: {fails}")
