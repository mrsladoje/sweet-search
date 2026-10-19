"""Yield check (GREP_PAPER_PLAN.md, step S1): how many usable grep calls does a trace sample give?

Reads a stratified sample of nvidia/Open-SWE-Traces from local parquet shards (--shards-dir,
laid out as <harness>/<model>/<source>/*.parquet, two shards per stratum picked with seed 42),
parses every grep-family call, and writes per-call records. It does not touch any repository.

Stratum = harness x model x task source (24 directories). Per stratum it keeps --per-stratum
rows, sampled with seed 42. --instances reads only the instance_id and repo columns of all 285
remote shards over HTTP to count trajectories per instance.

Repository split (provisional, for later per-call replay): sha256("42:" + repo) < 0.6 -> dev.
This script reports aggregates over both splits and per-call records for dev only.

Usage:
  python yield_check.py --shards-dir DIR --out DIR [--per-stratum 210] [--instances]
"""

import argparse
import collections
import hashlib
import json
import os
import random
import sys
import urllib.request

import aiohttp
import fsspec
import pyarrow.parquet as pq

from traces import grep_calls

DATASET = "nvidia/Open-SWE-Traces"
API = f"https://huggingface.co/api/datasets/{DATASET}/tree/main?recursive=true"
RESOLVE = f"https://huggingface.co/datasets/{DATASET}/resolve/main/"
COLUMNS = ["instance_id", "repo", "language", "trajectory_id", "messages", "resolved", "metadata",
           "hf_dataset_name"]


def split_of(repo):
    h = int(hashlib.sha256(f"42:{repo}".encode()).hexdigest()[:8], 16) / 0xFFFFFFFF
    return "dev" if h < 0.6 else "heldout"


def list_shards():
    with urllib.request.urlopen(API, timeout=60) as r:
        tree = json.load(r)
    strata = collections.defaultdict(list)
    for x in tree:
        if x["type"] == "file" and x["path"].endswith(".parquet"):
            strata["/".join(x["path"].split("/")[1:4])].append(x["path"])
    return {k: sorted(v) for k, v in sorted(strata.items())}


def local_strata(root):
    strata = collections.defaultdict(list)
    for dirpath, _, files in os.walk(root):
        for f in files:
            if f.endswith(".parquet"):
                strata[os.path.relpath(dirpath, root)].append(os.path.join(dirpath, f))
    return {k: sorted(v) for k, v in sorted(strata.items())}


def instance_counts(strata, fs):
    """Trajectories per instance over the whole dataset, reading only the instance_id column."""
    per_instance, repos = collections.Counter(), set()
    for paths in strata.values():
        for path in paths:
            with fs.open(RESOLVE + path, "rb", block_size=1 << 16) as f:
                t = pq.ParquetFile(f).read(columns=["instance_id", "repo"])
            per_instance.update(t.column("instance_id").to_pylist())
            repos.update(t.column("repo").to_pylist())
    return per_instance, repos


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--per-stratum", type=int, default=210)
    ap.add_argument("--shards-dir", required=True)
    ap.add_argument("--instances", action="store_true", help="also count trajectories per instance")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    rng = random.Random(42)
    fs = fsspec.filesystem("http", client_kwargs={"timeout": aiohttp.ClientTimeout(total=1800)})

    calls_out = open(os.path.join(a.out, "calls-dev.jsonl"), "w")
    traj_out = open(os.path.join(a.out, "trajectories.jsonl"), "w")
    for stratum, paths in local_strata(a.shards_dir).items():
        harness = stratum.split("/")[0]
        rows = []
        for path in paths:
            rows.extend(pq.read_table(path, columns=COLUMNS).to_pylist())
        rows = rng.sample(rows, min(a.per_stratum, len(rows)))
        n_calls = 0
        for row in rows:
            row["_harness"] = harness
            calls, golds, steps = grep_calls(row)
            split = split_of(row["repo"])
            n_calls += len(calls)
            traj_out.write(json.dumps({
                "stratum": stratum, "instance_id": row["instance_id"], "repo": row["repo"],
                "language": row["language"], "source": row["hf_dataset_name"], "split": split,
                "resolved": row["resolved"], "steps": steps, "n_gold": len(golds),
                "calls": [{k: c[k] for k in ("tool", "pre_edit", "searches_files", "recursive", "via_xargs",
                                             "n_operands", "head",
                                             "head_cut", "harness_cut", "gold_shown", "operand_is_gold",
                                             "multi_grep_command", "n_lines")} for c in calls],
            }) + "\n")
            if split == "dev":
                for c in calls:
                    c.update(stratum=stratum, instance_id=row["instance_id"], repo=row["repo"],
                             trajectory_id=row["trajectory_id"], language=row["language"],
                             source=row["hf_dataset_name"], gold=golds)
                    calls_out.write(json.dumps(c) + "\n")
        print(f"{stratum:55s} rows={len(rows):4d} grep_calls={n_calls}", file=sys.stderr, flush=True)
    calls_out.close()
    traj_out.close()

    if a.instances:
        per_instance, repos = instance_counts(list_shards(), fs)
        dist = collections.Counter(per_instance.values())
        json.dump({"instances": len(per_instance), "repos": len(repos),
                   "trajectories_per_instance": dict(sorted(dist.items()))},
                  open(os.path.join(a.out, "instances.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
