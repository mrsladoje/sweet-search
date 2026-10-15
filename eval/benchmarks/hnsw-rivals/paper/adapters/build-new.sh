#!/usr/bin/env bash
# build-new.sh — builds the DiskANN, Intel SVS and ScaNN adapters and their test drivers (PAPER_PLAN S1).
#   box   (Linux x86_64): everything below, under $ROOT (default /root/hnsw-paper)
#   macOS (arm64)       : nothing builds; writes build-info-new.json with the status and the reason per library
# usage: build-new.sh [ROOT]      env: JOBS (default 2), BUILD_OUT (default $ROOT/build-new)
# Sources are pinned by hash. The box blocks github.com (bench net lockdown), so the sources are staged in $ROOT/dl:
#   diskann-<commit>.tar.gz  = git archive --prefix=DiskANN/ of microsoft/DiskANN @ DISKANN_COMMIT (branch cpp_main)
#   svs-cpp-runtime-bindings-0.4.0.tar.gz = release asset v0.4.0 of intel/ScalableVectorSearch
# If the file is missing the script tries to fetch it (git clone / curl) and fails when the network refuses.
# Python 3.13 (ScaNN has no 3.14 wheel and no macOS wheel) is built from python.org source into $ROOT/python313.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${1:-/root/hnsw-paper}"
JOBS="${JOBS:-2}"
OUT="${BUILD_OUT:-$ROOT/build-new}"

DISKANN_COMMIT=78256bbab4685e1774e78d331e081a153be26823   # cpp_main, 2026-05-05
DISKANN_TAR_SHA=fbefe6cf2a1530172cb44bf3a1f7842bcbe7d47ce8bba71c84cf47ea4d7320dc
SVS_VERSION=0.4.0                                          # tag v0.4.0 = 75e30f222cf06bcc0625ed021d783cae2d75cfc5
SVS_URL=https://github.com/intel/ScalableVectorSearch/releases/download/v0.4.0/svs-cpp-runtime-bindings.tar.gz
SVS_SHA=90833ee345afc0b448d56f8f2db743a9d8cf707cc4879b2b1df6d73c0a150a68
PY_VERSION=3.13.16
PY_URL=https://www.python.org/ftp/python/$PY_VERSION/Python-$PY_VERSION.tgz
PY_SHA=cfac63bddf956deafb1172ca131ae5dcaafd6f95056086e233fca205593ed427
SCANN_VERSION=1.4.2

sha() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
verify() { [ "$(sha "$1")" = "$2" ] || { echo "SHA-256 mismatch for $1" >&2; exit 1; }; }

OS="$(uname -s)"; ARCH="$(uname -m)"
mkdir -p "$OUT"

if [ "$OS" = Darwin ]; then
  load="$(sysctl -n vm.loadavg | tr -d '{}' | awk '{print $1}')"
  cat > "$OUT/build-info-new.json" <<EOF
{ "machine": "macos-$ARCH", "load1": $load,
  "diskann_vamana": {"status": "awaiting platform: Graviton (S3a)", "commit": "$DISKANN_COMMIT",
    "reason": "pinned cpp_main needs Intel MKL (CMake looks for libmkl_core, libiomp5; x86 only), compiles with -m64 -mavx2 -mfma -DUSE_AVX2 and AVX intrinsics in distance.cpp / simd_utils.h; no NEON path. A Linux arm64 build needs OpenBLAS for cblas and NEON distance kernels (source patch)"},
  "svs": {"status": "unavailable on macOS and awaiting platform: intel (S3a) for LVQ / LeanVec", "version": "$SVS_VERSION",
    "reason": "the binary package is Linux x86_64 only (libsvs_runtime.so); LVQ / LeanVec run on GenuineIntel CPUs only"},
  "scann": {"status": "awaiting platform: Mac has no wheel", "version": "$SCANN_VERSION",
    "reason": "scann $SCANN_VERSION publishes manylinux_2_27 x86_64 and aarch64 wheels for CPython 3.9-3.13; no macOS wheel, no sdist"} }
EOF
  echo "macOS: nothing to build; wrote $OUT/build-info-new.json"; exit 0
