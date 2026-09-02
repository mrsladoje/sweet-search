import json, os, re, glob, statistics as st
from collections import Counter
R="/root/sweet-search-private/eval/task-completion-bench/results/fp-codex-tab-20260826/agent-state"
files=sorted(glob.glob(R+"/*-sweet/codex-home/sessions/**/rollout-*.jsonl",recursive=True))
RANK=re.compile(r"^## #(\d+) ([^\s:]+):(\d+)-(\d+)\s*(.*)$")
PACK=re.compile(r"^# ss-(search|find): .*budget=(\d+) used=(\d+)(?: results=(\d+))?")
GUT=re.compile(r"^(\d+)\t")
def walk(o):
    if isinstance(o,dict):
        for k,v in o.items():
            if k in ("output","content") and isinstance(v,str): yield v
            else: yield from walk(v)
    elif isinstance(o,list):
        for v in o: yield from walk(v)
rows=[]
for f in files:
    task=os.path.basename(f.split("/codex-home")[0]).replace("-sweet","")
    for line in open(f, errors="replace"):
        try: rec=json.loads(line)
        except Exception: continue
        blob=json.dumps(rec)
        if "function_call_output" not in blob: continue
        for txt in walk(rec):
            t=txt
            if "\\\\n" in t and "\\n" not in t:
                try: t=t.encode().decode("unicode_escape",errors="replace")
                except Exception: pass
            try:
                j=json.loads(t)
                if isinstance(j,dict) and "output" in j: t=j["output"]
            except Exception: pass
            if "## #1 " not in t: continue
            L=t.split("\n")
            trunc = "tokens truncated" in t
            ph=None
            for x in L[:12]:
                m=PACK.match(x)
                if m: ph=(m.group(1),int(m.group(2)),int(m.group(3)),int(m.group(4)) if m.group(4) else None); break
            idx=[]
            for i,x in enumerate(L):
                m=RANK.match(x)
                if m: idx.append((i,int(m.group(1)),m.group(2),int(m.group(3)),int(m.group(4)),m.group(5)))
            if not idx or idx[0][1]!=1: continue
            i1=idx[0][0]
            i2=idx[1][0] if len(idx)>1 else len(L)
            blk=L[i1:i2]
            blktxt="\n".join(blk)
            # cut marker inside rank1?
            cut_in_r1 = "tokens truncated" in blktxt
            span=idx[0][4]-idx[0][3]+1
            # numbered lines delivered inside rank1
            nl=[x for x in blk if GUT.match(x)]
            mean_line = (sum(len(x)+1 for x in nl)/len(nl)) if nl else None
            # non-code overhead in rank1 block = block chars - numbered-line chars
            code_chars=sum(len(x)+1 for x in nl)
            overhead=len(blktxt)-code_chars
            est_full = (overhead + span*mean_line) if mean_line else None
            rows.append(dict(task=task,file=os.path.basename(f),tool=ph[0] if ph else None,
                budget=ph[1] if ph else None,used=ph[2] if ph else None,results=ph[3] if ph else None,
                trunc=trunc,cut_in_r1=cut_in_r1,path=idx[0][2],span=span,pres=idx[0][5][:40],
                nranks=len(idx),pre_r1_chars=len("\n".join(L[:i1])),
                r1_delivered=len(blktxt),n_numbered=len(nl),mean_line=mean_line,est_full_r1=est_full,
                total=len(t)))
json.dump(rows,open("/tmp/wf-slatec/c07-measurability/v2/r1size.json","w"))
print("packs parsed:",len(rows))
print("truncated:",sum(1 for r in rows if r["trunc"]),"cut inside rank1:",sum(1 for r in rows if r["cut_in_r1"]))
def rep(label,sel):
    ps=[r for r in rows if sel(r) and r["est_full_r1"]]
    if not ps: print(label,"n=0"); return
    e=sorted(r["est_full_r1"] for r in ps)
    over=[r for r in ps if r["est_full_r1"]+r["pre_r1_chars"]>4800]
    overb=[r for r in ps if r["est_full_r1"]>4800]
    print(f"{label}: n={len(ps)} est rank1 body chars med={e[len(e)//2]:.0f} p90={e[int(.9*len(e))-1]:.0f} max={e[-1]:.0f} | body>4800: {len(overb)} ({100*len(overb)/len(ps):.0f}%) | preamble+body>4800: {len(over)} ({100*len(over)/len(ps):.0f}%)")
rep("ALL packs", lambda r: True)
rep("truncated packs", lambda r: r["trunc"])
rep("truncated, presentation full", lambda r: r["trunc"] and r["pres"].startswith("(full"))
rep("untruncated packs", lambda r: not r["trunc"])
print()
print("presentation of rank1, truncated:",Counter(r["pres"][:20] for r in rows if r["trunc"]).most_common())
print("results= distribution truncated:",sorted(r["results"] for r in rows if r["trunc"] and r["results"]))
