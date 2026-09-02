# c11-mechanism verify: did any agent ever read a persisted tool-results file?
import json,os,re,collections
BASE="/root/sweet-search-private/eval/task-completion-bench/results"
RUNS=["fp-claudecode-tab-20260826","fp-claudecode-none-20260826","fp-claudecode-pipe-20260826","rb-claudecode-20260824","fixval-claude-code-20260828"]
hits=collections.Counter(); ex=[]; lines_with=0
for run in RUNS:
    root=os.path.join(BASE,run,"agent-state")
    if not os.path.isdir(root): continue
    for dp,_,fs in os.walk(root):
        for f in fs:
            if not f.endswith(".jsonl"): continue
            p=os.path.join(dp,f)
            for ln in open(p,encoding="utf-8",errors="replace"):
                if "tool-results" not in ln: continue
                lines_with+=1
                try: r=json.loads(ln)
                except Exception: continue
                cont=(r.get("message") or {}).get("content")
                if isinstance(cont,str):
                    if r.get("type")=="assistant" and "tool-results" in cont: hits[(run,"assistant-text")]+=1
                    continue
                if not isinstance(cont,list): continue
                for b in cont:
                    if not isinstance(b,dict): continue
                    if b.get("type")=="tool_use":
                        s=json.dumps(b.get("input") or {})
                        if "tool-results" in s: hits[(run,"tool_use:"+str(b.get("name")))]+=1; ex.append((run,b.get("name"),s[:160]))
                    elif b.get("type")=="text" and r.get("type")=="assistant" and "tool-results" in (b.get("text") or ""):
                        hits[(run,"assistant-text")]+=1; ex.append((run,"text",(b.get("text") or "")[:160]))
print("lines mentioning tool-results:",lines_with)
print("tool_use inputs / assistant text referencing tool-results:",dict(hits))
for e in ex[:12]: print(" ",e)
