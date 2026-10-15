// C ABI of shared_rescore.h for the Python runner (py5.py), so ScaNN's (A) path runs the same C++ code
// as rivals5.cpp. Build: g++ -std=c++17 -O2 -march=native -shared -fPIC rescore_capi.cpp -o librescore5.so
// (no -ffast-math). The splitmix64 order is exported too, so the Python runner times queries in the same order.
#include "shared_rescore.h"
using namespace paper;

extern "C" {
struct R5 { Shared sh; Query q; int code_d; };

void* r5_new(const int8_t* int8, int w8, const uint16_t* f16, int code_d) {
    auto r = new R5; r->sh.int8 = int8; r->sh.w8 = w8; r->sh.f16 = f16; r->code_d = code_d; return r;
}
void r5_free(void* r) { delete (R5*)r; }
// query conversion; writes the sign code (code_d / 8 bytes) to `code`
void r5_query(void* p, const float* q, uint8_t* code) {
    auto r = (R5*)p; convert_query(q, r->q, r->code_d, r->sh.w8); memcpy(code, r->q.code, r->code_d / 8);
}
// the shared screen + rescoring of the last converted query
size_t r5_run(void* p, const int64_t* cand, size_t nc, size_t H, int64_t* ids, double* scores) {
    auto r = (R5*)p; return r->sh.run(r->q, cand, nc, H, ids, scores);
}
void r5_perm(size_t n, uint64_t seed, uint64_t* out) {
    uint64_t s = seed;
    auto next = [&] { s += 0x9e3779b97f4a7c15ull; uint64_t z = s; z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ull; z = (z ^ (z >> 27)) * 0x94d049bb133111ebull; return z ^ (z >> 31); };
    for (size_t i = 0; i < n; i++) out[i] = i;
    for (size_t i = n ? n - 1 : 0; i > 0; i--) { size_t j = next() % (i + 1); std::swap(out[i], out[j]); }
}
}
