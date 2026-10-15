#!/usr/bin/env python
# Builds replay sets from BEIR test queries: BM25 candidates (bm25s), PyLate ColBERT token
# vectors on CPU, doc tokens quantized with the production int4 quantizer (quantize_int4.py).
# Runs on a cloud machine later. Use the venv from requirements-prep.in, not venv/.
#
#   python beir_prep.py --out DIR [--datasets scifact,nfcorpus] [--fiqa] [--models answersmall,colbertv2]
#                       [--limit-queries N] [--limit-docs N] [--threads T]
#   python beir_prep.py --out DIR --check
#
# This script computes no retrieval-quality metric (no nDCG, no recall) and prints no timing.
import argparse, glob, hashlib, io, json, os, re, sys, unicodedata, zipfile
import urllib.request
from importlib import metadata

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from quantize_int4 import quantize_int4_per_token  # noqa: E402
from replay_py import load_set  # noqa: E402

SEED = 42
KS = (10, 25, 50, 100, 200)
TOP = 200
BEIR_URL = 'https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/{}.zip'
DATASETS = {'scifact': 300, 'nfcorpus': 323, 'fiqa': 648}  # expected test query counts
MODELS = {
    'answersmall': dict(id='answerdotai/answerai-colbert-small-v1', dim=96),
    'colbertv2': dict(id='colbert-ir/colbertv2.0', dim=128),
}
ROTATION_ANSWER = (
    'Rotation off: tokens are not rotated. The production index builder sets whtSeed from '
    'SWEET_SEARCH_LI_WHT_SEED with default 0 (core/indexing/indexer-ann.js:336,344), and the '
    'LateInteractionIndex constructor default is 0 (core/ranking/late-interaction-index.js:419). '
    'Rotation of documents (add, line 654) and queries (scoreWithLateInteraction, line 1862) runs only '
    'when whtSeed > 0.'
)


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def norm_query(s):
    s = unicodedata.normalize('NFC', s).strip()
    return re.sub(r'\s+', ' ', s)


def lib_versions():
    out = {}
    for n in ('pylate', 'torch', 'bm25s', 'numpy', 'transformers', 'sentence-transformers', 'datasets'):
        try:
            out[n] = metadata.version(n)
        except metadata.PackageNotFoundError:
            out[n] = None
    return out


# ---------- data ----------
def fetch_beir(name, cache):
    os.makedirs(cache, exist_ok=True)
    zp = os.path.join(cache, f'{name}.zip')
    info = {'url': BEIR_URL.format(name)}
    if not os.path.exists(zp):
        with urllib.request.urlopen(info['url']) as r, open(zp + '.part', 'wb') as f:
            info['last_modified'] = r.headers.get('Last-Modified')
            info['etag'] = r.headers.get('ETag')
            while True:
                b = r.read(1 << 20)
                if not b:
                    break
                f.write(b)
        os.replace(zp + '.part', zp)
    info['zip_sha256'] = sha256_file(zp)
    info['zip_bytes'] = os.path.getsize(zp)
    z = zipfile.ZipFile(zp)
    corpus = []
    for line in io.TextIOWrapper(z.open(f'{name}/corpus.jsonl'), encoding='utf-8'):
        d = json.loads(line)
        title = (d.get('title') or '').strip()
        text = (d.get('text') or '').strip()
        corpus.append((str(d['_id']), (title + ' ' + text).strip()))  # title + text
    qtext = {}
    for line in io.TextIOWrapper(z.open(f'{name}/queries.jsonl'), encoding='utf-8'):
        d = json.loads(line)
        qtext[str(d['_id'])] = d['text']
    qrels = []  # test split only
    for i, line in enumerate(io.TextIOWrapper(z.open(f'{name}/qrels/test.tsv'), encoding='utf-8')):
        p = line.rstrip('\n').split('\t')
        if i == 0 and not p[2].lstrip('-').isdigit():
            continue
        qrels.append((p[0], p[1], int(p[2])))
    qids = []
    for q, _, _ in qrels:
        if q not in qids and q in qtext:
            qids.append(q)
    return corpus, qids, qtext, qrels, info


# ---------- BM25 ----------
def bm25_top(corpus_texts, query_texts, k):
    import bm25s
    tok = bm25s.tokenize(corpus_texts, stopwords='en', show_progress=False)
    r = bm25s.BM25()
    r.index(tok, show_progress=False)
    qt = bm25s.tokenize(query_texts, stopwords='en', show_progress=False)
    k = min(k, len(corpus_texts))
    idx, sc = r.retrieve(qt, k=k, show_progress=False, n_threads=1)
    return idx, sc


