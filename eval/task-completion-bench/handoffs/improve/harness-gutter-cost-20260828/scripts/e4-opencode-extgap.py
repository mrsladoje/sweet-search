#!/usr/bin/env python3
"""E4 - index blind-spot scan: file kinds present in the golden tree but absent from the index."""
import sys, json, os, sqlite3, collections, subprocess
sys.path.insert(0, "/tmp/fp-inv/e4-opencode")
from bundle import spec
POOL = [l.strip() for l in open("/root/fresh-run/pool.txt") if l.strip()]
GOLD = "/root/.ss-eval/golden"
SKIP = {".png",".jpg",".gif",".svg",".ico",".lock",".map",".min.js",".snap",".pdf",".zip",".woff",".woff2",".ttf",".eot",".mp4",".jar",".class",".so",".dll",".dylib",".bin",".dat",""}
rows = []
for t in POOL:
    s = spec(t)
    gd = os.path.join(GOLD, s["repo"].replace("/", "__") + "@" + s["base_commit"])
    if not os.path.isdir(gd): rows.append({"task": t, "err": "no golden"}); continue
    tree = collections.Counter()
    for root, dirs, files in os.walk(gd):
        dirs[:] = [d for d in dirs if d not in (".git", "node_modules", ".sweet-search", "vendor", "target", "dist")]
        for f in files: tree[os.path.splitext(f)[1].lower()] += 1
    db = os.path.join(gd, ".sweet-search", "codebase.db")
    idx = collections.Counter()
    if os.path.exists(db):
        try:
            c = sqlite3.connect("file:%s?mode=ro" % db, uri=True)
            for (p,) in c.execute("select file_path from vectors"): idx[os.path.splitext(p or "")[1].lower()] += 1
        except Exception as e: pass
    gaps = [(e, n) for e, n in tree.most_common(40) if e not in SKIP and n >= 10 and idx.get(e, 0) == 0]
    rows.append({"task": t, "repo": s["repo"], "lang": s["language"], "treeTop": tree.most_common(6),
                 "idxChunks": sum(idx.values()), "idxTop": idx.most_common(6), "gaps": gaps})
for r in rows:
    if r.get("err"): print("%-42s %s" % (r["task"], r["err"])); continue
    flag = "  <== BLIND SPOT" if r["gaps"] else ""
    print("%-42s idx=%-6d gaps=%s%s" % (r["task"], r["idxChunks"], r["gaps"][:5], flag))
json.dump(rows, open("/tmp/fp-inv/e4-opencode/extgap.json", "w"), indent=1)
