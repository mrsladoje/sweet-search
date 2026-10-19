// FAISS adapters: HNSW flat / SQ8, binary HNSW / flat, RaBitQ flat / IVF / HNSW, IVF-PQ fast-scan, exact.
// Refine is done here against the caller's float32 originals (no second copy of the vectors is kept):
// float indexes: base search for k * `refine` (= k_factor_rf), then exact inner product;
// binary indexes: Hamming search for max(k, `refine`), exact inner product of those.
#include "common.h"
#include <faiss/AutoTune.h>
#include <faiss/IndexBinaryFlat.h>
#include <faiss/IndexBinaryHNSW.h>
#include <faiss/IndexFlat.h>
#include <faiss/IndexHNSW.h>
#include <faiss/index_factory.h>
#include <faiss/index_io.h>
#include <faiss/utils/simd_levels.h>
#include <omp.h>
#include <numeric>
#include <random>

namespace paper {
namespace {

enum Kind { HNSW_FLAT, HNSW_SQ8, BIN_HNSW, BIN_FLAT, RABITQ_FLAT, RABITQ_IVF, RABITQ_HNSW, IVFPQ_FS, EXACT };

class FaissAdapter : public Adapter {
    Kind kind_;
    Corpus c_;
    std::unique_ptr<faiss::Index> idx_;
    std::unique_ptr<faiss::IndexBinary> bin_;
    long refine_ = 0, ef_ = 0, nprobe_ = 0;
    std::vector<float> dist_;
    std::vector<int32_t> hd_;
    std::vector<int64_t> lab_;
    std::vector<std::pair<float, int64_t>> tmp_;

    bool binary() const { return kind_ == BIN_HNSW || kind_ == BIN_FLAT; }
    std::string path(const std::string& dir) const { return dir + (binary() ? "/index.faissb" : "/index.faiss"); }
    std::string factory(const Params& p) const {
        std::string nl = std::to_string(param_i(p, "nlist", 0));
        switch (kind_) {
            case RABITQ_FLAT: return "RaBitQ";
            case RABITQ_IVF: return "IVF" + nl + ",RaBitQ";
            case RABITQ_HNSW: return "HNSW" + std::to_string(param_i(p, "M", 32)) + "_RaBitQ";
            case IVFPQ_FS: return "IVF" + nl + ",PQ192x4fs";
            default: return "";
        }
    }
    void apply() {
        omp_set_num_threads(1);
        faiss::ParameterSpace ps;
        if (idx_ && (kind_ == HNSW_FLAT || kind_ == HNSW_SQ8 || kind_ == RABITQ_HNSW) && ef_) ps.set_index_parameter(idx_.get(), "efSearch", (double)ef_);
        if (idx_ && (kind_ == RABITQ_IVF || kind_ == IVFPQ_FS) && nprobe_) ps.set_index_parameter(idx_.get(), "nprobe", (double)nprobe_);
        if (bin_ && kind_ == BIN_HNSW && ef_) dynamic_cast<faiss::IndexBinaryHNSW*>(bin_.get())->hnsw.efSearch = (int)ef_;
    }

public:
    explicit FaissAdapter(Kind k) : kind_(k) {}

    void build(const Corpus& c, const Params& p, int threads, uint64_t seed, const std::string& dir) override {
        omp_set_num_threads(threads);
        long M = param_i(p, "M", 32), efC = param_i(p, "efC", 200);
        if (binary()) {
            if (!c.codes) die("binary index needs Corpus::codes");
            std::unique_ptr<faiss::IndexBinary> b;
            if (kind_ == BIN_HNSW) {
                auto h = new faiss::IndexBinaryHNSW(512, (int)M); h->hnsw.efConstruction = (int)efC; b.reset(h);
            } else b.reset(new faiss::IndexBinaryFlat(512));
            b->add(c.n, c.codes);
            faiss::write_index_binary(b.get(), path(dir).c_str());
        } else {
            std::unique_ptr<faiss::Index> ix;
            switch (kind_) {
                case HNSW_FLAT: { auto h = new faiss::IndexHNSWFlat(c.d, (int)M, faiss::METRIC_INNER_PRODUCT); h->hnsw.efConstruction = (int)efC; ix.reset(h); break; }
                case HNSW_SQ8: { auto h = new faiss::IndexHNSWSQ(c.d, faiss::ScalarQuantizer::QT_8bit, (int)M, faiss::METRIC_INNER_PRODUCT); h->hnsw.efConstruction = (int)efC; h->train(c.n, c.x); ix.reset(h); break; }
                case EXACT: ix.reset(new faiss::IndexFlatIP(c.d)); break;
                default: {
                    ix.reset(faiss::index_factory(c.d, factory(p).c_str(), kind_ == RABITQ_HNSW ? faiss::METRIC_L2 : faiss::METRIC_INNER_PRODUCT));
                    if (auto h = dynamic_cast<faiss::IndexHNSW*>(ix.get())) h->hnsw.efConstruction = (int)efC;
                    if (!ix->is_trained) {  // seeded subsample of up to 262,144 vectors
                        size_t nt = std::min<size_t>(c.n, 262144); std::vector<size_t> perm(c.n); std::iota(perm.begin(), perm.end(), 0);
                        std::shuffle(perm.begin(), perm.end(), std::mt19937_64(seed)); std::vector<float> xt(nt * c.d);
                        for (size_t j = 0; j < nt; j++) memcpy(&xt[j * c.d], c.x + perm[j] * c.d, c.d * 4);
                        ix->train(nt, xt.data());
                    }
                }
            }
            ix->add(c.n, c.x);
            faiss::write_index(ix.get(), path(dir).c_str());
        }
        omp_set_num_threads(1);
    }

