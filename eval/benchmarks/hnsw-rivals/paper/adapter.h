// Adapter interface of rivals5.cpp (DESIGN.md section 5). One adapter = one library family.
// rivals5.cpp owns the timing protocol, the shared (A) rescoring path, the result records and the
// memory readings; an adapter only builds, serialises, loads and searches.
#pragma once
#include <cstddef>
#include <cstdint>
#include <map>
#include <memory>
#include <string>
#include <vector>

namespace paper {

using Params = std::map<std::string, std::string>;  // "M"->"64", "efC"->"800", "ef"->"400", ...

inline std::string param(const Params& p, const std::string& k, const std::string& d = "") {
    auto it = p.find(k);
    return it == p.end() ? d : it->second;
}
inline long param_i(const Params& p, const std::string& k, long d) {
    auto it = p.find(k);
    return it == p.end() ? d : std::stol(it->second);
}

// The corpus as every adapter sees it. `x` = stored float32 vectors normalised to unit length in
// float32 (the libraries' input); `codes` = our 512-bit sign codes (64 bytes per vector, MSB first),
// for binary indexes. Vector ids are 0..n-1 in vector-id order (DESIGN.md 1).
struct Corpus {
    size_t n = 0;
    int d = 768;
    int code_bytes = 64;  // 64 (512-bit codes) or 96 (768-bit, K4)
    const float* x = nullptr;
    const uint8_t* codes = nullptr;
};

struct Adapter {
    virtual ~Adapter() = default;
    // Build the index from `c` with `p` (build parameters only), `threads` build threads and `seed`,
    // and write every file of the serialised index into `dir` (which exists and is empty).
    virtual void build(const Corpus& c, const Params& p, int threads, uint64_t seed, const std::string& dir) = 0;
    // Load the serialised index from `dir`. `c` is given for methods that need the original vectors
    // at search time (exact refine); an adapter that keeps them must say so in `keeps_originals()`.
    virtual void load(const std::string& dir, const Corpus& c, const Params& build_params) = 0;
    virtual bool keeps_originals() const { return false; }
    // Search-time parameters (ef, nprobe, L, refine depth, ...). Called before a timed pass, never
    // inside it.
    virtual void set_search(const Params& p) = 0;
    // One query: the k best vector ids in the library's order with the library's scores (higher =
    // better; distances are negated). `q` = the query float32 vector normalised in float32, `qcode`
    // = its 64-byte sign code. Returns how many ids were written (<= k). Single-threaded.
    virtual size_t search(const float* q, const uint8_t* qcode, size_t k, int64_t* ids, float* scores) = 0;
    // Every file the serving process opens for this index (disk = their total size).
    virtual std::vector<std::string> files(const std::string& dir) const = 0;
    // Library name, version or commit, and the SIMD path it dispatched to (recorded per job).
    virtual std::map<std::string, std::string> info() const = 0;
};

// Registry: adapters register a factory under a family name ("faiss_hnsw_flat", "diskann", ...).
using Factory = std::unique_ptr<Adapter> (*)();
std::map<std::string, Factory>& registry();
struct Register {
    Register(const char* name, Factory f) { registry()[name] = f; }
};

}  // namespace paper