fi
[ "$OS" = Linux ] && [ "$ARCH" = x86_64 ] || { echo "unsupported platform $OS $ARCH (Linux arm64: see build-info-new.json from the Mac run)"; exit 2; }

DL="$ROOT/dl"; SRC="$ROOT/src"; mkdir -p "$DL" "$SRC" "$OUT/obj" "$OUT/paper/adapters"
# apt packages used on the box (Ubuntu 26.04): libmkl-dev libmkl-intel-ilp64 libmkl-intel-thread libmkl-core libmkl-def
#   libboost-program-options-dev libaio-dev libgoogle-perftools-dev libomp-dev libffi-dev libbz2-dev libreadline-dev libsqlite3-dev

# --- sources
if [ ! -f "$DL/diskann-$DISKANN_COMMIT.tar.gz" ]; then
  "$HERE/../gh.sh" clone -q https://github.com/microsoft/DiskANN "$SRC/DiskANN-git" && git -C "$SRC/DiskANN-git" checkout -q "$DISKANN_COMMIT" \
    && git -C "$SRC/DiskANN-git" archive --format=tar --prefix=DiskANN/ HEAD | gzip > "$DL/diskann-$DISKANN_COMMIT.tar.gz"
  echo "note: fresh archive; its SHA-256 may differ from DISKANN_TAR_SHA (gzip); compare the tree hash instead" >&2
else verify "$DL/diskann-$DISKANN_COMMIT.tar.gz" "$DISKANN_TAR_SHA"; fi
[ -d "$SRC/DiskANN" ] || tar xzf "$DL/diskann-$DISKANN_COMMIT.tar.gz" -C "$SRC"
SVS_TAR="$DL/svs-cpp-runtime-bindings-$SVS_VERSION.tar.gz"
[ -f "$SVS_TAR" ] || { [ -f "$DL/svs-cpp-runtime-bindings.tar.gz" ] && SVS_TAR="$DL/svs-cpp-runtime-bindings.tar.gz" || "$HERE/../gh.sh" curl -fsSL -o "$SVS_TAR" "$SVS_URL"; }
verify "$SVS_TAR" "$SVS_SHA"
[ -d "$SRC/svs-$SVS_VERSION" ] || { mkdir -p "$SRC/svs-$SVS_VERSION"; tar xzf "$SVS_TAR" -C "$SRC/svs-$SVS_VERSION"; }
SVS="$SRC/svs-$SVS_VERSION"

# --- DiskANN static library. g++ 15 needs `-include cstdint` (distance.h lacks the include); the source stays unpatched.
cmake -S "$SRC/DiskANN" -B "$OUT/diskann" -DCMAKE_BUILD_TYPE=Release -DMKL_PATH=/usr/lib/x86_64-linux-gnu \
  -DMKL_INCLUDE_PATH=/usr/include/mkl -DOMP_PATH=/usr/lib/x86_64-linux-gnu -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
  -DCMAKE_CXX_FLAGS="-include cstdint" > "$OUT/diskann-configure.log" 2>&1
cmake --build "$OUT/diskann" --target diskann_s -j"$JOBS" > "$OUT/diskann-build.log" 2>&1

# --- adapters + test driver (-O3 -march=native)
A="$HERE"; O="$OUT/obj"; CXXF="-O3 -march=native"
DQ="-DMKL_ILP64 -I$SRC/DiskANN/include -I/usr/include/mkl -mavx2 -mfma -DUSE_AVX2 -include cstdint -fopenmp"
g++ -std=c++17 $CXXF $DQ -DDISKANN_COMMIT="\"$DISKANN_COMMIT\"" -c "$A/diskann_adapter.cpp" -o "$O/diskann_adapter.o"
g++ -std=c++20 $CXXF -fopenmp -I"$SVS/include" -c "$A/svs_adapter.cpp" -o "$O/svs_adapter.o"
g++ -std=c++17 $CXXF -c "$A/adapter_test_new.cpp" -o "$O/adapter_test_new.o"
g++ -std=c++17 $CXXF -c "$A/registry_stub.cpp" -o "$O/registry_stub.o"
g++ -O3 -o "$OUT/adapter_test_new" "$O/adapter_test_new.o" "$O/registry_stub.o" "$O/diskann_adapter.o" "$O/svs_adapter.o" \
  "$OUT/diskann/src/libdiskann_s.a" -L"$SVS/lib" -Wl,-rpath,"$SVS/lib" -l:libsvs_runtime.so."$SVS_VERSION" -fopenmp \
  -Wl,--no-as-needed -lmkl_intel_ilp64 -lmkl_intel_thread -lmkl_core -liomp5 -laio -lpthread -lm -ldl

