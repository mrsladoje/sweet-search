// Intel SVS adapter: Vamana graph + float32 / LVQ / LeanVec storage through the C++ runtime API
// (svs/runtime/vamana_index.h) of the pinned binary package (libsvs_runtime.so 0.4.0, Intel Simplified
// Software License; the LVQ / LeanVec parts are closed source and run on Intel CPUs only, the library itself
// exits the process on other vendors, so the adapter checks the vendor first and throws instead).
// Families: svs_vamana_f32 (FP32, runs everywhere x86), svs_vamana_lvq (LVQ4x8 by default),
// svs_vamana_leanvec (LeanVec4x8, leanvec_dims 192 by default). Metric: INNER_PRODUCT on unit vectors.
// Build params: degree, window, alpha (default 0.95: SVS rejects alpha > 1 for inner product), prune_to, storage, leanvec_dims.
// Search params: window, capacity (default = window). Threads: OpenMP (the runtime uses omp_get_max_threads).
// Seed: SVS draws no random numbers in the Vamana build; `seed` is unused (recorded as such).
// Load: stream into memory by default; build param/`map=1` memory-maps the index file instead.
#include "../adapter.h"

#include <omp.h>

#include <fstream>
#include <limits>
#include <stdexcept>

#include "svs/cpuid.h"
#include "svs/runtime/vamana_index.h"

namespace paper {
namespace {

namespace rt = svs::runtime;

static void check(const rt::Status& s, const char* what) {
    if (!s.ok()) throw std::runtime_error(std::string("svs ") + what + ": " + s.message());
}

static rt::StorageKind storage_of(const std::string& s) {
    static const std::map<std::string, rt::StorageKind> m = {
        {"FP32", rt::StorageKind::FP32}, {"FP16", rt::StorageKind::FP16}, {"SQI8", rt::StorageKind::SQI8},
        {"LVQ4x0", rt::StorageKind::LVQ4x0}, {"LVQ8x0", rt::StorageKind::LVQ8x0},
        {"LVQ4x4", rt::StorageKind::LVQ4x4}, {"LVQ4x8", rt::StorageKind::LVQ4x8},
        {"LeanVec4x4", rt::StorageKind::LeanVec4x4}, {"LeanVec4x8", rt::StorageKind::LeanVec4x8},
        {"LeanVec8x8", rt::StorageKind::LeanVec8x8}};
    auto it = m.find(s);
    if (it == m.end()) throw std::runtime_error("svs: unknown storage " + s);
    return it->second;
}

struct SvsAdapter : Adapter {
    std::string def_storage;  // "FP32" | "LVQ4x8" | "LeanVec4x8"
    std::string family;
    rt::VamanaIndex* index = nullptr;
    rt::VamanaIndex::SearchParams sp;
    std::string storage;
    explicit SvsAdapter(std::string fam, std::string st) : def_storage(std::move(st)), family(std::move(fam)) {}
    ~SvsAdapter() override { if (index) rt::VamanaIndex::destroy(index); }

    bool compressed() const { return def_storage != "FP32"; }
    static std::string file(const std::string& dir) { return dir + "/svs.idx"; }

    void need_intel() const {
        if (compressed() && !svs::detail::lvq_leanvec_enabled())
            throw std::runtime_error(family + ": LVQ / LeanVec run on Intel CPUs only (awaiting platform: intel)");
    }

