# venv/bin/python -I paper/analysis/workload.py
#
# Post-freeze analysis code (not frozen). Workload study: call shapes of the replay sets
# (unique captured calls, duplicates removed; NOT a request-frequency distribution).
# Percentiles over calls of query tokens, pool size (candidates per call), doc tokens per
# candidate, and stored doc tokens per call. Aggregates only; from the intel cache (the
# shapes are the same data on every machine).
import os, sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import OUT, dump, cache, beir_sets, sweep_sets  # noqa: E402


def stats(nq, pool, tok):
    per_doc = tok / np.maximum(pool, 1)
    pc = lambda x: {f'p{q}': float(np.percentile(x, q)) for q in (10, 50, 90, 99)} | {'max': float(np.max(x))}
    return dict(calls=int(len(nq)), query_tokens=pc(nq), pool=pc(pool), doc_tokens_per_candidate=pc(per_doc), doc_tokens_per_call=pc(tok),
                share_query_over_32=float(np.mean(nq > 32)))


def main():
    c = cache('intel', 'ho-warm')
    res = {}
    for name, sets in (('agent-ho', ['agent-ho']), ('gcsn-ho', ['gcsn-ho']), ('beir (20 sets)', beir_sets(c)),
                       ('sweep-ho (84 cells)', sweep_sets(c))):
        sh = [c[s]['shape'] for s in sets]
        res[name] = stats(np.concatenate([x['nq'] for x in sh]), np.concatenate([x['pool'] for x in sh]), np.concatenate([x['tokens'] for x in sh]))
        if name == 'agent-ho':
            res[name]['repositories'] = len(set(c['agent-ho']['clusters']))
    dump('workload.json', res)
    L = ['# Workload shapes (unique calls; not a request-frequency distribution)', '',
         '| set | calls | query tokens p10/p50/p90/max | pool p10/p50/p90/max | doc tokens per candidate p10/p50/p90 | stored doc tokens per call p50/p90/max | query > 32 tokens |',
         '|---|--:|--:|--:|--:|--:|--:|']
    f = lambda d, ks: ' / '.join(f'{d[k]:.0f}' for k in ks)
    for n, d in res.items():
        L.append(f"| {n} | {d['calls']} | {f(d['query_tokens'], ('p10', 'p50', 'p90', 'max'))} | {f(d['pool'], ('p10', 'p50', 'p90', 'max'))} | "
                 f"{f(d['doc_tokens_per_candidate'], ('p10', 'p50', 'p90'))} | {f(d['doc_tokens_per_call'], ('p50', 'p90', 'max'))} | {d['share_query_over_32']*100:.1f}% |")
    open(os.path.join(OUT, 'workload.md'), 'w').write('\n'.join(L) + '\n')
    print('\n'.join(L))


if __name__ == '__main__':
    main()
