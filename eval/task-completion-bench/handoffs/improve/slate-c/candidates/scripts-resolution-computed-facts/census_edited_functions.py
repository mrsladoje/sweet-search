"""Trigger-conditioned census for the computed-facts lens (Slate C, $0).

For every recorded agent patch in the fresh-pool TAB runs (+ opencode repair pass) find the base-tree
function(s) the patch edits, then compute -- from the base tree only, with no task knowledge --
what a call-site binding certificate would print for each edited function:
  * number of call sites in the repo (non-test / test), the argument expression bound to each
    parameter, and whether any argument is a possibly-empty collection (face (b), caller range);
  * whether the function has exactly one call site (face (a), single-binding shape, the b2 pattern);
  * which accessors the existing tests assert on right after calling the function (observation-site face).
Joins each patch to rows.json resolved/f2pFrac so firing rates can be split by outcome.

Reads: results/<run>/{rows.json, <arm>/patches.json, <arm>/rep-N/patches.json, sweet/tasks.json (repo,
base_commit, instance_id, language ONLY)} and /root/.ss-eval/golden/<repo>@<sha>/ (read-only).
Writes: /tmp/wf-slatec/resolution-computed-facts/census.json and census-summary.txt
"""
import json, os, re, sys, collections

R = '/root/sweet-search-private/eval/task-completion-bench/results'
GOLD = '/root/.ss-eval/golden'
OUT = '/tmp/wf-slatec/resolution-computed-facts'
RUNS = [
    ('fp-codex-tab-20260826', 'codex', None),
    ('fp-opencode-tab-20260826', 'opencode', 'drop-repaired-sweet'),
    ('rp-oc-tab-20260827', 'opencode', None),
    ('fp-claudecode-tab-20260826', 'claude-code', None),
]
REPAIRED = set(x.strip() for x in open('/root/fresh-run/repair-tasks.txt') if x.strip())

SKIP_DIRS = ('node_modules/', 'dist/', 'build/', 'vendor/', '.git/', 'bin/', 'obj/', '__pycache__/', 'coverage/')
TEST_MARK = re.compile(r'(^|/)(tests?|spec|__tests__|testing)(/|$)|(_test|\.test|\.spec|Tests?)\.[a-z]+$|Test[A-Z]?\w*\.(cs|java)$', re.I)
SRC_EXT = {'.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.cs', '.go', '.java', '.php', '.ex', '.exs', '.jam', '.cpp', '.hpp', '.c', '.h', '.rb', '.kt', '.swift', '.rs'}

BRACE_HEADER = {
    'js': re.compile(r'^[ \t]*(?:export\s+(?:default\s+)?)?(?:static\s+)?(?:async\s+)?(?:function\s*\*?\s*)?(#?[A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?::\s*[^{;=]+)?\s*(?:=>\s*)?\{'),
    'js-arrow': re.compile(r'^[ \t]*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\(([^)]*)\)|([A-Za-z_$][\w$]*))\s*(?::\s*[^=]+)?=>\s*\{'),
    'cs': re.compile(r'^[ \t]*(?:(?:public|private|protected|internal|static|virtual|override|abstract|sealed|async|new|extern|unsafe|partial|readonly)\s+)*(?:[\w<>\[\],\.?]+\s+)+([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?:where[^{]*)?\{?'),
    'java': re.compile(r'^[ \t]*(?:(?:public|private|protected|static|final|abstract|synchronized|native|default)\s+)*(?:<[^>]*>\s*)?(?:[\w<>\[\],\.?]+\s+)+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:throws[^{]*)?\{'),
    'go': re.compile(r'^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*\(([^)]*)\)'),
    'php': re.compile(r'^[ \t]*(?:(?:public|private|protected|static|abstract|final)\s+)*function\s+([A-Za-z_]\w*)\s*\(([^)]*)\)'),
    'cpp': re.compile(r'^[ \t]*(?:[\w:<>\*&~]+\s+)+([A-Za-z_~][\w:]*)\s*\(([^)]*)\)\s*(?:const)?\s*\{'),
    'jam': re.compile(r'^[ \t]*(?:local\s+)?rule\s+([\w.\-]+)\s*\(([^)]*)\)'),
}
PY_HEADER = re.compile(r'^([ \t]*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)')
EX_HEADER = re.compile(r'^([ \t]*)defp?\s+([a-z_]\w*[?!]?)\s*(?:\(([^)]*)\))?')

