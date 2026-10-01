#!/usr/bin/env python3
"""analyze_hard.py - deterministic per-tool statistics on the r3-HARD retrieval questions, with gold.

  python3 analyze_hard.py [--no-dossiers] [--only TAGSUBSTR]

READ-ONLY on every source. No network, no model call, no ss-* call, no daemon.

Inputs
  rows      <root>/core/prompt-optimization/data/results/r282-<cell>-<tag>/runs.jsonl  (+ captures/<arm>.<id>.json)
            roots: the final-tuning worktree and the ft-fixes worktree (runs launched from either)
  sessions  ~/.ss-eval/r282/<cell>-<tag>/  (Claude Code jsonl, Codex rollout jsonl, opencode sqlite; copied before reading)
  gold      final-tuning/r3/r3-hard-probes.json (hard), final-tuning/r3/r3-probes.json (easy contrast)
Runs studied
  hard : tags r3h-* and fx-*      (DEV probes only)
  easy : tags containing r3dev    (DEV probes only; contrast)
  NEVER: tags ho-* and any row whose probe has set != 'dev' (counted, never opened)
Outputs
  final-tuning/forensics/STATS-HARD.md
  final-tuning/forensics/hard-dossiers/<cell>-<tag>.<arm>.jsonl   one record per tool call (+ one rollout record)

Re-runnable: partial runs are fine (only finished rows are used; every table prints n).
"""
import argparse
import difflib
import glob
import json
import math
import os
import random
import re
import shutil
import sqlite3
import sys
from collections import Counter, defaultdict, OrderedDict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fx_lib as fx  # noqa: E402
import ss_parse as P  # noqa: E402
import build_dossiers as BD  # noqa: E402

W = os.path.abspath(os.path.join(HERE, '..'))
ROOTS = [
    ('final-tuning', '/Users/admin/Projects/sweet-search-final-tuning/core/prompt-optimization/data/results'),
    ('ft-fixes', '/Users/admin/Projects/sweet-search-ft-fixes/core/prompt-optimization/data/results'),
]
STATE = os.path.expanduser('~/.ss-eval/r282')
HARD_PROBES = os.path.join(W, 'r3/r3-hard-probes.json')
EASY_PROBES = os.path.join(W, 'r3/r3-probes.json')
OUT_MD = os.path.join(HERE, 'STATS-HARD.md')
OUT_DOSS = os.path.join(HERE, 'hard-dossiers')

CELLS = {  # runner cell -> harness, price (ideal-cost.mjs MODEL_PRICES, USD per 1M tokens), label
    'cc-opus55-medium': ('cc', {'in': 4.0, 'cache': 0.20, 'out': 20.0}, 'Claude Code + Opus 5.5 medium'),
    'cc-sonnet55-high': ('cc', {'in': 2.0, 'cache': 0.20, 'out': 10.0}, 'Claude Code + Sonnet 5.5 high'),
    'codex-sol61-high': ('codex', {'in': 2.0, 'cache': 0.10, 'out': 10.0}, 'Codex + GPT-6.1 Sol high'),
    'oc-sol61-high': ('opencode', {'in': 2.0, 'cache': 0.10, 'out': 10.0}, 'opencode + GPT-6.1 Sol high'),
}
CORRECT = 0.8          # a rollout counts as "correct" when the judge-panel score >= this
SMALL = 20             # shares resting on fewer items get a dagger
SS_ORDER = ['ss-search', 'ss-find', 'ss-trace', 'ss-semantic', 'ss-read', 'ss-grep', 'ss-batch']
BUCKETS = SS_ORDER + ['native-search', 'native-read', 'other']
SEARCH_TYPE = {'ss-search', 'ss-find', 'ss-semantic', 'ss-trace', 'ss-grep', 'native-search'}
READ_TYPE = {'ss-read', 'native-read'}

# ----------------------------------------------------------------------------------------------
# small helpers
# ----------------------------------------------------------------------------------------------
def jl(path):
    out = []
    with open(path, encoding='utf-8', errors='replace') as fh:
        for ln in fh:
            ln = ln.strip()
            if ln:
                try:
                    out.append(json.loads(ln))
                except Exception:
                    pass
    return out


def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def f2(x, nd=2):
    return '-' if x is None else f'{x:.{nd}f}'


def fd(x, nd=4):
    return '-' if x is None else f'${x:.{nd}f}'


def pc(a, b, nd=1):
    if not b:
        return '-'
    s = f'{100.0 * a / b:.{nd}f}%'
    return s + ('†' if b < SMALL else '')


def kfmt(x):
    if x is None:
        return '-'
    return f'{x:,.0f}'


def pm(a, b):
    """Share of a dollar amount (no small-n dagger: the denominator is money, not a count)."""
    return f'{100.0 * a / b:.1f}%' if b else '-'


def md_table(h, rows):
    out = ['| ' + ' | '.join(h) + ' |', '|' + '|'.join(['---'] * len(h)) + '|']
    for r in rows:
        out.append('| ' + ' | '.join(str(c) for c in r) + ' |')
    return '\n'.join(out)


def boot_ci(diffs, B=5000, seed=42):
    if len(diffs) < 2:
        return None, None
    rnd = random.Random(seed)
    n = len(diffs)
    ms = sorted(sum(diffs[rnd.randrange(n)] for _ in range(n)) / n for _ in range(B))
    return ms[int(0.025 * B)], ms[int(0.975 * B) - 1]


REPO_PREFIX = re.compile(r'^.*?/eval__repos__[^/]+/')


def normp(p):
    p = (p or '').strip().strip('\'"`')
    p = REPO_PREFIX.sub('', p)
    while p.startswith('./'):
        p = p[2:]
    return p


def path_rx(g):
    return re.compile(r'(?<![\w.-])' + re.escape(g) + r'(?![\w-])')


def sym_key(s):
    """Last component of a gold symbol (Server.UpdateX -> UpdateX, a::b -> b, A#b -> b)."""
    parts = re.split(r'::|\.|#|->', s)
    parts = [x for x in parts if x]
    return parts[-1] if parts else s


def word_rx(w):
    return re.compile(r'(?<![A-Za-z0-9_])' + re.escape(w) + r'(?![A-Za-z0-9_])')


# ----------------------------------------------------------------------------------------------
# probes / gold
# ----------------------------------------------------------------------------------------------
def load_probes():
    probes = {}
    for diff, f in (('hard', HARD_PROBES), ('easy', EASY_PROBES)):
        d = json.load(open(f))
        for p in (d['probes'] if isinstance(d, dict) else d):
            p = dict(p)
            p['_difficulty'] = diff
            p['_group'] = p.get('group') or ('B' if p['id'].startswith('r3hb-') else 'A')
            files = [normp(x) for x in p.get('expectedFiles') or []]
            p['_goldFiles'] = files
            p['_goldFileRx'] = {g: path_rx(g) for g in files}
            p['_goldBaseRx'] = {g: word_rx(os.path.basename(g)) for g in files}
            syms = p.get('expectedSymbols') or []
            p['_goldSyms'] = syms
            p['_goldSymRx'] = {s: word_rx(sym_key(s)) for s in syms}
            probes[p['id']] = p
    return probes


def gold_files_in(p, text):
    return {g for g, rx in p['_goldFileRx'].items() if rx.search(text or '')}


def gold_syms_in(p, text):
    return {s for s, rx in p['_goldSymRx'].items() if rx.search(text or '')}


def gold_files_named(p, answer):
    a = answer or ''
    return {g for g in p['_goldFiles'] if p['_goldFileRx'][g].search(a) or p['_goldBaseRx'][g].search(a)}


# ----------------------------------------------------------------------------------------------
# run discovery
# ----------------------------------------------------------------------------------------------
def classify_tag(tag):
    if tag.startswith('ho-') or 'heldout' in tag:
        return None
    if tag.startswith('r3h') or tag.startswith('fx-'):   # r3h-pilot-*, r3hdev-*, fx-*
        return 'hard'
    if 'r3dev' in tag:
        return 'easy'
    return None


def arm_label(tag, arm, cell=None):
    if arm == 'native':
        return 'native'
    t = tag.lower()
    if cell is None:
        cell = 'cc' if t.startswith(('r3h-', 'co-', 'fx-op')) else 'x'
    if not cell.startswith('cc'):
        # Codex / opencode have no V1b: their shipped sweet arm is the 2.8.2 product output + rules
        return 'sweet+FixA' if arm == 'sweetB' and re.search(r'-a$', t) else 'sweet shipped (2.8.2)'
    if t.endswith('v1ba'):
        return 'sweet V1b+FixA'
    if 'v1b' in t:
        return 'sweet V1b'
    if re.search(r'-a$', t):
        return 'sweet+FixA' if arm == 'sweetB' else 'sweet shipped'
    if 'r3dev-sw' in t or 'r3dev-ns' in t:
        return 'sweet 2.8.2'
    return arm


def discover():
    runs = []
    seen = set()
    for rname, root in ROOTS:
        for d in sorted(glob.glob(os.path.join(root, 'r282-*'))):
            name = os.path.basename(d)[len('r282-'):]
            cell = next((c for c in CELLS if name.startswith(c + '-')), None)
            if not cell:
                continue
            tag = name[len(cell) + 1:]
            diff = classify_tag(tag)
            if not diff or not os.path.exists(os.path.join(d, 'runs.jsonl')):
                continue
            key = (cell, tag)
            if key in seen:
                continue
            seen.add(key)
            runs.append({'cell': cell, 'tag': tag, 'difficulty': diff, 'root': rname, 'dir': d,
                         'state': os.path.join(STATE, f'{cell}-{tag}'), 'harness': CELLS[cell][0]})
    return runs


# ----------------------------------------------------------------------------------------------
# session indexing (per run, per arm-store)
# ----------------------------------------------------------------------------------------------
def _cc_meta(path):
    usage, first_user = {}, None
    for d in jl(path):
        m = d.get('message') or {}
        if d.get('type') == 'user' and first_user is None and not d.get('isMeta'):
            c = m.get('content')
            if isinstance(c, str):
                first_user = c
            elif isinstance(c, list):
                t = ''.join(b.get('text', '') for b in c if isinstance(b, dict) and b.get('type') == 'text')
                if t.strip():
                    first_user = t
        if d.get('type') == 'assistant' and m.get('id') and m.get('usage'):
            u = m['usage']
            cr, cw = u.get('cache_read_input_tokens') or 0, u.get('cache_creation_input_tokens') or 0
            rec = {'fresh': u.get('input_tokens') or 0, 'cacheRead': cr, 'cacheWrite': cw, 'out': u.get('output_tokens') or 0}
            tot = rec['fresh'] + cr + cw + rec['out']
            if m['id'] not in usage or tot > usage[m['id']]['_t']:
                rec['_t'] = tot
                usage[m['id']] = rec
    return first_user or '', usage


def index_cc(state, arm):
    out = []
    for f in sorted(glob.glob(os.path.join(state, f'claude-home-{arm}', 'projects', '*', '*.jsonl'))):
        first_user, usage = _cc_meta(f)
        threads = fx.read_claude(f)
        for th in threads:
            for rq in th['requests']:
                rq['usage'] = usage.get(rq['id'])
        # subagent files: read usage per file
        sub = os.path.join(os.path.splitext(f)[0], 'subagents')
        if os.path.isdir(sub):
            for th in threads[1:]:
                for sf in glob.glob(os.path.join(sub, 'agent-*.jsonl')):
                    _, su = _cc_meta(sf)
                    for rq in th['requests']:
                        if rq['id'] in su:
                            rq['usage'] = su[rq['id']]
        out.append({'file': f, 'user': first_user, 'threads': threads})
    return out


_DEC = json.JSONDecoder()


def unwrap_codex(s):
    """Codex 0.159 returns each command result as a JSON object {chunk_id, wall_time_seconds, exit_code,
    original_token_count, output}. -> (inner text, [exit codes], ok). The model sees the JSON form."""
    if not isinstance(s, str):
        return s, [], False
    t = s.strip()
    if not t.startswith('{') or '"output"' not in t[:400]:
        return s, [], False
    outs, codes, i = [], [], 0
    try:
        while i < len(t):
            while i < len(t) and t[i] in ' \n\r\t':
                i += 1
            if i >= len(t):
                break
            obj, i = _DEC.raw_decode(t, i)
            if not isinstance(obj, dict) or 'output' not in obj:
                return s, [], False
            outs.append(obj.get('output') or '')
            codes.append(obj.get('exit_code'))
    except Exception:
        return s, [], False
    inner = ''
    for o in outs:
        inner += ('' if (not inner or inner.endswith('\n')) else '\n') + o
    return inner, codes, True


def unwrap_codex_unit(u):
    out = u.get('output')
    vis = len(out) if isinstance(out, str) else 0
    inner, codes, ok = unwrap_codex(out)
    if ok:
        u['output'] = inner
        u['exitCodes'] = codes
        if any(c not in (0, None) for c in codes) and len(codes) == 1 and len(u.get('commands') or []) <= 1:
            u['nonzeroExit'] = True
    per = u.get('perCmdOutputs')
    if per:
        u['perCmdOutputs'] = [unwrap_codex(p)[0] for p in per]
    u['_scale'] = (vis / len(u['output'])) if ok and u.get('output') else 1.0


def index_codex(state):
    out = []
    for f in sorted(glob.glob(os.path.join(state, 'codex-home', 'sessions', '**', '*.jsonl'), recursive=True)):
        users = []
        for d in jl(f):
            p = d.get('payload') or {}
            if d.get('type') == 'response_item' and p.get('type') == 'message' and p.get('role') == 'user':
                users.append(''.join((c.get('text') or '') for c in p.get('content') or [] if isinstance(c, dict)))
        user = next((u for u in users if 'Question: ' in u), '\n'.join(users))
        threads = fx.read_codex(f)
        for rq in threads[0]['requests']:
            for u in rq['units']:
                unwrap_codex_unit(u)
            u = rq.get('usage')
            if u:
                inp, cached = u.get('input_tokens') or 0, u.get('cached_input_tokens') or 0
                cw = u.get('cache_write_input_tokens') or 0
                rq['usage'] = {'fresh': max(inp - cached - cw, 0), 'cacheRead': cached, 'cacheWrite': cw, 'out': u.get('output_tokens') or 0}
        out.append({'file': f, 'user': user, 'threads': threads})
    return out


