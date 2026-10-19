// Helpers shared by the adapter sources (header only).
#pragma once
#include "../adapter.h"
#include "../shared_rescore.h"
#include <faiss/utils/distances.h>
#include <sys/stat.h>
#include <algorithm>
#include <cstdio>
#include <stdexcept>
#include <string>
#include <vector>

#ifndef PAPER_FAISS_COMMIT
#define PAPER_FAISS_COMMIT "unpinned"
#endif
#ifndef PAPER_USEARCH_COMMIT
#define PAPER_USEARCH_COMMIT "unpinned"
#endif
#ifndef PAPER_HNSWLIB_COMMIT
#define PAPER_HNSWLIB_COMMIT "unpinned"
#endif

namespace paper {

[[noreturn]] inline void die(const std::string& m) { throw std::runtime_error(m); }
inline bool exists(const std::string& p) { struct stat st; return stat(p.c_str(), &st) == 0; }
inline void need(const std::string& p) { if (!exists(p)) die("missing file " + p); }

// Exact float32 inner-product rescoring of candidate ids (negative ids skipped): keeps the best k,
// best first, scores = inner product. Returns how many were written.
inline size_t rescore_ip(const Corpus& c, const float* q, const int64_t* cand, size_t nc, size_t k,
                         std::vector<std::pair<float, int64_t>>& tmp, int64_t* ids, float* scores) {
    tmp.clear();
    if (c.x16) {  // post hoc: float16 refine (rows widened exactly to f32, then the same inner product)
        thread_local std::vector<float> w(c.d);
        for (size_t i = 0; i < nc; i++)
            if (cand[i] >= 0) {
                f16_widen(c.x16 + (size_t)cand[i] * c.d, w.data(), c.d);
                tmp.push_back({faiss::fvec_inner_product(q, w.data(), c.d), cand[i]});
            }
    } else
    for (size_t i = 0; i < nc; i++)
        if (cand[i] >= 0) tmp.push_back({faiss::fvec_inner_product(q, c.x + (size_t)cand[i] * c.d, c.d), cand[i]});
    size_t m = std::min(k, tmp.size());
    std::partial_sort(tmp.begin(), tmp.begin() + m, tmp.end(), [](const auto& a, const auto& b) { return a.first > b.first; });
    for (size_t i = 0; i < m; i++) { ids[i] = tmp[i].second; scores[i] = tmp[i].first; }
    return m;
}

}  // namespace paper
