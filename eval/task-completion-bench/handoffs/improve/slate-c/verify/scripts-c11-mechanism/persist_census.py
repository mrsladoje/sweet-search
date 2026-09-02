# c11-mechanism verify: independent census of <persisted-output> events in claude-code transcripts.
import json,os,re,collections,sys
BASE="/root/sweet-search-private/eval/task-completion-bench/results"
RUNS=["fp-claudecode-tab-20260826","fp-claudecode-none-20260826","fp-claudecode-pipe-20260826","rb-claudecode-20260824","fixval-claude-code-20260828"]
SS=re.compile(r"(?<![\w./-])ss-(search|read|grep|find|semantic|trace|batch)\b")
def tr_text(c):
    if isinstance(c,str): return c
    if isinstance(c,list):
        return "\n".join(b.get("text","") if isinstance(b,dict) and b.get("type")=="text" else (b if isinstance(b,str) else "") for b in c)
    if isinstance(c,dict): return json.dumps(c)
    return ""
def parse_size(s):
    m=re.search(r"Output too large \(([\d.]+)\s*(KB|MB|B)?\)",s)
    if not m: return None
    v=float(m.group(1)); u=(m.group(2) or "B")
    return v*{"B":1,"KB":1024,"MB":1024*1024}[u]
grand=[]
for run in RUNS:
    root=os.path.join(BASE,run,"agent-state")
    if not os.path.isdir(root): print("MISSING",run); continue
    versions=collections.Counter()
    ev={}  # tool_use_id -> event
    ss_sizes=collections.defaultdict(list)  # (arm,loc)->list of inline ss result lengths
    n_native_dirs=len([d for d in os.listdir(root) if d.endswith("-native")])
    n_sweet_dirs=len([d for d in os.listdir(root) if d.endswith("-sweet")])
    nfiles=0
    for dp,_,fs in os.walk(root):
        for f in fs:
            if not f.endswith(".jsonl"): continue
            p=os.path.join(dp,f); nfiles+=1
            m=re.search(r"agent-state/(.+?)-(sweet|native)/",p)
            arm=m.group(2) if m else "?"; task=m.group(1) if m else "?"
            sub="subagents" in p
            proj=re.search(r"projects/([^/]+)/",p); proj=proj.group(1) if proj else "?"
            sess=re.search(r"projects/[^/]+/([0-9a-f-]{36})",p); sess=sess.group(1) if sess else "?"
            uses={}
            with open(p,encoding="utf-8",errors="replace") as fh:
                for ln in fh:
                    if not ln.strip(): continue
                    try: r=json.loads(ln)
                    except Exception: continue
                    if r.get("version"): versions[r.get("version")]+=1
                    cont=(r.get("message") or {}).get("content")
                    if not isinstance(cont,list): continue
                    for b in cont:
                        if not isinstance(b,dict): continue
                        if b.get("type")=="tool_use":
                            inp=b.get("input") or {}
                            uses[b.get("id")]=(b.get("name"),inp.get("command") or json.dumps(inp)[:200])
                        elif b.get("type")=="tool_result":
                            t=tr_text(b.get("content"))
                            nm,cmd=uses.get(b.get("tool_use_id"),("?","?"))
                            isss = (nm=="Bash") and bool(SS.search(cmd or ""))
                            if isss and "<persisted-output>" not in t:
                                ss_sizes[(arm,"sub" if sub else "main")].append(len(t))
                            if "<persisted-output>" in t:
                                pm=re.search(r"saved to: (\S+)",t)
                                ev[b.get("tool_use_id")]=dict(run=run,task=task,arm=arm,loc="sub" if sub else "main",proj=proj,sess=sess,file=os.path.basename(p),tool=nm,ss=isss,size=parse_size(t),stublen=len(t),cmd=(cmd or "")[:140].replace("\n"," "),path=pm.group(1) if pm else "?")
    evl=list(ev.values()); grand+=evl
    print("=== %s  native_dirs=%d sweet_dirs=%d jsonl_files=%d versions=%s"%(run,n_native_dirs,n_sweet_dirs,nfiles,dict(versions.most_common(3))))
    c=collections.Counter((e["arm"],e["loc"],"ss" if e["ss"] else "other") for e in evl)
    print("  persisted events (unique tool_use_id):",len(evl)," by (arm,loc,ss):",dict(c))
    sizes=[e["size"] for e in evl if e["size"]]
    if sizes: print("  persisted size bytes: min=%d  median=%d  max=%d"%(min(sizes),sorted(sizes)[len(sizes)//2],max(sizes)))
    for k,v in sorted(ss_sizes.items()):
        v=sorted(v); print("  inline ss-* results %s: n=%d max=%d  >20000:%d  >25000:%d  >28000:%d  >29000:%d"%(k,len(v),v[-1],sum(1 for x in v if x>20000),sum(1 for x in v if x>25000),sum(1 for x in v if x>28000),sum(1 for x in v if x>29000)))
    ssev=[e for e in evl if e["ss"]]
    print("  ss-* persisted events:",len(ssev))
    for e in ssev: print("    SS",e["task"],e["arm"],e["loc"],e["proj"],e["sess"][:8],"size=%s"%e["size"],"stub=%d"%e["stublen"],"|",e["cmd"][:110])
    h=collections.Counter((e["arm"],(e["cmd"].split() or ["?"])[0]) for e in evl if not e["ss"])
    print("  non-ss persisted command heads:",h.most_common(10))
    print("  stub lengths (chars): min=%d max=%d"%(min(e["stublen"] for e in evl) if evl else 0, max(e["stublen"] for e in evl) if evl else 0))
print("GRAND total persisted events across runs:",len(grand),"  fp-only:",sum(1 for e in grand if e["run"].startswith("fp-")),"  ss-*:",sum(1 for e in grand if e["ss"]))
json.dump(grand,open("/tmp/wf-slatec/c11-mechanism/persist_events.json","w"),indent=1)
