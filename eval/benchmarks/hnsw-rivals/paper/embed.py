#!/usr/bin/env python
"""Embed a set with one model (DESIGN.md section 2).

    python embed.py --model CodeRankEmbed --set gcsn --data DATA [--device cuda|mps|cpu] [--limit N] [--batch B]
                    [--revision pinned|latest]
    python embed.py --model M --set S --data DATA --device cpu --make-ref REFDIR   (reference vectors: first 50 docs + 50 queries)
    python embed.py --model M --set S --data DATA --device cuda --check REFDIR     (gate: min cosine >= 0.99999 expected, exit 1 below 0.9999)

Reads  DATA/sets/<set>/texts.jsonl   (documents: the "text" of every vector, vector-id order)
       DATA/sets/<set>/queries.jsonl (queries, queries.f32 row order)
Writes DATA/emb/<model>/<set>/{corpus.f32, queries.f32, model.json}

Contract (MODELS.json is the single source; the table in PAPER_PLAN section 4 and the model cards):
  CodeRankEmbed          mean pooling (the product's; the HF card says cls, which gives different vectors),
                         query prefix "Represent this query for searching relevant code: ", no doc prefix
  jina-v2-base-code      mean pooling, no prefixes, trust_remote_code
  bge-base-en-v1.5       cls pooling,  query instruction "Represent this sentence for searching relevant passages: ",
                         no doc prefix
On CUDA the run is full fp32: TF32 off for matmul and cuDNN, float32 matmul precision "highest", and the attention
(scaled_dot_product_attention) is forced to the math backend (plain fp32 matmuls; the flash / memory-efficient kernels are
not used). These settings, the GPU name, driver and CUDA version are written to model.json ("inference").
All: fp32 inference, tokenizer truncation at max_length 512 tokens (longer texts are cut, the counts are in
model.json), L2-normalised outputs, float32 on disk, 768 columns.

A complete output (model.json with the same texts_sha256) is not recomputed without --force. The file bytes depend on
--block and --batch (rows are sorted by length inside a block, so the padding differs): values agree to ~1e-6, the
SHA-256 in model.json is the identity. Resumable: rows are appended to corpus.f32.part / queries.f32.part in blocks of --block texts (default 4096); a
restart reads the row count of the .part file and continues. The files are renamed to corpus.f32 / queries.f32 and
model.json is written only when all rows are done. With --limit N only the first N documents and N queries are
embedded, into DATA/emb/<model>/<set>.limit<N>/ (a test run never touches a real output).

The revision of the model repository (and of every repository its remote code comes from) is resolved when the run
starts; --revision pinned (default) uses the commit in MODELS.json when it is set, and fails if the hub no longer
serves it; --revision latest resolves the head of the main branch. The commits used are written to model.json.
"""
import argparse, hashlib, json, os, platform, sys, time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DIM = 768


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 24), b''):
            h.update(b)
    return h.hexdigest()


def load_models():
    return json.load(open(os.path.join(HERE, 'MODELS.json')))['models']


def resolve_revision(repo, pinned):
    from huggingface_hub import HfApi
    api = HfApi()
    if pinned:
        info = api.model_info(repo, revision=pinned)  # raises if the commit is gone
        return info.sha
    return api.model_info(repo).sha


def remote_code_repos(hf_id, revision):
    """Repositories that supply the model code (auto_map entries 'repo--module.Class')."""
    from huggingface_hub import hf_hub_download
    cfg = json.load(open(hf_hub_download(hf_id, 'config.json', revision=revision)))
    out = set()
    for v in (cfg.get('auto_map') or {}).values():
        v = v[0] if isinstance(v, (list, tuple)) else v
        if isinstance(v, str) and '--' in v:
            out.add(v.split('--', 1)[0])
    return sorted(out)


def pick_device(want):
    import torch
    if want:
        return want
    if torch.cuda.is_available():
        return 'cuda'
    if getattr(torch.backends, 'mps', None) and torch.backends.mps.is_available():
        return 'mps'
    return 'cpu'


