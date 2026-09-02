# c11-mechanism verify: what happened after each persisted ss-* result; what the deleted files contain.
import json,os,re,collections
BASE="/root/sweet-search-private/eval/task-completion-bench/results"
ev=json.load(open("/tmp/wf-slatec/c11-mechanism/persist_events.json"))
SS=re.compile(r"(?<![\w./-])ss-(search|read|grep|find|semantic|trace|batch)\b")
def tr_text(c):
    if isinstance(c,str): return c
    if isinstance(c,list): return "\n".join(b.get("text","") if isinstance(b,dict) and b.get("type")=="text" else (b if isinstance(b,str) else "") for b in c)
    return json.dumps(c) if isinstance(c,dict) else ""
def find_transcript(e):
    root=os.path.join(BASE,e["run"],"agent-state","%s-%s"%(e["task"],e["arm"]),"claude-home","projects",e["proj"])
    for dp,_,fs in os.walk(root):
        for f in fs:
            if f==e["file"]: return os.path.join(dp,f)
    return None
def seq_of(p):
    seq=[]; uses={}; last_text=""
    for ln in open(p,encoding="utf-8",errors="replace"):
        if not ln.strip(): continue
        try: r=json.loads(ln)
        except Exception: continue
        msg=r.get("message") or {}; cont=msg.get("content")
        if r.get("type")=="assistant":
            if isinstance(cont,str) and cont.strip(): last_text=cont
            elif isinstance(cont,list):
                for b in cont:
                    if isinstance(b,dict) and b.get("type")=="text" and (b.get("text") or "").strip(): last_text=b["text"]
        if not isinstance(cont,list): continue
        for b in cont:
            if not isinstance(b,dict): continue
            if b.get("type")=="tool_use":
                inp=b.get("input") or {}; cmd=inp.get("command") or json.dumps(inp)[:200]
                uses[b.get("id")]=(b.get("name"),cmd); seq.append(("use",b.get("id"),b.get("name"),cmd))
            elif b.get("type")=="tool_result":
                t=tr_text(b.get("content")); nm,cmd=uses.get(b.get("tool_use_id"),("?","?"))
                seq.append(("res",b.get("tool_use_id"),nm,("PERSISTED " if "<persisted-output>" in t else "")+(cmd or "")[:100]))
    return seq,last_text
def persisted_file(e):
    m=re.search(r"projects/(.+)$",e["path"])
    if not m: return None
    p=os.path.join(BASE,e["run"],"agent-state","%s-%s"%(e["task"],e["arm"]),"claude-home","projects",m.group(1))
    return p if os.path.exists(p) else None
ssev=[e for e in ev if e["ss"]]
print("ss-* persisted events:",len(ssev))
for e in ssev:
    print("\n##### %s | %s | %s | %s | sess %s | %s"%(e["run"],e["task"],e["arm"],e["loc"],e["sess"][:8],e["cmd"][:120]))
    p=find_transcript(e)
    if not p: print("   transcript not found"); continue
    seq,last=seq_of(p)
    idx=[i for i,s in enumerate(seq) if s[0]=="res" and s[1]==e["path"] ]  # placeholder
    # locate by tool_use_id via path? we stored no id; locate by PERSISTED + cmd prefix
    idx=[i for i,s in enumerate(seq) if s[0]=="res" and s[3].startswith("PERSISTED") and s[3][10:60]==e["cmd"][:50]]
    if not idx: print("   event not located in sequence"); continue
    i=idx[0]
    nxt=[s for s in seq[i+1:] if s[0]=="use"][:6]
    # was the next result persisted too?
    for j,(k,tid,nm,cmd) in enumerate(nxt):
        res=[s for s in seq if s[0]=="res" and s[1]==tid]
        flag="PERSISTED" if res and res[0][3].startswith("PERSISTED") else ""
        print("   -> %d %s %s | %s"%(j+1,nm,flag,(cmd or "").replace("\n"," ")[:130]))
    print("   total tool uses in this transcript:",sum(1 for s in seq if s[0]=="use")," position of event: use #%d"%sum(1 for s in seq[:i] if s[0]=="use"))
    print("   LAST assistant text (first 400 chars): %s"%last.replace("\n"," ")[:400])
    pf=persisted_file(e)
    if pf:
        data=open(pf,encoding="utf-8",errors="replace").read()
        head=data[:2000]
        print("   persisted file: %s  chars=%d"%(os.path.basename(pf),len(data)))
        print("   first-2000: has_header=%s has_sufficient=%s has_confidence=%s ; anywhere: sufficient=%s"%(head.lstrip().startswith("#"), "sufficient=" in head, "confidence" in head.lower(), "sufficient=" in data))
        for line in data.splitlines()[:6]: print("      | "+line[:150])
        if "b2-" in e["task"]:
            print("   b2 checks: 'configure' occurrences=%d ; 'configure.jam'=%d ; 'src/build/'=%d ; 'src/tools/'=%d ; '.jam' lines=%d ; 'test/' lines=%d ; total lines=%d"%(data.lower().count("configure"),data.count("configure.jam"),data.count("src/build/"),data.count("src/tools/"),sum(1 for l in data.splitlines() if ".jam" in l),sum(1 for l in data.splitlines() if "test/" in l),len(data.splitlines())))
            paths=collections.Counter(re.findall(r"(?m)^(?:#+\s*)?([\w./-]+\.(?:jam|py|cpp|h|md|txt|sh))\b",data))
            print("   b2 top paths:",paths.most_common(8))
    else:
        print("   persisted file not found at",e["path"])
# absence text search in the r2-38 session
print("\n===== 'only tests' / absence statements in b2-259 sweet transcripts (all runs) =====")
for run in ["fp-claudecode-tab-20260826","fp-claudecode-none-20260826","fp-claudecode-pipe-20260826"]:
    root=os.path.join(BASE,run,"agent-state","bfgroup__b2-259-sweet")
    for dp,_,fs in os.walk(root):
        for f in fs:
            if not f.endswith(".jsonl"): continue
            p=os.path.join(dp,f)
            for ln in open(p,encoding="utf-8",errors="replace"):
                low=ln.lower()
                if ("only tests" in low or "no configure module" in low or "find only" in low) and '"type":"assistant"' in ln.replace(" ",""):
                    try: r=json.loads(ln)
                    except Exception: continue
                    cont=(r.get("message") or {}).get("content"); txt=tr_text(cont) if not isinstance(cont,str) else cont
                    k=txt.lower().find("only tests"); k=k if k>=0 else txt.lower().find("no configure")
                    print(" ",run,os.path.relpath(p,root)[-70:],"|",txt[max(0,k-200):k+200].replace("\n"," "))
