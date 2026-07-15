"""Cargo test-log parsing used by the SWE-rebench evaluator adapter."""

from __future__ import annotations

import re


_TEST_HEADER_RE = re.compile(r"^test\s+(\S+)\s+\.\.\.(?:\s+(.*))?$")
_STANDALONE_STATUS = {"ok": "PASSED", "FAILED": "FAILED"}
_SUITE_BOUNDARY_RE = re.compile(r"^(?:running\s+\d+\s+tests?|test result:)")


def parse_log_cargo(log: str) -> dict[str, str]:
    """Return named Cargo test outcomes without guessing concurrent identities.

    Cargo normally prints ``test NAME ... ok``. With captured stdout enabled, the
    header can instead contain test output and the status can arrive on a later,
    standalone line. That status is safe to assign only while one test header is
    unresolved. If multiple headers overlap, their completion order is ambiguous;
    the whole cohort is drained without emitting a result.
    """

    results: dict[str, str] = {}
    pending_name: str | None = None
    ambiguous_remaining = 0

    for raw_line in log.splitlines():
        line = raw_line.strip()

        if _SUITE_BOUNDARY_RE.match(line):
            pending_name = None
            ambiguous_remaining = 0
            continue

        header = _TEST_HEADER_RE.match(line)
        if header:
            test_name, suffix = header.groups()
            if suffix in _STANDALONE_STATUS:
                results[test_name] = _STANDALONE_STATUS[suffix]
                continue
            if suffix == "ignored":
                continue

            if ambiguous_remaining:
                ambiguous_remaining += 1
            elif pending_name is None:
                pending_name = test_name
            else:
                pending_name = None
                ambiguous_remaining = 2
            continue

        outcome = _STANDALONE_STATUS.get(line)
        if outcome is None:
            continue
        if ambiguous_remaining:
            ambiguous_remaining -= 1
            continue
        if pending_name is not None:
            results[pending_name] = outcome
            pending_name = None

    return results