# ---------- model ----------
def load_model(key, threads):
    import torch
    from huggingface_hub import snapshot_download
    from pylate import models
    torch.set_num_threads(threads)
    spec = MODELS[key]
    path = snapshot_download(spec['id'])
    revision = os.path.basename(path.rstrip('/'))  # snapshot dir name is the commit hash
    try:
        m = models.ColBERT(model_name_or_path=spec['id'], device='cpu', revision=revision)
    except TypeError:
        m = models.ColBERT(model_name_or_path=spec['id'], device='cpu')
    return m, revision


def encode(model, texts, is_query, batch=32):
    out = model.encode(texts, is_query=is_query, batch_size=batch, show_progress_bar=False)
    arrs = []
    for a in out:
        if hasattr(a, 'detach'):
            a = a.detach().cpu().numpy()
        arrs.append(np.ascontiguousarray(np.asarray(a, dtype=np.float32)))
    return arrs


def pack(arrs, dim):
    off = np.zeros(len(arrs) + 1, np.int64)
    for i, a in enumerate(arrs):
        assert a.ndim == 2 and a.shape[1] == dim, (a.shape, dim)
        off[i + 1] = off[i] + a.shape[0]
    flat = np.concatenate(arrs) if arrs else np.zeros((0, dim), np.float32)
    return flat, off


