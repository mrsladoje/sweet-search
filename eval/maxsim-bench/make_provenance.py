# python3 make_provenance.py [--set agent-dev|agent-ho|gcsn-dev|gcsn-ho|sweep-dev|sweep-ho]... [--root DIR] [--sweeps-only]
#
# Writes provenance.jsonl next to every index file group of a replay set, one line per kernel
# call in the order replay_py.load_set yields them:
#   {"file", "repo", "query_id", "query_sha256", "source_task", "map"}
# query_sha256 = SHA-256 of the normalized query text (NFC, strip, whitespace runs -> one space);
# the text is the one the tool hands to the late-interaction query encoder.
# Prints aggregate counts only (never a query, id or per-call row), so held-out sets can be run.
#
# HOW A KERNEL CALL IS MAPPED TO ITS QUERY (exact, or left unmapped)
#   The capture wrote one file per native MaxSim call, in call order, without a query id. The
#   source lists are ordered (calls.json per repo for agent sets; the stratified split filtered
#   from eval/data/gencodesearchnet/queries.jsonl in file order for GCSN, which run_benchmark.js
#   replays in that order at --concurrency=1). Every source item yields 0 or 1 kernel call
#   (0: usage error before the search, or the stage was skipped), never reordered. numQ of a
#   kernel call is a function of the query text alone: the production tokenizer applied to
#   "[Q] " + text, truncated at maxQueryLength, no padding, no pruning. So numQ is computed
#   WITHOUT the neural model (count_query_tokens.mjs / derive_query_texts.mjs, tokenizer only).
#   Alignment: the kernel sequence must be an ordered subsequence of the source sequence with
#   equal numQ. All such alignments are enumerated implicitly (forward/backward reachability);
#   a kernel call is mapped iff every valid alignment puts it on the same source item. Extra
#   exact constraint, applied until nothing changes: kernel calls whose query float32 bytes are
#   identical were encoded from the same text, so their sources must have the same text.
#   If several valid sources have the same text and task, the call gets map "unique-text"
#   (query_sha256 and source_task known, query_id null). Anything else: "unmapped", all null.
#   An infeasible alignment (no valid one) leaves the whole group "unmapped".
# SWEEPS: a sweep call's query is q[:nq] of a captured query (make_sweep.py); it is identified
#   by matching the query bytes against the first nq tokens of every captured query of the
#   source sets (dev: agent-dev + gcsn-dev, ho: agent-ho + gcsn-ho); it maps iff all matches
#   share one query_sha256. This is byte-exact and does not need the sampling RNG.
import glob, hashlib, json, os, re, subprocess, sys, unicodedata
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '../..'))
ROOT = os.path.expanduser('~/.ss-eval/maxsim-replay')


def norm_text(t):
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFC', t).strip())


def sha(t):
    return hashlib.sha256(norm_text(t).encode('utf-8')).hexdigest()


def iter_index(set_dir):
    """Yield (source_dir, index_meta) in replay_py.load_set order."""
    for repo in sorted(os.listdir(set_dir)):
        d = os.path.join(set_dir, repo)
        if not os.path.isdir(d):
            continue
        for idx in sorted(glob.glob(os.path.join(d, 'index-*.jsonl'))):
            for line in open(idx):
                yield repo, d, json.loads(line)


def iter_sweep(set_dir):
    """Sweep sets nest one level deeper: <cell>/sweep/index-sweep.jsonl (cells in sorted order)."""
    for cell in sorted(os.listdir(set_dir)):
        d = os.path.join(set_dir, cell, 'sweep')
        for idx in sorted(glob.glob(os.path.join(d, 'index-*.jsonl'))):
            for line in open(idx):
                yield cell, d, json.loads(line)


def query_bytes(d, m):
    with open(os.path.join(d, m['file']), 'rb') as f:
        return f.read(m['numQ'] * m['dim'] * 4)


