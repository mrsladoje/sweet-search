#!/usr/bin/env python3
"""
Build the REPO-LEVEL exclusion set for held-out 2 (HELDOUT2_RULES.md §3).

Every source here is arm-neutral: it names repos we have already touched with
either arm, in any capacity (rolled out, smoked, golden-built, or drawn into an
earlier population). Nothing in this file looks at an outcome, a diff, or a
sweet-vs-native result — only at identity.

Inputs:
  tasks_multilingual.jsonl                       dev-200 (iterated against)
  tasks_heldout.jsonl                            held-out 1, final (RETIRED evidence)
  tasks_heldout.jsonl.prereplace-2026-07-21      held-out 1, pre-replacement
  HELDOUT_REPLACEMENTS_2026-07-21.json           held-out 1 promotions (both sides)
  tasks_heldout_reserve.jsonl                    the old reserve-101 population
  tasks_decontam.jsonl                           the recency robustness population
  exclusion-sources/mac-vault-golden-keys.txt    Mac golden vault inventory
  exclusion-sources/box-golden-keys.txt          eval box staged goldens
  exclusion-sources/run-history-instance-ids.txt every instance_id appearing in any
                                                 rows.json / preds / env-ledger on the
                                                 box or the Mac (runs + smokes)

Output: HELDOUT2_EXCLUDED_REPOS.json — the frozen, committed exclusion snapshot
consumed by select_heldout2.py. Regenerating it after the freeze would change the
draw, so it is committed BEFORE the seed is used.

  python3 heldout2_exclusions.py            # write the snapshot
  python3 heldout2_exclusions.py --print    # summary only
"""
from __future__ import annotations

import json
import os
import sys
import collections

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "exclusion-sources")
OUT_PATH = os.path.join(HERE, "HELDOUT2_EXCLUDED_REPOS.json")


def _jsonl(name):
    path = os.path.join(HERE, name)
    with open(path) as f:
        return [json.loads(line) for line in f if line.strip()]


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


def _lines(fname):
    path = os.path.join(SRC, fname)
    with open(path) as f:
        return [l.strip() for l in f if l.strip()]


def build():
    sources: dict[str, set] = {}
    ids: dict[str, set] = {}

    # 1. dev-200 — every lever, override and prompt variant was tuned with these in view
    dev = _jsonl("tasks_multilingual.jsonl")
    sources["dev200_repos"] = {r["repo"] for r in dev}
    ids["dev200_instance_ids"] = {r["instance_id"] for r in dev}

    # 2. held-out 1 — frozen evidence; final AND pre-replacement rosters
    h1 = _jsonl("tasks_heldout.jsonl")
    h1pre = _jsonl("tasks_heldout.jsonl.prereplace-2026-07-21")
    repl = json.load(open(os.path.join(HERE, "HELDOUT_REPLACEMENTS_2026-07-21.json")))
    repl_ids = set()
    for p in repl.get("promotions", []):
        repl_ids.update(x for x in (p.get("dead_id"), p.get("reserve_id")) if x)
    repl_ids.update(s.split(" ", 1)[0] for s in repl.get("reserve_failures_refilled", []))
    sources["heldout1_repos"] = ({r["repo"] for r in h1} | {r["repo"] for r in h1pre}
                                 | {r for r in map(repo_from_instance_id, repl_ids) if r})
    ids["heldout1_instance_ids"] = ({r["instance_id"] for r in h1}
                                    | {r["instance_id"] for r in h1pre} | repl_ids)

    # 3. the old reserve-101 population (promotable into held-out 1, so equally touched)
    res = _jsonl("tasks_heldout_reserve.jsonl")
    sources["heldout1_reserve_repos"] = {r["repo"] for r in res}
    ids["heldout1_reserve_instance_ids"] = {r["instance_id"] for r in res}

    # 4. decontam population (never run, but it is an existing draw — excluded for
    #    independence; costs pool size only)
    dec = _jsonl("tasks_decontam.jsonl")
    sources["decontam_repos"] = {r["repo"] for r in dec}
    ids["decontam_instance_ids"] = {r["instance_id"] for r in dec}

    # 5. golden-cache history — anything ever indexed for the bench
    sources["mac_vault_golden_repos"] = {r for r in map(repo_from_cache_key,
                                                        _lines("mac-vault-golden-keys.txt")) if r}
    sources["box_golden_repos"] = {r for r in map(repo_from_cache_key,
                                                   _lines("box-golden-keys.txt")) if r}

    # 6. run/smoke history — every instance_id that ever appeared in a result artifact
    run_ids = set(_lines("run-history-instance-ids.txt"))
    sources["run_history_repos"] = {r for r in map(repo_from_instance_id, run_ids) if r}
    ids["run_history_instance_ids"] = run_ids

    all_repos = set().union(*sources.values())
    all_ids = set().union(*ids.values())

    # marginal contribution, in the order listed (what each source adds on its own)
    marginal, seen = {}, set()
    for k in ["dev200_repos", "heldout1_repos", "heldout1_reserve_repos", "decontam_repos",
              "mac_vault_golden_repos", "box_golden_repos", "run_history_repos"]:
        marginal[k] = len(sources[k] - seen)
        seen |= sources[k]

    return {
        "_doc": ("Frozen repo-level exclusion snapshot for held-out 2. Built by "
                 "heldout2_exclusions.py from the sources listed in HELDOUT2_RULES.md §3. "
                 "Committed BEFORE the seeded draw; regenerating it later would change the "
                 "draw and is not permitted for this set."),
        "counts": {k: len(v) for k, v in sources.items()},
        "marginal_new_repos_in_listed_order": marginal,
        "n_excluded_repos": len(all_repos),
        "n_excluded_instance_ids": len(all_ids),
        "excluded_repos": sorted(all_repos),
        "excluded_instance_ids": sorted(all_ids),
    }


def main():
    snap = build()
    if "--print" not in sys.argv:
        with open(OUT_PATH, "w") as f:
            json.dump(snap, f, indent=2)
        print(f"wrote {OUT_PATH}")
    print(json.dumps({k: snap[k] for k in
                      ("counts", "marginal_new_repos_in_listed_order",
                       "n_excluded_repos", "n_excluded_instance_ids")}, indent=2))


if __name__ == "__main__":
    main()
