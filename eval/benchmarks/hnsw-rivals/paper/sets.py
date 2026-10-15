#!/usr/bin/env python
"""Build the model-independent set definitions of the paper harness (DESIGN.md sections 1.1, 1.2).

    python sets.py --data DATA [--src /root/hnsw-x86/sets] [--sets gcsn,d20k,dall,csn1m,advtest,quora,fiqa]

Writes DATA/sets/<set>/{set.json, vectors.jsonl, queries.jsonl} for every requested set, and for the
five code sets DATA/emb/CodeRankEmbed/<set>/{corpus.f32 (symlink), queries.f32, model.json} from the
vectors that already exist (the v4 set directories).

Code sets   : read the v4 set dirs (<src>/<set>-dev, <src>/<set>-ho; csn1m-ho lives in <src>/v4/).
              The dev / held-out split is kept exactly. Checks: dev and held-out share the corpus (ids,
              doc keys and, for the vector file, the SHA-256), no query id and no (query, gold) pair in
              both splits, 600 dev + 400 held-out queries per language.
AdvTest     : one query list in the source; NEW 60/40 split, seed 42 (method in set.json).
Quora, FiQA : BEIR test queries (zip from the pinned BEIR URL, downloaded into DATA/raw), NEW 60/40 split.

The script computes no retrieval-quality metric and prints no per-query held-out row.
Needs numpy (the box venv /root/hnsw-x86/venv has it). Reads sources only; writes only under DATA.
"""
import argparse, hashlib, json, os, random, sys, zipfile
import numpy as np

SEED = 42
DEV_FRAC = 0.6
DIM = 768
BEIR_URL = 'https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/{}.zip'
CODE_SETS = {  # name -> (dev dir, held-out dir) relative to --src
    'gcsn': ('gcsn-dev', 'gcsn-ho'),
    'd20k': ('d20k-dev', 'd20k-ho'),
    'dall': ('dall-dev', 'dall-ho'),
    'csn1m': ('csn1m-dev', 'v4/csn1m-ho'),
}
ALL_SETS = ['gcsn', 'd20k', 'dall', 'csn1m', 'advtest', 'quora', 'fiqa']


def jl(obj):
    # ASCII only: raw U+2028 / U+0085 would split a line in some readers (Node readline does)
    return json.dumps(obj, ensure_ascii=True, separators=(',', ':'))


def sha256_file(path, chunk=1 << 24):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        while True:
            b = f.read(chunk)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


_sha_cache = {}
def sha256_cached(path):
    real = os.path.realpath(path)
    if real not in _sha_cache:
        _sha_cache[real] = sha256_file(real)
    return _sha_cache[real]


def write_json(path, obj):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write('\n')


def seeded_shuffle(items, seed=SEED):
    """Fisher-Yates, i = n-1..1, j = floor(random() * (i + 1)), random.Random(seed).
    Only Random.random() is used: its output is the same on every Python 3 version."""
    rng = random.Random(seed)
    a = list(items)
    for i in range(len(a) - 1, 0, -1):
        j = int(rng.random() * (i + 1))
        a[i], a[j] = a[j], a[i]
    return a


def split_ids(qids):
    """60/40 split, seed 42: sort ids ascending (byte order of str), shuffle, first round(0.6 n) = dev."""
    order = seeded_shuffle(sorted(qids))
    n_dev = round(DEV_FRAC * len(order))
    return set(order[:n_dev]), set(order[n_dev:])


def read_rows(path, idx):
    """Rows idx (list of ints) of a float32 n x 768 file, in the order of idx."""
    mm = np.memmap(path, dtype='<f4', mode='r').reshape(-1, DIM)
    return np.ascontiguousarray(mm[idx])


def vec_stats(path, n_sample=20000):
    mm = np.memmap(path, dtype='<f4', mode='r').reshape(-1, DIM)
    n = mm.shape[0]
    idx = np.unique(np.linspace(0, n - 1, min(n, n_sample)).astype(np.int64))
    x = np.asarray(mm[idx], dtype=np.float64)
    nr = np.linalg.norm(x, axis=1)
    return {'rows': int(n), 'sample_rows': int(len(idx)), 'finite': bool(np.isfinite(x).all()),
            'norm_min': float(nr.min()), 'norm_max': float(nr.max())}