# ---------------------------------------------------------------- alignment
def align(allowed, knq, khash, text_keys):
    """allowed[i]: set of numQ source i can produce (empty = produces no kernel call).
    knq/khash: per kernel call. text_keys[i]: text identity of source i.
    Returns list (per kernel call) of sorted valid source indices ([] if infeasible)."""
    n, K = len(allowed), len(knq)
    if K == 0:
        return []
    ok = np.zeros((K, n), bool)
    by_nq = {}
    for i, a in enumerate(allowed):
        for v in a:
            by_nq.setdefault(v, []).append(i)
    for k in range(K):
        ok[k, by_nq.get(knq[k], [])] = True
    classes = {}
    for k, h in enumerate(khash):
        classes.setdefault(h, []).append(k)
    multi = [c for c in classes.values() if len(c) > 1]
    while True:
        F = np.zeros((K, n), bool)
        F[0] = ok[0]
        for k in range(1, K):
            reach = np.concatenate([[False], np.logical_or.accumulate(F[k - 1])[:-1]])
            F[k] = ok[k] & reach
        B = np.zeros((K, n), bool)
        B[K - 1] = ok[K - 1]
        for k in range(K - 2, -1, -1):
            rev = np.logical_or.accumulate(B[k + 1][::-1])[::-1]
            reach = np.concatenate([rev[1:], [False]])
            B[k] = ok[k] & reach
        V = F & B
        changed = False
        for c in multi:
            keysets = [set(text_keys[i] for i in np.flatnonzero(V[k])) for k in c]
            common = set.intersection(*keysets)
            for k in c:
                for i in np.flatnonzero(V[k]):
                    if text_keys[i] not in common:
                        ok[k, i] = False; changed = True
        if not changed:
            break
    return [list(map(int, np.flatnonzero(V[k]))) for k in range(K)]


