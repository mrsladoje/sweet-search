// The shared (A) path of DESIGN.md 5.2: query conversion, int8 screen, full-vector rescoring.
// A C++ copy of the product's steps, which must give bit-identical lists (check_bitident.py):
//   query  truncateForHNSW + floatToBinary + normalizedFloatToInt8 (core/infrastructure/quantization.js)
//   screen HnswSearcher::cascade_int8 (crates/sweet-search-native/src/hnsw_search.rs): exact i32 dots,
//          stable descending sort (ties keep generator order)
//   full   HnswSearcher::cascade_full + FullVectorFile::dots: f16 -> f32 (exact), one sequential f64
//          sum per row, min-max normalisation, stable descending sort (ties keep int8 order)
// Compile this file WITHOUT -ffast-math (the f64 sums must stay sequential and unfused-equivalent:
// products of f32 values are exact in f64, so FMA contraction cannot change a result).
#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <numeric>
#include <vector>

namespace paper {

static constexpr int FULL_D = 768, CODE_D = 512, CODE_BYTES = CODE_D / 8;  // defaults; K4 allows 768 for both

// f16 bits -> f32, exact for every value (rescore.rs f16_bits_to_f32).
inline float f16_to_f32(uint16_t h) {
    uint32_t s = uint32_t(h & 0x8000) << 16, e = (h >> 10) & 0x1f, m = h & 0x3ff, u;
    if (e == 0) {
        if (m == 0) u = s;
        else {  // subnormal: normalise
            int k = 0;
            while (!(m & 0x400)) { m <<= 1; k++; }
            m &= 0x3ff;
            u = s | uint32_t(127 - 15 - k + 1) << 23 | m << 13;
        }
    } else if (e == 31) u = s | 0x7f800000u | m << 13;
    else u = s | (e + 127 - 15) << 23 | m << 13;
    float f; std::memcpy(&f, &u, 4); return f;
}

struct Query {
    float full[FULL_D];        // the f32 query, used as f64 in the full rescoring
    double full64[FULL_D];
    uint8_t code[FULL_D / 8];  // sign bits of the renormalised code-width prefix, MSB first
    int8_t q8[FULL_D];         // int8 of the renormalised int8-width prefix
};

// truncateForHNSW(q, w) (JS: f64 sum of f32 squares, sqrt, each value divided in f64 and stored as f32).
inline void truncate(const float* q, int w, float* t) {
    double n = 0;
    for (int i = 0; i < w; i++) n += (double)q[i] * (double)q[i];
    n = std::sqrt(n);
    for (int i = 0; i < w; i++) t[i] = n > 0 ? (float)((double)q[i] / n) : q[i];
}

// The query steps of DESIGN.md 5.2 with the index's code width `code_d` and int8 width `w8`:
// floatToBinary(truncate(q, code_d)) (bit = value > 0) and normalizedFloatToInt8(truncate(q, w8))
// (Math.round(clamp(x, -1, 1) * 127) = floor(x + 0.5), exact for these values).
inline void convert_query(const float* q, Query& out, int code_d = CODE_D, int w8 = CODE_D) {
    float t[FULL_D];
    std::memcpy(out.full, q, sizeof(out.full));
    for (int i = 0; i < FULL_D; i++) out.full64[i] = (double)q[i];
    truncate(q, code_d, t);
    std::memset(out.code, 0, sizeof(out.code));
    for (int i = 0; i < code_d; i++) if (t[i] > 0) out.code[i >> 3] |= uint8_t(0x80 >> (i & 7));
    if (w8 != code_d) truncate(q, w8, t);
    for (int i = 0; i < w8; i++) {
        double c = std::max(-1.0, std::min(1.0, (double)t[i]));
        out.q8[i] = (int8_t)std::floor(c * 127.0 + 0.5);
    }
}

inline int32_t int8_dot(const int8_t* a, const int8_t* b, int w) {
    int32_t s = 0;
    for (int i = 0; i < w; i++) s += int32_t(a[i]) * int32_t(b[i]);
    return s;
}

// One sequential f64 sum per row, i = 0..767 (FullVectorFile::dots).
inline double full_dot(const double* q, const uint16_t* row) {
    double d = 0;
    for (int i = 0; i < FULL_D; i++) d += q[i] * (double)f16_to_f32(row[i]);
    return d;
}

struct Shared {
    const int8_t* int8 = nullptr;   // n x w8
    int w8 = CODE_D;
    const uint16_t* f16 = nullptr;  // n x 768
    // scratch
    std::vector<uint64_t> keys;
    std::vector<int64_t> scr_ids;
    std::vector<double> full, norm;
    std::vector<uint32_t> order;

    // cand[0..nc) in generator order (-1 = empty slot, skipped). Keeps H by int8 (H >= nc: no screen),
    // orders them by the full vectors, writes up to H (vid, full score) to out_ids/out_scores.
    size_t run(const Query& q, const int64_t* cand, size_t nc, size_t H, int64_t* out_ids, double* out_scores) {
        scr_ids.clear();
        for (size_t i = 0; i < nc; i++) if (cand[i] >= 0) scr_ids.push_back(cand[i]);
        size_t m = scr_ids.size();
        // int8 screen: key = (INT32_MAX - dot) << 32 | position, unstable sort = stable descending
        keys.resize(m);
        for (size_t i = 0; i < m; i++) {
            int32_t dot = int8_dot(q.q8, int8 + scr_ids[i] * w8, w8);
            keys[i] = uint64_t(int64_t(INT32_MAX) - int64_t(dot)) << 32 | uint64_t(i);
        }
        // H >= C (no screen) still sorts: the full stage breaks its ties in int8 order, as ours does.
        size_t h = std::min(H, m);
        std::sort(keys.begin(), keys.end());
        // full rescoring of the first h in int8 order (cascade_full)
        full.resize(h); norm.resize(h); order.resize(h);
        double mn = INFINITY, mx = -INFINITY;
        for (size_t j = 0; j < h; j++) {
            int64_t vid = scr_ids[keys[j] & 0xffffffffu];
            full[j] = full_dot(q.full64, f16 + vid * FULL_D);
            mn = std::min(mn, full[j]); mx = std::max(mx, full[j]);
        }
        for (size_t j = 0; j < h; j++) {
            norm[j] = !(mx > mn) ? 0.5 : std::max(0.0, std::min(1.0, (full[j] - mn) / (mx - mn)));
            order[j] = (uint32_t)j;
        }
        if (h >= 3)
            std::stable_sort(order.begin(), order.end(), [&](uint32_t a, uint32_t b) { return norm[a] > norm[b]; });
        for (size_t j = 0; j < h; j++) {
            uint32_t p = order[j];
            out_ids[j] = scr_ids[keys[p] & 0xffffffffu];
            out_scores[j] = full[p];
        }
        return h;
    }
};

}  // namespace paper
