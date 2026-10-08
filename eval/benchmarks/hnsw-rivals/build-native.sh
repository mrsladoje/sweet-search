#!/bin/zsh
# Build the native rival harness: FAISS 1.15.1, USearch 2.26.4 (+ NumKong), hnswlib, all from source, -O3 -mcpu=native.
# hnswlib gets its own binary with the flags from hnswlib's CMakeLists (-ffast-math -ftree-vectorize): it has no NEON
# code, and without those flags its distance loops stay scalar on ARM (about 5x slower).
set -e
S=${1:-src}; mkdir -p $S; OMP=$(brew --prefix libomp)
[ -d $S/faiss ] || git clone -q --depth 1 --branch v1.15.1 https://github.com/facebookresearch/faiss.git $S/faiss
[ -d $S/usearch ] || git clone -q --depth 1 --branch v2.26.4 --recurse-submodules --shallow-submodules https://github.com/unum-cloud/usearch.git $S/usearch
[ -d $S/hnswlib ] || git clone -q --depth 1 https://github.com/nmslib/hnswlib.git $S/hnswlib
( cd $S/faiss && cmake -B build -DFAISS_ENABLE_GPU=OFF -DFAISS_ENABLE_PYTHON=OFF -DBUILD_TESTING=OFF -DBUILD_SHARED_LIBS=OFF \
    -DCMAKE_BUILD_TYPE=Release -DFAISS_OPT_LEVEL=generic -DCMAKE_CXX_FLAGS="-O3 -mcpu=native -I$OMP/include" \
    -DOpenMP_CXX_FLAGS="-Xpreprocessor -fopenmp -I$OMP/include" -DOpenMP_CXX_LIB_NAMES=omp -DOpenMP_omp_LIBRARY=$OMP/lib/libomp.dylib \
    -DBLA_VENDOR=Apple && cmake --build build --target faiss -j 12 )
( cd $S/usearch/numkong && cmake -B build -DCMAKE_BUILD_TYPE=Release -DNK_BUILD_SHARED=ON -DNK_MARCH_NATIVE=ON -DNK_ENABLE_ASAN=OFF && cmake --build build -j 12 )
FLAGS=(-std=c++17 -O3 -mcpu=native -DNDEBUG -Xpreprocessor -fopenmp -I$OMP/include -I$S/faiss -I$S/hnswlib -I$S/usearch/include
       -I$S/usearch/numkong/include -DUSEARCH_USE_NUMKONG=1 -DNK_DYNAMIC_DISPATCH=1)
LIBS=($S/faiss/build/faiss/libfaiss.a -L$S/usearch/numkong/build -lnumkong -Wl,-rpath,$S/usearch/numkong/build -L$OMP/lib -lomp -framework Accelerate)
clang++ $FLAGS rivals.cpp $LIBS -o rivals
clang++ $FLAGS -ffast-math -ftree-vectorize rivals.cpp $LIBS -o rivals-hnswlib
echo built rivals rivals-hnswlib