def doc_key(vid, doc):
    return doc if doc else '__v' + vid


def write_vectors(out_dir, ids, chunk_doc):
    """vectors.jsonl in vector-id order; returns (n_docs, doc key list in vector order, first vector of each doc)."""
    seen = {}
    p = os.path.join(out_dir, 'vectors.jsonl')
    with open(p, 'w', encoding='utf-8') as f:
        for vid, d in zip(ids, chunk_doc):
            k = doc_key(vid, d)
            if k not in seen:
                seen[k] = vid
            f.write(jl({'vid': vid, 'doc': k}) + '\n')
    return seen, p


def write_queries(out_dir, rows):
    p = os.path.join(out_dir, 'queries.jsonl')
    with open(p, 'w', encoding='utf-8') as f:
        for r in rows:
            f.write(jl(r) + '\n')
    return p


def repo_of(vid):
    p = vid.split('/')
    return p[0] + '/' + p[1]


def check_counts(name, rows):
    qids = [r['qid'] for r in rows]
    assert len(qids) == len(set(qids)), f'{name}: duplicate query ids'
    assert all(r['cluster'] for r in rows), f'{name}: a query has no cluster'


def finish_set(out_dir, meta, vec_path, q_path):
    meta['membership_sha256'] = sha256_file(vec_path)
    meta['queries_sha256'] = sha256_file(q_path)
    write_json(os.path.join(out_dir, 'set.json'), meta)
    print(f"  {meta['name']}: vectors {meta['n_vectors']} docs {meta['n_docs']} queries {meta['n_queries']} "
          f"membership {meta['membership_sha256'][:12]} queries {meta['queries_sha256'][:12]}")


# --------------------------------------------------------------------------------------------- code sets
def build_code_set(name, data, src, with_emb=True):
    dev_rel, ho_rel = CODE_SETS[name]
    dev_dir, ho_dir = os.path.join(src, dev_rel), os.path.join(src, ho_rel)
    dev = json.load(open(os.path.join(dev_dir, 'meta.json')))
    ho = json.load(open(os.path.join(ho_dir, 'meta.json')))
    # the corpus is shared
    assert dev['ids'] == ho['ids'] and dev['chunkDoc'] == ho['chunkDoc'], f'{name}: dev and held-out corpora differ'
    assert dev['dim'] == DIM and len(set(dev['ids'])) == len(dev['ids'])
    dev_corpus, ho_corpus = os.path.join(dev_dir, 'corpus768.bin'), os.path.join(ho_dir, 'corpus768.bin')
    sha_dev, sha_ho = sha256_cached(dev_corpus), sha256_cached(ho_corpus)
    assert sha_dev == sha_ho, f'{name}: dev and held-out vector files differ (sha256)'
    n = len(dev['ids'])
    assert os.path.getsize(ho_corpus) == n * DIM * 4, f'{name}: vector file size does not match ids'

    out = os.path.join(data, 'sets', name)
    os.makedirs(out, exist_ok=True)
    seen, vec_path = write_vectors(out, dev['ids'], dev['chunkDoc'])
    vid_of_doc = seen

    rows, langs = [], {'dev': {}, 'ho': {}}
    clusters = {'dev': set(), 'ho': set()}
    for split, m in (('dev', dev), ('ho', ho)):
        for q in m['queries']:
            assert len(q['gold']) == 1 and q['gold'][0] in vid_of_doc, f'{name}: gold not in corpus'
            vid = vid_of_doc[q['gold'][0]]
            cl = repo_of(vid)
            lang = vid.split('/')[0]
            langs[split][lang] = langs[split].get(lang, 0) + 1
            clusters[split].add(cl)
            rows.append({'qid': q['id'], 'text': q['text'], 'split': split, 'rel': {q['gold'][0]: 1}, 'cluster': cl})
    check_counts(name, rows)
    dev_ids = {r['qid'] for r in rows if r['split'] == 'dev'}
    ho_ids = {r['qid'] for r in rows if r['split'] == 'ho'}
    assert not (dev_ids & ho_ids), f'{name}: a query id is in both splits'
    dev_gold = {next(iter(r['rel'])) for r in rows if r['split'] == 'dev'}
    ho_gold = {next(iter(r['rel'])) for r in rows if r['split'] == 'ho'}
    assert not (dev_gold & ho_gold), f'{name}: a gold document is in both splits'
    n_dev, n_ho = len(dev_ids), len(ho_ids)
    assert all(v == 600 for v in langs['dev'].values()) and all(v == 400 for v in langs['ho'].values()) \
        and len(langs['dev']) == len(langs['ho']) == 6, f'{name}: per-language 600/400 broken: {langs}'
    q_path = write_queries(out, rows)
    dev_texts = {r['text'] for r in rows if r['split'] == 'dev'}
    shared_text = sum(1 for r in rows if r['split'] == 'ho' and r['text'] in dev_texts)
    meta = {
        'name': name, 'kind': 'code', 'n_vectors': n, 'n_docs': len(seen),
        'n_queries': {'dev': n_dev, 'ho': n_ho},
        'membership_sha256': None, 'queries_sha256': None,
        'split': {'seed': SEED, 'dev': DEV_FRAC, 'stratify': 'language',
                  'source': 'existing GenCodeSearchNet split, kept exactly: 600 dev + 400 held-out queries per '
                            'language (6 languages); read from the v4 set dirs ' + dev_rel + ' / ' + ho_rel},
        'self_match': False, 'previously_examined': True, 'k_v': None,
        'cluster': 'source repository = first two path parts of the vector key of the gold document '
                   '(<lang>/<owner_repo>)',
        'clusters': {'dev': len(clusters['dev']), 'ho': len(clusters['ho']),
                     'shared': len(clusters['dev'] & clusters['ho'])},
        'per_language': {'dev': langs['dev'], 'ho': langs['ho']},
        'distractor_vectors': sum(1 for d in dev['chunkDoc'] if not d),
        'notes': [f'{shared_text} held-out query texts also occur (as text) among the dev queries, with different '
                  'query ids and different gold documents'],
        'source_files': {'vectors_sha256': sha_ho, 'dev_dir': dev_dir, 'ho_dir': ho_dir},
    }
    finish_set(out, meta, vec_path, q_path)
    if with_emb:
        emb_code_set(name, data, dev_dir, ho_dir, ho_corpus, rows, dev, ho, meta, sha_ho)
    return meta


