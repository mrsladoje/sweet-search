# TEST HELPER ONLY. Builds a small DATA tree (set "gcsn", model "CodeRankEmbed") from the v4 Mac
# files ~/.ss-eval/hnsw-bench/gcsn-{dev,ho}. The real sets come from sets.py.
# usage: python _testdata.py [DATA]   (default ~/.ss-eval/hnsw-paper-test)
import hashlib, json, os, shutil, sys

SRC = os.path.expanduser('~/.ss-eval/hnsw-bench')


def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def main(data):
    metas = {s: json.load(open(f'{SRC}/gcsn-{s}/meta.json')) for s in ('dev', 'ho')}
    ids, chunk_doc = metas['dev']['ids'], metas['dev']['chunkDoc']
    assert ids == metas['ho']['ids'] and chunk_doc == metas['ho']['chunkDoc'], 'corpora differ'
    assert sha(f'{SRC}/gcsn-dev/corpus768.bin') == sha(f'{SRC}/gcsn-ho/corpus768.bin')
    sd = f'{data}/sets/gcsn'
    ed = f'{data}/emb/CodeRankEmbed/gcsn'
    os.makedirs(sd, exist_ok=True)
    os.makedirs(ed, exist_ok=True)
    first_vec = {}
    for vid, d in enumerate(chunk_doc):
        first_vec.setdefault(d, vid)
    with open(f'{sd}/vectors.jsonl', 'w') as f:
        for vid, d in zip(ids, chunk_doc):
            f.write(json.dumps({'vid': vid, 'doc': d}) + '\n')
    n_q = {}
    with open(f'{sd}/queries.jsonl', 'w') as f:
        for s in ('dev', 'ho'):
            n_q[s] = len(metas[s]['queries'])
            for q in metas[s]['queries']:
                assert len(q['gold']) == 1
                g = q['gold'][0]
                cluster = '/'.join(ids[first_vec[g]].split('/')[:2])
                f.write(json.dumps({'qid': q['id'], 'text': q['text'], 'split': s,
                                    'rel': {g: 1}, 'cluster': cluster}) + '\n')
    shutil.copyfile(f'{SRC}/gcsn-dev/corpus768.bin', f'{ed}/corpus.f32')
    with open(f'{ed}/queries.f32', 'wb') as out:
        for s in ('dev', 'ho'):
            with open(f'{SRC}/gcsn-{s}/q768.bin', 'rb') as f:
                shutil.copyfileobj(f, out)
    n_docs = len(set(chunk_doc))
    json.dump({'name': 'gcsn', 'kind': 'code', 'n_vectors': len(ids), 'n_docs': n_docs,
               'n_queries': n_q, 'membership_sha256': sha(f'{sd}/vectors.jsonl'),
               'queries_sha256': sha(f'{sd}/queries.jsonl'),
               'split': {'seed': 42, 'dev': 0.6, 'stratify': 'language', 'source': 'v4 gcsn-dev/gcsn-ho'},
               'self_match': False, 'previously_examined': True, 'k_v': None},
              open(f'{sd}/set.json', 'w'), indent=1)
    json.dump({'model': 'CodeRankEmbed', 'dim': 768, 'stored_precision': 'float32', 'normalised': True,
               'corpus_sha256': sha(f'{ed}/corpus.f32'), 'queries_sha256': sha(f'{ed}/queries.f32')},
              open(f'{ed}/model.json', 'w'), indent=1)
    print('wrote', data, len(ids), 'vectors', n_docs, 'docs', n_q)


if __name__ == '__main__':
    main(os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else '~/.ss-eval/hnsw-paper-test'))
