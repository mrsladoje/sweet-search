#!/usr/bin/env python3
"""
Build the exclusion snapshot for held-out 2 (HELDOUT2_RULES.md §3).

Two tiers, because the two kinds of contact are not equally contaminating:

  TIER A — instance level, applied to EVERY id we have ever drawn or run.
    Non-negotiable: those tasks' gold patches, failure modes and per-task
    narratives are written into PLAN.md and the forensics documents.

  TIER B — repo level, applied only to repos we have genuine TASK-LEVEL
    knowledge of:
      * dev-200 repos — every lever, prompt variant and per-task override was
        tuned with these in view;
      * repos of the tasks read call-by-call during forensics (extracted from
        PLAN.md + the FORENSICS-*.md documents);
      * repos of the tasks with a hand-written entry in harness/task-overrides.json,
        which required inspecting that task's suite.
    Everything else we have merely run in aggregate or golden-indexed stays at
    tier A only: a DIFFERENT pull request in such a repo leaks nothing, and the
    golden index and any environment repair are identical for both arms, so they
    move attrition rather than the comparison.

Nothing here looks at an outcome, a diff or a sweet-vs-native result — only at
identity.

Inputs (all committed):
  tasks_multilingual.jsonl · tasks_heldout.jsonl · tasks_heldout.jsonl.prereplace-*
  HELDOUT_REPLACEMENTS_2026-07-21.json · tasks_heldout_reserve.jsonl
  tasks_decontam.jsonl · ../PLAN.md · ../FORENSICS-*.md · ../harness/task-overrides.json
  exclusion-sources/{mac-vault-golden-keys,box-golden-keys,run-history-instance-ids}.txt

Output: HELDOUT2_EXCLUDED_REPOS.json — frozen and committed BEFORE the seed is
used. Regenerating it after the freeze would change the draw.

  python3 heldout2_exclusions.py            # write the snapshot
  python3 heldout2_exclusions.py --print    # summary only
"""
from __future__ import annotations

import glob
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BENCH = os.path.dirname(HERE)
SRC = os.path.join(HERE, "exclusion-sources")
OUT_PATH = os.path.join(HERE, "HELDOUT2_EXCLUDED_REPOS.json")

INSTANCE_ID_RE = re.compile(r"[A-Za-z0-9_.-]+__[A-Za-z0-9_.-]+-[0-9]+")


def _jsonl(name):
    with open(os.path.join(HERE, name)) as f:
        return [json.loads(line) for line in f if line.strip()]


def _lines(fname):
    with open(os.path.join(SRC, fname)) as f:
        return [l.strip() for l in f if l.strip()]


def repo_from_cache_key(key: str) -> str | None:
    """golden cache key = repo with the single '/' replaced by '__', then '@commit'."""
    key = key.strip()
    if not key or "@" not in key:
        return None
    owner_name = key.split("@", 1)[0]
    if "__" not in owner_name:
        return None
    owner, name = owner_name.split("__", 1)
    return f"{owner}/{name}"


def repo_from_instance_id(iid: str) -> str | None:
    """instance_id = <owner>__<name>-<pr number>."""
    iid = iid.strip()
    if not iid or "__" not in iid:
        return None
    stem = iid.rsplit("-", 1)[0] if iid.rsplit("-", 1)[-1].isdigit() else iid
    owner, name = stem.split("__", 1)
    return f"{owner}/{name}"


def _repos(ids):
    return {r for r in map(repo_from_instance_id, ids) if r}


