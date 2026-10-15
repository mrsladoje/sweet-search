#!/bin/bash
# Links the harness binaries from rivals5.cpp (DESIGN.md 5) after build-paper.sh and adapters/build-new.sh:
#   rivals5      FAISS, hnswlib, USearch adapters (OpenBLAS)          -> $BUILD/rivals5
#   rivals5-ext  DiskANN and SVS adapters (MKL ILP64, libsvs_runtime)  -> $BUILD/rivals5-ext  (Linux x86 only)
# Two binaries because FAISS's OpenBLAS (32-bit integers) and DiskANN's MKL ILP64 export the same BLAS symbols.
# Also builds librescore5.so (py5.py) and bitident. shared_rescore.h is compiled without -ffast-math.
# usage: build-rivals5.sh [ROOT]   (ROOT default: /root/hnsw-paper on Linux, ~/.ss-eval/hnsw-paper on macOS)
set -euo pipefail
H=$(cd "$(dirname "$0")" && pwd)
if [ "$(uname)" = Darwin ]; then ROOT=${1:-$HOME/.ss-eval/hnsw-paper}; else ROOT=${1:-/root/hnsw-paper}; fi
BUILD=$ROOT/build; NEW=$ROOT/build-new
source "$BUILD/link.env"
# bash 3.2 (macOS) writes arrays as quoted strings "([0]=...)": turn them back into arrays
for v in CXXFLAGS ADAPTER_OBJS LIBS; do eval "x=\${$v}"; case "$x" in "("*) eval "$v=$x";; esac; done
F=("${CXXFLAGS[@]}" -I"$H")
"$CXX" "${F[@]}" -c "$H/rivals5.cpp" -o "$BUILD/obj/rivals5.o"
"$CXX" "${F[@]}" -o "$BUILD/rivals5" "$BUILD/obj/rivals5.o" "${ADAPTER_OBJS[@]}" "${LIBS[@]}"
"$CXX" -std=c++17 -O2 $( [ "$(uname)" = Darwin ] && echo -mcpu=native || echo -march=native ) -shared -fPIC "$H/rescore_capi.cpp" -o "$BUILD/librescore5.so"
"$CXX" -std=c++17 -O2 $( [ "$(uname)" = Darwin ] && echo -mcpu=native || echo -march=native ) "$H/bitident.cpp" -o "$BUILD/bitident"
if [ "$(uname)" = Linux ] && [ -f "$NEW/obj/diskann_adapter.o" ]; then
  SVS=$(ls -d "$ROOT"/src/svs-* | head -1); SV=${SVS##*/svs-}
  g++ -std=c++17 -O3 -march=native -DNDEBUG -fopenmp -I"$H" -c "$H/rivals5.cpp" -o "$NEW/obj/rivals5.o"
  g++ -O3 -o "$BUILD/rivals5-ext" "$NEW/obj/rivals5.o" "$NEW/obj/diskann_adapter.o" "$NEW/obj/svs_adapter.o" \
    "$NEW/diskann/src/libdiskann_s.a" -L"$SVS/lib" -Wl,-rpath,"$SVS/lib" -l:libsvs_runtime.so."$SV" -fopenmp \
    -Wl,--no-as-needed -lmkl_intel_ilp64 -lmkl_intel_thread -lmkl_core -liomp5 -laio -lpthread -lm -ldl
fi
for b in "$BUILD/rivals5" "$BUILD/rivals5-ext" "$BUILD/librescore5.so" "$BUILD/bitident"; do
  [ -f "$b" ] && echo "$(shasum -a 256 "$b" 2>/dev/null || sha256sum "$b")"
done
echo "families:"; "$BUILD/rivals5" families | tr '\n' ' '; echo
if [ -f "$BUILD/rivals5-ext" ]; then "$BUILD/rivals5-ext" families | tr '\n' ' '; echo; fi
