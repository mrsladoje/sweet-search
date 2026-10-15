# Fixtures of PAPER_PLAN section 4 for quality.py, gt.py and stats.py. Plain Python: expected values
# are computed by hand here with `math`; quality.py, stats.py and gt.py are only CALLED.
# usage: python fixtures_quality.py      (exit 0 only if every fixture passes; one line per fixture)
import array, json, math, os, struct, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import quality, stats  # noqa: E402  (called only)

TMP = tempfile.mkdtemp(prefix='fixq-')
MODEL, DIM = 'M', 4
results = []


def fixture(fn):
    try:
        fn()
        results.append((fn.__name__, True, ''))
        print(f'PASS {fn.__name__}')
    except Exception as e:  # noqa: BLE001
        results.append((fn.__name__, False, repr(e)))
        print(f'FAIL {fn.__name__}: {e!r}')
    return fn


def check(cond, msg=''):
    if not cond:
        raise AssertionError(msg)


def close(a, b, tol=1e-12):
    check(abs(a - b) <= tol, f'{a} != {b}')


def mk(name, vec_docs, queries, vecs=None, qvecs=None, self_match=False):
    """Write a tiny DATA tree. vec_docs[i] = doc key of vector i (None = distractor).
    queries = [(qid, split, rel{key: grade}, cluster)]. Returns DATA."""
    sd, ed = f'{TMP}/sets/{name}', f'{TMP}/emb/{MODEL}/{name}'
    os.makedirs(sd), os.makedirs(ed)
    with open(f'{sd}/vectors.jsonl', 'w') as f:
        for i, d in enumerate(vec_docs):
            f.write(json.dumps({'vid': f'v{i}', 'doc': d}) + '\n')
    with open(f'{sd}/queries.jsonl', 'w') as f:
        for qid, split, rel, cl in queries:
            f.write(json.dumps({'qid': qid, 'text': '', 'split': split, 'rel': rel, 'cluster': cl}) + '\n')
    json.dump({'name': name, 'kind': 'code', 'self_match': self_match}, open(f'{sd}/set.json', 'w'))
    json.dump({'model': MODEL, 'dim': DIM}, open(f'{ed}/model.json', 'w'))
    for fn, rows in (('corpus.f32', vecs or [[0.0] * DIM] * len(vec_docs)),
                     ('queries.f32', qvecs or [[0.0] * DIM] * len(queries))):
        with open(f'{ed}/{fn}', 'wb') as f:
            array.array('f', [x for r in rows for x in r]).tofile(f)
    return TMP


def load(name):
    return quality.load_set(TMP, name)


def run_gt(name, split='dev', block=None):
    cmd = [sys.executable, f'{HERE}/gt.py', TMP, name, MODEL, split] + (['--block', str(block)] if block else [])
    subprocess.run(cmd, check=True, capture_output=True)
    d = f'{TMP}/emb/{MODEL}/{name}/gt'
    out = {}
    for k, code in (('docs.i32', 'i'), ('docs.f64', 'd'), ('vecs.i32', 'i'), ('vecs.f64', 'd')):
        a = array.array(code)
        with open(f'{d}/{split}.{k}', 'rb') as f:
            a.frombytes(f.read())
        out[k] = a
    return out


def row(a, q, n=100):
    return list(a[q * n:(q + 1) * n])


def unit_cos(v, q):
    n = math.sqrt(sum(x * x for x in v))
    return sum((x / n) * y for x, y in zip(v, q))


# ---- aggregation and metrics ------------------------------------------------------------------

# 12 documents: A has 5 vectors (vid 0-4), B..L one each (vid 5-15). Doc ids A=0, B=1, ... L=11.
LETTERS = 'ABCDEFGHIJKL'
VDOC = ['A'] * 5 + list(LETTERS[1:])
mk('agg', VDOC, [
    ('q_dup', 'dev', {'H': 1}, 'c1'),
    ('q_short', 'dev', {'B': 1}, 'c1'),
    ('q_tie', 'dev', {'C': 1}, 'c2'),
    ('q_norel', 'dev', {}, 'c2'),
    ('q_far', 'dev', {'Z': 2}, 'c3'),                 # judged doc that is not in the corpus
    ('q_graded', 'dev', {'A': 3, 'B': 2, 'C': 1, 'D': 0, 'Z': 2}, 'c3'),
])
S = load('agg')


