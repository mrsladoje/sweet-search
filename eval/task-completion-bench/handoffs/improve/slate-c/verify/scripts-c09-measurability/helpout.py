import gzip, json, re, collections
P="/tmp/wf-slatec/native-capability-gaps/calls-classified.jsonl.gz"
n=0
seen=collections.Counter()
for line in gzip.open(P,"rt"):
    r=json.loads(line)
    if r["arm"]!="sweet" or not r.get("canon",True): continue
    out=(r.get("out") or "")
    cmd=(r.get("cmd") or "")
    if not re.search(r"ss-[a-z]+", cmd): continue
    if ("--help" in cmd or re.search(r"(?<![-\w])-h(?![\w-])", cmd) or "unrecogni" in out):
        n+=1
        if n<=14:
            print("### ", r["h"], r["task"], "rep", r["rep"], "side" if r.get("side") else "main")
            print("CMD:", cmd[:300].replace(chr(10)," | "))
            print("OUT:", out[:600])
            print("EXIT:", r.get("exit"), "ERR:", r.get("err"))
            print("-"*70)
print("total matching records:", n)
