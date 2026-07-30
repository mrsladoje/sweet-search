#!/usr/bin/env python3
"""
Pre-registered, DETERMINISTIC task selection for the sweet-search task-completion
benchmark. Emits frozen task lists + a provenance manifest. NOTHING here ever
looks at sweet-vs-native outcomes — every criterion is ORTHOGONAL to the tool
(quality, language, date, gradeability). That is what keeps the selection
publishable: a mechanical rule applied blind, not hand-curation.

Populations
-----------
MULTILINGUAL (headline; efficiency is the primary metric):
  nebius/SWE-rebench-V2 — 20 languages, SWE-bench-format FAIL_TO_PASS/PASS_TO_PASS,
  pre-built Docker images. Filters: llm quality code == 'A', non-empty
  FAIL_TO_PASS, created_at >= --date-floor (default: none -> full range).
  Stratified by language (floor per language, proportional remainder), seeded
  random within each stratum. Rationale for allowing the full date range:
  contamination is CONSERVATIVE against an efficiency claim (a memorized fix
  compresses the exploration gap in BOTH arms; it never inflates it), so breadth
  + adequate N matter more here than strict recency. Strict recency is the
  DECONTAMINATION set's job below.

DECONTAMINATION (robustness check; strict recency):
  nebius/SWE-rebench-leaderboard — monthly Python splits. We take the 2026 months
  (post knowledge-cutoff for both target models). If the efficiency gain
  replicates here as on the multilingual set, contamination is not driving it.

Usage:
  python select_tasks.py --dry-run                 # print counts, write nothing
  python select_tasks.py --n 200 --seed 42 --freeze # write frozen lists + manifest
"""
import argparse, json, os, random, collections
from datasets import load_dataset, load_dataset_builder
try:
    from huggingface_hub import HfApi
except Exception:
    HfApi = None

import task_gates

V2_NAME = "nebius/SWE-rebench-V2"
V1_NAME = "nebius/SWE-rebench-leaderboard"
DECONTAM_MONTHS = ["2026_01", "2026_02", "2026_03"]  # post knowledge-cutoff Python
OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def hf_rev(name):
    if HfApi is None:
        return None
    try:
        return HfApi().dataset_info(name).sha
    except Exception:
        return None


def quality_ok(r):
    code = ((r.get("meta") or {}).get("llm_metadata") or {}).get("code")
    return code == "A"


def ftp_ok(r):
    f = r.get("FAIL_TO_PASS")
    return bool(f) and len(f) > 0


def slim_v2(r):
    return {
        "instance_id": r["instance_id"], "repo": r["repo"], "language": r["language"],
        "created_at": str(r.get("created_at")), "license": r.get("license"),
        "image_name": r.get("image_name"), "base_commit": r.get("base_commit"),
        "n_fail_to_pass": len(r.get("FAIL_TO_PASS") or []),
        "n_pass_to_pass": len(r.get("PASS_TO_PASS") or []),
    }


def slim_v1(r, month):
    return {
        "instance_id": r["instance_id"], "repo": r["repo"], "language": "python",
        "created_at": str(r.get("created_at")), "month": month,
        "docker_image": r.get("docker_image") or r.get("image_name"),
        "base_commit": r.get("base_commit"),
        "n_fail_to_pass": len(r.get("FAIL_TO_PASS") or []),
        "n_pass_to_pass": len(r.get("PASS_TO_PASS") or []),
    }


def build_v2_pool(date_floor):
    pool = collections.defaultdict(list)
    drops = collections.Counter()
    rejected = []
    kept = 0
    for r in load_dataset(V2_NAME, split="train"):
        if not quality_ok(r):
            drops["quality_not_A"] += 1; continue
        if not ftp_ok(r):
            drops["no_FAIL_TO_PASS"] += 1; continue
        if date_floor and str(r.get("created_at"))[:10] < date_floor:
            drops["before_date_floor"] += 1; continue
        # Task-rejection gate (select/task_gates.py): suite-red-at-baseline tasks
        # measure build repair, not bug fixing. Metadata-only, outcome-blind.
        slim = slim_v2(r)
        gate_kept, gate_rejected = task_gates.partition([slim], log=print, label="v2")
        if gate_rejected:
            rejected.extend(gate_rejected)
            for code in gate_rejected[0]["reasons"]:
                drops[f"task_gate_{code}"] += 1
            continue
        pool[r["language"]].append(gate_kept[0]); kept += 1
    return pool, drops, kept, rejected