@fixture
def duplicate_documents_dedup_before_cut():
    # 12 vectors, doc A owns the first five: a cut at 10 vectors before dedup would lose docs G, H.
    vids = list(range(12))
    scores = [1.0 - 0.01 * i for i in vids]
    docs, _ = quality.to_docs(S, vids, scores, 0)
    check(docs == [0, 1, 2, 3, 4, 5, 6, 7], docs)             # A, then B..H: 8 documents
    close(quality.mrr(S, 0, docs), 1 / 8)                     # relevant doc H is 8th


@fixture
def doc_score_is_max_of_its_vectors():
    # doc A vectors score 0.2, 0.9, 0.1; doc B vector scores 0.5 -> A (0.9) first.
    docs, sc = quality.to_docs(S, [0, 5, 1, 2], [0.2, 0.5, 0.9, 0.1], 0)
    check(docs == [0, 1] and sc[0] == 0.9 and sc[1] == 0.5, (docs, sc))


def vids_pad(rows, fill=-1):
    L = max(len(r) for r in rows)
    return [list(r) + [fill] * (L - len(r)) for r in rows]


@fixture
def fewer_than_ten_documents():
    vids = [[5, 6, 7, 8], list(range(5, 16))]               # 4 documents / 11 documents
    scores = [[0.9, 0.8, 0.7, 0.6], [1 - 0.01 * i for i in range(11)]]
    r = quality.eval_lists(S, [1, 1], vids_pad(vids), vids_pad(scores, -1.0), 'mrr')
    check(list(r['n_docs']) == [4, 10], list(r['n_docs']))
    check(r['short'] == 1, r['short'])
    close(r['q'][0], 1.0)                                    # vid 5 is doc B, the relevant one
    docs, _ = quality.to_docs(S, [5, 6, 7, 8], [0.9, 0.8, 0.7, 0.6], 1)
    close(quality.ndcg(S, 1, docs), 1.0)                     # missing ranks are non-relevant, not an error


@fixture
def ties_in_score_use_lower_doc_id():
    # vid v >= 5 is doc v - 4; listed in the order docs 6, 4, 5, 3 with equal scores.
    docs, _ = quality.to_docs(S, [10, 8, 9, 7], [0.5, 0.5, 0.5, 0.5], 2)
    check(docs == [3, 4, 5, 6], docs)
    # one document with two equal-score vectors and a tie against another document
    docs, sc = quality.to_docs(S, [6, 5, 5, 6], [0.4, 0.4, 0.4, 0.4], 2)
    check(docs == [1, 2] and sc == [0.4, 0.4], (docs, sc))


@fixture
def query_with_no_relevant_document():
    docs, _ = quality.to_docs(S, [5, 6, 7], [0.9, 0.8, 0.7], 3)
    close(quality.mrr(S, 3, docs), 0.0)
    close(quality.ndcg(S, 3, docs), 0.0)                      # ideal DCG 0: defined as 0, no division error
    docs, _ = quality.to_docs(S, [5, 7], [0.9, 0.8], 2)      # relevant doc C absent from the list
    close(quality.mrr(S, 2, docs), 0.0)


@fixture
def ndcg_graded_with_unretrievable_judged_doc():
    # judged: A=3, B=2, C=1, D=0, Z=2 (Z not in corpus). List docs: B, J, A, C.
    docs, _ = quality.to_docs(S, [5, 14, 0, 6], [0.9, 0.8, 0.7, 0.6], 5)
    check(docs == [1, 10, 0, 2], docs)
    dcg = 2 / math.log2(2) + 3 / math.log2(4) + 1 / math.log2(5)      # B rank1, A rank3, C rank4
    idcg = 3 / math.log2(2) + 2 / math.log2(3) + 2 / math.log2(4) + 1 / math.log2(5)   # 3,2,2,1
    close(quality.ndcg(S, 5, docs), dcg / idcg)


