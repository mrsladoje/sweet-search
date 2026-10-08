// Native C++ rival harness: FAISS, hnswlib, USearch, built from source with -O3 -mcpu=native.
// Builds one index config (12 threads), then sweeps efSearch single-threaded. Per query: median of
// 3 runs after 200 warm-up queries. Writes top-10 ids + latencies per ef; scoring is done in Python.
// usage: rivals <setDir> <outDir> <config> <M> <efC>
//   config: faiss_flat | faiss_sq8_refine | faiss_bin_cascade | hnswlib | usearch_f16 | usearch_i8
//           | usearch_i8_rescore | usearch_b1_cascade
#include <faiss/IndexHNSW.h>
#include <faiss/IndexBinaryHNSW.h>
#include <faiss/IndexRefine.h>
#include <faiss/index_io.h>
#include <faiss/impl/io.h>
#include <faiss/utils/distances.h>
#include <omp.h>
#include "hnswlib/hnswlib.h"
#include <usearch/index_dense.hpp>
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <functional>
#include <numeric>
#include <string>
#include <thread>
#include <vector>

using clk = std::chrono::steady_clock;
static constexpr int D = 768, BITS = 512, K10 = 10, THREADS = 12;

static std::vector<float> load_f32(const std::string& p) {
    std::ifstream f(p, std::ios::binary | std::ios::ate); size_t sz = f.tellg(); f.seekg(0);
    std::vector<float> v(sz / 4); f.read((char*)v.data(), sz); return v;
}
static std::vector<int32_t> load_i32(const std::string& p) {
    std::ifstream f(p, std::ios::binary | std::ios::ate); size_t sz = f.tellg(); f.seekg(0);
    std::vector<int32_t> v(sz / 4); f.read((char*)v.data(), sz); return v;
}
static void normalize(std::vector<float>& x) {
    for (size_t i = 0; i < x.size() / D; i++) {
        float* p = &x[i * D]; float n = std::sqrt(faiss::fvec_norm_L2sqr(p, D));
        for (int j = 0; j < D; j++) p[j] /= n;
    }
}
// sign bits of the first 512 dims, MSB first (same codes as numpy packbits bitorder='big')
static std::vector<uint8_t> pack_bits(const std::vector<float>& x) {
    size_t n = x.size() / D; std::vector<uint8_t> c(n * BITS / 8, 0);
    for (size_t i = 0; i < n; i++)
        for (int b = 0; b < BITS; b++) if (x[i * D + b] > 0) c[i * 64 + b / 8] |= uint8_t(0x80 >> (b % 8));
    return c;
}
static double secs(clk::time_point a) { return std::chrono::duration<double>(clk::now() - a).count(); }