def lang_of(path):
    ext = os.path.splitext(path)[1].lower()
    return {'.js': 'js', '.mjs': 'js', '.cjs': 'js', '.jsx': 'js', '.ts': 'js', '.tsx': 'js', '.py': 'py', '.cs': 'cs',
            '.java': 'java', '.go': 'go', '.php': 'php', '.ex': 'ex', '.exs': 'ex', '.jam': 'jam', '.cpp': 'cpp',
            '.hpp': 'cpp', '.c': 'cpp', '.h': 'cpp'}.get(ext)

def find_balanced(s, i, open_c='(', close_c=')'):
    depth = 0; j = i; instr = None
    while j < len(s):
        c = s[j]
        if instr:
            if c == '\\': j += 2; continue
            if c == instr: instr = None
        elif c in '\'"`': instr = c
        elif c == open_c: depth += 1
        elif c == close_c:
            depth -= 1
            if depth == 0: return j
        j += 1
    return -1

def split_args(s):
    out, depth, cur, instr = [], 0, '', None
    for c in s:
        if instr:
            cur += c
            if c == instr: instr = None
            continue
        if c in '\'"`': instr = c; cur += c; continue
        if c in '([{<': depth += 1
        if c in ')]}>': depth -= 1
        if c == ',' and depth == 0: out.append(cur.strip()); cur = ''; continue
        cur += c
    if cur.strip(): out.append(cur.strip())
    return out

def brace_end_line(lines, start_idx):
    """index of the line that closes the block whose first '{' is on/after lines[start_idx]"""
    depth = 0; seen = False; instr = None
    for i in range(start_idx, min(len(lines), start_idx + 4000)):
        for c in lines[i]:
            if instr:
                if c == instr: instr = None
                continue
            if c in '\'"`': instr = c; continue
            if c == '{': depth += 1; seen = True
            elif c == '}':
                depth -= 1
                if seen and depth == 0: return i
        instr = None  # strings do not span lines in these languages (templates excepted; accept the noise)
    return -1

MODS = r'(?:(?:export|default|public|private|protected|internal|static|virtual|override|abstract|sealed|async|new|extern|unsafe|partial|readonly|final|synchronized|native|local|get|set|constexpr|inline|friend|explicit|unsigned|const)\s+)*'
HEAD_START = {
    'js': re.compile(r'^[ \t]*' + MODS + r'(?:function\s*\*?\s*)?(#?[A-Za-z_$][\w$]*)\s*(?:<[^>()]*>)?\s*\('),
    'js-arrow': re.compile(r'^[ \t]*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?\('),
    'js-prop': re.compile(r'^[ \t]*([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?\('),
    'cs': re.compile(r'^[ \t]*' + MODS + r'(?:[\w<>\[\],\.?]+\s+)+([A-Za-z_]\w*)\s*(?:<[^>()]*>)?\s*\('),
    'java': re.compile(r'^[ \t]*' + MODS + r'(?:<[^>]*>\s*)?(?:[\w<>\[\],\.?]+\s+)+([A-Za-z_]\w*)\s*\('),
    'go': re.compile(r'^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*\('),
    'php': re.compile(r'^[ \t]*' + MODS + r'function\s+([A-Za-z_]\w*)\s*\('),
    'cpp': re.compile(r'^[ \t]*' + MODS + r'(?:[\w:<>\*&~]+\s+)+([A-Za-z_~][\w:]*)\s*\('),
    'jam': re.compile(r'^[ \t]*(?:local\s+)?rule\s+([\w.\-]+)\s*\('),
}
HEAD_START = {k: re.compile(v.pattern, re.M) for k, v in HEAD_START.items()}
KEYWORDS = {'if', 'for', 'while', 'switch', 'catch', 'return', 'else', 'function', 'new', 'typeof', 'await', 'foreach', 'using', 'lock', 'fixed', 'throw', 'yield', 'delete', 'void', 'case', 'sizeof', 'assert', 'elif', 'except', 'with', 'print', 'require', 'import', 'super', 'this', 'constructor'}

