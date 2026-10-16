#!/bin/bash
# bootstrap.sh  (EC2 user data runs it as root; safe to run twice)
#
# Environment from the user data (launch.sh): MACHINE, MODE (run.sh mode chain), BUCKET,
# BUNDLE (code bundle in s3://$BUCKET/hnsw/code/), DATA (comma list of archives in
# s3://$BUCKET/hnsw/data/), IDLE_MIN.
#
# Builds are not made here by a timing machine: run.sh downloads the shared store (s3://$BUCKET/hnsw/builds/shared/).
# Layout:  /opt/ss                  code bundle (repo root)
#          /opt/hnsw-data           DATA   (sets/, emb/, builds/)
#          /opt/hnsw-root           ROOT   (src/, build/, build-new/, dl/, python313/, venv-scann/, venv-quality/)
#          /opt/hnsw-results        RESULTS
# Steps: safety stop; build tools; code and data; npm ci + the native addon; the rival libraries and
# harness binaries (build-paper.sh, adapters/build-new.sh, build-rivals5.sh: they verify the pins);
# the quality and ScaNN Python environments from lock files; machine.txt; the idle watchdog; run.sh.
# A step marked critical stops the script (the log goes to S3, the watchdog ends the machine); an
# optional step records "FAILED" in $ROOT/stages.txt and the script goes on.
set -uo pipefail
exec >> /var/log/hnsw-bootstrap.log 2>&1
echo "== bootstrap $(date -u +%FT%TZ) machine=$MACHINE mode=$MODE"
[ -e /run/systemd/shutdown/scheduled ] || shutdown -h +4320 || true     # 72-hour safety stop
export DEBIAN_FRONTEND=noninteractive HOME=/root
export AWS_REGION=us-east-1 AWS_DEFAULT_REGION=us-east-1
ARCH=$(uname -m)                                      # x86_64 | aarch64
SS=/opt/ss; H=$SS/eval/benchmarks/hnsw-rivals/paper; AWSD=$H/aws
DATAD=/opt/hnsw-data; ROOT=/opt/hnsw-root; RES=/opt/hnsw-results
NODE_VERSION=24.18.0; RUST_VERSION=1.97.1
mkdir -p "$SS" "$DATAD" "$ROOT" "$RES/$MACHINE"
STAGES=$ROOT/stages.txt

stage() {  # stage <critical|optional> <name> <command...>
  local kind=$1 name=$2; shift 2
  if grep -q "^ok $name\$" "$STAGES" 2>/dev/null; then echo "-- $name: done in an earlier start"; return 0; fi
  echo "-- $name ($(date -u +%T))"
  if ( set -e; "$@" ); then echo "ok $name" >> "$STAGES"; return 0; fi
  echo "FAILED $name" >> "$STAGES"; echo "!! $name FAILED"
  if [ "$kind" = critical ]; then
    aws s3 cp --only-show-errors /var/log/hnsw-bootstrap.log "s3://$BUCKET/hnsw/results/$MACHINE/bootstrap.log" || true
    install_watchdog
    echo "== bootstrap stopped at critical step $name; the watchdog shuts the machine down after $IDLE_MIN idle minutes"
    exit 1
  fi
  return 0
}

install_watchdog() {
  [ -f "$AWSD/watchdog.sh" ] || return 0
  install -m 755 "$AWSD/watchdog.sh" /usr/local/bin/hnsw-watchdog
  echo "*/5 * * * * root MACHINE=$MACHINE BUCKET=$BUCKET RESULTS=$RES IDLE_MIN=${IDLE_MIN:-60} /usr/local/bin/hnsw-watchdog" > /etc/cron.d/hnsw-watchdog
  systemctl enable --now cron || true
}
IDLE_MIN=${IDLE_MIN:-60}