@fixture
def mrr_first_relevant_only():
    # two relevant docs: MRR counts the first one only.
    docs, _ = quality.to_docs(S, [8, 5, 6], [0.9, 0.8, 0.7], 5)
    close(quality.mrr(S, 5, docs), 1 / 2)                    # vid 8 = E (not rel); B (rel) is rank 2


@fixture
def recall_of_vectors():
    exact = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    got = [9, 8, 7, 6, 5, 4, 3, 15, 14, 13, 0]               # first 10 only: 7 of them in exact
    close(quality.recall_vec(S, 0, got, exact), 0.7)
    close(quality.recall_vec(S, 0, [0, 1, 2] + [-1] * 7, exact), 0.3)   # empty slots count as misses


@fixture
def lists_bin_reader():
    n, L = 3, 4
    vids = [1, 2, -1, -1, 3, 4, 5, 6, -1, -1, -1, -1]
    scores = [0.5, 0.25, 0.0, 0.0, 1.0, 0.75, 0.5, 0.125, 0.0, 0.0, 0.0, 0.0]
    p = f'{TMP}/rec1'
    json.dump({'n_queries': n, 'L': L}, open(p + '.json', 'w'))
    with open(p + '.lists.bin', 'wb') as f:
        array.array('i', vids).tofile(f)
        array.array('f', scores).tofile(f)
    rec, v, s = quality.read_record(p + '.json')
    check(list(v.ravel()) == vids and [float(x) for x in s.ravel()] == scores)
    check(v.shape == (3, 4) and s.shape == (3, 4))


# ---- self-match -------------------------------------------------------------------------------

# 13 documents D0..D12, one vector each; query q is the document D3 itself (BEIR Quora style).
mk('selfm', [f'D{i}' for i in range(13)],
   [('D3', 'dev', {'D12': 1}, 'D3')], self_match=True)
S2 = load('selfm')


@fixture
def self_match_removed_before_the_cut():
    # list: self (vid 3) first, then 10 others; the relevant D12 is the LAST of the 10 others.
    vids = [3, 0, 1, 2, 4, 5, 6, 7, 8, 9, 12]
    scores = [1.0 - 0.01 * i for i in range(11)]
    docs, _ = quality.to_docs(S2, vids, scores, 0)
    check(3 not in docs and len(docs) == 10 and docs[-1] == 12, docs)   # 11th vector moved in
    close(quality.mrr(S2, 0, docs), 1 / 10)


# ---- ground truth -----------------------------------------------------------------------------

Q = [1.0, 0.0, 0.0, 0.0]


@fixture
def gt_ties_doc_id_and_vector_id():
    # v0 and v1 identical, v3 identical to them again; v2 (doc d0 again, non-contiguous) is worse.
    same = [3.0, 4.0, 0.0, 0.0]
    low = [1.0, 4.0, 0.0, 0.0]
    vecs = [same, same, low, same, [0.0, 1.0, 0.0, 0.0]]
    mk('gtties', ['d0', 'd1', 'd0', 'd2', 'd3'], [('q', 'dev', {'d0': 1}, 'c')], vecs, [Q])
    out = run_gt('gtties')
    check(row(out['vecs.i32'], 0)[:5] == [0, 1, 3, 2, 4], row(out['vecs.i32'], 0)[:5])
    check(row(out['docs.i32'], 0)[:4] == [0, 1, 2, 3], row(out['docs.i32'], 0)[:4])
    check(row(out['docs.i32'], 0)[4] == -1 and row(out['docs.f64'], 0)[4] == -math.inf, 'padding')
    close(row(out['docs.f64'], 0)[0], unit_cos(same, Q))
    close(row(out['docs.f64'], 0)[1], unit_cos(same, Q))
    again = run_gt('gtties', block=2)                          # block size does not change the bytes
    check(all(again[k] == out[k] for k in out), 'block size changed the output')


