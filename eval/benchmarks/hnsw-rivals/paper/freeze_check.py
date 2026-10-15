# python freeze_check.py FREEZE.json REPO
# Exit 0 only if every file FREEZE.json lists (path relative to REPO, or absolute) has its frozen SHA-256
# (PAPER_PLAN.md rules 1-2). FREEZE.json: {"commit": "...", "files": {"<path>": "<sha256>", ...}, ...}.
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jobs  # noqa: E402

fz = json.load(open(sys.argv[1])); repo = sys.argv[2]
bad = [p for p, h in fz['files'].items() if jobs.sha_file(p if os.path.isabs(p) else os.path.join(repo, p)) != h]
for p in bad:
    print('CHANGED', p)
print(f"{len(fz['files']) - len(bad)} of {len(fz['files'])} frozen files match (commit {fz.get('commit')})")
sys.exit(1 if bad or not fz['files'] else 0)
