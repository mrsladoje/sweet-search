# The workload table (PAPER_PLAN.md S1): every build and every timed run, models x sets x systems x builds x
# points x rounds x machines x conditions, with an estimate per row. Estimates come from the v4 / HANDOFF-v5
# measurements (box and Mac) and are UNVALIDATED: the S3a pilot replaces them (run with --pilot <json>).
# usage: python workload.py [--pilot pilot.json] > WORKLOAD.md
import argparse, json, math, sys

from grid import SETS, MODELS, BUDGETS, A_GENERATORS, EFFORTS, builds, search_points

ap = argparse.ArgumentParser(); ap.add_argument('--pilot'); ap.add_argument('--rounds-dev', type=int, default=1)
ap.add_argument('--rounds', type=int, default=5, help='R per machine (from the A/A run; cap 10)')
a = ap.parse_args()
P = json.load(open(a.pilot)) if a.pilot else {}

# ---- assumptions (seconds); the pilot overrides any key of the same name
A = dict(
    # mean single-query latency at a mid sweep point, by system class, at n = 1M (scaled by (n/1M)^0.35 for graphs,
    # linearly for flat scans); v4 x86 box medians, rounded up
    lat_graph_1m=600e-6, lat_flat_bin_1m=4e-3, lat_flat_f32_1m=60e-3, lat_ivf_1m=1.5e-3, lat_ours_1m=250e-6,
    proc_overhead=3.0,          # process start, index load (small sets), 500 warm-up queries
    load_1m=15.0,               # index load at 1M (from disk, page cache warm)
    # build core-seconds at 1M (x (n/1M)^1.1); ours is single-threaded JS: 7,245 s at 1M on the box
    build_graph_1m=16 * 600, build_ivf_1m=16 * 120, build_flat_1m=16 * 10, build_ours_1m=7245, build_diskann_1m=16 * 900,
    build_scann_1m=16 * 300,
    embed_docs_per_s=1500,       # base-size 768-d encoder, fp32, one L4 / 4090, max_length 512
)
A.update(P.get('assumptions', {}))


def lat(fam, n):
    s = n / 1e6
    if fam in ('faiss_exact',):
        return A['lat_flat_f32_1m'] * s
    if fam in ('faiss_bin_flat', 'faiss_rabitq_flat'):
        return A['lat_flat_bin_1m'] * s
    if fam.endswith('_ivf') or fam == 'faiss_ivfpq_fs' or fam == 'scann':
        return A['lat_ivf_1m'] * s ** 0.5
    if fam.startswith('ours'):
        return A['lat_ours_1m'] * s ** 0.35
    return A['lat_graph_1m'] * s ** 0.35


def build_cs(fam, n):
    s = (n / 1e6) ** 1.1
    if fam == 'ours':
        return A['build_ours_1m'] * s
    if fam.startswith('diskann') or fam.startswith('svs'):
        return A['build_diskann_1m'] * s
    if fam == 'scann':
        return A['build_scann_1m'] * s
    if fam.endswith('_ivf') or fam == 'faiss_ivfpq_fs':
        return A['build_ivf_1m'] * s
    if fam in ('faiss_bin_flat', 'faiss_rabitq_flat', 'faiss_exact'):
        return A['build_flat_1m'] * s
    return A['build_graph_1m'] * s


def run_s(nq, l, n):
    return A['proc_overhead'] + (A['load_1m'] * n / 1e6) + nq * l


rows, tot = [], dict(build_core_h=0, dev_h=0, ho_h=0, gpu_h=0)
aws = ['intel', 'amd', 'arm']
for s, (n, kind, ndev, nho) in SETS.items():
    for m in MODELS:
        bl = builds(s, 'intel')
        nb = len(bl); bch = sum(build_cs(f, n) for f, _ in bl) / 3600
        # (B) dev sweep: every point of every build, rounds_dev rounds, on each AWS machine
        pts = sum(search_points(f, p, n) for f, p in bl)
        dev_b = sum(search_points(f, p, n) * run_s(ndev, lat(f, n), n) for f, p in bl) * a.rounds_dev / 3600
        # (A) dev: generators x budgets x efforts
        na = len(A_GENERATORS) * len(BUDGETS) * len(EFFORTS)
        dev_a = sum(run_s(ndev, lat(g, n) + 30e-6, n) for g in A_GENERATORS) * len(BUDGETS) * len(EFFORTS) * a.rounds_dev / 3600
        # held-out: frozen points only: (B) 3 fractions x ~15 systems; (A) the full grid; R rounds; + memory, cold start
        nfz = 3 * 15
        ho = (nfz * run_s(nho, lat('faiss_hnsw_flat', n), n) + na * run_s(nho, lat('faiss_hnsw_flat', n) + 30e-6, n)) * a.rounds / 3600
        ho += (nfz * (A['proc_overhead'] + 100 * lat('faiss_hnsw_flat', n))) / 3600  # cold-start jobs
        emb = 0 if (m == 'CodeRankEmbed' and kind == 'code') else (n + ndev + nho) / A['embed_docs_per_s'] / 3600
        rows.append(dict(set=s, model=m, n=n, builds=nb, build_core_h=bch, points_B=pts, points_A=na, dev_h=dev_b + dev_a,
                         ho_h=ho, gpu_h=emb))
        tot['build_core_h'] += bch; tot['dev_h'] += dev_b + dev_a; tot['ho_h'] += ho; tot['gpu_h'] += emb

print('# Workload table (estimates; UNVALIDATED until the S3a pilot)\n')
print(f'Assumptions: {json.dumps(A)}. Dev sweep rounds per point: {a.rounds_dev}; held-out rounds R = {a.rounds}.')
print('Times are machine-hours per AWS timing machine (intel, amd, arm each run the same rows); builds run once on '
      '`build` and are copied (index files are portable across CPUs; checked in S3a).\n')
print('| Set | Model | Vectors | Builds | Build core-h | (B) dev points | (A) dev points | Dev h / machine | Held-out h / machine | GPU h |')
print('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|')
for r in rows:
    print(f"| {r['set']} | {r['model']} | {r['n']:,} | {r['builds']} | {r['build_core_h']:.1f} | {r['points_B']} | {r['points_A']} | "
          f"{r['dev_h']:.1f} | {r['ho_h']:.1f} | {r['gpu_h']:.2f} |")
print(f"| **total** | | | {sum(r['builds'] for r in rows)} | {tot['build_core_h']:.0f} | {sum(r['points_B'] for r in rows)} | "
      f"{sum(r['points_A'] for r in rows)} | {tot['dev_h']:.0f} | {tot['ho_h']:.0f} | {tot['gpu_h']:.1f} |")
price = dict(intel=0.75, amd=0.75, arm=0.64, build=1.5, gpu=0.8)
build_wall = tot['build_core_h'] / 32  # a 32-vCPU build machine, memory admission permitting
usd = (tot['dev_h'] + tot['ho_h']) * (price['intel'] + price['amd'] + price['arm']) + build_wall * price['build'] + tot['gpu_h'] * price['gpu']
print(f"\nCost estimate at on-demand prices (intel 0.75, amd 0.75, arm 0.64, build 32 vCPU ~1.5, GPU 0.8 $/h): "
      f"timing {(tot['dev_h'] + tot['ho_h']):.0f} h x 3 machines, build ~{build_wall:.0f} h wall, GPU {tot['gpu_h']:.1f} h "
      f"-> about ${usd:.0f}. Box and Mac rows run free (S6, S8).")
