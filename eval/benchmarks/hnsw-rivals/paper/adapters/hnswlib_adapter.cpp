// hnswlib adapter: HNSW f32, inner product. Compiled on its own with -ffast-math -ftree-vectorize
// (the flags of hnswlib's CMakeLists; without them its distance loops stay scalar on ARM).
#include "common.h"
#include "hnswlib/hnswlib.h"
#include <atomic>
#include <thread>

namespace paper {
namespace {

class HnswlibAdapter : public Adapter {
    Corpus c_;
    std::unique_ptr<hnswlib::InnerProductSpace> space_;
    std::unique_ptr<hnswlib::HierarchicalNSW<float>> idx_;
    long ef_ = 64;
    static std::string path(const std::string& dir) { return dir + "/index.hnsw"; }

public:
    void build(const Corpus& c, const Params& p, int threads, uint64_t seed, const std::string& dir) override {
        hnswlib::InnerProductSpace space(c.d);
        hnswlib::HierarchicalNSW<float> idx(&space, c.n, param_i(p, "M", 16), param_i(p, "efC", 200), seed);
        idx.addPoint(c.x, 0);
        std::atomic<size_t> next{1}; std::vector<std::thread> th;
        for (int t = 0; t < threads; t++) th.emplace_back([&] { for (size_t i; (i = next++) < c.n;) idx.addPoint(c.x + i * c.d, i); });
        for (auto& t : th) t.join();
        idx.saveIndex(path(dir));
    }
    void load(const std::string& dir, const Corpus& c, const Params&) override {
        c_ = c; need(path(dir));
        space_.reset(new hnswlib::InnerProductSpace(c.d));
        idx_.reset(new hnswlib::HierarchicalNSW<float>(space_.get(), path(dir), false, c.n));
        idx_->setEf(ef_);
    }
    void set_search(const Params& p) override { ef_ = param_i(p, "ef", ef_); if (idx_) idx_->setEf(ef_); }
    size_t search(const float* q, const uint8_t*, size_t k, int64_t* ids, float* scores) override {
        auto pq = idx_->searchKnn(q, k); size_t m = pq.size(), n = m;
        while (!pq.empty()) { --m; ids[m] = (int64_t)pq.top().second; scores[m] = 1.0f - pq.top().first; pq.pop(); }  // 1 - dist = inner product
        return n;
    }
    std::vector<std::string> files(const std::string& dir) const override { return {path(dir)}; }
    std::map<std::string, std::string> info() const override {
        const char* simd =
#if defined(USE_AVX512)
            "avx512 (cpuid-gated, else avx)";
#elif defined(USE_AVX)
            "avx (cpuid-gated, else sse)";
#elif defined(USE_SSE)
            "sse";
#else
            "compiler auto-vectorisation (-ffast-math -ftree-vectorize)";
#endif
        return {{"library", "hnswlib"}, {"version", "unversioned"}, {"commit", PAPER_HNSWLIB_COMMIT}, {"simd", simd}};
    }
};

Register r1("hnswlib_f32", [] { return std::unique_ptr<Adapter>(new HnswlibAdapter); });

}  // namespace
}  // namespace paper
