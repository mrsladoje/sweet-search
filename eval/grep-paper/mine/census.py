"""Census E0 (GREP_PAPER_PLAN.md §6 E0, step S1) over all local Open-SWE-Traces shards.

Parses every trajectory in --shards-dir (<harness>/<model>/<source>/*.parquet) with traces.grep_calls
and writes:
  census.json            aggregate counters per (harness, model, source, split); no per-call data
  candidates-dev.jsonl   per-call records of eligible calls (§3.2 rules 1-3 + several files), DEV
                         repositories only, both task sources, cut and uncut
  patches-dev.jsonl      the gold patch of each dev instance with a candidate (for L1 labels)
  first-edits-dev.jsonl  per dev trajectory: the detector's first-edit step (edit-detector check)
  counts-dev.jsonl       independent match counts seen by dev agents before their first edit
                         (`grep ... | wc -l`, `grep -c ...`), for fidelity tier O+

Split (final rule, GREP_PAPER_PLAN.md §3.4): a repository is dev if it is in inspected_repos.txt,
else dev if sha256("42:"+repo) maps below 0.6, else held-out. Held-out trajectories add to the
aggregate counters only.

Usage: python census.py --shards-dir DIR --out DIR [--procs 4]
"""

import argparse
import collections
import json
import multiprocessing
import os
import re
import sys

import pyarrow.parquet as pq

from traces import BASH_TOOLS, _loads, _strip_prefix, editor_edit, grep_calls, shell_edit, split_commands
from yield_check import split_of

HERE = os.path.dirname(os.path.abspath(__file__))
COLUMNS = ["instance_id", "repo", "language", "trajectory_id", "messages", "metadata", "hf_dataset_name"]
INSPECTED = {x.strip() for x in open(os.path.join(HERE, "inspected_repos.txt")) if x.strip()}
# Short options of GNU grep that take a value (the rest of the cluster is the value).
GREP_VALUE_SHORT = set("ABCDdefm")
RG_VALUE_SHORT = set("ABCefgmMtTj")
SOURCE = {"swe-rebench-v2": "swe-rebench-v2", "scale-swe": "scale-swe"}


def final_split(repo):
    return "dev" if repo in INSPECTED else split_of(repo)


def grep_shape(argv):
    """(sorted flag names, pattern list) of one grep-family argv. Long options keep their name only."""
    tool = argv[0]
    value_short = RG_VALUE_SHORT if tool == "rg" else GREP_VALUE_SHORT
    flags, patterns, operands, i = set(), [], [], 1
    while i < len(argv):
        a = argv[i]
        if a == "--":
            operands.extend(argv[i + 1:])
            break
        if a.startswith("--") and len(a) > 2:
            name, eq, val = a.partition("=")
            flags.add(name)
            if name in ("--regexp",):
                patterns.append(val if eq else (argv[i + 1] if i + 1 < len(argv) else ""))
            if not eq and name in ("--regexp", "--file", "--include", "--exclude", "--exclude-dir", "--max-count",
                                   "--context", "--after-context", "--before-context", "--glob", "--type"):
                i += 1
            i += 1
            continue
        if a.startswith("-") and len(a) > 1 and not re.match(r"^-\d+$", a):
            j = 1
            while j < len(a):
                ch = a[j]
                flags.add("-" + ch)
                if ch in value_short:
                    val = a[j + 1:]
                    if not val:
                        i += 1
                        val = argv[i] if i < len(argv) else ""
                    if ch == "e":
                        patterns.append(val)
                    break
                j += 1
            i += 1
            continue
        if re.match(r"^-\d+$", a):
            flags.add("-NUM")
            i += 1
            continue
        operands.append(a)
        i += 1
    if not patterns and "-f" not in flags and "--file" not in flags and operands:
        patterns.append(operands[0])
    return sorted(flags), patterns


