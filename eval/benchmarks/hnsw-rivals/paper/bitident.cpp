// Bit-identity check of shared_rescore.h against our addon (DESIGN.md 5.2). Input: the dump of
// `ours5.mjs --mode A --dump F` (per timed query: query row, C candidate vids in int8 order, their int8
// dots, the H final vids, their f64 full scores). For every query it recomputes the int8 dots, the screen
// and the full-vector order with the C++ copy, and compares every dot, vid and score bit for bit.
// usage: bitident <DATA> <set> <model> <dump> <C> <H> [exportDir]     exit 0 only on zero differences
#include "shared_rescore.h"
#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>
using namespace paper;

static std::string slurp(const std::string& p) { std::ifstream f(p, std::ios::binary); std::stringstream b; b << f.rdbuf(); return b.str(); }

int main(int argc, char** argv) {
    if (argc < 7) { fprintf(stderr, "usage: bitident <DATA> <set> <model> <dump> <C> <H>\n"); return 2; }
    std::string D = argv[1], set = argv[2], model = argv[3], emb = D + "/emb/" + model + "/" + set;
    size_t C = std::stoul(argv[5]), H = std::stoul(argv[6]);
    std::string ed = argc > 7 ? argv[7] : emb + "/export";
    std::string q = slurp(emb + "/queries.f32"), i8 = slurp(ed + "/int8.i8"), f16 = slurp(ed + "/f16.u16"), dump = slurp(argv[4]);
    size_t n = f16.size() / (FULL_D * 2);
    std::string codes = slurp(ed + "/codes.u8");
    int code_d = int(codes.size() / n) * 8;
    Shared sh; sh.int8 = (const int8_t*)i8.data(); sh.w8 = int(i8.size() / n); sh.f16 = (const uint16_t*)f16.data();
    size_t rec = 4 + 8 * C + 4 * H + 8 * H, nrec = dump.size() / rec;
    if (!nrec || dump.size() % rec) { fprintf(stderr, "dump size %zu is not a multiple of %zu\n", dump.size(), rec); return 1; }
    size_t bad_dot = 0, bad_vid = 0, bad_score = 0, compared = 0;
    std::vector<int64_t> cand(C), ids(H); std::vector<double> sc(H); Query qc;
    for (size_t r = 0; r < nrec; r++) {
        const char* p = dump.data() + r * rec;
        int32_t row; memcpy(&row, p, 4);
        const int32_t* cv = (const int32_t*)(p + 4); const int32_t* dots = cv + C;
        const int32_t* fv = (const int32_t*)(p + 4 + 8 * C); const double* fs = (const double*)(p + 4 + 8 * C + 4 * H);
        convert_query((const float*)(q.data() + size_t(row) * FULL_D * 4), qc, code_d, sh.w8);
        size_t m = 0;
        for (size_t j = 0; j < C; j++) {
            cand[j] = cv[j];
            if (cv[j] < 0) continue;
            m++;
            if (int8_dot(qc.q8, sh.int8 + size_t(cv[j]) * sh.w8, sh.w8) != dots[j]) bad_dot++;
        }
        size_t h = sh.run(qc, cand.data(), C, H, ids.data(), sc.data());
        for (size_t j = 0; j < H; j++) {
            compared++;
            int64_t want = fv[j];
            int64_t got = j < h ? ids[j] : -1;
            if (got != want) { bad_vid++; continue; }
            if (want >= 0 && memcmp(&sc[j], &fs[j], 8) != 0) bad_score++;
        }
        (void)m;
    }
    printf("bitident %s/%s C=%zu H=%zu: %zu queries, %zu list slots; int8 dots differ %zu, vids differ %zu, scores differ %zu\n",
           set.c_str(), model.c_str(), C, H, nrec, compared, bad_dot, bad_vid, bad_score);
    return bad_dot || bad_vid || bad_score ? 1 : 0;
}
