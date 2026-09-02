import json, collections
cells = json.load(open("/tmp/wf-slatec/resolution-computed-facts/census.json"))
print("total cells", len(cells))
by = collections.Counter((c["harness"], c["arm"]) for c in cells)
print("cells by harness/arm", dict(by))
def flagged(c):
    return [f for f in c["functions"] if "name" in f and not f["ambiguous"] and f["nFlaggedCallSites"] >= 1]
fl = [c for c in cells if flagged(c)]
print("flagged cells", len(fl))
print("flagged tasks", collections.Counter(c["task"] for c in fl))
print("flagged functions", collections.Counter(f["name"] for c in fl for f in flagged(c)))
print()
print("accenture cells (run, arm, rep, resolved, f2pFrac, edited fns, flaggedCallers):")
for c in sorted([c for c in cells if c["task"].startswith("accenture")], key=lambda c: (c["harness"], c["arm"], c["rep"])):
    fns = [(f.get("name"), f.get("nFlaggedCallSites")) for f in c["functions"] if "name" in f]
    fc = [f["flaggedCallers"] for f in c["functions"] if "name" in f and f.get("nFlaggedCallSites")]
    print(" ", c["run"], c["arm"], c["rep"], "resolved=%s" % c["resolved"], "f2p=%s" % c["f2pFrac"], fns, fc[:1])
print()
# missing cells relative to 66 per (harness, arm)
for (h,a),n in sorted(by.items()):
    if n != 66:
        tasks = collections.Counter(c["task"] for c in cells if c["harness"]==h and c["arm"]==a)
        print("SHORT", h, a, n, {t:k for t,k in tasks.items() if k!=3})
