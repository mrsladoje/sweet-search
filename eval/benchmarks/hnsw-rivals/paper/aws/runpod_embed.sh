#!/bin/bash
# runpod_embed.sh [--dry] --host HOST --port PORT [--sets s1,s2] [--user root] [--data DIR] [--out DIR] [--bundle FILE]
#                 [--remote-dir DIR] [--keep-key]
#
# The GPU embedding step of S3a / S4, on a RunPod pod the owner rents (no RunPod API call is made from here; the
# only network peer is the pod over SSH). It
#   1. makes a throwaway SSH key pair and prints the PUBLIC key: the owner pastes it into the pod (RunPod "SSH
#      public key" setting, or ~/.ssh/authorized_keys in the pod's web terminal). Your own key and the SSH agent
#      are never used or copied (ssh runs with -F /dev/null, IdentitiesOnly, no agent, a throwaway known_hosts);
#   2. copies embed.py, MODELS.json, the embed lock file and requirements, check_embed.py, the code bundle (for the
#      record; its SHA-256 is checked in the pod) and the sets' texts (sets/<set>/) to the pod;
#   3. builds the embed environment from the hashed lock file, runs `embed.py --check` (the run stops if it
#      fails), then `embed_all.sh <DATA> cuda`: ALL 7 sets x 3 models (resumable: run the script again after a
#      break; embed.py continues at the last finished block);
#   4. copies emb/<model>/<set>/{corpus.f32,queries.f32,model.json} back into OUT (never into DATA) and checks
#      each file's SHA-256 against the hash computed in the pod and against model.json.
# --sets limits the sets whose texts are copied to the pod (default: every set in DATA/sets); embed_all.sh embeds
# every set it finds there.
# --dry prints every ssh / rsync command and runs none. At the end the owner ends the pod (it is billed per hour).
set -euo pipefail
H=$(cd "$(dirname "$0")" && pwd); PAPER=$(cd "$H/.." && pwd)
DRY=0; HOST=; PORT=; USERN=root; SETS=; DATA=${DATA:-$HOME/.ss-eval/hnsw-paper}; KEEP=0
OUT=$HOME/.ss-eval/hnsw-cloud/gpu-out/$(date +%Y%m%d%H%M); BUNDLE=; RDIR=/workspace/hnsw-embed
while [ $# -gt 0 ]; do
  case "$1" in
    --dry) DRY=1;; --host) HOST=$2; shift;; --port) PORT=$2; shift;; --user) USERN=$2; shift;;
    --sets) SETS=$2; shift;; --data) DATA=$2; shift;; --out) OUT=$2; shift;;
    --bundle) BUNDLE=$2; shift;; --remote-dir) RDIR=$2; shift;; --keep-key) KEEP=1;;
    *) sed -n '2,24p' "$0"; exit 2;;
  esac; shift
done
[ -n "$HOST" ] && [ -n "$PORT" ] || { sed -n '2,4p' "$0"; exit 2; }
[ -n "$SETS" ] || SETS=$(ls "$DATA/sets" | tr '\n' ',' | sed 's/,$//')
[[ $PORT =~ ^[0-9]+$ ]] || { echo "port must be a number"; exit 2; }
[ -z "$BUNDLE" ] && BUNDLE=$(ls -t "$HOME"/.ss-eval/hnsw-cloud/upload/code/ss-HEAD-*.tar.zst 2>/dev/null | head -1 || true)
LOCK=requirements-embed-linux-x86_64-cu128.lock
KD=$HOME/.ss-eval/hnsw-cloud/runpod-key; KEY=$KD/id_ed25519; KH=$KD/known_hosts

run() { if [ $DRY = 1 ]; then printf '  %q' "$@"; echo; else "$@"; fi; }
SSHO=(-F /dev/null -i "$KEY" -o IdentitiesOnly=yes -o IdentityAgent=none -o ForwardAgent=no -o UserKnownHostsFile="$KH"
      -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -o BatchMode=yes -p "$PORT")
R() { run ssh "${SSHO[@]}" "$USERN@$HOST" "$@"; }
SYNC() { run rsync -a --partial -e "ssh ${SSHO[*]}" "$@"; }

for S in $(echo "$SETS" | tr ',' ' '); do
  for f in texts.jsonl queries.jsonl set.json; do [ -f "$DATA/sets/$S/$f" ] || { echo "missing $DATA/sets/$S/$f"; exit 1; }; done
done
for f in embed.py embed_all.sh MODELS.json requirements-embed.in requirements-embed-cu128.in $LOCK check_embed.py; do [ -f "$PAPER/$f" ] || { echo "missing $PAPER/$f"; exit 1; }; done

if [ $DRY = 1 ]; then echo "DRY RUN: no key is made, nothing is run. Commands:"; else
  mkdir -p "$KD"; chmod 700 "$KD"
  [ -f "$KEY" ] || ssh-keygen -q -t ed25519 -N '' -C hnsw-throwaway -f "$KEY"
  echo "Add this PUBLIC key to the pod (throwaway; it is deleted at the end unless --keep-key):"; cat "$KEY.pub"
  read -r -p "Press Enter when the pod accepts it... " _
fi