    void build(const Corpus& c, const Params& p, int threads, uint64_t, const std::string& dir) override {
        need_intel();
        omp_set_num_threads(threads);
        storage = param(p, "storage", def_storage);
        rt::VamanaIndex::BuildParams bp;
        bp.graph_max_degree = (size_t)param_i(p, "degree", 64);
        bp.construction_window_size = (size_t)param_i(p, "window", 200);
        bp.alpha = std::stof(param(p, "alpha", "0.95"));  // SVS requires alpha <= 1 for inner product
        if (p.count("prune_to")) bp.prune_to = (size_t)param_i(p, "prune_to", 0);
        if (p.count("max_candidate_pool")) bp.max_candidate_pool_size = (size_t)param_i(p, "max_candidate_pool", 0);
        rt::VamanaIndex* idx = nullptr;
        auto kind = storage_of(storage);
        if (def_storage.rfind("LeanVec", 0) == 0)
            check(rt::VamanaIndexLeanVec::build(&idx, c.d, rt::MetricType::INNER_PRODUCT, kind,
                                                (size_t)param_i(p, "leanvec_dims", c.d / 4), bp), "build");
        else
            check(rt::VamanaIndex::build(&idx, c.d, rt::MetricType::INNER_PRODUCT, kind, bp), "build");
        check(idx->add(c.n, c.x), "add");
        std::ofstream out(file(dir), std::ios::binary);
        check(idx->save(out), "save");
        out.close();
        if (!out) throw std::runtime_error("svs: cannot write " + file(dir));
        rt::VamanaIndex::destroy(idx);
    }

    void load(const std::string& dir, const Corpus&, const Params& bp) override {
        need_intel();
        omp_set_num_threads(1);
        storage = param(bp, "storage", def_storage);
        auto kind = storage_of(storage);
        if (param_i(bp, "map", 0)) {
            check(rt::VamanaIndex::map_to_file(&index, file(dir).c_str(), rt::MetricType::INNER_PRODUCT, kind), "map");
        } else {
            std::ifstream in(file(dir), std::ios::binary);
            if (!in) throw std::runtime_error("svs: cannot read " + file(dir));
            check(rt::VamanaIndex::load(&index, in, rt::MetricType::INNER_PRODUCT, kind), "load");
        }
    }

    void set_search(const Params& p) override {
        sp = rt::VamanaIndex::SearchParams{};
        sp.search_window_size = (size_t)param_i(p, "window", 100);
        sp.search_buffer_capacity = (size_t)param_i(p, "capacity", (long)sp.search_window_size);
    }

    size_t search(const float* q, const uint8_t*, size_t k, int64_t* ids, float* scores) override {
        std::vector<size_t> lab(k, std::numeric_limits<size_t>::max());
        rt::VamanaIndex::SearchParams s = sp;
        if (s.search_window_size < k) s.search_window_size = k;
        if (s.search_buffer_capacity < s.search_window_size) s.search_buffer_capacity = s.search_window_size;
        check(index->search(1, q, k, scores, lab.data(), &s), "search");
        size_t m = 0;
        for (size_t i = 0; i < k; i++) {
            if (lab[i] == std::numeric_limits<size_t>::max()) continue;
            ids[m] = (int64_t)lab[i];
            scores[m++] = scores[i];
        }
        return m;
    }

    std::vector<std::string> files(const std::string& dir) const override { return {file(dir)}; }

    std::map<std::string, std::string> info() const override {
        return {{"library", "Intel SVS runtime bindings"}, {"version", SVS_RUNTIME_VERSION_STRING},
                {"storage", storage.empty() ? def_storage : storage},
                {"intel_cpu", svs::detail::intel_enabled() ? "yes" : "no"},
                {"simd", "runtime dispatch inside libsvs_runtime (AVX2 / AVX-512 by CPU)"},
                {"metric", "inner_product on unit vectors"}};
    }
};

Register r_f32("svs_vamana_f32", [] { return std::unique_ptr<Adapter>(new SvsAdapter("svs_vamana_f32", "FP32")); });
Register r_lvq("svs_vamana_lvq", [] { return std::unique_ptr<Adapter>(new SvsAdapter("svs_vamana_lvq", "LVQ4x8")); });
Register r_lv("svs_vamana_leanvec", [] { return std::unique_ptr<Adapter>(new SvsAdapter("svs_vamana_leanvec", "LeanVec4x8")); });

}  // namespace
}  // namespace paper