def index_opencode(state, store):
    dbdir = os.path.join(state, f'oc-data-{store}')
    if not os.path.exists(os.path.join(dbdir, 'opencode.db')):
        return []
    tmp = fx._copy_db(dbdir)
    users = {}
    try:
        db = sqlite3.connect(os.path.join(tmp, 'opencode.db'))
        rows = db.execute('select m.session_id, m.id, m.data from message m order by m.time_created').fetchall()
        user_msgs = OrderedDict()
        for sid, mid, data in rows:
            try:
                md = json.loads(data)
            except Exception:
                continue
            if md.get('role') == 'user' and sid not in user_msgs:
                user_msgs[sid] = mid
        for sid, mid in user_msgs.items():
            txt = []
            for (pd,) in db.execute('select data from part where message_id=? order by time_created,id', (mid,)):
                try:
                    pj = json.loads(pd)
                except Exception:
                    continue
                if pj.get('type') == 'text':
                    txt.append(pj.get('text') or '')
            users[sid] = '\n'.join(txt)
        db.close()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    threads = fx.read_opencode(dbdir)
    for th in threads:
        for rq in th['requests']:
            tk = rq.get('tokens') or {}
            c = tk.get('cache') or {}
            rq['usage'] = {'fresh': tk.get('input') or 0, 'cacheRead': c.get('read') or 0, 'cacheWrite': c.get('write') or 0,
                           'out': (tk.get('output') or 0) + (tk.get('reasoning') or 0)} if tk else None
    by_sid = {th['sessionId']: th for th in threads}
    out = []
    for th in threads:
        if th['thread'] != 'main':
            continue
        side = [t for t in threads if t.get('parent') == th['sessionId']]
        out.append({'file': f"{dbdir}#{th['sessionId']}", 'user': users.get(th['sessionId'], ''), 'threads': [th] + side})
    return out


def final_answer(threads):
    for rq in reversed(threads[0]['requests']):
        t = (rq.get('text') or '').strip()
        t = re.sub(r'\[state_summary\][^\n]*', '', t).strip()
        if t:
            return t
    return ''


def norm_ws(s):
    return re.sub(r'\s+', ' ', (s or '')).strip()


def join_sessions(run, rows, probes, caps):
    """-> {(arm,id): session} ; each session used once; answer text decides between candidates."""
    h = run['harness']
    stores = {}
    if h == 'cc':
        for arm in sorted({r['arm'] for r in rows}):
            stores[arm] = index_cc(run['state'], arm)
    elif h == 'codex':
        allc = index_codex(run['state'])
        for arm in {r['arm'] for r in rows}:
            stores[arm] = allc
    else:
        cache = {}
        for arm in {r['arm'] for r in rows}:
            st = 'native' if arm == 'native' else 'sweet'
            if st not in cache:
                cache[st] = index_opencode(run['state'], st)
            stores[arm] = cache[st]
    used = set()
    joined, problems = {}, []
    # score every (row, candidate) pair, then assign greedily best-first
    pairs = []
    for r in rows:
        p = probes[r['id']]
        q = norm_ws(p['query'])
        cap = caps.get((r['arm'], r['id'])) or {}
        ans = norm_ws(cap.get('answer') or '')
        cands = [s for s in stores.get(r['arm'], []) if q and q in norm_ws(s['user'])]
        if not cands:
            problems.append(f"{r['arm']}|{r['id']}: no session with the question text")
            continue
        for s in cands:
            fa = norm_ws(final_answer(s['threads']))
            if ans and fa == ans:
                sc = 1.0
            elif ans and fa:
                sc = difflib.SequenceMatcher(None, ans[:3000], fa[:3000], autojunk=False).ratio()
            else:
                sc = 0.3 if len(cands) == 1 else 0.0
            pairs.append((sc, r['arm'], r['id'], s['file'], s))
    pairs.sort(key=lambda x: -x[0])
    for sc, arm, pid, fid, s in pairs:
        if (arm, pid) in joined or fid in used:
            continue
        if sc < 0.5:
            continue
        joined[(arm, pid)] = dict(s, joinScore=sc)
        used.add(fid)
    for r in rows:
        if (r['arm'], r['id']) not in joined and not any(x.startswith(f"{r['arm']}|{r['id']}:") for x in problems):
            problems.append(f"{r['arm']}|{r['id']}: no session whose final answer matches the capture (best < 0.5)")
    return joined, problems


# ----------------------------------------------------------------------------------------------
# per-call analysis
# ----------------------------------------------------------------------------------------------
def bucket_of(c):
    if c['cls'] == 'ss':
        return c['tool'] if c['tool'] in SS_ORDER else 'ss-batch'
    if c['cls'] in ('native-search', 'native-read'):
        return c['cls']
    return 'other'


GUT = re.compile(r'^\s*(\d+)(?:\t|→|\| |: |:\t)')


def native_read_file(c):
    args = c['args'] or ''
    if c.get('boundary') == 'native':
        return normp(args.split(' {')[0])
    words = fx._words(args)
    cand = [w for w in words[1:] if not w.startswith('-') and re.search(r'\.[A-Za-z0-9]{1,8}$', w) and not re.fullmatch(r'[\d,$]+p', w)]
    return normp(cand[-1]) if cand else None


def native_read_span(c, text):
    """(file, a, b) for a native read, or None. Line numbers come from a gutter (Read, nl -ba, cat -n) when
    most lines carry one, else from the command (sed -n 'A,Bp', head -n N, awk NR ranges, plain cat)."""
    tool = (c['tool'] or '')
    args = c['args'] or ''
    f = native_read_file(c)
    if not f:
        return None
    body = [ln for ln in (text or '').split('\n') if ln.strip()]
    ms = [GUT.match(ln) for ln in body]
    nums = [int(m.group(1)) for m in ms if m]
    if body and len(nums) >= 0.6 * len(body):
        return f, min(nums), max(nums)
    if c.get('boundary') == 'native':
        off = 1
        m = re.search(r'"(?:offset|startLine)":\s*(\d+)', args)
        if m:
            off = max(int(m.group(1)), 1)
        return f, off, off + max(len(body), 1) - 1
    if tool == 'sed':
        m = re.search(r"(\d+)\s*,\s*(\d+)\s*p", args)
        return (f, int(m.group(1)), int(m.group(2))) if m else None
    if tool == 'head':
        m = re.search(r'-n\s*(\d+)|-(\d+)\b', args)
        return f, 1, int(m.group(1) or m.group(2)) if m else 10
    if tool == 'awk':
        m = re.search(r'NR\s*>=?\s*(\d+)\s*&&\s*NR\s*<=?\s*(\d+)', args)
        return (f, int(m.group(1)), int(m.group(2))) if m else None
    if tool in ('cat', 'bat') and not c.get('piped'):
        return f, 1, max(len((text or '').split('\n')), 1)
    return None


def read_target(c):
    """Normalised file path a read-type call targets (or None)."""
    if c['bucket'] == 'ss-read':
        ws = fx._words(c['args'] or '')
        for w in ws[1:]:
            if not w.startswith('-'):
                return normp(w)
        return None
    if c['bucket'] == 'native-read':
        sp = c.get('_span')
        if sp:
            return sp[0]
        return native_read_file(c)
    return None


def code_spans(c, text):
    """List of (file, a, b) code spans shown by the call."""
    b = c['bucket']
    out = []
    try:
        if b in ('ss-search', 'ss-find'):
            for e in light_parse(text)['entries']:
                if not e['has_code']:
                    continue
                if e['lines']:
                    out.append((normp(e['file']), min(e['lines']), max(e['lines'])))
                else:
                    out.append((normp(e['file']), e['a'], e['b']))
        elif b == 'ss-read':
            r = P.parse_read(text)
            for s in r['shown']:
                ls = [ln for ln, _ in s['lines'] if ln is not None]
                if ls:
                    out.append((normp(s['file']), min(ls), max(ls)))
                elif s.get('start'):
                    out.append((normp(s['file']), s['start'], s['end']))
        elif b == 'ss-semantic':
            r = P.parse_semantic(text)
            for s in r['shown']:
                out.append((normp(s['file']), s['start'], s['end']))
        elif b == 'native-read':
            sp = native_read_span(c, text)
            if sp:
                out.append(sp)
    except Exception:
        pass
    return out


LIGHT_RANK = re.compile(r'^## #(\d+) (\S+?):(\d+)-(\d+)\b')
LIGHT_GUT = re.compile(r'^\s*(\d+)(?::|\t)')


def light_parse(text):
    """Format-independent reader of ss-search / ss-find output (shipped AND Bundle A headers).
    -> entries [{file, a, b, has_code, lines}], code chars (fenced code incl. continuation), import chars, total."""
    entries, cur = [], None
    code = imports = 0
    in_fence, fence_role, prev = False, None, ''
    for ln in (text or '').split('\n'):
        n = len(ln) + 1
        if in_fence:
            if ln.startswith('```'):
                in_fence = False
                if fence_role == 'imports':
                    imports += n
                else:
                    code += n
                continue
            if fence_role == 'imports':
                imports += n
            else:
                code += n
                if cur is not None:
                    m = LIGHT_GUT.match(ln)
                    if m:
                        cur['lines'].append(int(m.group(1)))
            continue
        if ln.startswith('```'):
            in_fence = True
            fence_role = 'imports' if prev.strip() == '### imports' else 'code'
            if fence_role == 'imports':
                imports += n
            else:
                code += n
                if cur is not None and not cur['has_code']:
                    cur['has_code'] = True
            prev = ln
            continue
        m = LIGHT_RANK.match(ln)
        if m:
            cur = {'file': m.group(2), 'a': int(m.group(3)), 'b': int(m.group(4)), 'has_code': False, 'lines': []}
            entries.append(cur)
        elif ln.startswith('# continues at') or ln.startswith('# ss-') or ln.startswith('## '):
            pass
        prev = ln
    return {'entries': entries, 'code': code, 'imports': imports, 'total': len(text or '')}


def shown_listed(c, text, p):
    """Gold files surfaced WITH code vs only listed (paths / grep lines)."""
    hit = gold_files_in(p, text)
    shown = set()
    b = c['bucket']
    if b in ('ss-search', 'ss-find'):
        for e in light_parse(text)['entries']:
            if e['has_code']:
                f = normp(e['file'])
                shown |= {g for g in p['_goldFiles'] if f == g or f.endswith('/' + g) or g.endswith('/' + f)}
    elif b in ('ss-read', 'native-read', 'ss-semantic'):
        for f, _, _ in c.get('_spans') or []:
            shown |= {g for g in p['_goldFiles'] if f == g or f.endswith('/' + g) or g.endswith('/' + f)}
        t = read_target(c)
        if t:
            shown |= {g for g in p['_goldFiles'] if t == g or t.endswith('/' + g) or g.endswith('/' + t)}
    hit |= shown
    return hit, shown, hit - shown


ERR_RX = re.compile(r'^\[ss-\w+\]|^Usage: |unknown (option|flag)|invalid (option|argument)|error: unexpected argument|command not found|No such file or directory', re.M)
USAGE_RX = re.compile(r'Usage: |unknown (option|flag)|invalid (option|argument)|unexpected argument|requires an argument|missing (required )?argument', re.I)


def call_kind(c, text):
    if c['cls'] == 'ss' and c.get('_nonzeroExit') and not (text or '').lstrip().startswith('#'):
        k = 'error'
    elif c['cls'] == 'ss':
        k = BD.output_kind(c['tool'], text, c.get('boundary'), c.get('neverCollected'), c.get('redirected'))
    else:
        t = text or ''
        if c.get('isError') and ERR_RX.search(t):
            k = 'error'
        elif not t.strip():
            k = 'empty' if c['bucket'] == 'native-search' else 'empty-output'
        elif ERR_RX.search(t[:400]):
            k = 'error'
        else:
            k = 'ok'
    usage_err = bool(USAGE_RX.search((text or '')[:600]))
    return k, usage_err


SEARCH_BUCKET_GROUPS = OrderedDict([
    ('code', ['code_text', 'code_gutter', 'code_fence_markers', 'continuation_code']),
    ('imports', ['imports']),
    ('rank lines (path, range, symbol, kind)', ['rank_overhead', 'rank_path_range', 'rank_symbol', 'rank_presentation']),
    ('score', ['rank_score']),
    ('header + confidence/sufficient lines', ['header_meta', 'header_confidence', 'header_other']),
    ('route trailer', ['route_trailer']),
    ('shown-full trailer', ['shown_full']),
    ('summary lines', ['summary_lines']),
    ('related / same-file / sibling / family / continuation line', ['related', 'same_file_map', 'sibling_line', 'family_manifest', 'continuation_line']),
    ('blank / other', ['blank', 'other']),
])


GREP_LINE = re.compile(r'^(?:\.?/?[\w@.+-]+(?:/[\w@.+-]+)*\.\w{1,10}(?:[:-]\d+[:-]|:\d*$|$)|\d+[:-]|--$)')


def _read_len(c):
    a = c['args'] or ''
    if c['tool'] == 'sed':
        m = re.search(r"(\d+)\s*,\s*(\d+)\s*p", a)
        return int(m.group(2)) - int(m.group(1)) + 1 if m else None
    if c['tool'] == 'head':
        m = re.search(r'-n\s*(\d+)|-(\d+)\b', a)
        return int(m.group(1) or m.group(2)) if m else 10
    if c['tool'] == 'awk':
        m = re.search(r'NR\s*>=?\s*(\d+)\s*&&\s*NR\s*<=?\s*(\d+)', a)
        return int(m.group(2)) - int(m.group(1)) + 1 if m else None
    return None


