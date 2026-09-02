#!/usr/bin/env python3
"""E4 -- how much of each pool repo does the shipped index miss?

Reads each golden checkout's .sweet-search/code-graph.db (read-only copy) and
compares the indexed file set with the files on disk, split by the two causes
this run surfaced:
  A) an extension FILE_PATTERNS.include does not list  (e.g. .jam)
  B) a directory named build/dist/out/target/generated, which
     FILE_PATTERNS.exclude removes with an unanchored '**/build/**' glob
"""
import json, os, re, sqlite3, subprocess, sys, collections, shutil

GOLD = "/root/.ss-eval/golden"
TASKS = "/root/sweet-search-private/eval/task-completion-bench/select/.cache/tasks_full_heldout.json"
POOL = "/root/fresh-run/pool.txt"
TMP = "/tmp/fp-inv/e4-codex/_idx.db"
EXCL_DIRS = ("build", "dist", "out", "target", "generated", "__generated__")
# a conservative slice of FILE_PATTERNS.include
KNOWN = set("""js jsx ts tsx mjs cjs java kt scala go rs c cpp cc cxx h hpp hxx cs fs vb rb php
swift m mm lua zig nim ex exs dart py pyi sh bash sql proto graphql json yaml yml toml xml md rst
txt html css scss r R jl pl pm hs erl hrl ml clj el vim tcl""".split())


def main():
    pool = [l.strip() for l in open(POOL) if l.strip()]
    specs = {t["instance_id"]: t for t in json.load(open(TASKS))}
    rows = []
    for tid in pool:
        sp = specs.get(tid)
        if not sp:
            continue
        repo = sp["repo"].replace("/", "__")
        cands = [d for d in os.listdir(GOLD) if d.lower().startswith(repo.lower() + "@")]
        if not cands:
            rows.append((tid, repo, None, None, None, None, "no golden"))
            continue
        best = None
        for d in cands:
            p = os.path.join(GOLD, d, ".sweet-search", "code-graph.db")
            if os.path.exists(p):
                best = os.path.join(GOLD, d)
                break
        if not best:
            rows.append((tid, repo, None, None, None, None, "no index"))
            continue
        shutil.copy(os.path.join(best, ".sweet-search", "code-graph.db"), TMP)
        c = sqlite3.connect(TMP)
        indexed = set(r[0] for r in c.execute("select distinct file_path from entities"))
        c.close()
        onDiskExt = collections.Counter()
        missExt = collections.Counter()
        underExcl = 0
        underExclKnown = 0
        total = 0
        idx_base = set(os.path.normpath(p) for p in indexed)
        for root, dirs, files in os.walk(best):
            if ".git" in root or "node_modules" in root or "/.sweet-search" in root:
                dirs[:] = [d for d in dirs if d not in (".git", "node_modules", ".sweet-search")]
                if "/.git" in root or "/node_modules" in root or "/.sweet-search" in root:
                    continue
            for f in files:
                p = os.path.relpath(os.path.join(root, f), best)
                ext = f.rsplit(".", 1)[-1] if "." in f else ""
                if ext not in KNOWN:
                    onDiskExt[ext] += 1
                total += 1
                parts = p.split("/")
                if any(x in EXCL_DIRS for x in parts[:-1]):
                    underExcl += 1
                    if ext in KNOWN:
                        underExclKnown += 1
        # unknown-extension files that look like source (>=20 of one extension)
        unk = [(e, n) for e, n in onDiskExt.most_common(6) if e and n >= 20 and e not in KNOWN]
        rows.append((tid, repo, len(indexed), total, underExclKnown, unk, ""))
    print(f"{'task':44s} {'indexed':>8s} {'onDisk':>7s} {'excl-dir(known ext)':>20s}  unindexed-ext (n>=20)")
    for tid, repo, ni, nd, ue, unk, note in rows:
        if ni is None:
            print(f"{tid:44s} {note}")
            continue
        print(f"{tid:44s} {ni:8d} {nd:7d} {ue:20d}  {unk}")
    json.dump([{"task": r[0], "repo": r[1], "indexed": r[2], "onDisk": r[3],
                "underExcludedDirKnownExt": r[4], "unindexedExt": r[5], "note": r[6]} for r in rows],
              open("/tmp/fp-inv/e4-codex/indexgap.json", "w"), indent=1)


if __name__ == "__main__":
    main()
