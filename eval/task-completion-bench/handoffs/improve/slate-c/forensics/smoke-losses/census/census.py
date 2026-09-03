"""Build $S/census/rollouts.jsonl : one record per rollout, measures 1-9."""
import re, os, json, glob, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parselib import *

EXT = r'(?:java|py|rs|ts|tsx|js|jsx|mjs|cjs|go|cs|dart|kt|rb|bs|ron|scala|c|h|cpp|hpp|php|swift)'
REF_RE   = re.compile(r'([\w./-]+\.(?:java|py|rs|ts|js|go|cs|dart|kt|rb|bs)):(\d+)')  # spec regex
ANYF_RE  = re.compile(r'([\w./-]+\.' + EXT + r'):(\d+)(?:-(\d+))?')
SSREAD_RE= re.compile(r'^# ss-read (\S+) \(lines (\d+)-(\d+) of (\d+)\)', re.M)
SSRES_RE = re.compile(r'^## #\d+ (\S+?):(\d+)-(\d+)[^\n]*?\((full|preview|summary)', re.M)
SSSEM_RE = re.compile(r'^### (\S+?):(\d+)-(\d+)', re.M)
SSTRC_RE = re.compile(r'^# trace \S+ \[[^\]]+\] (\S+?):(\d+)-(\d+)', re.M)
VERD_RE  = re.compile(r'confidence=(high|medium|low)[^\n]*?sufficient=(YES|no|unknown|un)\b')

# ---------------------------------------------------------------- gold
def gold_files(task):
    p = f"{S}/gold/{task}.gold.diff"
    fs = [m.group(1) for m in re.finditer(r'^diff --git a/(\S+) b/', open(p, encoding='utf-8', errors='replace').read(), re.M)]
    return fs

NONSRC_DIR = ('docs/', '.github/', 'docker/', 'buildScripts/', 'reproductions/', 'specs/', 'test/', 'tests/')
NONSRC_BASE = {'CHANGELOG.md', 'AUTHORS', 'Dockerfile', '.spell-dict',
               'package-lock.json', 'package.json', 'grammar.ron'}
NONSRC_EXT = {'.md', '.txt', '.xml', '.yml', '.yaml', '.json', '.sh', '.dic', '.cfg', '.toml'}
def is_src(p):
    b = os.path.basename(p)
    if p.startswith(NONSRC_DIR): return False
    if '/test/' in p or '/tests/' in p: return False
    if re.search(r'\.(spec|test)\.[a-z]+$', b): return False
    if re.search(r'Tests?\.java$', b): return False
    if b in NONSRC_BASE: return False
    if os.path.splitext(b)[1] in NONSRC_EXT: return False
    return True

# ---------------------------------------------------------------- patches
def load_patch_files():
    out = {}
    for h in HARNESSES:
        for arm in ('native', 'sweet'):
            for rep in (0, 1, 2):
                d = f"{RUN[h]}/{arm}" + ("" if rep == 0 else f"/rep-{rep}")
                p = f"{d}/patches.json"
                if not os.path.exists(p): continue
                for e in json.load(open(p)):
                    fs = sorted(set(m.group(1) for m in re.finditer(
                        r'^diff --git a/(\S+) b/', e.get('patch') or '', re.M)))
                    out[(h, e['instance_id'], arm, rep)] = fs
    return out

# ---------------------------------------------------------------- intervals
def merge(iv):
    iv = sorted(iv)
    m = []
    for a, b in iv:
        if m and a <= m[-1][1] + 1: m[-1][1] = max(m[-1][1], b)
        else: m.append([a, b])
    return m
def span(iv): return sum(b - a + 1 for a, b in iv)