def split_native_unit(cs, out):
    """Chained native commands share one output. Split it by line shape: a search segment takes the
    following grep-shaped lines (path:line:, path-line-, bare paths, --), a read segment takes its sed/head
    range (or the lines up to the next grep-shaped line). -> list of texts aligned to cs, or None."""
    lines = (out or '').split('\n')
    if lines and lines[-1] == '':
        lines = lines[:-1]
    i, parts = 0, []
    for k, c in enumerate(cs):
        last = k == len(cs) - 1
        start = i
        if last:
            i = len(lines)
        elif c['bucket'] == 'native-search':
            while i < len(lines) and GREP_LINE.match(lines[i]):
                i += 1
        elif c['bucket'] == 'native-read':
            n = _read_len(c)
            nxt_search = cs[k + 1]['bucket'] == 'native-search'
            if n is not None:
                j = i
                while j < len(lines) and j - i < n and not (nxt_search and j > i and GREP_LINE.match(lines[j]) and re.match(r'^\S+\.\w+:\d+', lines[j])):
                    j += 1
                i = j
            elif nxt_search:
                while i < len(lines) and not re.match(r'^\S+\.\w+:\d+', lines[i]):
                    i += 1
            else:
                return None
        elif c['tool'] == 'pwd':
            i = min(i + 1, len(lines))
        else:
            return None
        parts.append('\n'.join(lines[start:i]) + ('\n' if i > start else ''))
    return parts


def analyze_rollout(run, row, probe, sess, cap):
    h = run['harness']
    threads = sess['threads']
    calls_all, reqs_all = [], []
    for ti, th in enumerate(threads):
        calls, units = BD.flatten_thread(h, th)
        BD.attach_context(calls, th['requests'])
        for c in calls:
            c['thread'] = th['thread']
        calls_all.extend(calls)
        reqs_all.extend(th['requests'])
    main_calls = [c for c in calls_all if c['thread'] == 'main']
    answer = (cap or {}).get('answer') or final_answer(threads)
    ans_files = gold_files_named(probe, answer)
    ans_syms = gold_syms_in(probe, answer)
    # per-call fields
    scale, nz = {}, set()
    for th in threads:
        for rq in th['requests']:
            for u in rq['units']:
                scale[(th['thread'], u['id'])] = u.get('_scale', 1.0)
                if u.get('nonzeroExit'):
                    nz.add((th['thread'], u['id']))
    shared_units = defaultdict(list)
    for c in calls_all:
        if c.get('sharedOutput'):
            shared_units[(c['thread'], c['unitId'])].append(c)
    for c in calls_all:
        c['bucket'] = bucket_of(c)
    for key, cs in shared_units.items():
        if any(x['cls'] == 'ss' for x in calls_all if (x['thread'], x['unitId']) == key):
            continue
        parts = split_native_unit(cs, cs[0].get('_unitOut') or '')
        for c, ptxt in zip(cs, parts or []):
            c['_splitText'] = ptxt
        if not parts:
            for c in cs:
                c['splitApprox'] = True
    for c in calls_all:
        if c.get('_splitText') is not None:
            text = c['_splitText']
        elif c.get('output') is not None:
            text = c['output']
        elif c.get('_restText') and c.get('_unitOut') is not None:
            text = c['_unitOut']
        elif c.get('sharedOutput'):
            text = c.get('_unitOut') or ''
        else:
            text = ''
        c['_text'] = text
        c['_nonzeroExit'] = (c['thread'], c['unitId']) in nz
        if c.get('_splitText') is not None:
            c['chars'] = len(text)
        elif c.get('sharedOutput'):
            k = len(shared_units[(c['thread'], c['unitId'])]) or 1
            ss_in_unit = sum(len(x.get('output') or '') for x in calls_all if x['thread'] == c['thread'] and x['unitId'] == c['unitId'] and x['cls'] == 'ss')
            c['chars'] = max(len(text) - ss_in_unit, 0) / k
        elif c.get('outputChars') is not None:
            c['chars'] = c['outputChars']
        else:
            c['chars'] = len(text)
        c['chars'] = c['chars'] * scale.get((c['thread'], c['unitId']), 1.0)
        c['tok'] = math.ceil(c['chars'] / 4)
        c['amp'] = c['tok'] * c.get('turnsRemaining', 0)
        c['_span'] = native_read_span(c, text) if c['bucket'] == 'native-read' else None
        c['_spans'] = code_spans(c, text)
        hit, shown, listed = shown_listed(c, text, probe)
        c['goldFiles'], c['goldShown'], c['goldListed'] = hit, shown, listed
        c['goldSyms'] = gold_syms_in(probe, text)
        c['goldToAnswer'] = bool((hit & ans_files) or (c['goldSyms'] & ans_syms))
        c['kind'], c['usageErr'] = call_kind(c, text)
    # referenced later + duplicates + fallbacks, per thread in order
    for thname in {c['thread'] for c in calls_all}:
        tc = [c for c in calls_all if c['thread'] == thname]
        th = next(t for t in threads if t['thread'] == thname)
        reqs = th['requests']
        seen_lines = defaultdict(set)
        first_ss_idx = next((i for i, c in enumerate(tc) if c['cls'] == 'ss'), None)
        for i, c in enumerate(tc):
            kd = c.get('deliveredTurn') or c['turnIndex']
            later = [rq.get('text') or '' for rq in reqs[kd:]] + [rq.get('thinking') or '' for rq in reqs[kd:]]
            later += [x['args'] or '' for x in tc[i + 1:] if x['turnIndex'] > c['turnIndex'] or x is not c]
            later.append(answer if thname == 'main' else '')
            later_txt = '\n'.join(later)
            paths = set()
            try:
                paths |= {normp(x) for x in P.loose_paths(c['_text'])}
            except Exception:
                pass
            t = read_target(c)
            if t:
                paths.add(t)
            paths = {x for x in paths if x and '/' in x or re.search(r'\.\w{1,6}$', x or '')}
            ref = False
            for pth in paths:
                if pth in later_txt:
                    ref = True
                    break
                b = os.path.basename(pth)
                if len(b) >= 6 and word_rx(b).search(later_txt):
                    ref = True
                    break
            c['referenced'] = ref
            # duplicates (code lines shown earlier in this thread)
            lines_shown = dup = 0
            for (f, a, b) in c['_spans']:
                if not f or a is None or b is None or b < a or b - a > 20000:
                    continue
                rng = set(range(a, b + 1))
                lines_shown += len(rng)
                dup += len(rng & seen_lines[f])
            for (f, a, b) in c['_spans']:
                if f and a is not None and b is not None and b >= a and b - a <= 20000:
                    seen_lines[f] |= set(range(a, b + 1))
            c['linesShown'], c['dupLines'] = lines_shown, dup
            c['afterSs'] = first_ss_idx is not None and i > first_ss_idx
            c['prev'] = tc[i - 1] if i > 0 else None
    # rollout-level
    reqs_usage = [rq.get('usage') for rq in reqs_all]
    price = CELLS[run['cell']][1]
    tokc = {'fresh': 0, 'cacheRead': 0, 'cacheWrite': 0, 'out': 0}
    for u in reqs_usage:
        if u:
            for k in tokc:
                tokc[k] += u.get(k) or 0
    cw_mult = 1.25 if h == 'cc' else 1.0
    usd = {'fresh': tokc['fresh'] * price['in'] / 1e6, 'cacheWrite': tokc['cacheWrite'] * price['in'] * cw_mult / 1e6,
           'cacheRead': tokc['cacheRead'] * price['cache'] / 1e6, 'out': tokc['out'] * price['out'] / 1e6}
    main_reqs = threads[0]['requests']
    req_cost = []
    for rq in main_reqs:
        u = rq.get('usage') or {}
        req_cost.append(((u.get('fresh') or 0) * price['in'] + (u.get('cacheWrite') or 0) * price['in'] * cw_mult
                         + (u.get('cacheRead') or 0) * price['cache'] + (u.get('out') or 0) * price['out']) / 1e6)
    req_cw = [((rq.get('usage') or {}).get('cacheWrite') or 0) + ((rq.get('usage') or {}).get('fresh') or 0) for rq in main_reqs]
    for i, c in enumerate(main_calls):
        c['idx'] = i + 1
    u0 = main_reqs[0].get('usage') if main_reqs else None
    prefix0 = (u0['fresh'] + u0['cacheRead'] + u0['cacheWrite']) if u0 else None
    cw0 = u0['cacheWrite'] if u0 else None
    fresh0 = u0['fresh'] if u0 else None
    in_total = tokc['fresh'] + tokc['cacheRead'] + tokc['cacheWrite']
    n_req = len([rq for rq in reqs_all if rq.get('usage')]) or len(reqs_all)
    tool_amp = sum(c['amp'] for c in calls_all)
    retrieval = [c for c in main_calls if c['bucket'] != 'other']
    gold_surfaced = set().union(*[c['goldFiles'] for c in calls_all]) if calls_all else set()
    return {
        'run': run, 'row': row, 'probe': probe, 'calls': calls_all, 'mainCalls': main_calls, 'answer': answer,
        'ansFiles': ans_files, 'ansSyms': ans_syms, 'goldSurfaced': gold_surfaced,
        'nReq': n_req, 'nReqMain': len(main_reqs), 'tok': tokc, 'usd': usd, 'usdSum': sum(usd.values()),
        'prefix0': prefix0, 'cw0': cw0, 'fresh0': fresh0, 'inTotal': in_total, 'toolAmp': tool_amp,
        'units': len({(c['thread'], c['unitId']) for c in main_calls}),
        'retrievalCalls': len(retrieval), 'session': sess['file'], 'joinScore': sess.get('joinScore'),
        'threadsN': len(threads), 'reqCost': req_cost, 'reqUncached': req_cw,
        'tsStart': str(main_reqs[0].get('ts')) if main_reqs and main_reqs[0].get('ts') is not None else '',
    }


# ----------------------------------------------------------------------------------------------
# loading everything
# ----------------------------------------------------------------------------------------------
def load_all(only=None):
    probes = load_probes()
    runs = discover()
    if only:
        runs = [r for r in runs if only in r['tag']]
    R, status = [], []
    for run in runs:
        rows_all = jl(os.path.join(run['dir'], 'runs.jsonl'))
        st = {'run': run, 'rowsFile': len(rows_all), 'skippedNotDev': 0, 'skippedUnknown': 0, 'errors': 0, 'scoreless': 0}
        keep = OrderedDict()
        for r in rows_all:
            p = probes.get(r.get('id'))
            if not p:
                st['skippedUnknown'] += 1
                continue
            if p.get('set') != 'dev' or r.get('set') not in (None, 'dev', 'r3'):
                st['skippedNotDev'] += 1   # never opened
                continue
            if p['_difficulty'] != run['difficulty']:
                st['skippedUnknown'] += 1
                continue
            if r.get('error') or r.get('exitCode') not in (0, None):
                st['errors'] += 1
                continue
            keep[(r['arm'], r['id'])] = r   # a later retry wins
        rows = list(keep.values())
        caps = {}
        for r in rows:
            f = os.path.join(run['dir'], 'captures', f"{r['arm']}.{r['id']}.json")
            if os.path.exists(f):
                caps[(r['arm'], r['id'])] = json.load(open(f))
        joined, problems = join_sessions(run, rows, probes, caps)
        st['problems'] = problems
        st['rows'] = len(rows)
        st['joined'] = len(joined)
        st['arms'] = Counter(r['arm'] for r in rows)
        st['devTotal'] = sum(1 for p in probes.values() if p['_difficulty'] == run['difficulty'] and p.get('set') == 'dev')
        st['pilot'] = 'pilot' in run['tag']
        for r in rows:
            s = joined.get((r['arm'], r['id']))
            if not s:
                continue
            if r.get('score') is None:
                st['scoreless'] += 1
            rec = analyze_rollout(run, r, probes[r['id']], s, caps.get((r['arm'], r['id'])))
            rec['label'] = arm_label(run['tag'], r['arm'], run['cell'])
            rec['gkey'] = (run['difficulty'], run['cell'], run['tag'], r['arm'])
            R.append(rec)
            st.setdefault('callsEq', 0)
            st.setdefault('costOk', 0)
            st['callsEq'] += int(rec['units'] == r.get('calls'))
            rc = r.get('costRealizedUsd') or 0
            st['costOk'] += int(rc and abs(rec['usdSum'] - rc) / rc <= 0.02)
        status.append(st)
    return R, status, probes


# ----------------------------------------------------------------------------------------------
# report sections
# ----------------------------------------------------------------------------------------------
def gname(g):
    d, cell, tag, arm = g
    return f"{CELLS[cell][2].split(' + ')[0]} {tag} [{arm_label(tag, arm, cell)}]"


def groups_of(R):
    G = OrderedDict()
    for r in sorted(R, key=lambda x: (x['gkey'][0] != 'hard', x['gkey'][1], x['gkey'][2], x['gkey'][3])):
        G.setdefault(r['gkey'], []).append(r)
    return G


