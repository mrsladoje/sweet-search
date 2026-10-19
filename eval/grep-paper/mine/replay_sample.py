"""Yield check, part 2 (GREP_PAPER_PLAN.md, steps S1-S2 preview): replay a small dev sample.

Takes calls-dev.jsonl from yield_check.py and replays two samples on clean checkouts at the
task's base commit (no container):
  cut    pre-edit multi-file grep calls whose visible output was cut (head or harness)
  uncut  pre-edit multi-file grep calls whose visible output was complete (agreement check)

Only the grep (and, for `find ... | xargs grep`, the find) argv is executed, never the shell
line. GNU grep is ggrep, GNU find is gfind (Homebrew). Paths under /testbed and
/workspace/<dir> map to the checkout; a call that reads outside them is skipped.

Per call it records the full replayed output size, whether a gold-patch file appears in the
full output (L1, file level) and in the visible output, and whether every visible line is in
the replay (tier O / F agreement, order ignored).

Usage:
  python replay_sample.py --calls FILE --tasks task_index.json --work DIR --out FILE
    [--cut 120] [--uncut 60]
"""

import argparse
import collections
import glob
import json
import os
import random
import re
import shutil
import subprocess
import sys

from traces import grep_operands

TIMEOUT = 60
ROOT = re.compile(r"^(/testbed|/workspace/[^/]+)")


def git(*args, cwd=None):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, timeout=900)


def checkout(work, repo, commit):
    """Shallow fetch of one commit (GitHub serves any reachable sha), then a plain checkout."""
    tree = os.path.join(work, "trees", repo.replace("/", "__") + "@" + commit[:12])
    if os.path.isfile(os.path.join(tree, ".ok")):
        return tree, None
    shutil.rmtree(tree, ignore_errors=True)
    os.makedirs(tree)
    for args in (["init", "-q"], ["remote", "add", "origin", f"https://github.com/{repo}.git"],
                 ["fetch", "-q", "--depth", "1", "origin", commit], ["checkout", "-q", "FETCH_HEAD"]):
        try:
            r = git(*args, cwd=tree)
        except subprocess.TimeoutExpired:
            return None, "git timeout: " + args[0]
        if r.returncode:
            return None, args[0] + ": " + r.stderr.strip()[-200:]
    open(os.path.join(tree, ".ok"), "w").close()
    return tree, None


def call_root(call):
    roots = set()
    for a in [call.get("cwd") or ""] + call["grep_argv"][1:] + [x for argv in call["upstream"] for x in argv]:
        m = ROOT.match(a)
        if m:
            roots.add(m.group(1))
        elif a.startswith("/") and not a.startswith("/dev/"):
            return None, "outside repo: " + a[:80]
    if len(roots) > 1:
        return None, "several roots"
    if roots:
        return roots.pop(), None
    return ("/testbed" if call["stratum"].startswith(("minisweagent", "sweagent")) else None), None


def remap(argv, root, tree):
    return [a.replace(root, tree) if root else a for a in argv]


def expand_globs(argv, cwd):
    """The shell expanded unquoted globs; do the same for path operands that contain glob characters.
    (Quoting is lost after parsing, so a quoted glob operand is expanded too; this is rare.)"""
    operands = set(grep_operands(argv)[0])
    out = []
    for a in argv:
        if a in operands and any(ch in a for ch in "*?["):
            hits = sorted(glob.glob(a if a.startswith("/") else os.path.join(cwd, a)))
            if hits:
                out.extend(h if a.startswith("/") else os.path.relpath(h, cwd) for h in hits)
                continue
        out.append(a)
    return out