def functions_in_file(lines, lang):
    """list of (name, params, startIdx, endIdx) for function-like definitions; params may span lines"""
    out = []
    n = len(lines)
    src = '\n'.join(lines)
    offsets = [0]
    for l in lines: offsets.append(offsets[-1] + len(l) + 1)
    def line_of(pos):
        import bisect
        return bisect.bisect_right(offsets, pos) - 1
    if lang == 'py':
        for m in re.finditer(r'^([ \t]*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(', src, re.M):
            c = find_balanced(src, m.end() - 1)
            if c < 0: continue
            i = line_of(m.start())
            ind = len(m.group(1).expandtabs(4))
            j = line_of(c) + 1
            while j < n and (not lines[j].strip() or len(lines[j][:len(lines[j]) - len(lines[j].lstrip())].expandtabs(4)) > ind):
                j += 1
            out.append((m.group(2), src[m.end():c], i, j - 1))
        return out
    if lang == 'ex':
        for i, l in enumerate(lines):
            m = EX_HEADER.match(l)
            if not m: continue
            ind = len(m.group(1))
            j = i + 1
            while j < n and not (lines[j].strip() and len(lines[j]) - len(lines[j].lstrip()) <= ind and re.match(r'^\s*(defp?|end|@|defmodule|describe|test)\b', lines[j])):
                j += 1
            out.append((m.group(2), m.group(3) or '', i, j))
        return out
    heads = [HEAD_START.get(lang)] if lang in HEAD_START else []
    if lang == 'js': heads += [HEAD_START['js-arrow'], HEAD_START['js-prop']]
    seen = set()
    for h in heads:
        if not h: continue
        for m in h.finditer(src):
            name = m.group(1)
            if name in KEYWORDS: continue
            c = find_balanced(src, m.end() - 1)
            if c < 0: continue
            # what follows the parameter list up to the first '{' or ';' decides definition vs call
            tail = src[c + 1:c + 400]
            brace = tail.find('{'); semi = tail.find(';')
            if brace < 0 or (0 <= semi < brace): continue
            between = tail[:brace]
            if lang == 'js' and h in (HEAD_START['js-arrow'], HEAD_START['js-prop']) and '=>' not in between: continue
            if lang == 'go':
                if not re.fullmatch(r'\s*(?:\([^{;]*\)|[\w\.\*\[\]]+)?\s*', between): continue
            elif not re.fullmatch(r'\s*(?:=>\s*)?(?::\s*[^{;=]*)?(?:throws\s+[\w., ]+)?(?:const|override|noexcept|where\s+[^{;]*)?\s*', between): continue
            i = line_of(m.start())
            if lang != 'jam':
                pre = lines[i][:m.start() - offsets[i]]
                if re.search(r'[=.(,]\s*$|\breturn\b|\bawait\b|\bnew\b', pre): continue
            e = brace_end_line(lines, line_of(c + 1 + brace))
            if e < 0: continue
            if (name, i) in seen: continue
            seen.add((name, i))
            out.append((name, src[m.end():c], i, e))
    return out

def enclosing_functions(lines, lang, line_numbers):
    fns = functions_in_file(lines, lang)
    hit = {}
    for ln in line_numbers:
        idx = ln - 1
        best = None
        for name, params, s, e in fns:
            if s <= idx <= e and (best is None or (e - s) < (best[3] - best[2])):
                best = (name, params, s, e)
        if best: hit[(best[0], best[2])] = best
    return list(hit.values())

def parse_diff(patch):
    """returns {oldpath: set(old-side line numbers touched)}"""
    touched = collections.defaultdict(set)
    cur = None
    old_ln = None
    for line in patch.split('\n'):
        if line.startswith('--- '):
            p = line[4:].strip()
            cur = None if p == '/dev/null' else re.sub(r'^a/', '', p.split('\t')[0])
        elif line.startswith('+++ '):
            continue
        elif line.startswith('@@'):
            m = re.match(r'@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@', line)
            if m: old_ln = int(m.group(1))
        elif cur is None or old_ln is None:
            continue
        elif line.startswith('-'):
            touched[cur].add(old_ln); old_ln += 1
        elif line.startswith('+'):
            touched[cur].add(max(1, old_ln - 1)); touched[cur].add(old_ln)  # insertion point straddles
        elif line.startswith('\\'):
            continue
        else:
            old_ln += 1
    return touched

_file_cache = {}
def repo_files(root):
    if root in _file_cache: return _file_cache[root]
    out = []
    for dp, dn, fn in os.walk(root):
        rel = os.path.relpath(dp, root) + '/'
        if rel.startswith('.sweet-search') or any(s in rel for s in SKIP_DIRS):
            dn[:] = []
            continue
        for f in fn:
            if os.path.splitext(f)[1].lower() in SRC_EXT:
                out.append(os.path.join(dp, f))
    _file_cache[root] = out
    return out

_src_cache = {}
def read_src(p):
    if p not in _src_cache:
        try: _src_cache[p] = open(p, encoding='utf-8', errors='replace').read()
        except Exception: _src_cache[p] = ''
    return _src_cache[p]

