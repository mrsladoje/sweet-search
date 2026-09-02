import gzip, json, re, collections, shlex
P="/tmp/wf-slatec/native-capability-gaps/calls-classified.jsonl.gz"
SS=re.compile(r"^(ss-(?:search|read|grep|find|semantic|trace|batch))\b")
# flags the CURRENT (post-36b802e) parser accepts, per subcommand usage strings [C]
ACCEPT={
 "ss-grep":{"-i","--ignore-case","-w","--word-regexp","-F","--fixed-strings","--in","-k","--top","--json"},
 "ss-find":{"-i","--ignore-case","-w","--word-regexp","-F","--fixed-strings","--in","--full","--xl","-k","--top","--regex","--json"},
 "ss-search":{"--full","--xl","-k","--top","--mode","--json"},
 "ss-read":{"--force"},
 "ss-semantic":{"--max-tokens","--json"},
 "ss-trace":{"--in","--file","--query","--hint","--depth","--budget","--json"},
 "ss-batch":set(),
}
INERT={"-n","--line-number","-H","--with-filename","--no-filename","-r","-R","--recursive","--color","--colour"}
# what c09 proposes to add
C09_NEW={"--help","-h","-E","--extended-regexp"}
rej=collections.defaultdict(lambda: collections.Counter())
rescue=collections.defaultdict(lambda: collections.Counter())
tot=collections.Counter()
for line in gzip.open(P,"rt"):
    r=json.loads(line)
    if r["arm"]!="sweet" or not r.get("canon",True): continue
    h=r["h"]
    for op in r.get("ops") or []:
        t=(op.get("text") or "").strip()
        t2=re.sub(r"^(?:\S*/)?(ss-[a-z]+)", r"\1", t)
        m=SS.match(t2)
        if not m: continue
        tool=m.group(1); tot[h]+=1
        # only look at the first segment before a pipe, so `| head -80` is not counted
        seg=re.split(r"[|;]| &&| \|\|", t2)[0]
        try: toks=shlex.split(seg)
        except Exception: toks=seg.split()
        for a in toks[1:]:
            if not a.startswith("-") or a in ("-","--"): continue
            base=a.split("=")[0]
            if base in INERT or base in ACCEPT[tool]: continue
            if re.fullmatch(r"-\d+",base): continue
            rej[h][f"{tool} {base}"]+=1
            if base in C09_NEW: rescue[h][f"{tool} {base}"]+=1
print("=== ss-* operations carrying a flag the CURRENT parser rejects (sweet arm, fresh pool TAB) ===")
for h in ("codex","opencode","claude-code"):
    nr=sum(rej[h].values()); ns=sum(rescue[h].values())
    print(f"\n--- {h}: {tot[h]} sweet ss-* ops ---")
    print(f"  rejected-flag occurrences today: {nr} ({100*nr/tot[h]:.2f}% of ops)  -> {dict(rej[h].most_common(12))}")
    print(f"  of those, rescued by c09 (--help/-h/-E): {ns} ({100*ns/tot[h]:.2f}% of ops) -> {dict(rescue[h])}")
