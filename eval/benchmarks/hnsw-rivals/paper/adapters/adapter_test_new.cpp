// Correctness driver for the DiskANN and SVS adapters (adapter.h). Per family: build on a set into a temp
// dir, load from that dir in the same process, search the first NQ queries at high effort, print recall@10
// against an exact float64 top 10 and the bytes on disk. PASS when recall@10 >= the family threshold.
// usage: adapter_test_new --old <setDir> [--family f1,f2|all] [--nq 500] [--threads 8] [--tmp <dir>]
//   <setDir> (old layout): corpus768.bin (float32 n x 768), q768.bin (float32 nq x 768); vectors are
//   normalised to unit length here. Exit code: 0 = every selected family PASS or SKIP, 1 = any FAIL.
// registry() comes from registry_stub.cpp (link it in).
// A family that throws a message containing "awaiting platform" is reported SKIP (not a failure).
#include "../adapter.h"

#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <numeric>
#include <set>
#include <sstream>

using namespace paper;

static std::vector<float> load_f32(const std::string& p) {
    std::ifstream f(p, std::ios::binary | std::ios::ate);
    if (!f) { fprintf(stderr, "cannot read %s\n", p.c_str()); exit(2); }
    size_t sz = f.tellg(); f.seekg(0);
    std::vector<float> v(sz / 4); f.read((char*)v.data(), sz); return v;
}
static void normalize(std::vector<float>& x, int d) {
    for (size_t i = 0; i < x.size() / d; i++) {
        double s = 0; for (int j = 0; j < d; j++) s += (double)x[i * d + j] * x[i * d + j];
        float n = (float)std::sqrt(s);
        if (n > 0) for (int j = 0; j < d; j++) x[i * d + j] /= n;
    }
}
static Params parse(const std::string& s) {  // "a=1,b=2"
    Params p; std::stringstream ss(s); std::string kv;
    while (std::getline(ss, kv, ',')) { auto e = kv.find('='); if (e != std::string::npos) p[kv.substr(0, e)] = kv.substr(e + 1); }
    return p;
}
static uint64_t dir_bytes(const std::vector<std::string>& fs) {
    uint64_t t = 0; struct stat st;
    for (auto& f : fs) { if (stat(f.c_str(), &st) != 0) { fprintf(stderr, "missing file %s\n", f.c_str()); return 0; } t += st.st_size; }
    return t;
}

struct Case { std::string family; Params build, search; double min_recall; };

int main(int argc, char** argv) {
    std::string set, fam = "all", tmp = "/tmp";
    int nq = 500, threads = 8;
    for (int i = 1; i < argc; i++) {
        std::string a = argv[i];
        if (a == "--old" && i + 1 < argc) set = argv[++i];
        else if (a == "--family" && i + 1 < argc) fam = argv[++i];
        else if (a == "--nq" && i + 1 < argc) nq = atoi(argv[++i]);
        else if (a == "--threads" && i + 1 < argc) threads = atoi(argv[++i]);
        else if (a == "--tmp" && i + 1 < argc) tmp = argv[++i];
    }
    if (set.empty()) { fprintf(stderr, "usage: adapter_test_new --old <setDir> [--family ..] [--nq N] [--threads T] [--tmp dir]\n"); return 2; }
    const int D = 768;
    auto X = load_f32(set + "/corpus768.bin"); auto Q = load_f32(set + "/q768.bin");
    normalize(X, D); normalize(Q, D);
    size_t n = X.size() / D; nq = (int)std::min<size_t>(nq, Q.size() / D);
    // exact top 10 in float64
    std::vector<std::vector<int64_t>> gt(nq);
    for (int q = 0; q < nq; q++) {
        std::vector<std::pair<double, int64_t>> s(n);
        for (size_t i = 0; i < n; i++) {
            double acc = 0; for (int j = 0; j < D; j++) acc += (double)Q[(size_t)q * D + j] * X[i * D + j];
            s[i] = {-acc, (int64_t)i};
        }
        std::partial_sort(s.begin(), s.begin() + 10, s.end());
        for (int j = 0; j < 10; j++) gt[q].push_back(s[j].second);
    }
    Corpus c; c.n = n; c.d = D; c.x = X.data();
    // high-effort settings: graph methods near the top of their grids, thresholds from the task
    std::vector<Case> cases = {
        {"diskann_vamana", parse("R=64,L=200,alpha=1.2"), parse("L=400"), 0.95},
        {"svs_vamana_f32", parse("degree=64,window=200,alpha=0.95"), parse("window=400"), 0.95},
        {"svs_vamana_lvq", parse("degree=64,window=200,alpha=0.95"), parse("window=400"), 0.90},
        {"svs_vamana_leanvec", parse("degree=64,window=200,alpha=0.95,leanvec_dims=192"), parse("window=400"), 0.90},
    };
    int fails = 0;
    for (auto& cs : cases) {
        if (fam != "all" && (","+fam+",").find(","+cs.family+",") == std::string::npos) continue;
        auto it = registry().find(cs.family);
        if (it == registry().end()) { printf("%-20s SKIP (not compiled into this binary)\n", cs.family.c_str()); continue; }
        std::string dir = tmp + "/adapter_test_" + cs.family + "_" + std::to_string(getpid());
        mkdir(dir.c_str(), 0755);
        try {
            auto t0 = std::chrono::steady_clock::now();
            { auto a = it->second(); a->build(c, cs.build, threads, 42, dir); }
            double bs = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
            auto a = it->second(); a->load(dir, c, cs.build); a->set_search(cs.search);
            uint64_t bytes = dir_bytes(a->files(dir));
            size_t hit = 0, short_lists = 0; int sorted_bad = 0;
            for (int q = 0; q < nq; q++) {
                int64_t ids[10]; float sc[10];
                size_t m = a->search(&Q[(size_t)q * D], nullptr, 10, ids, sc);
                if (m < 10) short_lists++;
                std::set<int64_t> g(gt[q].begin(), gt[q].end());
                for (size_t j = 0; j < m; j++) hit += g.count(ids[j]);
                for (size_t j = 1; j < m; j++) if (sc[j] > sc[j - 1] + 1e-6f) sorted_bad++;
            }
            double rec = (double)hit / (10.0 * nq);
            bool pass = rec >= cs.min_recall && bytes > 0 && sorted_bad == 0 && short_lists == 0;
            printf("%-20s %s recall@10=%.4f (min %.2f) nq=%d bytes=%llu build_s=%.1f short=%zu unsorted=%d\n",
                   cs.family.c_str(), pass ? "PASS" : "FAIL", rec, cs.min_recall, nq, (unsigned long long)bytes, bs, short_lists, sorted_bad);
            for (auto& kv : a->info()) printf("    %s = %s\n", kv.first.c_str(), kv.second.c_str());
            if (!pass) fails++;
        } catch (const std::exception& e) {
            std::string m = e.what();
            if (m.find("awaiting platform") != std::string::npos) printf("%-20s SKIP (%s)\n", cs.family.c_str(), m.c_str());
            else { printf("%-20s FAIL exception: %s\n", cs.family.c_str(), m.c_str()); fails++; }
        }
        std::string rm = "rm -rf '" + dir + "'"; if (system(rm.c_str())) {}
    }
    printf(fails ? "RESULT FAIL (%d)\n" : "RESULT OK\n", fails);
    return fails ? 1 : 0;
}
