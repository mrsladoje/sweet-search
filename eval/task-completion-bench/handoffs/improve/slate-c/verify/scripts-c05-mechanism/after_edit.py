import json, sys, re
R="/root/sweet-search-private/eval/task-completion-bench/results"
def codex(path):
    recs=[json.loads(l) for l in open(path) if l.strip()]
    calls=[i for i,r in enumerate(recs) if r.get("type")=="response_item" and r.get("payload",{}).get("type")=="function_call"]
    edits=[i for i in calls if "apply_patch" in json.dumps(recs[i].get("payload",{}).get("arguments",""))]
    if not edits: return ("no apply_patch", len(calls))
    last=edits[-1]
    after=[i for i in calls if i>last]
    names=[recs[i]["payload"].get("name") for i in after]
    rt=sum(1 for i in after if "run_tests" in json.dumps(recs[i]["payload"].get("arguments","")))
    return dict(total_calls=len(calls), edits=len(edits), calls_after_last_edit=len(after), run_tests_after=rt, names_after=names[:12])
def claude(path):
    recs=[json.loads(l) for l in open(path) if l.strip()]
    asst=[i for i,r in enumerate(recs) if r.get("type")=="assistant" and not r.get("isSidechain")]
    ids=[]; seen=set()
    for i in asst:
        mid=recs[i].get("message",{}).get("id")
        if mid not in seen: seen.add(mid); ids.append(i)
    edit_idx=[i for i in asst if any(c.get("type")=="tool_use" and c.get("name")=="Edit" for c in recs[i].get("message",{}).get("content",[]) if isinstance(c,dict))]
    if not edit_idx: return ("no Edit", len(ids))
    last=edit_idx[-1]
    after=[i for i in ids if i>last]
    tools_after=[c.get("name") for i in after for c in recs[i].get("message",{}).get("content",[]) if isinstance(c,dict) and c.get("type")=="tool_use"]
    return dict(requests=len(ids), edits=len(edit_idx), requests_after_last_edit=len(after), tools_after=tools_after[:12])
def opencode(path):
    n_tool=0; last_edit=None; events=[]
    for l in open(path):
        try: e=json.loads(l)
        except Exception: continue
        events.append(e)
    tool_idx=[]; 
    for i,e in enumerate(events):
        s=json.dumps(e)
        if "\"tool\"" in s and ("apply_patch" in s or "\"bash\"" in s or "\"read\"" in s or "\"grep\"" in s or "\"glob\"" in s or "\"edit\"" in s or "\"write\"" in s):
            tool_idx.append(i)
        if "apply_patch" in s and ("\"tool\":\"apply_patch\"" in s or "apply_patch" in s[:400]):
            last_edit=i
    after=[i for i in tool_idx if last_edit is not None and i>last_edit]
    rt=sum(1 for i in after if "run_tests" in json.dumps(events[i]))
    return dict(events=len(events), tool_events=len(tool_idx), last_edit_event=last_edit, tool_events_after=len(after), run_tests_after=rt)
base=R+"/fp-codex-tab-20260826/agent-state/accenture__sfmc-devtools-1974-"
S=base+"native/codex-home/sessions/2026/08/26/"
for tag,f in [("c:n? 22-33-59",S+"rollout-2026-08-26T22-33-59-01a04035-710a-7072-8e45-e7fbf5a02081.jsonl"),("c:n? 22-36-07",S+"rollout-2026-08-26T22-36-07-01a04037-648f-7c01-b71a-7c91683a478f.jsonl"),("c:n? 22-38-01",S+"rollout-2026-08-26T22-38-01-01a04039-2392-7b11-8388-01192d99c935.jsonl")]:
    print(tag, codex(f))
S=base+"sweet/codex-home/sessions/2026/08/26/"
for tag,f in [("c:s0? 22-28-06",S+"rollout-2026-08-26T22-28-06-01a04030-0d43-7062-bfac-05358042a140.jsonl"),("c:s1? 22-30-34",S+"rollout-2026-08-26T22-30-34-01a04032-4f6f-7b12-b5e5-190431514aaf.jsonl"),("c:s2? 22-32-13",S+"rollout-2026-08-26T22-32-13-01a04033-d1de-7de0-a0ad-d607ce4410e3.jsonl")]:
    print(tag, codex(f))
C=R+"/fp-claudecode-tab-20260826/agent-state/accenture__sfmc-devtools-1974-sweet/claude-home/projects/"
for tag,f in [("cc:s0",C+"-root--ss-eval-runs-r0-2/06410609-3d01-4f09-b69d-7e396d378a1b.jsonl"),("cc:s1",C+"-root--ss-eval-runs-r1-4/9a58975e-cfbc-4f2b-b287-4412f8502782.jsonl"),("cc:s2",C+"-root--ss-eval-runs-r2-6/0ffe012f-eb60-47d1-b895-ae04c278d383.jsonl")]:
    print(tag, claude(f))
O=R+"/fp-opencode-tab-20260826/agent-state/accenture__sfmc-devtools-1974-native/opencode-retained/"
for tag,f in [("o:n0? -243277",O+"session-1787754243277-1040662-56b2576c/attempt-1.stdout.ndjson"),("o:n1? -354348",O+"session-1787754354348-1040662-3a09e376/attempt-1.stdout.ndjson"),("o:n2? -473387",O+"session-1787754473387-1040662-0a9f0a03/attempt-1.stdout.ndjson")]:
    print(tag, opencode(f))
