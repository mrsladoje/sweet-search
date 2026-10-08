#!/bin/bash
# Linux x86-64 port of build-native.sh. Builds FAISS 1.15.1, USearch 2.26.4 (+ NumKong), hnswlib from source with the best x86 settings:
#   FAISS: -DFAISS_OPT_LEVEL=avx2 + OpenBLAS (apt libopenblas-dev); USearch/NumKong: native march; hnswlib: its own CMake flags
#   (-ffast-math -ftree-vectorize) + -march=native. OpenMP via libgomp.
# Usage (from the work dir, which holds rivals.cpp next to this script): ./build-native-linux.sh [srcdir]
# Needs: g++, cmake, git, libopenblas-dev. The only source change vs the Mac build: THREADS (build thread count) is set to nproc
# in a patched COPY of rivals.cpp (rivals-linux.cpp); the original file is untouched.
set -e
HERE=$(cd "$(dirname "$0")" && pwd); cd "$HERE"
S=${1:-src}; mkdir -p $S; CXX=${CXX:-g++}; J=$(nproc)
[ -d $S/faiss ] || git clone -q --depth 1 --branch v1.15.1 https://github.com/facebookresearch/faiss.git $S/faiss
[ -d $S/usearch ] || git clone -q --depth 1 --branch v2.26.4 --recurse-submodules --shallow-submodules https://github.com/unum-cloud/usearch.git $S/usearch
[ -d $S/hnswlib ] || git clone -q --depth 1 https://github.com/nmslib/hnswlib.git $S/hnswlib
( cd $S/faiss && cmake -B build -DFAISS_ENABLE_GPU=OFF -DFAISS_ENABLE_PYTHON=OFF -DBUILD_TESTING=OFF -DBUILD_SHARED_LIBS=OFF \
    -DCMAKE_BUILD_TYPE=Release -DFAISS_OPT_LEVEL=avx2 -DBLA_VENDOR=OpenBLAS -DCMAKE_CXX_FLAGS="-O3 -march=native" \
    && cmake --build build -j $J )
( cd $S/usearch/numkong && cmake -B build -DCMAKE_BUILD_TYPE=Release -DNK_BUILD_SHARED=ON -DNK_MARCH_NATIVE=ON -DNK_ENABLE_ASAN=OFF \
    && cmake --build build -j $J )
# with FAISS_OPT_LEVEL=avx2 the AVX2 kernels live in libfaiss_avx2.a (the generic libfaiss.a is built too); link the AVX2 one
FLIB=$S/faiss/build/faiss/libfaiss_avx2.a; [ -f $FLIB ] || FLIB=$S/faiss/build/faiss/libfaiss.a
echo "linking FAISS: $FLIB"
sed "s/THREADS = 12;/THREADS = $J;/" rivals.cpp > rivals-linux.cpp
grep -q "THREADS = $J;" rivals-linux.cpp
FLAGS=(-std=c++17 -O3 -march=native -DNDEBUG -fopenmp -I$S/faiss -I$S/hnswlib -I$S/usearch/include
       -I$S/usearch/numkong/include -DUSEARCH_USE_NUMKONG=1 -DNK_DYNAMIC_DISPATCH=1)
LIBS=($FLIB -L$S/usearch/numkong/build -lnumkong -Wl,-rpath,$HERE/$S/usearch/numkong/build -lopenblas -lgomp -lpthread)
$CXX "${FLAGS[@]}" rivals-linux.cpp "${LIBS[@]}" -o rivals
$CXX "${FLAGS[@]}" -ffast-math -ftree-vectorize rivals-linux.cpp "${LIBS[@]}" -o rivals-hnswlib
echo built rivals rivals-hnswlib
