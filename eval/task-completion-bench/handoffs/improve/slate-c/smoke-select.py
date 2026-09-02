#!/usr/bin/env python3
"""
$0 screen for the multi-file, larger-repo SMOKE pool drawn from the first held-out set
(DEV-RET, `select/.cache/tasks_full_heldout.json`) and, where goldens exist locally, dev-200.

Run from eval/task-completion-bench:
    python3 handoffs/improve/slate-c/smoke-select.py            # prints the table, writes
                                                                # select/.cache/smoke-candidates.json (gitignored)
    node select/stamp-name-lock.mjs --tasks select/.cache/smoke-candidates.json \
         --golden ~/.ss-eval/vault/golden --report-only         # name-lock census (needs the goldens)

Screen (all metadata-only, outcome-blind):
  - selection gate: FAIL_TO_PASS < 100 and PASS_TO_PASS >= 1 (select/task-gates.json)
  - gold patch touches >= 2 EXISTING source files and creates no new file
  - the issue text names NONE of the gold source files (localisation is not given away)
  - issue text > 200 chars
  - no vacuity marker in FAIL_TO_PASS (VACUITY-PRESCREEN-RESULTS.md, widened marker)
  - not used in any prior rotation / turnfix cohort / fresh pool (reported, not excluded)
Repo size = `git ls-files | wc -l` in the vault golden (~/.ss-eval/vault/golden/<owner__repo>@<sha>).
Name-lock is NOT computed here (needs gold + base tree): run stamp-name-lock.mjs on the output.
"""
import json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
BENCH = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
VAULT = os.path.expanduser('~/.ss-eval/vault/golden')
SETS = [('DEV-RET', 'select/.cache/tasks_full_heldout.json'), ('DEV-200', 'select/.cache/tasks_full_multilingual.json')]
USED_FILES = ['select/tasks_luna_rotate20.jsonl', 'select/tasks_turnfix_discovery20.jsonl', 'select/tasks_turnfix_confirm28.jsonl']
FRESH_POOL = set('''accenture__sfmc-devtools-1974 aio-libs__aiohttp-8038 apigee__registry-961
awslabs__aws-embedded-metrics-node-21 bfgroup__b2-113 bfgroup__b2-259 celestiaorg__nmt-192 devlooped__moq-1262
fastify__fastify-cors-285 gitbookio__markup-it-56 hotmeteor__spectator-181 locationtech__jts-622 protofire__solhint-224'''.split())
MARK = [re.compile(r'\bPassed\b'), re.compile(r'\bPASS\b'), re.compile(r'\bok\s+\d+'), re.compile(r'✓|✔'),
        re.compile(r'[\(\[]\d+(?:\.\d+)?\s*m?s[\)\]]')]


def files_of(patch):
    fs = re.findall(r'^diff --git a/(\S+) b/(\S+)', patch, re.M)
    new = set(re.findall(r'^--- /dev/null\n\+\+\+ b/(\S+)', patch, re.M))
    return [b for _, b in fs], new


def repo_files(repo, sha):
    d = os.path.join(VAULT, f"{repo.replace('/', '__')}@{sha}")
    if not os.path.isdir(d):
        return None
    try:
        return subprocess.run(['git', '-C', d, 'ls-files'], capture_output=True, text=True, timeout=120).stdout.count('\n')
    except Exception:
        return -1


def main():
    os.chdir(BENCH)
    used = set()
    for f in USED_FILES:
        if os.path.exists(f):
            used.update(json.loads(l)['instance_id'] for l in open(f) if l.strip())
    used |= FRESH_POOL
    rows, specs = [], []
    for name, path in SETS:
        if not os.path.exists(path):
            print(f"# {name}: {path} missing (run select/materialize_tasks.py)", file=sys.stderr)
            continue
        for t in json.load(open(path)):
            fs, new = files_of(t['patch'])
            src = [f for f in fs if f not in new]
            ps = t['problem_statement'] or ''
            named = sum(1 for f in src if os.path.basename(f) in ps or f in ps)
            f2p, p2p = len(t['FAIL_TO_PASS']), len(t['PASS_TO_PASS'])
            if not (f2p < 100 and p2p >= 1 and not new and len(ps) > 200 and len(src) >= 2 and named == 0):
                continue
            vac = any(m.search(str(e)) for e in t['FAIL_TO_PASS'] for m in MARK)
            if vac:
                continue
            rf = repo_files(t['repo'], t['base_commit'])
            rows.append(dict(set=name, id=t['instance_id'], lang=t['language'], src=len(src), f2p=f2p, p2p=p2p,
                             repo_files=rf, used=t['instance_id'] in used))
            specs.append(t)
    rows.sort(key=lambda r: (r['set'], -(r['repo_files'] if isinstance(r['repo_files'], int) and r['repo_files'] >= 0 else -1), -r['src']))
    print('set | instance_id | lang | gold src files | f2p | p2p | repo tracked files | used before')
    for r in rows:
        print(f"{r['set']} | {r['id']} | {r['lang']} | {r['src']} | {r['f2p']} | {r['p2p']} | "
              f"{r['repo_files'] if r['repo_files'] is not None else '? (no local golden)'} | {'y' if r['used'] else ''}")
    out = os.path.join(BENCH, 'select', '.cache', 'smoke-candidates.json')  # .cache is gitignored: specs carry gold + hidden tests
    json.dump(specs, open(out, 'w'))
    print(f"\n{len(rows)} candidates; specs written to {out} (gitignored; contains gold + hidden tests)")
    print("next: node select/stamp-name-lock.mjs --tasks select/.cache/smoke-candidates.json --golden ~/.ss-eval/vault/golden --report-only")


if __name__ == '__main__':
    main()
