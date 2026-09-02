"""Definition-coherence face prototype (sibling-literal closure), $0, base tree + the agent's own patch only.
For each literal the patch ADDS (quoted string >=3 chars, Elixir atom, ALL_CAPS constant, Enum.Member):
  (1) literal provenance: base-tree non-test sites that already consume the same literal, with the enclosing
      function or top-level declaration -- 'the codebase already defines a predicate over this literal HERE';
  (2) sibling closure: other literals of the same kind on the same added line are 'siblings'; if a sibling is a
      member of a declared collection in the base tree (a bracketed list/set/enum body) and the added literal is NOT
      a member of that collection and the patch does not touch the declaration -> 'added L, but declaration D
      that owns its siblings does not list it; D is consumed at N sites'.
Runs over every recorded fresh-pool patch (+ optional extra runs) and reports firing rates by outcome.
"""
import json, os, re, sys, collections
sys.path.insert(0, '/tmp/wf-slatec/resolution-computed-facts')
import census_edited_functions as C

LIT_RES = [
    ('str', re.compile(r'(?<![\w])([\'"])([A-Za-z][\w\-./ :]{2,40})\1')),
    ('atom', re.compile(r'(?<![\w:]):([a-z_][\w]*[?!]?)')),
    ('const', re.compile(r'(?<![\w.])([A-Z][A-Z0-9_]{2,}(?:\.[A-Z][A-Za-z0-9_]+)?)(?![\w(])')),
    ('member', re.compile(r'(?<![\w])([A-Z][A-Za-z0-9]+\.[A-Z][A-Za-z0-9_]+)(?![\w(])')),
]
NOISE = {'true', 'false', 'null', 'None', 'nil', 'ok', 'error', 'utf-8', 'utf8', 'string', 'number', 'object', 'function', 'undefined',
         'TODO', 'FIXME', 'NOTE', 'GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS', 'PATCH', 'HTTP', 'URL', 'JSON', 'API', 'ID', 'OK', 'IO', 'UTC'}

def added_lines(patch):
    out = []
    cur = None
    for l in patch.split('\n'):
        if l.startswith('+++ '):
            p = l[4:].strip(); cur = None if p == '/dev/null' else re.sub(r'^b/', '', p.split('\t')[0])
        elif l.startswith('+') and not l.startswith('+++') and cur:
            out.append((cur, l[1:]))
    return out

def touched_files(patch):
    return set(re.sub(r'^a/', '', p) for p in re.findall(r'^--- (.*)$', patch, re.M) if p != '/dev/null')

def literals(line, lang):
    found = []
    kinds = ['str', 'const', 'member'] + (['atom'] if lang in ('ex', 'rb') else [])
    code = re.sub(r'//.*$|#.*$', '', line) if lang not in ('ex',) else re.sub(r'#.*$', '', line)
    for kind, rx in LIT_RES:
        if kind not in kinds: continue
        for m in rx.finditer(code):
            v = m.group(2) if kind == 'str' else m.group(1)
            if v in NOISE or len(v) < 3: continue
            if kind == 'str' and (' ' in v and len(v.split()) > 3): continue  # prose strings
            found.append((kind, v))
    return found

def collection_declarations(src, lang):
    """yield (name, startLine, body) for bracketed declarations: NAME = [ ... ], @name [...], const X = {...}, enum X {...}"""
    pats = [
        r'^[ \t]*(?:export\s+)?(?:const|let|var|static\s+readonly|readonly|private\s+static|public\s+static|static)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?=\s*(\[|\{|new Set\(\[|new HashSet<[^>]*>\s*\{|Object\.freeze\(\s*[\[{])',
        r'^[ \t]*([A-Z_][A-Z0-9_]*)\s*(?::\s*[\w\[\], ]+)?\s*=\s*(\[|\(|\{|frozenset\(|set\()',
        r'^[ \t]*@([a-z_]\w*)\s+(\[|~w\(|%\{|MapSet\.new\(\[)',
        r'^[ \t]*(?:public\s+|private\s+|internal\s+)?enum\s+([A-Za-z_]\w*)\s*(?::\s*\w+)?\s*(\{)',
        r'^[ \t]*([a-z_][\w]*)\s*=\s*(\[|\{|\()\s*$',
    ]
    for pat in pats:
        for m in re.finditer(pat, src, re.M):
            o = m.end() - 1
            opener = src[o]
            closer = {'[': ']', '{': '}', '(': ')'}.get(opener)
            if not closer: continue
            c = C.find_balanced(src, o, opener, closer)
            if c < 0 or c - o > 6000: continue
            yield m.group(1), src[:m.start()].count('\n') + 1, src[o:c + 1]

