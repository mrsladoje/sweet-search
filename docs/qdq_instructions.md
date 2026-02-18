# QDQ INT8 Quantization for CodeRankEmbed

Quantize the local embedding model (CodeRankEmbed) to INT8 QDQ format for ~2x inference speedup.

**QDQ** = QuantizeLinear/DequantizeLinear nodes that ORT preserves through graph optimization, unlike dynamic quantization which gets dequantized back to FP32.

## Prerequisites (Windows)

```powershell
# Python 3.10+ required
python --version

# Install dependencies
pip install onnxruntime onnx tokenizers numpy
# For GPU-accelerated calibration (optional):
pip install onnxruntime-gpu
```

## Step 1: Locate the FP32 model

The source model lives in the HuggingFace transformers cache. After sweet-search has downloaded it:

```
node_modules/@huggingface/transformers/.cache/jalipalo/CodeRankEmbed-onnx/onnx/model.onnx       (~522MB, FP32)
node_modules/@huggingface/transformers/.cache/jalipalo/CodeRankEmbed-onnx/tokenizer.json
```

Copy both files to a working directory:

```powershell
mkdir C:\qdq-work
copy node_modules\@huggingface\transformers\.cache\jalipalo\CodeRankEmbed-onnx\onnx\model.onnx C:\qdq-work\
copy node_modules\@huggingface\transformers\.cache\jalipalo\CodeRankEmbed-onnx\tokenizer.json C:\qdq-work\
```

## Step 2: Prepare calibration data

QDQ requires representative input samples to measure activation ranges. This is NOT fine-tuning — it's a measurement pass that takes a few minutes.

### Critical rules for calibration data:

1. **Use mixed languages** — Python, JavaScript, TypeScript, Go, Java, Ruby, PHP. 30-50 chunks per language.
2. **Use real code** — Pull snippets from actual open source repos, not synthetic examples.
3. **Match your chunking pipeline** — Truncate to the same length your indexer uses (default: 512 tokens, ~2000 chars).
4. **200-500 total samples** is the sweet spot. More is better but has diminishing returns.

Create `calibration_data.py`:

```python
"""Collect calibration data from real code repositories."""
import os
import glob
import random

def collect_calibration_texts(corpus_dirs, n=300, max_chars=2000):
    """
    Collect code snippets from corpus directories.

    Args:
        corpus_dirs: list of directories containing source code files
        n: number of samples to collect
        max_chars: max characters per sample (match your indexer's truncation)
    """
    extensions = ['*.py', '*.js', '*.ts', '*.go', '*.java', '*.rb', '*.php',
                  '*.rs', '*.cpp', '*.c', '*.kt', '*.swift']

    all_files = []
    for d in corpus_dirs:
        for ext in extensions:
            all_files.extend(glob.glob(os.path.join(d, '**', ext), recursive=True))

    random.shuffle(all_files)
    texts = []

    for f in all_files:
        if len(texts) >= n:
            break
        try:
            with open(f, 'r', encoding='utf-8', errors='ignore') as fh:
                content = fh.read()
                # Take a random chunk from the file (simulates real chunking)
                if len(content) > max_chars:
                    start = random.randint(0, len(content) - max_chars)
                    content = content[start:start + max_chars]
                if len(content.strip()) > 50:  # skip near-empty files
                    texts.append(content[:max_chars])
        except Exception:
            pass

    print(f"Collected {len(texts)} calibration samples from {len(all_files)} files")
    return texts


if __name__ == '__main__':
    import json

    # Point these at real codebases on your machine
    dirs = [
        # Examples — replace with actual paths on your Windows machine:
        # r'C:\Users\you\projects\some-python-project\src',
        # r'C:\Users\you\projects\some-js-project\src',
        r'eval/corpus/codesearchnet',  # sweet-search benchmark corpus
    ]

    texts = collect_calibration_texts(dirs, n=300, max_chars=2000)

    with open('C:\\qdq-work\\calibration_texts.json', 'w') as f:
        json.dump(texts, f)

    print(f"Saved {len(texts)} texts to C:\\qdq-work\\calibration_texts.json")
```

