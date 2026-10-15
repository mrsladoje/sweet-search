// USearch adapters: f16, i8, i8 + exact float rescore, b1 (Hamming on our 512-bit codes) + exact float rescore.
// `rescore` = how many candidates the index returns before the exact inner-product rescore (0 = none).
#include "common.h"
#include <usearch/index_dense.hpp>
#include <atomic>

namespace paper {
namespace {

using namespace unum::usearch;
enum Kind { F16, I8, I8_RESCORE, B1_RESCORE };

class UsearchAdapter : public Adapter {
    Kind kind_;
    Corpus c_;
    index_dense_t idx_;
    long rescore_ = 0, ef_ = 0;
    std::vector<uint64_t> keys_;
    std::vector<float> dists_;
    std::vector<int64_t> cand_;
    std::vector<std::pair<float, int64_t>> tmp_;

    bool b1() const { return kind_ == B1_RESCORE; }
    static std::string path(const std::string& dir) { return dir + "/index.usearch"; }
    index_dense_t make_index(size_t d, size_t M, size_t efC) const {
        scalar_kind_t sk = kind_ == F16 ? scalar_kind_t::f16_k : b1() ? scalar_kind_t::b1x8_k : scalar_kind_t::i8_k;
        metric_punned_t metric(b1() ? 512 : d, b1() ? metric_kind_t::hamming_k : metric_kind_t::cos_k, sk);
        auto st = index_dense_t::make(metric, index_dense_config_t(M, efC, 64));
        if (!st) die(std::string("usearch make failed: ") + st.error.what());
        return std::move(st.index);
    }

public:
    explicit UsearchAdapter(Kind k) : kind_(k) {}

    void build(const Corpus& c, const Params& p, int threads, uint64_t, const std::string& dir) override {
        if (b1() && !c.codes) die("b1 index needs Corpus::codes");
        auto idx = make_index(c.d, param_i(p, "M", 16), param_i(p, "efC", 200));
        idx.reserve(index_limits_t(c.n, threads));
        // the library's own executor, as its Python binding uses (a plain std::thread pool builds a worse graph)
        std::atomic<bool> ok{true};
        executor_default_t{(std::size_t)threads}.dynamic(c.n, [&](std::size_t t, std::size_t i) {
            auto r = b1() ? idx.add(i, (b1x8_t const*)(c.codes + i * 64), t) : idx.add(i, c.x + i * c.d, t);
            if (!r) ok = false;
            return ok.load();
        });
        if (!ok) die("usearch add failed");
        auto sr = idx.save(path(dir).c_str()); if (!sr) die(std::string("usearch save failed: ") + sr.error.what());
    }
    void load(const std::string& dir, const Corpus& c, const Params& bp) override {
        c_ = c; need(path(dir));
        idx_ = make_index(c.d, param_i(bp, "M", 16), param_i(bp, "efC", 200));
        auto lr = idx_.load(path(dir).c_str()); if (!lr) die(std::string("usearch load failed: ") + lr.error.what());
        idx_.reserve(index_limits_t(c.n, 1));
        if (ef_) idx_.change_expansion_search(ef_);
    }
    bool keeps_originals() const override { return rescore_ > 0; }
    void set_search(const Params& p) override {
        ef_ = param_i(p, "ef", ef_); rescore_ = param_i(p, "rescore", rescore_);
        if (ef_) idx_.change_expansion_search(ef_);
    }
    size_t search(const float* q, const uint8_t* qcode, size_t k, int64_t* ids, float* scores) override {
        size_t kk = std::max<size_t>(k, rescore_);
        if (keys_.size() < kk) { keys_.resize(kk); dists_.resize(kk); cand_.resize(kk); }
        auto r = b1() ? idx_.search((b1x8_t const*)qcode, kk, 0) : idx_.search(q, kk, 0);
        size_t got = r.dump_to(keys_.data(), dists_.data());
        if (rescore_ > 0) {
            for (size_t i = 0; i < got; i++) cand_[i] = (int64_t)keys_[i];
            return rescore_ip(c_, q, cand_.data(), got, k, tmp_, ids, scores);
        }
        got = std::min(got, k);
        for (size_t i = 0; i < got; i++) { ids[i] = (int64_t)keys_[i]; scores[i] = b1() ? -dists_[i] : 1.0f - dists_[i]; }  // cosine distance -> cosine
        return got;
    }
    std::vector<std::string> files(const std::string& dir) const override { return {path(dir)}; }
    std::map<std::string, std::string> info() const override {
        return {{"library", "usearch"}, {"version", "2.26.4"}, {"commit", PAPER_USEARCH_COMMIT},
                {"simd", idx_.metric().isa_name()}, {"simd_note", "NumKong dynamic dispatch"}};
    }
};

template <Kind K> std::unique_ptr<Adapter> make() { return std::make_unique<UsearchAdapter>(K); }
Register r1("usearch_f16", make<F16>), r2("usearch_i8", make<I8>), r3("usearch_i8_rescore", make<I8_RESCORE>), r4("usearch_b1_rescore", make<B1_RESCORE>);

}  // namespace
}  // namespace paper
