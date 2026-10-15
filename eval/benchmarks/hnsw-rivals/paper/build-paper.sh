#!/bin/bash
# Builds the pinned rival libraries (FAISS, USearch + NumKong, hnswlib) at the best SIMD level of this CPU and the
# adapters of paper/adapters/, links adapter_test, writes build-info.json. Linux x86-64 / aarch64 and macOS arm64.
# usage: build-paper.sh [-j N]      env: ROOT (work dir; default ~/.ss-eval/hnsw-paper on macOS, /root/hnsw-paper on Linux),
#   SRC (library clones; default $ROOT/src; missing ones are cloned at the pinned commit; existing ones must match the pin),
#   BUILD (default $ROOT/build), CXX, JOBS. Nothing outside ROOT/SRC/BUILD is written (clones are built out of tree).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
OS=$(uname -s); ARCH=$(uname -m)
[ "$OS" = Darwin ] && ROOT=${ROOT:-$HOME/.ss-eval/hnsw-paper} || ROOT=${ROOT:-/root/hnsw-paper}
SRC=${SRC:-$ROOT/src}; BUILD=${BUILD:-$ROOT/build}; JOBS=${JOBS:-4}
[ "${1:-}" = -j ] && JOBS=$2
mkdir -p "$SRC" "$BUILD"; SRC=$(cd "$SRC" && pwd); BUILD=$(cd "$BUILD" && pwd)

# ---- pins ----
FAISS_TAG=v1.15.1;    FAISS_COMMIT=75c755c5a1fc854756aaf3bd1131213aeb21d8d1     # tag object 7ea7339886edf8b4d9e719f593a5dfccff158274
USEARCH_TAG=v2.26.4;  USEARCH_COMMIT=1e8a19253138510f35ee2c68dc641e5b5c83c7b5   # tag object 26a8792df542ec72df7d755c65f6172a3e856148
NUMKONG_COMMIT=928a2143ac3370547f833eeb38dbd736f7d54d5e; STRINGZILLA_COMMIT=30d3e2129654d8269b3f66726414f9694c834e25
HNSWLIB_COMMIT=ca426729609b3221563047ceb269cc1213e0d376                         # nmslib/hnswlib master of 2026-09-14

clone() {  # clone <name> <url> <commit>
    local d=$SRC/$1
    if [ ! -d "$d/.git" ]; then
        mkdir -p "$d"; git -C "$d" init -q; git -C "$d" remote add origin "$2"
        "$HERE/gh.sh" -C "$d" fetch -q --depth 1 origin "$3"; git -C "$d" checkout -q FETCH_HEAD
    fi
    [ "$(git -C "$d" rev-parse HEAD)" = "$3" ] || { echo "$1: HEAD $(git -C "$d" rev-parse HEAD) != pin $3" >&2; exit 1; }
}
clone faiss https://github.com/facebookresearch/faiss.git $FAISS_COMMIT
clone usearch https://github.com/unum-cloud/usearch.git $USEARCH_COMMIT
clone hnswlib https://github.com/nmslib/hnswlib.git $HNSWLIB_COMMIT
[ -f "$SRC/usearch/numkong/CMakeLists.txt" ] || "$HERE/gh.sh" -C "$SRC/usearch" submodule update -q --init --depth 1 --recursive
[ "$(git -C "$SRC/usearch/numkong" rev-parse HEAD)" = $NUMKONG_COMMIT ] || { echo "numkong != pin" >&2; exit 1; }

# ---- CPU: best FAISS level, flags ----
if [ "$OS" = Darwin ]; then
    CPUINFO=$(sysctl -a 2>/dev/null | grep -E '^(machdep.cpu|hw\.(model|ncpu|physicalcpu|logicalcpu|memsize|optional\.))' || true)
    FLEVEL=generic; ARCHFLAG=-mcpu=native; NCPU=$(sysctl -n hw.ncpu)
    OMP=$(brew --prefix libomp); CXX=${CXX:-clang++}
    OMPF=(-Xpreprocessor -fopenmp -I$OMP/include); OMPL=(-L$OMP/lib -lomp -Wl,-rpath,$OMP/lib -framework Accelerate)
    FCMAKE=(-DBLA_VENDOR=Apple "-DCMAKE_CXX_FLAGS=-O3 -mcpu=native -I$OMP/include" "-DOpenMP_CXX_FLAGS=-Xpreprocessor -fopenmp -I$OMP/include"
            -DOpenMP_CXX_LIB_NAMES=omp -DOpenMP_omp_LIBRARY=$OMP/lib/libomp.dylib)
    SYSLIBS=()
