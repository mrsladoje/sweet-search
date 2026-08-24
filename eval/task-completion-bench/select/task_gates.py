#!/usr/bin/env python3
"""
Selection-time task-rejection gate (PLAN.md gate 3', "task preflight gates").

Rejects candidate tasks whose METADATA shows the benchmark would be measuring
build-wrangling instead of bug-fixing. Metadata-only: no execution, no run
outcomes, no sweet-vs-native — so it is safe to apply inside a pre-registered,
outcome-blind selection.

Thresholds + their motivating cases live in ONE place: select/task-gates.json.
The JS side (harness/task-gates.mjs) reads the same file.

Relationship to harness/task-overrides.json: none. That map is hand-curated
AFTER-THE-FACT repair (excludeF2P / excludeP2P for a task already in a frozen
set). This is a BEFORE-THE-FACT gate on whether a task enters a set at all.
Both continue to exist.

Self-test: `python3 task_gates.py --self-test` (offline, no dataset access).
"""
from __future__ import annotations

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(HERE, "task-gates.json")

with open(CONFIG_PATH) as _f:
    CONFIG = json.load(_f)

MAX_FAIL_TO_PASS = int(CONFIG["max_fail_to_pass"])
MIN_PASS_TO_PASS = int(CONFIG["min_pass_to_pass"])
REJECT_NAME_LOCKED = bool(CONFIG.get("reject_name_locked", False))

# Machine-stable reason codes; the human string is built by format_reason().
REASON_F2P_TOO_MANY = "fail_to_pass_ge_max"
REASON_P2P_EMPTY = "pass_to_pass_below_min"
REASON_NAME_LOCKED = "name_locked"


def counts(record) -> tuple[int, int]:
    """(n_fail_to_pass, n_pass_to_pass) from either a RAW dataset row (lists) or
    an already-slimmed selection record (n_fail_to_pass / n_pass_to_pass)."""
    if "n_fail_to_pass" in record or "n_pass_to_pass" in record:
        return int(record.get("n_fail_to_pass") or 0), int(record.get("n_pass_to_pass") or 0)
    return len(record.get("FAIL_TO_PASS") or []), len(record.get("PASS_TO_PASS") or [])


def reject_reasons(record) -> list[dict]:
    """[] means the task passes the gate. Each entry carries the counts so a
    rejection is auditable without re-reading the dataset."""
    n_f2p, n_p2p = counts(record)
    out = []
    if n_f2p >= MAX_FAIL_TO_PASS:
        out.append({"code": REASON_F2P_TOO_MANY, "n_fail_to_pass": n_f2p,
                    "n_pass_to_pass": n_p2p, "threshold": MAX_FAIL_TO_PASS})
    if n_p2p < MIN_PASS_TO_PASS:
        out.append({"code": REASON_P2P_EMPTY, "n_fail_to_pass": n_f2p,
                    "n_pass_to_pass": n_p2p, "threshold": MIN_PASS_TO_PASS})
    # Reads the STAMPED boolean, never a base tree. An UNSTAMPED record is
    # not-yet-measured, never clean, so absence of the field is not a rejection here --
    # it is reported by the stamping step instead.
    if REJECT_NAME_LOCKED and record.get("name_locked") is True:
        out.append({"code": REASON_NAME_LOCKED, "n_fail_to_pass": n_f2p,
                    "n_pass_to_pass": n_p2p,
                    "identifiers": list(record.get("name_locked_identifiers") or [])})
    return out


def format_reason(reason: dict) -> str:
    if reason["code"] == REASON_NAME_LOCKED:
        idents = ", ".join(reason.get("identifiers") or []) or "(stamped, identifiers not recorded)"
        return (f"name-locked on {idents} "
                "(the hidden test needs an identifier the reference patch invented, the base "
                "tree never mentions and the issue does not spell out -> measures a naming "
                "lottery, not retrieval)")
    if reason["code"] == REASON_F2P_TOO_MANY:
        return (f"FAIL_TO_PASS={reason['n_fail_to_pass']} >= {reason['threshold']} "
                f"(whole suite red at baseline -> measures build repair, not the bug)")
    return (f"PASS_TO_PASS={reason['n_pass_to_pass']} < {reason['threshold']} "
            f"(nothing passes at baseline -> no regression signal)")


