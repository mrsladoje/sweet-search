import json,glob,os,re,sys,collections
S="/private/tmp/claude-501/-Users-admin-Projects-sweet-search-private/063da756-75ad-43bc-87fc-ccc06d42f3a7/scratchpad"
OUT=os.path.join(S,"norm")
CAP=12000
def cap(s,n=CAP):
    s="" if s is None else str(s)
    return s if len(s)<=n else s[:n]+f"\n…[truncated {len(s)-n} chars]"
def write(h,task,arm,rep,steps,extra=""):
    d=os.path.join(OUT,h); os.makedirs(d,exist_ok=True)
    p=os.path.join(d,f"{task}-{arm}-r{rep}.md")
    with open(p,"w") as f:
        f.write(f"# {h} {task} {arm} r{rep}\n\n{extra}\n")
        for i,s in enumerate(steps,1):
            f.write(f"\n---\n## step {i} · {s['kind']}"+(f" · {s['tool']}" if s.get('tool') else "")+"\n")
            if s.get("text"): f.write(f"\n{cap(s['text'],4000)}\n")
            if s.get("input") is not None: f.write(f"\n**INPUT**\n```\n{cap(s['input'],3000)}\n```\n")
            if s.get("output") is not None: f.write(f"\n**OUTPUT**\n```\n{cap(s['output'])}\n```\n")
    return p
# ---------- codex ----------
def codex():
    base=os.path.join(S,"traces/sm-codex-20260902/agent-state")
    n=0
    for d in sorted(glob.glob(base+"/*")):
        m=re.match(r".*/(.+)-(native|sweet)$",d)
        if not m: continue
        task,arm=m.groups()
        files=sorted(glob.glob(d+"/codex-home/sessions/*/*/*/rollout-*.jsonl"))
        for f in files:
            recs=[json.loads(l) for l in open(f) if l.strip()]
            rep=None; steps=[]; pending={}
            for r in recs:
                p=r.get("payload") or {}
                t=p.get("type")
                if r.get("type")=="session_meta":
                    cwd=(p.get("cwd") or "")
                    mm=re.search(r"/r(\d)-\d+",cwd); rep=int(mm.group(1)) if mm else None
                if t=="function_call":
                    args=p.get("arguments") or ""
                    try: a=json.loads(args)
                    except: a={"raw":args}
                    cmd=a.get("cmd") or a.get("chars") or json.dumps(a)
                    if rep is None:
                        mm=re.search(r"/r(\d)-\d+",json.dumps(a)); rep=int(mm.group(1)) if mm else rep
                    pending[p.get("call_id")]={"kind":"tool","tool":p.get("name"),"input":cmd}
                    steps.append(pending[p.get("call_id")])
                elif t=="function_call_output":
                    out=p.get("output")
                    if isinstance(out,dict): out=out.get("content") or json.dumps(out)
                    st=pending.get(p.get("call_id"))
                    if st: st["output"]=out
                    else: steps.append({"kind":"tool_output","output":out})
                elif t=="patch_apply_end":
                    diffs="\n".join(f"{k}:\n{v.get('unified_diff','')}" for k,v in (p.get("changes") or {}).items())
                    steps.append({"kind":"EDIT","tool":"apply_patch","input":diffs,"output":p.get("stdout")})
                elif t=="message" and p.get("role")=="assistant":
                    txt="\n".join(c.get("text","") for c in (p.get("content") or []) if isinstance(c,dict))
                    steps.append({"kind":"assistant_text","text":txt})
                elif t=="agent_reasoning":
                    steps.append({"kind":"reasoning","text":p.get("text")})
            if rep is None: rep="x"
            write("codex",task,arm,rep,steps); n+=1
    print("codex",n)
