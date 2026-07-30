#!/usr/bin/env python3
"""
Pre-registered, DETERMINISTIC held-out selection for the sweet-search
task-completion benchmark. See HELDOUT_PREREGISTRATION.md — this script is the
mechanical implementation of that document and nothing else. It never looks at
sweet-vs-native outcomes.

Differences from select_tasks.py (dev-200):
  - FIXED language quotas (Octoverse-2025-anchored) instead of floor+proportional
  - excludes dev-200 instance_ids AND dev-200 repos, plus decontam instance_ids
  - seed 20260715, V2 revision pinned to the dev manifest revision
  - refuses to freeze if any overlap with the dev set survives

Usage:
  python select_heldout.py --dry-run   # print manifest, write nothing
  python select_heldout.py --freeze    # write tasks_heldout.jsonl + MANIFEST_heldout.json
"""
import argparse, json, os, random, collections
from datasets import load_dataset

import task_gates
from select_tasks import V2_NAME, quality_ok, ftp_ok, slim_v2

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
SEED = 20260715
N = 200
V2_REVISION = "475dd5e8703bb5fb22dd3c60b5d038b019eba1e0"  # == dev MANIFEST.json revision

# Fixed pre-registered quotas (HELDOUT_PREREGISTRATION.md). Sum == 200.
ALLOCATION = {
    "ts": 30, "python": 30, "js": 26, "java": 20, "go": 18, "rust": 18,
    "csharp": 12, "cpp": 10, "c": 8, "php": 8, "kotlin": 6, "swift": 4,
    "scala": 2, "dart": 2, "elixir": 2, "julia": 2, "r": 1, "clojure": 1,
    "lua": 0, "ocaml": 0,
}
assert sum(ALLOCATION.values()) == N

