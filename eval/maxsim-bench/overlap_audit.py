# python3 overlap_audit.py     (run with the venv python; needs the provenance.jsonl sidecars of make_provenance.py)
#
# Dev / held-out leak audit of the replay sets. COUNTS ONLY: prints and writes aggregates,
# never a query text, id or per-call row.
#   dev sets: agent-dev, gcsn-dev, sweep-dev      held-out sets: agent-ho, gcsn-ho, sweep-ho
# For every (dev set, held-out set) pair:
#   1. query text: normalized (NFC, strip, whitespace) SHA-256 of the query text; sources are
#      calls.json (agent: the raw tool query and the text handed to the encoder) and the GCSN
#      split lists. Agent <-> GCSN pairs are included. Sweeps have no text source here.
#   2. query embedding: SHA-256 of the query float32 bytes of each call (.bin). A sweep query is
#      the first 8 / 32 / 64 tokens of a captured query, so pairs with a sweep compare (numQ,
#      SHA-256) keys, using the first numQ tokens of the other set's queries.
#   3. documents: SHA-256 of each candidate's raw int4 bytes. Overlap is expected (same repos);
#      reported as a count of distinct blobs, not as a leak of queries.
# Also: shared agent question ids between agent-dev and agent-ho.
# Output: overlap-audit.json (this folder). If any QUERY overlap exists (levels 1-2), the
# held-out FILE names (<set>/<subdir>/<file>) to drop before the freeze go to
# ~/.ss-eval/maxsim-cloud/overlap-drop.json (outside the repo); only their count is printed.
import hashlib, json, os, sys
from collections import defaultdict
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_provenance as mp

ROOT = mp.ROOT
DEV = ['agent-dev', 'gcsn-dev', 'sweep-dev']
HO = ['agent-ho', 'gcsn-ho', 'sweep-ho']
NQS = (8, 32, 64)


def is_sweep(s):
    return s.startswith('sweep-')


def scan(name):
    """Per set: query keys, per-file info, text hashes, doc digests."""
    set_dir = os.path.join(ROOT, name)
    it = mp.iter_sweep(set_dir) if is_sweep(name) else mp.iter_index(set_dir)
    full = defaultdict(list)        # sha256(query bytes) -> [file ids]
    pref = defaultdict(list)        # (nq, sha256(first nq tokens)) -> [file ids]
    file_key = {}                   # file id -> (numQ, full digest, [prefix digests])
    docs = set()
    n = 0
    for sub, d, m in it:
        fid = f'{name}/{sub}/{m["file"]}'
        row = m['dim'] * 4
        with open(os.path.join(d, m['file']), 'rb') as f:
            buf = f.read()
        qlen = m['numQ'] * row
        h = hashlib.sha256(buf[:qlen]).digest()
        full[h].append(fid)
        pdig = {}
        for nq in NQS:
            if m['numQ'] >= nq:
                pdig[nq] = hashlib.sha256(buf[:nq * row]).digest()
                pref[(nq, pdig[nq])].append(fid)
        file_key[fid] = (m['numQ'], h, pdig)
        off = qlen
        for c in m['cands']:
            docs.add(hashlib.sha256(buf[off:off + c['tb']]).digest())
            off += c['tb'] + 3 * c['nt'] * 4
        n += 1
    return dict(full=full, pref=pref, file_key=file_key, docs=docs, calls=n)


def text_hashes(name):
    """(set of text hashes, {source_task}) from the source lists; None for sweeps."""
    if is_sweep(name):
        return None, set()
    kind, which = name.split('-')
    if kind == 'agent':
        derived = mp.run_node('derive_query_texts.mjs', os.path.join(ROOT, name, 'calls.json'))
        hs, tasks = set(), set()
        for lst in derived.values():
            for c in lst:
                tasks.add(c['qid'])
                for t in (c['text'], c['rawText']):
                    if t:
                        hs.add(mp.sha(t))
        return hs, tasks
    src = mp.gcsn_sources('heldout' if which == 'ho' else 'dev')['gcsn']
    return {mp.sha(s['raw']) for s in src} | {mp.sha(s['text']) for s in src}, set()


