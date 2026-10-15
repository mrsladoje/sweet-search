// Adapter check: build every registered family on a small set, load it back from its directory in the
// same process, search the first 500 dev queries at a high effort, compare recall@10 with a float64
// brute-force exact top 10.
// usage: adapter_test (--old <setDir> | --emb <embDir>) [--only <regex>] [--nq 500] [--threads 4]
//   --old: meta.json, corpus768.bin, q768.bin (v4 layout)   --emb: corpus.f32, queries.f32 (DESIGN.md 1)
#include "adapter.h"
#include <omp.h>
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <regex>
#include <unistd.h>

namespace fs = std::filesystem;
using namespace paper;
static constexpr int D = 768, BITS = 512;

static std::vector<float> load_f32(const std::string& p) {
    std::ifstream f(p, std::ios::binary | std::ios::ate); if (!f) { fprintf(stderr, "cannot read %s\n", p.c_str()); exit(2); }
    size_t sz = f.tellg(); f.seekg(0); std::vector<float> v(sz / 4); f.read((char*)v.data(), sz); return v;
}
static void normalize(std::vector<float>& x) {  // float32 norm, as rivals.cpp did
    for (size_t i = 0; i < x.size() / D; i++) {
        float* p = &x[i * D]; float s = 0; for (int j = 0; j < D; j++) s += p[j] * p[j];
        s = std::sqrt(s); for (int j = 0; j < D; j++) p[j] /= s;
    }
}
// sign bits of the first 512 dims, MSB first (numpy packbits bitorder='big')
static std::vector<uint8_t> pack_bits(const std::vector<float>& x) {
    size_t n = x.size() / D; std::vector<uint8_t> c(n * BITS / 8, 0);
    for (size_t i = 0; i < n; i++)
        for (int b = 0; b < BITS; b++) if (x[i * D + b] > 0) c[i * 64 + b / 8] |= uint8_t(0x80 >> (b % 8));
    return c;
}
static size_t dir_bytes(const std::vector<std::string>& fl) { size_t t = 0; for (auto& f : fl) t += fs::file_size(f); return t; }

struct Case { const char* family; Params build, search; double need; };
static const std::vector<Case> CASES = {
    {"faiss_exact", {}, {}, 0.95},
    {"faiss_hnsw_flat", {{"M", "16"}, {"efC", "100"}}, {{"ef", "400"}}, 0.95},
    {"faiss_hnsw_sq8", {{"M", "16"}, {"efC", "100"}}, {{"ef", "400"}, {"refine", "4"}}, 0.95},
    {"faiss_bin_hnsw", {{"M", "16"}, {"efC", "100"}}, {{"ef", "400"}, {"refine", "100"}}, 0.80},
    {"faiss_bin_flat", {}, {{"refine", "100"}}, 0.80},
    {"faiss_rabitq_flat", {}, {{"refine", "10"}}, 0.80},
    {"faiss_rabitq_ivf", {{"nlist", "64"}}, {{"nprobe", "32"}, {"refine", "10"}}, 0.80},
    {"faiss_rabitq_hnsw", {{"M", "32"}, {"efC", "100"}}, {{"ef", "400"}, {"refine", "10"}}, 0.80},
    {"faiss_ivfpq_fs", {{"nlist", "64"}}, {{"nprobe", "32"}, {"refine", "20"}}, 0.80},
    {"hnswlib_f32", {{"M", "16"}, {"efC", "100"}}, {{"ef", "400"}}, 0.95},
    {"usearch_f16", {{"M", "16"}, {"efC", "100"}}, {{"ef", "400"}}, 0.95},
    {"usearch_i8", {{"M", "16"}, {"efC", "100"}}, {{"ef", "400"}}, 0.90},  // i8 quantisation alone: 0.945 measured, 0.997 with rescore
    {"usearch_i8_rescore", {{"M", "16"}, {"efC", "100"}}, {{"ef", "400"}, {"rescore", "100"}}, 0.95},
    {"usearch_b1_rescore", {{"M", "16"}, {"efC", "100"}}, {{"ef", "400"}, {"rescore", "200"}}, 0.80},
};