def count_observation(call, flags):
    """An independent count of the call's output, or None: `grep ... | wc -l` (output lines) or a lone
    `grep -c ...` (sum of per-file counts = |M|). Only single-grep commands, so the number is unmixed."""
    if call["multi_grep_command"] or not call["visible"]:
        return None
    for p in split_commands(call["command"]) or []:
        for idx, argv in enumerate(p):
            if _strip_prefix(argv)[0] != call["grep_argv"]:
                continue
            rest = p[idx + 1:]
            if rest == [["wc", "-l"]] and re.match(r"^\s*\d+\s*$", call["visible"][0]):
                return "wc_lines", int(call["visible"][0])
            if not rest and ("-c" in flags or "--count" in flags):
                try:
                    return "count_sum", sum(int(v.rsplit(":", 1)[-1]) for v in call["visible"])
                except ValueError:
                    return None
    return None


def first_edit_step(row, harness):
    """Step of the detector's first edit (same rule as traces.grep_calls), or None."""
    msgs = _loads(row["messages"])
    step, pending = 0, []
    for m in msgs:
        if m["role"] == "assistant":
            pending = list(m.get("tool_calls") or [])
            continue
        if m["role"] != "tool" or not pending:
            continue
        tc = pending.pop(0)
        step += 1
        fn = tc.get("function", {}).get("name")
        try:
            args = _loads(tc["function"].get("arguments") or "{}") or {}
        except ValueError:
            args = {}
        if fn == "str_replace_editor" and editor_edit(args):
            return step
        if fn in BASH_TOOLS and shell_edit(args.get("command") or ""):
            return step
    return None


def count_tools(row):
    msgs = _loads(row["messages"])
    n_tool, n_bash = 0, 0
    for m in msgs:
        if m["role"] == "assistant":
            for tc in m.get("tool_calls") or []:
                n_tool += 1
                n_bash += tc.get("function", {}).get("name") in BASH_TOOLS
    return n_tool, n_bash


def work(job):
    path, stratum, out_dir = job
    harness, model, source = stratum.split("/")
    agg = collections.defaultdict(collections.Counter)
    tag = stratum.replace("/", "__") + "__" + os.path.basename(path).replace(".parquet", "")
    cand_out = open(os.path.join(out_dir, "parts", tag + ".cands.jsonl"), "w")
    patch_out = open(os.path.join(out_dir, "parts", tag + ".patches.jsonl"), "w")
    edit_out = open(os.path.join(out_dir, "parts", tag + ".edits.jsonl"), "w")
    count_out = open(os.path.join(out_dir, "parts", tag + ".counts.jsonl"), "w")
    pf = pq.ParquetFile(path)
    for row_index_base, batch in _batches(pf):
        for k, row in enumerate(batch.to_pylist()):
            row["_harness"] = harness
            split = final_split(row["repo"])
            key = f"{harness}|{model}|{source}|{split}"
            c = agg[key]
            calls, golds, steps = grep_calls(row)
            n_tool, n_bash = count_tools(row)
            c["trajectories"] += 1
            c["tool_calls"] += n_tool
            c["bash_calls"] += n_bash
            c["grep_calls"] += len(calls)
            c["traj_with_grep"] += bool(calls)
            n_cand_cut = 0
            for call in calls:
                c["tool:" + call["tool"]] += 1
                if call["pre_edit"]:
                    c["pre_edit"] += 1
                if call["head"] is not None:
                    c["piped_head"] += 1
                    c[f"head_n:{call['head']}"] += 1
                if call["head_cut"]:
                    c["head_cut_any"] += 1
                if call["harness_cut"]:
                    c["harness_cut_any"] += 1
                if not call["searches_files"]:
                    continue
                c["searches_files"] += 1
                flags, patterns = grep_shape(call["grep_argv"])
                if split == "dev" and call["pre_edit"]:
                    obs = count_observation(call, flags)
                    if obs:
                        count_out.write(json.dumps({"trajectory_id": row["trajectory_id"], "step": call["step"],
                                                    "grep_argv": call["grep_argv"], "cwd": call["cwd"],
                                                    "upstream": call["upstream"], "kind": obs[0],
                                                    "value": obs[1]}) + "\n")
                for f in flags:
                    c["flag:" + f] += 1
                if call["tool"] in ("grep", "fgrep") and "-E" not in flags and "-F" not in flags and \
                        "-P" not in flags and any("\\|" in p for p in patterns):
                    c["form:bre_alternation"] += 1
                if any(re.search(r"(?<!\\)\|", p) for p in patterns):
                    c["form:bare_bar"] += 1
                c["flagset:" + " ".join(f for f in flags)] += 1
                if not call["pre_edit"]:
                    continue
                c["sf_pre_edit"] += 1
                multi = call["recursive"] or call["via_xargs"] or call["n_operands"] > 1
                if not multi:
                    continue
                c["sf_pre_multi"] += 1
                if call["multi_grep_command"]:
                    continue
                c["eligible"] += 1
                cut = call["head_cut"] or call["harness_cut"]
                if cut:
                    c["eligible_cut"] += 1
                    c["eligible_cut_by_head" if call["head_cut"] else "eligible_cut_by_harness"] += 1
                    c[f"eligible_cut_head_n:{call['head']}"] += 1
                    c["eligible_cut_gold_shown"] += call["gold_shown"]
                    n_cand_cut += 1
                if split == "dev":
                    call.update(stratum=stratum, harness=harness, model=model, source=source,
                                instance_id=row["instance_id"], repo=row["repo"], trajectory_id=row["trajectory_id"],
                                language=row["language"], gold=golds, shard=path, row=row_index_base + k,
                                flags=flags, patterns=patterns, cut=cut)
                    cand_out.write(json.dumps(call) + "\n")
            c["traj_with_eligible_cut"] += n_cand_cut > 0
            if split == "dev":
                edit_out.write(json.dumps({"trajectory_id": row["trajectory_id"], "stratum": stratum, "shard": path,
                                           "row": row_index_base + k, "instance_id": row["instance_id"],
                                           "steps": steps, "first_edit": first_edit_step(row, harness)}) + "\n")
                if calls:
                    meta = _loads(row["metadata"]) or {}
                    patch = ((meta.get("reference_patch") or {}).get("patch")) or ""
                    patch_out.write(json.dumps({"instance_id": row["instance_id"], "patch": patch}) + "\n")
    for f in (cand_out, patch_out, edit_out, count_out):
        f.close()
    print(f"done {tag}", file=sys.stderr, flush=True)
    return {k: dict(v) for k, v in agg.items()}


