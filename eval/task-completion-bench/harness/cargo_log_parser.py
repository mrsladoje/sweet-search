"""Cargo test-log parsing used by the SWE-rebench evaluator adapter."""

from __future__ import annotations

import re


_TEST_HEADER_RE = re.compile(r"^test\s+(\S+)\s+\.\.\.(?:\s+(.*))?$")
_STANDALONE_STATUS = {"ok": "PASSED", "FAILED": "FAILED"}
# A status token with another test's captured stdout glued onto it, e.g.
# ``test dependencies::provided_local_to_manifest ... okLocked!`` (gleam's
# build_lock tests print ``Locked!`` while sibling tests report). The status is
# still the status: cargo never prints a lowercase/digit continuation after
# ``ok`` (that would be a word such as ``okay``), and nothing may follow ``ok``
# or ``FAILED`` on a genuine header line at all.
_GLUED_STATUS_RE = re.compile(r"^(ok|FAILED)(?=[^a-z0-9_])")
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
            header_outcome = _status_token(suffix)
            if header_outcome is not None:
                results[test_name] = header_outcome
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

        outcome = _status_token(line)
        if outcome is None:
            continue
        if ambiguous_remaining:
            ambiguous_remaining -= 1
            continue
        if pending_name is not None:
            results[pending_name] = outcome
            pending_name = None

    return results


def _status_token(token: str | None) -> str | None:
    """Map ``ok``/``FAILED`` (bare or with glued stdout) to an outcome, else None."""

    if token is None:
        return None
    outcome = _STANDALONE_STATUS.get(token)
    if outcome is not None:
        return outcome
    glued = _GLUED_STATUS_RE.match(token)
    return _STANDALONE_STATUS[glued.group(1)] if glued else None
