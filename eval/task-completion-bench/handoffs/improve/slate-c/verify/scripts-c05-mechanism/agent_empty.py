"""Agent's own text (not tool results) in the six losing cells: windows around 'empty' and the final rationale."""
import json, re
R="/root/sweet-search-private/eval/task-completion-bench/results"
def win(s, needle, w=170, cap=3):
    return [s[max(0,m.start()-w):m.end()+w].replace("\n"," ") for m in list(re.finditer(needle, s, re.I))[:cap]]
def codex(path):
    recs=[json.loads(l) for l in open(path) if l.strip()]
    txts=[]
    for r in recs:
        p=r.get("payload",{})
        if r.get("type")!="response_item": continue
        if p.get("type")=="reasoning": txts.append(" ".join(x.get("text","") for x in (p.get("summary") or []) if isinstance(x,dict)))
        elif p.get("type")=="message" and p.get("role")=="assistant": txts.append(" ".join(c.get("text","") for c in p.get("content",[]) if isinstance(c,dict)))
    return txts
def claude(path):
    recs=[json.loads(l) for l in open(path) if l.strip()]
    return [" ".join(c.get("text","") or c.get("thinking","") for c in r.get("message",{}).get("content",[]) if isinstance(c,dict) and c.get("type") in ("text","thinking")) for r in recs if r.get("type")=="assistant" and not r.get("isSidechain")]
def opencode(path):
    out=[]
    for l in open(path):
        try: e=json.loads(l)
        except Exception: continue
        part=e.get("part") or e.get("properties",{}).get("part") or {}
        if isinstance(part,dict) and part.get("type") in ("text","reasoning"): out.append(part.get("text",""))
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
    txts=[t for t in fn(f) if t and t.strip()]
    joined="\n".join(txts)
    print("=====",tag,"agent text blocks:",len(txts),"| mentions of 'empty':",len(re.findall(r"empty",joined,re.I)),"| 'caller':",len(re.findall(r"caller",joined,re.I)))
    for w in win(joined, r"empty")[:3]: print("   EMPTY>", w[:340])
    print("   FINAL>", (txts[-1] if txts else "")[:500].replace("\n"," "))