def sec_status(status):
    rows = []
    for st in status:
        run = st['run']
        arms = ', '.join(f'{a}={n}' for a, n in sorted(st['arms'].items()))
        if st['pilot']:
            comp = f"pilot ({st['rows'] // max(len(st['arms']), 1)} q per arm)"
        else:
            per_arm = min(st['arms'].values()) if st['arms'] else 0
            comp = 'complete' if per_arm >= st['devTotal'] else f"PARTIAL ({per_arm}/{st['devTotal']} per arm)"
        rows.append([run['difficulty'], run['cell'], run['tag'], run['root'], arms, st['joined'], f"{st.get('callsEq', 0)}/{st['joined']}", f"{st.get('costOk', 0)}/{st['joined']}",
                     st['errors'], st['scoreless'], st['skippedNotDev'], comp])
    s = md_table(['set', 'cell', 'tag', 'results dir', 'ok rows per arm (dev)', 'joined to a session', 'tool calls == runner calls', 'transcript $ within 2% of runner', 'error rows', 'rows without judge score', 'heldout rows skipped (unopened)', 'state'], rows)
    probs = [f"- {st['run']['tag']}: {p}" for st in status for p in st['problems']]
    if probs:
        s += '\n\nJoin problems (rows left out of every table):\n\n' + '\n'.join(probs[:60])
    return s


def sec_overview(G):
    rows = []
    for g, rs in G.items():
        sc = [r['row'].get('score') for r in rs if r['row'].get('score') is not None]
        cost = [r['row'].get('costRealizedUsd') for r in rs]
        rows.append([gname(g), len(rs), f2(mean(sc), 3), pc(sum(1 for x in sc if x >= CORRECT), len(sc)),
                     f2(mean([r['units'] for r in rs])), f2(mean([len(r['mainCalls']) for r in rs])), f2(mean([r['nReqMain'] for r in rs])),
                     fd(mean(cost)), kfmt(mean([sum(c['chars'] for c in r['calls']) for r in rs])),
                     pc(sum(len(r['ansFiles']) for r in rs), sum(len(r['probe']['_goldFiles']) for r in rs)),
                     pc(sum(len(r['goldSurfaced']) for r in rs), sum(len(r['probe']['_goldFiles']) for r in rs))])
    return md_table(['group', 'n', 'accuracy (mean judge score)', f'correct (score ≥ {CORRECT})', 'tool calls/q (model)', 'calls/q (segments)', 'turns/q', 'cost/q (runner)', 'tool-output chars/q', 'gold files named in answer', 'gold files surfaced by any call'], rows)


def sec_toolmix(G):
    out = []
    for g, rs in G.items():
        n = len(rs)
        allc = [c for r in rs for c in r['mainCalls']]
        tot_calls = len(allc)
        tot_chars = sum(c['chars'] for c in allc) or 1
        tot_amp = sum(c['amp'] for c in allc) or 1
        rows = []
        for b in BUCKETS:
            cs = [c for c in allc if c['bucket'] == b]
            if not cs:
                continue
            qs = sum(1 for r in rs if any(c['bucket'] == b for c in r['mainCalls']))
            ch = sum(c['chars'] for c in cs)
            amp = sum(c['amp'] for c in cs)
            rows.append([b, f2(len(cs) / n), pc(len(cs), tot_calls), pc(qs, n), kfmt(ch / n), kfmt(ch / len(cs)), pc(ch, tot_chars), kfmt(amp / n), pc(amp, tot_amp)])
        sub = Counter(c['tool'] for c in allc if c['bucket'] in ('native-search', 'native-read', 'other'))
        out.append(f"#### {gname(g)} — n={n} questions, {tot_calls} calls\n\n" + md_table(
            ['tool', 'calls/q', 'share of calls', 'questions using it', 'output chars/q', 'chars/call', 'share of output chars', 'amplified tok/q', 'share of amplified tok'], rows)
            + ('\n\nNative and other calls by command: ' + ', '.join(f'{k}={v}' for k, v in sub.most_common(14)) if sub else ''))
    return '\n\n'.join(out)


def sec_success(G):
    rows, rows2 = [], []
    for g, rs in G.items():
        allc = [c for r in rs for c in r['mainCalls'] if r['probe']['_goldFiles']]
        for b in BUCKETS:
            cs = [c for c in allc if c['bucket'] == b]
            if not cs:
                continue
            rows.append([gname(g), b, len(cs), pc(sum(1 for c in cs if c['goldFiles']), len(cs)), pc(sum(1 for c in cs if c['goldShown']), len(cs)),
                         pc(sum(1 for c in cs if c['goldSyms']), len(cs)), pc(sum(1 for c in cs if c['goldToAnswer']), len(cs))])
        # first search-type call
        firsts = []
        for r in rs:
            if not r['probe']['_goldFiles']:
                continue
            fc = next((c for c in r['mainCalls'] if c['bucket'] in SEARCH_TYPE), None)
            if fc is not None:
                firsts.append(fc)
        fb = Counter(c['bucket'] for c in firsts)
        one = [r for r in rs if r['retrievalCalls'] == 1 and r['mainCalls'] and next((c for c in r['mainCalls'] if c['bucket'] != 'other'), {}).get('cls') == 'ss']
        one_ok = [r for r in one if (r['row'].get('score') or 0) >= CORRECT]
        le2 = [r for r in rs if r['retrievalCalls'] <= 2 and (r['row'].get('score') or 0) >= CORRECT]
        rows2.append([gname(g), len(firsts), ', '.join(f'{k}={v}' for k, v in fb.most_common()),
                      pc(sum(1 for c in firsts if c['goldFiles']), len(firsts)), pc(sum(1 for c in firsts if c['goldShown']), len(firsts)),
                      pc(sum(1 for c in firsts if c['goldFiles'] and not c['goldShown']), len(firsts)),
                      f"{len(one_ok)}/{len(one)} ({pc(len(one_ok), len(rs))} of q)", pc(len(le2), len(rs))])
    return (md_table(['group', 'tool', 'calls (q with gold files)', 'output has a gold file', 'gold file shown with code', 'output has a gold symbol', 'gold item later named in answer'], rows),
            md_table(['group', 'n first search calls', 'first search tool', 'surfaced a gold file', 'with code shown', 'only listed', 'one-call solves: correct / single-ss-call rollouts', 'correct with ≤ 2 retrieval calls'], rows2))


def sec_waste(G):
    rows, rows_fb, rows_err = [], [], []
    for g, rs in G.items():
        allc = [c for r in rs for c in r['mainCalls'] if r['probe']['_goldFiles']]
        ret = [c for c in allc if c['bucket'] != 'other']
        tot_ch = sum(c['chars'] for c in ret) or 1
        waste = [c for c in ret if not c['goldFiles'] and not c['goldSyms'] and not c['referenced']]
        nogold = [c for c in ret if not c['goldFiles'] and not c['goldSyms']]
        lines = sum(c['linesShown'] for c in ret)
        dup = sum(c['dupLines'] for c in ret)
        dup_ss = sum(c['dupLines'] for c in ret if c['cls'] == 'ss')
        lines_ss = sum(c['linesShown'] for c in ret if c['cls'] == 'ss')
        rows.append([gname(g), len(ret), pc(len(nogold), len(ret)), pc(len(waste), len(ret)), pc(sum(c['chars'] for c in waste), tot_ch),
                     f"{pc(dup, lines)} ({kfmt(dup)} of {kfmt(lines)} lines)", pc(dup_ss, lines_ss)])
        # fallbacks
        allm = [c for r in rs for c in r['mainCalls']]
        fb = [c for c in allm if c['afterSs'] and c['bucket'] in ('native-search', 'native-read')]
        prev = Counter()
        for c in fb:
            pv = c['prev']
            if pv is None:
                prev['(none)'] += 1
                continue
            tag = pv['bucket'] + (':' + pv['kind'] if pv['kind'] != 'ok' else '') + (':no-gold' if not pv['goldFiles'] and pv['bucket'] != 'other' else '')
            prev[tag] += 1
        if any(c['cls'] == 'ss' for c in allm):
            qn = sum(1 for r in rs if any(c['afterSs'] and c['bucket'] in ('native-search', 'native-read') for c in r['mainCalls']))
            rows_fb.append([gname(g), len(fb), f2(len(fb) / len(rs)), pc(qn, len(rs)), ', '.join(f'{k}={v}' for k, v in prev.most_common(8)),
                            ', '.join(f'{k}={v}' for k, v in Counter(c['tool'] for c in fb).most_common(6))])
        kinds = Counter((c['bucket'], c['kind']) for c in allm if c['bucket'] != 'other')
        errs = [c for c in allm if c['bucket'] != 'other' and c['kind'] == 'error']
        unk = [c for c in allm if c['bucket'] != 'other' and c['kind'] in ('no-marker', 'unknown', 'not-collected')]
        piped = [c for c in allm if c['cls'] == 'ss' and c.get('piped')]
        nss = sum(1 for c in allm if c['cls'] == 'ss')
        uerr = [c for c in allm if c['bucket'] != 'other' and c['usageErr']]
        zero = [c for c in allm if c['bucket'] != 'other' and c['kind'] in ('empty', 'empty-output')]
        nret = sum(1 for c in allm if c['bucket'] != 'other')
        rows_err.append([gname(g), nret, f"{len(errs)} ({pc(len(errs), nret)})", f"{len(uerr)} ({pc(len(uerr), nret)})", f"{len(zero)} ({pc(len(zero), nret)})",
                         f"{len(unk)} ({pc(len(unk), nret)})", f"{len(piped)} of {nss} ({pc(len(piped), nss)})" + (' → ' + ', '.join(f'{k}={v}' for k, v in Counter(c['pipeTail'][0] if c.get('pipeTail') else '?' for c in piped).most_common(4)) if piped else ''),
                         ', '.join(f'{b}:{k}={v}' for (b, k), v in kinds.most_common() if k != 'ok')[:300] or '-'])
    return (md_table(['group', 'retrieval calls (q with gold)', 'no gold file or symbol in output', 'no gold AND never referenced later (waste)', 'waste share of retrieval chars', 'code lines shown again (all tools)', 'code lines shown again (ss-* only)'], rows),
            md_table(['group', 'native calls after the first ss-* call', 'per q', 'questions with ≥1', 'what the call before it was (tool:kind:no-gold)', 'native tools used'], rows_fb),
            md_table(['group', 'retrieval calls', 'errors', 'usage errors', 'zero-hit / empty', 'output not attributable to the segment', 'ss-* calls piped into a filter', 'non-ok kinds by tool'], rows_err))


def sec_meta(G):
    rows = []
    hdr = None
    for g, rs in G.items():
        for tool in ('ss-search', 'ss-find'):
            cs = [c for r in rs for c in r['mainCalls'] if c['bucket'] == tool and c['kind'] == 'ok' and not c.get('piped') and c['_text']]
            if not cs:
                continue
            agg, tot, ents, lc, li = Counter(), 0, 0, 0, 0
            for c in cs:
                try:
                    r_ = P.parse_search_like(c['_text'])
                except Exception:
                    continue
                ents += len(r_['entries'])
                for k, v in r_['buckets'].items():
                    agg[k] += v
                tot += len(c['_text'])
                L = light_parse(c['_text'])
                lc += L['code']
                li += L['imports']
            if ents:
                cells = [pc(sum(agg.get(k, 0) for k in ks), tot) for ks in SEARCH_BUCKET_GROUPS.values()]
            else:
                cells = ['n/a (Bundle A format)'] * len(SEARCH_BUCKET_GROUPS)
            rows.append([gname(g), tool, len(cs), kfmt(tot / len(cs))] + cells + [pc(tot - lc - li, tot), pc(li, tot)])
    return md_table(['group', 'tool', 'calls', 'chars/call'] + list(SEARCH_BUCKET_GROUPS.keys()) + ['NOT code or imports (format-independent)', 'imports (format-independent)'], rows)


def paired(G, a_pred, b_pred, R):
    """List of (gA, gB) pairs to compare: same difficulty+cell; prefer same tag."""
    out = []
    keys = list(G.keys())
    for gb in keys:
        if not b_pred(gb):
            continue
        cands = [ga for ga in keys if ga != gb and ga[0] == gb[0] and ga[1] == gb[1] and a_pred(ga, gb)]
        same = [ga for ga in cands if ga[2] == gb[2]]
        for ga in (same or cands)[:2]:
            out.append((ga, gb))
    return out


def sec_cost(G):
    rows = []
    for g, rs in G.items():
        n = len(rs)
        t = {k: mean([r['tok'][k] for r in rs]) for k in ('fresh', 'cacheWrite', 'cacheRead', 'out')}
        u = {k: mean([r['usd'][k] for r in rs]) for k in ('fresh', 'cacheWrite', 'cacheRead', 'out')}
        mine = mean([r['usdSum'] for r in rs])
        runner = mean([r['row'].get('costRealizedUsd') for r in rs])
        rows.append([gname(g), n, f"{kfmt(t['fresh'])} / {fd(u['fresh'])}", f"{kfmt(t['cacheWrite'])} / {fd(u['cacheWrite'])}",
                     f"{kfmt(t['cacheRead'])} / {fd(u['cacheRead'])}", f"{kfmt(t['out'])} / {fd(u['out'])}", fd(mine), fd(runner),
                     f"{100 * (mine - runner) / runner:+.1f}%" if runner else '-', kfmt(mean([r['prefix0'] for r in rs])),
                     kfmt(mean([(r['cw0'] or 0) + (r['fresh0'] or 0) for r in rs])), pc(sum(r['tok']['cacheRead'] for r in rs), sum(r['inTotal'] for r in rs)), f2(mean([r['nReq'] for r in rs]))])
    return md_table(['group', 'n', 'fresh input tok / $', 'cache-write tok / $', 'cache-read tok / $', 'output tok / $', 'Σ $ (transcript)', '$ (runner)', 'transcript vs runner',
                     'request-0 prefix tok', 'request-0 tok NOT read from cache (written or fresh)', 'cache-hit share of all input tok', 'requests/q'], rows)


