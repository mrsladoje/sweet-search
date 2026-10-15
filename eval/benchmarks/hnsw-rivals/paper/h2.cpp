// H2 (PAPER_PLAN.md section 9, dev only): do Hamming ties at the stage-1 cut change which candidates survive?
// Exact Hamming scan over our codes; the C nearest are kept with ties at the cut broken by a seeded random
// order (seed 0 = node order, as our scan does: counting sort, equal distances in node order, so seed 0
// must equal ours5 --mode A --gen scan bit for bit); then the
// shared int8 screen and full-vector rescoring (shared_rescore.h) keep and order H. Per seed it writes the
// retained lists (<out>.s<seed>.lists.bin: int32 vids then float32 scores, dev query order) and per query
// the number of candidates tied at the cut distance and the size of the tie run that was split.
// usage: h2 <DATA> <set> <model> <C> <H> <seeds> <out>      (dev split only; refuses nothing else)
#include "shared_rescore.h"
#include <cstdio>
#include <fstream>
#include <random>
#include <sstream>
#include <string>
using namespace paper;

static std::string slurp(const std::string& p) { std::ifstream f(p, std::ios::binary); std::stringstream b; b << f.rdbuf(); return b.str(); }

int main(int argc, char** argv) {
    if (argc < 8) { fprintf(stderr, "usage: h2 <DATA> <set> <model> <C> <H> <seeds> <out>\n"); return 2; }
    std::string D = argv[1], set = argv[2], model = argv[3], out = argv[7], emb = D + "/emb/" + model + "/" + set;
    size_t C = std::stoul(argv[4]), H = std::stoul(argv[5]); int seeds = std::stoi(argv[6]);
    std::string codes = slurp(emb + "/export/codes.u8"), i8 = slurp(emb + "/export/int8.i8"), f16 = slurp(emb + "/export/f16.u16");
    std::string nm = slurp(emb + "/export/node.u32");
    std::string q = slurp(emb + "/queries.f32"), qj = slurp(D + "/sets/" + set + "/queries.jsonl");
    size_t n = f16.size() / (FULL_D * 2), cb = codes.size() / n, words = cb / 8;
    Shared sh; sh.int8 = (const int8_t*)i8.data(); sh.w8 = int(i8.size() / n); sh.f16 = (const uint16_t*)f16.data();
    std::vector<size_t> rows; { std::stringstream ss(qj); std::string l; size_t i = 0;
        while (std::getline(ss, l)) { if (l.empty()) continue; if (l.find("\"split\": \"dev\"") != std::string::npos || l.find("\"split\":\"dev\"") != std::string::npos) rows.push_back(i); i++; } }
    const uint64_t* cw = (const uint64_t*)codes.data();
    const uint32_t* node = (const uint32_t*)nm.data();
    std::vector<uint32_t> dist(n); std::vector<int64_t> cand(C), ids(H); std::vector<double> sc(H); Query qc;
    std::vector<std::vector<int32_t>> lv(seeds, std::vector<int32_t>(rows.size() * H, -1));
    std::vector<std::vector<float>> ls(seeds, std::vector<float>(rows.size() * H, NAN));
    std::ofstream ties(out + ".ties.tsv"); ties << "row\tcut_distance\ttied_at_cut\ttaken_from_tie\n";
    for (size_t r = 0; r < rows.size(); r++) {
        convert_query((const float*)(q.data() + rows[r] * FULL_D * 4), qc, int(cb * 8), sh.w8);
        uint64_t qw[16] = {0}; memcpy(qw, qc.code, cb);
        // our code bytes are packed little-endian into u64 words in the searcher; popcount is order-free
        std::vector<uint32_t> hist(cb * 8 + 2, 0);
        for (size_t v = 0; v < n; v++) {
            uint32_t d = 0; for (size_t w = 0; w < words; w++) d += __builtin_popcountll(cw[v * words + w] ^ qw[w]);
            dist[v] = d; hist[d]++;
        }
        size_t acc = 0, t = 0; while (acc + hist[t] < C) acc += hist[t++];
        size_t need = C - acc;  // how many of the hist[t] candidates at the cut distance survive
        ties << rows[r] << '\t' << t << '\t' << hist[t] << '\t' << need << '\n';
        std::vector<int64_t> below, at;
        for (size_t v = 0; v < n; v++) { if (dist[v] < t) below.push_back(v); else if (dist[v] == t) at.push_back(v); }
        // generator order: by distance, then node order (our scan) -- the screen breaks its own ties by this order
        auto by_node = [&](int64_t a, int64_t b) { return dist[a] != dist[b] ? dist[a] < dist[b] : node[a] < node[b]; };
        std::sort(below.begin(), below.end(), by_node);
        std::sort(at.begin(), at.end(), by_node);
        for (int s = 0; s < seeds; s++) {
            std::vector<int64_t> pick(at);
            if (s > 0) { std::mt19937_64 g(1000 + s * 7919 + r); std::shuffle(pick.begin(), pick.end(), g); pick.resize(need); std::sort(pick.begin(), pick.end(), by_node); }
            else pick.resize(need);
            size_t m = 0; for (auto v : below) cand[m++] = v; for (auto v : pick) cand[m++] = v;
            size_t h = sh.run(qc, cand.data(), m, H, ids.data(), sc.data());
            for (size_t j = 0; j < h; j++) { lv[s][r * H + j] = (int32_t)ids[j]; ls[s][r * H + j] = (float)sc[j]; }
        }
    }
    for (int s = 0; s < seeds; s++) {
        std::ofstream f(out + ".s" + std::to_string(s) + ".lists.bin", std::ios::binary);
        f.write((char*)lv[s].data(), lv[s].size() * 4); f.write((char*)ls[s].data(), ls[s].size() * 4);
    }
    printf("h2 %s/%s C=%zu H=%zu: %zu dev queries, %d tie orders\n", set.c_str(), model.c_str(), C, H, rows.size(), seeds);
    return 0;
}