MATCHER_SKIP = {'toBe', 'toEqual', 'toStrictEqual', 'toHaveLength', 'toBeTruthy', 'toBeFalsy', 'toContain', 'toMatch', 'toThrow',
                'toHaveBeenCalled', 'toHaveBeenCalledWith', 'toBeDefined', 'toBeUndefined', 'toBeNull', 'toMatchObject', 'toMatchSnapshot',
                'equal', 'deepEqual', 'strictEqual', 'ok', 'notEqual', 'deepStrictEqual', 'equals', 'Equal', 'True', 'False', 'NotNull', 'Null',
                'IsTrue', 'IsFalse', 'AreEqual', 'AreNotEqual', 'That', 'Is', 'Should', 'Be', 'BeEquivalentTo', 'Contain', 'HaveCount', 'expect',
                'assert', 'Assert', 'require', 'not', 'to', 'be', 'eql', 'eq', 'length', 'lengthOf', 'includes', 'include', 'have', 'an', 'a',
                'assertEqual', 'assertTrue', 'assertFalse', 'assertIn', 'assertIsNone', 'assertRaises', 'len', 'str', 'list', 'dict', 'set', 'sorted',
                'toString', 'join', 'map', 'filter', 'keys', 'values', 'entries', 'stringify', 'parse', 'JSON', 'Object', 'Array'}

def possibly_empty(arg, caller_body, lang):
    cls = []
    a = arg
    if re.fullmatch(r'\[\s*\]|\{\s*\}|list\(\)|dict\(\)|set\(\)|new List<[^>]*>\(\)|Array\.Empty<[^>]*>\(\)|new \w+\[0\]|Enumerable\.Empty<[^>]*>\(\)', a): cls.append('empty-literal')
    if '||' in a or re.search(r'\bor\b', a) or '??' in a: cls.append('fallback')
    if re.search(r'\.filter\s*\(|\bfilter\s*\(|\.Where\s*\(|\[[^\]]*\bfor\b[^\]]*\bif\b[^\]]*\]|\.findAll\s*\(|\.select\s*\{', a): cls.append('filtered-inline')
    for ident in re.findall(r'(?<![\w$.])([A-Za-z_$][\w$]*)(?![\w$(])', a):
        if ident in ('null', 'undefined', 'true', 'false', 'None', 'True', 'False', 'this', 'self', 'new', 'await', 'return'): continue
        for am in re.finditer(r'(?<![\w$.])' + re.escape(ident) + r'\s*(?::\s*[\w<>\[\]]+)?\s*=\s*([^;\n]+)', caller_body):
            rhs = am.group(1)
            if re.search(r'\.filter\s*\(|\bfilter\s*\(|\.Where\s*\(|\[[^\]]*\bfor\b[^\]]*\bif\b[^\]]*\]', rhs): cls.append(ident + '<-filter')
            if re.fullmatch(r'\s*(\[\s*\]|\{\s*\}|list\(\)|dict\(\)|set\(\)|new List<[^>]*>\(\)|\[\]\s*as\s*\w+(\[\])?)\s*', rhs): cls.append(ident + '<-empty')
            if re.search(r'Object\.keys\(|\.split\(|Object\.values\(|Object\.entries\(', rhs): cls.append(ident + '<-keys/split')
    return sorted(set(cls))

