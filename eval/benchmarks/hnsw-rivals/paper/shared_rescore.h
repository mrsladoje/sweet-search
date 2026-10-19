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
#if defined(__AVX2__)
#include <immintrin.h>
#elif defined(__ARM_NEON)
#include <arm_neon.h>
#endif

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

// Replication harness: only the sign code (comparison B, binary-code families); no int8 or float64 copy.
inline void convert_code_only(const float* q, Query& out, int code_d = CODE_D) {
    float t[FULL_D];
    truncate(q, code_d, t);
    std::memset(out.code, 0, sizeof(out.code));
    for (int i = 0; i < code_d; i++) if (t[i] > 0) out.code[i >> 3] |= uint8_t(0x80 >> (i & 7));
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

// ---- SIMD kernels (post hoc "common kernels" arm): ports of crates/sweet-search-native/src/rescore.rs, same values
// as the scalar functions above (integer dots are exact; each f64 row sum stays one sequential sum over i, and with
// f32 query values every product is exact in f64, so a fused multiply-add rounds like multiply-then-add).
inline int32_t int8_dot_simd(const int8_t* a, const int8_t* b, int n) {
    int i = 0; int32_t dot = 0;
#if defined(__AVX2__)
    __m256i acc0 = _mm256_setzero_si256(), acc1 = _mm256_setzero_si256();
    for (; i + 32 <= n; i += 32) {
        __m256i x = _mm256_loadu_si256((const __m256i*)(a + i)), y = _mm256_loadu_si256((const __m256i*)(b + i));
        acc0 = _mm256_add_epi32(acc0, _mm256_madd_epi16(_mm256_cvtepi8_epi16(_mm256_castsi256_si128(x)), _mm256_cvtepi8_epi16(_mm256_castsi256_si128(y))));
        acc1 = _mm256_add_epi32(acc1, _mm256_madd_epi16(_mm256_cvtepi8_epi16(_mm256_extracti128_si256(x, 1)), _mm256_cvtepi8_epi16(_mm256_extracti128_si256(y, 1))));
    }
    __m256i acc = _mm256_add_epi32(acc0, acc1);
    __m128i t = _mm_add_epi32(_mm256_castsi256_si128(acc), _mm256_extracti128_si256(acc, 1));
    t = _mm_add_epi32(t, _mm_shuffle_epi32(t, 0x4e)); t = _mm_add_epi32(t, _mm_shuffle_epi32(t, 0xb1));
    dot = _mm_cvtsi128_si32(t);
#elif defined(__ARM_FEATURE_DOTPROD)
    int32x4_t c0 = vdupq_n_s32(0), c1 = c0, c2 = c0, c3 = c0;
    for (; i + 64 <= n; i += 64) {
        c0 = vdotq_s32(c0, vld1q_s8(a + i), vld1q_s8(b + i)); c1 = vdotq_s32(c1, vld1q_s8(a + i + 16), vld1q_s8(b + i + 16));
        c2 = vdotq_s32(c2, vld1q_s8(a + i + 32), vld1q_s8(b + i + 32)); c3 = vdotq_s32(c3, vld1q_s8(a + i + 48), vld1q_s8(b + i + 48));
    }
    for (; i + 16 <= n; i += 16) c0 = vdotq_s32(c0, vld1q_s8(a + i), vld1q_s8(b + i));
    dot = vaddvq_s32(vaddq_s32(vaddq_s32(c0, c1), vaddq_s32(c2, c3)));
#endif
    for (; i < n; i++) dot += int32_t(a[i]) * int32_t(b[i]);
    return dot;
}

inline void f16_widen(const uint16_t* src, float* dst, int n) {
    int i = 0;
#if defined(__F16C__)
    for (; i + 8 <= n; i += 8) _mm256_storeu_ps(dst + i, _mm256_cvtph_ps(_mm_loadu_si128((const __m128i*)(src + i))));
#elif defined(__ARM_NEON) && defined(__aarch64__)
    for (; i + 8 <= n; i += 8) {
        float16x8_t h = vreinterpretq_f16_u16(vld1q_u16(src + i));
        vst1q_f32(dst + i, vcvt_f32_f16(vget_low_f16(h))); vst1q_f32(dst + i + 4, vcvt_high_f32_f16(h));
    }
#endif
    for (; i < n; i++) dst[i] = f16_to_f32(src[i]);
}

// f64 dots of nr widened rows (row r at w + r * FULL_D) with q: rows in groups, each row one sequential sum.
inline void f64_dots_simd(const float* w, size_t nr, const double* q, double* out) {
    size_t r = 0;
#if defined(__AVX2__) && defined(__FMA__)
    for (; r + 4 <= nr; r += 4) {
        const float* p0 = w + r * FULL_D; const float *p1 = p0 + FULL_D, *p2 = p1 + FULL_D, *p3 = p2 + FULL_D;
        __m256d acc = _mm256_setzero_pd();
        for (int i = 0; i < FULL_D; i += 4) {
            __m128 r0 = _mm_loadu_ps(p0 + i), r1 = _mm_loadu_ps(p1 + i), r2 = _mm_loadu_ps(p2 + i), r3 = _mm_loadu_ps(p3 + i);
            __m128 t0 = _mm_unpacklo_ps(r0, r1), t1 = _mm_unpacklo_ps(r2, r3), t2 = _mm_unpackhi_ps(r0, r1), t3 = _mm_unpackhi_ps(r2, r3);
            acc = _mm256_fmadd_pd(_mm256_cvtps_pd(_mm_movelh_ps(t0, t1)), _mm256_set1_pd(q[i]), acc);
            acc = _mm256_fmadd_pd(_mm256_cvtps_pd(_mm_movehl_ps(t1, t0)), _mm256_set1_pd(q[i + 1]), acc);
            acc = _mm256_fmadd_pd(_mm256_cvtps_pd(_mm_movelh_ps(t2, t3)), _mm256_set1_pd(q[i + 2]), acc);
            acc = _mm256_fmadd_pd(_mm256_cvtps_pd(_mm_movehl_ps(t3, t2)), _mm256_set1_pd(q[i + 3]), acc);
        }
        _mm256_storeu_pd(out + r, acc);
    }
#elif defined(__ARM_NEON) && defined(__aarch64__)
    for (; r + 2 <= nr; r += 2) {
        const float* a = w + r * FULL_D; const float* b = a + FULL_D;
        float64x2_t acc = vdupq_n_f64(0.0);
        for (int i = 0; i < FULL_D; i += 4) {
            float32x4_t x = vld1q_f32(a + i), y = vld1q_f32(b + i);
            float32x4_t lo = vzip1q_f32(x, y), hi = vzip2q_f32(x, y);
            acc = vfmaq_f64(acc, vcvt_f64_f32(vget_low_f32(lo)), vdupq_n_f64(q[i]));
            acc = vfmaq_f64(acc, vcvt_high_f64_f32(lo), vdupq_n_f64(q[i + 1]));
            acc = vfmaq_f64(acc, vcvt_f64_f32(vget_low_f32(hi)), vdupq_n_f64(q[i + 2]));
            acc = vfmaq_f64(acc, vcvt_high_f64_f32(hi), vdupq_n_f64(q[i + 3]));
        }
        out[r] = vgetq_lane_f64(acc, 0); out[r + 1] = vgetq_lane_f64(acc, 1);
    }
#endif
    for (; r < nr; r++) {
        const float* a = w + r * FULL_D; double d = 0;
        for (int i = 0; i < FULL_D; i++) d += q[i] * (double)a[i];
        out[r] = d;
    }
}

struct Shared {
    bool simd = false;     // post hoc: SIMD kernels (same values as the scalar path)
    bool bypass8 = false;  // post hoc: no int8 stage at all (no int8 reads, no sort): full rescoring of every candidate
                           // in generator order
    const int8_t* int8 = nullptr;   // n x w8
    int w8 = CODE_D;
    const uint16_t* f16 = nullptr;  // n x 768
    // scratch
    std::vector<uint64_t> keys;
    std::vector<int64_t> scr_ids;
    std::vector<double> full, norm;
    std::vector<uint32_t> order;
    std::vector<float> wide;

    // cand[0..nc) in generator order (-1 = empty slot, skipped). Keeps H by int8 (H >= nc: no screen),
    // orders them by the full vectors, writes up to H (vid, full score) to out_ids/out_scores.
    size_t run(const Query& q, const int64_t* cand, size_t nc, size_t H, int64_t* out_ids, double* out_scores) {
        scr_ids.clear();
        for (size_t i = 0; i < nc; i++) if (cand[i] >= 0) scr_ids.push_back(cand[i]);
        size_t m = scr_ids.size();
        // int8 screen: key = (INT32_MAX - dot) << 32 | position, unstable sort = stable descending
        keys.resize(m);
        size_t h = std::min(H, m);
        if (bypass8) {
            for (size_t i = 0; i < m; i++) keys[i] = uint64_t(i);  // generator order, no int8 work
        } else {
            for (size_t i = 0; i < m; i++) {
                int32_t dot = simd ? int8_dot_simd(q.q8, int8 + scr_ids[i] * w8, w8) : int8_dot(q.q8, int8 + scr_ids[i] * w8, w8);
                keys[i] = uint64_t(int64_t(INT32_MAX) - int64_t(dot)) << 32 | uint64_t(i);
            }
            // H >= C (no screen) still sorts: the full stage breaks its ties in int8 order, as ours does.
            std::sort(keys.begin(), keys.end());
        }
        // full rescoring of the first h in int8 order (cascade_full)
        full.resize(h); norm.resize(h); order.resize(h);
        double mn = INFINITY, mx = -INFINITY;
        if (simd) {
            wide.resize(h * FULL_D);
            for (size_t j = 0; j < h; j++) f16_widen(f16 + scr_ids[keys[j] & 0xffffffffu] * FULL_D, wide.data() + j * FULL_D, FULL_D);
            f64_dots_simd(wide.data(), h, q.full64, full.data());
            for (size_t j = 0; j < h; j++) { mn = std::min(mn, full[j]); mx = std::max(mx, full[j]); }
        } else
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