# ---------------------------------------------------------------- per step
def step_actions(h, st):
    """-> list of (kind, dict) where kind in search/read/edit/test/other."""
    tool, inp, out = st['tool'], st['inp'], st['out']
    acts = []
    if st['kind'] == 'EDIT':
        return [('edit', {})]
    if h == 'opencode' and tool == 'grep':
        pat = re.search(r'^pattern=(.*?) path=', inp or '')
        return [('search', dict(cmd=inp, prog='grep-tool', pattern=pat.group(1) if pat else None))]
    if h == 'opencode' and tool == 'glob':
        pat = re.search(r'^pattern=(.*?) path=', inp or '')
        return [('search', dict(cmd=inp, prog='glob-tool', pattern=pat.group(1) if pat else None))]
    if (h == 'opencode' and tool == 'read') or (h == 'claudecode' and tool == 'Read'):
        m = re.match(r'^(\S+) offset=(\S+) limit=(\S+)', inp or '')
        return [('read', dict(cmd=inp, prog='read-tool',
                              path=relpath(m.group(1)) if m else None,
                              offset=m.group(2) if m else None,
                              limit=m.group(3) if m else None))]
    if tool in ('exec_command', 'bash', 'Bash', 'write_stdin'):
        for seg in shell_segments(inp or ''):
            stages = pipeline_stages(seg)
            prog = head_word(stages[0]) if stages else ''
            progs = [head_word(s) for s in stages]
            if prog == 'run_tests' or seg.strip() == 'run_tests':
                acts.append(('test', dict(cmd=seg))); continue
            if prog in ('apply_patch', 'patch') or re.search(r'\bsed\s+-i\b|\bperl\s+-p?i\b', seg):
                acts.append(('edit', dict(cmd=seg, prog='shell-' + (prog or 'edit')))); continue
            hit = [p for p in progs if p in SEARCH_CMDS]
            if hit:
                k = progs.index(hit[0])
                acts.append(('search', dict(cmd=seg, prog=hit[0], pattern=first_arg(stages[k]))))
                continue
            if prog in SS_OTHER:
                acts.append(('ssother', dict(cmd=seg, prog=prog))); continue
            if prog in READ_CMDS:
                acts.append(('read', dict(cmd=seg, prog=prog))); continue
            acts.append(('other', dict(cmd=seg, prog=prog)))
        return acts
    return [('other', dict(cmd=inp, prog=tool))]

SED_RE  = re.compile(r"sed\s+(?:-[a-zA-Z]+\s+)*-n\s+['\"]?(\d+),(\d+)p['\"]?\s+(\S+)")
CAT_RE  = re.compile(r"^\s*cat\s+(?:-n\s+)?([\w./-]+\.\w+)\s*$")
HEAD_N  = re.compile(r"^\s*head\s+(?:-n\s*)?-?(\d+)\s+([\w./-]+\.\w+)")
SSREAD_C= re.compile(r"^\s*ss-read\s+(\S+)(?:\s+(\d+)\s+(\d+))?")

def harvest(st, ranges, totals, refs, files_read, true_n, refs_n):
    """Fold one step's INPUT/OUTPUT into path->intervals, path->total, refs set."""
    out = st['out'] or ''
    inp = st['inp'] or ''
    for m in SSREAD_RE.finditer(out):
        p = relpath(m.group(1)); a, b, n = int(m.group(2)), int(m.group(3)), int(m.group(4))
        ranges.setdefault(p, []).append((a, b)); totals[p] = max(totals.get(p, 0), n)
        true_n[p] = max(true_n.get(p, 0), n); files_read.add(p)
    for m in SSRES_RE.finditer(out):
        p = relpath(m.group(1)); a, b = int(m.group(2)), int(m.group(3))
        ranges.setdefault(p, []).append((a, b) if m.group(4) in ('full', 'preview') else (a, a))
    for m in SSSEM_RE.finditer(out):
        p = relpath(m.group(1)); ranges.setdefault(p, []).append((int(m.group(2)), int(m.group(3)))); files_read.add(p)
    for m in SSTRC_RE.finditer(out):
        p = relpath(m.group(1)); ranges.setdefault(p, []).append((int(m.group(2)), int(m.group(3))))
    for m in ANYF_RE.finditer(out):
        p = relpath(m.group(1)); a = int(m.group(2)); b = int(m.group(3)) if m.group(3) else a
        if b < a: b = a
        if b - a > 20000: continue
        ranges.setdefault(p, []).append((a, b)); totals[p] = max(totals.get(p, 0), b)
    for m in REF_RE.finditer(out):
        refs_n.add((relpath(m.group(1)), m.group(2)))
        refs.add((relpath(m.group(1)), m.group(2)))
    cur = None
    for ln in out.split('\n'):
        mp = re.match(r'^(/?\S+\.[A-Za-z0-9_]{1,5}):$', ln)
        if mp:
            cur = relpath(mp.group(1)); continue
        ml = re.match(r'^\s+Line (\d+):', ln)
        if ml and cur:
            refs_n.add((cur, ml.group(1)))
            ranges.setdefault(cur, []).append((int(ml.group(1)), int(ml.group(1))))
            totals[cur] = max(totals.get(cur, 0), int(ml.group(1)))
    # explicit read commands
    for seg in shell_segments(inp) if not inp.startswith('{') else []:
        for m in SED_RE.finditer(seg):
            p = relpath(m.group(3)); ranges.setdefault(p, []).append((int(m.group(1)), int(m.group(2))))
            totals[p] = max(totals.get(p, 0), int(m.group(2))); files_read.add(p)
        m = CAT_RE.match(seg)
        if m:
            p = relpath(m.group(1)); ranges.setdefault(p, []).append((1, 10 ** 7)); files_read.add(p)
        m = HEAD_N.match(seg)
        if m:
            p = relpath(m.group(2)); ranges.setdefault(p, []).append((1, int(m.group(1)))); files_read.add(p)
        m = SSREAD_C.match(seg)
        if m:
            p = relpath(m.group(1)); files_read.add(p)
            if m.group(2) is None: ranges.setdefault(p, []).append((1, 10 ** 7))