def call_sites(root, files, name, def_path, def_idx, lang):
    """text call sites of `name(` across the repo; returns (nonTest, test, defCount)"""
    pat = re.compile(r'(?<![\w$#])' + re.escape(name) + r'\s*\(')
    if lang == 'jam':
        pat = re.compile(r'(?<![\w.\-])' + re.escape(name) + r'(?![\w.\-])')
    def_pat = re.compile(r'(?:function\s+|def\s+|rule\s+|func\s+(?:\([^)]*\)\s*)?|static\s+|async\s+|public\s+|private\s+|protected\s+|internal\s+|\bfn\s+)' + re.escape(name) + r'\s*[(<]')
    non_test, test, defs = [], [], 0
    for p in files:
        src = read_src(p)
        if name not in src: continue
        defs += len(def_pat.findall(src))
        rel = os.path.relpath(p, root)
        is_test = bool(TEST_MARK.search(rel))
        lines = src.split('\n')
        flang = lang_of(p) or lang
        fns = None
        for m in pat.finditer(src):
            line = src[:m.start()].count('\n') + 1
            if p == def_path and abs((line - 1) - def_idx) <= 1: continue
            # skip definitions of same name
            pre = src[max(0, m.start() - 40):m.start()]
            if re.search(r'(function|def|rule|func|class|static|async|public|private|protected|internal)\s+$', pre) or re.search(r'\bfunc\s+\([^)]*\)\s*$', pre): continue
            if lang != 'jam':
                o = m.end() - 1; c = find_balanced(src, o)
                args = split_args(src[o + 1:c]) if c > 0 else []
            else:
                args = []
            if fns is None: fns = functions_in_file(lines, flang)
            enc = None
            for fname, fparams, s, e in fns:
                if s <= line - 1 <= e and (enc is None or (e - s) < (enc[3] - enc[2])): enc = (fname, fparams, s, e)
            body = '\n'.join(lines[enc[2]:line]) if enc else ''
            site = {'file': rel, 'line': line, 'caller': enc[0] if enc else None, 'args': [' '.join(a.split())[:80] for a in args]}
            if not is_test:
                site['flags'] = [possibly_empty(a, body, flang) for a in args]
                site['possiblyEmpty'] = any(f for f in site['flags'])
                non_test.append(site)
            else:
                # observation-site face: accessors asserted within the next 8 lines
                window = '\n'.join(lines[line - 1:line + 8])
                acc = [x for x in re.findall(r'\.([A-Za-z_]\w*)\s*\(', window) if x != name and x not in MATCHER_SKIP]
                acc += [x for x in re.findall(r'\.([A-Za-z_]\w*)\b(?!\s*\()', window) if x != name and x not in MATCHER_SKIP and len(x) > 2]
                site['assertedAccessors'] = sorted(set(acc))[:8]
                test.append(site)
    return non_test, test, defs