def sec_firstrepo(G):
    """Request-0 uncached tokens (cache write + fresh) for the first rollout of each repo vs the later ones.
    The prefix (system prompt + rules + tools) is cached per repo, so a design with few questions per repo
    pays the first write more often."""
    rows = []
    for g, rs in G.items():
        by = defaultdict(list)
        for r in rs:
            by[r['probe']['repo']].append(r)
        first, later = [], []
        for repo, L in by.items():
            L.sort(key=lambda r: r['tsStart'])
            first.append((L[0]['cw0'] or 0) + (L[0]['fresh0'] or 0))
            later += [(x['cw0'] or 0) + (x['fresh0'] or 0) for x in L[1:]]
        rows.append([gname(g), len(by), f2(len(rs) / max(len(by), 1), 1), kfmt(mean(first)), kfmt(mean(later)) + (f' (n={len(later)}†)' if len(later) < SMALL else f' (n={len(later)})'),
                     pc(len(first), len(rs))])
    return md_table(['group', 'repos', 'questions per repo', 'request-0 uncached tok: first rollout of a repo', 'request-0 uncached tok: later rollouts', 'share of rollouts that are first in their repo'], rows)


def decomp(r):
    n = r['nReq']
    p0 = r['prefix0'] or 0
    pref = min(n * p0, r['inTotal'])
    tool = min(r['toolAmp'], max(r['inTotal'] - pref, 0))
    return {'n': n, 'p0': p0, 'miss0': (r['cw0'] or 0) + (r['fresh0'] or 0), 'missLater': r['tok']['cacheWrite'] + r['tok']['fresh'] - (r['cw0'] or 0) - (r['fresh0'] or 0), 'prefixPart': pref, 'toolPart': tool, 'resid': r['inTotal'] - pref - tool, 'out': r['tok']['out'],
            'usd': r['row'].get('costRealizedUsd') or 0, **{'usd_' + k: v for k, v in r['usd'].items()}}


def sec_pairs(G, pairs, title_metric=True):
    rows, drows = [], []
    for ga, gb in pairs:
        A = {r['probe']['id']: r for r in G[ga]}
        B = {r['probe']['id']: r for r in G[gb]}
        ids = sorted(set(A) & set(B))
        if not ids:
            continue
        def d(f):
            xs = [(f(A[i]), f(B[i])) for i in ids]
            xs = [(a, b) for a, b in xs if a is not None and b is not None]
            if not xs:
                return '-'
            ma, mb = mean([a for a, _ in xs]), mean([b for _, b in xs])
            lo, hi = boot_ci([b - a for a, b in xs])
            rel = f' ({100 * (mb - ma) / ma:+.1f}%)' if ma else ''
            ci = f' [{lo:+.3g}, {hi:+.3g}]' if lo is not None else ''
            return f'{ma:.4g} → {mb:.4g}{rel}{ci}'
        rows.append([f'{gname(ga)} → {gname(gb)}', len(ids) if len(ids) >= SMALL else f'{len(ids)}†',
                     d(lambda r: r['row'].get('score')), d(lambda r: r['row'].get('costRealizedUsd')), d(lambda r: r['units']),
                     d(lambda r: r['nReqMain']), d(lambda r: sum(c['chars'] for c in r['calls'] if c['cls'] == 'ss')),
                     d(lambda r: sum(c['chars'] for c in r['calls']))])
        DA = [decomp(A[i]) for i in ids]
        DB = [decomp(B[i]) for i in ids]
        def dm(k):
            return mean([b[k] - a[k] for a, b in zip(DA, DB)])
        drows.append([f'{gname(ga)} → {gname(gb)}', len(ids), f"{dm('usd'):+.4f}", f"{dm('usd_cacheWrite'):+.4f}", f"{dm('usd_cacheRead'):+.4f}",
                      f"{dm('usd_fresh'):+.4f}", f"{dm('usd_out'):+.4f}", f"{dm('p0'):+,.0f}", f"{dm('miss0'):+,.0f}", f"{dm('missLater'):+,.0f}", f"{dm('n'):+.2f}",
                      f"{dm('prefixPart'):+,.0f}", f"{dm('toolPart'):+,.0f}", f"{dm('resid'):+,.0f}", f"{dm('out'):+,.0f}"])
    t1 = md_table(['A → B (paired on the same questions)', 'n', 'accuracy', 'cost $ (runner)', 'tool calls', 'turns', 'ss-* output chars', 'all tool-output chars'], rows)
    t2 = md_table(['A → B', 'n', 'Δ$ total', 'Δ$ cache write', 'Δ$ cache read', 'Δ$ fresh input', 'Δ$ output', 'Δ request-0 prefix tok (rules/system prompt)', 'Δ uncached tok at request 0 (cache write + fresh)', 'Δ uncached tok after request 0 (new tool output + model text)', 'Δ requests',
                   'Δ input tok: prefix × requests', 'Δ input tok: tool outputs re-read (amplified)', 'Δ input tok: rest (model text re-read, reminders, estimate error)', 'Δ output tok'], drows)
    return t1, t2


def sec_strata(G):
    out = []
    by_cd = OrderedDict()
    for g in G:
        by_cd.setdefault((g[0], g[1]), []).append(g)
    for (diff, cell), gs in by_cd.items():
        if diff != 'hard':
            continue
        for dim, keyf in (('stratum', lambda r: r['probe']['stratum']), ('repo group (A old repos, B new languages)', lambda r: r['probe']['_group'])):
            vals = sorted({keyf(r) for g in gs for r in G[g]})
            rows = []
            for v in vals:
                row = [v]
                for g in gs:
                    rs = [r for r in G[g] if keyf(r) == v]
                    if not rs:
                        row.append('-')
                        continue
                    sc = mean([r['row'].get('score') for r in rs])
                    row.append(f"n={len(rs)}{'†' if len(rs) < SMALL else ''} acc {f2(sc, 3)} · calls {f2(mean([r['units'] for r in rs]), 1)} · {fd(mean([r['row'].get('costRealizedUsd') for r in rs]), 3)}")
                rows.append(row)
            out.append(f"#### {CELLS[cell][2]} — by {dim}\n\n" + md_table([dim] + [f"{g[2]} [{arm_label(g[2], g[3], g[1])}]" for g in gs], rows))
    return '\n\n'.join(out)


def group_metrics(rs):
    allm = [c for r in rs for c in r['mainCalls']]
    ret = [c for c in allm if c['bucket'] != 'other']
    gold_r = [r for r in rs if r['probe']['_goldFiles']]
    firsts = [next((c for c in r['mainCalls'] if c['bucket'] in SEARCH_TYPE), None) for r in gold_r]
    firsts = [c for c in firsts if c is not None]
    ss_s = [c for c in allm if c['bucket'] == 'ss-search' and c['kind'] == 'ok' and c['_text'] and not c.get('piped')]
    meta_tot = meta_non = 0
    for c in ss_s:
        L = light_parse(c['_text'])
        meta_tot += L['total']
        meta_non += L['total'] - L['code'] - L['imports']
    retg = [c for r in gold_r for c in r['mainCalls'] if c['bucket'] != 'other']
    waste_ch = sum(c['chars'] for c in retg if not c['goldFiles'] and not c['goldSyms'] and not c['referenced'])
    return OrderedDict([
        ('n', len(rs)),
        ('accuracy', f2(mean([r['row'].get('score') for r in rs]), 3)),
        ('tool calls/q', f2(mean([r['units'] for r in rs]))),
        ('turns/q', f2(mean([r['nReqMain'] for r in rs]))),
        ('cost/q', fd(mean([r['row'].get('costRealizedUsd') for r in rs]))),
        ('ss-* chars/q', kfmt(mean([sum(c['chars'] for c in r['calls'] if c['cls'] == 'ss') for r in rs]))),
        ('all tool chars/q', kfmt(mean([sum(c['chars'] for c in r['calls']) for r in rs]))),
        ('first search call surfaced gold file', pc(sum(1 for c in firsts if c['goldFiles']), len(firsts))),
        ('gold files named in answer', pc(sum(len(r['ansFiles']) for r in gold_r), sum(len(r['probe']['_goldFiles']) for r in gold_r))),
        ('native calls after first ss/q', f2(mean([sum(1 for c in r['mainCalls'] if c['afterSs'] and c['bucket'] in ('native-search', 'native-read')) for r in rs]))),
        ('waste share of retrieval chars', pc(waste_ch, sum(c['chars'] for c in retg))),
        ('ss-search non-code share', pc(meta_non, meta_tot)),
        ('zero-hit + error calls', pc(sum(1 for c in ret if c['kind'] in ('empty', 'empty-output', 'error', 'no-marker')), len(ret))),
    ])


def sec_contrast(G):
    by = defaultdict(dict)
    for g, rs in G.items():
        by[(g[1], arm_label(g[2], g[3], g[1]))].setdefault(g[0], []).append((g, rs))
    out = []
    for (cell, label), d in by.items():
        if 'hard' not in d or 'easy' not in d:
            continue
        cols, mets = [], []
        for diff in ('easy', 'hard'):
            for g, rs in d[diff]:
                cols.append(f'{diff}: {g[2]}')
                mets.append(group_metrics(rs))
        keys = list(mets[0].keys())
        rows = [[k] + [m[k] for m in mets] for k in keys]
        out.append(f"#### {CELLS[cell][2]} · {label}\n\n" + md_table(['metric'] + cols, rows))
    return '\n\n'.join(out) if out else '_No cell has both an easy and a hard run yet._'


# ----------------------------------------------------------------------------------------------
# dossiers
# ----------------------------------------------------------------------------------------------
def smart_clip(text, p, limit=6000):
    t = text or ''
    if len(t) <= limit:
        return t
    head, tail = t[:1800], t[-700:]
    lines = t[1800:-700].split('\n')
    keep, used = [], 0
    rxs = list(p['_goldFileRx'].values()) + list(p['_goldSymRx'].values())
    for i, ln in enumerate(lines):
        if ln.startswith('## #') or ln.startswith('# ') or any(rx.search(ln) for rx in rxs):
            piece = '\n'.join(lines[max(i - 1, 0):i + 2])
            if used + len(piece) > limit - 2600:
                break
            keep.append(piece)
            used += len(piece)
    mid = ('\n[...]\n'.join(keep)) if keep else ''
    return f"{head}\n[... cut {len(t) - 2500 - used:,} chars; kept rank headers and lines naming gold files/symbols ...]\n{mid}\n[...]\n{tail}"


def write_dossiers(G):
    os.makedirs(OUT_DOSS, exist_ok=True)
    written = []
    for g, rs in G.items():
        diff, cell, tag, arm = g
        f = os.path.join(OUT_DOSS, f'{cell}-{tag}.{arm}.jsonl')
        with open(f, 'w') as fh:
            for r in sorted(rs, key=lambda x: x['probe']['id']):
                p = r['probe']
                gold = {'files': p['_goldFiles'], 'symbols': p['_goldSyms'], 'facts': p.get('expectedFacts'), 'expectedNoMatch': p.get('expectedNoMatch')}
                fh.write(json.dumps({'type': 'rollout', 'difficulty': diff, 'cell': cell, 'tag': tag, 'arm': arm, 'armLabel': r['label'], 'id': p['id'],
                                     'stratum': p['stratum'], 'repoGroup': p['_group'], 'language': p.get('language'), 'question': p['query'], 'gold': gold,
                                     'score': r['row'].get('score'), 'costUsd': r['row'].get('costRealizedUsd'), 'turns': r['nReqMain'], 'toolCalls': r['units'],
                                     'goldFilesNamedInAnswer': sorted(r['ansFiles']), 'goldFilesSurfaced': sorted(r['goldSurfaced']),
                                     'answer': r['answer'], 'session': r['session']}, ensure_ascii=False) + '\n')
                for i, c in enumerate(r['calls']):
                    pv = c.get('prev')
                    rec = {'type': 'call', 'cell': cell, 'tag': tag, 'arm': arm, 'id': p['id'], 'stratum': p['stratum'], 'question': p['query'],
                           'goldFiles': p['_goldFiles'], 'goldSymbols': p['_goldSyms'], 'score': r['row'].get('score'),
                           'callIndex': i, 'thread': c['thread'], 'issuedTurn': c.get('issuedTurn'), 'deliveredTurn': c.get('deliveredTurn'),
                           'turnsTotal': c.get('turnsTotal'), 'turnsRemaining': c.get('turnsRemaining'),
                           'tool': c['tool'], 'bucket': c['bucket'], 'args': c['args'], 'compound': c.get('compound'), 'unitCommand': c.get('unitCommand'),
                           'outputChars': c['chars'], 'outputTokEst': c['tok'], 'amplifiedTokEst': c['amp'], 'outputKind': c['kind'], 'usageError': c['usageErr'],
                           'goldFilesInOutput': sorted(c['goldFiles']), 'goldFilesShownWithCode': sorted(c['goldShown']), 'goldSymbolsInOutput': sorted(c['goldSyms']),
                           'goldLaterNamedInAnswer': c['goldToAnswer'], 'referencedLater': c['referenced'], 'linesShown': c['linesShown'], 'linesShownAgain': c['dupLines'],
                           'nativeAfterSs': bool(c['afterSs'] and c['bucket'] in ('native-search', 'native-read')),
                           'previousCall': ({'tool': pv['tool'], 'kind': pv['kind'], 'goldFiles': sorted(pv['goldFiles'])} if pv else None),
                           'output': smart_clip(c['_text'], p) if c['bucket'] != 'other' else (c['_text'] or '')[:1500],
                           'before': c.get('before'), 'after': c.get('after')}
                    fh.write(json.dumps(rec, ensure_ascii=False, default=list) + '\n')
        written.append((f, len(rs), sum(len(r['calls']) for r in rs)))
    return written


# ----------------------------------------------------------------------------------------------
# "Why native is cheap": native strategy, gold per char, fixed overhead, paired divergence
# ----------------------------------------------------------------------------------------------
def gmatch(f, p):
    f = normp(f)
    return {g for g in p['_goldFiles'] if f == g or f.endswith('/' + g) or g.endswith('/' + f)}