# ---- tools
tools() {
  apt-get update -q
  apt-get install -y -q build-essential cmake ninja-build pkg-config libssl-dev zstd unzip curl git jq python3 python3-venv python3-dev \
      util-linux cron libopenblas-dev zlib1g-dev liblzma-dev libffi-dev libbz2-dev libreadline-dev libsqlite3-dev libncurses-dev
  # perf (dTLB counters, PAPER_PLAN 5.12): optional, the kernel package may not exist for this kernel
  apt-get install -y -q linux-tools-common "linux-tools-$(uname -r)" || apt-get install -y -q linux-tools-aws || echo "perf not installed"
  if ! command -v aws >/dev/null; then
    curl -sSfo /tmp/awscli.zip "https://awscli.amazonaws.com/awscli-exe-linux-$ARCH.zip"; unzip -q -o /tmp/awscli.zip -d /tmp; /tmp/aws/install --update
  fi
  curl -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain "$RUST_VERSION" --profile minimal
  NA=$([ "$ARCH" = x86_64 ] && echo x64 || echo arm64)
  curl -sSfo /tmp/node.tar.xz "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-$NA.tar.xz"
  tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1
  curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh
}
stage critical tools tools
[ -f /root/.cargo/env ] && . /root/.cargo/env

# DiskANN (MKL, Boost, libaio, libomp, gperftools) exists on Intel / AMD x86 only
x86_packages() {
  apt-get install -y -q libmkl-dev libmkl-intel-ilp64 libmkl-intel-thread libmkl-core libmkl-def libboost-program-options-dev \
      libaio-dev libgoogle-perftools-dev libomp-dev
}
[ "$ARCH" = x86_64 ] && stage optional x86-packages x86_packages

