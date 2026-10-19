// Rival harness v5 (DESIGN.md 5). Two process kinds, so that timing runs never hold a build:
//   rivals5 build --data D --set S --model M --family F --params k=v,... --threads T --seed s --dir OUT
//       builds one index, writes its files into OUT and OUT/build.json (build_s, peak RSS, files, SHA-256).
//   rivals5 query --data D --set S --model M --split dev|ho --family F --dir OUT --search k=v,...
//                 --comparison A|B [--C n --H n] [--kv n] --round r --out <stem>
//                 [--key key.json --job-hash h] [--heldout] [--cold] [--limit n]
//       loads the index from OUT and runs one timed pass: 500 dev warm-up queries, then every query of the
//       split once in order perm(42 + round), one timing per query, all kept (DESIGN.md 5.1).
//       A: the library returns its top C, the shared int8 screen keeps H, the shared full-vector rescoring
//          orders them (shared_rescore.h). B: the library's own top k_v with its own scores.
// Writes <stem>.lists.bin then <stem>.json (atomic rename). No early stop of any kind exists here; sweeps
// belong to the runner, which never stops a held-out job list early.
#include "adapter.h"
#include "shared_rescore.h"
#if __has_include(<faiss/impl/HNSW.h>)  // the FAISS binary links libfaiss; rivals5-ext (DiskANN, SVS) does not
#include <faiss/impl/HNSW.h>
#define PAPER_HNSW_STATS 1
#endif
#include <chrono>
#include <cstdio>
#include <fcntl.h>
#include <fstream>
#include <functional>
#include <sstream>
#include <sys/mman.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <thread>
#include <unistd.h>
#ifdef __APPLE__
#include <mach/mach.h>
#endif

namespace paper {
std::map<std::string, Factory>& registry() { static std::map<std::string, Factory> r; return r; }
}
using namespace paper;
using clk = std::chrono::steady_clock;

static std::map<std::string, std::string> args;
static std::string arg(const std::string& k, const std::string& d = "\x01") {
    auto it = args.find(k);
    if (it != args.end()) return it->second;
    if (d == "\x01") { fprintf(stderr, "--%s missing\n", k.c_str()); exit(2); }
    return d;
}
static bool flag(const std::string& k) { return args.count(k) > 0; }
static Params parse_params(const std::string& s) {
    Params p; std::stringstream ss(s); std::string kv;
    while (std::getline(ss, kv, ',')) { if (kv.empty()) continue; auto e = kv.find('='); p[kv.substr(0, e)] = e == std::string::npos ? "" : kv.substr(e + 1); }
    return p;
}
static std::string jstr(const std::string& s) {
    std::string o = "\"";
    for (char c : s) { if (c == '"' || c == '\\') o += '\\'; if ((unsigned char)c < 0x20) { char b[8]; snprintf(b, 8, "\\u%04x", c); o += b; } else o += c; }
    return o + "\"";
}
static std::string jmap(const std::map<std::string, std::string>& m) {
    std::string o = "{"; bool f = true;
    for (auto& [k, v] : m) { o += (f ? "" : ",") + jstr(k) + ":" + jstr(v); f = false; }
    return o + "}";
}
static long json_num(const std::string& j, const std::string& k) {
    auto a = j.find("\"" + k + "\""); if (a == std::string::npos) { fprintf(stderr, "no %s in json\n", k.c_str()); exit(1); }
    return std::stol(j.substr(j.find(':', a) + 1));
}
static std::string slurp(const std::string& p) { std::ifstream f(p, std::ios::binary); std::stringstream b; b << f.rdbuf(); return b.str(); }

