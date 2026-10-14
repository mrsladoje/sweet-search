// Native C++ rival harness: FAISS, hnswlib, USearch, built from source with -O3 -mcpu=native.
// Builds one index config (12 threads), then sweeps efSearch single-threaded. Per query: median of
// 3 runs after 200 warm-up queries. Writes top-10 ids + latencies per ef; scoring is done in Python.
// usage: rivals <setDir> <outDir> <config> <M> <efC>
//   config: faiss_flat | faiss_sq8_refine | faiss_bin_cascade | hnswlib | usearch_f16 | usearch_i8
//           | usearch_i8_rescore | usearch_b1_cascade | faiss_exact | faiss_binflat_cascade
//   faiss_exact: brute-force inner product (IndexFlatIP), the exact-quality reference.
//   faiss_binflat_cascade: exact Hamming scan over our 512-bit codes (IndexBinaryFlat) -> exact 768-d
//     rescore of the top k' (k' swept), the closest off-the-shelf analogue of our exact-scan regime.
//   faiss:<index_factory string> <params> <unused>: any FAISS index, inner product; <params> is a
//     ';'-separated list of ParameterSpace strings (e.g. "nprobe=8,k_factor=4;nprobe=16,k_factor=4"),
//     one sweep point each. faissl2:<factory> is the same with the L2 metric. Untrained indexes train on up to 262,144 vectors (seeded sample).
// env: THREADS (build threads, default all cores), IDX_CACHE (dir: save/load built faiss indexes),
//      RES (result subdir, default res), STOP_US (stop the sweep above this p50, default 15000),
//      RESCORE_K (exact-rescore depth for usearch_i8_rescore, default 50),
//      CASCADE_R (exact-rescore depth for the binary HNSW cascades, default 150)
#include <faiss/IndexHNSW.h>
#include <faiss/IndexFlat.h>
#include <faiss/IndexBinaryFlat.h>
#include <faiss/index_factory.h>
#include <faiss/AutoTune.h>
#include <random>
#include <sys/stat.h>
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
static constexpr int D = 768, BITS = 512, K10 = 10;
static int env_int(const char* k, int d) { const char* v = getenv(k); return v && *v ? atoi(v) : d; }
static const int THREADS = env_int("THREADS", (int)std::thread::hardware_concurrency());

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
    std::string set = argv[1], out = argv[2], cfg = argv[3], argv4 = argv[4]; int M = atoi(argv[4]), efC = atoi(argv[5]);
    if (cfg.rfind("faiss", 0) == 0 && cfg.find(':') != std::string::npos) M = efC = 0;
    auto X = load_f32(set + "/corpus768.bin"), Q = load_f32(set + "/q768.bin");
    normalize(X); normalize(Q);
    auto GT = load_i32(out + "/gt.bin");
    const std::string RES = getenv("RES") ? getenv("RES") : "res", CACHE = getenv("IDX_CACHE") ? getenv("IDX_CACHE") : "";
    mkdir((out + "/" + RES).c_str(), 0755);
    const double STOP_US = env_int("STOP_US", 15000);
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
    int cascade_k = 1000, cascade_r = env_int("CASCADE_R", 150), rescore_k = env_int("RESCORE_K", 50), cur_ef = 0;
    std::unique_ptr<faiss::Index> fidx; std::unique_ptr<faiss::IndexBinaryFlat> fbf; faiss::ParameterSpace fps;
    std::vector<std::string> fparams; std::string tag_extra;

    // Index cache (IDX_CACHE): every library's graph is built once per (config, M, efC) and reloaded for
    // later rounds, so all timing rounds search the same index. usearch_i8 and usearch_i8_rescore share one.
    auto cpath = [&](const std::string& k) { return CACHE.empty() ? std::string() : CACHE + "/" + k + "_M" + std::to_string(M) + "_efC" + std::to_string(efC) + ".idx"; };
    auto cached = [&](const std::string& p) { struct stat st; if (p.empty() || stat(p.c_str(), &st) != 0) return false; std::ifstream bf(p + ".build_s"); bf >> build_s; fprintf(stderr, "loaded cached %s (build %.1f s)\n", p.c_str(), build_s); return true; };
    auto saved = [&](const std::string& p) { if (!p.empty()) std::ofstream(p + ".build_s") << build_s; };
    auto t0 = clk::now();
    if (cfg == "faiss_flat" || cfg == "faiss_sq8_refine") {
        omp_set_num_threads(THREADS);
        faiss::IndexHNSW* base;
        std::string cp = cpath(cfg == "faiss_flat" ? "faiss_flat" : "faiss_sq8");
        if (cached(cp)) {
            faiss::Index* ix = faiss::read_index(cp.c_str());
            if (cfg == "faiss_flat") { fflat.reset(dynamic_cast<faiss::IndexHNSWFlat*>(ix)); base = fflat.get(); }
            else { fsq.reset(dynamic_cast<faiss::IndexHNSWSQ*>(ix)); base = fsq.get(); }
        } else {
            if (cfg == "faiss_flat") { fflat.reset(new faiss::IndexHNSWFlat(D, M, faiss::METRIC_INNER_PRODUCT)); base = fflat.get(); }
            else { fsq.reset(new faiss::IndexHNSWSQ(D, faiss::ScalarQuantizer::QT_8bit, M, faiss::METRIC_INNER_PRODUCT)); fsq->train(n, X.data()); base = fsq.get(); }
            base->hnsw.efConstruction = efC; base->add(n, X.data());
            build_s = secs(t0);
            if (!cp.empty()) { faiss::write_index(base, cp.c_str()); saved(cp); }
        }
        if (fsq) { fref.reset(new faiss::IndexRefineFlat(fsq.get(), X.data())); fref->k_factor = 4; }
        { faiss::VectorIOWriter w; faiss::write_index(fref ? (faiss::Index*)fref.get() : base, &w); index_bytes = w.data.size(); }
        omp_set_num_threads(1);
        set_ef = [&, base](int ef) { base->hnsw.efSearch = ef; };
        if (fref) query = [&](size_t i, int64_t* top) { float d[K10]; fref->search(1, &Q[i * D], K10, d, top); };
        else query = [&](size_t i, int64_t* top) { float d[K10]; fflat->search(1, &Q[i * D], K10, d, top); };
    } else if (cfg == "faiss_bin_cascade") {
        omp_set_num_threads(THREADS);
        std::string cp = cpath("faiss_bin");
        if (cached(cp)) fbin.reset(dynamic_cast<faiss::IndexBinaryHNSW*>(faiss::read_index_binary(cp.c_str())));
        else {
            fbin.reset(new faiss::IndexBinaryHNSW(BITS, M)); fbin->hnsw.efConstruction = efC; fbin->add(n, C.data());
            build_s = secs(t0);
            if (!cp.empty()) { faiss::write_index_binary(fbin.get(), cp.c_str()); saved(cp); }
        }
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
        std::string cp = cpath("hnswlib");
        if (cached(cp)) hidx.reset(new hnswlib::HierarchicalNSW<float>(hspace.get(), cp, false, n));
        else {
            hidx.reset(new hnswlib::HierarchicalNSW<float>(hspace.get(), n, M, efC));
            hidx->addPoint(&X[0], 0);
            std::atomic<size_t> next{1}; std::vector<std::thread> th;
            for (int t = 0; t < THREADS; t++) th.emplace_back([&] { for (size_t i; (i = next++) < n;) hidx->addPoint(&X[i * D], i); });
            for (auto& t : th) t.join();
            build_s = secs(t0);
            if (!cp.empty()) { hidx->saveIndex(cp); saved(cp); }
        }
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
        uidx = std::move(st.index);
        fprintf(stderr, "usearch isa: %s\n", uidx.metric().isa_name());
        std::string cp = cpath(cfg == "usearch_f16" ? "usearch_f16" : b1 ? "usearch_b1" : "usearch_i8");
        if (cached(cp)) {
            auto lr = uidx.load(cp.c_str()); if (!lr) { fprintf(stderr, "usearch load failed: %s\n", lr.error.what()); return 1; }
            uidx.reserve(index_limits_t(n, THREADS));
        } else {
            uidx.reserve(index_limits_t(n, THREADS));
            // the library's own executor, as the Python binding uses (a plain std::thread pool builds a worse graph)
            executor_default_t{(std::size_t)THREADS}.dynamic(n, [&](std::size_t t, std::size_t i) {
                auto r = b1 ? uidx.add(i, (b1x8_t const*)&C[i * 64], t) : uidx.add(i, &X[i * D], t);
                if (!r) { fprintf(stderr, "add failed\n"); std::exit(1); }
                return true;
            });
            build_s = secs(t0);
            if (!cp.empty()) { auto sr = uidx.save(cp.c_str()); if (!sr) { fprintf(stderr, "usearch save failed\n"); return 1; } saved(cp); }
        }
        index_bytes = uidx.memory_usage();
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
    } else if (cfg == "faiss_exact") {
        fidx.reset(new faiss::IndexFlatIP(D)); fidx->add(n, X.data()); build_s = secs(t0); index_bytes = n * D * 4;
        omp_set_num_threads(1); efs = {0};
        set_ef = [](int) {};
        query = [&](size_t i, int64_t* top) { float d[K10]; fidx->search(1, &Q[i * D], K10, d, top); };
    } else if (cfg == "faiss_binflat_cascade") {
        fbf.reset(new faiss::IndexBinaryFlat(BITS)); fbf->add(n, C.data()); build_s = secs(t0); index_bytes = n * BITS / 8;
        omp_set_num_threads(1); efs = {20, 50, 100, 200, 400, 1000, 2000};
        set_ef = [&](int ef) { cur_ef = ef; };
        query = [&](size_t i, int64_t* top) {
            int k = (int)std::min<size_t>(cur_ef, n); std::vector<int32_t> dd(k); std::vector<int64_t> ids(k);
            fbf->search(1, &CQ[i * 64], k, dd.data(), ids.data());
            rescore(&Q[i * D], ids.data(), k, top);
        };
    } else if (cfg.rfind("faiss:", 0) == 0 || cfg.rfind("faissl2:", 0) == 0) {
        bool l2 = cfg[5] == 'l';  // faissl2: L2 metric (same ranking on unit vectors; HNSW-RaBitQ is L2-only)
        std::string fac = cfg.substr(l2 ? 8 : 6), safe = l2 ? "l2-" : "";
        for (char ch : fac) safe += isalnum((unsigned char)ch) ? ch : '-';
        for (size_t a = 0, b; a <= argv4.size(); a = b + 1) { b = argv4.find(';', a); if (b == std::string::npos) b = argv4.size(); if (b > a) fparams.push_back(argv4.substr(a, b - a)); }
        if (fparams.empty()) fparams.push_back("");
        omp_set_num_threads(THREADS);
        std::string path = CACHE.empty() ? "" : CACHE + "/" + safe + ".faissindex";
        struct stat stt;
        if (!path.empty() && stat(path.c_str(), &stt) == 0) {
            fidx.reset(faiss::read_index(path.c_str()));
            std::ifstream bf(path + ".build_s"); bf >> build_s; index_bytes = stt.st_size;
            fprintf(stderr, "loaded cached %s (build %.1f s)\n", path.c_str(), build_s);
        } else {
            fidx.reset(faiss::index_factory(D, fac.c_str(), l2 ? faiss::METRIC_L2 : faiss::METRIC_INNER_PRODUCT));
            if (!fidx->is_trained) {
                size_t nt = std::min<size_t>(n, 262144); std::vector<size_t> perm(n); std::iota(perm.begin(), perm.end(), 0);
                std::shuffle(perm.begin(), perm.end(), std::mt19937_64(42)); std::vector<float> xt(nt * D);
                for (size_t j = 0; j < nt; j++) memcpy(&xt[j * D], &X[perm[j] * D], D * 4);
                fidx->train(nt, xt.data());
            }
            fidx->add(n, X.data()); build_s = secs(t0);
            if (!path.empty()) { faiss::write_index(fidx.get(), path.c_str()); std::ofstream(path + ".build_s") << build_s; stat(path.c_str(), &stt); index_bytes = stt.st_size; }
            else { faiss::VectorIOWriter w; faiss::write_index(fidx.get(), &w); index_bytes = w.data.size(); }
        }
        omp_set_num_threads(1);
        efs.clear(); for (size_t j = 0; j < fparams.size(); j++) efs.push_back((int)j);
        set_ef = [&](int j) { if (!fparams[j].empty()) fps.set_index_parameters(fidx.get(), fparams[j].c_str()); tag_extra = fparams[j]; };
        query = [&](size_t i, int64_t* top) { float d[K10]; fidx->search(1, &Q[i * D], K10, d, top); };
        cfg = "faiss_" + safe;
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
        std::string pk; for (char ch : tag_extra) pk += isalnum((unsigned char)ch) ? ch : '-';
        if (cfg == "usearch_i8_rescore") pk = "R" + std::to_string(rescore_k);
        if (cfg == "usearch_b1_cascade" || cfg == "faiss_bin_cascade") pk = "R" + std::to_string(cascade_r);
        std::string tag = cfg + "_M" + std::to_string(M) + "_efC" + std::to_string(efC) + "_ef" + (tag_extra.empty() ? std::to_string(ef) : pk) + (tag_extra.empty() && !pk.empty() ? "_" + pk : "");
        { std::ofstream f(out + "/" + RES + "/" + tag + ".ids", std::ios::binary); f.write((char*)res.data(), res.size() * 8); }
        { std::ofstream f(out + "/" + RES + "/" + tag + ".lat", std::ios::binary); f.write((char*)lat.data(), lat.size() * 8); }
        printf("{\"tag\":\"%s\",\"config\":\"%s\",\"M\":%d,\"efC\":%d,\"ef\":%d,\"param\":\"%s\",\"threads\":%d,\"res\":\"%s\",\"build_s\":%.1f,\"index_mb\":%.1f,\"p50_us\":%.1f,\"recall10_vs_exact\":%.4f}\n",
               tag.c_str(), cfg.c_str(), M, efC, ef, (tag_extra.empty() ? pk : tag_extra).c_str(), THREADS, RES.c_str(), build_s, index_bytes / 1048576.0, p50, rec);
        fflush(stdout);
        if (rec >= 0.999 || p50 > STOP_US) break;
    }
    return 0;
}
