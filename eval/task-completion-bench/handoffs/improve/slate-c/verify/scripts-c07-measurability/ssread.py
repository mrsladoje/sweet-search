import json, os, re, glob, statistics as st
R="/root/sweet-search-private/eval/task-completion-bench/results/fp-codex-tab-20260826/agent-state"
files=sorted(glob.glob(R+"/*-sweet/codex-home/sessions/**/rollout-*.jsonl",recursive=True))
GUT=re.compile(r"^(\d+)\t")
MARK=re.compile(r"…?(\d[\d,]*) tokens truncated…?")
def walk(o):
    if isinstance(o,dict):
        for k,v in o.items():
            if k in ("output","content") and isinstance(v,str): yield v
            else: yield from walk(v)
    elif isinstance(o,list):
        for v in o: yield from walk(v)
res=[]
for f in files:
    for line in open(f, errors="replace"):
        try: rec=json.loads(line)
        except Exception: continue
        if "function_call_output" not in json.dumps(rec): continue
        for txt in walk(rec):
            t=txt
            if "\\\\n" in t and "\\n" not in t:
                try: t=t.encode().decode("unicode_escape",errors="replace")
                except Exception: pass
            try:
                j=json.loads(t)
                if isinstance(j,dict) and "output" in j: t=j["output"]
            except Exception: pass
            m=MARK.search(t)
            if not m: continue
            if "## #1 " in t: continue           # search packs handled elsewhere
            if "\t" not in t: continue           # need gutter -> ss-read class
            head=t[:m.start()]; tail=t[m.end():]
            def gutchars(s):
                return sum(len(x)+1 for x in s.split("\n") if GUT.match(x))
            def gutlines(s):
                return sum(1 for x in s.split("\n") if GUT.match(x))
            res.append(dict(total=len(t), head=len(head), tail=len(tail),
                head_code=gutchars(head), tail_code=gutchars(tail),
                head_lines=gutlines(head), tail_lines=gutlines(tail),
                deleted_tok=int(m.group(1).replace(",",""))))
print("gutter-bearing truncated envelopes (ss-read class):", len(res))
hc=[r["head_code"] for r in res]; tc=[r["tail_code"] for r in res]
hl=[r["head_lines"] for r in res]; tl=[r["tail_lines"] for r in res]
print(f"delivered numbered-line chars  head med={st.median(hc):.0f} tail med={st.median(tc):.0f} total med={st.median([a+b for a,b in zip(hc,tc)]):.0f}")
print(f"delivered numbered LINES       head med={st.median(hl):.0f} tail med={st.median(tl):.0f} total med={st.median([a+b for a,b in zip(hl,tl)]):.0f}")
tot=[a+b for a,b in zip(hc,tc)]
print(f"under a 4,800-char head cap with a manifest tail, delivered code chars would be <=4800.")
print(f"  median loss vs today = {st.median(tot)-4800:.0f} chars = {100*(st.median(tot)-4800)/st.median(tot):.0f}% of the code delivered today")
n_worse=sum(1 for x in tot if x>4800)
print(f"  envelopes where today already delivers MORE than 4,800 code chars: {n_worse}/{len(tot)} = {100*n_worse/len(tot):.0f}%")