def configure_precision(torch, device):
    """Full fp32 on CUDA; returns the settings for model.json. Other devices: nothing is changed."""
    info = {'device': device, 'tf32_matmul': None, 'tf32_cudnn': None, 'float32_matmul_precision': torch.get_float32_matmul_precision(),
            'sdpa_backend': 'default'}
    if device != 'cuda':
        return info
    torch.backends.cuda.matmul.allow_tf32 = False
    torch.backends.cudnn.allow_tf32 = False
    torch.set_float32_matmul_precision('highest')
    assert not torch.backends.cuda.matmul.allow_tf32 and not torch.backends.cudnn.allow_tf32
    assert torch.get_float32_matmul_precision() == 'highest'
    props = torch.cuda.get_device_properties(0)
    try:
        import subprocess
        driver = subprocess.run(['nvidia-smi', '--query-gpu=driver_version', '--format=csv,noheader', '-i', '0'],
                                capture_output=True, text=True, timeout=30).stdout.strip() or None
    except Exception:
        driver = None
    info.update({
        'tf32_matmul': False, 'tf32_cudnn': False, 'float32_matmul_precision': 'highest',
        'sdpa_backend': 'math (torch.nn.attention.sdpa_kernel(SDPBackend.MATH) around every forward)',
        'gpu_name': props.name, 'gpu_capability': f'sm_{props.major}{props.minor}', 'gpu_memory_gib': round(props.total_memory / 2**30, 1),
        'nvidia_driver': driver, 'cuda_runtime': torch.version.cuda, 'cudnn': torch.backends.cudnn.version(),
        'torch_arch_list': torch.cuda.get_arch_list()})
    return info


class Embedder:
    def __init__(self, spec, device, revision):
        import torch
        from transformers import AutoModel, AutoTokenizer
        self.torch = torch
        self.spec = spec
        self.device = device
        self.max_length = spec['max_length']
        kw = {'revision': revision}
        if spec.get('trust_remote_code'):
            kw['trust_remote_code'] = True
        model_kw = dict(kw, **spec.get('model_args', {}))  # the model card's sentence-transformers model_args
        self.tok = AutoTokenizer.from_pretrained(spec['hf_id'], **kw)
        try:
            self.model = AutoModel.from_pretrained(spec['hf_id'], dtype=torch.float32, **model_kw)
        except TypeError:  # transformers < 4.56 spells it torch_dtype
            self.model = AutoModel.from_pretrained(spec['hf_id'], torch_dtype=torch.float32, **model_kw)
        self.model = self.model.to(device).eval()
        bad = {str(p.dtype) for p in self.model.parameters() if p.dtype != torch.float32}
        assert not bad, f'model has non-fp32 parameters: {bad}'
        self.precision = configure_precision(torch, device)
        self._sdpa = None
        if device == 'cuda':
            from torch.nn.attention import sdpa_kernel, SDPBackend
            self._sdpa = lambda: sdpa_kernel(SDPBackend.MATH)
        self.last_over = 0

    def _encode_batch(self, texts):
        torch = self.torch
        enc = self.tok(texts, padding=True, truncation=True, max_length=self.max_length, return_tensors='pt')
        enc = {k: v.to(self.device) for k, v in enc.items() if k in ('input_ids', 'attention_mask', 'token_type_ids')}
        import contextlib
        with torch.inference_mode(), (self._sdpa() if self._sdpa else contextlib.nullcontext()):
            out = self.model(**enc)
            h = out[0] if not hasattr(out, 'last_hidden_state') else out.last_hidden_state
            if self.spec['pooling'] == 'cls':
                v = h[:, 0]
            elif self.spec['pooling'] == 'mean':
                m = enc['attention_mask'].unsqueeze(-1).to(h.dtype)
                v = (h * m).sum(1) / m.sum(1).clamp(min=1e-9)
            else:
                raise ValueError(self.spec['pooling'])
            v = torch.nn.functional.normalize(v.float(), p=2, dim=1)
        return v.cpu().numpy().astype('<f4')

    def encode(self, texts, batch):
        """Embed `texts` (any order); returns float32 [n, 768] in the order of `texts`.
        Sorted by token count inside the call so a batch pads little; the result order is restored."""
        n = len(texts)
        lens = [len(x) for x in self.tok(texts, add_special_tokens=True, truncation=False)['input_ids']]
        self.last_over = sum(1 for l in lens if l > self.max_length)
        order = sorted(range(n), key=lambda i: lens[i])
        out = np.empty((n, DIM), dtype='<f4')
        for s in range(0, n, batch):
            idx = order[s:s + batch]
            out[idx] = self._encode_batch([texts[i] for i in idx])
        return out