def allocate(pool, N, floor):
    """Stratified allocation: give each language min(floor, available), then
    distribute the remaining budget proportionally to leftover availability."""
    langs = sorted(pool, key=lambda L: -len(pool[L]))
    alloc = {L: min(floor, len(pool[L])) for L in langs}
    used = sum(alloc.values())
    remaining = max(0, N - used)
    leftover = {L: len(pool[L]) - alloc[L] for L in langs}
    total_left = sum(leftover.values())
    if remaining > 0 and total_left > 0:
        for L in langs:
            add = round(remaining * leftover[L] / total_left)
            alloc[L] = min(len(pool[L]), alloc[L] + add)
    # trim/pad to exactly N (deterministic order)
    while sum(alloc.values()) > N:
        L = max(langs, key=lambda L: alloc[L]);  alloc[L] -= 1
    while sum(alloc.values()) < N and any(alloc[L] < len(pool[L]) for L in langs):
        L = max(langs, key=lambda L: len(pool[L]) - alloc[L]);  alloc[L] += 1
    return alloc


def select_multilingual(N, seed, floor_per_lang, date_floor):
    pool, drops, kept, rejected = build_v2_pool(date_floor)
    alloc = allocate(pool, N, floor_per_lang)
    rng = random.Random(seed)
    chosen = []
    for L in sorted(pool):
        items = sorted(pool[L], key=lambda x: x["instance_id"])  # stable order
        rng.shuffle(items)
        chosen.extend(items[:alloc[L]])
    return chosen, {L: len(pool[L]) for L in sorted(pool)}, alloc, drops, kept, rejected


def select_decontam():
    out, per, rejected = [], {}, []
    for m in DECONTAM_MONTHS:
        try:
            ds = load_dataset(V1_NAME, split=m)
            rows = [slim_v1(r, m) for r in ds if ftp_ok(r)]
            rows, gate_rejected = task_gates.partition(rows, log=print, label=f"v1 {m}")
            rejected.extend(gate_rejected)
            out.extend(rows); per[m] = len(rows)
        except Exception as e:
            per[m] = f"ERR {str(e)[:60]}"
    return out, per, rejected


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--floor-per-lang", type=int, default=5)
    ap.add_argument("--date-floor", default=None, help="e.g. 2025-01-01; default full range")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--freeze", action="store_true")
    a = ap.parse_args()

    multi, pool_sizes, alloc, drops, kept, rej_v2 = select_multilingual(a.n, a.seed, a.floor_per_lang, a.date_floor)
    decon, decon_per, rej_v1 = select_decontam()
    rejected = rej_v2 + rej_v1

    manifest = {
        "seed": a.seed, "N_requested": a.n, "N_selected_multilingual": len(multi),
        "floor_per_lang": a.floor_per_lang, "date_floor": a.date_floor,
        "v2": {"name": V2_NAME, "revision": hf_rev(V2_NAME), "kept_after_filters": kept,
               "drops": dict(drops), "pool_by_language": pool_sizes, "allocation": alloc,
               "selected_by_language": dict(collections.Counter(x["language"] for x in multi))},
        "decontam": {"name": V1_NAME, "revision": hf_rev(V1_NAME), "months": DECONTAM_MONTHS,
                     "per_month": decon_per, "N_selected": len(decon)},
        "task_gate": {"thresholds": {"max_fail_to_pass": task_gates.MAX_FAIL_TO_PASS,
                                     "min_pass_to_pass": task_gates.MIN_PASS_TO_PASS},
                      "n_rejected": len(rejected),
                      "sidecar": os.path.basename(task_gates.rejection_sidecar_path(OUT_DIR, "multilingual"))},
        "criteria": "quality code=='A'; non-empty FAIL_TO_PASS; date_floor; task-rejection gate "
                    "(FAIL_TO_PASS<100 and PASS_TO_PASS>0, see task-gates.json); "
                    "stratified-by-language seeded sample. Orthogonal to sweet-vs-native outcome.",
    }
    print(json.dumps(manifest, indent=2, default=str))

    if a.freeze:
        with open(os.path.join(OUT_DIR, "tasks_multilingual.jsonl"), "w") as f:
            for x in multi: f.write(json.dumps(x) + "\n")
        with open(os.path.join(OUT_DIR, "tasks_decontam.jsonl"), "w") as f:
            for x in decon: f.write(json.dumps(x) + "\n")
        with open(os.path.join(OUT_DIR, "MANIFEST.json"), "w") as f:
            json.dump(manifest, f, indent=2, default=str)
        side = task_gates.write_rejections(OUT_DIR, "multilingual", rejected,
                                           {"populations": ["v2-multilingual", "v1-decontam"]})
        print(f"\nFROZEN -> {OUT_DIR}/tasks_multilingual.jsonl ({len(multi)}), tasks_decontam.jsonl ({len(decon)}), "
              f"MANIFEST.json, {os.path.basename(side)} ({len(rejected)} gate rejections)")
    elif not a.dry_run:
        print("\n(no --freeze and no --dry-run: nothing written)")


if __name__ == "__main__":
    main()
