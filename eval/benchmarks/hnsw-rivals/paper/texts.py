#!/usr/bin/env python
"""Write DATA/sets/<set>/texts.jsonl: the text embedded for every vector, in vector-id order.

    python texts.py --data DATA --sets gcsn,d20k,dall,csn1m,advtest [--check 20]      (Mac: needs the repo + sources)
    python texts.py --data DATA --sets quora,fiqa                                      (anywhere: BEIR zips in DATA/raw)

Line: {"vid": "...", "text": "...", "exact": true|false, "src": "chunker|csn|fallback|beir"}
  exact true   the text is the one the product embedded: for chunks, the rebuilt embedding_text hashes to the
               `embedding_input_hash` stored in the index; for 1M distractors, the line of csn_texts.jsonl that
               scale1m/embed.mjs embedded; for BEIR, the BEIR convention title + " " + text (stripped).
  exact false  the text could not be proven to be the embedded one (see texts.json): "chunker" = rebuilt by the
               product chunker but the hash differs; "fallback" = the chunk no longer exists in the rebuilt
               chunk list, text = "# <file>\\n# Language: <lang>\\n<raw chunk text of the DB>" (header guessed).
Queries are not here: their texts are in queries.jsonl.

Code sets: chunk texts come from texts_chunks.mjs (the product's chunkFiles over the index roots, verified by hash).
Index roots (REPO = the sweet-search checkout): GCSN eval/corpus/gencodesearchnet, AdvTest eval/corpus/advtest,
distractor repos eval/repos/<name> (vector key "<name>::<chunk id>"); the 1M distractors (key "csn::...") are lines of
--csn-texts (default ~/.ss-eval/hnsw-1m/csn_texts.jsonl), in file order.

--check N re-embeds N sampled vectors per set with texts_check.mjs (the product's GPU embedding path) and writes the
result into texts.json: over all rows, over the exact rows, over the inexact rows.
"""
import argparse, json, os, subprocess, sys, zipfile
import hashlib

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
CODE_SETS = ['gcsn', 'd20k', 'dall', 'csn1m', 'advtest']
MAC_CORPUS = {  # corpus files of the existing vectors on the Mac (for --check)
    'gcsn': '~/.ss-eval/hnsw-bench/v4/gcsn-ho/corpus768.bin',
    'd20k': '~/.ss-eval/hnsw-bench/v4/d20k-ho/corpus768.bin',
    'dall': '~/.ss-eval/hnsw-bench/v4/dall-ho/corpus768.bin',
    'csn1m': '~/.ss-eval/hnsw-bench/v4/csn1m-ho/corpus768.bin',
    'advtest': '~/.ss-eval/hnsw-bench/v4/advtest/corpus768.bin',
}


def jl(o):
    # ASCII only: raw U+2028 / U+0085 would split a line in some readers (Node readline does)
    return json.dumps(o, ensure_ascii=True, separators=(',', ':'))


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 24), b''):
            h.update(b)
    return h.hexdigest()


def chunk_map(cache_dir, root_name, root_dir, repo):
    """{chunk id: line object} of one index root; runs texts_chunks.mjs when the cache file is missing."""
    cache = os.path.join(cache_dir, root_name.replace('/', '_') + '.jsonl')
    if not os.path.exists(cache):
        os.makedirs(cache_dir, exist_ok=True)
        env = dict(os.environ, SS_REPO=repo)
        r = subprocess.run(['node', os.path.join(HERE, 'texts_chunks.mjs'), root_dir, cache + '.part'],
                           env=env, capture_output=True, text=True)
        if r.returncode != 0:
            sys.exit(f'texts_chunks.mjs failed for {root_dir}:\n{r.stderr[-2000:]}')
        os.replace(cache + '.part', cache)
        open(cache + '.summary.json', 'w').write(r.stderr.strip().splitlines()[-1] + '\n')
    m = {}
    with open(cache, encoding='utf-8') as f:
        for line in f:
            o = json.loads(line)
            m[o['id']] = o
    return m


