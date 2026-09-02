#!/usr/bin/env python3
"""E4 -- did each arm's retrieval reach the file the gold patch edits?

Per task x arm x rep:
  named   the gold file's path appears in a command the agent issued
  shown   it appears in any tool output the agent received
  patched the rollout's model_patch touches it
Gold files that are pure changelog/doc noise are dropped.
"""
import json, os, re, sys, collections

IN = sys.argv[1] if len(sys.argv) > 1 else "/tmp/fp-inv/e4-codex/all.jsonl"
BASE = "/root/sweet-search-private/eval/task-completion-bench/results"
TASKS = "/root/sweet-search-private/eval/task-completion-bench/select/.cache/tasks_full_heldout.json"
RUNS = {"TAB": "fp-codex-tab-20260826", "NONE": "fp-codex-none-20260826", "PIPE": "fp-codex-pipe-20260826"}
NOISE = re.compile(r"CHANGELOG|CHANGES/|\.md$|\.map$|\.lock$")


def gold_files():
    out = {}
    for t in json.load(open(TASKS)):
        fs = re.findall(r"^diff --git a/(\S+)", t.get("patch") or "", re.M)
        out[t["instance_id"]] = [f for f in fs if not NOISE.search(f)]
    return out


def patch_of(run, armdir, rep, task):
    p = os.path.join(BASE, run, armdir, "patches.json") if rep == 0 else \
        os.path.join(BASE, run, armdir, f"rep-{rep}", "patches.json")
    if not os.path.exists(p):
        return None
    for r in json.load(open(p)):
        if r.get("instance_id") == task:
            return r.get("patch")


def main():
    gf = gold_files()
    only = sys.argv[2:] if len(sys.argv) > 2 else None
    agg = collections.defaultdict(lambda: collections.defaultdict(collections.Counter))
    for line in open(IN):
        rec = json.loads(line)
        tr = rec.get("trace")
        task, arm = rec["task"], rec["arm"]
        if only and task not in only:
            continue
        files = gf.get(task) or []
        if not files or not tr:
            continue
        cmds = "\n".join(c.get("cmd", "") for c in tr["calls"] if c.get("name") == "exec_command")
        outs = "\n".join(((c.get("out") or {}).get("body") or "") for c in tr["calls"])
        p = patch_of(RUNS[rec["form"]], "native" if arm == "native" else "sweet", rec["rep"], task) or ""
        pf = set(re.findall(r"^diff --git a/(\S+)", p, re.M))
        for f in files:
            base = f.split("/")[-1]
            agg[task][arm]["n"] += 1
            if f in cmds or base in cmds:
                agg[task][arm]["named"] += 1
            if f in outs or base in outs:
                agg[task][arm]["shown"] += 1
            if f in pf:
                agg[task][arm]["patched"] += 1
    print(f"{'task':44s} {'goldfiles':>9s}  " + "  ".join(f"{a:>22s}" for a in ("native", "TAB", "NONE", "PIPE")))
    print(f"{'':44s} {'':>9s}  " + "  ".join(f"{'named/shown/patched':>22s}" for _ in range(4)))
    for task in sorted(agg):
        nf = len(gf[task])
        row = []
        for a in ("native", "TAB", "NONE", "PIPE"):
            c = agg[task][a]
            row.append(f"{c['named']}/{c['shown']}/{c['patched']} of {c['n']}")
        print(f"{task:44s} {nf:9d}  " + "  ".join(f"{r:>22s}" for r in row))
    json.dump({t: {a: dict(agg[t][a]) for a in agg[t]} for t in agg},
              open("/tmp/fp-inv/e4-codex/goldreach.json", "w"), indent=1)


if __name__ == "__main__":
    main()