def run_node(script, *args, stdin=None):
    r = subprocess.run(['node', os.path.join(HERE, script), *args], input=stdin, capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


# ---------------------------------------------------------------- sources
def agent_sources(set_dir):
    derived = run_node('derive_query_texts.mjs', os.path.join(set_dir, 'calls.json'))
    src = {}
    for repo, lst in derived.items():
        items = []
        for idx, c in enumerate(lst):
            items.append(dict(text=c['text'], numQ=c['numQ'], query_id=f'{repo}:{idx}', source_task=c['qid'],
                              raw=c['rawText']))
        src[repo] = items
    return src


def gcsn_sources(which):
    sp = json.load(open(os.path.join(REPO, 'eval/splits/gencodesearchnet', f'{which}.json')))
    ids = set(sp['ids'])
    qs = [json.loads(l) for l in open(os.path.join(REPO, 'eval/data/gencodesearchnet/queries.jsonl'))]
    qs = [q for q in qs if q['query_id'] in ids]

    def clean(q):  # eval/lib/evaluator.js cleanQueryText
        q = re.sub(r'^//\s*', '', q); q = re.sub(r'^/\*+\s*', '', q); q = re.sub(r'^\*+\s*', '', q); q = re.sub(r'^#\s*', '', q)
        return q.strip()
    texts = [clean(q['query']) or q['query'] for q in qs]
    nq = run_node('count_query_tokens.mjs', stdin=json.dumps(texts))
    return {'gcsn': [dict(text=t, numQ=n, query_id=q['query_id'], source_task='gcsn', raw=q['query'])
                     for q, t, n in zip(qs, texts, nq)]}


def load_sources(name):
    kind, which = name.split('-')
    if kind == 'agent':
        return agent_sources(os.path.join(ROOT, name))
    return gcsn_sources('heldout' if which == 'ho' else 'dev')


# ---------------------------------------------------------------- one set
def provenance_for_set(name):
    set_dir = os.path.join(ROOT, name)
    sources = load_sources(name)
    by_dir = {}
    for repo, d, m in iter_index(set_dir):
        by_dir.setdefault((repo, d), []).append(m)
    total = mapped = by_text = 0
    infeasible = 0
    out_lines = {}
    for (repo, d), metas in by_dir.items():
        items = sources[repo]
        allowed = [{it['numQ']} if it['text'] is not None else set() for it in items]
        keys = [sha(it['text']) if it['text'] is not None else None for it in items]
        knq = [m['numQ'] for m in metas]
        khash = [hashlib.sha256(query_bytes(d, m)).digest() for m in metas]
        valid = align(allowed, knq, khash, keys)
        feasible = all(valid)
        if not feasible:
            infeasible += 1
        lines = []
        for m, v in zip(metas, valid):
            row = dict(file=m['file'], repo=repo, query_id=None, query_sha256=None, source_task=None, map='unmapped')
            if feasible and v:
                its = [items[i] for i in v]
                if len(v) == 1:
                    it = its[0]
                    row.update(query_id=it['query_id'], query_sha256=keys[v[0]], source_task=it['source_task'], map='numQ-order-unique')
                    mapped += 1
                elif len({keys[i] for i in v}) == 1 and len({it['source_task'] for it in its}) == 1:
                    row.update(query_sha256=keys[v[0]], source_task=its[0]['source_task'], map='unique-text')
                    by_text += 1
            lines.append(row)
        total += len(metas)
        out_lines[d] = lines
    for d, lines in out_lines.items():
        with open(os.path.join(d, 'provenance.jsonl'), 'w') as f:
            for r in lines:
                f.write(json.dumps(r) + '\n')
    return dict(total=total, mapped_unique_source=mapped, mapped_unique_text=by_text,
                unmapped=total - mapped - by_text, infeasible_groups=infeasible, groups=len(by_dir))


# ---------------------------------------------------------------- sweeps
def sweep_provenance(which):
    """which: 'dev' | 'ho'. Match each sweep query to captured queries by prefix bytes."""
    srcs = [f'agent-{which}', f'gcsn-{which}']
    table = {}  # nq -> {sha1(prefix bytes): set of (query_sha256, source_task, query_id)}
    for s in srcs:
        d0 = os.path.join(ROOT, s)
        prov = {}
        for repo, d, m in iter_index(d0):
            p = os.path.join(d, 'provenance.jsonl')
            if p not in prov:
                prov[p] = {json.loads(l)['file']: json.loads(l) for l in open(p)}
            r = prov[p][m['file']]
            if r['query_sha256'] is None:
                continue
            qb = query_bytes(d, m)
            row = m['dim'] * 4
            for nq in (8, 32, 64):
                if m['numQ'] >= nq:
                    table.setdefault(nq, {}).setdefault(hashlib.sha1(qb[:nq * row]).digest(), set()).add(
                        (r['query_sha256'], r['source_task'], r['query_id']))
        # captured but unmapped queries must also block false uniqueness: record them as unknown
        for repo, d, m in iter_index(d0):
            p = os.path.join(d, 'provenance.jsonl')
            if prov[p][m['file']]['query_sha256'] is None:
                qb = query_bytes(d, m); row = m['dim'] * 4
                for nq in (8, 32, 64):
                    if m['numQ'] >= nq:
                        table.setdefault(nq, {}).setdefault(hashlib.sha1(qb[:nq * row]).digest(), set()).add((None, None, None))
    set_dir = os.path.join(ROOT, f'sweep-{which}')
    total = mapped = 0
    per_cell = {}
    for repo, d, m in iter_sweep(set_dir):
        qb = query_bytes(d, m)
        hits = table.get(m['numQ'], {}).get(hashlib.sha1(qb).digest(), set())
        row = dict(file=m['file'], repo='sweep', query_id=None, query_sha256=None, source_task=None, map='unmapped')
        if hits and None not in {h[0] for h in hits}:
            shas = {h[0] for h in hits}; tasks = {h[1] for h in hits}
            if len(shas) == 1 and len(tasks) == 1:
                ids = {h[2] for h in hits}
                row.update(query_sha256=next(iter(shas)), source_task=next(iter(tasks)))
                if len(ids) == 1:
                    row.update(query_id=next(iter(ids)), map='query-bytes-unique')
                else:
                    row.update(map='query-bytes-unique-text')
                mapped += 1
        total += 1
        per_cell.setdefault(d, []).append(row)
    for d, rows in per_cell.items():
        with open(os.path.join(d, 'provenance.jsonl'), 'w') as f:
            for r in rows:
                f.write(json.dumps(r) + '\n')
    return dict(total=total, mapped=mapped, unmapped=total - mapped, cells=len(per_cell))


if __name__ == '__main__':
    argv = sys.argv[1:]
    if '--root' in argv:
        i = argv.index('--root'); ROOT = os.path.expanduser(argv[i + 1]); del argv[i:i + 2]
    sets = [argv[i + 1] for i, a in enumerate(argv) if a == '--set'] or ['agent-dev', 'agent-ho', 'gcsn-dev', 'gcsn-ho', 'sweep-dev', 'sweep-ho']
    for s in sets:
        r = sweep_provenance(s.split('-')[1]) if s.startswith('sweep-') else provenance_for_set(s)
        print(s, json.dumps(r))
