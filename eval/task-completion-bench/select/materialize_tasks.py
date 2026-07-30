#!/usr/bin/env python3
"""
Materialize FULL task specs for the frozen instance_ids (the frozen jsonl files
hold only metadata). Output is consumed by run-pilot (problem_statement, repo,
base_commit, image, install_config, workdir) AND by SWE-rebench eval.py (patch,
test_patch, FAIL_TO_PASS, PASS_TO_PASS) at grade time.

CONTAINS GOLD PATCHES + HIDDEN TESTS -> writes to select/.cache/ (gitignored),
NEVER committed and NEVER inside an agent checkout. The agent's tools are
sandboxed to its run dir; this file lives in the harness tree, out of reach.

  python materialize_tasks.py --set multilingual            # all 200
  python materialize_tasks.py --set decontam                # all 215
  python materialize_tasks.py --set multilingual --limit 2  # first 2 ids (e2e)
  python materialize_tasks.py --set heldout --gate-only     # report the gate, write nothing

TASK-REJECTION GATE (select/task_gates.py) — this script materializes an ALREADY
FROZEN id list, so the gate is an AUDIT checkpoint here, not the gate itself: the
real rejection happens in select_tasks.py / select_heldout.py, before the draw.
Default is REPORT + sidecar (frozen sets predate the gate and must stay
materializable for re-grading); `--enforce-gate` actually drops the offenders.

workdir convention: SWE-rebench-V2 images put the repo at /<repo-basename>
(eval.py: workdir = f"/{repo.split('/')[1]}"). V1 leaderboard images (sweb.eval.*)
put it at /testbed. We stamp `workdir` + `grader` per task so run-pilot/gradeArm
don't have to branch on dataset.
"""
import argparse, json, os, collections

import task_gates

# `datasets` is imported lazily: --gate-only audits an already-materialized spec
# file and must run on any box (and on a laptop) without the HF stack installed.

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache")
V2_NAME = "nebius/SWE-rebench-V2"
V1_NAME = "nebius/SWE-rebench-leaderboard"


def frozen_ids(setname):
    fn = os.path.join(HERE, f"tasks_{setname}.jsonl")
    rows = [json.loads(l) for l in open(fn)]
    return rows


def slim_spec(r, workdir, grader):
    # everything run-pilot OR eval.py needs; keep gold fields (patch/test_patch) —
    # this file is gitignored + out of agent reach.
    return {
        "instance_id": r["instance_id"], "repo": r["repo"], "base_commit": r["base_commit"],
        "language": r.get("language", "python"), "problem_statement": r.get("problem_statement", ""),
        "image_name": r.get("image_name") or r.get("docker_image"),
        "install_config": r.get("install_config") or {},
        "FAIL_TO_PASS": r.get("FAIL_TO_PASS") or [], "PASS_TO_PASS": r.get("PASS_TO_PASS") or [],
        "patch": r.get("patch", ""), "test_patch": r.get("test_patch", ""),
        "workdir": workdir, "grader": grader,
    }


def materialize_multilingual(ids):
    from datasets import load_dataset
    want = {x["instance_id"] for x in ids}
    out = {}
    for r in load_dataset(V2_NAME, split="train", streaming=True):
        iid = r["instance_id"]
        if iid in want:
            wd = f"/{r['repo'].split('/')[1]}"
            out[iid] = slim_spec(r, wd, "v2")
            if len(out) == len(want):
                break
    return [out[i] for i in (x["instance_id"] for x in ids) if i in out], want - set(out)


def materialize_decontam(ids):
    from datasets import load_dataset
    by_month = collections.defaultdict(set)
    for x in ids:
        by_month[x["month"]].add(x["instance_id"])
    out = {}
    for month, want in by_month.items():
        for r in load_dataset(V1_NAME, split=month):
            if r["instance_id"] in want:
                out[r["instance_id"]] = slim_spec(r, "/testbed", "v1")  # leaderboard = sweb.eval images
    missing = {x["instance_id"] for x in ids} - set(out)
    return [out[i] for i in (x["instance_id"] for x in ids) if i in out], missing


def run_gate(specs, setname, enforce):
    """Audit the materialized specs against the task-rejection gate. Returns the
    specs to write. Always logs + writes the sidecar; only drops under --enforce-gate."""
    os.makedirs(CACHE, exist_ok=True)
    kept, rejected = task_gates.partition(specs, log=print, label=setname)
    side = task_gates.write_rejections(
        CACHE, f"materialized_{setname}", rejected,
        {"source": f"tasks_{setname}.jsonl", "enforced": bool(enforce), "n_input": len(specs)})
    if rejected:
        verb = "DROPPED" if enforce else "kept (report-only; pass --enforce-gate to drop)"
        print(f"  [task-gate] {len(rejected)}/{len(specs)} spec(s) violate the gate — {verb}")
        print(f"  [task-gate] sidecar -> {side}")
    else:
        print(f"  [task-gate] 0/{len(specs)} violations; sidecar -> {side}")
    return kept if enforce else specs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", choices=["multilingual", "decontam", "heldout", "heldout_reserve",
                                      "heldout2", "heldout2_reserve"], required=True)
    ap.add_argument("--limit", type=int, default=0, help="take only first N frozen ids (e2e)")
    ap.add_argument("--out", default=None)
    ap.add_argument("--enforce-gate", action="store_true",
                    help="DROP gate-violating tasks instead of only reporting them")
    ap.add_argument("--gate-only", action="store_true",
                    help="run the gate against an ALREADY materialized spec file and exit "
                         "(reads --out or the default cache path; writes no spec file)")
    a = ap.parse_args()
    out = a.out or os.path.join(CACHE, f"tasks_full_{a.set}{('_n' + str(a.limit)) if a.limit else ''}.json")

    if a.gate_only:
        specs = json.load(open(out))
        print(f"gate-only: {len(specs)} spec(s) from {out}")
        run_gate(specs, a.set, enforce=False)
        return

    ids = frozen_ids(a.set)
    if a.limit:
        ids = ids[: a.limit]
    specs, missing = (materialize_decontam if a.set == "decontam" else materialize_multilingual)(ids)
    os.makedirs(CACHE, exist_ok=True)
    specs = run_gate(specs, a.set, a.enforce_gate)
    json.dump(specs, open(out, "w"))
    print(f"materialized {len(specs)}/{len(ids)} {a.set} specs -> {out}")
    if missing:
        print(f"  MISSING {len(missing)} (not found in source): {sorted(missing)[:10]}")
    # sanity
    for s in specs[:3]:
        print(f"  {s['instance_id']:38} lang={s['language']:7} workdir={s['workdir']:18} "
              f"img={(s['image_name'] or '?')[:40]} F2P={len(s['FAIL_TO_PASS'])} test_cmd={'test_cmd' in s['install_config']}")


if __name__ == "__main__":
    main()