// SHA-256 (FIPS 180-4), for the files a build writes and the lists a query pass writes.
struct Sha256 {
    uint32_t h[8] = {0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19};
    uint8_t buf[64]; uint64_t len = 0; size_t bl = 0;
    static uint32_t r(uint32_t x, int n) { return x >> n | x << (32 - n); }
    void block(const uint8_t* p) {
        static const uint32_t K[64] = {0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2};
        uint32_t w[64];
        for (int i = 0; i < 16; i++) w[i] = uint32_t(p[4*i]) << 24 | uint32_t(p[4*i+1]) << 16 | uint32_t(p[4*i+2]) << 8 | p[4*i+3];
        for (int i = 16; i < 64; i++) w[i] = w[i-16] + (r(w[i-15],7) ^ r(w[i-15],18) ^ w[i-15] >> 3) + w[i-7] + (r(w[i-2],17) ^ r(w[i-2],19) ^ w[i-2] >> 10);
        uint32_t a=h[0],b=h[1],c=h[2],d=h[3],e=h[4],f=h[5],g=h[6],hh=h[7];
        for (int i = 0; i < 64; i++) {
            uint32_t t1 = hh + (r(e,6)^r(e,11)^r(e,25)) + ((e&f)^(~e&g)) + K[i] + w[i], t2 = (r(a,2)^r(a,13)^r(a,22)) + ((a&b)^(a&c)^(b&c));
            hh=g; g=f; f=e; e=d+t1; d=c; c=b; b=a; a=t1+t2;
        }
        h[0]+=a;h[1]+=b;h[2]+=c;h[3]+=d;h[4]+=e;h[5]+=f;h[6]+=g;h[7]+=hh;
    }
    void add(const void* d, size_t n) { auto p = (const uint8_t*)d; len += n; while (n--) { buf[bl++] = *p++; if (bl == 64) { block(buf); bl = 0; } } }
    std::string hex() {
        uint64_t bits = len * 8; uint8_t one = 0x80, z = 0; add(&one, 1); while (bl != 56) add(&z, 1);
        for (int i = 7; i >= 0; i--) { uint8_t b = uint8_t(bits >> (8 * i)); add(&b, 1); }
        char o[65]; for (int i = 0; i < 8; i++) snprintf(o + 8 * i, 9, "%08x", h[i]); return o;
    }
};
static std::string sha_file(const std::string& p) {
    Sha256 s; std::ifstream f(p, std::ios::binary); std::vector<char> b(1 << 20);
    while (f) { f.read(b.data(), b.size()); s.add(b.data(), f.gcount()); }
    return s.hex();
}

// Fisher-Yates over splitmix64: the order ours5.mjs uses (DESIGN.md 5.1).
static std::vector<size_t> perm(size_t n, uint64_t seed) {
    uint64_t s = seed;
    auto next = [&] { s += 0x9e3779b97f4a7c15ull; uint64_t z = s; z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ull; z = (z ^ (z >> 27)) * 0x94d049bb133111ebull; return z ^ (z >> 31); };
    std::vector<size_t> p(n); std::iota(p.begin(), p.end(), 0);
    for (size_t i = n ? n - 1 : 0; i > 0; i--) { size_t j = next() % (i + 1); std::swap(p[i], p[j]); }
    return p;
}

// Read-only mapping of a whole file (file-backed memory, as our vector file).
struct Map { const void* p = nullptr; size_t n = 0; };
static Map map_file(const std::string& path) {
    int fd = open(path.c_str(), O_RDONLY); if (fd < 0) { fprintf(stderr, "open %s failed\n", path.c_str()); exit(1); }
    struct stat st; fstat(fd, &st); Map m; m.n = st.st_size;
    m.p = m.n ? mmap(nullptr, m.n, PROT_READ, MAP_PRIVATE, fd, 0) : nullptr; close(fd);
    if (m.p == MAP_FAILED) { fprintf(stderr, "mmap %s failed\n", path.c_str()); exit(1); }
    return m;
}
static std::vector<float> load_f32(const std::string& p) { std::string s = slurp(p); std::vector<float> v(s.size() / 4); memcpy(v.data(), s.data(), v.size() * 4); return v; }
static void normalize(float* x, size_t n, int d) {
    for (size_t i = 0; i < n; i++) { float* p = x + i * d; double s = 0; for (int j = 0; j < d; j++) s += double(p[j]) * p[j]; float k = float(std::sqrt(s)); if (k > 0) for (int j = 0; j < d; j++) p[j] /= k; }
}
static std::vector<std::string> jsonl_field(const std::string& path, const std::string& field) {
    std::vector<std::string> out; std::ifstream f(path); std::string l, pat = "\"" + field + "\": \"", pat2 = "\"" + field + "\":\"";
    while (std::getline(f, l)) {
        if (l.empty()) continue;
        size_t a = l.find(pat), k = pat.size(); if (a == std::string::npos) { a = l.find(pat2); k = pat2.size(); }
        if (a == std::string::npos) { fprintf(stderr, "%s: no field %s\n", path.c_str(), field.c_str()); exit(1); }
        size_t b = l.find('"', a + k); out.push_back(l.substr(a + k, b - a - k));
    }
    return out;
}