def grep_flags(c):
    """Flag labels of a native search call."""
    args = c['args'] or ''
    tool = c['tool'] or ''
    fl = set()
    if c.get('boundary') == 'native':
        try:
            inp = json.loads(args)
        except Exception:
            inp = {}
        if tool.lower() == 'glob':
            return {'glob-tool'}
        if inp.get('-n'):
            fl.add('n')
        if any(inp.get(k) for k in ('-A', '-B', '-C', 'context')):
            fl.add('ctx')
        if inp.get('output_mode', 'files_with_matches') == 'files_with_matches':
            fl.add('l')
        if inp.get('glob') or inp.get('type') or inp.get('include'):
            fl.add('include')
        if inp.get('-i'):
            fl.add('i')
        fl.add('r')
        return fl
    if tool in ('find', 'fd', 'ls', 'tree', 'locate', 'git-ls-files'):
        return {'list:' + tool}
    words = fx._words(args)
    if tool == 'rg':
        fl.add('r')
    LONG = {'files-with-matches': 'l', 'files': 'files', 'include': 'include', 'glob': 'include', 'type': 'include', 'context': 'ctx',
            'after-context': 'ctx', 'before-context': 'ctx', 'line-number': 'n', 'ignore-case': 'i', 'count': 'count', 'word-regexp': 'w',
            'recursive': 'r', 'max-count': 'm'}
    for w in words[1:]:
        if w.startswith('--'):
            k = LONG.get(w[2:].split('=')[0])
            if k:
                fl.add(k)
        elif w.startswith('-') and len(w) > 1 and not w[1].isdigit():
            for ch in w[1:]:
                k = {'n': 'n', 'l': 'l', 'r': 'r', 'R': 'r', 'A': 'ctx', 'B': 'ctx', 'C': 'ctx', 'i': 'i', 'w': 'w', 'c': 'count',
                     'g': 'include', 't': 'include', 'm': 'm'}.get(ch)
                if k:
                    fl.add(k)
                if ch in 'ABCgtme':
                    break   # the rest of the word is the option's value
    for t in c.get('pipeTail') or []:
        fl.add('pipe:' + t)
    return fl


def read_lines(c):
    """(lines shown, whole-file?) of a read call, or (None, None)."""
    b = c['bucket']
    if b == 'native-read':
        sp = c.get('_span')
        whole = c['tool'] in ('cat', 'bat', 'nl') and not c.get('piped') or (c.get('boundary') == 'native' and not re.search(r'"(offset|limit|startLine|endLine)"', c['args'] or ''))
        if sp:
            return sp[2] - sp[1] + 1, whole
        return None, whole
    if b == 'ss-read':
        n = sum(bb - a + 1 for f, a, bb in c.get('_spans') or [] if a and bb and bb >= a)
        ws = [w for w in fx._words(c['args'] or '')[1:] if not w.startswith('-')]
        whole = not any(re.fullmatch(r'\d+', w) for w in ws[1:])
        return (n or None), whole
    return None, None


HDR_BLOCK = re.compile(r'^(?:## #\d+ |### |# continues at )(\S+?):(\d+)(?:-(\d+))?')


def gold_chars(c, text, p):
    """Characters of the output that belong to a gold file."""
    if not p['_goldFiles'] or not text:
        return 0
    b = c['bucket']
    rxs = list(p['_goldFileRx'].values())
    if b in ('ss-read', 'native-read'):
        t = read_target(c)
        if t and gmatch(t, p):
            return len(text)
        return sum(len(ln) + 1 for ln in text.split('\n') if any(rx.search(ln) for rx in rxs))
    if b in ('ss-search', 'ss-find', 'ss-semantic'):
        tot, cur_gold = 0, False
        for ln in text.split('\n'):
            m = HDR_BLOCK.match(ln)
            if m:
                cur_gold = bool(gmatch(m.group(1), p))
            elif ln.startswith('# ') or (ln.startswith('## ') and not ln.startswith('## #')):
                cur_gold = False
            if cur_gold or any(rx.search(ln) for rx in rxs):
                tot += len(ln) + 1
        return min(tot, len(text))
    return sum(len(ln) + 1 for ln in text.split('\n') if any(rx.search(ln) for rx in rxs))


def first_gold(r):
    seen = 0.0
    out = {'idx': None, 'chars': None, 'idxShown': None, 'turn': None}
    for c in r['mainCalls']:
        seen += c['chars']
        if c['goldFiles'] and out['idx'] is None:
            out.update(idx=c['idx'], chars=seen, turn=c['turnIndex'])
        if c['goldShown'] and out['idxShown'] is None:
            out['idxShown'] = c['idx']
    return out


def pctile(xs, q):
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return None
    return xs[min(len(xs) - 1, int(q * len(xs)))]


def sec_native_strategy(G):
    rows_chain, rows_flags, rows_read, rows_first = [], [], [], []
    for g, rs in G.items():
        n = len(rs)
        units = defaultdict(list)
        for r in rs:
            for c in r['mainCalls']:
                units[(r['probe']['id'], c['unitId'])].append(c)
        segs = [len(v) for v in units.values()]
        mixed = sum(1 for v in units.values() if {'native-search', 'native-read'} <= {c['bucket'] for c in v} or (any(c['cls'] == 'ss' for c in v) and len({c['bucket'] for c in v}) > 1))
        approx = sum(1 for r in rs for c in r['mainCalls'] if c.get('splitApprox'))
        allc = [c for r in rs for c in r['mainCalls']]
        rows_chain.append([gname(g), n, len(segs), f2(mean(segs)), pc(sum(1 for x in segs if x >= 2), len(segs)), pc(sum(1 for x in segs if x >= 4), len(segs)),
                           max(segs) if segs else '-', pc(mixed, len(segs)), f2(mean([r['nReqMain'] for r in rs])),
                           pc(approx, len(allc))])
        if g[3] == 'native':
            ns = [c for c in allc if c['bucket'] == 'native-search']
            F = Counter()
            for c in ns:
                F.update(grep_flags(c))
            lst = sum(v for k, v in F.items() if k.startswith('list:'))
            gr = len(ns) - lst
            pipes = Counter({k[5:]: v for k, v in F.items() if k.startswith('pipe:')})
            piped_n = sum(1 for c in ns if c.get('piped') and not any(k.startswith('list:') for k in grep_flags(c)))
            rows_flags.append([gname(g), len(ns), f2(len(ns) / n), pc(F['n'], gr), pc(F['l'] + F['files'], gr), pc(F['ctx'], gr), pc(F['r'], gr), pc(F['include'], gr),
                               pc(F['i'], gr), pc(piped_n, gr), ', '.join(f'{k}={v}' for k, v in pipes.most_common(4)) or '-',
                               pc(lst, len(ns)), kfmt(mean([c['chars'] for c in ns]))])
        reads = [c for c in allc if c['bucket'] in ('native-read', 'ss-read')]
        if reads:
            L = [read_lines(c) for c in reads]
            lines = [x for x, _ in L if x]
            whole = sum(1 for _, w in L if w)
            rows_read.append([gname(g), len(reads), f2(len(reads) / n), kfmt(pctile(lines, .5)), kfmt(pctile(lines, .75)), kfmt(mean(lines)), pc(whole, len(reads)),
                              kfmt(mean([c['chars'] for c in reads])), pc(len(lines), len(reads))])
        fg = [first_gold(r) for r in rs if r['probe']['_goldFiles']]
        hit = [x for x in fg if x['idx']]
        rows_first.append([gname(g), len(fg), pc(len(hit), len(fg)), f2(mean([x['idx'] for x in hit]), 1), kfmt(pctile([x['idx'] for x in hit], .5)),
                           kfmt(pctile([x['chars'] for x in hit], .5)), f2(mean([x['turn'] for x in hit]), 1),
                           f2(mean([x['idxShown'] for x in fg if x['idxShown']]), 1)])
    return (md_table(['group', 'n', 'model tool calls', 'commands per tool call', 'tool calls with ≥ 2 commands', 'with ≥ 4', 'max', 'tool calls mixing search + read', 'requests/q', 'native calls whose share of a chained output is only estimated'], rows_chain),
            md_table(['native group', 'search calls', 'per q', '-n', '-l / files only', '-A/-B/-C context', 'recursive (-r, rg)', 'include/glob/type filter', '-i', 'piped into a filter', 'pipe targets', 'find/ls listing', 'chars/call'], rows_flags),
            md_table(['group', 'read calls', 'per q', 'median lines/read', 'p75 lines', 'mean lines', 'whole-file reads', 'chars/read', 'reads with a measured window'], rows_read),
            md_table(['group', 'q with gold files', 'reached a gold file', 'mean call index of first gold', 'median call index', 'median tool-output chars consumed up to it', 'mean request of first gold', 'mean call index of first gold SHOWN with code'], rows_first))


def sec_gold_eff(G):
    rows = []
    for g, rs in G.items():
        per = defaultdict(lambda: [0, 0.0, 0.0, 0, 0])   # calls, chars, gold chars, new gold files, calls with gold
        for r in rs:
            if not r['probe']['_goldFiles']:
                continue
            seen = set()
            for c in r['mainCalls']:
                if c['bucket'] == 'other':
                    continue
                gc = gold_chars(c, c['_text'], r['probe'])
                raw = len(c['_text']) or 1
                x = per[c['bucket']]
                x[0] += 1
                x[1] += c['chars']
                x[2] += c['chars'] * min(gc / raw, 1.0)
                new = c['goldFiles'] - seen
                x[3] += len(new)
                x[4] += 1 if c['goldFiles'] else 0
                seen |= c['goldFiles']
        for b in BUCKETS:
            if b not in per:
                continue
            k, ch, gch, newg, wg = per[b]
            rows.append([gname(g), b, k, kfmt(ch / k), pc(gch, ch), kfmt(ch / 4 / newg) if newg else '∞', f2(newg / k), pc(wg, k)])
    return md_table(['group', 'tool', 'calls', 'chars/call', 'gold-bearing share of chars', 'tokens per NEW gold file surfaced', 'new gold files per call', 'calls with any gold file'], rows)


def overhead(r):
    run = r['run']
    price = CELLS[run['cell']][1]
    wp = price['in'] * (1.25 if run['harness'] == 'cc' else 1.0)
    cp = price['cache']
    unc0 = (r['cw0'] or 0) + (r['fresh0'] or 0)
    fixed = (unc0 * wp + (r['prefix0'] or 0) * max(r['nReqMain'] - 1, 0) * cp) / 1e6
    tool = sum(c['tok'] * wp + c['amp'] * cp for c in r['calls']) / 1e6
    return fixed, tool, (r['row'].get('costRealizedUsd') or 0) - fixed - tool


def sec_fixed(G):
    rows = []
    for g, rs in G.items():
        O = [overhead(r) for r in rs]
        cost = mean([r['row'].get('costRealizedUsd') for r in rs]) or 0
        fx_, tl, rest = mean([o[0] for o in O]), mean([o[1] for o in O]), mean([o[2] for o in O])
        ncalls = sum(len(r['calls']) for r in rs) or 1
        per_call = sum(o[1] for o in O) / ncalls
        rows.append([gname(g), len(rs), kfmt(mean([r['prefix0'] for r in rs])), kfmt(mean([(r['cw0'] or 0) + (r['fresh0'] or 0) for r in rs])),
                     f"{fd(fx_)} ({pm(fx_, cost)})", f"{fd(tl)} ({pm(tl, cost)})", f"{fd(rest)} ({pm(rest, cost)})", fd(per_call, 5),
                     f2(fx_ / per_call, 1) if per_call else '-'])
    return md_table(['group', 'n', 'request-0 prefix tok (system + tools + rules + question)', 'request-0 uncached tok', 'fixed prefix $/q (est.)', 'tool-output $/q (est.)',
                     'rest $/q (model text, reasoning, output tok)', 'tool-output $ per call (est.)', 'fixed prefix = how many calls of output'], rows)


def run_order(G, ga, gb):
    ta = min((r['tsStart'] for r in G[ga] if r['tsStart']), default='')
    tb = min((r['tsStart'] for r in G[gb] if r['tsStart']), default='')
    if not ta or not tb:
        return 'unknown order'
    return 'native started after sweet' if ta > tb else 'native started before sweet'


def native_pairs(G):
    """Each sweet group -> the native group of the same difficulty + cell with the largest question overlap
    (ties: the longer common tag prefix)."""
    out = []
    for gb, rb in G.items():
        if gb[3] == 'native':
            continue
        ids_b = {r['probe']['id'] for r in rb}
        best = None
        for ga, ra in G.items():
            if ga[3] != 'native' or ga[0] != gb[0] or ga[1] != gb[1]:
                continue
            ov = len(ids_b & {r['probe']['id'] for r in ra})
            pre = len(os.path.commonprefix([ga[2], gb[2]]))
            key = (ov, ga[2] == gb[2], pre)
            if ov and (best is None or key > best[0]):
                best = (key, ga)
        if best:
            out.append((best[1], gb))
    return out


def cum(xs):
    out, s = [], 0.0
    for x in xs:
        s += x
        out.append(s)
    return out


PATTERNS = OrderedDict([
    ('prefix', 'request 0 already costs more: the larger system prompt / rules prefix is written to the cache'),
    ('search-dump', 'ranked ss-search / ss-find prints code blocks where native prints a grep listing'),
    ('search-vs-read', 'ranked ss-search / ss-find output is larger than native\'s read at the same step'),
    ('wide-read', 'ss-read shows a wider window than native\'s sed / head range'),
    ('graph-dump', 'ss-trace / ss-semantic output is larger than native\'s call at the same step'),
    ('grep-bigger', 'ss-grep output is larger than native\'s grep at the same step'),
    ('extra-turns', 'sweet keeps working after native has already answered'),
    ('cache-miss', 'similar output, but the sweet request writes or re-reads more uncached context'),
    ('accumulated', 'no single step: small per-step differences add up'),
])


