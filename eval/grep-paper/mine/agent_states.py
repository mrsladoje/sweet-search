"""Agent check (GREP_PAPER_PLAN.md E5d): pick the overflow states and the search-only tasks.

Design 1 (resume) needs states just before an overflowing grep response that contained a fix
file. Design 2 (fresh search-only runs) needs tasks whose traces had such a grep. Both come from
DeepSeek-V4-Flash OpenHands trajectories on SWE-rebench-V2, dev repositories only, so the resume
model is the trace model.

A state qualifies (rule fixed before any agent run) when the call:
  - runs before the first edit, searches several files, and is the only grep of its command;
  - has the shape `[cd X &&] grep ... | head -N` (nothing else after grep), no context or count flags;
  - was cut by that head (visible lines >= N);
  - replays on a clean checkout with every visible line found, a larger full output, and a
    gold-patch file in the full output (evidence-bearing, file level).
States are taken in seed-42 random order; no state is chosen by how the ranked order does.

Usage: python agent_states.py --shards DIR --tasks task_index.json --work DIR --out FILE [--max 40]
"""

import argparse
import glob
import json
import os
import random
import sys

import pyarrow.parquet as pq

from replay_sample import agreement, call_root, checkout, run_call
from traces import grep_calls, split_commands, _strip_prefix
from yield_check import split_of

STRATUM = "openhands/deepseek_v4_flash_0731/swe-rebench-v2"
BLOCK = set("ABCclLqo")


def simple_head_pipeline(command):
    """True if the command is [cd ...] && grep ... | head -N and nothing else."""
    pipelines = split_commands(command)
    if not pipelines:
        return False
    loud = [p for p in pipelines if p and p[0] and p[0][0] != "cd"]
    if len(loud) != 1 or len(loud[0]) != 2:
        return False
    g, h = loud[0]
    g, _ = _strip_prefix(g)
    if not g or g[0] not in ("grep", "egrep", "fgrep") or h[0] != "head":
        return False
    for a in g[1:]:
        if a.startswith("--") and a.split("=")[0] in ("--context", "--after-context", "--before-context", "--count",
                                                       "--files-with-matches", "--files-without-match", "--quiet"):
            return False
        if a.startswith("-") and not a.startswith("--") and any(ch in BLOCK for ch in a[1:]):
            return False
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shards", required=True)
    ap.add_argument("--tasks", required=True)
    ap.add_argument("--work", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--max", type=int, default=40)
    a = ap.parse_args()
    tasks = json.load(open(a.tasks))
    rng = random.Random(42)
    cands = []
    for path in sorted(glob.glob(os.path.join(a.shards, STRATUM, "*.parquet"))):
        t = pq.read_table(path, columns=["instance_id", "repo", "trajectory_id", "messages", "metadata"]).to_pylist()
        for i, row in enumerate(t):
            if split_of(row["repo"]) != "dev" or row["instance_id"] not in tasks:
                continue
            row["_harness"] = "openhands"
            calls, golds, _ = grep_calls(row)
            for c in calls:
                multi = c["recursive"] or c["via_xargs"] or c["n_operands"] > 1
                if (c["pre_edit"] and c["searches_files"] and multi and not c["multi_grep_command"] and c["head_cut"]
                        and simple_head_pipeline(c["command"])):
                    c.update(shard=path, row=i, instance_id=row["instance_id"], repo=row["repo"],
                             trajectory_id=row["trajectory_id"], gold=golds, stratum=STRATUM)
                    cands.append(c)
    rng.shuffle(cands)
    print(f"candidates: {len(cands)}", file=sys.stderr, flush=True)
    kept, seen_traj = [], set()
    for c in cands:
        if len(kept) >= a.max:
            break
        if c["trajectory_id"] in seen_traj:  # one state per trajectory
            continue
        task = tasks[c["instance_id"]]
        root, why = call_root(c)
        if why or not root:
            continue
        tree, why = checkout(a.work, c["repo"], task["base_commit"])
        if why:
            continue
        full, why = run_call(c, root, tree)
        if why:
            continue
        miss, n = agreement(c["visible"], full)
        if miss or len(full) <= len(c["visible"]):
            continue
        if not any(g in ln for g in c["gold"] for ln in full):
            continue
        seen_traj.add(c["trajectory_id"])
        kept.append({k: c[k] for k in ("shard", "row", "instance_id", "repo", "trajectory_id", "msg_index", "command",
                                       "head", "gold", "gold_shown", "visible")}
                    | {"root": root, "tree": tree, "full": full, "base_commit": task["base_commit"]})
        print(f"kept {len(kept)}: {c['instance_id']} N={c['head']} full={len(full)} shown={c['gold_shown']}",
              file=sys.stderr, flush=True)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w") as f:
        for k in kept:
            f.write(json.dumps(k) + "\n")


if __name__ == "__main__":
    main()