    void load(const std::string& dir, const Corpus& c, const Params&) override {
        omp_set_num_threads(1);
        c_ = c; need(path(dir));
        if (binary()) bin_.reset(faiss::read_index_binary(path(dir).c_str())); else idx_.reset(faiss::read_index(path(dir).c_str()));
        apply();
    }
    bool keeps_originals() const override { return refine_ > 0; }

    void set_search(const Params& p) override {
        ef_ = param_i(p, "ef", ef_); nprobe_ = param_i(p, "nprobe", nprobe_); refine_ = param_i(p, "refine", refine_);
        // post hoc mechanism check: FAISS's counting top-k for the binary flat scan (default: binary heap)
        if (auto f = dynamic_cast<faiss::IndexBinaryFlat*>(bin_.get())) f->use_heap = param_i(p, "use_heap", 1) != 0;
        apply();
    }

    size_t search(const float* q, const uint8_t* qcode, size_t k, int64_t* ids, float* scores) override {
        if (binary()) {
            size_t kk = std::max<size_t>(k, refine_);
            if (lab_.size() < kk) { lab_.resize(kk); hd_.resize(kk); }
            bin_->search(1, qcode, kk, hd_.data(), lab_.data());
            if (refine_ > 0) return rescore_ip(c_, q, lab_.data(), kk, k, tmp_, ids, scores);
            size_t m = 0;
            for (size_t i = 0; i < kk && m < k; i++) if (lab_[i] >= 0) { ids[m] = lab_[i]; scores[m++] = -(float)hd_[i]; }
            return m;
        }
        size_t kk = refine_ > 0 ? k * refine_ : k;
        if (lab_.size() < kk) { lab_.resize(kk); dist_.resize(kk); }
        idx_->search(1, q, kk, dist_.data(), lab_.data());
        if (refine_ > 0) return rescore_ip(c_, q, lab_.data(), kk, k, tmp_, ids, scores);
        bool l2 = idx_->metric_type == faiss::METRIC_L2; size_t m = 0;
        for (size_t i = 0; i < kk && m < k; i++) if (lab_[i] >= 0) { ids[m] = lab_[i]; scores[m++] = l2 ? -dist_[i] : dist_[i]; }
        return m;
    }

    std::vector<std::string> files(const std::string& dir) const override { return {path(dir)}; }
    std::map<std::string, std::string> info() const override {
        return {{"library", "faiss"}, {"version", VERSION_STRING}, {"commit", PAPER_FAISS_COMMIT},
                {"simd", faiss::SIMDConfig::get_level_name()}, {"dynamic_dispatch", faiss::SIMDConfig::has_dynamic_dispatch() ? "yes" : "no"}};
    }
};

template <Kind K> std::unique_ptr<Adapter> make() { return std::make_unique<FaissAdapter>(K); }
Register r1("faiss_hnsw_flat", make<HNSW_FLAT>), r2("faiss_hnsw_sq8", make<HNSW_SQ8>), r3("faiss_bin_hnsw", make<BIN_HNSW>),
         r4("faiss_bin_flat", make<BIN_FLAT>), r5("faiss_rabitq_flat", make<RABITQ_FLAT>), r6("faiss_rabitq_ivf", make<RABITQ_IVF>),
         r7("faiss_rabitq_hnsw", make<RABITQ_HNSW>), r8("faiss_ivfpq_fs", make<IVFPQ_FS>), r9("faiss_exact", make<EXACT>);

}  // namespace
}  // namespace paper