# ---------- build ----------
def build(args):
    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)
    cache = args.cache or os.path.join(out, '_cache')
    names = [d for d in args.datasets.split(',') if d]
    if args.fiqa and 'fiqa' not in names:
        names.append('fiqa')
    if 'fiqa' in names and not args.fiqa:
        sys.exit('fiqa needs the --fiqa flag')
    mkeys = [m for m in args.models.split(',') if m]
    for m in mkeys:
        if m not in MODELS:
            sys.exit(f'unknown model {m}')
    manifest = {
        'seed': SEED, 'ks': list(KS), 'bm25_top': TOP,
        'rotation': ROTATION_ANSWER,
        'limits': {'queries': args.limit_queries, 'docs': args.limit_docs},
        'libraries': lib_versions(), 'datasets': {}, 'models': {}, 'counts': {},
        'notes': ['doc text = title + " " + text', 'query text as given by BEIR queries.jsonl',
                  'query tokens raw float32 as PyLate returns them (default query length and expansion)',
                  'doc tokens quantized by quantize_int4.py; nr = float norm before quantization'],
    }
    loaded = {}
    for ds in names:
        corpus, qids, qtext, qrels, info = fetch_beir(ds, cache)
        total_q = len(qids)
        if args.limit_docs:
            corpus = corpus[:args.limit_docs]
        if args.limit_queries:
            qids = qids[:args.limit_queries]
        info.update(n_corpus_used=len(corpus), n_queries_test=total_q, n_queries_used=len(qids),
                    expected_queries=DATASETS[ds], split='test')
        if not args.limit_queries and total_q != DATASETS[ds]:
            print(f'WARNING {ds}: {total_q} test queries, expected {DATASETS[ds]}')
        manifest['datasets'][ds] = info
        qs = set(qids)
        used_rels = [r for r in qrels if r[0] in qs]
        idx, sc = bm25_top([t for _, t in corpus], [qtext[q] for q in qids], TOP)
        bm25 = {q: [[corpus[int(j)][0], float(s)] for j, s in zip(idx[i], sc[i])] for i, q in enumerate(qids)}
        loaded[ds] = dict(corpus=corpus, qids=qids, qtext=qtext, rels=used_rels, bm25=bm25, idx=idx)
        print(f'{ds}: {len(corpus)} docs, {len(qids)} queries, BM25 top {idx.shape[1]}')

    for mk in mkeys:
        model, rev = load_model(mk, args.threads)
        spec = MODELS[mk]
        manifest['models'][mk] = dict(id=spec['id'], revision=rev, dim=spec['dim'],
                                      query_length=getattr(model, 'query_length', None),
                                      document_length=getattr(model, 'document_length', None))
        for ds in names:
            L = loaded[ds]
            corpus, qids = L['corpus'], L['qids']
            ktop = L['idx'].shape[1]
            need = sorted({int(j) for row in L['idx'] for j in row})
            dim = spec['dim']
            print(f'{ds} x {mk}: encoding {len(need)} docs, {len(qids)} queries')
            dt = encode(model, [corpus[j][1] for j in need], False)
            qt = encode(model, [L['qtext'][q] for q in qids], True)
            dflat, doff = pack(dt, dim)
            qflat, qoff = pack(qt, dim)
            rd = os.path.join(out, 'raw', f'{ds}-{mk}')
            os.makedirs(rd, exist_ok=True)
            np.save(os.path.join(rd, 'doc_tokens.npy'), dflat)
            np.save(os.path.join(rd, 'doc_offsets.npy'), doff)
            np.save(os.path.join(rd, 'query_tokens.npy'), qflat)
            np.save(os.path.join(rd, 'query_offsets.npy'), qoff)
            json.dump([corpus[j][0] for j in need], open(os.path.join(rd, 'doc_ids.json'), 'w'))
            json.dump(qids, open(os.path.join(rd, 'query_ids.json'), 'w'))
            json.dump(L['bm25'], open(os.path.join(rd, 'bm25.json'), 'w'))
            with open(os.path.join(rd, 'qrels.tsv'), 'w') as f:
                f.write('query-id\tcorpus-id\tscore\n')
                for q, d, s in L['rels']:
                    f.write(f'{q}\t{d}\t{s}\n')
            # quantize each doc once; payload = raw | mn | sc | nr, the per-candidate layout
            pos = {j: i for i, j in enumerate(need)}
            payload = []
            for a in dt:
                raw, mn, scl, nr = quantize_int4_per_token(a)
                payload.append((a.shape[0], raw.tobytes() + mn.tobytes() + scl.tobytes() + nr.tobytes(), raw.shape[1] * a.shape[0]))
            nq_tok = int(qoff[1] - qoff[0]) if len(qids) else 0
            manifest['counts'][f'{ds}-{mk}'] = dict(queries=len(qids), docs_encoded=len(need), doc_tokens=int(doff[-1]),
                                                    query_tokens_per_query=nq_tok, bm25_depth=ktop)
            for k in KS:
                if k > ktop:
                    print(f'  skip k={k} (only {ktop} candidates)')
                    continue
                sd = os.path.join(out, 'sets', f'beir-{ds}-{mk}-k{k}', ds)
                os.makedirs(sd, exist_ok=True)
                with open(os.path.join(sd, 'index-beir.jsonl'), 'w') as ix, open(os.path.join(sd, 'provenance.jsonl'), 'w') as pv:
                    for qi, q in enumerate(qids):
                        qa = qt[qi]
                        fn = f'call-{qi:05d}.bin'
                        parts = [qa.tobytes()]
                        cands = []
                        for j in L['idx'][qi][:k]:
                            nt, pl, tb = payload[pos[int(j)]]
                            parts.append(pl)
                            cands.append({'nt': nt, 'dim': dim, 'tb': tb})
                        open(os.path.join(sd, fn), 'wb').write(b''.join(parts))
                        ix.write(json.dumps({'file': fn, 'kind': 'int4', 'numQ': int(qa.shape[0]), 'dim': dim, 'cands': cands, 'scores': []}) + '\n')
                        pv.write(json.dumps({'file': fn, 'repo': ds, 'query_id': q,
                                             'query_sha256': hashlib.sha256(norm_query(L['qtext'][q]).encode('utf-8')).hexdigest(),
                                             'source_task': ds}) + '\n')
    # hashes of every output file (the download cache is not part of the output)
    files = {}
    for root, _, fs in os.walk(out):
        if os.path.abspath(root).startswith(os.path.abspath(cache)):
            continue
        for f in fs:
            p = os.path.join(root, f)
            rel = os.path.relpath(p, out)
            if rel != 'MANIFEST.json':
                files[rel] = sha256_file(p)
    manifest['files_sha256'] = dict(sorted(files.items()))
    json.dump(manifest, open(os.path.join(out, 'MANIFEST.json'), 'w'), indent=1)
    print(f'wrote {len(files)} files and MANIFEST.json')