def build_code_text(name, data, repo, csn_texts, cache_dir):
    vec = [json.loads(l) for l in open(os.path.join(data, 'sets', name, 'vectors.jsonl'), encoding='utf-8')]
    root_of = {}  # root name -> chunk map, loaded on demand
    corpus_root = 'advtest' if name == 'advtest' else 'gencodesearchnet'
    src_dir = {'advtest': os.path.join(repo, 'eval/corpus/advtest'), 'gencodesearchnet': os.path.join(repo, 'eval/corpus/gencodesearchnet')}

    def get_map(root):
        if root not in root_of:
            d = src_dir.get(root) or os.path.join(repo, 'eval/repos', root)
            root_of[root] = chunk_map(cache_dir, root, d, repo)
        return root_of[root]

    out = os.path.join(data, 'sets', name, 'texts.jsonl')
    counts = {}
    per_root = {}
    csn_f = open(csn_texts, encoding='utf-8') if any(v['vid'].startswith('csn::') for v in vec) else None
    n_csn = 0
    with open(out, 'w', encoding='utf-8') as fo:
        for v in vec:
            vid = v['vid']
            if vid.startswith('csn::'):
                o = json.loads(csn_f.readline())
                if o['id'] != vid:
                    sys.exit(f'{name}: csn_texts.jsonl order differs from vectors.jsonl at csn row {n_csn}: {o["id"]} != {vid}')
                n_csn += 1
                rec = {'vid': vid, 'text': o['text'], 'exact': True, 'src': 'csn'}
                key = 'csn'
            else:
                root, cid = (vid.split('::', 1) if '::' in vid else (corpus_root, vid))
                o = get_map(root).get(cid)
                if o is None:
                    sys.exit(f'{name}: {vid} is not in the DB of root {root}')
                key = root
                if o['text'] is not None:
                    rec = {'vid': vid, 'text': o['text'], 'exact': bool(o['hash_ok']), 'src': 'chunker'}
                else:
                    lang = o.get('lang')
                    head = f"# {o['file']}\n" + (f'# Language: {lang}\n' if lang and lang != 'text' else '')
                    rec = {'vid': vid, 'text': head + (o.get('db_text') or ''), 'exact': False, 'src': 'fallback'}
            fo.write(jl(rec) + '\n')
            c = per_root.setdefault(key, {'n': 0, 'exact': 0, 'chunker_inexact': 0, 'fallback': 0})
            c['n'] += 1
            c['exact'] += rec['exact']
            c['chunker_inexact'] += (rec['src'] == 'chunker' and not rec['exact'])
            c['fallback'] += (rec['src'] == 'fallback')
    if csn_f:
        rest = csn_f.readline()
        if rest and n_csn != 997821:
            pass
        csn_f.close()
    tot = {'n': len(vec), 'exact': sum(c['exact'] for c in per_root.values()),
           'chunker_inexact': sum(c['chunker_inexact'] for c in per_root.values()),
           'fallback': sum(c['fallback'] for c in per_root.values())}
    return out, {'totals': tot, 'per_root': per_root}


def build_beir_text(name, data, raw):
    zp = os.path.join(raw, name + '.zip')
    z = zipfile.ZipFile(zp)
    vec = [json.loads(l)['vid'] for l in open(os.path.join(data, 'sets', name, 'vectors.jsonl'), encoding='utf-8')]
    out = os.path.join(data, 'sets', name, 'texts.jsonl')
    n = 0
    with z.open(f'{name}/corpus.jsonl') as f, open(out, 'w', encoding='utf-8') as fo:
        for line in f:
            o = json.loads(line)
            assert o['_id'] == vec[n], f'{name}: corpus order differs at {n}'
            text = ((o.get('title') or '') + ' ' + (o.get('text') or '')).strip()
            fo.write(jl({'vid': o['_id'], 'text': text, 'exact': True, 'src': 'beir'}) + '\n')
            n += 1
    assert n == len(vec)
    return out, {'totals': {'n': n, 'exact': n, 'chunker_inexact': 0, 'fallback': 0}, 'per_root': {}}


def run_check(name, data, n, repo, corpus):
    res = {}
    texts = os.path.join(data, 'sets', name, 'texts.jsonl')
    for label, flt in (('all', None), ('exact', 'exact'), ('inexact', 'inexact')):
        cmd = ['node', os.path.join(HERE, 'texts_check.mjs'), '--texts', texts, '--corpus', os.path.expanduser(corpus),
               '--n', str(n), '--label', f'{name}/{label}']
        if flt:
            cmd += ['--filter', flt]
        r = subprocess.run(cmd, env=dict(os.environ, SS_REPO=repo), capture_output=True, text=True)
        last = [l for l in r.stdout.splitlines() if l.startswith('{')]
        if r.returncode != 0 or not last:
            res[label] = {'error': (r.stderr or r.stdout)[-400:]}
            continue
        o = json.loads(last[-1])
        o.pop('backend', None)
        cos = sorted(o.pop('cos'))
        o['cos_sorted_lowest_5'] = cos[:5]
        res[label] = o
        print(f"  check {name}/{label}: n={o['n']} min_cos={o['min_cos']} max|cos-1|={o['max_abs_cos_minus_1']}")
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', required=True)
    ap.add_argument('--sets', default=','.join(CODE_SETS))
    ap.add_argument('--repo', default=REPO)
    ap.add_argument('--csn-texts', default=os.path.expanduser('~/.ss-eval/hnsw-1m/csn_texts.jsonl'))
    ap.add_argument('--raw', default=None)
    ap.add_argument('--check', type=int, default=0, help='re-embed N sampled vectors per code set (Mac, GPU path)')
    a = ap.parse_args()
    raw = a.raw or os.path.join(a.data, 'raw')
    cache_dir = os.path.join(a.data, 'cache', 'texts-chunks')
    for s in a.sets.split(','):
        print(f'== {s}')
        if s in CODE_SETS:
            path, rep = build_code_text(s, a.data, a.repo, a.csn_texts, cache_dir)
        elif s in ('quora', 'fiqa'):
            path, rep = build_beir_text(s, a.data, raw)
        else:
            sys.exit(f'unknown set {s}')
        rep['texts_sha256'] = sha256_file(path)
        rep['set'] = s
        if a.check and s in CODE_SETS:
            rep['reproduction'] = run_check(s, a.data, a.check, a.repo, MAC_CORPUS[s])
        with open(os.path.join(a.data, 'sets', s, 'texts.json'), 'w') as f:
            json.dump(rep, f, indent=2)
            f.write('\n')
        print(f"  {s}: {rep['totals']} sha256 {rep['texts_sha256'][:12]}")


if __name__ == '__main__':
    main()
