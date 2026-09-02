import gzip, json, re, collections
P="/tmp/wf-slatec/native-capability-gaps/calls-classified.jsonl.gz"
rows=[]
for line in gzip.open(P,"rt"):
    r=json.loads(line)
    if r["arm"]!="sweet" or not r.get("canon",True): continue
    out=(r.get("out") or ""); cmd=(r.get("cmd") or "")
    if not re.search(r"ss-(?:search|read|grep|find|semantic|trace|batch)\b", cmd): continue
    if ("[ss] unrecogni" in out) or ("not consumed" in out) or ("looks like a flag" in out) or ("requires a value" in out) or ("must be an integer" in out):
        rows.append((r["h"], "sub" if r.get("side") else "main", r["task"], r["rep"], cmd.replace(chr(10)," ")[:220], out.strip().splitlines()[0][:110]))
print("TOTAL usage-error records:", len(rows))
c=collections.Counter((h,s) for h,s,_,_,_,_ in rows)
print(dict(c))
for i,(h,s,t,rep,cmd,o) in enumerate(sorted(rows)):
    print(f"[{i:02d}] {h}/{s} {t} r{rep}")
    print(f"     CMD: {cmd}")
    print(f"     ERR: {o}")