def _rows_on_disk(part_path):
    return os.path.getsize(part_path) // (DIM * 4) if os.path.exists(part_path) else 0


def read_lines(path, limit=None):
    with open(path, encoding='utf-8') as f:
        for i, line in enumerate(f):
            if limit is not None and i >= limit:
                return
            yield json.loads(line)


def run_part(embedder, items, part_path, block, batch, label, stop_after=None):
    """Append embeddings of `items` (list of str) to part_path in blocks; resume from the existing rows."""
    row_bytes = DIM * 4
    done = os.path.getsize(part_path) // row_bytes if os.path.exists(part_path) else 0
    if os.path.exists(part_path):
        with open(part_path, 'r+b') as f:
            f.truncate(done * row_bytes)  # drop a partial row from a killed run
    # sidecar: one line "rows_done over_length_in_block" per finished block; lines beyond the rows on disk are dropped
    side = part_path + '.trunc'
    kept = []
    if os.path.exists(side):
        for line in open(side):
            r, o = map(int, line.split())
            if r <= done:
                kept.append((r, o))
    done = kept[-1][0] if kept else 0
    with open(part_path, 'r+b' if os.path.exists(part_path) else 'wb') as f:
        f.truncate(done * row_bytes)
    open(side, 'w').write(''.join(f'{r} {o}\n' for r, o in kept))
    n = len(items)
    if done >= n:
        return done, 0.0, sum(o for _, o in kept)
    t0 = time.time()
    with open(part_path, 'ab') as f:
        for s in range(done, n, block):
            v = embedder.encode(items[s:s + block], batch)
            f.write(v.tobytes())
            f.flush()
            os.fsync(f.fileno())
            kept.append((min(s + block, n), embedder.last_over))
            with open(side, 'a') as sf:
                sf.write(f'{kept[-1][0]} {kept[-1][1]}\n')
            el = time.time() - t0
            print(f'  {label}: {min(s + block, n)}/{n}  {(min(s + block, n) - done) / max(el, 1e-9):.1f} texts/s', flush=True)
            if stop_after is not None and (s - done) // block + 1 >= stop_after:
                sys.exit(f'stopped after {stop_after} blocks (test of the resume path)')
    return n, time.time() - t0, sum(o for _, o in kept)


REF_N = 50
CHECK_EXPECT, CHECK_FAIL = 0.99999, 0.9999


