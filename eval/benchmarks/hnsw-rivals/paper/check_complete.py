# python check_complete.py <jobs-expected-*.json> [...]
# Passes (exit 0) only if every job of every list has its result record: the same job hash and key,
# complete, one timing per query, and a lists file of the right size and hash. Scoring runs only after
# this passes (PAPER_PLAN.md section 5 item 2).
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jobs  # noqa: E402

problems, n = [], 0
for ef in sys.argv[1:]:
    d = json.load(open(ef))
    results = os.path.dirname(os.path.dirname(os.path.abspath(ef)))
    for j in d['jobs']:
        n += 1
        why = jobs.validate(os.path.join(results, j['file']), j['job_hash'], j['key'], j['n_queries'])
        if why:
            problems.append(f"{j['file']}: {why}")
for p in problems:
    print('INCOMPLETE', p)
print(f'{n - len(problems)} of {n} jobs complete' + ('' if not problems else f'; {len(problems)} not'))
sys.exit(1 if problems or n == 0 else 0)