def harvest_readtool(st, ranges, totals, files_read):
    m = re.match(r'^(\S+) offset=(\S+) limit=(\S+)', st['inp'] or '')
    if not m: return
    p = relpath(m.group(1)); out = st['out'] or ''
    if '<tool_use_error>' in out: return
    files_read.add(p)
    nums = [int(x) for x in re.findall(r'^\s*(\d+)[:\t]', out, re.M)]
    if nums:
        ranges.setdefault(p, []).append((min(nums), max(nums)))
        totals[p] = max(totals.get(p, 0), max(nums))
    else:
        try: off = int(m.group(2)); lim = int(m.group(3))
        except Exception: return
        ranges.setdefault(p, []).append((max(1, off), max(1, off) + lim - 1))

def is_content_search(a):
    '''False for pure filename listings (rg --files, glob, ls-style) - they carry no pattern.'''
    if a.get('prog') == 'glob-tool': return False
    c = a.get('cmd') or ''
    if re.search(r'(?<!\S)--files(?!\S)', c) and not re.search(r'(?<!\S)-e(?!\S)', c): return False
    return True

BROAD_SHORT = 8
def is_broad(prog, cmd, pattern):
    why = []
    c = cmd or ''
    if re.search(r'(?<![\w-])-[a-zA-Z]*i(?![\w])', c) or ' -i ' in c or c.endswith(' -i') or 'ignore-case' in c:
        why.append('case-insensitive')
    p = pattern or ''
    if '|' in p: why.append('alternation')
    if p and len(p) < BROAD_SHORT and prog not in ('ss-search',): why.append(f'short-stem(<{BROAD_SHORT})')
    if '.*' in p or '.?' in p or '.+' in p: why.append('dot-star')
    rx = re.search(r'--regex\s+("([^"]*)"|\'([^\']*)\'|(\S+))', c)
    if rx:
        rp = rx.group(2) or rx.group(3) or rx.group(4) or ''
        if '|' in rp: why.append('regex-alternation')
        if '.*' in rp or '.?' in rp or '.+' in rp: why.append('regex-dot-star')
    return why

# ---------------------------------------------------------------- main
def build_filelen():
    """(task, path) -> true line count, harvested from every ss-read header in any rollout.
    Native never calls ss-read, so without this its coverage denominators are only lower bounds."""
    fl = {}
    for f in glob.glob(f"{S}/norm/*/*.md"):
        b = os.path.basename(f)[:-3]
        mm = re.match(r'^(.*)-(native|sweet)-r(\d)$', b)
        if not mm: continue
        t = mm.group(1)
        txt = open(f, encoding='utf-8', errors='replace').read()
        for m in SSREAD_RE.finditer(txt):
            k = (t, relpath(m.group(1)))
            fl[k] = max(fl.get(k, 0), int(m.group(4)))
    return fl

