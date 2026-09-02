import json, re, os
R="/root/sweet-search-private/eval/task-completion-bench/results"
runs=[("fp-codex-tab-20260826","c"),("fp-opencode-tab-20260826","o"),("rp-oc-tab-20260827","rp o"),("fp-claudecode-tab-20260826","cc")]
for run,tag in runs:
    for arm in ("native","sweet"):
        for rep in (0,1,2):
            pf=f"{R}/{run}/{arm}/patches.json" if rep==0 else f"{R}/{run}/{arm}/rep-{rep}/patches.json"
            if not os.path.exists(pf): continue
            for e in json.load(open(pf)):
                if not e["instance_id"].startswith("accenture"): continue
                p=e.get("patch") or ""
                hunks=[l for l in p.split("\n") if l.startswith("@@")]
                added=[l[1:] for l in p.split("\n") if l.startswith("+") and not l.startswith("+++")]
                # classify guard shape from the agent patch text only
                txt="\n".join(added)
                empty_guard = bool(re.search(r"length\s*===?\s*0|!\s*\w+\.length|\.length\s*<\s*1|isEmpty|Object\.keys\([^)]*\)\.length\s*===?\s*0|=== 0", txt))
                falsy_guard = bool(re.search(r"if\s*\(\s*!\s*selectedTypes\s*\)|selectedTypes\s*==\s*null|=== undefined|typeof selectedTypes", txt))
                print(f"{tag}:{arm[0]}{rep}", "hunks=%d"%len(hunks), "hunkHeaders=%s"%[h[:30] for h in hunks][:4], "emptyGuard=%s"%empty_guard, "falsyGuard=%s"%falsy_guard, "addedLines=%d"%len(added))
