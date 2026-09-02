import gzip, json, re
P="/tmp/wf-slatec/native-capability-gaps/calls-classified.jsonl.gz"
want={("awslabs__aws-embedded-metrics-node-21",2,"claude-code"),("bfgroup__b2-113",2,"claude-code")}
for line in gzip.open(P,"rt"):
    r=json.loads(line)
    if r["arm"]!="sweet" or not r.get("canon",True): continue
    if (r["task"],r["rep"],r["h"]) not in want: continue
    if not r.get("side"): continue
    cmd=(r.get("cmd") or "").replace("\n"," ")[:150]
    out=(r.get("out") or "").strip().splitlines()
    head=out[0][:95] if out else ""
    print(r["task"]+"/r"+str(r["rep"])+" | "+cmd)
    print("      -> "+head)