# ---- code and data
code() {
  aws s3 cp --only-show-errors "s3://$BUCKET/hnsw/code/$BUNDLE" /tmp/bundle.tar.zst
  tar --zstd -xf /tmp/bundle.tar.zst -C "$SS"
  [ -d "$H" ] || { echo "the bundle has no $H"; exit 1; }
}
stage critical code code
chmod +x "$H"/gh.sh "$H"/*.sh "$H"/adapters/*.sh "$AWSD"/*.sh 2>/dev/null || true
# GitHub fetches: build-paper.sh and adapters/build-new.sh call "$H/gh.sh" (plain git / curl on EC2; on a host that
# blocks GitHub it pins the hosts for that one command). Nothing here edits /etc/hosts.
sha256sum /tmp/bundle.tar.zst 2>/dev/null | cut -d' ' -f1 > "$ROOT/code-bundle.sha256" || true
printf 'BUCKET=%s\n' "$BUCKET" > "$AWSD/env.local"       # the instance role gives the credentials
data() {
  for D in $(echo "$DATA" | tr ',' ' '); do
    [ -f "$DATAD/.$D-done" ] && continue
    aws s3 cp --only-show-errors "s3://$BUCKET/hnsw/data/$D" - | zstd -dc --long=27 | tar -xf - -C "$DATAD"
    touch "$DATAD/.$D-done"
  done
}
stage critical data data

# ---- node, native addon
addon() {
  cd "$SS"; . /root/.cargo/env
  npm ci --ignore-scripts --no-audit --no-fund
  cd crates/sweet-search-native && npx napi build --platform --release
}
stage critical addon addon

# ---- rival libraries and harness binaries (the scripts clone at their pins and verify them)
rivals() { cd "$H"; ROOT=$ROOT bash build-paper.sh -j "$(nproc)"; }
stage critical rivals-paper rivals
newlibs() {
  cd "$H"
  if [ "$ARCH" = x86_64 ]; then
    JOBS=$(nproc) bash adapters/build-new.sh "$ROOT"
  else  # arm64: DiskANN needs MKL and AVX2 code, SVS is x86-only; ScaNN has an aarch64 wheel
    mkdir -p "$ROOT/build-new"
    cat > "$ROOT/build-new/build-info-new.json" <<JSON
{ "machine": "linux-aarch64", "diskann_vamana": {"status": "awaiting platform: no arm64 port (MKL and AVX2 only)"},
  "svs": {"status": "unavailable: Linux x86_64 only, LVQ / LeanVec on Intel CPUs only"},
  "scann": {"status": "built from adapters/requirements-scann-linux-aarch64.lock, Python 3.12 (the cp313 aarch64 wheel of 1.4.2 needs _PyThreadState_UncheckedGet, removed in 3.13)"} }
JSON
    uv venv --python 3.12 "$ROOT/venv-scann"
    VIRTUAL_ENV=$ROOT/venv-scann uv pip install --require-hashes --no-deps -r adapters/requirements-scann-linux-aarch64.lock
  fi
}
stage optional rivals-new newlibs
stage critical rivals-harness bash -c "cd '$H' && bash build-rivals5.sh '$ROOT'"

# ---- Python: quality environment from its lock (Python 3.14, as the lock was compiled)
quality() {
  LOCK=$H/requirements-linux-$ARCH.lock
  [ -f "$LOCK" ] || { echo "no $LOCK (the quality scorer runs on the Mac; the arm64 lock is not made yet)"; exit 1; }
  uv venv --python 3.14 "$ROOT/venv-quality"
  VIRTUAL_ENV=$ROOT/venv-quality uv pip install --require-hashes -r "$LOCK"
}
stage optional quality-venv quality

# ---- families this machine can run (the plan builder reads it)
{ "$ROOT/build/rivals5" families; [ -x "$ROOT/build/rivals5-ext" ] && "$ROOT/build/rivals5-ext" families
  "$ROOT/venv-scann/bin/python" -I -c "import scann" 2>/dev/null && echo scann; echo ours_walk; echo ours_scan; } 2>/dev/null \
  | tr ' ' '\n' | grep -v '^$' | sort -u > "$RES/$MACHINE/families.txt"

# ---- machine record
{
  echo "machine=$MACHINE mode=$MODE date=$(date -u +%FT%TZ)"
  TOK=$(curl -s -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')
  for k in instance-id instance-type placement/availability-zone placement/availability-zone-id placement/host-id; do
    echo "$k=$(curl -sf -H "X-aws-ec2-metadata-token: $TOK" "http://169.254.169.254/latest/meta-data/$k" || echo unavailable)"
  done
  uname -a; echo "nproc=$(nproc)"; lscpu; lscpu -e
  echo "governor=$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null || echo none)"
  echo "thp=$(cat /sys/kernel/mm/transparent_hugepage/enabled 2>/dev/null || echo none)"
  echo "cpuinfo-flags: $(grep -m1 -E '^(flags|Features)' /proc/cpuinfo)"
  echo "rust=$(rustc --version) node=$(node --version) python3=$(python3 --version) uv=$(uv --version)"
  echo "code-bundle-sha256=$(cat "$ROOT/code-bundle.sha256" 2>/dev/null)"
  echo "--- stages"; cat "$STAGES"
  echo "--- families"; tr '\n' ' ' < "$RES/$MACHINE/families.txt"; echo
  echo "--- scann import"; "$ROOT/venv-scann/bin/python" -I -c "import scann; print('scann', scann.__file__)" 2>&1 | tail -3
  for b in rivals5 rivals5-ext librescore5.so; do [ -f "$ROOT/build/$b" ] && sha256sum "$ROOT/build/$b"; done
  [ -f "$ROOT/build/build-info.json" ] && echo "build-info.json present: $ROOT/build/build-info.json"
  [ -f "$ROOT/build-new/build-info-new.json" ] && echo "build-info-new.json present"
} > "$SS/machine.txt"
cp "$SS/machine.txt" "$RES/$MACHINE/machine.txt"
IID=$(grep '^instance-id=' "$SS/machine.txt" | cut -d= -f2)

install_watchdog

# ---- run
cd "$H"
nohup env MACHINE="$MACHINE" SHARD="${SHARD:-0/1}" QUEUE="${QUEUE:-}" LAZY_BUILDS="${LAZY_BUILDS:-0}" PLAN_ROOT="${PLAN_ROOT:-}" BUCKET="$BUCKET" DATA=$DATAD ROOT=$ROOT RESULTS=$RES SS_INSTANCE_ID="$IID" MAX_BUSY=${MAX_BUSY:-10} \
  bash aws/run.sh "$MODE" > "$RES/run.out" 2>&1 &
echo "== run.sh started (pid $!)"
