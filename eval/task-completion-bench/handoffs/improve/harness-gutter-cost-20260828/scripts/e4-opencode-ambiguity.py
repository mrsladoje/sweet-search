#!/usr/bin/env python3
"""E4 - apply_patch anchor-ambiguity census: does the hunk's context sequence occur
more than once in the target file at the moment of the edit? Uses the golden checkout
as the base text (single-commit goldens; the first edit of a file is against base)."""
import sys, json, os, re, collections
sys.path.insert(0, "/tmp/fp-inv/e4-opencode")
from lib import rollouts, ndjson_path, parse
from bundle import spec

GOLD = "/root/.ss-eval/golden"
_map = None
def golddir(repo, base):
    global _map
    if _map is None:
        _map = {}
        for d in os.listdir(GOLD):
            if "@" in d: _map[d] = d
    key = repo.replace("/", "__") + "@" + base
    return os.path.join(GOLD, key) if key in _map else None

def hunk_contexts(pt):
    """for each hunk, the leading run of context/removed lines used as the seek anchor"""
    out = []
    cur = None
    for ln in pt.split("\n"):
        if ln.startswith("@@"):
            if cur is not None: out.append(cur)
            cur = []
            continue
        if cur is None: continue
        if ln.startswith("*** "): 
            out.append(cur); cur = None; continue
        if ln.startswith("+"): 
            continue
        if ln.startswith("-") or ln.startswith(" ") or ln == "":
            cur.append(ln[1:] if ln[:1] in (" ", "-") else ln)
    if cur is not None: out.append(cur)
    return [c for c in out if c]

def count_occurrences(text, anchor_lines):
    """count how many places the anchor sequence matches with codex/opencode pass-1 (exact)
    and pass-3 (trim-both) semantics."""
    lines = text.split("\n")
    a = [l for l in anchor_lines]
    if not a: return 0, 0
    n = len(a)
    exact = 0; trimmed = 0
    at = [x.strip() for x in a]
    for i in range(0, len(lines) - n + 1):
        w = lines[i:i+n]
        if w == a: exact += 1
        if [x.strip() for x in w] == at: trimmed += 1
    return exact, trimmed

rows = []
stats = collections.Counter()
for t, arm, rep, row, run, rd in sorted(rollouts(), key=lambda x: (x[0], x[1], x[2])):
    s = spec(t)
    gd = golddir(s["repo"], s["base_commit"])
    ev = parse(ndjson_path(row, rd))
    first_seen = set()
    for e in ev:
        if e["k"] != "tool" or e["tool"] != "apply_patch": continue
        pt = (e.get("input") or {}).get("patchText") or ""
        out = e.get("output") or ""
        m = re.search(r"\*\*\* (?:Update|Add|Delete) File: (\S+)", pt)
        fpath = m.group(1) if m else None
        rel = None
        if fpath:
            mm = re.search(r"/runs/[^/]+/(.*)$", fpath)
            rel = mm.group(1) if mm else fpath
        base_text = None
        if gd and rel:
            fp = os.path.join(gd, rel)
            if os.path.exists(fp):
                try: base_text = open(fp, errors="replace").read()
                except Exception: base_text = None
        anchors = hunk_contexts(pt)
        nh = len(re.findall(r"(?m)^@@", pt))
        bare = sum(1 for h in re.findall(r"(?m)^@@(.*)$", pt) if h.strip() == "")
        amb = []
        if base_text and rel not in first_seen:
            for a in anchors:
                ex, tr = count_occurrences(base_text, a)
                amb.append(max(ex, tr))
        if rel: first_seen.add(rel)
        rows.append({"task": t, "arm": arm, "rep": rep, "resolved": row.get("resolved"),
                     "file": rel, "hunks": nh, "bareAt": bare, "ok": "Success" in out,
                     "ambiguity": amb, "firstEditOfFile": bool(amb)})
        stats["edits"] += 1
        stats["bareHunks"] += bare; stats["hunks"] += nh
        if amb:
            stats["measurable"] += 1
            if any(x > 1 for x in amb):
                stats["hasAmbiguousAnchor"] += 1
                stats["amb_" + arm] += 1
            if any(x == 0 for x in amb): stats["anchorNotInBase"] += 1
json.dump(rows, open("/tmp/fp-inv/e4-opencode/ambiguity.json", "w"))
print(json.dumps(dict(stats), indent=1))
print("\nAMBIGUOUS-ANCHOR EDITS (a hunk whose context sequence matches >1 place in the base file):")
for r in rows:
    if r["ambiguity"] and any(x > 1 for x in r["ambiguity"]):
        print("  %-42s %-6s rep%d resolved=%-5s file=%-40s hunks=%d bare@@=%d occ=%s" %
              (r["task"], r["arm"], r["rep"], r["resolved"], (r["file"] or "")[:40], r["hunks"], r["bareAt"], r["ambiguity"]))