def emb_code_set(name, data, dev_dir, ho_dir, corpus_path, rows, dev, ho, meta, sha_corpus):
    out = os.path.join(data, 'emb', 'CodeRankEmbed', name)
    os.makedirs(out, exist_ok=True)
    link = os.path.join(out, 'corpus.f32')
    target = os.path.realpath(corpus_path)
    if os.path.islink(link) or os.path.exists(link):
        os.remove(link)
    os.symlink(target, link)
    qd = read_rows(os.path.join(dev_dir, 'q768.bin'), list(range(len(dev['queries']))))
    qh = read_rows(os.path.join(ho_dir, 'q768.bin'), list(range(len(ho['queries']))))
    assert os.path.getsize(os.path.join(dev_dir, 'q768.bin')) == len(dev['queries']) * DIM * 4
    assert os.path.getsize(os.path.join(ho_dir, 'q768.bin')) == len(ho['queries']) * DIM * 4
    q = np.concatenate([qd, qh], axis=0)  # queries.jsonl order = dev rows, then held-out rows
    assert q.shape[0] == len(rows) and np.isfinite(q).all()
    qpath = os.path.join(out, 'queries.f32')
    q.astype('<f4').tofile(qpath)
    qn = np.linalg.norm(q.astype(np.float64), axis=1)
    cs = vec_stats(target)
    model = {
        'model': 'CodeRankEmbed', 'hf_id': 'nomic-ai/CodeRankEmbed', 'revision': None, 'tokenizer_revision': None,
        'query_prefix': 'Represent this query for searching relevant code: ', 'doc_prefix': '',
        'pooling': 'mean', 'max_length': 512, 'inference_precision': 'product path (see provenance)',
        'normalised': True, 'dim': DIM, 'stored_precision': 'float32', 'our_f16_rounding': 'nearest-even',
        'code_width': 512, 'int8_width': 512,
        'embedder': {'script': 'existing product vectors, not produced by paper/embed.py',
                     'sha256': None, 'machine': 'Mac (M3 Max) native Metal/CoreML for the GCSN/AdvTest/repo vectors '
                     'and the 1M distractors', 'torch': None},
        'corpus_sha256': sha_corpus, 'queries_sha256': sha256_file(qpath),
        'provenance': {
            'corpus': 'vectors of the product index (codebase.db embedding blobs) and, for csn1m, '
                      'scale1m/embed.mjs (nativeEmbed, maxLength 512, CoreML cascade); never recomputed here',
            'queries': 'eval/benchmarks/hnsw-rivals/export2.mjs: getBinaryEmbedding(query) of the product '
                       '(first 768 floats of the float output). Measured on the Mac (2026-10-15): this call reproduces 16 '
                       'stored GCSN queries to cosine 1.000000 (product query path, ORT INT8 CPU model); a fp32 Hugging '
                       'Face CodeRankEmbed (mean pooling, query prefix) agrees with them to cosine 0.961 min / 0.969 median',
            'documents': 'the product index vectors come from the native Metal / CoreML path: a fp32 Hugging Face '
                         'CodeRankEmbed with MEAN pooling (the product pools by mean; the model card says cls) agrees '
                         'with 16 stored GCSN document vectors to cosine 0.99969 min / 0.99975 median',
            'corpus_file': os.path.realpath(corpus_path),
            'queries_dirs': [dev_dir, ho_dir],
            'queries_row_order': 'dev rows (dev meta order), then held-out rows (held-out meta order) = queries.jsonl order',
        },
        'corpus_stats': cs,
        'queries_stats': {'rows': int(q.shape[0]), 'finite': True, 'norm_min': float(qn.min()), 'norm_max': float(qn.max())},
        'text_reproduction': 'see DATA/sets/<set>/texts.json (written by texts.py)',
    }
    write_json(os.path.join(out, 'model.json'), model)
    print(f"    emb CodeRankEmbed/{name}: corpus -> {target} rows {cs['rows']} norm [{cs['norm_min']:.4f},{cs['norm_max']:.4f}]; "
          f"queries {q.shape[0]} norm [{qn.min():.4f},{qn.max():.4f}]")