def prov_sha(name):
    """file id -> query_sha256 from the sidecar (None if unmapped)."""
    out = {}
    set_dir = os.path.join(ROOT, name)
    groups = set()
    it = mp.iter_sweep(set_dir) if is_sweep(name) else mp.iter_index(set_dir)
    for sub, d, m in it:
        groups.add((sub, d))
    for sub, d in groups:
        for l in open(os.path.join(d, 'provenance.jsonl')):
            r = json.loads(l)
            out[f'{name}/{sub}/{r["file"]}'] = r['query_sha256']
    return out


def main():
    data = {s: scan(s) for s in DEV + HO}
    texts = {s: text_hashes(s) for s in DEV + HO}
    prov = {s: prov_sha(s) for s in DEV + HO}
    res = dict(sets={s: dict(calls=data[s]['calls'], distinct_query_embeddings=len(data[s]['full']),
                             distinct_doc_blobs=len(data[s]['docs'])) for s in DEV + HO},
               pairs={})
    flagged = set()
    for x in DEV:
        for y in HO:
            X, Y = data[x], data[y]
            p = {}
            # 1. text
            tx, ty = texts[x][0], texts[y][0]
            if tx is not None and ty is not None:
                shared = tx & ty
                ho_calls = [f for f, h in prov[y].items() if h in shared]
                p['text_hash_overlap_distinct'] = len(shared)
                p['text_heldout_calls_with_overlapping_text_via_sidecar'] = len(ho_calls)
                flagged.update(ho_calls)
            else:
                p['text_hash_overlap_distinct'] = None  # sweeps: covered by sidecar text hash below
            # sidecar text hash (also covers sweeps): mapped held-out calls whose query text equals a mapped dev query text
            dtexts = {h for h in prov[x].values() if h}
            hits = [f for f, h in prov[y].items() if h in dtexts]
            p['sidecar_text_overlap_heldout_calls'] = len(hits)
            flagged.update(hits)
            # 2. embeddings
            if not is_sweep(x) and not is_sweep(y):
                sh = set(X['full']) & set(Y['full'])
                files = [f for h in sh for f in Y['full'][h]]
            else:
                kx = {(m, h) for m, h, _ in X['file_key'].values()} if is_sweep(x) else set(X['pref']) | {(m, h) for m, h, _ in X['file_key'].values()}
                if is_sweep(y):
                    ky = {(m, h): [f] for f, (m, h, _) in Y['file_key'].items()}
                    files = [f for f, (m, h, _) in Y['file_key'].items() if (m, h) in kx]
                    sh = {(m, h) for (m, h, _) in Y['file_key'].values() if (m, h) in kx}
                else:
                    # held-out is a captured set, dev a sweep: a sweep query is a prefix of a captured query
                    files = [f for f, (m, h, pd) in Y['file_key'].items() if any((nq, d) in kx for nq, d in pd.items())]
                    sh = {(nq, d) for (m, h, pd) in Y['file_key'].values() for nq, d in pd.items() if (nq, d) in kx}
            p['query_embedding_overlap_distinct'] = len(sh)
            p['query_embedding_overlap_heldout_calls'] = len(files)
            flagged.update(files)
            # 3. docs
            p['doc_blob_overlap_distinct'] = len(X['docs'] & Y['docs'])
            p['doc_blob_overlap_share_of_heldout_docs'] = round(len(X['docs'] & Y['docs']) / max(1, len(Y['docs'])), 4)
            res['pairs'][f'{x} x {y}'] = p
    res['agent_question_ids_shared_dev_ho'] = len(texts['agent-dev'][1] & texts['agent-ho'][1])
    res['heldout_calls_flagged_for_drop'] = len(flagged)
    json.dump(res, open(os.path.join(mp.HERE, 'overlap-audit.json'), 'w'), indent=2)
    if flagged:
        out = os.path.expanduser('~/.ss-eval/maxsim-cloud')
        os.makedirs(out, exist_ok=True)
        json.dump(dict(files=sorted(flagged)), open(os.path.join(out, 'overlap-drop.json'), 'w'))
    print(json.dumps(res, indent=1))


if __name__ == '__main__':
    main()