def main():
    os.makedirs(OUT, exist_ok=True)
    cells = []
    summary = collections.Counter()
    for run, harness, mode in RUNS:
        rows = json.load(open(f'{R}/{run}/rows.json'))
        rows = rows if isinstance(rows, list) else rows.get('rows', rows)
        rmap = {}
        for r in rows:
            tid = r.get('taskId') or r.get('instance_id') or r.get('task')
            rmap[(tid, r['arm'], int(r.get('rep', 0)))] = r
        tasks = json.load(open(f'{R}/{run}/sweet/tasks.json'))
        tmeta = {t['instance_id']: (t['repo'], t['base_commit'], t.get('language')) for t in tasks}
        for arm in ('native', 'sweet'):
            for rep in (0, 1, 2):
                pf = f'{R}/{run}/{arm}/patches.json' if rep == 0 else f'{R}/{run}/{arm}/rep-{rep}/patches.json'
                if not os.path.exists(pf): continue
                for entry in json.load(open(pf)):
                    tid = entry['instance_id']
                    if mode == 'drop-repaired-sweet' and arm == 'sweet' and tid in REPAIRED: continue
                    row = rmap.get((tid, arm, rep))
                    repo, sha, lang = tmeta.get(tid, (None, None, None))
                    if not repo: continue
                    root = f'{GOLD}/{repo.replace("/", "__")}@{sha}'
                    patch = entry.get('patch') or ''
                    touched = parse_diff(patch)
                    files = repo_files(root)
                    fn_records = []
                    for rel, lns in touched.items():
                        p = os.path.join(root, rel)
                        flang = lang_of(rel)
                        if not os.path.exists(p) or not flang:
                            fn_records.append({'file': rel, 'unsupportedOrNew': True}); continue
                        src = read_src(p); lines = src.split('\n')
                        for name, params, s, e in enclosing_functions(lines, flang, lns):
                            nt, te, defs = call_sites(root, files, name, p, s, flang)
                            rec = {'file': rel, 'name': name, 'defLine': s + 1, 'params': [x.strip() for x in split_args(params)][:8],
                                   'lang': flang, 'defCount': defs, 'ambiguous': defs > 1 or len(name) < 4,
                                   'nCallSites': len(nt), 'nTestCallSites': len(te),
                                   'nFlaggedCallSites': sum(1 for x in nt if x.get('possiblyEmpty')),
                                   'flaggedCallers': [(x['caller'], x['file'], x['line']) for x in nt if x.get('possiblyEmpty')][:6],
                                   'argShapes': len(set(tuple(x['args']) for x in nt)),
                                   'assertedAccessors': sorted(set(a for x in te for a in x.get('assertedAccessors', [])))[:10],
                                   'isTestFile': bool(TEST_MARK.search(rel))}
                            fn_records.append(rec)
                    cell = {'run': run, 'harness': harness, 'task': tid, 'arm': arm, 'rep': rep, 'lang': lang,
                            'resolved': (row or {}).get('resolved'), 'f2pFrac': (row or {}).get('f2pFrac'),
                            'patchFiles': len(touched), 'functions': fn_records}
                    cells.append(cell)
                    summary[(harness, arm, 'cells')] += 1
    json.dump(cells, open(f'{OUT}/census.json', 'w'), indent=1)
    # summary
    lines_out = []
    def pct(a, b): return f'{a}/{b} = {100.0 * a / b:.1f}%' if b else f'{a}/{b}'
    lines_out.append(f'cells: {len(cells)}')
    for harness in ('codex', 'opencode', 'claude-code'):
        for arm in ('native', 'sweet'):
            cs = [c for c in cells if c['harness'] == harness and c['arm'] == arm]
            for outcome in (True, False):
                oc = [c for c in cs if c['resolved'] is outcome]
                if not oc: continue
                with_fn = [c for c in oc if any('name' in f for f in c['functions'])]
                fire_multi = [c for c in with_fn if any(('name' in f) and not f['ambiguous'] and f['nCallSites'] >= 2 for f in c['functions'])]
                fire_single = [c for c in with_fn if any(('name' in f) and not f['ambiguous'] and f['nCallSites'] == 1 and not f['isTestFile'] for f in c['functions'])]
                fire_flag = [c for c in with_fn if any(('name' in f) and not f['ambiguous'] and f['nFlaggedCallSites'] >= 1 for f in c['functions'])]
                fire_test = [c for c in with_fn if any(('name' in f) and not f['ambiguous'] and f['nTestCallSites'] >= 1 and f['assertedAccessors'] for f in c['functions'])]
                lines_out.append(f'{harness:12s} {arm:7s} resolved={outcome!s:5s} n={len(oc):3d} editedFnFound={pct(len(with_fn), len(oc))} '
                                 f'callers>=2={pct(len(fire_multi), len(oc))} single-caller={pct(len(fire_single), len(oc))} '
                                 f'possiblyEmptyArg={pct(len(fire_flag), len(oc))} testObserved={pct(len(fire_test), len(oc))}')
    # per task view for the ten wrongfix tasks
    lines_out.append('')
    lines_out.append('per-task: cells | editedFnFound | callers>=2 | single | possiblyEmpty | testObserved | example functions')
    for tid in sorted(set(c['task'] for c in cells)):
        cs = [c for c in cells if c['task'] == tid]
        wf = [c for c in cs if any('name' in f for f in c['functions'])]
        mult = [c for c in wf if any('name' in f and not f['ambiguous'] and f['nCallSites'] >= 2 for f in c['functions'])]
        sing = [c for c in wf if any('name' in f and not f['ambiguous'] and f['nCallSites'] == 1 and not f['isTestFile'] for f in c['functions'])]
        flg = [c for c in wf if any('name' in f and not f['ambiguous'] and f['nFlaggedCallSites'] >= 1 for f in c['functions'])]
        tst = [c for c in wf if any('name' in f and not f['ambiguous'] and f['nTestCallSites'] >= 1 and f['assertedAccessors'] for f in c['functions'])]
        names = collections.Counter(f['name'] for c in cs for f in c['functions'] if 'name' in f)
        lines_out.append(f'{tid:42s} {len(cs):3d} | {len(wf):3d} | {len(mult):3d} | {len(sing):3d} | {len(flg):3d} | {len(tst):3d} | {names.most_common(4)}')
    lines_out.append('')
    lines_out.append('detail (first cell per task/arm with a non-ambiguous edited function):')
    seen = set()
    for c in cells:
        for f in c['functions']:
            if 'name' not in f or f['ambiguous']: continue
            key = (c['task'], f['name'])
            if key in seen: continue
            seen.add(key)
            lines_out.append(f"  {c['task'][:34]:34s} {f['file'][-40:]:40s} {f['name']:28s} def={f['defLine']:5d} callers={f['nCallSites']:3d} test={f['nTestCallSites']:3d} flagged={f['nFlaggedCallSites']} shapes={f['argShapes']} defs={f['defCount']} asserted={f['assertedAccessors'][:6]}")
    open(f'{OUT}/census-summary.txt', 'w').write('\n'.join(lines_out) + '\n')
    print('\n'.join(lines_out))

if __name__ == '__main__':
    main()