def main():
    filelen = build_filelen()
    patchf = load_patch_files()
    rowsidx = {}
    for h in HARNESSES:
        for r in json.load(open(f"{RUN[h]}/rows.json")):
            rowsidx[(h, r['taskId'], r['arm'], r['rep'])] = r
    goldsrc = {}
    for p in glob.glob(f"{S}/gold/*.gold.diff"):
        t = os.path.basename(p)[:-len('.gold.diff')]
        g = gold_files(t)
        goldsrc[t] = dict(all=g, src=[x for x in g if is_src(x)])
    out = open(f"{S}/census/rollouts.jsonl", 'w')
    ssgrep_sizes, ssread_sizes = [], []
    nrec = 0
    for h in HARNESSES:
        for f in sorted(glob.glob(f"{S}/norm/{h}/*.md")):
            b = os.path.basename(f)[:-3]
            m = re.match(r'^(.*)-(native|sweet)-r(\d)$', b)
            task, arm, rep = m.group(1), m.group(2), int(m.group(3))
            main_steps, sub_steps = parse_transcript(f)
            row = rowsidx.get((h, task, arm, rep), {})
            pf = patchf.get((h, task, arm, rep), [])
            pf_src = [x for x in pf if is_src(x)]
            # ---- classify
            first_edit = None
            per = []
            for st in main_steps:
                acts = step_actions(h, st) if st['kind'] in ('tool', 'EDIT') else []
                per.append((st, acts))
                if first_edit is None and any(k == 'edit' for k, _ in acts):
                    first_edit = st['idx']
            no_edit = first_edit is None
            cut = first_edit if first_edit is not None else 10 ** 9
            # ---- pre-edit accumulation
            ranges, totals, refs, files_read, true_n, refs_n = {}, {}, set(), set(), {}, set()
            n_calls = 0; chars = 0; searches = []; ssgrep_pre = 0
            for st, acts in per:
                if st['idx'] >= cut: break
                if st['kind'] == 'tool':
                    n_calls += 1
                    chars += st['out_true_len']
                if h in ('opencode', 'claudecode') and st['tool'] in ('read', 'Read'):
                    harvest_readtool(st, ranges, totals, files_read)
                harvest(st, ranges, totals, refs, files_read, true_n, refs_n)
                for k, a in acts:
                    if k == 'search':
                        hits, hsrc = hits_from_output(a.get('prog'), st['out'])
                        searches.append(dict(step=st['idx'], prog=a['prog'], cmd=a['cmd'],
                                             pattern=a.get('pattern'), hits=hits, hits_src=hsrc,
                                             broad=is_broad(a['prog'], a['cmd'], a.get('pattern')),
                                             content=is_content_search(a),
                                             compound=len(shell_segments(st['inp'] or '')) > 1))
            n_calls_total = sum(1 for st, a in per if st['kind'] == 'tool')
            n_ssread = n_ssgrep = n_ssgrep_single = 0
            for st, acts in per:
                if st['kind'] != 'tool': continue
                for k, a in acts:
                    c = a.get('cmd') or ''
                    if re.search(r'(?<!\S)ss-read(?!\S)', c): n_ssread += 1
                    if a.get('prog') == 'ss-grep':
                        n_ssgrep += 1
                        h2, _ = hits_from_output('ss-grep', st['out'])
                        if h2 == 1: n_ssgrep_single += 1
            sub_search_n = 0
            for st in sub_steps:
                if st['kind'] != 'tool': continue
                for k, a in step_actions(h, st):
                    if k == 'search': sub_search_n += 1
            # ---- whole-rollout stats (ss-grep output sizes, verdicts)
            verd = []
            for i, (st, acts) in enumerate(per):
                if st['kind'] != 'tool': continue
                cmds = ' ; '.join(a.get('cmd') or '' for k, a in acts)
                if 'ss-grep' in (cmds or '') and st['out']:
                    ssgrep_sizes.append(st['out_true_len'])
                if 'ss-read' in (cmds or '') and st['out']:
                    ssread_sizes.append(st['out_true_len'])
                for vm in VERD_RE.finditer(st['out'] or ''):
                    nxt = None
                    for st2, acts2 in per[i + 1:]:
                        if st2['kind'] in ('tool', 'EDIT'):
                            nxt = ('EDIT' if st2['kind'] == 'EDIT'
                                   else (acts2[0][1].get('prog') or st2['tool']) if acts2 else st2['tool'])
                            break
                    verd.append(dict(step=st['idx'], conf=vm.group(1),
                                     suff={'YES':'yes','un':'unknown'}.get(vm.group(2), vm.group(2)),
                                     pre=st['idx'] < cut, nxt=nxt))
            # ---- edited-file coverage
            cov = []
            for p in (pf_src or pf):
                iv = merge(ranges.get(p, []))
                xn = filelen.get((task, p))
                n = max(totals.get(p, 0), xn or 0)
                seen = span([(a, min(b, n if n else b)) for a, b in iv]) if iv else 0
                if iv and iv[-1][1] >= 10 ** 6:
                    whole, wsrc = True, 'unranged-read'   # bare `cat f` / `ss-read f` with no range
                else:
                    whole = bool(n) and seen >= 0.99 * n
                    wsrc = ('covers-all-observed' if whole else None)
                cov.append(dict(path=p, n_lines=(n or None), seen=(min(seen, n) if n else seen),
                                frac=(round(min(seen, n) / n, 4) if n else None),
                                n_src=('ss-read-header' if p in true_n else
                                       ('cross-arm-ss-read' if xn else ('observed-max' if n else 'unknown'))),
                                whole=whole, whole_src=wsrc, touched=bool(iv)))
            fr = [c['frac'] for c in cov if c['frac'] is not None]
            fs = searches[0] if searches else None
            fcs = next((x for x in searches if x['content']), None)
            rec = dict(
                id=f"{h}/{task}-{arm}-r{rep}", h=h, task=task, arm=arm, rep=rep,
                resolved=bool(row.get('resolved')), f2pFrac=row.get('f2pFrac'),
                resolveStatus=row.get('resolveStatus'),
                cost=row.get('costRealizedUsd'), usage=row.get('usage'),
                calls_total=row.get('calls'), ss_total=row.get('ss'),
                first_edit_step=first_edit, no_edit=no_edit,
                # 1
                first_search_cmd=(fs or {}).get('cmd'), first_search_prog=(fs or {}).get('prog'),
                first_search_hits=(fs or {}).get('hits'), first_search_hits_src=(fs or {}).get('hits_src'),
                singleton_first=(None if not fs or fs['hits'] is None else fs['hits'] == 1),
                n_searches_pre=len(searches), n_content_searches_pre=sum(1 for x in searches if x['content']),
                fcs_cmd=(fcs or {}).get('cmd'), fcs_prog=(fcs or {}).get('prog'),
                fcs_hits=(fcs or {}).get('hits'), fcs_hits_src=(fcs or {}).get('hits_src'),
                fcs_compound=(fcs or {}).get('compound'),
                singleton_first_content=(None if not fcs or fcs['hits'] is None else fcs['hits'] == 1),
                # 2
                broad_pre=any(bool(x['broad']) for x in searches),
                broad_cmds=[x['cmd'] for x in searches if x['broad']][:4],
                broad_why=sorted({w for x in searches for w in x['broad']}),
                # 3
                distinct_refs_pre=len(refs), distinct_refs_pre_norm=len(refs_n),
                # 4/5
                cov=cov, cov_frac_mean=(round(sum(fr) / len(fr), 4) if fr else None),
                whole_file_pre=any(c['whole'] for c in cov) if cov else None,
                # 6
                n_files_read_pre=len(files_read), chars_out_pre=chars, n_tool_calls_pre=n_calls,
                n_tool_calls_total=n_calls_total, n_ssread_calls=n_ssread,
                n_ssgrep_calls=n_ssgrep, n_ssgrep_singleton=n_ssgrep_single,
                # 7
                gold_files=goldsrc[task]['all'], gold_src_files=len(goldsrc[task]['src']),
                patch_files=len(pf), patch_src_files=len(pf_src), patch_list=pf,
                under_edit=(len(pf) < len(goldsrc[task]['src'])),
                # 8
                verdicts=verd, n_sub_steps=len(sub_steps),
                sub_tool_calls=sum(1 for x in sub_steps if x['kind'] == 'tool'),
                sub_chars=sum(x['out_true_len'] for x in sub_steps if x['kind'] == 'tool'),
                sub_searches=sub_search_n,
                searches=searches,
            )
            out.write(json.dumps(rec) + '\n'); nrec += 1
    out.close()
    json.dump(dict(ssgrep_out_chars=ssgrep_sizes, ssread_out_chars=ssread_sizes),
              open(f"{S}/census/toolsizes.json", 'w'))
    print("rollouts written:", nrec)

if __name__ == '__main__':
    main()
