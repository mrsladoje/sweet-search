"""
Direct Python client for coreml_embedding_server.py — bypasses the Node bridge
entirely so we can isolate whether the IPC bug is in Python or in Node.
"""
import json
import struct
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
PY = HERE / ".venv" / "bin" / "python"
SERVER = HERE / "coreml_embedding_server.py"


def write_msg(stdin, msg):
    body = json.dumps(msg).encode("utf-8")
    stdin.write(struct.pack(">I", len(body)))
    stdin.write(body)
    stdin.flush()


def read_msg(stdout):
    header = stdout.read(4)
    if len(header) < 4:
        return None
    (length,) = struct.unpack(">I", header)
    body = stdout.read(length)
    return json.loads(body.decode("utf-8"))


def main():
    print(f"spawning {PY} {SERVER}")
    p = subprocess.Popen(
        [str(PY), str(SERVER)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=sys.stderr,
        bufsize=0,
    )

    print("waiting for ready event …")
    ready = read_msg(p.stdout)
    print(f"  got: {ready}")

    print("\nsending ping …")
    write_msg(p.stdin, {"op": "ping", "id": 1})
    pong = read_msg(p.stdout)
    print(f"  got: {pong}")

    print("\nsending small embed_batch (1 row × 32 cols) …")
    ids = [[101, 2023, 2003, 1037, 3231, 102] + [0] * 26]
    mask = [[1, 1, 1, 1, 1, 1] + [0] * 26]
    t0 = time.perf_counter()
    write_msg(p.stdin, {"op": "embed_batch", "id": 2, "input_ids": ids, "attention_mask": mask})
    reply = read_msg(p.stdout)
    elapsed = (time.perf_counter() - t0) * 1000
    if reply is None:
        print(f"  FAILED — no reply (elapsed {elapsed:.0f}ms)")
        sys.exit(1)
    if "error" in reply:
        print(f"  ERROR: {reply['error']}")
        sys.exit(1)
    emb = reply["embeddings"]
    print(f"  reply in {elapsed:.0f}ms: {len(emb)} embeddings of dim {len(emb[0])}")
    print(f"  first 8 dims: {[round(x, 5) for x in emb[0][:8]]}")

    print("\nshutting down …")
    write_msg(p.stdin, {"op": "shutdown", "id": 3})
    bye = read_msg(p.stdout)
    print(f"  got: {bye}")
    p.wait(timeout=5)
    print(f"  server exited with code {p.returncode}")


if __name__ == "__main__":
    main()
