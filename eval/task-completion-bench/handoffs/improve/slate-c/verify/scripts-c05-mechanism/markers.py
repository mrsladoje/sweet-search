"""For each losing-cell transcript: did the caller code reach the agent BEFORE its guard edit?
Splits hits into tool-result text vs the agent's own text, and reports the index of the first
tool-result hit vs the index of the edit call. Markers are base-tree strings (no gold, no hidden tests)."""
import json, re, sys
R="/root/sweet-search-private/eval/task-completion-bench/results"
MARK={"fixKeys":"fixKeys","callExpr":"selectedTypesArr || selectedTypesObj","filterLine":"selectedTypesArr = selectedTypes.filter","replaceCb":"replaceCbReference","runMethodCallers":"this.#runMethod(","testFixKeysEvent":"fixKeys"}
def codex(path):
    recs=[json.loads(l) for l in open(path) if l.strip()]
    out=[]; edit_idx=None; first_tool={}; agent_hits={}; toolhits={}
    for i,r in enumerate(recs):
        if r.get("type")!="response_item": continue
        p=r.get("payload",{}); t=p.get("type")
        if t=="function_call":
            a=json.dumps(p.get("arguments",""))
            if "apply_patch" in a and edit_idx is None and ("*** Begin Patch" in a or "Begin Patch" in a): edit_idx=i
        s=json.dumps(p)
        kind = "tool" if t=="function_call_output" else ("agent" if t in ("message","reasoning") and (p.get("role")=="assistant" or t=="reasoning") else None)
        if not kind: continue
        for k,m in MARK.items():
            n=s.count(m)
            if not n: continue
            if kind=="tool":
                toolhits[k]=toolhits.get(k,0)+n
                first_tool.setdefault(k,i)
            else: agent_hits[k]=agent_hits.get(k,0)+n
    return dict(records=len(recs), editIdx=edit_idx, toolHits=toolhits, firstToolHitIdx=first_tool, agentHits=agent_hits,
                before_edit={k:(v<edit_idx) for k,v in first_tool.items()} if edit_idx is not None else None)
def claude(path):
    recs=[json.loads(l) for l in open(path) if l.strip()]
    edit_idx=None; first_tool={}; agent_hits={}; toolhits={}
    for i,r in enumerate(recs):
        if r.get("isSidechain"): continue
        typ=r.get("type"); msg=r.get("message",{}); content=msg.get("content",[])
        if typ=="assistant":
            for c in content if isinstance(content,list) else []:
                if isinstance(c,dict) and c.get("type")=="tool_use" and c.get("name")=="Edit" and edit_idx is None: edit_idx=i
            s=json.dumps([c for c in content if isinstance(c,dict) and c.get("type") in ("text","thinking")]) if isinstance(content,list) else json.dumps(content)
            kind="agent"
        elif typ=="user":
            s=json.dumps([c for c in content if isinstance(c,dict) and c.get("type")=="tool_result"]) if isinstance(content,list) else ""
            kind="tool"
        else: continue
        for k,m in MARK.items():
            n=s.count(m)
            if not n: continue
            if kind=="tool": toolhits[k]=toolhits.get(k,0)+n; first_tool.setdefault(k,i)
            else: agent_hits[k]=agent_hits.get(k,0)+n
    return dict(records=len(recs), editIdx=edit_idx, toolHits=toolhits, firstToolHitIdx=first_tool, agentHits=agent_hits,
                before_edit={k:(v<edit_idx) for k,v in first_tool.items()} if edit_idx is not None else None)
def opencode(path):
    events=[]
    for l in open(path):
        try: events.append(json.loads(l))
        except Exception: pass
    edit_idx=None; first_tool={}; agent_hits={}; toolhits={}
    for i,e in enumerate(events):
        s=json.dumps(e)
        if edit_idx is None and "apply_patch" in s and "Begin Patch" in s: edit_idx=i
        # opencode: tool parts carry "output"; text parts carry "text"
        part=e.get("part") or e.get("properties",{}).get("part") or {}
        kind=None
        if isinstance(part,dict):
            if part.get("type")=="tool": kind="tool"; s=json.dumps(part.get("state",{}).get("output","")) + json.dumps(part.get("state",{}).get("input",""))
            elif part.get("type") in ("text","reasoning"): kind="agent"; s=json.dumps(part.get("text",""))
        if not kind: continue
        for k,m in MARK.items():
            n=s.count(m)
            if not n: continue
            if kind=="tool": toolhits[k]=toolhits.get(k,0)+n; first_tool.setdefault(k,i)
            else: agent_hits[k]=agent_hits.get(k,0)+n
    return dict(events=len(events), editIdx=edit_idx, toolHits=toolhits, firstToolHitIdx=first_tool, agentHits=agent_hits,
                before_edit={k:(v<edit_idx) for k,v in first_tool.items()} if edit_idx is not None else None)
cx=R+"/fp-codex-tab-20260826/agent-state/accenture__sfmc-devtools-1974-"
S=cx+"native/codex-home/sessions/2026/08/26/"
for tag,f in [("c:n0 LOSER",S+"rollout-2026-08-26T22-33-59-01a04035-710a-7072-8e45-e7fbf5a02081.jsonl"),("c:n1 LOSER",S+"rollout-2026-08-26T22-36-07-01a04037-648f-7c01-b71a-7c91683a478f.jsonl"),("c:n2 LOSER",S+"rollout-2026-08-26T22-38-01-01a04039-2392-7b11-8388-01192d99c935.jsonl")]:
    print(tag, json.dumps(codex(f)))
S=cx+"sweet/codex-home/sessions/2026/08/26/"
for tag,f in [("c:s0 LOSER",S+"rollout-2026-08-26T22-28-06-01a04030-0d43-7062-bfac-05358042a140.jsonl"),("c:s2 solved",S+"rollout-2026-08-26T22-32-13-01a04033-d1de-7de0-a0ad-d607ce4410e3.jsonl")]:
    print(tag, json.dumps(codex(f)))
C=R+"/fp-claudecode-tab-20260826/agent-state/accenture__sfmc-devtools-1974-sweet/claude-home/projects/"
for tag,f in [("cc:s1 LOSER",C+"-root--ss-eval-runs-r1-4/9a58975e-cfbc-4f2b-b287-4412f8502782.jsonl"),("cc:s0 solved",C+"-root--ss-eval-runs-r0-2/06410609-3d01-4f09-b69d-7e396d378a1b.jsonl")]:
    print(tag, json.dumps(claude(f)))
O=R+"/fp-opencode-tab-20260826/agent-state/accenture__sfmc-devtools-1974-native/opencode-retained/"
for tag,f in [("o:n0? solved",O+"session-1787754243277-1040662-56b2576c/attempt-1.stdout.ndjson"),("o:n1? LOSER",O+"session-1787754354348-1040662-3a09e376/attempt-1.stdout.ndjson"),("o:n2? solved",O+"session-1787754473387-1040662-0a9f0a03/attempt-1.stdout.ndjson")]:
    print(tag, json.dumps(opencode(f)))
