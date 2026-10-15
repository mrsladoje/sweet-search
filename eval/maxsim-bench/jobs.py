# Job identity and result validation, shared by run_matrix.py and check_complete.py
# (PAPER_PLAN.md section 5, items 1-3).
#
# A job = one arm, one set group, one round, one process repetition. Its key is the
# SHA-256 of: every set's name and content-manifest hash, the arm spec, the hashes of the
# code and binaries the arm runs (benchmark script, loader, contracts, kernel library,
# rival shim, addon, package versions), all options, the arm's scoring contract, and the
# instance ID. A result file is reused only if it holds the same key and validates.
import hashlib, json, os, platform, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.normpath(os.path.join(HERE, '..', '..'))
EXT = '.dylib' if sys.platform == 'darwin' else '.so'
_sha = {}


def sha_file(path):
    path = os.path.realpath(path)
    if path not in _sha:
        if not os.path.exists(path):
            _sha[path] = 'missing:' + path
        else:
            h = hashlib.sha256()
            with open(path, 'rb') as f:
                for b in iter(lambda: f.read(1 << 20), b''):
                    h.update(b)
            _sha[path] = h.hexdigest()
    return _sha[path]


def instance_id():
    return os.environ.get('SS_INSTANCE_ID') or platform.node()


def parse_spec(spec):
    """'[node:]arm[~variant][@threads][%env]' -> dict."""
    s = spec
    env = None
    if '%' in s:
        s, env = s.split('%', 1)
    node = s.startswith('node:')
    if node:
        s = s[5:]
    s, _, threads = s.partition('@')
    arm, _, variant = s.partition('~')
    return dict(spec=spec, node=node, arm=arm, variant=variant or None, threads=int(threads or 0), env=env)


def file_name(spec):
    """Result-file stem of an arm spec (v1 names kept: ':' -> '-', '@' -> '@t')."""
    return spec.replace(':', '-').replace('@', '@t').replace('%', '+')


def python_for(env):
    v = f'venv-{env}' if env else 'venv'
    return os.path.join(HERE, v, 'bin', 'python')


_pkgs = {}


def package_versions(python):
    if python not in _pkgs:
        code = ('import importlib.metadata as m, json, sys\n'
                'out = {"python": sys.version.split()[0]}\n'
                'for p in ("numpy", "torch", "maxsim-cpu", "numkong", "threadpoolctl"):\n'
                '    try: out[p] = m.version(p)\n'
                '    except Exception: pass\n'
                'print(json.dumps(out))')
        r = subprocess.run([python, '-I', '-c', code], capture_output=True, text=True)
        _pkgs[python] = json.loads(r.stdout) if r.returncode == 0 else {'error': r.stderr[-200:]}
    return _pkgs[python]


_contracts = {}


