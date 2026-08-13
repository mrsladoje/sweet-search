#!/usr/bin/env python3
"""Run SWE-rebench with the repository-owned evaluator integrity fixes."""

from __future__ import annotations

import os
from pathlib import Path
import runpy
import sys

sys.dont_write_bytecode = True

from cargo_log_parser import parse_log_cargo


DEFAULT_EVAL_DIR = "/root/swe-rebench-tools/SWE-rebench-V2"


def main() -> int:
    """Install the Cargo parser override, then execute the selected evaluator."""

    eval_dir = Path(os.environ.get("SR_EVAL_DIR", DEFAULT_EVAL_DIR)).resolve()
    eval_lib = eval_dir / "lib"
    owned_eval_script = Path(__file__).resolve().parent / "upstream-patches" / "eval.py"
    # Production defaults to the repository-owned evaluator so the evidence
    # contract cannot drift with an unverified external checkout. Tests and
    # controlled compatibility probes may opt into an explicit external script;
    # evaluator-runtime still fails closed if its report omits n_test_results.
    override = os.environ.get("SS_SR_EVAL_SCRIPT")
    eval_script = Path(override).resolve() if override else owned_eval_script
    if not eval_lib.is_dir():
        print(f"invalid SWE-rebench evaluator directory: {eval_dir}", file=sys.stderr)
        return 2
    if not eval_script.is_file():
        print(f"evaluator script not found: {eval_script}", file=sys.stderr)
        return 2

    sys.path.insert(0, str(eval_dir))
    sys.path.insert(0, str(eval_lib))
    from agent import log_parsers  # pylint: disable=import-outside-toplevel

    log_parsers.parse_log_cargo = parse_log_cargo
    log_parsers.NAME_TO_PARSER["parse_log_cargo"] = parse_log_cargo
    sys.argv = [str(eval_script), *sys.argv[1:]]
    runpy.run_path(str(eval_script), run_name="__main__")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