else
    CPUINFO=$(lscpu); FLAGS=$(grep -m1 -E '^(flags|Features)' /proc/cpuinfo); NCPU=$(nproc)
    ARCHFLAG=-march=native; CXX=${CXX:-g++}; OMPF=(-fopenmp); OMPL=(-lopenblas -lgomp -lpthread)
    case "$ARCH" in
        x86_64) if grep -qwE 'avx512_fp16|amx_tile' <<<"$FLAGS"; then FLEVEL=avx512_spr
                elif grep -qw avx512f <<<"$FLAGS"; then FLEVEL=avx512
                elif grep -qw avx2 <<<"$FLAGS"; then FLEVEL=avx2
                else echo "no AVX2" >&2; exit 1; fi ;;
        aarch64|arm64) if grep -qwi sve <<<"$FLAGS"; then FLEVEL=sve; else FLEVEL=generic; fi ;;
        *) FLEVEL=generic ;;
    esac
    FCMAKE=(-DBLA_VENDOR=OpenBLAS "-DCMAKE_CXX_FLAGS=-O3 -march=native")
fi
echo "OS=$OS ARCH=$ARCH FAISS_OPT_LEVEL=$FLEVEL CXX=$CXX cpus=$NCPU jobs=$JOBS"

# ---- libraries (out of tree) ----
cmake -S "$SRC/faiss" -B "$BUILD/faiss" -DFAISS_ENABLE_GPU=OFF -DFAISS_ENABLE_PYTHON=OFF -DBUILD_TESTING=OFF -DBUILD_SHARED_LIBS=OFF \
    -DCMAKE_BUILD_TYPE=Release -DCMAKE_CXX_COMPILER=$CXX -DFAISS_OPT_LEVEL=$FLEVEL "${FCMAKE[@]}" >"$BUILD/faiss-cmake.log" 2>&1
FTARGET=faiss; [ "$FLEVEL" = generic ] || FTARGET=faiss_$FLEVEL   # only the target that gets linked
nice cmake --build "$BUILD/faiss" --target $FTARGET -j "$JOBS" >"$BUILD/faiss-build.log" 2>&1
FLIB=$BUILD/faiss/faiss/libfaiss_$FLEVEL.a; [ -f "$FLIB" ] || FLIB=$BUILD/faiss/faiss/libfaiss.a
# NK_MARCH_NATIVE=ON first; GCC 13 on Graviton4 (Ubuntu 24.04) rejects it ("inlining failed ... target specific
# option mismatch" in the SVE headers), so fall back to OFF there. NumKong picks its SIMD kernels at run time either
# way (dynamic dispatch); the choice is recorded in build-info.json (numkong_march_native).
NK_NATIVE=ON
for NK_NATIVE in ON OFF; do
  rm -rf "$BUILD/numkong"
  cmake -S "$SRC/usearch/numkong" -B "$BUILD/numkong" -DCMAKE_BUILD_TYPE=Release -DCMAKE_CXX_COMPILER=$CXX -DNK_BUILD_SHARED=ON -DNK_MARCH_NATIVE=$NK_NATIVE -DNK_ENABLE_ASAN=OFF >"$BUILD/numkong-cmake.log" 2>&1 \
    && nice cmake --build "$BUILD/numkong" -j "$JOBS" >"$BUILD/numkong-build.log" 2>&1 && break
  echo "numkong with NK_MARCH_NATIVE=$NK_NATIVE failed (see numkong-build.log)"
  [ $NK_NATIVE = OFF ] && exit 1
done
export NK_NATIVE
echo "FAISS lib: $FLIB"

# ---- adapters ----
CXXFLAGS=(-std=c++17 -O3 $ARCHFLAG -DNDEBUG "${OMPF[@]}" -I"$SRC/faiss" -I"$SRC/hnswlib" -I"$SRC/usearch/include" -I"$SRC/usearch/numkong/include"
          -DUSEARCH_USE_NUMKONG=1 -DNK_DYNAMIC_DISPATCH=1 -DPAPER_FAISS_COMMIT="\"$FAISS_COMMIT\"" -DPAPER_USEARCH_COMMIT="\"$USEARCH_COMMIT\""
          -DPAPER_HNSWLIB_COMMIT="\"$HNSWLIB_COMMIT\"")
