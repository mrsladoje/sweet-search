#!/usr/bin/env python3
"""
Pre-registered, DETERMINISTIC selection for HELD-OUT 2 of the sweet-search
task-completion benchmark. See HELDOUT2_RULES.md — this script is the mechanical
implementation of that document and nothing else. It never looks at sweet-vs-native
outcomes, and it never reads a task diff, patch or problem statement.

Differences from select_heldout.py (held-out 1):
  - fresh seed 20260731
  - two-tier exclusion snapshot HELDOUT2_EXCLUDED_REPOS.json (instance ids for
    everything ever drawn or run; whole repos for the ones we have task-level
    knowledge of)
  - one task per repo across primary AND reserve
  - reserve = ceil(0.3 x quota) instead of ceil(quota / 2)
  - PROPORTIONAL deficit reassignment (§2 amendment) instead of held-out 1's
    "largest current quota wins", which snowballed every freed slot onto one language
Everything else — population, pinned revision, base filters, quotas, shuffle scheme,
rejection gate — is held-out 1's recipe, unchanged.

Usage:
  python3 select_heldout2.py --dry-run   # print manifest, write nothing
  python3 select_heldout2.py --freeze    # write tasks_heldout2.jsonl + manifest + sidecar
"""
import argparse, json, os, random, collections, hashlib
from datasets import load_dataset

import task_gates
from select_tasks import V2_NAME, quality_ok, ftp_ok, slim_v2

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
SEED = 20260731  # 20260730 is retired with the discarded draw (see FAIRNESS.md §7)
N = 200
V2_REVISION = "475dd5e8703bb5fb22dd3c60b5d038b019eba1e0"  # == dev + held-out-1 revision
EXCLUSIONS_PATH = os.path.join(OUT_DIR, "HELDOUT2_EXCLUDED_REPOS.json")

# Octoverse-2025-anchored quotas, reused VERBATIM from held-out 1's pre-registration.
ALLOCATION = {
    "ts": 30, "python": 30, "js": 26, "java": 20, "go": 18, "rust": 18,
    "csharp": 12, "cpp": 10, "c": 8, "php": 8, "kotlin": 6, "swift": 4,
    "scala": 2, "dart": 2, "elixir": 2, "julia": 2, "r": 1, "clojure": 1,
    "lua": 0, "ocaml": 0,
}
assert sum(ALLOCATION.values()) == N