@fixture
def gt_uses_stored_float32_not_float16():
    ya, yb = 0.0300002, 0.0300001
    f32 = lambda x: struct.unpack('f', struct.pack('f', x))[0]
    f16 = lambda x: struct.unpack('e', struct.pack('e', x))[0]
    check(f32(ya) != f32(yb), 'premise: float32 values differ')
    check(f16(f32(ya)) == f16(f32(yb)), 'premise: float16 rounding makes them equal')
    va, vb = [1.0, ya, 0.0, 0.0], [1.0, yb, 0.0, 0.0]
    mk('gtf16', ['da', 'db'], [('q', 'dev', {'da': 1}, 'c')], [va, vb], [Q])
    out = run_gt('gtf16')
    # float32 truth: vb (smaller y) is closer to Q -> vid 1 first. A float16 ground truth would tie
    # and put vid 0 first.
    check(unit_cos([1.0, f32(yb), 0, 0], Q) > unit_cos([1.0, f32(ya), 0, 0], Q), 'premise: order in float32')
    check(row(out['vecs.i32'], 0)[:2] == [1, 0], row(out['vecs.i32'], 0)[:2])
    check(row(out['docs.i32'], 0)[:2] == [1, 0], row(out['docs.i32'], 0)[:2])


@fixture
def gt_doc_with_best_vector_outside_exact_top_100_vectors():
    A = [[1.0, 0.001 * k, 0.0, 0.0] for k in range(1, 151)]     # 150 vectors of doc A, cos falls with k
    vecs = A + [[1.0, 1.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0]]   # doc B (cos .707), doc C (cos 0)
    mk('gtfar', ['A'] * 150 + ['B', 'C'], [('q', 'dev', {'B': 1}, 'c')], vecs, [Q])
    out = run_gt('gtfar')
    v = row(out['vecs.i32'], 0)
    check(v == list(range(100)), 'exact top 100 vectors are the first 100 of A')
    check(150 not in v, 'B vector is outside the exact top 100 vectors')
    check(row(out['docs.i32'], 0)[:3] == [0, 1, 2], row(out['docs.i32'], 0)[:3])
    close(row(out['docs.f64'], 0)[1], unit_cos([1.0, 1.0, 0, 0], Q))
    S3 = load('gtfar')
    check(quality.mrr(S3, 0, [int(d) for d in row(out['docs.i32'], 0) if d >= 0]) == 0.5, 'B is ranked 2nd')


@fixture
def gt_self_match_removes_document_and_its_vectors():
    vdocs = [f'D{i}' for i in range(12)] + ['D3']               # D3 has two vectors (vid 3 and 12)
    vecs = [[1.0, 0.1 * (i + 1), 0.0, 0.0] for i in range(12)] + [[1.0, 0.05, 0.0, 0.0]]
    vecs[3] = [1.0, 0.0, 0.0, 0.0]                              # D3 would be the best match
    mk('gtself', vdocs, [('D3', 'dev', {'D11': 1}, 'D3')], vecs, [Q], self_match=True)
    out = run_gt('gtself')
    d = [x for x in row(out['docs.i32'], 0) if x >= 0]
    v = [x for x in row(out['vecs.i32'], 0) if x >= 0]
    check(3 not in d and len(d) == 11, d)                       # doc id 3 is D3
    check(3 not in v and 12 not in v and len(v) == 11, v)       # both of D3's vectors are gone
    check(d[0] == 0, d)                                         # D0 (y=0.1) is now closest


# ---- statistics -------------------------------------------------------------------------------

CL = ['a'] * 3 + ['b'] * 3


@fixture
def bootstrap_resamples_whole_clusters():
    boot = stats.ClusterBoot(CL, B=10000, seed=42)
    m = [float(x) for x in boot.means([1, 1, 1, -1, -1, -1])]
    vals = {round(x, 9) for x in m}
    check(vals == {-1.0, 0.0, 1.0}, vals)                       # a query-level bootstrap would give thirds
    for v, p in ((-1.0, 0.25), (0.0, 0.5), (1.0, 0.25)):
        check(abs(sum(1 for x in m if round(x, 9) == v) / len(m) - p) < 0.02, v)
    again = stats.ClusterBoot(CL, B=10000, seed=42)
    check([float(x) for x in again.means([1, 1, 1, -1, -1, -1])] == m, 'seed 42 must reproduce')


