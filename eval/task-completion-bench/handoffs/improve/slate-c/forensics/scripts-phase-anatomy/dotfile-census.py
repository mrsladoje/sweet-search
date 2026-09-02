#!/usr/bin/env python3
"""dotfile-census.py -- how often do agents touch extensionless dot-config files, and does the sweet index see them?

Runs on the box next to phase-anatomy.py. Read-only. Scans ALL rollouts (22 tasks x 3 reps x 2 arms) of the three
production-form runs. For every tool call it records:
  - call TARGETS a dot-config file (Read/read/ss-read/cat/sed/grep/rg ... with a dot-config path argument)
  - tool OUTPUT mentions a dot-config path (a grep/glob/ls hit, an ss-* result line)
  - for sweet: ss-grep / ss-find / ss-search / ss-semantic calls whose output mentions one (index visibility)
Dot-config = a path component that starts with '.' and has no extension after the leading dot-name
(.eslintrc, .prettierrc, .editorconfig, .flowconfig, .babelrc, .npmrc, .env, .tool-versions), plus the classic
extensionless config names (Makefile, Dockerfile, Gemfile, Rakefile, Procfile, Justfile, CMakeLists.txt is excluded).
"""
import sys, os, json, re, collections, importlib.util
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("pa", os.path.join(HERE, "phase-anatomy.py"))
pa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pa)

DOT_RE = re.compile(r'(?<![\w/.-])\.(?:eslintrc|prettierrc|editorconfig|flowconfig|babelrc|npmrc|nvmrc|yarnrc|env|tool-versions|'
                    r'eslintignore|prettierignore|dockerignore|gitattributes|gitignore|mocharc|nycrc|stylelintrc|jshintrc|jscsrc|'
                    r'pylintrc|flake8|coveragerc|isort\.cfg|rubocop\.yml|golangci\.yml|clang-format|clang-tidy|swiftlint\.yml|'
                    r'markdownlint\.json|remarkrc|huskyrc|lintstagedrc|commitlintrc|releaserc|travis\.yml|circleci|github)'
                    r'(?:\.(?:js|cjs|json|ya?ml|toml))?(?![\w-])')
PLAIN_RE = re.compile(r'(?<![\w/.-])(?:Makefile|Dockerfile|Gemfile|Rakefile|Procfile|Justfile|Brewfile|Vagrantfile|Jenkinsfile|Podfile|Fastfile)(?![\w.-])')
SS_SEARCH = ('ss-grep', 'ss-find', 'ss-search', 'ss-semantic', 'ss-trace')


def dot_hits(text):
    if not text:
        return set()
    return set(m.group(0) for m in DOT_RE.finditer(text)) | set(m.group(0) for m in PLAIN_RE.finditer(text))


def load_calls(harness, row):
    """(calls with _in text and _out text) using the probe.py approach."""
    run = row['_run']
    out = []
    if harness == 'codex':
        f = pa.codex_file(row)
        if not f:
            return out
        pend = {}
        for d in pa.jl(f):
            p = d.get('payload') or {}
            t = p.get('type')
            if t == 'function_call':
                try:
                    a = json.loads(p.get('arguments') or '{}')
                except Exception:
                    a = {}
                cmd = a.get('cmd') if p.get('name') == 'exec_command' else json.dumps(a)
                cmd = cmd if isinstance(cmd, str) else ' '.join(map(str, cmd or []))
                rec = {'tool': p.get('name'), 'in': cmd, 'out': ''}
                out.append(rec)
                pend[p.get('call_id')] = rec
            elif t == 'function_call_output':
                rec = pend.get(p.get('call_id'))
                if rec is not None:
                    o = p.get('output')
                    rec['out'] = (o if isinstance(o, str) else json.dumps(o)).replace('\\n', '\n')
    elif harness == 'opencode':
        for fpath in pa.opencode_files(row):
            for d in pa.jl(fpath):
                if d.get('type') != 'tool_use':
                    continue
                p = d.get('part') or {}
                st = p.get('state') or {}
                inp = st.get('input') or {}
                out.append({'tool': p.get('tool'), 'in': json.dumps(inp), 'out': pa.text_of(st.get('output'))})
    else:
        cell = pa.claude_cell(run, row)
        if not cell:
            return out
        res, uses, order = {}, {}, []
        for d in pa.jl(cell['main']):
            m = d.get('message') or {}
            content = m.get('content') if isinstance(m.get('content'), list) else []
            for b in content:
                if b.get('type') == 'tool_use' and b.get('id') not in uses:
                    uses[b['id']] = {'tool': b.get('name'), 'in': json.dumps(b.get('input') or {}), 'out': ''}
                    order.append(b['id'])
                elif b.get('type') == 'tool_result':
                    res[b.get('tool_use_id')] = pa.text_of(b.get('content'))
        for i in order:
            uses[i]['out'] = res.get(i, '')
            out.append(uses[i])
    return out


def ss_tool_of(cmd):
    for t in SS_SEARCH:
        if re.search(r'(^|[\s;&|(`])' + re.escape(t) + r'\b', cmd):
            return t
    return None


tot = collections.defaultdict(collections.Counter)
examples = collections.defaultdict(list)
for harness in ('codex', 'opencode', 'claude-code'):
    rows, _ = pa.load_rows(harness)
    for row in rows:
        arm = row['arm']
        calls = load_calls(harness, row)
        rid = "%s/%s/%s/rep%d" % (harness, row['taskId'], arm, row['rep'])
        touched, seen_out, ss_seen, ss_calls_blind = set(), set(), set(), 0
        for c in calls:
            hi = dot_hits(c['in'])
            ho = dot_hits(c['out'])
            if hi:
                touched |= hi
            if ho:
                seen_out |= ho
            cmd = c['in'] if harness == 'codex' else (json.loads(c['in']).get('command', '') if c['tool'] in ('bash', 'Bash') else '')
            sst = ss_tool_of(cmd or '')
            if sst:
                if ho:
                    ss_seen |= ho
                # an ss-* search whose pattern names a dot-config concept but whose output has no dot-config path
                if re.search(r'eslint|prettier|editorconfig|lint|unused-vars|flowconfig|babel', cmd, re.I) and not ho:
                    ss_calls_blind += 1
        k = (harness, arm)
        tot[k]['rollouts'] += 1
        if touched:
            tot[k]['rollouts_targeting_dotconfig'] += 1
            tot[k]['dotconfig_targets'] += len(touched)
        if seen_out:
            tot[k]['rollouts_output_shows_dotconfig'] += 1
        if ss_seen:
            tot[k]['rollouts_ss_output_shows_dotconfig'] += 1
        tot[k]['ss_lint_searches_without_dotconfig_hit'] += ss_calls_blind
        if touched or ss_calls_blind:
            examples[k].append((rid, sorted(touched)[:6], ss_calls_blind))

print("dot-config census over the three TAB runs (native rows from fp-*, opencode sweet repair rows from rp-oc-tab):")
for k in sorted(tot):
    print(k, dict(tot[k]))
print("\nexamples (rollout, dot-config paths the agent targeted, ss lint-searches with no dot-config hit):")
for k in sorted(examples):
    for e in examples[k][:14]:
        print(" ", k, e)
