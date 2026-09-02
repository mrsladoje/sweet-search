"""Face (b) prototype: for a JS/TS method, list every call site, the argument expression bound to each
parameter, and a possibly-empty classification for collection arguments. Base tree only; no task knowledge
except the (file, method) pair handed in. Usage: binding_face.py <file> <methodName>"""
import re, sys, json

path, name = sys.argv[1], sys.argv[2]
src = open(path, encoding='utf-8', errors='replace').read()
lines = src.split('\n')

def find_balanced(s, i):
    """s[i] == '('; return index of matching ')' honoring strings/templates."""
    depth = 0; j = i; instr = None
    while j < len(s):
        c = s[j]
        if instr:
            if c == '\\': j += 2; continue
            if c == instr: instr = None
        elif c in '\'"`': instr = c
        elif c == '(': depth += 1
        elif c == ')':
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
        if c in '([{': depth += 1
        if c in ')]}': depth -= 1
        if c == ',' and depth == 0: out.append(cur.strip()); cur = ''; continue
        cur += c
    if cur.strip(): out.append(cur.strip())
    return out

# definition
mdef = None
for cand in re.finditer(r'^[ \t]*(?:export\s+)?(?:static\s+)?(?:async\s+)?(?:function\s+)?' + re.escape(name) + r'\s*\(', src, re.M):
    c = find_balanced(src, cand.end()-1)
    if c > 0 and re.match(r'\s*(?::\s*[\w<>\[\]|, ]+)?\s*\{', src[c+1:c+80]):
        mdef = cand; break
if not mdef: print('definition not found'); sys.exit(1)
dstart = mdef.end() - 1; dend = find_balanced(src, dstart)
params = [p.split('=')[0].strip() for p in split_args(src[dstart+1:dend])]
defline = src[:mdef.start()].count('\n') + 1
print(json.dumps({'method': name, 'defLine': defline, 'params': params}))

# enclosing function name for a position: nearest preceding 'static async name(' or 'name(' at method indent
methre = re.compile(r'^\s{4}(?:static\s+)?(?:async\s+)?(#?[A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{', re.M)
methods = [(m.start(), m.group(1)) for m in methre.finditer(src)]
def enclosing(pos):
    best = None
    for s, n in methods:
        if s <= pos: best = (s, n)
        else: break
    return best

# call sites
calls = []
for m in re.finditer(r'(?<![\w$#])' + re.escape(name) + r'\s*\(', src):
    if m.start() == mdef.start() or (mdef.start() <= m.start() <= mdef.end()): continue
    o = m.end() - 1; c = find_balanced(src, o)
    if c < 0: continue
    args = split_args(src[o+1:c])
    line = src[:m.start()].count('\n') + 1
    enc = enclosing(m.start())
    encname, encstart = (enc[1], enc[0]) if enc else ('?', 0)
    body = src[encstart:m.start()]
    bindings = []
    for i, a in enumerate(args):
        p = params[i] if i < len(params) else f'arg{i}'
        cls = []
        if re.fullmatch(r'[\'"`].*[\'"`]', a): cls.append('literal')
        if '||' in a: cls.append('fallback-or')
        if re.fullmatch(r'\[\s*\]', a): cls.append('empty-literal')
        # resolve simple identifiers in the arg to their assignments inside the enclosing body
        for ident in re.findall(r'(?<![\w$.])([A-Za-z_$][\w$]*)(?![\w$(])', a):
            if ident in ('null','undefined','true','false'): continue
            for am in re.finditer(r'(?<![\w$.])' + re.escape(ident) + r'\s*=\s*([^;\n]+)', body):
                rhs = am.group(1)
                if re.search(r'\.filter\s*\(', rhs): cls.append(f'{ident}<-filter')
                if re.fullmatch(r'\[\s*\]\s*', rhs): cls.append(f'{ident}<-[]')
                if 'Object.keys(' in rhs: cls.append(f'{ident}<-Object.keys')
            if re.search(r'(?<![\w$.])' + re.escape(ident) + r'\s*\.push\s*\(', body): cls.append(f'{ident}.push')
        possibly_empty = any(('filter' in x) or ('<-[]' in x) or x == 'empty-literal' for x in cls)
        bindings.append({'param': p, 'expr': ' '.join(a.split()), 'class': sorted(set(cls)), 'possiblyEmptyCollection': possibly_empty})
    calls.append({'line': line, 'caller': encname, 'bindings': bindings})
print(json.dumps({'callSites': len(calls)}))
for c in calls: print(json.dumps(c))