def divergence(A, B):
    """First request where sweet's cumulative cost gap reaches 25% of its final gap; classify the step."""
    Cn, Cs = cum(A['reqCost']), cum(B['reqCost'])
    if not Cn or not Cs:
        return None
    Gap = Cs[-1] - Cn[-1]
    if Gap <= 0:
        return None
    K = max(len(Cn), len(Cs))
    k = next(i for i in range(K) if Cs[min(i, len(Cs) - 1)] - Cn[min(i, len(Cn) - 1)] >= 0.25 * Gap)
    dt = lambda c: c.get('deliveredTurn') or c['turnIndex']
    sc = [c for c in B['mainCalls'] if dt(c) == k]
    nc = [c for c in A['mainCalls'] if dt(c) == k]
    S, N = sum(c['chars'] for c in sc), sum(c['chars'] for c in nc)
    if k == 0:
        pat = 'prefix'
    elif k >= len(Cn):
        pat = 'extra-turns'
    elif S > max(2 * N, N + 1500):
        top = max(sc, key=lambda c: c['chars'])['bucket']
        nat_search = any(c['bucket'] == 'native-search' for c in nc)
        if top in ('ss-search', 'ss-find'):
            pat = 'search-dump' if nat_search or not nc else 'search-vs-read'
        elif top == 'ss-read':
            pat = 'wide-read'
        elif top in ('ss-trace', 'ss-semantic'):
            pat = 'graph-dump'
        elif top == 'ss-grep':
            pat = 'grep-bigger'
        else:
            pat = 'accumulated'
    else:
        un = B['reqUncached'][k] - (A['reqUncached'][k] if k < len(A['reqUncached']) else 0)
        pat = 'cache-miss' if un > 2000 else 'accumulated'
    short = lambda cs: '; '.join(f"{c['tool']} `{(c['args'] or '')[:60]}` {kfmt(c['chars'])} ch" for c in sorted(cs, key=lambda c: -c['chars'])[:2]) or '(none)'
    return {'request': k, 'pattern': pat, 'gap': Gap, 'sweetCalls': short(sc), 'nativeCalls': short(nc), 'sweetChars': S, 'nativeChars': N,
            'req0Delta': (Cs[0] - Cn[0])}


def sec_paired_native(G, pairs):
    out, data = [], {}
    for ga, gb in pairs:
        A = {r['probe']['id']: r for r in G[ga]}
        B = {r['probe']['id']: r for r in G[gb]}
        ids = sorted(set(A) & set(B))
        if not ids:
            continue
        same_run = ga[2] == gb[2]
        def m(f, rs):
            return mean([f(x) for x in rs])
        AA, BB = [A[i] for i in ids], [B[i] for i in ids]
        fa = [first_gold(x) for x in AA if x['probe']['_goldFiles']]
        fb = [first_gold(x) for x in BB if x['probe']['_goldFiles']]
        rows = [
            ['score', f2(m(lambda x: x['row'].get('score'), AA), 3), f2(m(lambda x: x['row'].get('score'), BB), 3)],
            ['cost $ (runner)', fd(m(lambda x: x['row'].get('costRealizedUsd'), AA)), fd(m(lambda x: x['row'].get('costRealizedUsd'), BB))],
            ['model tool calls', f2(m(lambda x: x['units'], AA)), f2(m(lambda x: x['units'], BB))],
            ['commands (segments)', f2(m(lambda x: len(x['mainCalls']), AA)), f2(m(lambda x: len(x['mainCalls']), BB))],
            ['requests', f2(m(lambda x: x['nReqMain'], AA)), f2(m(lambda x: x['nReqMain'], BB))],
            ['tool-output chars', kfmt(m(lambda x: sum(c['chars'] for c in x['calls']), AA)), kfmt(m(lambda x: sum(c['chars'] for c in x['calls']), BB))],
            ['cache-write + fresh input tok', kfmt(m(lambda x: x['tok']['cacheWrite'] + x['tok']['fresh'], AA)), kfmt(m(lambda x: x['tok']['cacheWrite'] + x['tok']['fresh'], BB))],
            ['cache-read tok', kfmt(m(lambda x: x['tok']['cacheRead'], AA)), kfmt(m(lambda x: x['tok']['cacheRead'], BB))],
            ['request-0 uncached tok', kfmt(m(lambda x: (x['cw0'] or 0) + (x['fresh0'] or 0), AA)), kfmt(m(lambda x: (x['cw0'] or 0) + (x['fresh0'] or 0), BB))],
            ['first-gold call index (mean)', f2(mean([x['idx'] for x in fa]), 1), f2(mean([x['idx'] for x in fb]), 1)],
            ['chars consumed up to first gold (median)', kfmt(pctile([x['chars'] for x in fa if x['chars']], .5)), kfmt(pctile([x['chars'] for x in fb if x['chars']], .5))],
        ]
        title = f"#### {gname(ga)} vs {gname(gb)} — paired n={len(ids)}{'†' if len(ids) < SMALL else ''}"
        order = run_order(G, ga, gb)
        cav = (f'Both arms come from one run, arms in sequence ({order}), not interleaved. Provider drift can bias the cost difference; token and call patterns are not affected.' if same_run else
               f'Separate runs ({order}), not interleaved. Provider drift can bias the cost difference '
               '(Codex showed −24.5% cost between two identical runs 25 min apart). Token-level and call-level patterns are not affected.')
        D = []
        for i in ids:
            dv = divergence(A[i], B[i])
            D.append((i, (B[i]['row'].get('costRealizedUsd') or 0) - (A[i]['row'].get('costRealizedUsd') or 0), dv))
        D.sort(key=lambda x: -x[1])
        top = D[:10]
        trows = []
        for i, dc, dv in top:
            a, b = A[i], B[i]
            trows.append([i, a['probe']['stratum'], f"{fd(a['row'].get('costRealizedUsd'), 3)} → {fd(b['row'].get('costRealizedUsd'), 3)}", f"{dc:+.3f}",
                          f"{f2(a['row'].get('score'))} → {f2(b['row'].get('score'))}", f"{a['nReqMain']} → {b['nReqMain']}",
                          f"{kfmt(sum(c['chars'] for c in a['calls']))} → {kfmt(sum(c['chars'] for c in b['calls']))}",
                          dv['request'] if dv else '-', dv['pattern'] if dv else '(no excess)', dv['sweetCalls'] if dv else '', dv['nativeCalls'] if dv else ''])
        pos = [x for x in D if x[2]]
        pc_all = Counter(x[2]['pattern'] for x in pos)
        pc_top = Counter(x[2]['pattern'] for x in top if x[2])
        prow = [[k, PATTERNS[k], pc_top.get(k, 0), pc_all.get(k, 0), fd(mean([x[1] for x in pos if x[2]['pattern'] == k]), 4)] for k in PATTERNS if pc_all.get(k)]
        out.append('\n\n'.join([title, cav, md_table(['metric (paired means)', gname(ga), gname(gb)], rows),
                                f'Top 10 questions by sweet cost excess. Divergence = first request where sweet\'s cumulative cost gap reaches 25% of its final gap; the calls shown are the outputs that entered that request.',
                                md_table(['question', 'stratum', '$ native → sweet', 'Δ$', 'score', 'requests', 'tool chars', 'divergence request', 'pattern', 'sweet output at divergence', 'native output at divergence'], trows),
                                f'Pattern counts (top 10, and all {len(pos)} questions where sweet cost more):',
                                md_table(['pattern', 'meaning', 'top 10', 'all with excess', 'mean excess $'], prow)]))
        data[(ga, gb)] = {'ids': ids, 'D': D, 'A': A, 'B': B, 'patternsAll': pc_all, 'patternsTop': pc_top, 'nPos': len(pos), 'sameRun': same_run, 'order': order}
    return '\n\n'.join(out) if out else '_No native/sweet pair yet._', data


def why_native(G, pairs, pdata):
    """Five computed patterns per HARD pair (falls back to easy pairs when no hard pair exists)."""
    hard = [p for p in pairs if p[0][0] == 'hard' and p in pdata]
    easy = [p for p in pairs if p[0][0] == 'easy' and p in pdata]
    use = hard + easy
    blocks = []
    for ga, gb in use:
        if (ga, gb) == (easy[0] if easy else None):
            blocks.append('##### Easy r3 dev pairs (contrast; the only Codex native data until `r3hdev-cx-nat` lands)')
        d = pdata[(ga, gb)]
        ids = d['ids']
        A, B = [d['A'][i] for i in ids], [d['B'][i] for i in ids]
        n = len(ids)
        dag = '†' if n < SMALL else ''
        dcost = mean([(b['row'].get('costRealizedUsd') or 0) - (a['row'].get('costRealizedUsd') or 0) for a, b in zip(A, B)])
        OA, OB = [overhead(x) for x in A], [overhead(x) for x in B]
        dfix = mean([o[0] for o in OB]) - mean([o[0] for o in OA])
        dtool = mean([o[1] for o in OB]) - mean([o[1] for o in OA])
        p0a, p0b = mean([x['prefix0'] for x in A]), mean([x['prefix0'] for x in B])
        u0a, u0b = mean([(x['cw0'] or 0) + (x['fresh0'] or 0) for x in A]), mean([(x['cw0'] or 0) + (x['fresh0'] or 0) for x in B])
        ca = [c for x in A for c in x['mainCalls']]
        cb = [c for x in B for c in x['mainCalls']]
        def cpc(cs, bks):
            v = [c['chars'] for c in cs if c['bucket'] in bks]
            return mean(v), len(v)
        ns_ch, ns_n = cpc(ca, {'native-search'})
        nr_ch, nr_n = cpc(ca, {'native-read'})
        ss_ch, ss_n = cpc(cb, {'ss-search', 'ss-find'})
        sg_ch, sg_n = cpc(cb, {'ss-grep'})
        sr_ch, sr_n = cpc(cb, {'ss-read'})
        def gshare(xs, bks):
            ch = gc = 0.0
            for x in xs:
                for c in x['mainCalls']:
                    if c['bucket'] in bks and x['probe']['_goldFiles']:
                        raw = len(c['_text']) or 1
                        ch += c['chars']
                        gc += c['chars'] * min(gold_chars(c, c['_text'], x['probe']) / raw, 1.0)
            return pc(gc, ch)
        ua = defaultdict(int)
        for x in A:
            for c in x['mainCalls']:
                ua[(x['probe']['id'], c['unitId'])] += 1
        ub = defaultdict(int)
        for x in B:
            for c in x['mainCalls']:
                ub[(x['probe']['id'], c['unitId'])] += 1
        la = [read_lines(c)[0] for c in ca if c['bucket'] == 'native-read']
        lb = [read_lines(c)[0] for c in cb if c['bucket'] == 'ss-read']
        fa = [first_gold(x) for x in A if x['probe']['_goldFiles']]
        fb = [first_gold(x) for x in B if x['probe']['_goldFiles']]
        top = d['patternsTop'].most_common(2)
        lines = [f"#### {gname(ga)} vs {gname(gb)} (paired n={n}{dag}; sweet − native = {dcost:+.4f} $/q)"]
        lines.append(f"_{'One run, arms in sequence' if d['sameRun'] else 'Separate runs'} ({d['order']}), not interleaved: the dollar figures carry provider-drift risk; the token and call figures do not._")
        lines.append(f"1. **Fixed prefix.** The sweet request-0 prompt is {p0b - p0a:+,.0f} tokens larger ({kfmt(p0a)} → {kfmt(p0b)}). "
                     f"Request 0 sends {kfmt(u0a)} → {kfmt(u0b)} tokens that are not read from cache. Estimated fixed-prefix cost difference: {dfix:+.4f} $/q "
                     + (f"({pm(dfix, dcost)} of the gap)." if dcost > 0.002 else "(the cost gap is too small to split)."))
        lines.append(f"2. **Output per search call.** Native search prints {kfmt(ns_ch)} chars per call (n={ns_n}); ss-search/ss-find print {kfmt(ss_ch)} (n={ss_n}{'†' if ss_n < SMALL else ''}), "
                     f"ss-grep {kfmt(sg_ch)} (n={sg_n}). Gold-bearing share: native search {gshare(A, {'native-search'})}, ss-grep {gshare(B, {'ss-grep'})}, "
                     f"ss-search/find {gshare(B, {'ss-search', 'ss-find'})}. Estimated tool-output cost difference: {dtool:+.4f} $/q.")
        lines.append(f"3. **Chaining.** Native runs {f2(mean(list(ua.values())))} commands per tool call (sweet {f2(mean(list(ub.values())))}), "
                     f"so it uses {f2(mean([x['nReqMain'] for x in A]))} requests per question against sweet's {f2(mean([x['nReqMain'] for x in B]))}. "
                     f"Every extra request re-reads the whole prefix.")
        lines.append(f"4. **Read windows.** Native reads show a median of {kfmt(pctile(la, .5))} lines ({kfmt(nr_ch)} chars per read, n={nr_n}); "
                     f"ss-read shows a median of {kfmt(pctile(lb, .5))} lines ({kfmt(sr_ch)} chars per read, n={sr_n}). Gold-bearing share: native read {gshare(A, {'native-read'})}, ss-read {gshare(B, {'ss-read'})}.")
        lines.append(f"5. **Where the trajectories split.** In the top 10 questions by sweet cost excess, the most common divergence is "
                     + (', '.join(f"'{k}' ({v}/10: {PATTERNS[k]})" for k, v in top) if top else 'none') +
                     f". First gold file: native at call {f2(mean([x['idx'] for x in fa if x['idx']]), 1)} after {kfmt(pctile([x['chars'] for x in fa if x['chars']], .5))} chars (median); "
                     f"sweet at call {f2(mean([x['idx'] for x in fb if x['idx']]), 1)} after {kfmt(pctile([x['chars'] for x in fb if x['chars']], .5))} chars.")
        blocks.append('\n'.join(lines))
    if not blocks:
        return '_No native/sweet pair yet._'
    return '\n\n'.join(blocks)


