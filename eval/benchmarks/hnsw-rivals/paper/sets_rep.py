#!/usr/bin/env python
"""Replication sets (REPLICATION_PLAN.md): two BEIR sets that no earlier step of this study used.

    python sets_rep.py --data DATA [--sets cqadup,msmarco1m]

cqadup       CQADupStack, all 12 subforums merged into one corpus (BEIR zip `cqadupstack`); vector and query ids
             are "<forum>/<id>" so they stay unique; qrels/test.tsv of every forum; relevance only within a forum.
msmarco1m  MS MARCO passages (BEIR zip `msmarco`), dev queries (qrels/dev.tsv, the BEIR test split of MS MARCO);
             corpus = every passage judged for a dev query + a uniform random sample of the other passages
             (seeded Fisher-Yates over the sorted passage ids, seed 42) up to 1,000,000 passages, in corpus.jsonl order.
Both: one vector per document; split 60/40 seed 42 over query ids (sets.split_ids); cluster = query id;
texts.jsonl = title + " " + text, stripped (the BEIR convention of texts.py).
"""
import argparse, json, os, sys, zipfile

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import sets as S  # noqa: E402

N_MSMARCO = 1_000_000


def emit(name, data, raw, zipname, corpus_ids, texts, queries, qrels, order, extra, strata=None):
    if strata:  # stratified split: sets.split_ids within each stratum (CQADupStack: forum)
        dev_ids, ho_ids = set(), set()
        for g in sorted(set(strata.values())):
            d_, h_ = S.split_ids([q for q in order if strata[q] == g]); dev_ids |= d_; ho_ids |= h_
    else:
        dev_ids, ho_ids = S.split_ids(order)
    selfm = len(set(order) & set(corpus_ids))
    ordered = [q for q in order if q in dev_ids] + [q for q in order if q in ho_ids]
    rows = [{'qid': q, 'text': queries[q], 'split': 'dev' if q in dev_ids else 'ho', 'rel': qrels[q], 'cluster': q} for q in ordered]
    S.check_counts(name, rows)
    out = os.path.join(data, 'sets', name); os.makedirs(out, exist_ok=True)
    vec_path = os.path.join(out, 'vectors.jsonl')
    with open(vec_path, 'w', encoding='utf-8') as f, open(os.path.join(out, 'texts.jsonl'), 'w', encoding='utf-8') as ft:
        for d, t in zip(corpus_ids, texts):
            f.write(S.jl({'vid': d, 'doc': d}) + '\n')
            ft.write(S.jl({'vid': d, 'text': t, 'exact': True, 'src': 'beir'}) + '\n')
    q_path = S.write_queries(out, rows)
    zp = os.path.join(raw, zipname + '.zip') if zipname else None
    meta = {'name': name, 'kind': 'beir', 'n_vectors': len(corpus_ids), 'n_docs': len(corpus_ids),
            'n_queries': {'dev': len(dev_ids), 'ho': len(ho_ids)}, 'membership_sha256': None, 'queries_sha256': None,
            'split': {'seed': S.SEED, 'dev': S.DEV_FRAC, 'stratify': 'forum' if strata else None, 'source': 'sets.split_ids over the query ids (replication set)'},
            'self_match': selfm > 0, 'query_ids_in_corpus': selfm, 'previously_examined': False, 'replication': True, 'k_v': None,
            'cluster': 'query id (each query is its own cluster)',
            'beir': {**({'url': S.BEIR_URL.format(zipname), 'zip_sha256': S.sha256_file(zp), 'zip_bytes': os.path.getsize(zp)} if zp else {}),
                     'doc_text': 'title + " " + text, stripped', **extra}}
    S.finish_set(out, meta, vec_path, q_path)


def text_of(o):
    return ((o.get('title') or '') + ' ' + (o.get('text') or '')).strip()


