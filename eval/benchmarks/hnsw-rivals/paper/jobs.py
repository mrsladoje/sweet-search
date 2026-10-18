# Job identity and result validation (DESIGN.md 5.4-5.5; PAPER_PLAN.md section 5 items 1-2).
#
# A job = one system configuration, one split, one comparison, one round, on one machine. Its key holds
# every field of PAPER_PLAN 5.1; the result file is named by the key's SHA-256, so two operating points
# can never share a file. A file is reused only on a full key match and a valid record.
import hashlib, json, os, platform, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
PY_FAMILIES = {'scann'}  # adapters run by py5.py, the others by rivals5
_sha = {}


def sha_file(path):
    path = os.path.realpath(path)
    st = os.stat(path) if os.path.exists(path) else None
    ck = (path, st.st_size, st.st_mtime_ns) if st else (path,)
    if ck not in _sha:
        if st is None:
            _sha[ck] = 'missing:' + path
        else:
            h = hashlib.sha256()
            with open(path, 'rb') as f:
                for b in iter(lambda: f.read(1 << 22), b''):
                    h.update(b)
            _sha[ck] = h.hexdigest()
    return _sha[ck]


def sha_json(obj):
    return hashlib.sha256(json.dumps(obj, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def instance_id():
    if os.environ.get('SS_INSTANCE_ID'):
        return os.environ['SS_INSTANCE_ID']
    try:  # EC2 (IMDSv2)
        tok = subprocess.run(['curl', '-s', '-m', '1', '-X', 'PUT', 'http://169.254.169.254/latest/api/token',
                              '-H', 'X-aws-ec2-metadata-token-ttl-seconds: 60'], capture_output=True, text=True).stdout
        if tok:
            iid = subprocess.run(['curl', '-s', '-m', '1', '-H', f'X-aws-ec2-metadata-token: {tok}',
                                  'http://169.254.169.254/latest/meta-data/instance-id'], capture_output=True, text=True).stdout
            if iid.startswith('i-'):
                return iid
    except FileNotFoundError:
        pass
    return platform.node()


def set_hashes(data, set_name):
    s = json.load(open(os.path.join(data, 'sets', set_name, 'set.json')))
    return s['membership_sha256'], s['queries_sha256']


def model_hash(data, model, set_name):
    return sha_file(os.path.join(data, 'emb', model, set_name, 'model.json'))


def index_hash(job, data):
    """SHA-256 over the serialised index files the serving process opens."""
    if job['system'].startswith('ours'):
        root = job.get('index') or os.path.join(data, 'emb', job['model'], job['set'], 'index')
        ss = os.path.join(root, '.sweet-search')
        return sha_json({f: sha_file(os.path.join(ss, f)) for f in
                         ('codebase-binary-hnsw.idx', 'codebase-binary-hnsw.fullvec.bin', 'codebase-binary-hnsw.fullvec.map')})
    b = json.load(open(os.path.join(job['build_dir'], 'build.json')))
    return sha_json({k: v['sha256'] for k, v in b['files'].items()})


def binaries(job, repo):
    """Hashes of what the job executes, apart from the OS."""
    b = {}
    if job['system'].startswith('ours'):
        b['ours5.mjs'] = sha_file(os.path.join(HERE, 'ours5.mjs'))
        b['node'] = subprocess.run(['node', '--version'], capture_output=True, text=True).stdout.strip()
        addon = subprocess.run(['node', '-e', "import(process.argv[1]).then(m => console.log(m.loadNativeAddon().path))",
                                os.path.join(repo, 'core', 'infrastructure', 'native-resolver.js')], capture_output=True, text=True).stdout.strip()
        b['addon'] = sha_file(addon) if addon else 'unresolved'
        core = []
        for d, _, fs in os.walk(os.path.join(repo, 'core')):
            core += [os.path.join(d, f) for f in fs if f.endswith('.js')]
        b['core_js'] = sha_json({os.path.relpath(f, repo): sha_file(f) for f in sorted(core)})
    elif job.get('family') in PY_FAMILIES:
        for f in ('py5.py', 'adapters/scann_adapter.py'):
            b[f] = sha_file(os.path.join(HERE, f))
        b['librescore5.so'] = sha_file(os.path.join(os.path.dirname(os.path.abspath(job['binary'])), 'librescore5.so'))
        b['python'] = subprocess.run([job['python'], '-I', '-c', 'import sys, scann, numpy; print(sys.version.split()[0], '
                                      'getattr(scann, "__version__", "?"), numpy.__version__)'], capture_output=True, text=True).stdout.strip()
    else:
        b['rivals5'] = sha_file(job['binary'])
        info = os.path.join(os.path.dirname(job['binary']), 'build-info.json')
        if os.path.exists(info):
            b['build-info.json'] = sha_file(info)
    return b


KEY_FIELDS = ('comparison', 'system', 'family', 'build_params', 'build_seed', 'search', 'C', 'H', 'kv', 'gen', 'round',
              'split', 'kind', 'options', 'ef', 'S1', 'EF', 'pagecache')
# fields a job may carry outside the key (they are in the key through other entries: set hashes, machine, index hash)
UNKEYED = {'set', 'model', 'machine', 'index', 'build_dir', 'binary', 'python'}


def job_key(job, data, repo):
    extra = set(job) - set(KEY_FIELDS) - UNKEYED
    if extra:  # a parameter outside the key would make different jobs share one record
        raise ValueError(f'job fields not in the job key: {sorted(extra)}')
    mem, qry = set_hashes(data, job['set'])
    key = dict(set=job['set'], set_membership=mem, queries=qry, model=job['model'],
               model_manifest=model_hash(data, job['model'], job['set']),
               index_sha256=index_hash(job, data), binaries=binaries(job, repo), instance=instance_id(),
               machine=job['machine'])
    for k in KEY_FIELDS:
        if k in job:
            key[k] = job[k]
    return sha_json(key), key


def result_path(results, job, h):
    return os.path.join(results, job['machine'], job['set'], job['model'], h + '.json')


def validate(path, h, key, n_queries):
    """'' if the record at path is complete and belongs to this job, else the reason."""
    if not os.path.exists(path):
        return 'missing'
    try:
        d = json.load(open(path))
    except Exception as e:
        return f'unreadable ({type(e).__name__})'
    if not d.get('complete'):
        return 'not complete'
    if d.get('job_hash') != h or d.get('key') != key:
        return 'job key differs'
    t = d.get('timings_ns') or []
    if d.get('n_queries') != n_queries or len(t) != n_queries or any(not isinstance(x, int) or x < 0 for x in t):
        return f'{len(t)} timings, expected {n_queries}'
    lp = path[:-5] + '.lists.bin'
    if not os.path.exists(lp) or os.path.getsize(lp) != n_queries * d['L'] * 8:
        return 'lists file missing or wrong size'
    if hashlib.sha256(open(lp, 'rb').read()).hexdigest() != d.get('lists_sha256'):
        return 'lists file hash differs'
    return ''


# ---- builds (one serialised index per configuration, built once, copied to every machine)
SOURCES = {'faiss': 'adapters/faiss_adapters.cpp', 'hnswlib': 'adapters/hnswlib_adapter.cpp', 'usearch': 'adapters/usearch_adapters.cpp',
           'diskann': 'adapters/diskann_adapter.cpp', 'svs': 'adapters/svs_adapter.cpp', 'scann': 'adapters/scann_adapter.py'}
COMMON = ('adapter.h', 'adapters/common.h', 'rivals5.cpp', 'py5.py', 'build-paper.sh', 'adapters/build-new.sh',
          'adapters/requirements-scann-linux-x86_64.lock')


_PIN = os.path.join(HERE, 'builder-pin.json')
_PIN = json.load(open(_PIN))['sha256'] if os.path.exists(_PIN) else {}


def builder_id(fam):
    """What decides a serialised index, apart from its parameters: the library pins (in the build scripts) and the
    adapter source. Not the CPU or the binary hash: an index is built once and copied to every timing machine
    (owner, 2026-10-15), so all CPUs search the same file."""
    src = SOURCES[fam.split('_')[0]]
    return sha_json({f: _PIN.get(f) or sha_file(os.path.join(HERE, f)) for f in (src,) + COMMON})  # builder-pin.json: post-freeze


def build_dir(data, b):
    bh = sha_json(dict(family=b['family'], build_params=b['build_params'], build_seed=b['build_seed'],
                            set=set_hashes(data, b['set'])[0], model=model_hash(data, b['model'], b['set']),
                            builder=builder_id(b['family'])))[:16]
    return os.path.join(data, 'builds', 'shared', b['set'], b['model'], b['family'], bh)