static std::map<std::string, std::string> memory() {
    std::map<std::string, std::string> m;
    struct rusage ru; getrusage(RUSAGE_SELF, &ru);
#ifdef __APPLE__
    m["maxrss_kb"] = std::to_string(ru.ru_maxrss / 1024);
    task_vm_info_data_t vi; mach_msg_type_number_t cnt = TASK_VM_INFO_COUNT;
    if (task_info(mach_task_self(), TASK_VM_INFO, (task_info_t)&vi, &cnt) == KERN_SUCCESS) {
        m["phys_footprint_kb"] = std::to_string(vi.phys_footprint / 1024); m["rss_kb"] = std::to_string(vi.resident_size / 1024);
    }
#else
    m["maxrss_kb"] = std::to_string(ru.ru_maxrss);
    std::ifstream f("/proc/self/smaps_rollup"); std::string l; long rss = -1, anon = 0;
    while (std::getline(f, l)) {
        auto c = l.find(':'); if (c == std::string::npos || l.find(" kB") == std::string::npos) continue;
        std::string k = l.substr(0, c); long v = std::stol(l.substr(c + 1)); m[k] = std::to_string(v);
        if (k == "Rss") rss = v; if (k == "Anonymous") anon = v;
    }
    if (rss >= 0) m["file_backed_kb"] = std::to_string(rss - anon);
    m["majflt"] = std::to_string(ru.ru_majflt); m["minflt"] = std::to_string(ru.ru_minflt);
#endif
    return m;
}

static int cmd_build() {
    std::string D = arg("data"), set = arg("set"), model = arg("model"), fam = arg("family"), dir = arg("dir");
    auto it = registry().find(fam); if (it == registry().end()) { fprintf(stderr, "unknown family %s\n", fam.c_str()); return 2; }
    Params p = parse_params(arg("params", ""));
    int threads = std::stoi(arg("threads", std::to_string(std::max(1u, std::thread::hardware_concurrency()))));
    uint64_t seed = std::stoull(arg("seed", "42"));
    std::string emb = D + "/emb/" + model + "/" + set;
    auto X = load_f32(emb + "/corpus.f32"); size_t n = X.size() / FULL_D; normalize(X.data(), n, FULL_D);
    // the export (our codes) only when it exists: the float families build without it, the binary families
    // (adapters that read Corpus::codes) stop with an error if it is missing
    Corpus c; c.n = n; c.d = FULL_D; c.x = X.data();
    Map codes;
    if (access((emb + "/export/export.json").c_str(), R_OK) == 0) {
        std::string ex = slurp(emb + "/export/export.json");
        codes = map_file(emb + "/export/codes.u8");
        c.codes = (const uint8_t*)codes.p; c.code_bytes = (int)json_num(ex, "code_bytes");
        if ((size_t)json_num(ex, "n") != n || codes.n != n * c.code_bytes) { fprintf(stderr, "export does not match the corpus\n"); return 1; }
    }
    mkdir(dir.c_str(), 0755);
    auto ad = it->second();
    auto t0 = clk::now();
    ad->build(c, p, threads, seed, dir);
    double build_s = std::chrono::duration<double>(clk::now() - t0).count();
    auto mem = memory();
    std::string files = "{"; size_t bytes = 0; bool f = true;
    for (auto& fn : ad->files(dir)) { struct stat st; stat(fn.c_str(), &st); bytes += st.st_size; files += (f ? "" : ",") + jstr(fn.substr(fn.rfind('/') + 1)) + ":{\"bytes\":" + std::to_string(st.st_size) + ",\"sha256\":" + jstr(sha_file(fn)) + "}"; f = false; }
    files += "}";
    { std::ofstream bpf(dir + "/build.params"); bool g = true; for (auto& [k, v] : p) { bpf << (g ? "" : ",") << k << "=" << v; g = false; } }
    std::ofstream o(dir + "/build.json.tmp");
    o << "{\"family\":" << jstr(fam) << ",\"set\":" << jstr(set) << ",\"model\":" << jstr(model) << ",\"params\":" << jmap(p)
      << ",\"threads\":" << threads << ",\"seed\":" << seed << ",\"n\":" << n << ",\"build_s\":" << build_s
      << ",\"bytes\":" << bytes << ",\"files\":" << files << ",\"memory\":" << jmap(mem) << ",\"info\":" << jmap(ad->info()) << "}\n";
    o.close(); rename((dir + "/build.json.tmp").c_str(), (dir + "/build.json").c_str());
    printf("built %s %s/%s n=%zu in %.1f s, %.1f MB, peak %s kB\n", fam.c_str(), set.c_str(), model.c_str(), n, build_s, bytes / 1048576.0, mem["maxrss_kb"].c_str());
    return 0;
}