# Ranked reserve for env-preflight replacements: ceil(primary/2) per language.
# Reserves are the NEXT ranks of the same seeded shuffle, so freezing them
# leaves the primary 200 byte-identical. Sum == 101.
RESERVE = {L: -(-q // 2) for L, q in ALLOCATION.items()}


def load_exclusions():
    dev_ids, dev_repos, decontam_ids = set(), set(), set()
    with open(os.path.join(OUT_DIR, "tasks_multilingual.jsonl")) as f:
        for line in f:
            r = json.loads(line)
            dev_ids.add(r["instance_id"]); dev_repos.add(r["repo"])
    with open(os.path.join(OUT_DIR, "tasks_decontam.jsonl")) as f:
        for line in f:
            decontam_ids.add(json.loads(line)["instance_id"])
    return dev_ids, dev_repos, decontam_ids


def build_pool(dev_ids, dev_repos, decontam_ids):
    pool = collections.defaultdict(list)
    drops = collections.Counter()
    rejected = []
    kept = 0
    for r in load_dataset(V2_NAME, split="train", revision=V2_REVISION):
        if not quality_ok(r):
            drops["quality_not_A"] += 1; continue
        if not ftp_ok(r):
            drops["no_FAIL_TO_PASS"] += 1; continue
        if r["instance_id"] in dev_ids:
            drops["dev_instance_id"] += 1; continue
        if r["repo"] in dev_repos:
            drops["dev_repo"] += 1; continue
        if r["instance_id"] in decontam_ids:
            drops["decontam_instance_id"] += 1; continue
        # Task-rejection gate (select/task_gates.py): drop suite-red-at-baseline
        # tasks BEFORE the seeded draw, so the set never contains one. Applied to
        # the primary AND the reserve, since a reserve can be promoted into the set.
        slim = slim_v2(r)
        gate_kept, gate_rejected = task_gates.partition([slim], log=print, label="heldout")
        if gate_rejected:
            rejected.extend(gate_rejected)
            for code in gate_rejected[0]["reasons"]:
                drops[f"task_gate_{code}"] += 1
            continue
        pool[r["language"]].append(gate_kept[0]); kept += 1
    return pool, drops, kept, rejected


def resolve_deficits(pool, alloc):
    """Pre-registered fallback: if a language's pool < quota, reassign the
    shortfall one task at a time to the largest-quota language with spare
    pool (ties broken alphabetically)."""
    alloc = dict(alloc)
    reassigned = collections.Counter()
    for L in sorted(alloc):
        short = alloc[L] - len(pool.get(L, []))
        if short <= 0:
            continue
        alloc[L] -= short
        for _ in range(short):
            candidates = [M for M in alloc if len(pool.get(M, [])) > alloc[M]]
            if not candidates:
                raise SystemExit("pool exhausted: cannot place reassigned quota")
            M = min(candidates, key=lambda M: (-alloc[M], M))
            alloc[M] += 1
            reassigned[f"{L}->{M}"] += 1
    return alloc, dict(reassigned)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--freeze", action="store_true")
    a = ap.parse_args()

    dev_ids, dev_repos, decontam_ids = load_exclusions()
    pool, drops, kept, rejected = build_pool(dev_ids, dev_repos, decontam_ids)
    alloc, reassigned = resolve_deficits(pool, ALLOCATION)
    # Reserve deficits resolved against what's left after the primary draw.
    leftover_pool = {L: pool[L][alloc.get(L, 0):] for L in pool}
    res_alloc, res_reassigned = resolve_deficits(leftover_pool, RESERVE)

    rng = random.Random(SEED)
    chosen, reserve = [], []
    for L in sorted(pool):
        items = sorted(pool[L], key=lambda x: x["instance_id"])
        rng.shuffle(items)
        n_p, n_r = alloc.get(L, 0), res_alloc.get(L, 0)
        chosen.extend(items[:n_p])
        for rank, x in enumerate(items[n_p : n_p + n_r], start=1):
            reserve.append({**x, "reserve_rank": rank})

    # Hard contamination assertions — refuse to emit an overlapping set.
    chosen_ids = {x["instance_id"] for x in chosen}
    chosen_repos = {x["repo"] for x in chosen}
    reserve_ids = {x["instance_id"] for x in reserve}
    assert len(chosen) == N, f"selected {len(chosen)} != {N}"
    assert len(reserve) == sum(RESERVE.values()), "reserve count mismatch"
    for ids, repos in ((chosen_ids, chosen_repos),
                       (reserve_ids, {x["repo"] for x in reserve})):
        assert not (ids & dev_ids), "instance_id overlap with dev-200"
        assert not (repos & dev_repos), "repo overlap with dev-200"
        assert not (ids & decontam_ids), "instance_id overlap with decontam"
    assert not (chosen_ids & reserve_ids), "primary/reserve overlap"

    # The primary 200 must stay byte-identical to the already-frozen set — UNLESS
    # that frozen set predates the task-rejection gate, in which case a difference
    # is the gate doing its job and the set must be REBUILT, not re-verified.
    frozen_path = os.path.join(OUT_DIR, "tasks_heldout.jsonl")
    if os.path.exists(frozen_path):
        frozen_rows = [json.loads(l) for l in open(frozen_path)]
        frozen = [r["instance_id"] for r in frozen_rows]
        if frozen != [x["instance_id"] for x in chosen]:
            _, stale = task_gates.partition(frozen_rows)
            if stale:
                raise SystemExit(
                    f"regenerated primary differs from frozen tasks_heldout.jsonl, and the frozen "
                    f"set contains {len(stale)} task(s) the rejection gate now rejects "
                    f"(e.g. {', '.join(s['instance_id'] for s in stale[:3])}). The frozen set "
                    f"PREDATES the gate — build a new set (new seed), do not re-verify this one.")
            raise SystemExit("regenerated primary differs from frozen tasks_heldout.jsonl")

    manifest = {
        "set": "heldout", "seed": SEED, "N": N,
        "preregistration": "HELDOUT_PREREGISTRATION.md",
        "v2": {"name": V2_NAME, "revision": V2_REVISION,
               "kept_after_filters_and_exclusions": kept, "drops": dict(drops),
               "pool_by_language": {L: len(pool[L]) for L in sorted(pool)}},
        "exclusions": {"dev_instance_ids": len(dev_ids), "dev_repos": len(dev_repos),
                       "decontam_instance_ids": len(decontam_ids)},
        "allocation_preregistered": ALLOCATION,
        "allocation_effective": alloc,
        "deficit_reassignments": reassigned,
        "selected_by_language": dict(collections.Counter(x["language"] for x in chosen)),
        "reserve": {
            "N": len(reserve),
            "allocation_preregistered": RESERVE,
            "allocation_effective": res_alloc,
            "deficit_reassignments": res_reassigned,
            "by_language": dict(collections.Counter(x["language"] for x in reserve)),
            "replacement_rule": (
                "A primary task that fails environment preflight (golden-FULL build "
                "or env-ledger gate) for tool-independent reasons is replaced by the "
                "lowest-rank unused reserve of the same language; if exhausted, by "
                "the reserve of the largest-primary-quota language with reserves "
                "left (ties alphabetical). Replacement happens strictly before any "
                "arm rollout on that task; never after outcomes exist."
            ),
        },
        "overlap_with_dev": {"instance_ids": 0, "repos": 0},
        "task_gate": {"thresholds": {"max_fail_to_pass": task_gates.MAX_FAIL_TO_PASS,
                                     "min_pass_to_pass": task_gates.MIN_PASS_TO_PASS},
                      "n_rejected": len(rejected),
                      "applies_to": "primary + reserve (a reserve can be promoted into the set)",
                      "sidecar": os.path.basename(task_gates.rejection_sidecar_path(OUT_DIR, "heldout"))},
        "criteria": "quality code=='A'; non-empty FAIL_TO_PASS; V2 revision pinned; "
                    "dev-200 instance_ids+repos and decontam instance_ids excluded; "
                    "task-rejection gate (FAIL_TO_PASS<100 and PASS_TO_PASS>0, see "
                    "task-gates.json); fixed Octoverse-2025-anchored quotas; seeded sample. "
                    "Orthogonal to sweet-vs-native outcome.",
    }
    print(json.dumps(manifest, indent=2, default=str))

    if a.freeze:
        with open(os.path.join(OUT_DIR, "tasks_heldout.jsonl"), "w") as f:
            for x in chosen: f.write(json.dumps(x) + "\n")
        with open(os.path.join(OUT_DIR, "tasks_heldout_reserve.jsonl"), "w") as f:
            for x in reserve: f.write(json.dumps(x) + "\n")
        with open(os.path.join(OUT_DIR, "MANIFEST_heldout.json"), "w") as f:
            json.dump(manifest, f, indent=2, default=str)
        side = task_gates.write_rejections(OUT_DIR, "heldout", rejected,
                                           {"seed": SEED, "v2_revision": V2_REVISION})
        print(f"\nFROZEN -> {OUT_DIR}/tasks_heldout.jsonl ({len(chosen)}), "
              f"tasks_heldout_reserve.jsonl ({len(reserve)}), MANIFEST_heldout.json, "
              f"{os.path.basename(side)} ({len(rejected)} gate rejections)")
    elif not a.dry_run:
        print("\n(no --freeze and no --dry-run: nothing written)")


if __name__ == "__main__":
    main()
