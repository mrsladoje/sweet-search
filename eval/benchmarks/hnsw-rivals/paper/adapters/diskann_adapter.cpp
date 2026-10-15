// DiskANN adapter: official Microsoft C++ in-memory Vamana (branch cpp_main, pinned in build-new.sh), float32.
// Metric: INNER_PRODUCT on the unit vectors (same order as L2 and cosine there). DiskANN returns the dot
// product itself as the distance for this metric, so the score is used as given (higher = better).
// Build: params R (degree), L (build list), alpha; threads via IndexWriteParameters + OpenMP. The data go
// to DiskANN's .bin file inside `dir` and are deleted after the save. Serving files: <prefix>, <prefix>.data.
// Seed: DiskANN draws no random numbers in the plain build; `seed` only seeds rand(). A multi-threaded
// build is not bit-reproducible (insertion order races).
#include "../adapter.h"

#include <omp.h>

#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <stdexcept>
#include <sys/stat.h>

#include "index.h"
#include "index_factory.h"

namespace paper {
namespace {

struct DiskannAdapter : Adapter {
    std::shared_ptr<diskann::AbstractIndex> index;
    uint32_t L = 100;
    int d = 768;

    static std::string prefix(const std::string& dir) { return dir + "/vamana"; }

    static diskann::IndexConfig config(int dim, size_t max_points, diskann::IndexWriteParameters* wp) {
        diskann::IndexConfigBuilder b;
        b.with_metric(diskann::Metric::INNER_PRODUCT).with_dimension(dim).with_max_points(max_points)
            .with_data_load_store_strategy(diskann::DataStoreStrategy::MEMORY)
            .with_graph_load_store_strategy(diskann::GraphStoreStrategy::MEMORY)
            .with_data_type("float").with_label_type("uint").with_tag_type("uint32")
            .is_dynamic_index(false).is_enable_tags(false).is_concurrent_consolidate(false)
            .is_pq_dist_build(false).is_use_opq(false).with_num_pq_chunks(0).with_num_frozen_pts(0);
        if (wp) b.with_index_write_params(*wp);
        return b.build();
    }

    void build(const Corpus& c, const Params& p, int threads, uint64_t seed, const std::string& dir) override {
        srand((unsigned)seed);
        omp_set_num_threads(threads);
        std::string data = dir + "/data.bin", pre = prefix(dir);
        {
            std::ofstream f(data, std::ios::binary);
            uint32_t hdr[2] = {(uint32_t)c.n, (uint32_t)c.d};
            f.write((const char*)hdr, 8);
            f.write((const char*)c.x, (std::streamsize)(c.n * c.d * sizeof(float)));
            if (!f) throw std::runtime_error("diskann: cannot write " + data);
        }
        auto wp = diskann::IndexWriteParametersBuilder((uint32_t)param_i(p, "L", 100), (uint32_t)param_i(p, "R", 64))
                      .with_alpha(std::stof(param(p, "alpha", "1.2"))).with_saturate_graph(false)
                      .with_num_threads((uint32_t)threads).build();
        auto fp = diskann::IndexFilterParamsBuilder().with_save_path_prefix(pre).build();
        auto idx = diskann::IndexFactory(config(c.d, c.n, &wp)).create_instance();
        idx->build(data, c.n, fp);
        idx->save(pre.c_str());
        idx.reset();
        remove(data.c_str());
    }

    void load(const std::string& dir, const Corpus& c, const Params&) override {
        d = c.d;
        omp_set_num_threads(1);  // single-query serving; the harness thread count is 1
        index = diskann::IndexFactory(config(c.d, 0, nullptr)).create_instance();
        index->load(prefix(dir).c_str(), 1, 4000);
    }

    void set_search(const Params& p) override { L = (uint32_t)param_i(p, "L", 100); }

    size_t search(const float* q, const uint8_t*, size_t k, int64_t* ids, float* scores) override {
        std::vector<uint32_t> id(k, UINT32_MAX);  // search() returns (hops, cmps), not a count
        index->search(q, k, std::max<uint32_t>(L, (uint32_t)k), id.data(), scores);
        size_t m = 0;
        while (m < k && id[m] != UINT32_MAX) { ids[m] = id[m]; m++; }
        return m;
    }

    std::vector<std::string> files(const std::string& dir) const override {
        return {prefix(dir), prefix(dir) + ".data"};
    }

    std::map<std::string, std::string> info() const override {
#ifdef DISKANN_COMMIT
        const char* commit = DISKANN_COMMIT;
#else
        const char* commit = "unknown";
#endif
        return {{"library", "DiskANN (microsoft, cpp_main)"}, {"commit", commit},
                {"simd", "AVX2 (hard-coded -mavx2 -mfma; -march=native for the rest)"},
                {"metric", "inner_product on unit vectors"}};
    }
};

Register r("diskann_vamana", [] { return std::unique_ptr<Adapter>(new DiskannAdapter()); });

}  // namespace
}  // namespace paper
