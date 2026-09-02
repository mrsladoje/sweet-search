import json, os
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
                print(f"===== {tag}:{arm[0]}{rep}")
                for l in p.split("\n"):
                    if l.startswith("@@") or l.startswith("+") and not l.startswith("+++"):
                        print("   ", l[:140])
