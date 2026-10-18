#!/bin/bash
# bootstrap.sh  (EC2 user data runs it as root; safe to run twice)
#
# Environment from the user data (launch.sh): MACHINE, MODE (run.sh mode chain), BUCKET,
# BUNDLE (code bundle name in s3://$BUCKET/code/), LEGACY_BUNDLE, DATA (comma list of data
# archives in s3://$BUCKET/data/), BEIR_DATA (optional).
#
# Steps: safety stop (72 h); build tools, zstd, awscli, Rust 1.97.1, Node 24, uv; code
# bundle -> /opt/ss; data -> /opt/replay; Python env from the platform lock file; capi,
# rivals-rs and the native addon (default features); the legacy addon from the f1ee878b
# bundle -> LEGACY_ADDON; sweeps rebuilt with make_sweep.py (seed 42) and checked against
# the Mac's SHA-256 manifests; machine.txt; the idle watchdog; then run.sh under nohup.
set -euo pipefail
exec >> /var/log/maxsim-bootstrap.log 2>&1
echo "== bootstrap $(date -u +%FT%TZ) machine=$MACHINE mode=$MODE"
shutdown -h +4320 || true          # 72-hour safety stop (the instance ends; with SHUTDOWN=stop it stops)
export DEBIAN_FRONTEND=noninteractive HOME=/root
ARCH=$(uname -m)                   # x86_64 | aarch64
SS=/opt/ss; MB=$SS/eval/maxsim-bench; RP=/opt/replay
NODE_VERSION=24.18.0; RUST_VERSION=1.97.1

# ---- tools
if [ ! -f /opt/.tools-done ]; then
  apt-get update -q
  apt-get install -y -q build-essential pkg-config libssl-dev zstd unzip curl git jq python3 python3-venv util-linux cron python3-dev
  [ "$ARCH" = x86_64 ] && apt-get install -y -q libopenblas-dev
  if ! command -v aws >/dev/null; then
    curl -sSfo /tmp/awscli.zip "https://awscli.amazonaws.com/awscli-exe-linux-$ARCH.zip"; unzip -q -o /tmp/awscli.zip -d /tmp; /tmp/aws/install --update
  fi
  curl -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain "$RUST_VERSION" --profile minimal
  NA=$([ "$ARCH" = x86_64 ] && echo x64 || echo arm64)
  curl -sSfo /tmp/node.tar.xz "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-$NA.tar.xz"
  tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1
  curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh
  touch /opt/.tools-done
fi
. /root/.cargo/env

# ---- code and data
mkdir -p $SS $RP
if [ ! -f $SS/.bundle-done ]; then
  aws s3 cp --only-show-errors "s3://$BUCKET/code/$BUNDLE" /tmp/bundle.tar.zst
  tar --zstd -xf /tmp/bundle.tar.zst -C $SS
  touch $SS/.bundle-done
fi
printf 'BUCKET=%s\n' "$BUCKET" > $MB/aws/env.local    # the instance role gives the credentials
for D in $(echo "$DATA" | tr ',' ' '); do
  [ -f "$RP/.$D-done" ] && continue
  aws s3 cp --only-show-errors "s3://$BUCKET/data/$D" - | zstd -dc --long=27 | tar -xf - -C $RP
  touch "$RP/.$D-done"
done
if [ -n "${BEIR_DATA:-}" ] && [ ! -f $RP/.beir-done ]; then
  mkdir -p $RP/beir; aws s3 sync --only-show-errors "s3://$BUCKET/data/beir/sets/" $RP/beir/; touch $RP/.beir-done
fi

# ---- Python env, from the lock file only
cd $MB
if [ ! -x venv/bin/python ]; then
  uv venv --python 3.12 venv
  LOCK=requirements-linux-$ARCH.lock
  VIRTUAL_ENV=$MB/venv uv pip install --require-hashes -r "$LOCK" --extra-index-url https://download.pytorch.org/whl/cpu --index-strategy unsafe-best-match
fi
# MKL NumPy on Intel (W5): try once, 30-minute limit; a failure only leaves the arm out.
if [ "${MACHINE%%-*}" = intel ] && [ ! -e venv-mkl/.tried ]; then
  ( uv venv --python 3.12 venv-mkl && timeout 1800 env VIRTUAL_ENV=$MB/venv-mkl uv pip install numpy threadpoolctl \
      --index-url https://software.repos.intel.com/python/pypi --extra-index-url https://pypi.org/simple \
    && venv-mkl/bin/python -c "import numpy, threadpoolctl; print([t['internal_api'] for t in threadpoolctl.threadpool_info()])" ) \
    || { echo "venv-mkl failed; the MKL arm is left out"; rm -rf venv-mkl; mkdir -p venv-mkl; }
  touch venv-mkl/.tried