static int cmd_query() {
    auto tproc = clk::now();
    std::string D = arg("data"), set = arg("set"), model = arg("model"), split = arg("split"), fam = arg("family"), dir = arg("dir"), comp = arg("comparison"), stem = arg("out");
    int round = std::stoi(arg("round"));
    bool heldout = flag("heldout"), cold = flag("cold");
    if (heldout != (split == "ho")) { fprintf(stderr, "--heldout must be given exactly for the held-out split\n"); return 2; }
    if (heldout && flag("limit")) { fprintf(stderr, "held-out runs execute the whole split\n"); return 2; }
    auto it = registry().find(fam); if (it == registry().end()) { fprintf(stderr, "unknown family %s\n", fam.c_str()); return 2; }
    Params bp = parse_params(slurp(dir + "/build.params")), sp = parse_params(arg("search", ""));
    std::string emb = D + "/emb/" + model + "/" + set, sd = D + "/sets/" + set;

    // queries of the split, warm-up rows from dev
    auto splits = jsonl_field(sd + "/queries.jsonl", "split");
    auto Q = load_f32(emb + "/queries.f32");
    if (Q.size() != splits.size() * FULL_D) { fprintf(stderr, "queries.f32 rows differ from queries.jsonl\n"); return 1; }
    std::vector<size_t> rows, warm;
    for (size_t i = 0; i < splits.size(); i++) { if (splits[i] == split) rows.push_back(i); if (splits[i] == "dev") warm.push_back(i); }
    if (flag("limit")) rows.resize(std::min(rows.size(), (size_t)std::stoul(arg("limit"))));
    size_t nq = rows.size();

    // what the serving process holds: the index (adapter), the originals only when the method needs them,
    // and in (A) the shared int8 rows and f16 vectors (memory-mapped, as ours maps its vector file)
    auto tl = clk::now();
    auto ad = it->second();
    std::string ex = slurp(emb + "/export/export.json");
    std::vector<float> X; Map codes = map_file(emb + "/export/codes.u8");
    Corpus c; c.d = FULL_D; c.n = (size_t)json_num(ex, "n"); c.code_bytes = (int)json_num(ex, "code_bytes"); c.codes = (const uint8_t*)codes.p;
    int w8 = (int)json_num(ex, "int8_width");
    bool need_x = param_i(sp, "refine", 0) > 0 || param_i(sp, "rescore", 0) > 0;
    if (need_x) { X = load_f32(emb + "/corpus.f32"); normalize(X.data(), c.n, FULL_D); c.x = X.data(); }
    std::vector<uint16_t> X16;  // post hoc (SS_FIX_REFINE_F16=1): the float16 rows on the heap, for the refine step
    if (need_x && getenv("SS_FIX_REFINE_F16") && std::string(getenv("SS_FIX_REFINE_F16")) == "1") {
        std::string s16 = slurp(emb + "/export/f16.u16"); X16.resize(s16.size() / 2); memcpy(X16.data(), s16.data(), X16.size() * 2);
        if (X16.size() != c.n * FULL_D) { fprintf(stderr, "f16.u16 rows differ from n\n"); return 1; }
        c.x16 = X16.data();
    }
    ad->load(dir, c, bp);
    ad->set_search(sp);
    Shared sh; Map m8, mf;
    size_t C = 0, H = 0, L;
    if (comp == "A") {
        C = std::stoul(arg("C")); H = std::stoul(arg("H"));
        if (!(C >= H && H >= 10)) { fprintf(stderr, "A needs C >= H >= 10\n"); return 2; }
        m8 = map_file(emb + "/export/int8.i8"); mf = map_file(emb + "/export/f16.u16");
        sh.w8 = w8; sh.int8 = (const int8_t*)m8.p; sh.f16 = (const uint16_t*)mf.p;
        // post hoc arms (bench only): SIMD kernels in the shared path; a true int8 bypass
        auto on = [](const char* e) { const char* v = getenv(e); return v && std::string(v) == "1"; };
        sh.simd = on("SS_FIX_SHARED_SIMD"); sh.bypass8 = on("SS_FIX_NO_INT8");
        L = H;
    } else if (comp == "B") L = std::stoul(arg("kv"));
    else { fprintf(stderr, "--comparison A|B\n"); return 2; }
    double load_s = std::chrono::duration<double>(clk::now() - tl).count();
    auto mem_loaded = memory();

    size_t K = comp == "A" ? C : L;
    std::vector<int64_t> cand(K), ids(L); std::vector<float> lsc(K); std::vector<double> sc(L);
    std::vector<float> qn(FULL_D); Query qc;
    // post-freeze (--stages): per-query clocks of query conversion | generator (search) | shared screen + rescoring
    const bool stages = flag("stages"); int64_t last[3] = {0, 0, 0};
    const bool code_family = fam == "faiss_bin_flat" || fam == "faiss_bin_hnsw" || fam == "usearch_b1_rescore";
    auto one = [&](size_t r) -> size_t {
        const float* q = &Q[r * FULL_D];
        auto c0 = clk::now();
        // (A): codes, int8, f64 query for the shared stages. (B): only what the family uses (replication fix: the
        // frozen harness converted every query for every family); the libraries get q normalised in f32.
        if (comp == "A") convert_query(q, qc, c.code_bytes * 8, w8);
        else if (code_family) convert_code_only(q, qc, c.code_bytes * 8);
        double s = 0; for (int j = 0; j < FULL_D; j++) s += double(q[j]) * q[j]; float k = float(std::sqrt(s));
        for (int j = 0; j < FULL_D; j++) qn[j] = k > 0 ? q[j] / k : q[j];
        std::fill(cand.begin(), cand.end(), -1);
        auto c1 = clk::now();
        size_t got = ad->search(qn.data(), qc.code, K, cand.data(), lsc.data());
        auto c2 = clk::now();
        if (stages) { last[0] = std::chrono::duration_cast<std::chrono::nanoseconds>(c1 - c0).count();
                      last[1] = std::chrono::duration_cast<std::chrono::nanoseconds>(c2 - c1).count(); last[2] = 0; }
        if (comp == "A") { size_t n = sh.run(qc, cand.data(), got, H, ids.data(), sc.data());
            if (stages) last[2] = std::chrono::duration_cast<std::chrono::nanoseconds>(clk::now() - c2).count(); return n; }
        for (size_t j = 0; j < got && j < L; j++) { ids[j] = cand[j]; sc[j] = lsc[j]; }
        return std::min(got, L);
    };
    if (!cold) { auto w = perm(warm.size(), 7); for (size_t i = 0; i < std::min<size_t>(500, warm.size()); i++) one(warm[w[i]]); }
    auto mem_timed = memory();  // replication: page faults of the timed pass alone = after - timed
#ifdef PAPER_HNSW_STATS
    faiss::hnsw_stats.reset();  // post hoc: FAISS HNSW distance computations of the timed pass
#endif
    std::vector<int32_t> lv(nq * L, -1); std::vector<float> ls(nq * L, NAN); std::vector<int64_t> tns(nq, -1);
    std::vector<int64_t> sconv(stages ? nq : 0, -1), sgen(stages ? nq : 0, -1), srest(stages ? nq : 0, -1);
    size_t shortl = 0; int64_t first = -1;
    for (size_t qi : perm(nq, 42 + round)) {
        std::fill(ids.begin(), ids.end(), -1); std::fill(sc.begin(), sc.end(), NAN);
        auto s = clk::now();
        size_t n = one(rows[qi]);
        int64_t ns = std::chrono::duration_cast<std::chrono::nanoseconds>(clk::now() - s).count();
        tns[qi] = ns; if (first < 0) first = ns; if (n < L) shortl++;
        if (stages) { sconv[qi] = last[0]; sgen[qi] = last[1]; srest[qi] = last[2]; }
        for (size_t j = 0; j < L; j++) { lv[qi * L + j] = j < n ? (int32_t)ids[j] : -1; ls[qi * L + j] = j < n ? (float)sc[j] : NAN; }
    }
    auto mem_after = memory();

    Sha256 hs; hs.add(lv.data(), lv.size() * 4); hs.add(ls.data(), ls.size() * 4); std::string lsha = hs.hex();
    { std::ofstream f(stem + ".lists.bin.tmp", std::ios::binary); f.write((char*)lv.data(), lv.size() * 4); f.write((char*)ls.data(), ls.size() * 4); }
    rename((stem + ".lists.bin.tmp").c_str(), (stem + ".lists.bin").c_str());
    // --key: the job key JSON object the runner computed; --job-hash: its SHA-256 (DESIGN.md 5.5)
    std::string jk = flag("key") ? slurp(arg("key")) : "null", jh = flag("job-hash") ? jstr(arg("job-hash")) : "null";
    while (!jk.empty() && (jk.back() == '\n' || jk.back() == ' ')) jk.pop_back();
    std::string tj = "["; for (size_t i = 0; i < nq; i++) tj += (i ? "," : "") + std::to_string(tns[i]); tj += "]";
    auto arr = [&](const std::vector<int64_t>& v) { std::string x = "["; for (size_t i = 0; i < v.size(); i++) x += (i ? "," : "") + std::to_string(v[i]); return x + "]"; };
    std::string stj = stages ? ",\"stage_ns\":{\"conv\":" + arr(sconv) + ",\"gen\":" + arr(sgen) + ",\"rest\":" + arr(srest) + "}" : "";
    Params pr = sp; if (comp == "A") { pr["C"] = std::to_string(C); pr["H"] = std::to_string(H); } else pr["kv"] = std::to_string(L);
    std::ofstream o(stem + ".json.tmp");
    o << "{\"job_hash\":" << jh << ",\"key\":" << jk << ",\"complete\":true,\"system\":" << jstr(fam) << ",\"comparison\":" << jstr(comp)
      << ",\"set\":" << jstr(set) << ",\"model\":" << jstr(model) << ",\"split\":" << jstr(split) << ",\"round\":" << round
      << ",\"params\":" << jmap(pr) << ",\"build_params\":" << jmap(bp) << ",\"L\":" << L << ",\"n_queries\":" << nq
      << ",\"order_seed\":" << 42 + round << ",\"warmup\":" << (cold ? 0 : std::min<size_t>(500, warm.size())) << ",\"cold\":" << (cold ? "true" : "false")
      << ",\"timings_ns\":" << tj << stj << ",\"first_query_ns\":" << first << ",\"lists_sha256\":" << jstr(lsha) << ",\"short_lists\":" << shortl
      << ",\"memory\":{\"loaded\":" << jmap(mem_loaded) << ",\"timed\":" << jmap(mem_timed) << ",\"after\":" << jmap(mem_after) << "},\"keeps_originals\":" << (need_x ? "true" : "false")
      << ",\"load_s\":" << load_s << ",\"process_s\":" << std::chrono::duration<double>(clk::now() - tproc).count()
      << ",\"info\":" << jmap(ad->info())
#ifdef PAPER_HNSW_STATS
      << ",\"hnsw_stats\":{\"ndis\":" << faiss::hnsw_stats.ndis << ",\"nhops\":" << faiss::hnsw_stats.nhops << ",\"n1\":" << faiss::hnsw_stats.n1 << "}"
#endif
      << "}\n";
    o.close(); rename((stem + ".json.tmp").c_str(), (stem + ".json").c_str());
    std::vector<int64_t> st(tns); std::sort(st.begin(), st.end());
    printf("%s %s %s/%s/%s r%d nq=%zu short=%zu", fam.c_str(), comp.c_str(), set.c_str(), model.c_str(), split.c_str(), round, nq, shortl);
    if (!heldout) printf(" p50 %.1f us", st[nq / 2] / 1e3);
    printf("\n");
    return 0;
}

int main(int argc, char** argv) {
    if (argc < 2) { fprintf(stderr, "usage: rivals5 build|query|families --key value ...\n"); return 2; }
    std::string cmd = argv[1];
    for (int i = 2; i < argc; i++) {
        std::string a = argv[i]; if (a.rfind("--", 0) != 0) { fprintf(stderr, "bad argument %s\n", a.c_str()); return 2; }
        a = a.substr(2);
        if (a == "heldout" || a == "cold" || a == "stages") args[a] = "1"; else if (i + 1 < argc) args[a] = argv[++i]; else { fprintf(stderr, "--%s needs a value\n", a.c_str()); return 2; }
    }
    if (cmd == "families") { for (auto& [k, v] : registry()) printf("%s\n", k.c_str()); return 0; }
    if (cmd == "build") return cmd_build();
    if (cmd == "query") return cmd_query();
    fprintf(stderr, "unknown command %s\n", cmd.c_str()); return 2;
}