def build_cqadup(data, raw):
    """From the MTEB republication of the BEIR CQADupStack files on Hugging Face (mteb/cqadupstack-<forum>, the
    revisions in raw/cqadupstack-hf/revisions.txt): corpus.jsonl, queries.jsonl, qrels/test.tsv per forum."""
    base = os.path.join(raw, 'cqadupstack-hf')
    revs = dict(l.split() for l in open(os.path.join(base, 'revisions.txt')) if l.strip())
    forums = sorted(revs)
    assert len(forums) == 12, forums
    ids, texts, queries, qrels, order = [], [], {}, {}, []
    for fo in forums:
        for line in open(os.path.join(base, fo, 'corpus.jsonl'), encoding='utf-8'):
            o = json.loads(line); ids.append(f"{fo}/{o['_id']}"); texts.append(text_of(o))
        for line in open(os.path.join(base, fo, 'queries.jsonl'), encoding='utf-8'):
            o = json.loads(line); queries[f"{fo}/{o['_id']}"] = o['text']
        with open(os.path.join(base, fo, 'qrels', 'test.tsv'), encoding='utf-8') as f:
            next(f)
            for line in f:
                q, d, sc = line.rstrip('\n').split('\t')
                q, d = f'{fo}/{q}', f'{fo}/{d}'
                if q not in qrels:
                    qrels[q] = {}; order.append(q)
                qrels[q][d] = int(sc)
    assert len(ids) == len(set(ids))
    cid = set(ids)
    assert all(d in cid for r in qrels.values() for d in r)
    files = {f'{fo}/{x}': S.sha256_file(os.path.join(base, fo, x)) for fo in forums for x in ('corpus.jsonl', 'queries.jsonl', 'qrels/test.tsv')}
    emit('cqadup', data, raw, None, ids, texts, queries, qrels, order,
         {'source': 'huggingface mteb/cqadupstack-<forum> (MTEB copy of the BEIR files)', 'revisions': revs, 'files_sha256': files,
          'qrels': 'qrels/test.tsv of every forum'}, strata={q: q.split('/')[0] for q in order})


def build_msmarco(data, raw):
    z = zipfile.ZipFile(os.path.join(raw, 'msmarco.zip'))
    queries = {}
    with z.open('msmarco/queries.jsonl') as f:
        for line in f:
            o = json.loads(line); queries[o['_id']] = o['text']
    qrels, order = {}, []
    with z.open('msmarco/qrels/dev.tsv') as f:
        next(f)
        for line in f:
            q, d, s = line.decode('utf-8').rstrip('\n').split('\t')
            if q not in qrels:
                qrels[q] = {}; order.append(q)
            qrels[q][d] = int(s)
    judged = {d for r in qrels.values() for d in r}
    all_ids = []
    with z.open('msmarco/corpus.jsonl') as f:
        for line in f:
            all_ids.append(json.loads(line)['_id'])
    others = [d for d in sorted(all_ids) if d not in judged]
    keep = judged | set(S.seeded_shuffle(others)[:N_MSMARCO - len(judged)])
    ids, texts = [], []
    with z.open('msmarco/corpus.jsonl') as f:
        for line in f:
            o = json.loads(line)
            if o['_id'] in keep:
                ids.append(o['_id']); texts.append(text_of(o))
    assert len(ids) == N_MSMARCO and judged <= set(ids)
    emit('msmarco1m', data, raw, 'msmarco', ids, texts, queries, qrels, order,
         {'qrels': 'qrels/dev.tsv (the BEIR test split of MS MARCO)', 'subsample': f'{len(judged)} judged passages + '
          f'{N_MSMARCO - len(judged)} others, seeded Fisher-Yates (seed 42) over the sorted ids of the {len(all_ids)} passages'})


if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--data', required=True); ap.add_argument('--sets', default='cqadup,msmarco1m')
    a = ap.parse_args(); raw = os.path.join(a.data, 'raw')
    for s in a.sets.split(','):
        {'cqadup': build_cqadup, 'msmarco1m': build_msmarco}[s](a.data, raw)