# ---- the remote runner: written locally, copied, started with nohup, polled
RUNNER=$(mktemp); cat > "$RUNNER" <<RUNEOF
#!/bin/bash
set -uo pipefail
cd $RDIR
echo running > status
{
  command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh
  [ -x venv/bin/python ] || uv venv --python 3.12 venv
  VIRTUAL_ENV=\$PWD/venv uv pip install --require-hashes -r $LOCK --index-url https://download.pytorch.org/whl/cu128 --extra-index-url https://pypi.org/simple --index-strategy unsafe-best-match
  nvidia-smi -L || { echo "no GPU in this pod"; exit 1; }
  [ -z "$BUNDLE" ] || [ ! -f bundle.sha256 ] || (cd . && sha256sum -c bundle.sha256)
  venv/bin/python -I embed.py --check || { echo "embed.py --check failed"; exit 1; }
  echo "== embed_all \$(date -u +%T)"
  PATH=\$PWD/venv/bin:\$PATH PY=\$PWD/venv/bin/python bash embed_all.sh \$PWD/data cuda || exit 1
  (cd data && find emb -type f \( -name corpus.f32 -o -name queries.f32 -o -name model.json \) | sort | xargs sha256sum) > SHA256SUMS-pod
} >> embed.log 2>&1
if [ \$? = 0 ]; then echo done > status; else echo failed > status; fi
RUNEOF
chmod +x "$RUNNER"

# ---- 1. files to the pod
R mkdir -p "$RDIR/data/sets"
SYNC "$PAPER/embed.py" "$PAPER/embed_all.sh" "$PAPER/MODELS.json" "$PAPER/requirements-embed.in" "$PAPER/requirements-embed-cu128.in" "$PAPER/$LOCK" "$PAPER/check_embed.py" "$USERN@$HOST:$RDIR/"
for S in $(echo "$SETS" | tr ',' ' '); do SYNC "$DATA/sets/$S" "$USERN@$HOST:$RDIR/data/sets/"; done
SYNC "$RUNNER" "$USERN@$HOST:$RDIR/embed-all.sh"
if [ -n "$BUNDLE" ]; then
  SYNC "$BUNDLE" "$USERN@$HOST:$RDIR/bundle.tar.zst"
  R "cd $RDIR && echo \"$(shasum -a 256 "$BUNDLE" 2>/dev/null | cut -d' ' -f1)  bundle.tar.zst\" > bundle.sha256"
fi

# ---- 2. run in the pod (nohup), poll
R "cd $RDIR && (pgrep -f embed-all.sh >/dev/null || nohup bash embed-all.sh > /dev/null 2>&1 &) ; sleep 1; cat status"
if [ $DRY = 1 ]; then
  echo "  (then every 60 s: ssh ... 'cat $RDIR/status; tail -n 2 $RDIR/embed.log' until the status is done or failed)"
else
  while :; do
    ST=$(ssh "${SSHO[@]}" "$USERN@$HOST" "cat $RDIR/status 2>/dev/null; tail -n 1 $RDIR/embed.log 2>/dev/null" || echo "ssh failed; retrying")
    echo "$(date +%T) $(echo "$ST" | tr '\n' ' ')"
    case "$ST" in done*) break;; failed*) echo "FAILED in the pod: see $RDIR/embed.log"; exit 1;; esac
    sleep 60
  done
fi

# ---- 3. results back (into OUT, not DATA) and SHA-256 checks
mkdir -p "$OUT/emb"
SYNC --include='*/' --include=corpus.f32 --include=queries.f32 --include=model.json --exclude='*' "$USERN@$HOST:$RDIR/data/emb/" "$OUT/emb/"
SYNC "$USERN@$HOST:$RDIR/SHA256SUMS-pod" "$OUT/SHA256SUMS-pod"
SYNC "$USERN@$HOST:$RDIR/embed.log" "$OUT/embed.log"
if [ $DRY = 1 ]; then echo "  (then: (cd $OUT && shasum -a 256 -c SHA256SUMS-pod); corpus_sha256 / queries_sha256 of each model.json are compared too)"; rm -f "$RUNNER"; exit 0; fi
( cd "$OUT" && shasum -a 256 -c SHA256SUMS-pod )
python3 -I - "$OUT" <<'PYEOF'
import hashlib, json, os, sys
bad = 0
for d, _, fs in os.walk(sys.argv[1]):
    if 'model.json' in fs:
        m = json.load(open(os.path.join(d, 'model.json')))
        for f, k in (('corpus.f32', 'corpus_sha256'), ('queries.f32', 'queries_sha256')):
            h = hashlib.sha256(open(os.path.join(d, f), 'rb').read()).hexdigest()
            if m.get(k) != h:
                print('DIFFERS', d, f, 'model.json has', m.get(k)); bad = 1
            else:
                print('ok', os.path.relpath(d, sys.argv[1]), f)
sys.exit(bad)
PYEOF
rm -f "$RUNNER"
[ $KEEP = 1 ] || { rm -rf "$KD"; echo "throwaway key deleted"; }
echo "Results are in $OUT. Move them into DATA yourself after checking. END THE POD NOW (it is billed per hour)."
