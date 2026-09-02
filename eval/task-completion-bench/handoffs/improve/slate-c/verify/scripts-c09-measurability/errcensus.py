import gzip, json, re, collections
P="/tmp/wf-slatec/native-capability-gaps/calls-classified.jsonl.gz"
SS=re.compile(r"(?:^|[\s;&|(])(?:\S*/)?(ss-(?:search|read|grep|find|semantic|trace|batch))\b")
n=collections.Counter(); errs=collections.Counter(); cls=collections.defaultdict(lambda: collections.Counter())
for line in gzip.open(P,"rt"):
    r=json.loads(line)
    if r["arm"]!="sweet" or not r.get("canon",True): continue
    cmd=(r.get("cmd") or "")
    if not SS.search(cmd): continue
    h=r["h"]; side=bool(r.get("side"))
    key=(h,"sub" if side else "main")
    n[key]+=1
    bad = bool(r.get("err")) or (r.get("exit") not in (None,0,"0"))
    out=(r.get("out") or "")
    if not bad and "[ss" not in out[:400]: continue
    first=out.strip().splitlines()[0][:120] if out.strip() else ""
    if "unrecognised option" in out or "unrecognized option" in out:
        m=re.search(r"unrecogni[sz]ed option \"([^\"]+)\"", out)
        cls[key]["unrecognised "+(m.group(1) if m else "?")]+=1; errs[key]+=1
    elif "not consumed" in out:
        cls[key]["extra positional (fixed by 36b802e)"]+=1; errs[key]+=1
    elif "looks like a flag" in out:
        m=re.search(r"\[ss-read\] \"([^\"]+)\"", out)
        cls[key]["ss-read flag-first "+(m.group(1) if m else "?")]+=1; errs[key]+=1
    elif "ENOENT" in out or "no such file" in out.lower():
        cls[key]["ENOENT"]+=1; errs[key]+=1
    elif bad:
        cls[key]["other-nonzero: "+first[:60]]+=1; errs[key]+=1
print("=== ss-*-bearing sweet commands, error classes (fresh pool TAB) ===")
for h in ("codex","opencode","claude-code"):
    for s in ("main","sub"):
        k=(h,s)
        if not n[k]: continue
        print(f"\n--- {h} {s}: {n[k]} ss-*-bearing commands, {errs[k]} errored ---")
        for c,v in cls[k].most_common(14): print(f"    {v:3d}  {c}")