def run_call(call, root, tree):
    cwd = remap([call.get("cwd") or root or ""], root, tree)[0] or tree
    if not os.path.isdir(cwd):
        cwd = tree
    argv = remap(call["grep_argv"], root, tree)
    argv = expand_globs(argv, cwd)
    tool = call["tool"]
    if tool in ("grep", "egrep", "fgrep"):
        argv = ["ggrep"] + ({"egrep": ["-E"], "fgrep": ["-F"]}.get(tool, [])) + argv[1:]
    elif tool == "git-grep":
        argv = ["git", "grep"] + argv[1:]
    stdin = None
    if call["via_xargs"]:
        up = call["upstream"]
        if len(up) != 1 or up[0][0] != "find":
            return None, "unsupported upstream"
        f = subprocess.run(["gfind"] + remap(up[0], root, tree)[1:], cwd=cwd, capture_output=True,
                           timeout=TIMEOUT)
        files = [x for x in f.stdout.decode(errors="replace").split("\n") if x]
        # Like xargs: run in batches that fit the argument limit.
        batches = [argv + files[i:i + 2000] for i in range(0, len(files), 2000)] or []
    else:
        batches = [argv]
    out = ""
    for b in batches:
        try:
            r = subprocess.run(b, cwd=cwd, capture_output=True, timeout=TIMEOUT, stdin=subprocess.DEVNULL)
        except subprocess.TimeoutExpired:
            return None, "timeout"
        except (OSError, ValueError) as e:
            return None, "exec: " + str(e)[:80]
        if r.returncode > 1:
            return None, "exit %d: %s" % (r.returncode, r.stderr.decode(errors="replace")[:120])
        out += r.stdout.decode(errors="replace")
    out = out.replace(tree, root or tree)
    return [ln for ln in out.split("\n") if ln.strip()], None


def agreement(visible, full):
    full_set = set(full)
    vis = visible
    if len(vis) > 2:
        vis = vis[:-1]  # the last visible line can be cut mid-line by a character cap
    missing = [ln for ln in vis if ln not in full_set]
    return len(missing), len(vis)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--calls", required=True)
    ap.add_argument("--tasks", required=True)
    ap.add_argument("--work", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--cut", type=int, default=120)
    ap.add_argument("--uncut", type=int, default=60)
    a = ap.parse_args()
    tasks = json.load(open(a.tasks))
    rng = random.Random(42)
    pools = collections.defaultdict(list)
    for line in open(a.calls):
        c = json.loads(line)
        multi = c["recursive"] or c["via_xargs"] or c["n_operands"] > 1
        if not (c["pre_edit"] and c["searches_files"] and multi and not c["multi_grep_command"]):
            continue
        if c["instance_id"] not in tasks:
            continue
        kind = "cut" if (c["head_cut"] or c["harness_cut"]) else "uncut"
        pools[(kind, c["stratum"].split("/")[0])].append(c)
    sample = []
    for kind, n in (("cut", a.cut), ("uncut", a.uncut)):
        harnesses = sorted(h for k, h in pools if k == kind)
        for h in harnesses:
            pool = pools[(kind, h)]
            sample += [(kind, c) for c in rng.sample(pool, min(len(pool), n // len(harnesses)))]
    print({k: len(v) for k, v in pools.items()}, "sample", len(sample), file=sys.stderr, flush=True)

    with open(a.out, "w") as out:
        for i, (kind, c) in enumerate(sample):
            task = tasks[c["instance_id"]]
            rec = {"kind": kind, "stratum": c["stratum"], "instance_id": c["instance_id"],
                   "repo": c["repo"], "command": c["command"], "visible_lines": len(c["visible"]),
                   "head": c["head"], "harness_cut": c["harness_cut"], "gold_shown": c["gold_shown"]}
            root, why = call_root(c)
            tree = None
            if not why:
                tree, why = checkout(a.work, c["repo"], task["base_commit"])
            full = None
            if not why:
                full, why = run_call(c, root, tree)
            if why:
                rec["skip"] = why
            else:
                miss, n = agreement(c["visible"], full)
                golds = c["gold"]
                rec.update(full_lines=len(full),
                           full_has_gold=any(g in ln for g in golds for ln in full),
                           visible_missing=miss, visible_checked=n,
                           full_files=len({ln.split(":", 1)[0] for ln in full}))
            out.write(json.dumps(rec) + "\n")
            out.flush()
            print(i, kind, rec.get("skip") or (rec["full_lines"], rec["full_has_gold"], rec["gold_shown"],
                                              rec["visible_missing"]), file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()
