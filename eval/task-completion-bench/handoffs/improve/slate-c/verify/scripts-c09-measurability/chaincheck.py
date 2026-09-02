import gzip, json, re, collections
P="/tmp/wf-slatec/native-capability-gaps/calls-classified.jsonl.gz"
hits=[]; nchain=0
for line in gzip.open(P,"rt"):
    r=json.loads(line)
    if r["arm"]!="sweet" or not r.get("canon",True): continue
    out=(r.get("out") or ""); cmd=(r.get("cmd") or "")
    if not re.search(r"unrecogni[sz]ed option \"(--help|-h|-E|--extended-regexp)\"", out) and not ("[ss-read]" in out and "--help" in cmd):
        continue
    tail = "&&" in cmd or ";" in cmd
    if tail: nchain+=1
    hits.append((r["h"], "sub" if r.get("side") else "main", r["task"], r["rep"], tail, cmd.strip()[:110]))
print(f"rescued-by-c09 error events: {len(hits)}; of which inside a chained envelope: {nchain}")
for x in hits: print("  ", x[0], x[1], f"{x[2]}/rep{x[3]}", "chain" if x[4] else "solo", "|", x[5])