def run_patch(root, patch, lang, files):
    added = added_lines(patch)
    touched = touched_files(patch)
    facts = {'provenance': [], 'closure': []}
    lits_by_line = []
    for f, line in added:
        ls = literals(line, lang)
        if ls: lits_by_line.append((f, line, ls))
    all_added = set(v for _, _, ls in lits_by_line for _, v in ls)
    # (1) provenance: for each added literal, base-tree consumers outside the patched hunks
    for lit in sorted(all_added):
        sites = []
        for p in files:
            rel = os.path.relpath(p, root)
            if C.TEST_MARK.search(rel): continue
            src = C.read_src(p)
            if lit not in src: continue
            lines = src.split('\n')
            fns = None
            for i, l in enumerate(lines):
                if lit in l:
                    if fns is None: fns = C.functions_in_file(lines, C.lang_of(p) or lang)
                    enc = None
                    for name, params, s, e in fns:
                        if s <= i <= e and (enc is None or (e - s) < (enc[3] - enc[2])): enc = (name, params, s, e)
                    sites.append({'file': rel, 'line': i + 1, 'fn': enc[0] if enc else None, 'text': l.strip()[:100]})
                    if len(sites) >= 40: break
            if len(sites) >= 40: break
        if sites: facts['provenance'].append({'literal': lit, 'nSites': len(sites), 'sites': sites[:6]})
    # (2) sibling closure
    decls = None
    for f, line, ls in lits_by_line:
        vals = [v for _, v in ls]
        for kind, lit in ls:
            sibs = [v for v in vals if v != lit]
            if not sibs: continue
            if decls is None:
                decls = []
                for p in files:
                    rel = os.path.relpath(p, root)
                    if C.TEST_MARK.search(rel): continue
                    src = C.read_src(p)
                    for name, ln, body in collection_declarations(src, C.lang_of(p) or lang):
                        decls.append((rel, name, ln, body))
            for rel, name, ln, body in decls:
                members_hit = [s for s in sibs if re.search(r'(?<![\w])' + re.escape(s) + r'(?![\w])', body)]
                if not members_hit: continue
                if re.search(r'(?<![\w])' + re.escape(lit) + r'(?![\w])', body): continue
                if rel in touched and any(name in l for _, l in added): continue  # patch extends the declaration
                consumers = 0
                for p2 in files:
                    if C.TEST_MARK.search(os.path.relpath(p2, root)): continue
                    consumers += len(re.findall(r'(?<![\w@])' + re.escape(name) + r'(?![\w])', C.read_src(p2)))
                facts['closure'].append({'literal': lit, 'siblings': members_hit[:4], 'declaration': f'{rel}:{ln} {name}', 'consumers': consumers})
                break
    return facts

def main():
    R, GOLD = C.R, C.GOLD
    out_rows = []
    for run, harness, mode in C.RUNS:
        rows = json.load(open(f'{R}/{run}/rows.json'))
        rows = rows if isinstance(rows, list) else rows.get('rows', rows)
        rmap = {(r.get('taskId') or r.get('instance_id'), r['arm'], int(r.get('rep', 0))): r for r in rows}
        tasks = json.load(open(f'{R}/{run}/sweet/tasks.json'))
        tmeta = {t['instance_id']: (t['repo'], t['base_commit'], t.get('language')) for t in tasks}
        for arm in ('native', 'sweet'):
            for rep in (0, 1, 2):
                pf = f'{R}/{run}/{arm}/patches.json' if rep == 0 else f'{R}/{run}/{arm}/rep-{rep}/patches.json'
                if not os.path.exists(pf): continue
                for entry in json.load(open(pf)):
                    tid = entry['instance_id']
                    if mode == 'drop-repaired-sweet' and arm == 'sweet' and tid in C.REPAIRED: continue
                    repo, sha, lang = tmeta.get(tid, (None, None, None))
                    if not repo: continue
                    root = f'{GOLD}/{repo.replace("/", "__")}@{sha}'
                    files = C.repo_files(root)
                    L = {'python': 'py', 'js': 'js', 'ts': 'js', 'csharp': 'cs', 'go': 'go', 'java': 'java', 'php': 'php', 'elixir': 'ex', 'cpp': 'jam'}.get(lang, 'js')
                    facts = run_patch(root, entry.get('patch') or '', L, files)
                    row = rmap.get((tid, arm, rep), {})
                    out_rows.append({'run': run, 'harness': harness, 'task': tid, 'arm': arm, 'rep': rep, 'resolved': row.get('resolved'),
                                     'nProvenanceLiterals': len(facts['provenance']), 'closure': facts['closure'],
                                     'provenance': [{'literal': x['literal'], 'nSites': x['nSites'], 'sites': [(s['file'], s['line'], s['fn']) for s in x['sites'][:3]]} for x in facts['provenance']]})
    json.dump(out_rows, open(f'{C.OUT}/coherence.json', 'w'), indent=1)
    lines = [f'cells {len(out_rows)}']
    for outcome in (True, False):
        oc = [r for r in out_rows if r['resolved'] is outcome]
        fire = [r for r in oc if r['closure']]
        prov = [r for r in oc if r['nProvenanceLiterals']]
        lines.append(f'resolved={outcome}: n={len(oc)} closureFires={len(fire)} ({100.0*len(fire)/max(1,len(oc)):.1f}%) provenanceFires={len(prov)} ({100.0*len(prov)/max(1,len(oc)):.1f}%)')
    lines.append('closure firings by task/outcome:')
    ct = collections.Counter((r['task'], r['resolved']) for r in out_rows if r['closure'])
    for k, v in sorted(ct.items()): lines.append(f'  {k[0]:42s} resolved={k[1]!s:5s} {v}')
    lines.append('closure examples:')
    seen = set()
    for r in out_rows:
        for c in r['closure']:
            key = (r['task'], c['literal'], c['declaration'])
            if key in seen: continue
            seen.add(key)
            lines.append(f"  {r['task'][:30]:30s} {r['arm']}{r['rep']} res={r['resolved']} lit={c['literal']!r} sibs={c['siblings']} decl={c['declaration']} consumers={c['consumers']}")
    lines.append('aiohttp provenance (header-conditioned cells):')
    for r in out_rows:
        if r['task'].startswith('aio-libs'):
            hits = [p for p in r['provenance'] if p['literal'].lower() in ('keep-alive', 'connection', 'close', 'upgrade')]
            if hits: lines.append(f"  {r['harness']} {r['arm']}{r['rep']} res={r['resolved']} " + '; '.join(f"{p['literal']}: {p['nSites']} sites e.g. {p['sites'][:2]}" for p in hits))
    open(f'{C.OUT}/coherence-summary.txt', 'w').write('\n'.join(lines) + '\n')
    print('\n'.join(lines))

if __name__ == '__main__':
    main()