LIBS=("$FLIB" -L"$BUILD/numkong" -lnumkong -Wl,-rpath,"$BUILD/numkong" "${OMPL[@]}")
OBJ=$BUILD/obj; mkdir -p "$OBJ"
nice "$CXX" "${CXXFLAGS[@]}" -c "$HERE/adapters/faiss_adapters.cpp" -o "$OBJ/faiss_adapters.o" &
nice "$CXX" "${CXXFLAGS[@]}" -c "$HERE/adapters/usearch_adapters.cpp" -o "$OBJ/usearch_adapters.o" &
nice "$CXX" "${CXXFLAGS[@]}" -ffast-math -ftree-vectorize -c "$HERE/adapters/hnswlib_adapter.cpp" -o "$OBJ/hnswlib_adapter.o" &  # hnswlib CMake flags
nice "$CXX" "${CXXFLAGS[@]}" -c "$HERE/adapters/registry_stub.cpp" -o "$OBJ/registry_stub.o" &
nice "$CXX" "${CXXFLAGS[@]}" -I"$HERE" -c "$HERE/adapter_test.cpp" -o "$OBJ/adapter_test.o" &
wait
rm -f "$BUILD/libpaper_adapters.a"; ar rcs "$BUILD/libpaper_adapters.a" "$OBJ/faiss_adapters.o" "$OBJ/usearch_adapters.o" "$OBJ/hnswlib_adapter.o"
# the adapters register themselves from static initialisers: link the objects themselves (or --whole-archive / -force_load)
ADAPTER_OBJS=("$OBJ/faiss_adapters.o" "$OBJ/usearch_adapters.o" "$OBJ/hnswlib_adapter.o")
"$CXX" "${CXXFLAGS[@]}" "$OBJ/adapter_test.o" "$OBJ/registry_stub.o" "${ADAPTER_OBJS[@]}" "${LIBS[@]}" -o "$BUILD/adapter_test"
# for rivals5.cpp: source this file, then  $CXX "${CXXFLAGS[@]}" rivals5.cpp "${ADAPTER_OBJS[@]}" "${LIBS[@]}"
{ echo "CXX=$CXX"; declare -p CXXFLAGS ADAPTER_OBJS LIBS | sed 's/^declare -[a-z]* //'; } >"$BUILD/link.env"

# ---- build-info.json ----
sha() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
NKLIB=$(ls "$BUILD"/numkong/libnumkong.* | head -1)
export OS ARCH FLEVEL CXX_VER="$("$CXX" --version | head -1)" CMAKE_VER="$(cmake --version | head -1)" CPUINFO NCPU FAISS_COMMIT USEARCH_COMMIT NUMKONG_COMMIT \
    STRINGZILLA_COMMIT HNSWLIB_COMMIT FAISS_TAG USEARCH_TAG CXXFLAGS_S="${CXXFLAGS[*]}" LIBS_S="${LIBS[*]}" FCMAKE_S="${FCMAKE[*]}" \
    SHA_TEST=$(sha "$BUILD/adapter_test") SHA_FAISS=$(sha "$FLIB") SHA_NK=$(sha "$NKLIB") SHA_ADAPTERS=$(sha "$BUILD/libpaper_adapters.a") \
    HOSTN=$(hostname) NKLIB_NAME=$(basename "$NKLIB") FLIB_NAME=$(basename "$FLIB") BUILD_DATE=$(date -u +%FT%TZ)
python3 - "$BUILD/build-info.json" <<'PY'
import json, os, sys
e = os.environ
json.dump({
  "built_utc": e["BUILD_DATE"], "host": e["HOSTN"], "os": e["OS"], "arch": e["ARCH"], "ncpu": e["NCPU"],
  "cpu_info": e["CPUINFO"], "compiler": e["CXX_VER"], "cmake": e["CMAKE_VER"],
  "faiss_opt_level": e["FLEVEL"], "faiss_cmake_args": e["FCMAKE_S"],
  "cxxflags": e["CXXFLAGS_S"], "hnswlib_extra_flags": "-ffast-math -ftree-vectorize (hnswlib_adapter.cpp only)", "link": e["LIBS_S"],
  "commits": {"faiss": e["FAISS_COMMIT"], "faiss_tag": e["FAISS_TAG"], "usearch": e["USEARCH_COMMIT"], "usearch_tag": e["USEARCH_TAG"],
              "numkong": e["NUMKONG_COMMIT"], "numkong_march_native": e.get("NK_NATIVE"), "stringzilla": e["STRINGZILLA_COMMIT"], "hnswlib": e["HNSWLIB_COMMIT"]},
  "sha256": {"adapter_test": e["SHA_TEST"], e["FLIB_NAME"]: e["SHA_FAISS"], e["NKLIB_NAME"]: e["SHA_NK"], "libpaper_adapters.a": e["SHA_ADAPTERS"]},
}, open(sys.argv[1], "w"), indent=2)
PY
echo "built $BUILD/adapter_test ; $BUILD/build-info.json ; $BUILD/link.env"