# --- Python 3.13 + ScaNN venv from the hashed lock file
if [ ! -x "$ROOT/python313/bin/python3" ]; then
  [ -f "$DL/Python-$PY_VERSION.tgz" ] || curl -fsSL -o "$DL/Python-$PY_VERSION.tgz" "$PY_URL"
  verify "$DL/Python-$PY_VERSION.tgz" "$PY_SHA"
  tar xzf "$DL/Python-$PY_VERSION.tgz" -C "$SRC"
  (cd "$SRC/Python-$PY_VERSION" && ./configure --prefix="$ROOT/python313" -q && make -j"$JOBS" >/dev/null && make install >/dev/null)
  rm -rf "$SRC/Python-$PY_VERSION"
fi
VENV="$ROOT/venv-scann"
[ -x "$VENV/bin/python" ] || "$ROOT/python313/bin/python3" -m venv "$VENV"
"$VENV/bin/pip" install -q --require-hashes --no-deps -r "$A/requirements-scann-linux-x86_64.lock"

# --- build-info-new.json
"$VENV/bin/python" - "$OUT" "$A" "$DISKANN_COMMIT" "$SVS_VERSION" "$SVS_SHA" "$PY_VERSION" "$SCANN_VERSION" <<'PY'
import hashlib, json, platform, subprocess, sys
out, a, dc, sv, ssha, pv, scv = sys.argv[1:]
def sh(c): return subprocess.run(c, shell=True, capture_output=True, text=True).stdout.strip()
def h(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()
info = {
  "machine": sh("hostname") + " " + platform.machine(), "cpu": sh("lscpu | grep 'Model name' | sed 's/.*: *//'"),
  "compiler": sh("g++ --version | head -1"), "cmake": sh("cmake --version | head -1"),
  "flags": {"adapters": "-O3 -march=native (diskann also -mavx2 -mfma -DUSE_AVX2 -include cstdint -fopenmp; svs -std=c++20)",
            "diskann_lib": sh("grep CXX_FLAGS %s/diskann/src/CMakeFiles/diskann_s.dir/flags.make | sed 's/.*= //'" % out)},
  "diskann_vamana": {"commit": dc, "branch": "cpp_main", "licence": "MIT", "lib_sha256": h(out + "/diskann/src/libdiskann_s.a")},
  "svs": {"version": sv, "tag_commit": "75e30f222cf06bcc0625ed021d783cae2d75cfc5", "package": "svs-cpp-runtime-bindings.tar.gz",
          "package_sha256": ssha, "licence": "Intel Simplified Software License (Oct 2022), binary only; LVQ / LeanVec Intel CPUs only",
          "runtime_so_sha256": h(out.rsplit("/", 1)[0] + "/src/svs-%s/lib/libsvs_runtime.so.%s" % (sv, sv))},
  "scann": {"version": scv, "python": pv, "lock": "requirements-scann-linux-x86_64.lock", "lock_sha256": h(a + "/requirements-scann-linux-x86_64.lock"),
            "licence": "Apache-2.0", "pip_freeze": sh(out.rsplit("/", 1)[0] + "/venv-scann/bin/pip freeze")},
  "binaries": {"adapter_test_new_sha256": h(out + "/adapter_test_new")},
  "status": {"diskann_vamana": "built, tested on the box", "svs_vamana_f32": "built, tested on the box",
             "svs_vamana_lvq": "awaiting platform: intel (S3a): the runtime rejects LVQ on non-Intel CPUs",
             "svs_vamana_leanvec": "awaiting platform: intel (S3a): same gate", "scann": "built, tested on the box"},
}
json.dump(info, open(out + "/build-info-new.json", "w"), indent=2)
print("wrote", out + "/build-info-new.json")
PY