def passes(record) -> bool:
    return not reject_reasons(record)


def partition(records, *, log=None, label=""):
    """Split records into (kept, rejected). Every rejection is LOGGED with the
    instance id, the reason and the counts. `rejected` entries are dicts ready
    to be serialized into the sidecar."""
    kept, rejected = [], []
    for r in records:
        reasons = reject_reasons(r)
        if not reasons:
            kept.append(r)
            continue
        n_f2p, n_p2p = counts(r)
        entry = {
            "instance_id": r.get("instance_id"),
            "repo": r.get("repo"),
            "language": r.get("language"),
            "n_fail_to_pass": n_f2p,
            "n_pass_to_pass": n_p2p,
            "reasons": [x["code"] for x in reasons],
            "detail": [format_reason(x) for x in reasons],
        }
        rejected.append(entry)
        if log is not None:
            log(f"[task-gate]{(' ' + label) if label else ''} REJECT {entry['instance_id']}: "
                + "; ".join(entry["detail"]))
    return kept, rejected


def rejection_sidecar_path(out_dir: str, setname: str) -> str:
    """Sidecar sits NEXT TO the manifest so set-building is auditable."""
    return os.path.join(out_dir, f"REJECTED_{setname}.json")


def write_rejections(out_dir: str, setname: str, rejected, extra: dict | None = None) -> str:
    path = rejection_sidecar_path(out_dir, setname)
    payload = {
        "set": setname,
        "gate": "select/task_gates.py",
        "thresholds": {"max_fail_to_pass": MAX_FAIL_TO_PASS,
                       "min_pass_to_pass": MIN_PASS_TO_PASS,
                       "reject_name_locked": REJECT_NAME_LOCKED},
        "n_rejected": len(rejected),
        "by_reason": {
            REASON_F2P_TOO_MANY: sum(1 for r in rejected if REASON_F2P_TOO_MANY in r["reasons"]),
            REASON_P2P_EMPTY: sum(1 for r in rejected if REASON_P2P_EMPTY in r["reasons"]),
            REASON_NAME_LOCKED: sum(1 for r in rejected if REASON_NAME_LOCKED in r["reasons"]),
        },
        **(extra or {}),
        "rejected": sorted(rejected, key=lambda r: r["instance_id"] or ""),
    }
    with open(path, "w") as f:
        json.dump(payload, f, indent=2, default=str)
    return path