def ref_mode(a, spec):
    """--make-ref REFDIR (write the reference) or --check REFDIR (compare). First REF_N documents and REF_N queries."""
    import torch, transformers
    sdir = os.path.join(a.data, 'sets', a.set)
    docs = [o['text'] for o in read_lines(os.path.join(sdir, 'texts.jsonl'), REF_N)]
    queries = [o['text'] for o in read_lines(os.path.join(sdir, 'queries.jsonl'), REF_N)]
    qprefix, dprefix = spec.get('query_prefix', ''), spec.get('doc_prefix', '')
    docs_in, queries_in = [dprefix + t for t in docs], [qprefix + t for t in queries]
    inputs_sha = hashlib.sha256(json.dumps([docs_in, queries_in], ensure_ascii=True).encode()).hexdigest()
    device = pick_device(a.device)
    rev = resolve_revision(spec['hf_id'], spec.get('revision') if a.revision == 'pinned' else None)
    emb = Embedder(spec, device, rev)
    x, q = emb.encode(docs_in, a.batch), emb.encode(queries_in, a.batch)
    meta = {'model': a.model, 'set': a.set, 'revision': rev, 'n_docs': len(docs), 'n_queries': len(queries), 'inputs_sha256': inputs_sha,
            'device': device, 'torch': torch.__version__, 'transformers': transformers.__version__, 'batch': a.batch,
            'precision': emb.precision}
    if a.make_ref:
        os.makedirs(a.make_ref, exist_ok=True)
        x.tofile(os.path.join(a.make_ref, 'corpus.f32'))
        q.tofile(os.path.join(a.make_ref, 'queries.f32'))
        json.dump(meta, open(os.path.join(a.make_ref, 'ref.json'), 'w'), indent=2)
        print(f'reference written: {a.make_ref} ({len(docs)} docs, {len(queries)} queries, {device})')
        return 0
    ref = json.load(open(os.path.join(a.check, 'ref.json')))
    if ref['inputs_sha256'] != inputs_sha:
        print(f'CHECK FAIL {a.model}/{a.set}: the reference was made from other texts (inputs sha256 differs)')
        return 1
    rx = np.fromfile(os.path.join(a.check, 'corpus.f32'), dtype='<f4').reshape(-1, DIM).astype(np.float64)
    rq = np.fromfile(os.path.join(a.check, 'queries.f32'), dtype='<f4').reshape(-1, DIM).astype(np.float64)
    cd = (rx * x.astype(np.float64)).sum(1) / (np.linalg.norm(rx, axis=1) * np.linalg.norm(x.astype(np.float64), axis=1))
    cq = (rq * q.astype(np.float64)).sum(1) / (np.linalg.norm(rq, axis=1) * np.linalg.norm(q.astype(np.float64), axis=1))
    lo = float(min(cd.min(), cq.min()))
    verdict = 'PASS' if lo >= CHECK_EXPECT else ('WARN (below 0.99999, above 0.9999)' if lo >= CHECK_FAIL else 'FAIL')
    print(f'CHECK {verdict} {a.model}/{a.set}: min cosine {lo:.8f} (docs {cd.min():.8f}, queries {cq.min():.8f}) '
          f'device {device} vs reference {ref["device"]} torch {ref["torch"]}', flush=True)
    return 0 if lo >= CHECK_FAIL else 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', required=True)
    ap.add_argument('--set', required=True)
    ap.add_argument('--data', required=True)
    ap.add_argument('--device', default=None, choices=['cuda', 'mps', 'cpu'])
    ap.add_argument('--limit', type=int, default=None)
    ap.add_argument('--batch', type=int, default=32)
    ap.add_argument('--block', type=int, default=4096)
    ap.add_argument('--revision', default='pinned', choices=['pinned', 'latest'])
    ap.add_argument('--make-ref', default=None, metavar='REFDIR', help='write reference vectors of the first 50 docs + 50 queries (run on the Mac CPU)')
    ap.add_argument('--check', default=None, metavar='REFDIR', help='embed the same 50 + 50 texts and compare with REFDIR; exit 1 if min cosine < 0.9999')
    ap.add_argument('--force', action='store_true', help='recompute although a complete output exists')
    ap.add_argument('--stop-after-blocks', type=int, default=None, help='test only: exit after N blocks of the corpus')
    a = ap.parse_args()

    models = load_models()
    if a.model not in models:
        sys.exit(f'unknown model {a.model}; MODELS.json has {list(models)}')
    spec = models[a.model]
    sdir = os.path.join(a.data, 'sets', a.set)
    texts_path, q_path = os.path.join(sdir, 'texts.jsonl'), os.path.join(sdir, 'queries.jsonl')
    for p in (texts_path, q_path):
        if not os.path.exists(p):
            sys.exit(f'missing {p}')
    if a.make_ref or a.check:
        sys.exit(ref_mode(a, spec))
    out_dir = os.path.join(a.data, 'emb', a.model, a.set + (f'.limit{a.limit}' if a.limit else ''))
    os.makedirs(out_dir, exist_ok=True)
    mj = os.path.join(out_dir, 'model.json')
    if os.path.exists(mj) and not a.force and json.load(open(mj)).get('texts_sha256') == sha256_file(texts_path):
        print(f'{out_dir} is complete for these texts (model.json); --force recomputes')
        return

    device = pick_device(a.device)
    import torch, transformers
    rev = resolve_revision(spec['hf_id'], spec.get('revision') if a.revision == 'pinned' else None)
    code_repos = remote_code_repos(spec['hf_id'], rev) if spec.get('trust_remote_code') else []
    code_revs = {r: resolve_revision(r, None) for r in code_repos}
    print(f"model {a.model} ({spec['hf_id']}@{rev[:12]}) device {device} torch {torch.__version__} "
          f"transformers {transformers.__version__} remote code {code_revs}", flush=True)

    docs = [o['text'] for o in read_lines(texts_path, a.limit)]
    queries = [o['text'] for o in read_lines(q_path, a.limit)]
    qprefix, dprefix = spec.get('query_prefix', ''), spec.get('doc_prefix', '')
    docs_in = [dprefix + t for t in docs] if dprefix else docs
    queries_in = [qprefix + t for t in queries]

    emb = Embedder(spec, device, rev)
    t_all = time.time()
    c_start = _rows_on_disk(os.path.join(out_dir, 'corpus.f32.part'))
    q_start = _rows_on_disk(os.path.join(out_dir, 'queries.f32.part'))
    c_done, c_s, c_over = run_part(emb, docs_in, os.path.join(out_dir, 'corpus.f32.part'), a.block, a.batch, 'corpus', a.stop_after_blocks)
    q_done, q_s, q_over = run_part(emb, queries_in, os.path.join(out_dir, 'queries.f32.part'), a.block, a.batch, 'queries')
    for kind in ('corpus', 'queries'):
        os.replace(os.path.join(out_dir, kind + '.f32.part'), os.path.join(out_dir, kind + '.f32'))
        os.remove(os.path.join(out_dir, kind + '.f32.part.trunc'))

    x = np.fromfile(os.path.join(out_dir, 'corpus.f32'), dtype='<f4').reshape(-1, DIM)
    q = np.fromfile(os.path.join(out_dir, 'queries.f32'), dtype='<f4').reshape(-1, DIM)
    nx, nq = np.linalg.norm(x.astype(np.float64), axis=1), np.linalg.norm(q.astype(np.float64), axis=1)
    assert len(x) == len(docs) and len(q) == len(queries) and np.isfinite(x).all() and np.isfinite(q).all()
    script = os.path.abspath(__file__)
    manifest = {
        'model': a.model, 'hf_id': spec['hf_id'], 'revision': rev, 'tokenizer_revision': rev,
        'query_prefix': qprefix, 'doc_prefix': dprefix, 'pooling': spec['pooling'], 'max_length': spec['max_length'],
        'inference_precision': 'fp32', 'normalised': True, 'dim': DIM, 'stored_precision': 'float32',
        'our_f16_rounding': 'nearest-even', 'code_width': 512, 'int8_width': 512,
        'embedder': {'script': 'paper/embed.py', 'sha256': sha256_file(script),
                     'machine': f'{platform.node()} {platform.system()} {platform.machine()} device={device}',
                     'torch': torch.__version__, 'transformers': transformers.__version__,
                     'numpy': np.__version__, 'python': platform.python_version()},
        'corpus_sha256': sha256_file(os.path.join(out_dir, 'corpus.f32')),
        'queries_sha256': sha256_file(os.path.join(out_dir, 'queries.f32')),
        'inference': emb.precision,
        'remote_code_revisions': code_revs,
        'texts_sha256': sha256_file(texts_path), 'queries_jsonl_sha256': sha256_file(q_path),
        'truncation': {'max_length': spec['max_length'], 'side': 'right (tokenizer default)',
                       'documents_over_max_length': c_over, 'queries_over_max_length': q_over,
                       'documents': len(docs), 'queries': len(queries)},
        'stats': {'rows': int(len(x)), 'queries': int(len(q)),
                  'corpus_norm_min': float(nx.min()), 'corpus_norm_max': float(nx.max()),
                  'queries_norm_min': float(nq.min()), 'queries_norm_max': float(nq.max())},
        'seconds': {'corpus': round(c_s, 2), 'queries': round(q_s, 2), 'total': round(time.time() - t_all, 2)},
        'rates_this_session': {'docs_per_s': round((len(docs) - c_start) / c_s, 2) if c_s else None,
                               'queries_per_s': round((len(queries) - q_start) / q_s, 2) if q_s else None,
                               'note': 'rows done in this session / seconds of this session (a resumed run counts only its own rows)'},
        'limit': a.limit, 'complete': a.limit is None,
    }
    with open(os.path.join(out_dir, 'model.json'), 'w') as f:
        json.dump(manifest, f, indent=2)
        f.write('\n')
    print(f"done {a.model}/{a.set}: corpus {x.shape} queries {q.shape} norm [{nx.min():.6f},{nx.max():.6f}] "
          f"truncated docs {c_over}/{len(docs)} queries {q_over}/{len(queries)} total {manifest['seconds']['total']}s", flush=True)


if __name__ == '__main__':
    main()