def write_paired_dossiers(pdata):
    d = os.path.join(OUT_DOSS, 'paired')
    os.makedirs(d, exist_ok=True)
    written = []
    def traj(r):
        p = r['probe']
        return {'tag': r['run']['tag'], 'arm': r['row']['arm'], 'armLabel': r['label'], 'score': r['row'].get('score'), 'costUsd': r['row'].get('costRealizedUsd'),
                'requests': r['nReqMain'], 'requestCostUsd': [round(x, 5) for x in r['reqCost']], 'requestUncachedTok': r['reqUncached'],
                'toolOutputChars': round(sum(c['chars'] for c in r['calls'])), 'firstGold': first_gold(r),
                'goldFilesNamedInAnswer': sorted(r['ansFiles']), 'answer': r['answer'],
                'calls': [{'idx': c.get('idx'), 'issuedTurn': c['turnIndex'], 'deliveredTurn': c.get('deliveredTurn'), 'turnsRemaining': c.get('turnsRemaining'),
                           'tool': c['tool'], 'bucket': c['bucket'], 'args': (c['args'] or '')[:400], 'chars': round(c['chars']), 'kind': c['kind'],
                           'goldFiles': sorted(c['goldFiles']), 'goldShown': sorted(c['goldShown']), 'goldChars': gold_chars(c, c['_text'], p),
                           'readLines': read_lines(c)[0], 'outputHead': smart_clip(c['_text'], p, 1500)} for c in r['mainCalls']]}
    for (ga, gb), x in pdata.items():
        f = os.path.join(d, f"{ga[1]}.{ga[2]}__{gb[2]}.{gb[3]}.jsonl")
        with open(f, 'w') as fh:
            for i, dc, dv in x['D']:
                a, b = x['A'][i], x['B'][i]
                p = a['probe']
                fh.write(json.dumps({'id': i, 'stratum': p['stratum'], 'repoGroup': p['_group'], 'question': p['query'],
                                     'gold': {'files': p['_goldFiles'], 'symbols': p['_goldSyms'], 'facts': p.get('expectedFacts')},
                                     'costExcessUsd': round(dc, 5), 'divergence': dv, 'sameRun': x['sameRun'],
                                     'native': traj(a), 'sweet': traj(b)}, ensure_ascii=False, default=list) + '\n')
        written.append((f, len(x['D'])))
    return written


# ----------------------------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--no-dossiers', action='store_true')
    ap.add_argument('--only', default=None)
    a = ap.parse_args()
    R, status, probes = load_all(a.only)
    G = groups_of(R)
    hard_dev = sum(1 for p in probes.values() if p['_difficulty'] == 'hard' and p.get('set') == 'dev')
    pairs_native = native_pairs(G)
    def base_of(g):
        return arm_label(g[2], g[3], g[1]).replace('+FixA', '').replace('sweet', 'sweet shipped (2.8.2)' if not g[1].startswith('cc') else 'sweet', 1) if not g[1].startswith('cc') else arm_label(g[2], g[3], g[1]).replace('+FixA', '')
    pairs_fix = paired(G, lambda ga, gb: arm_label(ga[2], ga[3], ga[1]) == base_of(gb) and '+FixA' not in arm_label(ga[2], ga[3], ga[1]),
                       lambda gb: '+FixA' in arm_label(gb[2], gb[3], gb[1]), R)
    t_succ, t_first = sec_success(G)
    t_waste, t_fb, t_err = sec_waste(G)
    p1, p2 = sec_pairs(G, pairs_native)
    f1, f2_ = sec_pairs(G, pairs_fix)
    md = []
    md.append('# r3-HARD retrieval questions — per-tool statistics with gold (DEV only)\n')
    md.append(f'Generated by `forensics/analyze_hard.py` (deterministic; re-run as runs finish). Hard DEV set = {hard_dev} questions '
              f'(`r3/r3-hard-probes.json`, set=dev); easy contrast = `r3/r3-probes.json` set=dev (60). Held-out rows are counted and never opened. '
              f'"Correct" = judge-panel score ≥ {CORRECT}. "Accuracy" = mean judge score (as in `r3/RESULTS-*.md`). '
              f'A † marks a share or comparison that rests on fewer than {SMALL} items: read it as a direction, not a number.\n')
    md.append('## Definitions\n')
    md.append('\n'.join([
        '- **call** = one tool segment. A compound shell command (`ss-read a; ss-grep b`) is split into its segments (fx_lib.parse_command + split_output). "tool calls/q (model)" counts model tool invocations instead (the runner\'s `calls`).',
        '- **buckets**: ss-* by executable basename; native-search = grep/rg/Grep/Glob/find/ls/git grep; native-read = Read/cat/sed/head/tail/nl/awk; other = everything else (ls-like plumbing excluded, edits, scripts).',
        '- **tokens** of a tool output = ceil(chars / 4) (estimate; the harness gives no per-result count). **amplified tokens** = output tokens × the number of later model requests that carry the output in their context (`turnsRemaining`, build_dossiers.attach_context).',
        '- **gold file in output**: a gold path appears in the output as a path token, or the call reads that file. **shown with code**: the call shows code from the gold file (ss-read / native read of it, an ss-search/ss-find entry with a code block, ss-semantic span). **only listed**: path or grep line only.',
        '- **gold symbol in output**: the last component of an expected symbol (`Server.Foo` → `Foo`) appears as a whole word. Short common names can match by chance; the share is an upper bound.',
        '- **named in answer**: gold path or its file name appears in the final answer; gold symbol by its last component.',
        '- **waste** = retrieval call with no gold file and no gold symbol in its output whose paths are never mentioned again (later model text, later call arguments, final answer). "Referenced" uses path or file-name matching, so waste is a lower bound.',
        '- **code lines shown again** = code lines (file + line number) already shown earlier in the same rollout by any tool.',
        f'- **cost**: runner field `costRealizedUsd` (price basis: `ideal-cost.mjs` MODEL_PRICES; Opus 5.5 $4 in / $0.20 cache read / $20 out per 1M, cache write = 1.25 × input; GPT-6.1 Sol $2 / $0.10 / $10, no cache-write premium). The token split is recomputed from the transcripts with the same formula; the table shows the reconciliation.',
        '- **extra-token decomposition**: Σ input tokens of a rollout ≈ requests × request-0 prefix (system prompt + tool definitions + rules + question) + amplified tool outputs + rest (model text and reasoning re-read, harness reminders, estimate error).',
    ]) + '\n')
    md.append('## 0. Runs and completeness\n')
    md.append(sec_status(status) + '\n')
    md.append('## Overview per cell × arm\n')
    md.append(sec_overview(G) + '\n')
    md.append('## 1–2. Tool mix, output chars and amplified tokens (main thread)\n')
    md.append(sec_toolmix(G) + '\n')
    md.append('## 3. Success per call, using gold\n')
    md.append('Calls on questions that have gold files (negative questions without gold files are left out).\n')
    md.append(t_succ + '\n')
    md.append('### First search-type call and one-call solves\n')
    md.append('First search-type call = the first ss-search / ss-find / ss-semantic / ss-trace / ss-grep / native search of the rollout. One-call solve = exactly one retrieval call, it is an ss-* call, and the answer is correct.\n')
    md.append(t_first + '\n')
    md.append('## 4. Waste\n')
    md.append(t_waste + '\n')
    md.append('### Native fallbacks after an ss-* call\n')
    md.append(t_fb + '\n')
    md.append('### Errors, usage errors, zero-hit calls\n')
    md.append(t_err + '\n')
    md.append('### Metadata share of ss-search and ss-find output (ok, unpiped calls)\n\nDetailed buckets come from ss_parse.py (shipped format only); the last two columns use a format-independent reader (fenced code vs everything else) and are comparable across shipped and Bundle A output.\n')
    md.append(sec_meta(G) + '\n')
    md.append('## 5. Cost decomposition per question\n')
    md.append(sec_cost(G) + '\n')
    md.append('### Request-0 cache cost: first rollout per repo vs later rollouts\n')
    md.append('Start order = timestamp of the first model request (runs used concurrency 3, so neighbours can overlap). The hard DEV set has '
              + f"{len({p['repo'] for p in probes.values() if p['_difficulty'] == 'hard' and p.get('set') == 'dev'})} repos for {hard_dev} questions.\n")
    md.append(sec_firstrepo(G) + '\n')
    md.append('**Caveat:** the pilot asks 2 questions per repo, so half its rollouts pay the cold-prefix write. This effect must be re-checked on the 97-question run '
              '(about 9 questions per repo) before any cost difference is attributed to V1b.\n')
    md.append('### Sweet vs native on the same questions (paired; bootstrap 95% CI of the mean difference, B=5000, seed 42)\n')
    md.append(p1 + '\n')
    md.append('### Where the extra cost comes from (paired means, B − A)\n')
    md.append(p2 + '\n')
    md.append('## 6. Per stratum and per repo group (hard only)\n')
    md.append(sec_strata(G) + '\n')
    md.append('## 7. Easy (r3 dev) vs hard, same cell and arm\n')
    md.append(sec_contrast(G) + '\n')
    n_chain, n_flags, n_read, n_first = sec_native_strategy(G)
    t_paired, pdata = sec_paired_native(G, pairs_native)
    md.append('## Why native is cheap\n')
    md.append('Native runs now queued on the 97-question hard DEV set (`r3hdev-op-nat`, `r3hdev-cx-nat`, `r3hdev-oc-nat`, final-tuning results folder) are paired automatically '
              'when they exist: each sweet group pairs with the native group of the same cell that shares the most questions. Until then the hard pair is the 20-question Opus pilot. '
              'Those native runs start AFTER the matching sweet run (not interleaved), so provider drift can bias every cost difference between them '
              '(Codex showed −24.5% cost between two identical runs 25 minutes apart). Token-level and call-level patterns are not affected.\n')
    md.append('### The five strongest patterns (computed; re-generated on every run)\n')
    md.append(why_native(G, pairs_native, pdata) + '\n')
    md.append('### N1. Native strategy\n')
    md.append('**Commands per model tool call** (a chained shell call `grep …; sed …` counts its commands; sweet groups shown for contrast). '
              'When one tool call chains several native commands, their shared output is split by line shape (grep lines vs read ranges); the last column counts the calls where that split failed and the output was divided equally.\n')
    md.append(n_chain + '\n')
    md.append('**Grep flags** (native search calls; shares of grep/rg calls, find/ls listings counted apart):\n')
    md.append(n_flags + '\n')
    md.append('**Read windows** (native reads: sed -n / head / Read ranges / gutter line numbers; ss-read: printed spans):\n')
    md.append(n_read + '\n')
    md.append('**Speed to the first gold file** (call index counts every command; chars are tool-output chars consumed up to and including that call):\n')
    md.append(n_first + '\n')
    md.append('### N2. Native vs sweet on the same question, and where they diverge\n')
    md.append(t_paired + '\n')
    md.append('### N3. Output efficiency: gold per character, per tool\n')
    md.append('Gold-bearing chars: a read of a gold file counts whole; a search/find/semantic entry counts when its header names a gold file; '
              'grep/trace lines count when they name a gold path. Tokens per NEW gold file = tool-output tokens of that tool ÷ gold files it surfaced first in the rollout.\n')
    md.append(sec_gold_eff(G) + '\n')
    md.append('### N4. Fixed overhead vs per-call output cost\n')
    md.append('Estimate with the cell price: fixed prefix = request-0 uncached tokens × write price + prefix × (requests − 1) × cache-read price; '
              'tool output = Σ output tokens × write price + amplified tokens × cache-read price (write price: Opus 1.25 × input; GPT input price). '
              'On the GPT cells some re-reads miss the cache, so their estimates are lower bounds; the rest column absorbs the difference.\n')
    md.append(sec_fixed(G) + '\n')
    md.append('## 8. Bundle A (SS_FIX_A=1) vs shipped output, same questions\n')
    md.append(f1 + '\n\n' + f2_ + '\n')
    if not a.no_dossiers:
        wp = write_paired_dossiers(pdata)
        md.append('## Paired dossiers\n')
        md.append('`forensics/hard-dossiers/paired/<cell>.<nativeTag>__<sweetTag>.<arm>.jsonl`: one record per question with the native and the sweet trajectory side by side '
                  '(per-request cost, every call with arguments, chars, gold hits, read window and a 1,500-char output head), the cost excess and the divergence step.\n')
        md.append(md_table(['file', 'questions'], [[os.path.relpath(f, HERE), n] for f, n in wp]) + '\n')
        w = write_dossiers(G)
        md.append('## Dossiers\n')
        md.append('One JSONL per cell-tag-arm in `forensics/hard-dossiers/`: one `rollout` record (question, gold, score, cost, answer) and one `call` record per tool call '
                  '(arguments, output clipped to 6,000 chars keeping rank headers and gold lines, gold hits, agent text before and after, next calls, turnsRemaining).\n')
        md.append(md_table(['file', 'rollouts', 'calls'], [[os.path.relpath(f, HERE), n, k] for f, n, k in w]) + '\n')
    md.append('## Re-run\n\n```\npython3 core/prompt-optimization/data/final-tuning/forensics/analyze_hard.py\n```\n(run from `/Users/admin/Projects/sweet-search-final-tuning`; `--no-dossiers` skips the JSONL files, `--only <tag substring>` limits the runs.)\n')
    open(OUT_MD, 'w').write('\n'.join(md))
    print(f'wrote {OUT_MD}: {len(R)} rollouts in {len(G)} groups', file=sys.stderr)
    for st in status:
        print(f"  {st['run']['difficulty']:4} {st['run']['cell']:18} {st['run']['tag']:22} rows={st['rows']} joined={st['joined']} problems={len(st['problems'])} heldoutSkipped={st['skippedNotDev']}", file=sys.stderr)


if __name__ == '__main__':
    main()