@fixture
def selection_rule_hand_case():
    boot = stats.ClusterBoot(CL)
    ex = [1.0] * 6
    f = 0.98
    check(stats.selection(boot, [1.0] * 6, ex, f)['qualifies'], 'd = +0.02 everywhere')
    check(not stats.selection(boot, [0.97] * 6, ex, f)['qualifies'], 'd = -0.01 everywhere')
    check(stats.selection(boot, [0.98] * 6, ex, f)['qualifies'], 'd = 0 qualifies (bound >= 0)')
    r = stats.selection(boot, [1, 1, 1, 0.5, 0.5, 0.5], ex, f)  # mean d > -0.23 but one cluster is bad
    check(not r['qualifies'], r)
    close(r['lower'], -0.48, 1e-9)                              # 2.5% point: both draws are the bad cluster


@fixture
def non_inferiority_hand_case():
    boot = stats.ClusterBoot(CL)
    rv = [0.5] * 6
    check(stats.noninferiority(boot, [0.498] * 6, rv, 0.005)['pass'], '-0.002 within delta')
    check(not stats.noninferiority(boot, [0.494] * 6, rv, 0.005)['pass'], '-0.006 beyond delta')
    check(stats.noninferiority(boot, rv, rv, 0.005)['pass'], 'zero difference passes')
    r = stats.noninferiority(boot, [0.5, 0.5, 0.5, 0.0, 0.0, 0.0], rv, 0.005)
    check(not r['pass'] and r['lower'] < -0.5 + 1e-9, r)       # one cluster loses 0.5: lower bound -0.5


@fixture
def holm_hand_case():
    check(stats.holm([0.01, 0.02, 0.04], 0.025) == [False, False, False], 'smallest p > 0.025/3')
    check(stats.holm([0.04, 0.005, 0.02], 0.025) == [False, True, False], 'only 0.005 <= 0.025/3; 0.02 > 0.025/2')
    check(stats.holm([0.001, 0.01, 0.012], 0.025) == [True, True, True], 'all pass step-down')
    check(stats.holm([0.001, 0.2, 0.001], 0.025) == [True, False, True], 'stops at 0.2')


@fixture
def tost_hand_case():
    boot = stats.ClusterBoot(CL)
    rv = [0.5] * 6
    check(stats.tost(boot, [0.502] * 6, rv, 0.005)['equivalent'], '+0.002 inside +-0.005')
    check(not stats.tost(boot, [0.494] * 6, rv, 0.005)['equivalent'], '-0.006 outside')
    check(not stats.tost(boot, [0.5, 0.5, 0.5, 0.504, 0.504, 0.504], [0.5] * 3 + [0.4] * 3, 0.005)['equivalent'])


@fixture
def power_hand_case():
    close(stats.power_analytic(0.005, 0.005 / 1.96), 0.5)
    close(stats.power_analytic(0.005, 0.0), 1.0)
    close(stats.power_analytic(0.005, 0.001), 0.5 * (1 + math.erf((5 - 1.96) / math.sqrt(2))))
    boot = stats.ClusterBoot(CL)
    p = stats.power(boot, [0.0] * 6, 2, 0.005, draws=200, inner=200)
    check(p['power_analytic'] == 1.0 and p['power_sim'] == 1.0, p)        # no spread: always passes
    p = stats.power(boot, [1, 1, 1, -1, -1, -1], 2, 0.005, draws=200, inner=200)
    check(p['power_analytic'] < 0.1 and p['power_sim'] < 0.4, p)          # huge spread: little power (2 clusters)
    close(p['se_ho'], p['se_dev'])                                        # same cluster count: no scaling


if __name__ == '__main__':
    bad = [r for r in results if not r[1]]
    print(f'{len(results) - len(bad)}/{len(results)} fixtures passed')
    sys.exit(1 if bad else 0)