def build():
    tier_a: dict[str, set] = {}   # instance ids
    tier_b: dict[str, set] = {}   # repos

    # ---- tier A: every id ever drawn or run -------------------------------
    dev = _jsonl("tasks_multilingual.jsonl")
    h1 = _jsonl("tasks_heldout.jsonl")
    h1pre = _jsonl("tasks_heldout.jsonl.prereplace-2026-07-21")
    res = _jsonl("tasks_heldout_reserve.jsonl")
    dec = _jsonl("tasks_decontam.jsonl")

    repl = json.load(open(os.path.join(HERE, "HELDOUT_REPLACEMENTS_2026-07-21.json")))
    repl_ids = set()
    for p in repl.get("promotions", []):
        repl_ids.update(x for x in (p.get("dead_id"), p.get("reserve_id")) if x)
    repl_ids.update(s.split(" ", 1)[0] for s in repl.get("reserve_failures_refilled", []))

    tier_a["dev200"] = {r["instance_id"] for r in dev}
    tier_a["heldout1"] = ({r["instance_id"] for r in h1} | {r["instance_id"] for r in h1pre}
                          | repl_ids)
    tier_a["heldout1_reserve"] = {r["instance_id"] for r in res}
    tier_a["decontam"] = {r["instance_id"] for r in dec}
    tier_a["run_and_smoke_history"] = set(_lines("run-history-instance-ids.txt"))
    # golden inventories are keyed by repo@commit, not by task; they contribute
    # repos only (below), and their ids are already covered by the sets above.

    # ---- tier B: repos we have task-level knowledge of --------------------
    tier_b["dev200_repos"] = {r["repo"] for r in dev}

    read_ids = set()
    for path in [os.path.join(BENCH, "PLAN.md")] + sorted(glob.glob(os.path.join(BENCH, "FORENSICS-*.md"))):
        with open(path) as f:
            read_ids |= set(INSTANCE_ID_RE.findall(f.read()))
    tier_b["forensics_read_repos"] = _repos(read_ids)

    ov = json.load(open(os.path.join(BENCH, "harness", "task-overrides.json")))["tasks"]
    tier_b["hand_written_override_repos"] = _repos(ov.keys())

    # Recorded for provenance/audit, NOT excluded at repo level (tier A only):
    audit_only = {
        "mac_vault_golden_repos": {r for r in map(repo_from_cache_key,
                                                  _lines("mac-vault-golden-keys.txt")) if r},
        "box_staged_golden_repos": {r for r in map(repo_from_cache_key,
                                                   _lines("box-golden-keys.txt")) if r},
        "heldout1_repos": ({r["repo"] for r in h1} | {r["repo"] for r in h1pre}
                           | _repos(repl_ids)),
        "heldout1_reserve_repos": {r["repo"] for r in res},
        "decontam_repos": {r["repo"] for r in dec},
        "run_and_smoke_history_repos": _repos(tier_a["run_and_smoke_history"]),
    }

    all_ids = set().union(*tier_a.values())
    all_repos = set().union(*tier_b.values())
    downgraded = set().union(*audit_only.values()) - all_repos

    marginal, seen = {}, set()
    for k in ["dev200_repos", "forensics_read_repos", "hand_written_override_repos"]:
        marginal[k] = len(tier_b[k] - seen)
        seen |= tier_b[k]

    return {
        "_doc": ("Frozen exclusion snapshot for held-out 2 (HELDOUT2_RULES.md §3). "
                 "TIER A = instance ids, excluded unconditionally. TIER B = repos we have "
                 "task-level knowledge of, excluded whole. Repos we only ran in aggregate or "
                 "golden-indexed are tier A only. Committed BEFORE the seeded draw; "
                 "regenerating it later would change the draw."),
        "tier_a_instance_ids": {"counts": {k: len(v) for k, v in tier_a.items()},
                                "n_total": len(all_ids)},
        "tier_b_repos": {"counts": {k: len(v) for k, v in tier_b.items()},
                         "marginal_new_repos_in_listed_order": marginal,
                         "n_total": len(all_repos)},
        "audit_only_repos_NOT_excluded_at_repo_level": {
            "counts": {k: len(v) for k, v in audit_only.items()},
            "n_downgraded_to_instance_level": len(downgraded)},
        "excluded_repos": sorted(all_repos),
        "excluded_instance_ids": sorted(all_ids),
        "repos_downgraded_to_instance_level": sorted(downgraded),
    }


def main():
    snap = build()
    if "--print" not in sys.argv:
        with open(OUT_PATH, "w") as f:
            json.dump(snap, f, indent=2)
        print(f"wrote {OUT_PATH}")
    print(json.dumps({k: snap[k] for k in
                      ("tier_a_instance_ids", "tier_b_repos",
                       "audit_only_repos_NOT_excluded_at_repo_level")}, indent=2))


if __name__ == "__main__":
    main()