# ------------------------------------------------------------------------------------------------ AdvTest
def build_advtest(data, src):
    d = os.path.join(src, 'advtest')
    meta_in = json.load(open(os.path.join(d, 'meta.json')))
    assert meta_in['dim'] == DIM
    n = len(meta_in['ids'])
    corpus = os.path.join(d, 'corpus768.bin')
    assert os.path.getsize(corpus) == n * DIM * 4
    sha_corpus = sha256_cached(corpus)
    out = os.path.join(data, 'sets', 'advtest')
    os.makedirs(out, exist_ok=True)
    seen, vec_path = write_vectors(out, meta_in['ids'], meta_in['chunkDoc'])
    qs = meta_in['queries']
    dev_ids, ho_ids = split_ids([q['id'] for q in qs])
    assert os.path.getsize(os.path.join(d, 'q768.bin')) == len(qs) * DIM * 4
    order = [i for i, q in enumerate(qs) if q['id'] in dev_ids] + [i for i, q in enumerate(qs) if q['id'] in ho_ids]
    rows = []
    for i in order:
        q = qs[i]
        assert len(q['gold']) == 1 and q['gold'][0] in seen
        rows.append({'qid': q['id'], 'text': q['text'], 'split': 'dev' if q['id'] in dev_ids else 'ho',
                     'rel': {q['gold'][0]: 1}, 'cluster': q['id']})
    check_counts('advtest', rows)
    gold_dev = {next(iter(r['rel'])) for r in rows if r['split'] == 'dev'}
    gold_ho = {next(iter(r['rel'])) for r in rows if r['split'] == 'ho'}
    q_path = write_queries(out, rows)
    meta = {
        'name': 'advtest', 'kind': 'code', 'n_vectors': n, 'n_docs': len(seen),
        'n_queries': {'dev': len(dev_ids), 'ho': len(ho_ids)},
        'membership_sha256': None, 'queries_sha256': None,
        'split': {'seed': SEED, 'dev': DEV_FRAC, 'stratify': None,
                  'source': 'NEW split of the 3,000 CodeXGLUE AdvTest queries of the v4 set dir advtest. Method: query ids '
                            'sorted ascending (str order); Fisher-Yates shuffle with random.Random(42).random() '
                            '(i = n-1..1, j = floor(random()*(i+1))); the first round(0.6*3000) = 1800 ids are dev, '
                            'the other 1200 held-out. No stratification (one language, no repository field). '
                            'queries.jsonl: dev rows then held-out rows, each in source order.'},
        'self_match': False, 'previously_examined': True, 'k_v': None,
        'cluster': 'AdvTest has no repository information (every vector key says python/unknown): each query is its '
                   'own cluster (cluster = query id), as for BEIR',
        'distractor_vectors': sum(1 for x in meta_in['chunkDoc'] if not x),
        'notes': [f'{len(gold_dev & gold_ho)} gold documents are gold of queries in both splits'],
        'source_files': {'vectors_sha256': sha_corpus, 'src_dir': d},
    }
    finish_set(out, meta, vec_path, q_path)
    # emb/CodeRankEmbed: queries re-ordered into queries.jsonl order
    eo = os.path.join(data, 'emb', 'CodeRankEmbed', 'advtest')
    os.makedirs(eo, exist_ok=True)
    link = os.path.join(eo, 'corpus.f32')
    if os.path.islink(link) or os.path.exists(link):
        os.remove(link)
    os.symlink(os.path.realpath(corpus), link)
    q = read_rows(os.path.join(d, 'q768.bin'), order)
    assert q.shape[0] == len(rows) and np.isfinite(q).all()
    qpath = os.path.join(eo, 'queries.f32')
    q.astype('<f4').tofile(qpath)
    qn = np.linalg.norm(q.astype(np.float64), axis=1)
    cs = vec_stats(corpus)
    model = {
        'model': 'CodeRankEmbed', 'hf_id': 'nomic-ai/CodeRankEmbed', 'revision': None, 'tokenizer_revision': None,
        'query_prefix': 'Represent this query for searching relevant code: ', 'doc_prefix': '', 'pooling': 'mean',
        'max_length': 512, 'inference_precision': 'product path (see provenance)', 'normalised': True, 'dim': DIM,
        'stored_precision': 'float32', 'our_f16_rounding': 'nearest-even', 'code_width': 512, 'int8_width': 512,
        'embedder': {'script': 'existing product vectors, not produced by paper/embed.py', 'sha256': None,
                     'machine': 'Mac (M3 Max) native Metal/CoreML', 'torch': None},
        'corpus_sha256': sha_corpus, 'queries_sha256': sha256_file(qpath),
        'provenance': {'corpus': 'codebase.db embedding blobs of eval/corpus/advtest (product indexer), never recomputed here',
                       'queries': 'export2.mjs getBinaryEmbedding(query)', 'corpus_file': os.path.realpath(corpus),
                       'queries_dirs': [d], 'queries_row_order': 'source q768 rows re-ordered into queries.jsonl order'},
        'corpus_stats': cs, 'queries_stats': {'rows': int(q.shape[0]), 'finite': True, 'norm_min': float(qn.min()), 'norm_max': float(qn.max())},
        'text_reproduction': 'see DATA/sets/<set>/texts.json (written by texts.py)',
    }
    write_json(os.path.join(eo, 'model.json'), model)
    print(f"    emb CodeRankEmbed/advtest: queries {q.shape[0]} norm [{qn.min():.4f},{qn.max():.4f}]")