# ---------- check ----------
def decode_call_cand(c, dim):
    """float64 decoded doc tokens from a loaded candidate, written out with explicit loops over nibbles."""
    nt, ps = c['nt'], (dim + 1) // 2
    raw = np.asarray(c['raw']).reshape(nt, ps)
    d = np.zeros((nt, dim), np.float64)
    for j in range(dim):
        byte = raw[:, j // 2].astype(np.int64)
        nib = (byte & 15) if j % 2 == 0 else (byte >> 4)
        d[:, j] = nib * c['sc'].astype(np.float64) + c['mn'].astype(np.float64)
    return d


def score_loop(q, cands, dim):
    q64 = q.astype(np.float64)
    qn = np.sqrt((q64 ** 2).sum(1))
    out = []
    for c in cands:
        d = decode_call_cand(c, dim)
        n = c['nr'].astype(np.float64)
        tot = 0.0
        for i in range(q64.shape[0]):
            best = -np.inf
            for t in range(d.shape[0]):
                best = max(best, float(np.dot(q64[i], d[t])) / (qn[i] * n[t] + 1e-8))
            tot += max(0.0, best)
        out.append(tot / q64.shape[0])
    return np.array(out)


def score_matrix(q, docs_f32):
    q64 = q.astype(np.float64)
    qn = np.sqrt((q64 ** 2).sum(1))
    out = []
    for a in docs_f32:
        raw, mn, sc, nr = quantize_int4_per_token(a)
        nt, dim = a.shape
        lo = (raw & 15).astype(np.float64)
        hi = (raw >> 4).astype(np.float64)
        nib = np.empty((nt, raw.shape[1] * 2))
        nib[:, 0::2], nib[:, 1::2] = lo, hi
        d = nib[:, :dim] * sc.astype(np.float64)[:, None] + mn.astype(np.float64)[:, None]
        s = (q64 @ d.T) / (qn[:, None] * nr.astype(np.float64)[None, :] + 1e-8)
        out.append(np.maximum(s.max(1), 0.0).mean())
    return np.array(out)


def check(args):
    out = os.path.abspath(args.out)
    sets = sorted(glob.glob(os.path.join(out, 'sets', 'beir-*')))
    if not sets:
        sys.exit('no sets found')
    first = None
    for s in sets:
        calls = load_set(s)
        ncand = sum(len(c['cands']) for c in calls)
        print(f'{os.path.basename(s)}: {len(calls)} calls, {ncand} candidates read')
        if first is None:
            first = (s, calls)
    s, calls = first
    m = re.match(r'beir-(.+)-(answersmall|colbertv2)-k(\d+)$', os.path.basename(s))
    ds, mk, k = m.group(1), m.group(2), int(m.group(3))
    rd = os.path.join(out, 'raw', f'{ds}-{mk}')
    dflat, doff = np.load(os.path.join(rd, 'doc_tokens.npy')), np.load(os.path.join(rd, 'doc_offsets.npy'))
    qflat, qoff = np.load(os.path.join(rd, 'query_tokens.npy')), np.load(os.path.join(rd, 'query_offsets.npy'))
    docpos = {d: i for i, d in enumerate(json.load(open(os.path.join(rd, 'doc_ids.json'))))}
    qpos = {q: i for i, q in enumerate(json.load(open(os.path.join(rd, 'query_ids.json'))))}
    bm25 = json.load(open(os.path.join(rd, 'bm25.json')))
    prov = {}
    for line in open(os.path.join(s, ds, 'provenance.jsonl')):
        p = json.loads(line)
        prov[p['file']] = p
    rng = np.random.default_rng(SEED)
    pick = rng.choice(len(calls), size=min(20, len(calls)), replace=False)
    maxerr, agree = 0.0, 0
    for ci in pick:
        c = calls[ci]
        qid = prov[c['file']]['query_id']
        qi = qpos[qid]
        q = qflat[qoff[qi]:qoff[qi + 1]]
        assert np.array_equal(q, c['q']), 'query differs from the .npy copy'
        ids = [d for d, _ in bm25[qid][:k]]
        assert len(ids) == len(c['cands'])
        docs = [dflat[doff[docpos[d]]:doff[docpos[d] + 1]] for d in ids]
        a = score_loop(c['q'], c['cands'], c['dim'])
        b = score_matrix(q, docs)
        maxerr = max(maxerr, float(np.abs(a - b).max()))
        agree += int(np.argmax(a) == np.argmax(b))
    print(f'check on {os.path.basename(s)}: {len(pick)} calls, max abs score error {maxerr:.3e}, top-1 agreement {agree}/{len(pick)}')
    sys.exit(0 if maxerr < 1e-9 and agree == len(pick) else 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--cache', help='download cache dir (default OUT/_cache; not hashed)')
    ap.add_argument('--datasets', default='scifact,nfcorpus')
    ap.add_argument('--fiqa', action='store_true', help='also build FiQA-2018')
    ap.add_argument('--models', default='answersmall,colbertv2')
    ap.add_argument('--limit-queries', type=int, default=0)
    ap.add_argument('--limit-docs', type=int, default=0)
    ap.add_argument('--threads', type=int, default=os.cpu_count() or 1)
    ap.add_argument('--check', action='store_true')
    args = ap.parse_args()
    check(args) if args.check else build(args)


if __name__ == '__main__':
    main()
