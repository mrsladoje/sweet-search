# Figures of the paper draft from the analysis JSON (analyze.py --json).
#   python figures.py results-paper.json
# size.pdf  latency vs corpus size at f = 0.99: ours, the fastest rival that meets f, exact search; one panel per CPU
# compA.pdf comparison (A) at C 400 / H 100, smaller declared effort: generator latency vs set size per CPU
import collections, json, os, sys
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

HERE = os.path.dirname(os.path.abspath(__file__))
J = json.load(open(sys.argv[1]))
SIZE = {'gcsn': 6918, 'd20k': 20000, 'advtest': 21731, 'fiqa': 57638, 'dall': 140449, 'quora': 522931, 'csn1m': 1004739}
TYPES = [t for t in ('intel', 'amd', 'arm', 'box', 'mac') if t in J['R']]
TNAME = {'intel': 'Intel Xeon 6975P-C', 'amd': 'AMD EPYC 9R45', 'arm': 'Graviton4', 'box': 'EPYC Milan (box)', 'mac': 'Apple M3 Max'}
plt.rcParams.update({'font.size': 8, 'axes.titlesize': 8, 'legend.fontsize': 7})

B = collections.defaultdict(dict)
for r in J['B']:
    B[(r['type'], r['set'], r['model'], r['f'])][r['system']] = r

fig, axs = plt.subplots(1, len(TYPES), figsize=(1.9 * len(TYPES) + 0.6, 2.4), sharey=True, squeeze=False)
for ax, t in zip(axs[0], TYPES):
    for m, mk in (('CodeRankEmbed', 'o'), ('jina-v2-base-code', 's'), ('bge-base-en-v1.5', '^')):  # o, s: code sets; ^: BEIR (bge)
        pts = []
        for s, n in sorted(SIZE.items(), key=lambda kv: kv[1]):
            if s in ('quora', 'fiqa') and m != 'bge-base-en-v1.5' or s not in ('quora', 'fiqa') and m == 'bge-base-en-v1.5':
                continue  # lines join the code sets of the code models; BEIR sets are drawn with bge only
            d = B.get((t, s, m, 0.99), {}); o = d.get('ours_cascade')
            riv = sorted((x['us'], k) for k, x in d.items() if not k.startswith('ours') and k != 'faiss_exact' and x['meets_point'])
            ex = d.get('faiss_exact')
            if o:
                pts.append((n, o['us'], riv[0][0] if riv else None, ex['us'] if ex else None))
        if not pts:
            continue
        x = [p[0] for p in pts]
        ax.plot(x, [p[1] for p in pts], marker=mk, color='C0', lw=1, ms=3, label='ours' if m == 'CodeRankEmbed' else None)
        ax.plot([p[0] for p in pts if p[2]], [p[2] for p in pts if p[2]], marker=mk, color='C3', lw=1, ms=3, ls='--',
                label='fastest rival meeting f' if m == 'CodeRankEmbed' else None)
        ax.plot([p[0] for p in pts if p[3]], [p[3] for p in pts if p[3]], marker=mk, color='0.6', lw=0.8, ms=2, ls=':',
                label='exact (float32)' if m == 'CodeRankEmbed' else None)
    ax.set_xscale('log'); ax.set_yscale('log'); ax.set_title(TNAME[t]); ax.set_xlabel('vectors'); ax.grid(alpha=0.3, which='both', lw=0.3)
axs[0][0].set_ylabel('held-out µs per query (f = 0.99)')
axs[0][0].legend(loc='upper left', frameon=False)
fig.tight_layout(); fig.savefig(os.path.join(HERE, 'figures', 'size.pdf')); plt.close(fig)

A = collections.defaultdict(list)
for r in J['A']:
    if r['C'] == 400 and r['H'] == 100:
        A[(r['type'], r['set'], r['model'], r['system'])].append(r)


def eff_val(e):
    try:
        return float(e.split()[-1])
    except ValueError:
        return 0.0


GENS = ['ours_scan', 'ours_walk', 'faiss_bin_flat', 'faiss_bin_hnsw', 'usearch_b1_rescore', 'hnswlib_f32', 'faiss_hnsw_flat', 'scann', 'diskann_vamana']
fig, axs = plt.subplots(1, len(TYPES), figsize=(1.9 * len(TYPES) + 0.6, 2.9), sharey=True, squeeze=False)
for ax, t in zip(axs[0], TYPES):
    for i, g in enumerate(GENS):
        pts = []
        for s, n in sorted(SIZE.items(), key=lambda kv: kv[1]):
            m = 'bge-base-en-v1.5' if s in ('quora', 'fiqa') else 'CodeRankEmbed'
            v = sorted(A.get((t, s, m, g), []), key=lambda r: eff_val(r['effort']))
            if v and not (g == 'ours_scan' and s in ('quora', 'csn1m')):  # above 150k vectors our scan is the walk
                pts.append((n, v[0]['us']))
        if pts:
            ax.plot([p[0] for p in pts], [p[1] for p in pts], marker='o', ms=2.5, lw=1.2 if g.startswith('ours') else 0.8,
                    color=f'C{i}', label=g)
    ax.set_xscale('log'); ax.set_yscale('log'); ax.set_title(TNAME[t]); ax.set_xlabel('vectors'); ax.grid(alpha=0.3, which='both', lw=0.3)
axs[0][0].set_ylabel('(A) µs per query, C 400 / H 100')
h, l = axs[0][0].get_legend_handles_labels()
fig.legend(h, l, loc='lower center', ncol=5, frameon=False)
fig.tight_layout(rect=(0, 0.14, 1, 1)); fig.savefig(os.path.join(HERE, 'figures', 'compA.pdf')); plt.close(fig)
print('figures: size.pdf compA.pdf')
