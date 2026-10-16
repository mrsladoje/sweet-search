# The declared grids (PAPER_PLAN.md sections 8-9): sets, models, build grids, search grids, (A) budgets.
# One source for plan.py (job lists) and workload.py (the workload table). Frozen at S7 with everything else.
import math

SETS = {  # name: (vectors, kind, dev queries, held-out queries)
    'gcsn': (6918, 'code', 3600, 2400),
    'd20k': (20000, 'code', 3600, 2400),
    'advtest': (21731, 'code', 1800, 1200),
    'dall': (140449, 'code', 3600, 2400),
    'csn1m': (1004739, 'code', 3600, 2400),
    'fiqa': (57638, 'beir', 389, 259),
    'quora': (522931, 'beir', 6000, 4000),
}
MODELS = ['CodeRankEmbed', 'jina-v2-base-code', 'bge-base-en-v1.5']
MACHINES = ['intel', 'amd', 'arm', 'box', 'mac']

# (A) common rescoring: C candidates -> int8 keeps H -> full rescoring; H = C is the no-screen arm.
BUDGETS = [(C, H) for C in (100, 200, 400, 1000) for H in (50, 100) if C >= H] + [(C, C) for C in (100, 200, 400, 1000)]
A_GENERATORS = ['ours_walk', 'ours_scan', 'faiss_bin_hnsw', 'faiss_bin_flat', 'usearch_b1_rescore', 'hnswlib_f32',
                'faiss_hnsw_flat', 'faiss_rabitq_flat', 'faiss_rabitq_ivf', 'scann', 'diskann_vamana']
EFFORTS = ('min', 'double')  # the smallest effort that returns C, and twice it (DESIGN.md 5.2)

HNSW_BUILD = [dict(M=M, efC=e) for M in (16, 32, 64) for e in (200, 800)]
EF_SWEEP = [16, 32, 64, 128, 256, 512, 1024]
REFINE = [1, 2, 5, 10, 20]  # refine depth as a multiple of k_v


def nlists(n):
    r = int(round(math.sqrt(n)))
    return [r, 4 * r]


def nprobes(nlist):
    return [2 ** i for i in range(0, 20) if 2 ** i <= nlist // 2]


def builds(set_name, machine):
    """(family, build params) of every (B) build of one set on one machine."""
    n = SETS[set_name][0]
    out = []
    for fam in ('faiss_hnsw_flat', 'faiss_hnsw_sq8', 'faiss_bin_hnsw', 'hnswlib_f32', 'usearch_f16', 'usearch_i8', 'usearch_b1_rescore'):
        out += [(fam, p) for p in HNSW_BUILD]
    out += [('faiss_rabitq_hnsw', p) for p in HNSW_BUILD]
    out += [('faiss_bin_flat', {}), ('faiss_rabitq_flat', {}), ('faiss_exact', {})]
    out += [('faiss_rabitq_ivf', dict(nlist=nl)) for nl in nlists(n)]
    out += [('faiss_ivfpq_fs', dict(nlist=nl)) for nl in nlists(n)]
    out += [('diskann_vamana', dict(R=R, L=L, alpha=1.2)) for R in (32, 64, 96) for L in (100, 200)]
    if n < 20000:
        out += [('scann', dict(mode='brute'))]
    elif n < 100000:
        out += [('scann', dict(mode='ah'))]
    else:
        out += [('scann', dict(mode='tree_ah', leaves=l, soar=s)) for l in (int(math.sqrt(n)), 2 * int(math.sqrt(n))) for s in (0, 1)]
    if machine == 'intel':
        out += [(f, dict(degree=d)) for f in ('svs_vamana_lvq', 'svs_vamana_leanvec') for d in (32, 64)]
    out += [('ours', dict(M=64, efC=800))]
    return out


def search_points(family, bp, n):
    """Number of (B) search points of one build in the dev sweep."""
    if family in ('faiss_exact', 'ours_exact'):
        return 1
    if family == 'ours':
        return len([50, 100, 150, 200, 300, 400, 600, 1000])
    if family in ('faiss_bin_flat', 'faiss_rabitq_flat'):
        return len(REFINE)
    if family.endswith('_ivf') or family == 'faiss_ivfpq_fs':
        return len(nprobes(bp['nlist'])) * (2 if family == 'faiss_rabitq_ivf' else 2)
    if family == 'scann':
        return 8
    if family in ('faiss_hnsw_sq8', 'faiss_bin_hnsw', 'usearch_b1_rescore', 'faiss_rabitq_hnsw') or family.endswith('_rescore'):
        return len(EF_SWEEP) * 2  # ef x two refine depths
    return len(EF_SWEEP)