## Step 3: Quantize with selective op coverage

This is the most important part. **Do NOT quantize all ops.** LayerNorm, Softmax, and final pooling layers must stay in FP32 — quantizing them destroys embedding quality.

Create `quantize_qdq.py`:

```python
"""
Quantize CodeRankEmbed ONNX model to INT8 QDQ format.

IMPORTANT: Only quantize MatMul/Gemm ops. Leave normalization layers in FP32.
"""
import os
import json
import gc
import numpy as np

WORK_DIR = r'C:\qdq-work'
FP32_MODEL = os.path.join(WORK_DIR, 'model.onnx')
PREPROCESSED = os.path.join(WORK_DIR, 'model_preprocessed.onnx')
QDQ_MODEL = os.path.join(WORK_DIR, 'model_qdq_int8.onnx')
TOKENIZER_PATH = os.path.join(WORK_DIR, 'tokenizer.json')
CALIBRATION_DATA = os.path.join(WORK_DIR, 'calibration_texts.json')


def tokenize_texts(texts, max_length=512):
    """Tokenize using the model's tokenizer."""
    from tokenizers import Tokenizer

    tokenizer = Tokenizer.from_file(TOKENIZER_PATH)
    tokenizer.enable_padding(length=max_length, pad_id=0)
    tokenizer.enable_truncation(max_length=max_length)
    encoded = tokenizer.encode_batch(texts)
    input_ids = np.array([e.ids for e in encoded], dtype=np.int64)
    attention_mask = np.array([e.attention_mask for e in encoded], dtype=np.int64)
    return input_ids, attention_mask


class CodeCalibrationReader:
    """CalibrationDataReader — batch_size=1 to minimize peak RAM."""

    def __init__(self, input_ids, attention_mask):
        self.input_ids = input_ids
        self.attention_mask = attention_mask
        self.idx = 0

    def get_next(self):
        if self.idx >= len(self.input_ids):
            return None
        feed = {
            'input_ids': self.input_ids[self.idx:self.idx + 1],
            'attention_mask': self.attention_mask[self.idx:self.idx + 1],
        }
        self.idx += 1
        return feed

    def rewind(self):
        self.idx = 0


def get_nodes_to_exclude(model_path):
    """
    Find nodes that should NOT be quantized:
    - LayerNorm (destroys normalized outputs)
    - Softmax (precision-sensitive)
    - Add nodes inside residual connections (optional, improves quality)

    Returns list of node names to exclude.
    """
    import onnx
    model = onnx.load(model_path)

    exclude = []
    for node in model.graph.node:
        op = node.op_type
        name = node.name

        # Never quantize normalization or softmax
        if op in ('LayerNormalization', 'Softmax', 'ReduceMean'):
            exclude.append(name)

        # Skip the final pooling/normalization layers
        # (look for nodes near the output that aren't MatMul)
        if op in ('Div', 'Sqrt', 'Pow') and 'norm' in name.lower():
            exclude.append(name)

    del model
    gc.collect()

    print(f"  Excluding {len(exclude)} nodes from quantization")
    return exclude


def main():
    from onnxruntime.quantization import (
        quantize_static, quant_pre_process,
        QuantFormat, QuantType, CalibrationMethod,
    )

    print(f"\n=== QDQ INT8 Quantization for CodeRankEmbed ===\n")
    print(f"  FP32 model: {os.path.getsize(FP32_MODEL) / 1024 / 1024:.1f} MB")

    # Step 1: Preprocess (shape inference + constant folding)
    print(f"\n[1/4] Preprocessing model...")
    if os.path.exists(PREPROCESSED):
        os.unlink(PREPROCESSED)
    quant_pre_process(FP32_MODEL, PREPROCESSED)
    print(f"  Done: {os.path.getsize(PREPROCESSED) / 1024 / 1024:.1f} MB")
    gc.collect()

    # Step 2: Find nodes to exclude from quantization
    print(f"\n[2/4] Analyzing model graph...")
    nodes_to_exclude = get_nodes_to_exclude(PREPROCESSED)

    # Step 3: Calibration data
    print(f"\n[3/4] Preparing calibration data...")
    with open(CALIBRATION_DATA, 'r') as f:
        texts = json.load(f)
    print(f"  Loaded {len(texts)} calibration texts")

    input_ids, attention_mask = tokenize_texts(texts, max_length=512)
    print(f"  Tokenized: {input_ids.shape}")
    reader = CodeCalibrationReader(input_ids, attention_mask)

    # Step 4: Quantize (Percentile calibration — more robust than MinMax)
    print(f"\n[4/4] Quantizing (Percentile calibration, per-channel weights)...")
    print(f"  Running {len(texts)} calibration samples one-at-a-time...")

    if os.path.exists(QDQ_MODEL):
        os.unlink(QDQ_MODEL)

    quantize_static(
        PREPROCESSED,
        QDQ_MODEL,
        reader,
        quant_format=QuantFormat.QDQ,
        per_channel=True,                          # Per-channel weights (better quality)
        weight_type=QuantType.QInt8,
        activation_type=QuantType.QUInt8,
        calibrate_method=CalibrationMethod.Percentile,  # More robust than MinMax
        nodes_to_exclude=nodes_to_exclude,          # Protect LayerNorm/Softmax
        extra_options={
            'ActivationSymmetric': False,
            'WeightSymmetric': True,
            'CalibPercentile': 99.99,              # Percentile threshold
        },
    )

    qdq_size = os.path.getsize(QDQ_MODEL) / 1024 / 1024
    fp32_size = os.path.getsize(FP32_MODEL) / 1024 / 1024
    print(f"\n  FP32 model:  {fp32_size:.1f} MB")
    print(f"  QDQ model:   {qdq_size:.1f} MB ({qdq_size/fp32_size*100:.0f}%)")

    # Cleanup preprocessed
    try:
        os.unlink(PREPROCESSED)
    except Exception:
        pass

    # Quick op count
    import onnx
    model = onnx.load(QDQ_MODEL)
    ops = {}
    for node in model.graph.node:
        ops[node.op_type] = ops.get(node.op_type, 0) + 1
    qdq_ops = {k: v for k, v in ops.items() if 'uantize' in k}
    print(f"  QDQ ops: {qdq_ops}")
    print(f"  MatMul remaining (FP32): {ops.get('MatMul', 0)}")
    del model
    gc.collect()

    print(f"\n=== Done! ===")
    print(f"  Output: {QDQ_MODEL}")
    print(f"\n  Next: run Step 4 (validation) before deploying.")


if __name__ == '__main__':
    main()
```