def _self_test() -> int:
    ok = True

    def check(cond, name):
        nonlocal ok
        print(("  PASS " if cond else "  FAIL ") + name)
        if not cond:
            ok = False

    print("task_gates self-test:")
    check(MAX_FAIL_TO_PASS == 100 and MIN_PASS_TO_PASS == 1,
          f"thresholds load from task-gates.json (F2P<{MAX_FAIL_TO_PASS}, P2P>={MIN_PASS_TO_PASS})")
    check(REJECT_NAME_LOCKED is True, "name-lock rejection is enabled in task-gates.json")

    healthy = {"instance_id": "a", "FAIL_TO_PASS": ["t"], "PASS_TO_PASS": ["u"]}
    check(passes(healthy), "an UNSTAMPED record is not rejected -- absent means not-yet-measured")
    check(passes({**healthy, "name_locked": False}), "a stamped-clean record passes")
    locked = {**healthy, "name_locked": True, "name_locked_identifiers": ["isFile"]}
    check(not passes(locked), "a stamped name-locked record is rejected")
    check(reject_reasons(locked)[0]["code"] == REASON_NAME_LOCKED, "it carries the name_locked code")
    check("isFile" in format_reason(reject_reasons(locked)[0]),
          "the rejection names the identifier that locks it")

    # raw-row shape
    check(passes({"instance_id": "a", "FAIL_TO_PASS": ["t"], "PASS_TO_PASS": ["u"]}),
          "healthy raw row passes")
    # slim shape
    check(passes({"instance_id": "a", "n_fail_to_pass": 3, "n_pass_to_pass": 40}),
          "healthy slim row passes")
    # both shapes agree
    raw = {"instance_id": "x", "FAIL_TO_PASS": ["t"] * 293, "PASS_TO_PASS": ["u"] * 2171}
    slim = {"instance_id": "x", "n_fail_to_pass": 293, "n_pass_to_pass": 2171}
    check([r["code"] for r in reject_reasons(raw)] == [r["code"] for r in reject_reasons(slim)],
          "raw and slim shapes give the identical verdict (firefly-716)")

    # the motivating cases
    check([r["code"] for r in reject_reasons({"n_fail_to_pass": 495, "n_pass_to_pass": 952})]
          == [REASON_F2P_TOO_MANY], "spectreconsole-1942 (F2P=495) rejected on F2P only")
    check([r["code"] for r in reject_reasons({"n_fail_to_pass": 21, "n_pass_to_pass": 0})]
          == [REASON_P2P_EMPTY], "btcpayserver-6251 (F2P=21, P2P=0) rejected on P2P only")
    check([r["code"] for r in reject_reasons({"n_fail_to_pass": 569, "n_pass_to_pass": 0})]
          == [REASON_F2P_TOO_MANY, REASON_P2P_EMPTY],
          "a task failing both rules reports BOTH reasons")

    # boundaries — >= max rejects, max-1 keeps; P2P==0 rejects, ==1 keeps
    check(not passes({"n_fail_to_pass": MAX_FAIL_TO_PASS, "n_pass_to_pass": 5}),
          f"F2P == {MAX_FAIL_TO_PASS} is rejected (>=, not >)")
    check(passes({"n_fail_to_pass": MAX_FAIL_TO_PASS - 1, "n_pass_to_pass": 5}),
          f"F2P == {MAX_FAIL_TO_PASS - 1} is kept")
    check(passes({"n_fail_to_pass": 1, "n_pass_to_pass": 1}), "P2P == 1 is kept")
    # jupytext-360 is BELOW the threshold and is deliberately not caught
    check(passes({"n_fail_to_pass": 33, "n_pass_to_pass": 11}),
          "jupytext-360 (F2P=33) is NOT caught — documented, threshold is deliberate")

    # missing fields degrade to 0/0 -> rejected on P2P, never crash
    check([r["code"] for r in reject_reasons({"instance_id": "empty"})] == [REASON_P2P_EMPTY],
          "a spec with neither field is rejected, not crashed on")

    # partition logs every rejection and keeps the rest
    lines = []
    kept, rejected = partition([
        {"instance_id": "good", "n_fail_to_pass": 2, "n_pass_to_pass": 9},
        {"instance_id": "bad", "n_fail_to_pass": 400, "n_pass_to_pass": 0},
    ], log=lines.append, label="unit")
    check([k["instance_id"] for k in kept] == ["good"], "partition keeps the healthy task")
    check(len(rejected) == 1 and rejected[0]["instance_id"] == "bad", "partition rejects the sick task")
    check(len(lines) == 1 and "bad" in lines[0] and "400" in lines[0],
          "every rejection is logged with id + counts")
    check(rejected[0]["reasons"] == [REASON_F2P_TOO_MANY, REASON_P2P_EMPTY],
          "sidecar entry carries both reason codes")

    print("ALL PASS" if ok else "FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    import sys
    if "--self-test" in sys.argv:
        raise SystemExit(_self_test())
    print(json.dumps({"max_fail_to_pass": MAX_FAIL_TO_PASS,
                      "min_pass_to_pass": MIN_PASS_TO_PASS}, indent=2))