# Reserve for mechanical replacements: 30% of the primary quota, min 1 where non-zero.
# Held-out 1 reserved 50% (101) and consumed 40; 67 is ~2x the observed need.
RESERVE = {L: max(1, -(-(q * 3) // 10)) if q else 0 for L, q in ALLOCATION.items()}


def load_exclusions():
    snap = json.load(open(EXCLUSIONS_PATH))
    return set(snap["excluded_repos"]), set(snap["excluded_instance_ids"]), snap


def build_pool(excl_repos, excl_ids):
    """Base filters -> exclusions -> rejection gate. Returns per-language candidate
    lists (NOT yet deduplicated by repo) plus the drop/rejection bookkeeping."""
    pool = collections.defaultdict(list)
    drops = collections.Counter()
    rejected = []
    kept = 0
    for r in load_dataset(V2_NAME, split="train", revision=V2_REVISION):
        if not quality_ok(r):
            drops["quality_not_A"] += 1; continue
        if not ftp_ok(r):
            drops["no_FAIL_TO_PASS"] += 1; continue
        if r["repo"] in excl_repos:
            drops["excluded_repo"] += 1; continue
        if r["instance_id"] in excl_ids:
            drops["excluded_instance_id"] += 1; continue
        slim = slim_v2(r)
        gate_kept, gate_rejected = task_gates.partition([slim], label="heldout2")
        if gate_rejected:
            rejected.extend(gate_rejected)
            for code in gate_rejected[0]["reasons"]:
                drops[f"task_gate_{code}"] += 1
            continue
        pool[r["language"]].append(gate_kept[0]); kept += 1
    return pool, drops, kept, rejected


def dedupe_one_per_repo(pool, rng):
    """HELDOUT2_RULES.md §5 — at most one task per repo anywhere in the set. Within a
    language, tasks are grouped by repo (repos in sorted order), each group is shuffled
    with the run seed and its first task kept. A seeded pick, not 'lowest instance id',
    which would systematically favour older pull requests."""
    out, dropped = {}, 0
    for L in sorted(pool):
        by_repo = collections.defaultdict(list)
        for t in sorted(pool[L], key=lambda x: x["instance_id"]):
            by_repo[t["repo"]].append(t)
        picks = []
        for repo in sorted(by_repo):
            group = by_repo[repo]
            rng.shuffle(group)
            picks.append(group[0])
            dropped += len(group) - 1
        out[L] = picks
    return out, dropped


def resolve_deficits(pool, alloc):
    """PROPORTIONAL deficit reassignment — HELDOUT2_RULES.md §2, amended 2026-07-30.

    Held-out 1's rule moved the shortfall one slot at a time to "the largest-quota
    language with spare pool", evaluated against the RUNNING quota — so the language
    that just received a slot was the largest again, and the whole shortfall snowballed
    onto one language (observed: all 26 freed slots onto python). This version keeps
    the shape of the external Octoverse anchor instead:

      1. every language short of pool has its quota cut to its pool size;
      2. the total shortfall is distributed over the languages that still have spare
         pool, in proportion to their PRE-REGISTERED quota, by largest remainder;
      3. a language never receives more than its spare pool; slots left unplaced by
         that cap go round again over the languages that still have room.

    Deterministic throughout: remainder ties break by larger pre-registered quota, then
    alphabetically.
    """
    prereg = dict(alloc)
    alloc = dict(alloc)
    reassigned = collections.Counter()

    donors = []
    for L in sorted(alloc):
        short = alloc[L] - len(pool.get(L, []))
        if short > 0:
            alloc[L] -= short
            donors.append((L, short))
    shortfall = sum(s for _, s in donors)
    if not shortfall:
        return alloc, {}

    placed = collections.Counter()
    remaining = shortfall
    while remaining > 0:
        room = {L: len(pool.get(L, [])) - alloc[L] for L in alloc}
        eligible = [L for L in sorted(alloc) if room[L] > 0 and prereg[L] > 0]
        if not eligible:
            raise SystemExit("pool exhausted: cannot place reassigned quota")
        weight = sum(prereg[L] for L in eligible)
        exact = {L: remaining * prereg[L] / weight for L in eligible}
        take = {L: min(room[L], int(exact[L])) for L in eligible}
        left = remaining - sum(take.values())
        # largest remainder for the leftover slots
        order = sorted(eligible, key=lambda L: (-(exact[L] - int(exact[L])), -prereg[L], L))
        for L in order:
            if left <= 0:
                break
            if take[L] < room[L]:
                take[L] += 1
                left -= 1
        if not any(take.values()):
            raise SystemExit("pool exhausted: cannot place reassigned quota")
        for L, n in take.items():
            alloc[L] += n
            placed[L] += n
        remaining = left

    # Audit trail: who gave up how much, who absorbed how much. Not pairwise —
    # the shortfall is pooled before redistribution, so a pairwise arrow would be
    # an invention.
    return alloc, {"shortfall": shortfall,
                   "given_up_by": {L: s for L, s in donors},
                   "absorbed_by": {L: n for L, n in sorted(placed.items()) if n}}


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--freeze", action="store_true")
    a = ap.parse_args()

    excl_repos, excl_ids, excl_snap = load_exclusions()
    raw_pool, drops, kept, rejected = build_pool(excl_repos, excl_ids)

    # ONE RNG, consumed in a fixed order: repo-dedup pass over all languages first
    # (languages sorted, repos sorted), then the per-language selection shuffle.
    rng = random.Random(SEED)
    pool, dropped_same_repo = dedupe_one_per_repo(raw_pool, rng)

    alloc, reassigned = resolve_deficits(pool, ALLOCATION)
    leftover_pool = {L: pool[L][alloc.get(L, 0):] for L in pool}
    res_alloc, res_reassigned = resolve_deficits(leftover_pool, RESERVE)

    chosen, reserve = [], []
    for L in sorted(pool):
        items = sorted(pool[L], key=lambda x: x["instance_id"])
        rng.shuffle(items)
        n_p, n_r = alloc.get(L, 0), res_alloc.get(L, 0)
        chosen.extend(items[:n_p])
        for rank, x in enumerate(items[n_p: n_p + n_r], start=1):
            reserve.append({**x, "reserve_rank": rank})

    # Hard assertions — refuse to emit a set that violates any pre-registered rule.
    chosen_ids = {x["instance_id"] for x in chosen}
    chosen_repos = {x["repo"] for x in chosen}
    reserve_ids = {x["instance_id"] for x in reserve}
    reserve_repos = {x["repo"] for x in reserve}
    assert len(chosen) == N, f"selected {len(chosen)} != {N}"
    assert len(reserve) == sum(RESERVE.values()), \
        f"reserve {len(reserve)} != {sum(RESERVE.values())}"
    assert not (chosen_ids & excl_ids) and not (chosen_repos & excl_repos), \
        "primary overlaps the exclusion snapshot"
    assert not (reserve_ids & excl_ids) and not (reserve_repos & excl_repos), \
        "reserve overlaps the exclusion snapshot"
    assert not (chosen_ids & reserve_ids), "primary/reserve instance_id overlap"
    assert not (chosen_repos & reserve_repos), "primary/reserve REPO overlap (rules §5)"
    assert len(chosen_repos) == len(chosen), "duplicate repo inside the primary (rules §5)"
    assert len(reserve_repos) == len(reserve), "duplicate repo inside the reserve (rules §5)"
    assert not task_gates.partition(chosen)[1], "a gate-violating task reached the primary"
    assert not task_gates.partition(reserve)[1], "a gate-violating task reached the reserve"

    manifest = {
        "set": "heldout2", "seed": SEED, "N": N,
        "rules": "HELDOUT2_RULES.md", "fairness": "FAIRNESS.md",
        "supersedes": "tasks_heldout.jsonl (held-out 1, seed 20260715, RETIRED evidence)",
        "v2": {"name": V2_NAME, "revision": V2_REVISION,
               "kept_after_filters_exclusions_and_gate": kept, "drops": dict(drops),
               "pool_by_language_before_repo_dedup": {L: len(raw_pool[L]) for L in sorted(raw_pool)},
               "pool_by_language": {L: len(pool[L]) for L in sorted(pool)}},
        "exclusions": {"snapshot": os.path.basename(EXCLUSIONS_PATH),
                       "rule": "HELDOUT2_RULES.md §3 (two tiers)",
                       "tier_a_instance_ids": excl_snap["tier_a_instance_ids"],
                       "tier_b_repos": excl_snap["tier_b_repos"],
                       "audit_only_repos_NOT_excluded_at_repo_level":
                           excl_snap["audit_only_repos_NOT_excluded_at_repo_level"]},
        "one_task_per_repo": {"rule": "HELDOUT2_RULES.md §5",
                              "dropped_same_repo_candidates": dropped_same_repo},
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
                "Mechanical, arm-neutral reasons only (HELDOUT2_RULES.md §7): golden will "
                "not build; suite will not reach gold-FULL under the exact run config after "
                "reasonable env repair; repo/commit vanished upstream. Replaced by the "
                "lowest-rank unused reserve of the same language; if exhausted, by the "
                "reserve of the largest-primary-quota language with reserves left (ties "
                "alphabetical). Strictly before any arm rollout on that task; never after "
                "outcomes exist. Logged in HELDOUT2_REPLACEMENTS.json."
            ),
        },
        "task_gate": {"thresholds": {"max_fail_to_pass": task_gates.MAX_FAIL_TO_PASS,
                                     "min_pass_to_pass": task_gates.MIN_PASS_TO_PASS},
                      "n_rejected": len(rejected),
                      "by_reason": {
                          task_gates.REASON_F2P_TOO_MANY: sum(
                              1 for r in rejected if task_gates.REASON_F2P_TOO_MANY in r["reasons"]),
                          task_gates.REASON_P2P_EMPTY: sum(
                              1 for r in rejected if task_gates.REASON_P2P_EMPTY in r["reasons"]),
                          "both": sum(1 for r in rejected if len(r["reasons"]) == 2)},
                      "applies_to": "primary + reserve, before the seeded draw",
                      "sidecar": os.path.basename(task_gates.rejection_sidecar_path(OUT_DIR, "heldout2"))},
        "criteria": "quality code=='A'; non-empty FAIL_TO_PASS; V2 revision pinned; two-tier "
                    "exclusion (instance ids for everything ever drawn or run, whole repos "
                    "where we have task-level knowledge); task-rejection gate "
                    "(FAIL_TO_PASS<100 and PASS_TO_PASS>0); one task per repo; fixed "
                    "Octoverse-2025-anchored quotas with proportional deficit redistribution; "
                    "seeded sample. Orthogonal to sweet-vs-native outcome; no task content "
                    "inspected.",
    }
    print(json.dumps(manifest, indent=2, default=str))

    if a.freeze:
        primary_path = os.path.join(OUT_DIR, "tasks_heldout2.jsonl")
        reserve_path = os.path.join(OUT_DIR, "tasks_heldout2_reserve.jsonl")
        with open(primary_path, "w") as f:
            for x in chosen: f.write(json.dumps(x) + "\n")
        with open(reserve_path, "w") as f:
            for x in reserve: f.write(json.dumps(x) + "\n")
        manifest["sha256"] = {"tasks_heldout2.jsonl": sha256_file(primary_path),
                              "tasks_heldout2_reserve.jsonl": sha256_file(reserve_path)}
        with open(os.path.join(OUT_DIR, "MANIFEST_heldout2.json"), "w") as f:
            json.dump(manifest, f, indent=2, default=str)
        side = task_gates.write_rejections(OUT_DIR, "heldout2", rejected,
                                           {"seed": SEED, "v2_revision": V2_REVISION})
        print(f"\nFROZEN -> tasks_heldout2.jsonl ({len(chosen)}), "
              f"tasks_heldout2_reserve.jsonl ({len(reserve)}), MANIFEST_heldout2.json, "
              f"{os.path.basename(side)} ({len(rejected)} gate rejections)")
        print(f"  sha256 primary  = {manifest['sha256']['tasks_heldout2.jsonl']}")
        print(f"  sha256 reserve  = {manifest['sha256']['tasks_heldout2_reserve.jsonl']}")
    elif not a.dry_run:
        print("\n(no --freeze and no --dry-run: nothing written)")


if __name__ == "__main__":
    main()
