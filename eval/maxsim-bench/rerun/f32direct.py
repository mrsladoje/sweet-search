# venv/bin/python -I rerun/f32direct.py --prep <BEIR prep dir> --sets <replay beir dir> --machine NAME [--arms numpy_packed,torch_pad_flat]
#
# Post-freeze measurement (owner approval 2026-10-17, after the external reviews; plan in
# paper/analysis/rerun-plan.md). The paper's "float32 storage" line was constructed: the
# quality of contract F (float32 vectors, float64 arithmetic) at the time of the fastest float32
# rival on the int4-decoded vectors. Here it is measured directly on one CPU: each rival scores
# the ORIGINAL float32 token vectors of the BEIR prep (unit length, so the same Spre input as
# the decoded ones up to the int4 error) and the int4-decoded vectors, in alternating rounds in
# one process (per call, alternating order); per variant: per-request p50 / p95 and nDCG@10 from the rival's own scores.
# Sets: the four k = 100 BEIR sets (fresh held-out; only aggregates are written).
# Output: <results>/<machine>/f32direct/f32direct.json.
import argparse, json, math, os, sys, time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
BENCH = os.path.dirname(HERE)
sys.path.insert(0, BENCH)
import jobs  # noqa: E402
from replay_py import load_set  # noqa: E402
import contracts  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument('--prep', required=True)
p.add_argument('--sets', required=True)
p.add_argument('--machine', required=True)
p.add_argument('--arms', default='numpy_packed,torch_pad_flat')
p.add_argument('--results', default=os.path.join(BENCH, 'results'))
p.add_argument('--rounds', type=int, default=3)
p.add_argument('--reps', type=int, default=5)
K = 100


def ndcg_at(ranked, rel, n=10):
    gains = [rel.get(d, 0) for d in ranked[:n]]
    dcg = sum(g / math.log2(i + 2) for i, g in enumerate(gains))
    ideal = sorted(rel.values(), reverse=True)[:n]
    idcg = sum(g / math.log2(i + 2) for i, g in enumerate(ideal))
    return dcg / idcg if idcg > 0 else 0.0


def prep(root, ds, mk):
    rd = os.path.join(root, 'raw', f'{ds}-{mk}')
    r = dict(dflat=np.load(os.path.join(rd, 'doc_tokens.npy'), mmap_mode='r'), doff=np.load(os.path.join(rd, 'doc_offsets.npy')),
             doc_ids=json.load(open(os.path.join(rd, 'doc_ids.json'))), qids=json.load(open(os.path.join(rd, 'query_ids.json'))),
             bm25=json.load(open(os.path.join(rd, 'bm25.json'))))
    r['dpos'] = {d: i for i, d in enumerate(r['doc_ids'])}
    rel = {}
    for i, line in enumerate(open(os.path.join(rd, 'qrels.tsv'))):
        if i:
            q, d, s = line.rstrip('\n').split('\t')
            if int(s) > 0:
                rel.setdefault(q, {})[d] = int(s)
    r['rel'] = rel
    return r


def main(a):
    import bench
    res = dict(machine=a.machine, k=K, rounds=a.rounds, reps=a.reps, script=jobs.sha_file(os.path.abspath(__file__)), cells={})
    for ds in ('scifact', 'nfcorpus'):
        for mk in ('colbertv2', 'answersmall'):
            P = prep(a.prep, ds, mk)
            calls = load_set(os.path.join(a.sets, f'beir-{ds}-{mk}-k{K}'))
            qids, ids_of, orig, maxdiff = [], [], [], 0.0
            for c in calls:
                qid = P['qids'][int(c['file'][5:10])]
                ids = [d for d, _ in P['bm25'][qid][:K]]
                docs = []
                for d, x in zip(ids, c['cands']):
                    j = P['dpos'][d]
                    D = np.ascontiguousarray(P['dflat'][P['doff'][j]:P['doff'][j + 1]], dtype=np.float32)
                    assert D.shape[0] == x['nt'], (ds, mk, c['file'], d)
                    docs.append(D)
                qn, dec = contracts.spre_inputs(c, 'f32')
                # the mapping call -> query -> candidates is right only if the decoded tokens are close to the originals
                maxdiff = max(maxdiff, max(float(np.abs(u - v).max()) for u, v in zip(dec, docs)))
                qids.append(qid); ids_of.append(ids); orig.append((qn, docs))
            assert maxdiff < 0.2, maxdiff
            cell = res['cells'][f'{ds}|{mk}'] = dict(calls=len(calls), max_abs_decoded_minus_original=maxdiff, arms={})
            for arm in a.arms.split(','):
                ps = jobs.parse_spec(arm)
                bench.args.threads = ps['threads'] or 0
                build = bench.ARMS[ps['arm']][0]
                ts = {'decoded': [], 'original': []}
                scores = {'decoded': [], 'original': []}
                for rnd in range(a.rounds):
                    # per call: build both variants (untimed), then warm-up + timed repetitions, order alternating
                    for i, (c, o) in enumerate(zip(calls, orig)):
                        for variant in (('decoded', 'original') if (i + rnd) % 2 == 0 else ('original', 'decoded')):
                            c2 = {k: v for k, v in c.items() if not k.startswith('in_')}
                            if variant == 'original':
                                c2['in_f32'] = o
                            r = build(c2)
                            s = r()                                   # untimed warm-up, as bench.py
                            for _ in range(a.reps):
                                t = time.perf_counter_ns(); r(); ts[variant].append(time.perf_counter_ns() - t)
                            if rnd == 0:
                                scores[variant].append(np.asarray(s, np.float64))
                            del r, c2
                out = {}
                for variant in ('decoded', 'original'):
                    nd = [ndcg_at([ids[i] for i in np.argsort(-s, kind='stable')], P['rel'].get(q, {})) for q, ids, s in zip(qids, ids_of, scores[variant])]
                    t = np.asarray(ts[variant], float) / 1e6
                    out[variant] = dict(ndcg10=float(np.mean(nd)), p50_ms=float(np.percentile(t, 50)), p95_ms=float(np.percentile(t, 95)), n_timed=int(t.size))
                out['p95_ratio_original_over_decoded'] = out['original']['p95_ms'] / out['decoded']['p95_ms']
                cell['arms'][arm] = out
                print(ds, mk, arm, 'done', flush=True)
    d = os.path.join(a.results, a.machine, 'f32direct')
    os.makedirs(d, exist_ok=True)
    json.dump(res, open(os.path.join(d, 'f32direct.json'), 'w'), indent=1)
    print('f32direct complete')


if __name__ == '__main__':
    main(p.parse_args())
