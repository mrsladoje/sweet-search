import gzip, json, re, collections, shlex
P="/tmp/wf-slatec/native-capability-gaps/calls-classified.jsonl.gz"
SS=re.compile(r"^(ss-(?:search|read|grep|find|semantic|trace|batch))\b")
# Forms already printed by the CURRENT usage strings in _ss-helpers.mjs
# (GREP/FIND/READ/SEARCH/SEMANTIC/TRACE_USAGE) -> a working --help would teach them.
SELF_DESCRIBABLE={"-k","read-span","--in","--regex","semantic-2arg"}
per=collections.defaultdict(lambda: collections.Counter())
feat=collections.defaultdict(lambda: collections.Counter())
featstrict=collections.defaultdict(lambda: collections.Counter())
otherflags=collections.defaultdict(lambda: collections.Counter())
rollouts=collections.defaultdict(set)
for line in gzip.open(P,"rt"):
    r=json.loads(line)
    if r["arm"]!="sweet" or not r.get("canon",True): continue
    h=r["h"]; rollouts[h].add((r["task"],r["rep"]))
    for op in r.get("ops") or []:
        t=(op.get("text") or "").strip()
        t2=re.sub(r"^(?:\S*/)?(ss-[a-z]+)", r"\1", t)
        m=SS.match(t2)
        if not m: continue
        tool=m.group(1)
        try: toks=shlex.split(t2)
        except Exception: toks=t2.split()
        args=toks[1:]
        flags=[a for a in args if a.startswith("-")]
        pos=[a for a in args if not a.startswith("-")]
        f=set()
        if any(a in ("-k","--k","--top") or a.startswith("-k") for a in flags): f.add("-k")
        if any(a=="-n" or a=="--line-number" for a in flags): f.add("inert-n")
        if any(a.startswith("--in") for a in flags): f.add("--in")
        if any(a.startswith("--regex") for a in flags): f.add("--regex")
        if any(a.startswith("--json") for a in flags): f.add("--json")
        if tool=="ss-semantic" and len(pos)>=2: f.add("semantic-2arg")
        if tool=="ss-trace" and len(pos)>=2 and pos[1] in ("callers","callees","impact"): f.add("trace-mode")
        if tool=="ss-read" and len(pos)>=2: f.add("read-span")
        for a in flags:
            if not (a.startswith("-k") or a.startswith("--in") or a.startswith("--regex") or a.startswith("--json")):
                otherflags[h][a]+=1
        per[h]["ss_ops"]+=1
        for x in f: feat[h][x]+=1
        strict=f-SELF_DESCRIBABLE-{"inert-n"}
        per[h]["guide_only" if strict else "self_describable_or_bare"]+=1
        for x in strict: featstrict[h][x]+=1
print("=== REPAIRED classification: guide-ONLY forms after a working --help ===")
print("self-describable set (already in the shipped usage strings):", sorted(SELF_DESCRIBABLE))
for h in ("codex","opencode","claude-code"):
    n=per[h]["ss_ops"]; g=per[h]["guide_only"]
    print(f"\n--- {h}: {len(rollouts[h])} sweet rollouts, {n} ss-* operations ---")
    print(f"  guide-ONLY syntax after repair: {g} ({100*g/n:.2f}%)")
    print(f"  original guided features: {dict(feat[h].most_common(12))}")
    print(f"  residual guide-only features: {dict(featstrict[h].most_common(8))}")
    print(f"  other flags seen: {dict(otherflags[h].most_common(14))}")