## Step 4: Validate quality BEFORE deploying

This is the most critical step. **Never deploy a quantized model without validation.**

Create `validate_qdq.py`:

```python
"""
Validate QDQ model quality by comparing embeddings against FP32 baseline.
If cosine similarity < 0.95, the quantization is broken.
"""
import os
import json
import numpy as np
import onnxruntime as ort

WORK_DIR = r'C:\qdq-work'
FP32_MODEL = os.path.join(WORK_DIR, 'model.onnx')
QDQ_MODEL = os.path.join(WORK_DIR, 'model_qdq_int8.onnx')
TOKENIZER_PATH = os.path.join(WORK_DIR, 'tokenizer.json')


def create_session(model_path):
    opts = ort.SessionOptions()
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    opts.intra_op_num_threads = 4
    return ort.InferenceSession(model_path, opts)


def tokenize(texts, max_length=512):
    from tokenizers import Tokenizer
    tokenizer = Tokenizer.from_file(TOKENIZER_PATH)
    tokenizer.enable_padding(length=max_length, pad_id=0)
    tokenizer.enable_truncation(max_length=max_length)
    encoded = tokenizer.encode_batch(texts)
    return {
        'input_ids': np.array([e.ids for e in encoded], dtype=np.int64),
        'attention_mask': np.array([e.attention_mask for e in encoded], dtype=np.int64),
    }


def get_embeddings(session, inputs):
    """Run inference and return mean-pooled, L2-normalized embeddings."""
    outputs = session.run(None, inputs)
    # CodeRankEmbed outputs: [token_embeddings, sentence_embedding]
    # Use sentence_embedding (index 1) if available, else mean-pool token_embeddings
    if len(outputs) >= 2:
        embeddings = outputs[1]  # sentence_embedding
    else:
        token_embs = outputs[0]  # [batch, seq, hidden]
        mask = inputs['attention_mask']
        mask_expanded = np.expand_dims(mask, -1)  # [batch, seq, 1]
        embeddings = (token_embs * mask_expanded).sum(axis=1) / mask_expanded.sum(axis=1)

    # L2 normalize
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    norms = np.maximum(norms, 1e-12)
    return embeddings / norms


def cosine_similarity(a, b):
    """Row-wise cosine similarity between two matrices."""
    return np.sum(a * b, axis=1)


def main():
    # Test samples — mix of languages and patterns
    test_texts = [
        "def calculate_sum(a, b):\n    return a + b",
        "class UserService:\n    def __init__(self, db):\n        self.db = db\n    def get_user(self, id):\n        return self.db.query(User).get(id)",
        "function fetchData(url) {\n  return fetch(url).then(r => r.json());\n}",
        "func (s *Server) HandleRequest(w http.ResponseWriter, r *http.Request) {\n    ctx := r.Context()\n    data, err := s.service.Process(ctx, r.Body)\n}",
        "public class ArrayList<E> extends AbstractList<E> implements List<E>, RandomAccess {\n    private Object[] elementData;\n    private int size;\n}",
        "impl Iterator for TokenStream {\n    type Item = Token;\n    fn next(&mut self) -> Option<Self::Item> {\n        self.tokens.pop_front()\n    }\n}",
        "SELECT u.name, COUNT(o.id) as order_count\nFROM users u\nLEFT JOIN orders o ON u.id = o.user_id\nGROUP BY u.id\nHAVING COUNT(o.id) > 5",
        "import numpy as np\ndef matrix_multiply(A, B):\n    return np.dot(A, B)",
        "const router = express.Router();\nrouter.get('/api/users/:id', authenticate, async (req, res) => {\n    const user = await User.findById(req.params.id);\n    res.json(user);\n});",
        "interface Repository<T> {\n    findById(id: string): Promise<T | null>;\n    findAll(filter?: Partial<T>): Promise<T[]>;\n    save(entity: T): Promise<T>;\n    delete(id: string): Promise<boolean>;\n}",
    ]

    print("=== QDQ Validation ===\n")

    inputs = tokenize(test_texts)

    print("Loading FP32 model...")
    fp32_session = create_session(FP32_MODEL)
    fp32_embeddings = get_embeddings(fp32_session, inputs)
    del fp32_session

    print("Loading QDQ model...")
    qdq_session = create_session(QDQ_MODEL)
    qdq_embeddings = get_embeddings(qdq_session, inputs)
    del qdq_session

    # Compare
    similarities = cosine_similarity(fp32_embeddings, qdq_embeddings)

    print(f"\n  Per-sample cosine similarity (FP32 vs QDQ):")
    print(f"  {'Sample':<8} {'Similarity':>12}")
    print(f"  {'-'*22}")
    for i, sim in enumerate(similarities):
        status = 'OK' if sim > 0.95 else 'BAD' if sim > 0.90 else 'BROKEN'
        print(f"  {i+1:<8} {sim:>11.6f}  {status}")

    mean_sim = np.mean(similarities)
    min_sim = np.min(similarities)

    print(f"\n  Mean similarity: {mean_sim:.6f}")
    print(f"  Min similarity:  {min_sim:.6f}")

    if min_sim >= 0.98:
        print(f"\n  PASS: Quantization is excellent. Safe to deploy.")
    elif min_sim >= 0.95:
        print(f"\n  PASS: Quantization is acceptable. Minor quality loss expected.")
    elif min_sim >= 0.90:
        print(f"\n  WARNING: Quantization has noticeable quality loss.")
        print(f"  Consider adjusting nodes_to_exclude or calibration data.")
    else:
        print(f"\n  FAIL: Quantization is broken. Do NOT deploy.")
        print(f"  Check: calibration data, nodes_to_exclude, calibration method.")

    # Speed comparison
    import time

    print(f"\n  Speed comparison (10 runs of {len(test_texts)} texts):")

    fp32_session = create_session(FP32_MODEL)
    qdq_session = create_session(QDQ_MODEL)

    # Warmup
    get_embeddings(fp32_session, inputs)
    get_embeddings(qdq_session, inputs)

    t0 = time.perf_counter()
    for _ in range(10):
        get_embeddings(fp32_session, inputs)
    fp32_time = time.perf_counter() - t0

    t0 = time.perf_counter()
    for _ in range(10):
        get_embeddings(qdq_session, inputs)
    qdq_time = time.perf_counter() - t0

    print(f"  FP32: {fp32_time:.2f}s")
    print(f"  QDQ:  {qdq_time:.2f}s")
    print(f"  Speedup: {fp32_time/qdq_time:.2f}x")


if __name__ == '__main__':
    main()
```