def _batches(pf):
    base = 0
    for batch in pf.iter_batches(batch_size=256, columns=COLUMNS):
        yield base, batch
        base += batch.num_rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shards-dir", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--procs", type=int, default=4)
    a = ap.parse_args()
    os.makedirs(os.path.join(a.out, "parts"), exist_ok=True)
    jobs = []
    for dirpath, _, files in os.walk(a.shards_dir):
        for f in sorted(files):
            if f.endswith(".parquet"):
                jobs.append((os.path.join(dirpath, f), os.path.relpath(dirpath, a.shards_dir), a.out))
    jobs.sort()
    total = collections.defaultdict(collections.Counter)
    with multiprocessing.Pool(a.procs) as pool:
        for part in pool.imap_unordered(work, jobs):
            for k, v in part.items():
                total[k].update(v)
    json.dump({k: dict(sorted(v.items())) for k, v in sorted(total.items())},
              open(os.path.join(a.out, "census.json"), "w"), indent=0)
    # Merge the dev parts; patches deduplicated per instance.
    seen = set()
    with open(os.path.join(a.out, "candidates-dev.jsonl"), "w") as cands, \
            open(os.path.join(a.out, "patches-dev.jsonl"), "w") as patches, \
            open(os.path.join(a.out, "first-edits-dev.jsonl"), "w") as edits, \
            open(os.path.join(a.out, "counts-dev.jsonl"), "w") as counts:
        for f in sorted(os.listdir(os.path.join(a.out, "parts"))):
            p = os.path.join(a.out, "parts", f)
            if f.endswith(".cands.jsonl"):
                cands.write(open(p).read())
            elif f.endswith(".edits.jsonl"):
                edits.write(open(p).read())
            elif f.endswith(".counts.jsonl"):
                counts.write(open(p).read())
            elif f.endswith(".patches.jsonl"):
                for line in open(p):
                    iid = json.loads(line)["instance_id"]
                    if iid not in seen:
                        seen.add(iid)
                        patches.write(line)


if __name__ == "__main__":
    main()