fi
# BLIS NumPy on AMD (W5, "AOCL-BLIS if it installs within 30 minutes"): AMD's AOCL package
# needs a licence click-through, so this is conda-forge NumPy on upstream BLIS (which has
# the Zen kernels); the tables name it "NumPy (BLIS)". 30-minute limit; a failure only
# leaves the arm out.
if [ "${MACHINE%%-*}" = amd ] && [ ! -e venv-blis/.tried ]; then
  ( curl -Ls https://micro.mamba.pm/api/micromamba/linux-64/latest | tar -xj -C /usr/local bin/micromamba \
    && timeout 1800 /usr/local/bin/micromamba create -y -q -p $MB/venv-blis -c conda-forge python=3.12 numpy threadpoolctl "libblas=*=*blis" \
    && venv-blis/bin/python -c "import numpy, threadpoolctl; print(numpy.__version__, [t.get('internal_api') for t in threadpoolctl.threadpool_info()])" ) \
    || { echo "venv-blis failed; the BLIS arm is left out"; rm -rf venv-blis; mkdir -p venv-blis; }
  touch venv-blis/.tried
fi

# ---- builds
(cd capi && cargo build --release -q)
RF=$([ "$ARCH" = x86_64 ] && echo "--features openblas" || echo "")
(cd rivals-rs && cargo build --release -q $RF)
if [ ! -f $SS/.addon-done ]; then
  (cd $SS && npm ci --ignore-scripts --no-audit --no-fund && cd crates/sweet-search-native && npx napi build --platform --release)
  touch $SS/.addon-done
fi
if [ -n "${LEGACY_BUNDLE:-}" ] && [ ! -f /opt/legacy/.done ]; then
  mkdir -p /opt/legacy; aws s3 cp --only-show-errors "s3://$BUCKET/code/$LEGACY_BUNDLE" - | tar --zstd -xf - -C /opt/legacy
  (cd /opt/legacy && npm ci --ignore-scripts --no-audit --no-fund && cd crates/sweet-search-native && npx napi build --platform --release)
  touch /opt/legacy/.done
fi
# The f1ee878b tree also holds committed macOS .node files: take the Linux build.
LEGACY_ADDON=$(ls /opt/legacy/crates/sweet-search-native/*linux*.node 2>/dev/null | head -1 || true)

# ---- sweeps: rebuilt here (seed 42), checked against the Mac's manifests
for S in sweep-dev sweep-ho; do
  case "$S" in sweep-dev) SRC="$RP/agent-dev $RP/gcsn-dev"; SMALL=--small;; sweep-ho) SRC="$RP/agent-ho $RP/gcsn-ho"; SMALL=;; esac
  if [ -d "$RP/agent-${S#sweep-}" ] && [ ! -f "$RP/.$S-done" ]; then
    venv/bin/python -I make_sweep.py "$RP/$S" $SRC $SMALL
    aws s3 cp --only-show-errors "s3://$BUCKET/data/$S-sidecars.tar.zst" - | tar --zstd -xf - -C "$RP/$S"   # provenance.jsonl + MANIFEST.sha256 per cell
    venv/bin/python -I set_manifest.py --check "$RP/$S"/* || { echo "SWEEP $S DIFFERS FROM THE MAC MANIFEST"; exit 1; }
    touch "$RP/.$S-done"
  fi
done

# ---- machine record
{
  echo "machine=$MACHINE mode=$MODE date=$(date -u +%FT%TZ)"
  for k in instance-id instance-type placement/availability-zone placement/availability-zone-id placement/host-id; do
    TOK=$(curl -s -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')
    echo "$k=$(curl -s -H "X-aws-ec2-metadata-token: $TOK" "http://169.254.169.254/latest/meta-data/$k" || echo unavailable)"
  done
  uname -a; echo "nproc=$(nproc)"; lscpu
  echo "governor=$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null || echo none)"
  echo "rust=$(rustc --version) node=$(node --version) python=$(venv/bin/python --version)"
  venv/bin/python -I -c "import threadpoolctl, numpy; print(threadpoolctl.threadpool_info())"
  echo "LEGACY_ADDON=$LEGACY_ADDON"
} > $SS/machine.txt
IID=$(grep '^instance-id=' $SS/machine.txt | cut -d= -f2)

# ---- idle watchdog (every 5 minutes; 60 idle minutes -> upload run.log, shut down)
install -m 755 $MB/aws/watchdog.sh /usr/local/bin/maxsim-watchdog
echo "*/5 * * * * root MACHINE=$MACHINE BUCKET=$BUCKET IDLE_MIN=${IDLE_MIN:-60} /usr/local/bin/maxsim-watchdog" > /etc/cron.d/maxsim-watchdog
systemctl enable --now cron

# ---- run
cd $MB
nohup env MACHINE="$MACHINE" REPLAY=$RP BEIR=$RP/beir RESULTS=$MB/results SS_INSTANCE_ID="$IID" LEGACY_ADDON="$LEGACY_ADDON" \
  MAX_BUSY=${MAX_BUSY:-10} bash aws/run.sh "$MODE" > $MB/run.out 2>&1 &
echo "== run.sh started (pid $!)"