# ---------- opencode ----------
def opencode():
    base=os.path.join(S,"traces/sm-opencode-20260902/agent-state")
    n=0
    for d in sorted(glob.glob(base+"/*")):
        m=re.match(r".*/(.+)-(native|sweet)$",d)
        if not m: continue
        task,arm=m.groups()
        for sd in sorted(glob.glob(d+"/opencode-retained/session-*")):
            f=os.path.join(sd,"attempt-1.stdout.ndjson")
            if not os.path.exists(f): continue
            steps=[]; rep=None
            for l in open(f):
                try: r=json.loads(l)
                except: continue
                part=r.get("part") or {}
                if r.get("type")=="tool_use":
                    st=part.get("state") or {}
                    inp=st.get("input") or {}
                    if rep is None:
                        mm=re.search(r"/r(\d)-\d+",json.dumps(inp)); rep=int(mm.group(1)) if mm else None
                    tool=part.get("tool")
                    if tool=="bash": i=inp.get("command")
                    elif tool=="read": i=f"{inp.get('filePath')} offset={inp.get('offset')} limit={inp.get('limit')}"
                    elif tool=="apply_patch": i=inp.get("patchText")
                    elif tool=="grep": i=f"pattern={inp.get('pattern')} path={inp.get('path')} include={inp.get('include')}"
                    elif tool=="glob": i=f"pattern={inp.get('pattern')} path={inp.get('path')}"
                    else: i=json.dumps(inp)
                    out=st.get("output")
                    steps.append({"kind":"EDIT" if tool=="apply_patch" else "tool","tool":tool,"input":i,"output":out})
                elif r.get("type")=="text":
                    steps.append({"kind":"assistant_text","text":part.get("text")})
            if rep is None: rep="x"
            write("opencode",task,arm,rep,steps); n+=1
    print("opencode",n)
# ---------- claude-code ----------
def claude():
    base=os.path.join(S,"traces/sm-claudecode-20260902/agent-state")
    n=0
    for d in sorted(glob.glob(base+"/*")):
        m=re.match(r".*/(.+)-(native|sweet)$",d)
        if not m: continue
        task,arm=m.groups()
        for pd in sorted(glob.glob(d+"/claude-home/projects/*")):
            mm=re.search(r"runs-r(\d)-\d+$",pd); rep=int(mm.group(1)) if mm else "x"
            mains=[f for f in glob.glob(pd+"/*.jsonl")]
            for f in mains:
                steps=parse_claude(f)
                # subagents
                sid=os.path.basename(f)[:-6]
                subs=sorted(glob.glob(f"{pd}/{sid}/subagents/agent-*.jsonl"))
                extra=""
                for sf in subs:
                    sub=parse_claude(sf)
                    extra+=f"\n\n# SUBAGENT {os.path.basename(sf)} ({len(sub)} steps)\n"
                    for i,s in enumerate(sub,1):
                        extra+=f"\n### sub-step {i} · {s['kind']}"+(f" · {s.get('tool')}" if s.get('tool') else "")+"\n"
                        if s.get("text"): extra+=f"\n{cap(s['text'],2000)}\n"
                        if s.get("input") is not None: extra+=f"\n**INPUT**\n```\n{cap(s['input'],2000)}\n```\n"
                        if s.get("output") is not None: extra+=f"\n**OUTPUT**\n```\n{cap(s['output'],6000)}\n```\n"
                write("claudecode",task,arm,rep,steps,extra=f"(main transcript; {len(subs)} subagent transcripts appended at the end)\n"+extra if subs else "")
                n+=1
    print("claudecode",n)
def parse_claude(f):
    steps=[]; pending={}
    for l in open(f):
        try: r=json.loads(l)
        except: continue
        msg=r.get("message") or {}
        c=msg.get("content")
        if r.get("type")=="assistant" and isinstance(c,list):
            for b in c:
                if not isinstance(b,dict): continue
                if b.get("type")=="text" and b.get("text","").strip():
                    steps.append({"kind":"assistant_text","text":b["text"]})
                elif b.get("type")=="tool_use":
                    name=b.get("name"); inp=b.get("input") or {}
                    if name=="Bash": i=inp.get("command")
                    elif name=="Read": i=f"{inp.get('file_path')} offset={inp.get('offset')} limit={inp.get('limit')}"
                    elif name in ("Edit","Write","MultiEdit"): i=json.dumps(inp,indent=1)
                    else: i=json.dumps(inp)
                    st={"kind":"EDIT" if name in ("Edit","Write","MultiEdit") else "tool","tool":name,"input":i}
                    pending[b.get("id")]=st; steps.append(st)
        elif r.get("type")=="user" and isinstance(c,list):
            for b in c:
                if isinstance(b,dict) and b.get("type")=="tool_result":
                    cc=b.get("content")
                    if isinstance(cc,list): cc="\n".join(x.get("text","") for x in cc if isinstance(x,dict))
                    st=pending.get(b.get("tool_use_id"))
                    if st: st["output"]=cc
                    else: steps.append({"kind":"tool_output","output":cc})
    return steps
codex(); opencode(); claude()
