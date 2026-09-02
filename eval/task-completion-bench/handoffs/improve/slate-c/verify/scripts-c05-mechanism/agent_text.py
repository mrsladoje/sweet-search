"""Print short windows of the AGENT'S OWN text (assistant messages / reasoning) around 'fixKeys' in losing cells.
Tool results are excluded. No hidden tests, no gold."""
import json, re
R="/root/sweet-search-private/eval/task-completion-bench/results"
def windows(s, needle, w=160, cap=4):
    out=[]
    for m in re.finditer(re.escape(needle), s):
        out.append(s[max(0,m.start()-w):m.end()+w].replace("\n"," "))
        if len(out)>=cap: break
    return out
def codex(path, edit_marker="Begin Patch"):
    recs=[json.loads(l) for l in open(path) if l.strip()]
    edit_idx=None
    for i,r in enumerate(recs):
        p=r.get("payload",{})
        if r.get("type")=="response_item" and p.get("type")=="function_call" and edit_marker in json.dumps(p.get("arguments","")): edit_idx=i; break
    out=[]
    for i,r in enumerate(recs):
        p=r.get("payload",{})
        if r.get("type")!="response_item": continue
        if p.get("type")=="reasoning":
            txt=" ".join(x.get("text","") for x in (p.get("summary") or []) if isinstance(x,dict)) + " " + json.dumps(p.get("content",""))
        elif p.get("type")=="message" and p.get("role")=="assistant":
            txt=" ".join(c.get("text","") for c in p.get("content",[]) if isinstance(c,dict))
        else: continue
        for wdw in windows(txt,"fixKeys"): out.append(("BEFORE" if edit_idx is not None and i<edit_idx else "AFTER", i, wdw))
    return out
def claude(path):
    recs=[json.loads(l) for l in open(path) if l.strip()]
    edit_idx=None
    for i,r in enumerate(recs):
        if r.get("type")=="assistant" and any(isinstance(c,dict) and c.get("type")=="tool_use" and c.get("name")=="Edit" for c in r.get("message",{}).get("content",[]) if True): edit_idx=i; break
    out=[]
    for i,r in enumerate(recs):
        if r.get("type")!="assistant" or r.get("isSidechain"): continue
        txt=" ".join(c.get("text","") or c.get("thinking","") for c in r.get("message",{}).get("content",[]) if isinstance(c,dict) and c.get("type") in ("text","thinking"))
        for wdw in windows(txt,"fixKeys"): out.append(("BEFORE" if edit_idx is not None and i<edit_idx else "AFTER", i, wdw))
    return out
def opencode(path):
    events=[]
    for l in open(path):
        try: events.append(json.loads(l))
        except Exception: pass
    edit_idx=None
    for i,e in enumerate(events):
        s=json.dumps(e)
        if "apply_patch" in s and "Begin Patch" in s: edit_idx=i; break
    out=[]
    for i,e in enumerate(events):
        part=e.get("part") or e.get("properties",{}).get("part") or {}
        if isinstance(part,dict) and part.get("type") in ("text","reasoning"):
            for wdw in windows(part.get("text",""),"fixKeys"): out.append(("BEFORE" if edit_idx is not None and i<edit_idx else "AFTER", i, wdw))
    return out
cx=R+"/fp-codex-tab-20260826/agent-state/accenture__sfmc-devtools-1974-"
S=cx+"native/codex-home/sessions/2026/08/26/"
cells=[("c:n0",codex,S+"rollout-2026-08-26T22-33-59-01a04035-710a-7072-8e45-e7fbf5a02081.jsonl"),
       ("c:n1",codex,S+"rollout-2026-08-26T22-36-07-01a04037-648f-7c01-b71a-7c91683a478f.jsonl"),
       ("c:n2",codex,S+"rollout-2026-08-26T22-38-01-01a04039-2392-7b11-8388-01192d99c935.jsonl"),
       ("c:s0",codex,cx+"sweet/codex-home/sessions/2026/08/26/rollout-2026-08-26T22-28-06-01a04030-0d43-7062-bfac-05358042a140.jsonl"),
       ("cc:s1",claude,R+"/fp-claudecode-tab-20260826/agent-state/accenture__sfmc-devtools-1974-sweet/claude-home/projects/-root--ss-eval-runs-r1-4/9a58975e-cfbc-4f2b-b287-4412f8502782.jsonl"),
       ("o:n1",opencode,R+"/fp-opencode-tab-20260826/agent-state/accenture__sfmc-devtools-1974-native/opencode-retained/session-1787754354348-1040662-3a09e376/attempt-1.stdout.ndjson")]
for tag,fn,f in cells:
    res=fn(f)
    print("=====",tag,"agent-text windows mentioning fixKeys:",len(res))
    for pos,i,w in res[:4]: print("  [%s idx %d] %s"%(pos,i,w[:360]))