int main(int argc, char** argv) {
    std::string old, emb, only = ".*"; size_t nq = 500; int threads = 4;
    for (int i = 1; i + 1 < argc; i += 2) {
        std::string a = argv[i];
        if (a == "--old") old = argv[i + 1]; else if (a == "--emb") emb = argv[i + 1]; else if (a == "--only") only = argv[i + 1];
        else if (a == "--nq") nq = atol(argv[i + 1]); else if (a == "--threads") threads = atoi(argv[i + 1]);
        else { fprintf(stderr, "unknown option %s\n", a.c_str()); return 2; }
    }
    if (old.empty() == emb.empty()) { fprintf(stderr, "give exactly one of --old <setDir> / --emb <embDir>\n"); return 2; }
    auto X = load_f32(old.empty() ? emb + "/corpus.f32" : old + "/corpus768.bin");
    auto Q = load_f32(old.empty() ? emb + "/queries.f32" : old + "/q768.bin");
    normalize(X); normalize(Q);
    size_t n = X.size() / D; nq = std::min(nq, Q.size() / D); Q.resize(nq * D);
    auto C = pack_bits(X), CQ = pack_bits(Q);
    printf("set: n=%zu d=%d queries=%zu threads=%d\n", n, D, nq, threads);

    std::vector<int64_t> gt(nq * 10);  // float64 exact top 10 (ties: lower id)
    #pragma omp parallel for schedule(dynamic, 8)
    for (long i = 0; i < (long)nq; i++) {
        std::vector<std::pair<double, int64_t>> s(n);
        for (size_t j = 0; j < n; j++) { double a = 0; for (int t = 0; t < D; t++) a += (double)Q[i * D + t] * (double)X[j * D + t]; s[j] = {-a, (int64_t)j}; }
        std::partial_sort(s.begin(), s.begin() + 10, s.end());
        for (int j = 0; j < 10; j++) gt[i * 10 + j] = s[j].second;
    }

    Corpus c; c.n = n; c.d = D; c.x = X.data(); c.codes = C.data();
    std::regex re(only); int fails = 0, ran = 0;
    std::string tmp = (fs::temp_directory_path() / ("adapter_test_" + std::to_string(getpid()))).string();
    printf("%-22s %-6s %9s %12s  %s\n", "family", "result", "recall@10", "index bytes", "info");
    for (auto& cs : CASES) {
        if (!std::regex_search(cs.family, re)) continue;
        ran++;
        if (!registry().count(cs.family)) { printf("%-22s FAIL   (not registered)\n", cs.family); fails++; continue; }
        std::string dir = tmp + "/" + cs.family; fs::create_directories(dir);
        double rec = -1; size_t bytes = 0; std::string note, err;
        try {
            registry()[cs.family]()->build(c, cs.build, threads, 42, dir);
            auto a = registry()[cs.family]();  // fresh object: loads from the directory only
            a->load(dir, c, cs.build); a->set_search(cs.search);
            bytes = dir_bytes(a->files(dir));
            auto inf = a->info(); for (auto& kv : inf) if (kv.first == "simd" || kv.first == "commit") note += kv.first + "=" + kv.second + " ";
            if (a->keeps_originals()) note += "keeps_originals ";
            omp_set_num_threads(1);
            std::vector<int64_t> ids(10); std::vector<float> sc(10); double hit = 0;
            for (size_t i = 0; i < nq; i++) {
                size_t m = a->search(&Q[i * D], &CQ[i * 64], 10, ids.data(), sc.data());
                for (size_t x = 0; x < m; x++) for (int y = 0; y < 10; y++) hit += ids[x] == gt[i * 10 + y];
            }
            rec = hit / (10.0 * nq);
        } catch (std::exception& e) { err = e.what(); }
        bool ok = err.empty() && rec >= cs.need;
        printf("%-22s %-6s %9.4f %12zu  need>=%.2f %s%s\n", cs.family, ok ? "PASS" : "FAIL", rec, bytes, cs.need, note.c_str(), err.empty() ? "" : ("ERROR: " + err).c_str());
        fflush(stdout); fails += !ok;
        fs::remove_all(dir);
    }
    fs::remove_all(tmp);
    if (!ran) { fprintf(stderr, "no family matched\n"); return 2; }
    printf("%s (%d of %d failed)\n", fails ? "FAIL" : "ALL PASS", fails, ran);
    return fails ? 1 : 0;
}