# ------------------------------------------------------------------------------------------------- BEIR
def beir_zip(raw, name):
    zp = os.path.join(raw, name + '.zip')
    if not os.path.exists(zp):
        import urllib.request
        os.makedirs(raw, exist_ok=True)
        with urllib.request.urlopen(BEIR_URL.format(name)) as r, open(zp + '.part', 'wb') as f:
            while True:
                b = r.read(1 << 20)
                if not b:
                    break
                f.write(b)
        os.replace(zp + '.part', zp)
    return zp


def build_beir(name, data, raw):
    zp = beir_zip(raw, name)
    z = zipfile.ZipFile(zp)
    corpus_ids = []
    with z.open(f'{name}/corpus.jsonl') as f:
        for line in f:
            corpus_ids.append(json.loads(line)['_id'])
    assert len(corpus_ids) == len(set(corpus_ids))
    cid = set(corpus_ids)
    queries = {}
    with z.open(f'{name}/queries.jsonl') as f:
        for line in f:
            o = json.loads(line)
            queries[o['_id']] = o['text']
    qrels, order = {}, []
    with z.open(f'{name}/qrels/test.tsv') as f:
        next(f)  # header: query-id corpus-id score
        for line in f:
            qid, did, score = line.decode('utf-8').rstrip('\n').split('\t')
            if qid not in qrels:
                qrels[qid] = {}
                order.append(qid)
            assert did in cid, f'{name}: qrel document {did} not in corpus'
            qrels[qid][did] = int(score)
    assert all(q in queries for q in order)
    dev_ids, ho_ids = split_ids(order)
    ordered = [q for q in order if q in dev_ids] + [q for q in order if q in ho_ids]
    rows = [{'qid': q, 'text': queries[q], 'split': 'dev' if q in dev_ids else 'ho', 'rel': qrels[q], 'cluster': q}
            for q in ordered]
    check_counts(name, rows)
    out = os.path.join(data, 'sets', name)
    os.makedirs(out, exist_ok=True)
    vec_path = os.path.join(out, 'vectors.jsonl')
    with open(vec_path, 'w', encoding='utf-8') as f:
        for d in corpus_ids:
            f.write(jl({'vid': d, 'doc': d}) + '\n')
    q_path = write_queries(out, rows)
    n_zero = sum(1 for r in rows for v in r['rel'].values() if v == 0)
    meta = {
        'name': name, 'kind': 'beir', 'n_vectors': len(corpus_ids), 'n_docs': len(corpus_ids),
        'n_queries': {'dev': len(dev_ids), 'ho': len(ho_ids)},
        'membership_sha256': None, 'queries_sha256': None,
        'split': {'seed': SEED, 'dev': DEV_FRAC, 'stratify': None,
                  'source': f'NEW split of the {len(order)} BEIR test queries (qrels/test.tsv order = source order). '
                            'Method: query ids sorted ascending (str order); Fisher-Yates shuffle with '
                            f'random.Random(42).random() (i = n-1..1, j = floor(random()*(i+1))); the first '
                            f'round(0.6*{len(order)}) = {len(dev_ids)} ids are dev, the other {len(ho_ids)} held-out. '
                            'queries.jsonl: dev rows then held-out rows, each in qrels order. No stratification.'},
        'self_match': name == 'quora', 'previously_examined': False, 'k_v': None,
        'cluster': 'query id (each query is its own cluster)',
        'beir': {'url': BEIR_URL.format(name), 'zip_sha256': sha256_file(zp), 'zip_bytes': os.path.getsize(zp),
                 'qrels': 'test.tsv as given; rel = score as given (all entries kept, incl. score 0: ' + str(n_zero) + ' entries)',
                 'doc_text': 'title + " " + text, stripped (BEIR sentence-transformers convention); written to texts.jsonl by texts.py'},
    }
    hdr = os.path.join(raw, name + '.hdr')
    if os.path.exists(hdr):
        for line in open(hdr, errors='replace'):
            k = line.split(':', 1)[0].strip().lower()
            if k in ('last-modified', 'etag'):
                meta['beir'][k.replace('-', '_')] = line.split(':', 1)[1].strip()
    finish_set(out, meta, vec_path, q_path)
    return meta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', required=True)
    ap.add_argument('--src', default='/root/hnsw-x86/sets')
    ap.add_argument('--raw', default=None, help='BEIR zip directory (default DATA/raw)')
    ap.add_argument('--sets', default=','.join(ALL_SETS))
    ap.add_argument('--no-emb', action='store_true', help='skip DATA/emb/CodeRankEmbed')
    a = ap.parse_args()
    raw = a.raw or os.path.join(a.data, 'raw')
    for s in a.sets.split(','):
        print(f'== {s}')
        if s in CODE_SETS:
            build_code_set(s, a.data, a.src, with_emb=not a.no_emb)
        elif s == 'advtest':
            build_advtest(a.data, a.src)
        elif s in ('quora', 'fiqa'):
            build_beir(s, a.data, raw)
        else:
            sys.exit(f'unknown set {s}')


if __name__ == '__main__':
    main()
