#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/optimize-onnx-model.sh --input /path/to/model_quantized.onnx [--out-dir /path]

What it does:
  1) Prints model I/O and attention node hints (architecture sanity check)
  2) Runs ONNX Runtime transformer optimizer (O1)
  3) Materializes ORT-optimized graph file (O2)

Outputs (in --out-dir, default: directory of --input):
  - model_optimized.onnx
  - model.ort
EOF
}

INPUT=""
OUT_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --input)
      INPUT="${2:-}"
      shift 2
      ;;
    --out-dir)
      OUT_DIR="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$INPUT" ]]; then
  echo "Missing required --input argument." >&2
  usage
  exit 1
fi

if [[ ! -f "$INPUT" ]]; then
  echo "Input model not found: $INPUT" >&2
  exit 1
fi

if [[ -z "$OUT_DIR" ]]; then
  OUT_DIR="$(dirname "$INPUT")"
fi
mkdir -p "$OUT_DIR"

OPT_ONNX="$OUT_DIR/model_optimized.onnx"
ORT_FILE="$OUT_DIR/model.ort"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required." >&2
  exit 1
fi

echo "==> Verifying Python dependencies (onnx, onnxruntime)"
python3 - <<'PY'
import importlib
for mod in ("onnx", "onnxruntime"):
    try:
        importlib.import_module(mod)
    except Exception as e:
        raise SystemExit(f"Missing Python module '{mod}': {e}")
print("Python deps OK")
PY

echo "==> Inspecting model architecture"
python3 - "$INPUT" <<'PY'
import onnx
import sys

path = sys.argv[1]
model = onnx.load(path)
print(f"Model: {path}")
print("Inputs:", [i.name for i in model.graph.input])
print("Outputs:", [o.name for o in model.graph.output])

interesting = {"Attention", "MultiHeadAttention", "MatMul", "Softmax"}
hits = [n for n in model.graph.node if n.op_type in interesting]
print(f"Attention-related nodes: {len(hits)}")
for n in hits[:30]:
    print(f"  - {n.op_type}: {n.name}")
if len(hits) > 30:
    print(f"  ... {len(hits) - 30} more")
PY

echo "==> Running ONNX Runtime transformer optimizer (bert preset)"
python3 -m onnxruntime.transformers.optimizer \
  --input "$INPUT" \
  --output "$OPT_ONNX" \
  --model_type bert \
  --hidden_size 768 \
  --num_heads 12 \
  --opt_level 99

echo "==> Materializing ORT optimized graph"
python3 - "$OPT_ONNX" "$ORT_FILE" <<'PY'
import onnxruntime as ort
import sys

in_path, out_path = sys.argv[1], sys.argv[2]
so = ort.SessionOptions()
so.optimized_model_filepath = out_path
so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
ort.InferenceSession(in_path, so, providers=["CPUExecutionProvider"])
print(f"Wrote ORT graph: {out_path}")
PY

echo "==> Done"
echo "Optimized ONNX: $OPT_ONNX"
echo "ORT graph:      $ORT_FILE"