def contract_of(spec):
    """(contract, clamp, precision) of an arm, from bench.py's registry."""
    p = parse_spec(spec)
    if p['node']:
        return ('S', True, 'int4')
    py = python_for(p['env'])
    if py not in _contracts:
        r = subprocess.run([py, '-I', os.path.join(HERE, 'bench.py'), '--list-arms'], capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(f'bench.py --list-arms failed: {r.stderr[-300:]}')
        _contracts[py] = {l.split('\t')[0]: tuple(l.split('\t')[1:]) for l in r.stdout.splitlines() if l}
    if p['arm'] not in _contracts[py]:
        raise KeyError(f'unknown arm {p["arm"]} in {spec}')
    c, clamp, prec = _contracts[py][p['arm']]
    return (c, clamp == 'clamp', prec)


_addon = {}


def node_addon():
    if 'path' not in _addon:
        r = subprocess.run(['node', '-e', "import(process.argv[1]).then(m => console.log(m.loadNativeAddon().path))",
                            os.path.join(SRC, 'core', 'infrastructure', 'native-resolver.js')], capture_output=True, text=True)
        _addon['path'] = r.stdout.strip() or 'unresolved'
        _addon['node'] = subprocess.run(['node', '--version'], capture_output=True, text=True).stdout.strip()
    return _addon


def binaries(spec):
    """Hashes of everything the arm executes, apart from the OS."""
    p = parse_spec(spec)
    b = {}
    if p['node']:
        a = node_addon()
        b['node'] = a['node']
        b['addon'] = sha_file(a['path'])
        for f in ('bench-node.mjs', 'node-arms.mjs', 'replay.mjs'):
            b[f] = sha_file(os.path.join(HERE, f))
        for f in ('simd-distance.js', 'maxsim-pack.js', 'native-resolver.js'):
            b[f] = sha_file(os.path.join(SRC, 'core', 'infrastructure', f))
        b['late-interaction-index.js'] = sha_file(os.path.join(SRC, 'core', 'ranking', 'late-interaction-index.js'))
        if p['arm'] == 'wasm':
            b['maxsim.wasm'] = sha_file(os.path.join(SRC, 'core', 'infrastructure', 'maxsim.wasm'))
        if p['arm'] == 'legacy':
            b['legacy_addon'] = sha_file(os.environ.get('LEGACY_ADDON', 'unset'))
        return b
    for f in ('bench.py', 'replay_py.py', 'contracts.py'):
        b[f] = sha_file(os.path.join(HERE, f))
    b['packages'] = package_versions(python_for(p['env']))
    if p['arm'] == 'ours':
        lib = (os.path.join(os.environ['SS_CAPI_DIR'], p['variant'] + EXT) if p['variant']
               else os.environ.get('SS_CAPI') or os.path.join(HERE, 'capi', 'target', 'release', 'libss_maxsim_capi' + EXT))
        b['capi'] = sha_file(lib)
    if p['arm'].startswith('nextplaid') or p['arm'].startswith('numkong_native'):
        b['rivals_rs'] = sha_file(os.environ.get('SS_RIVALS_RS') or os.path.join(HERE, 'rivals-rs', 'target', 'release', 'librivals_rs' + EXT))
        b['rivals_rs.py'] = sha_file(os.path.join(HERE, 'rivals_rs.py'))
    if p['arm'] == 'torch_colbert_packed':
        b['segmented_maxsim.cpp'] = sha_file(os.environ.get('COLBERT_SEGMAXSIM') or os.path.join(HERE, 'third_party', 'segmented_maxsim.cpp'))
    return b


def job_key(sets, set_hashes, spec, options, contract):
    blob = dict(sets=[[os.path.basename(s.rstrip('/')), h] for s, h in zip(sets, set_hashes)], arm=spec,
                binaries=binaries(spec), options=options, contract=list(contract), instance=instance_id())
    return hashlib.sha256(json.dumps(blob, sort_keys=True).encode()).hexdigest(), blob


def validate(path, key, expected_calls, reps, kind='matrix'):
    """'' if the result file is complete and belongs to this job, else the reason."""
    if not os.path.exists(path):
        return 'missing'
    try:
        d = json.load(open(path))
    except Exception as e:
        return f'unreadable ({type(e).__name__})'
    if not d.get('complete'):
        return 'not complete'
    if d.get('job_key') != key:
        return 'job key differs'
    if kind == 'mem':  # W11 RAM pass (mem.py / mem-node.mjs): one record per job, not per call
        if d.get('n_calls') != expected_calls or not d.get('summary', {}).get('tokens'):
            return f"{d.get('n_calls')} calls selected, expected {expected_calls}"
        return ''
    if kind == 'concurrency':
        runs = d.get('runs', [])
        if len(runs) != expected_calls or any(not r.get('lat_ns') for r in runs):
            return f'{len(runs)} concurrency runs, expected {expected_calls}'
        return ''
    calls = d.get('calls', [])
    if len(calls) != expected_calls or d.get('n_calls') != expected_calls:
        return f'{len(calls)} calls, expected {expected_calls}'
    for c in calls:
        if len(c.get('ts_ns', ())) != reps or not all(isinstance(t, (int, float)) and t >= 0 for t in c['ts_ns']):
            return f'call {c.get("file")}: {len(c.get("ts_ns", ()))} timings, expected {reps}'
    return ''