## Step 5: Deploy the validated model

Once validation passes (cosine similarity >= 0.95):

### Option A: Upload to HuggingFace (recommended for distribution)

```powershell
pip install huggingface_hub

python -c "
from huggingface_hub import HfApi
api = HfApi()
api.create_repo('your-username/CodeRankEmbed-qdq-int8', repo_type='model')
api.upload_file(
    path_or_fileobj=r'C:\qdq-work\model_qdq_int8.onnx',
    path_in_repo='onnx/model.onnx',
    repo_id='your-username/CodeRankEmbed-qdq-int8',
)
# Also upload tokenizer, config, etc. from the original repo
"
```

Then update `core/config.js`:
```js
local: {
    model: 'your-username/CodeRankEmbed-qdq-int8',
    // ... rest unchanged
}
```

### Option B: Local file override (for testing)

Copy the QDQ model over the cached FP32 model:

```powershell
copy C:\qdq-work\model_qdq_int8.onnx ^
  node_modules\@huggingface\transformers\.cache\jalipalo\CodeRankEmbed-onnx\onnx\model.onnx
```

Delete the ORT optimized cache so it regenerates:

```powershell
del %USERPROFILE%\.cache\sweet-search\coderankembed-optimized-*.onnx
```

Then run the cosqa benchmark to verify end-to-end:

```bash
node eval/run_benchmark.js --dataset cosqa --provider local
```

## What went wrong in our first attempt

For reference, our WSL2 attempt failed because:

1. **All ops were quantized** — LayerNorm and Softmax got INT8, destroying embedding quality
2. **50 synthetic Python snippets** — not representative of real activation ranges
3. **MinMax calibration** — sensitive to outliers with small sample sizes
4. **WSL2 memory limits** — Python OOM'd during Percentile calibration

The script above fixes all of these: selective op exclusion, mixed-language real code, Percentile calibration, and batch_size=1 for low memory usage.

## Expected results

| Metric | FP32 (current) | Good QDQ INT8 |
|--------|----------------|---------------|
| Model size | ~522MB | ~130-140MB |
| ORT cache | ~547MB (FP32) | ~130-140MB (INT8 preserved) |
| Inference speed | baseline | ~1.5-2x faster |
| MRR@10 regression | — | < 2% |
| Cosine similarity | — | > 0.98 |
