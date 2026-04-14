"""
Long-lived CoreML embedding server. Reads embed_batch requests from stdin,
returns embeddings on stdout. Loads the 3 fixed-shape .mlpackages once on
startup and routes each request to the smallest shape that fits.

IPC: length-prefixed JSON. Each message is a 4-byte big-endian length followed
by that many bytes of UTF-8 JSON. Same format for both directions.

Request:  {"op": "embed_batch", "id": <int>, "input_ids": [[...]], "attention_mask": [[...]]}
Response: {"id": <int>, "embeddings": [[...]]}
Error:    {"id": <int>, "error": "<msg>"}

Initial handshake on startup (server → stdout):
  {"event": "ready", "shapes": [[32, 512], [64, 256], [128, 128]], "dim": 768}
"""

import json
import os
import struct
import sys
import time
from pathlib import Path
from typing import List, Tuple

import numpy as np
import coremltools as ct

HERE = Path(__file__).resolve().parent
ARTIFACTS = HERE / "artifacts"

# (batch, seq) shapes available, ordered by total tokens ascending so
# pick_shape() returns the smallest that fits both dims.
SHAPES: List[Tuple[int, int]] = [
    (128, 128),
    (64, 256),
    (32, 512),
]


def log(msg: str):
    """Diagnostics go to stderr so they don't pollute the IPC channel."""
    print(f"[coreml-server] {msg}", file=sys.stderr, flush=True)


def _read_exact(n: int) -> bytes:
    """Read exactly n bytes from stdin or return shorter buffer on EOF."""
    buf = bytearray()
    while len(buf) < n:
        chunk = sys.stdin.buffer.read(n - len(buf))
        if not chunk:
            return bytes(buf)
        buf.extend(chunk)
    return bytes(buf)


def read_message() -> dict:
    """Read one length-prefixed JSON message from stdin. Returns None on EOF."""
    log(f"read_message: waiting for header")
    header = _read_exact(4)
    log(f"read_message: got header {len(header)} bytes")
    if len(header) < 4:
        return None
    (length,) = struct.unpack(">I", header)
    log(f"read_message: body length = {length}")
    body = _read_exact(length)
    log(f"read_message: got body {len(body)} bytes")
    if len(body) < length:
        return None
    return json.loads(body.decode("utf-8"))


def write_message(msg: dict):
    """Write one length-prefixed JSON message to stdout."""
    body = json.dumps(msg, separators=(",", ":")).encode("utf-8")
    sys.stdout.buffer.write(struct.pack(">I", len(body)))
    sys.stdout.buffer.write(body)
    sys.stdout.buffer.flush()


def pick_shape(batch: int, seq: int) -> Tuple[int, int]:
    """Smallest available (B, S) such that B ≥ batch AND S ≥ seq."""
    for sh in SHAPES:
        if sh[0] >= batch and sh[1] >= seq:
            return sh
    return None  # too large — caller must split or fall back


def load_models() -> dict:
    """Load all fixed-shape .mlpackages once."""
    models = {}
    for batch, seq in SHAPES:
        path = ARTIFACTS / f"nomic_bert_b{batch}_s{seq}_fp16.mlpackage"
        if not path.exists():
            log(f"WARN: missing {path.name}, skipping")
            continue
        t0 = time.perf_counter()
        # CRITICAL: hardcode CPU_AND_NE — ALL/CPU_AND_GPU break correctness on this model
        m = ct.models.MLModel(str(path), compute_units=ct.ComputeUnit.CPU_AND_NE)
        log(f"loaded {path.name} in {time.perf_counter() - t0:.2f}s")
        models[(batch, seq)] = m
    return models


def embed_batch(models: dict, input_ids: List[List[int]], attention_mask: List[List[int]]) -> List[List[float]]:
    actual_batch = len(input_ids)
    if actual_batch == 0:
        return []
    actual_seq = len(input_ids[0])

    shape = pick_shape(actual_batch, actual_seq)
    if shape is None:
        raise ValueError(f"no .mlpackage covers batch={actual_batch} seq={actual_seq} (max {SHAPES[-1]})")
    target_b, target_s = shape
    model = models.get(shape)
    if model is None:
        raise ValueError(f"no model loaded for shape {shape}")

    # Pad to fixed shape
    ids_arr = np.zeros((target_b, target_s), dtype=np.int32)
    mask_arr = np.zeros((target_b, target_s), dtype=np.int32)
    for i in range(actual_batch):
        n = min(len(input_ids[i]), target_s)
        ids_arr[i, :n] = input_ids[i][:n]
        mask_arr[i, :n] = attention_mask[i][:n]

    out = model.predict({"input_ids": ids_arr, "attention_mask": mask_arr})
    emb = out["embeddings"]  # numpy (target_b, 768)
    return emb[:actual_batch].astype(np.float32).tolist()


def main():
    log(f"starting (pid={os.getpid()})")
    log(f"coremltools {ct.__version__}")

    models = load_models()
    if not models:
        log("FATAL: no models loaded")
        sys.exit(1)

    # Determine output dim from first loaded model
    first = next(iter(models.values()))
    spec = first.get_spec()
    out_shape = list(spec.description.output[0].type.multiArrayType.shape)
    dim = int(out_shape[-1])
    log(f"ready (dim={dim}, shapes={[list(s) for s in models.keys()]})")

    write_message({
        "event": "ready",
        "shapes": [list(s) for s in models.keys()],
        "dim": dim,
    })

    n_calls = 0
    total_inference_ms = 0.0
    while True:
        msg = read_message()
        if msg is None:
            log(f"EOF on stdin, exiting after {n_calls} calls (total inference: {total_inference_ms:.0f}ms)")
            break

        msg_id = msg.get("id", -1)
        op = msg.get("op")
        try:
            if op == "embed_batch":
                t0 = time.perf_counter()
                embeddings = embed_batch(models, msg["input_ids"], msg["attention_mask"])
                total_inference_ms += (time.perf_counter() - t0) * 1000.0
                n_calls += 1
                write_message({"id": msg_id, "embeddings": embeddings})
            elif op == "ping":
                write_message({"id": msg_id, "pong": True})
            elif op == "shutdown":
                log(f"shutdown requested after {n_calls} calls (total inference: {total_inference_ms:.0f}ms)")
                write_message({"id": msg_id, "ok": True})
                break
            else:
                write_message({"id": msg_id, "error": f"unknown op: {op}"})
        except Exception as e:
            log(f"error on op={op}: {e}")
            write_message({"id": msg_id, "error": str(e)})


if __name__ == "__main__":
    main()