int main(int argc, char** argv) {
    if (argc < 6) { fprintf(stderr, "usage: rivals <setDir> <outDir> <config> <M> <efC>\n"); return 2; }
    std::string set = argv[1], out = argv[2], cfg = argv[3]; int M = atoi(argv[4]), efC = atoi(argv[5]);
    auto X = load_f32(set + "/corpus768.bin"), Q = load_f32(set + "/q768.bin");
    normalize(X); normalize(Q);
    auto GT = load_i32(out + "/gt.bin");
    size_t n = X.size() / D, nq = Q.size() / D;
    auto C = pack_bits(X), CQ = pack_bits(Q);

    // f32 exact rescore of candidate ids -> top 10 (FAISS's optimised inner product)
    auto rescore = [&](const float* q, const int64_t* cand, size_t nc, int64_t* top) {
        std::vector<std::pair<float, int64_t>> s; s.reserve(nc);
        for (size_t i = 0; i < nc; i++) if (cand[i] >= 0) s.push_back({faiss::fvec_inner_product(q, &X[cand[i] * D], D), cand[i]});
        size_t k = std::min<size_t>(K10, s.size());
        std::partial_sort(s.begin(), s.begin() + k, s.end(), [](auto& a, auto& b) { return a.first > b.first; });
        for (size_t i = 0; i < K10; i++) top[i] = i < k ? s[i].second : -1;
    };

    double build_s = 0; size_t index_bytes = 0;
    std::function<void(int)> set_ef;
    std::function<void(size_t, int64_t*)> query;  // writes 10 ids
    std::vector<int> efs = {16, 32, 64, 128, 256, 512, 1024, 2048};

    std::unique_ptr<faiss::IndexHNSWFlat> fflat; std::unique_ptr<faiss::IndexHNSWSQ> fsq; std::unique_ptr<faiss::IndexRefineFlat> fref;
    std::unique_ptr<faiss::IndexBinaryHNSW> fbin;
    std::unique_ptr<hnswlib::InnerProductSpace> hspace; std::unique_ptr<hnswlib::HierarchicalNSW<float>> hidx;
    using uindex_t = unum::usearch::index_dense_t; uindex_t uidx;
    int cascade_k = 1000, cascade_r = 150, rescore_k = 50, cur_ef = 0;

    auto t0 = clk::now();
    if (cfg == "faiss_flat" || cfg == "faiss_sq8_refine") {
        omp_set_num_threads(THREADS);
        faiss::IndexHNSW* base;
        if (cfg == "faiss_flat") { fflat.reset(new faiss::IndexHNSWFlat(D, M, faiss::METRIC_INNER_PRODUCT)); base = fflat.get(); }
        else { fsq.reset(new faiss::IndexHNSWSQ(D, faiss::ScalarQuantizer::QT_8bit, M, faiss::METRIC_INNER_PRODUCT)); fsq->train(n, X.data()); base = fsq.get(); }
        base->hnsw.efConstruction = efC; base->add(n, X.data());
        if (fsq) { fref.reset(new faiss::IndexRefineFlat(fsq.get(), X.data())); fref->k_factor = 4; }
        build_s = secs(t0);
        { faiss::VectorIOWriter w; faiss::write_index(fref ? (faiss::Index*)fref.get() : base, &w); index_bytes = w.data.size(); }
        omp_set_num_threads(1);
        set_ef = [&, base](int ef) { base->hnsw.efSearch = ef; };
        if (fref) query = [&](size_t i, int64_t* top) { float d[K10]; fref->search(1, &Q[i * D], K10, d, top); };
        else query = [&](size_t i, int64_t* top) { float d[K10]; fflat->search(1, &Q[i * D], K10, d, top); };
    } else if (cfg == "faiss_bin_cascade") {
        omp_set_num_threads(THREADS);
        fbin.reset(new faiss::IndexBinaryHNSW(BITS, M)); fbin->hnsw.efConstruction = efC; fbin->add(n, C.data());
        build_s = secs(t0);
        { faiss::VectorIOWriter w; faiss::write_index_binary(fbin.get(), &w); index_bytes = w.data.size(); }
        omp_set_num_threads(1);
        efs = {128, 256, 512, 1000, 2000};
        set_ef = [&](int ef) { fbin->hnsw.efSearch = ef; cur_ef = ef; };
        query = [&](size_t i, int64_t* top) {
            int k = std::min(cascade_k, cur_ef); std::vector<int32_t> dd(k); std::vector<int64_t> ids(k);
            fbin->search(1, &CQ[i * 64], k, dd.data(), ids.data());
            rescore(&Q[i * D], ids.data(), std::min(k, cascade_r), top);
        };
    } else if (cfg == "hnswlib") {
        hspace.reset(new hnswlib::InnerProductSpace(D));
        hidx.reset(new hnswlib::HierarchicalNSW<float>(hspace.get(), n, M, efC));
        hidx->addPoint(&X[0], 0);
        std::atomic<size_t> next{1}; std::vector<std::thread> th;
        for (int t = 0; t < THREADS; t++) th.emplace_back([&] { for (size_t i; (i = next++) < n;) hidx->addPoint(&X[i * D], i); });
        for (auto& t : th) t.join();
        build_s = secs(t0);
        index_bytes = n * hidx->size_data_per_element_ + n * sizeof(void*);
        for (size_t i = 0; i < n; i++) index_bytes += hidx->element_levels_[i] * hidx->size_links_per_element_;
        set_ef = [&](int ef) { hidx->setEf(std::max(ef, K10)); };
        query = [&](size_t i, int64_t* top) {
            auto pq = hidx->searchKnn(&Q[i * D], K10); size_t k = pq.size();
            for (size_t j = 0; j < K10; j++) top[j] = -1;
            while (!pq.empty()) { top[--k] = pq.top().second; pq.pop(); }
        };
    } else if (cfg.rfind("usearch_", 0) == 0) {
        using namespace unum::usearch;
        bool b1 = cfg == "usearch_b1_cascade";
        scalar_kind_t sk = cfg == "usearch_f16" ? scalar_kind_t::f16_k : b1 ? scalar_kind_t::b1x8_k : scalar_kind_t::i8_k;
        metric_punned_t metric(b1 ? BITS : D, b1 ? metric_kind_t::hamming_k : metric_kind_t::cos_k, sk);
        index_dense_config_t conf(M, efC, 64);
        auto st = uindex_t::make(metric, conf); if (!st) { fprintf(stderr, "usearch make failed: %s\n", st.error.what()); return 1; }
        uidx = std::move(st.index); uidx.reserve(index_limits_t(n, THREADS));
        fprintf(stderr, "usearch isa: %s\n", uidx.metric().isa_name());
        // the library's own executor, as the Python binding uses (a plain std::thread pool builds a worse graph)
        executor_default_t{(std::size_t)THREADS}.dynamic(n, [&](std::size_t t, std::size_t i) {
            auto r = b1 ? uidx.add(i, (b1x8_t const*)&C[i * 64], t) : uidx.add(i, &X[i * D], t);
            if (!r) { fprintf(stderr, "add failed\n"); std::exit(1); }
            return true;
        });
        build_s = secs(t0); index_bytes = uidx.memory_usage();
        if (b1) efs = {128, 256, 512, 1000, 2000};
        set_ef = [&](int ef) { uidx.change_expansion_search(ef); cur_ef = ef; };
        if (b1) query = [&](size_t i, int64_t* top) {
            int k = std::min(cascade_k, cur_ef); std::vector<uint64_t> keys(k);
            auto r = uidx.search((b1x8_t const*)&CQ[i * 64], k, 0); size_t got = r.dump_to(keys.data());
            std::vector<int64_t> ids(got); for (size_t j = 0; j < got; j++) ids[j] = (int64_t)keys[j];
            rescore(&Q[i * D], ids.data(), std::min<size_t>(got, cascade_r), top);
        };
        else if (cfg == "usearch_i8_rescore") query = [&](size_t i, int64_t* top) {
            std::vector<uint64_t> keys(rescore_k); auto r = uidx.search(&Q[i * D], rescore_k, 0); size_t got = r.dump_to(keys.data());
            std::vector<int64_t> ids(got); for (size_t j = 0; j < got; j++) ids[j] = (int64_t)keys[j];
            rescore(&Q[i * D], ids.data(), got, top);
        };
        else query = [&](size_t i, int64_t* top) {
            uint64_t keys[K10]; auto r = uidx.search(&Q[i * D], K10, 0); size_t got = r.dump_to(keys);
            for (size_t j = 0; j < K10; j++) top[j] = j < got ? (int64_t)keys[j] : -1;
        };
    } else { fprintf(stderr, "unknown config %s\n", cfg.c_str()); return 2; }

    std::vector<int64_t> res(nq * K10); std::vector<double> lat(nq);
    for (int ef : efs) {
        set_ef(ef);
        for (size_t i = 0; i < std::min<size_t>(200, nq); i++) query(i, &res[i * K10]);
        for (size_t i = 0; i < nq; i++) {
            double t[3];
            for (int r = 0; r < 3; r++) { auto s = clk::now(); query(i, &res[i * K10]); t[r] = std::chrono::duration<double, std::micro>(clk::now() - s).count(); }
            std::sort(t, t + 3); lat[i] = t[1];
        }
        double rec = 0;
        for (size_t i = 0; i < nq; i++) {
            int hit = 0; for (int a = 0; a < K10; a++) for (int b = 0; b < K10; b++) hit += res[i * K10 + a] == GT[i * K10 + b];
            rec += hit / 10.0;
        }
        rec /= nq;
        std::vector<double> sl(lat); std::sort(sl.begin(), sl.end()); double p50 = sl[nq / 2];
        std::string tag = cfg + "_M" + std::to_string(M) + "_efC" + std::to_string(efC) + "_ef" + std::to_string(ef);
        { std::ofstream f(out + "/res/" + tag + ".ids", std::ios::binary); f.write((char*)res.data(), res.size() * 8); }
        { std::ofstream f(out + "/res/" + tag + ".lat", std::ios::binary); f.write((char*)lat.data(), lat.size() * 8); }
        printf("{\"tag\":\"%s\",\"config\":\"%s\",\"M\":%d,\"efC\":%d,\"ef\":%d,\"build_s\":%.1f,\"index_mb\":%.1f,\"p50_us\":%.1f,\"recall10_vs_exact\":%.4f}\n",
               tag.c_str(), cfg.c_str(), M, efC, ef, build_s, index_bytes / 1048576.0, p50, rec);
        fflush(stdout);
        if (rec >= 0.999 || p50 > 15000) break;
    }
    return 0;
}
