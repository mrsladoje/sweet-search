# Figures of the paper draft.
#   python figures.py results-paper.json [--pareto ../rep-pareto.json --rep-shortlists ../shortlists]
# size.pdf   comparison (B), held-out, f = 0.99: ours, the rival fastest on dev, exact search; one panel per CPU,
#            one column of markers per set (sets ordered by size, not joined: set, model and size are confounded)
# compA.pdf  comparison (A) at C 400 / H 100, smaller declared effort: total latency per generator and set
# pareto.pdf replication dev sweeps: dev latency against dev retained share, the lower envelope per system
import argparse, collections, json, os, sys
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from paperlib import headline  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser(); ap.add_argument('json'); ap.add_argument('--pareto'); ap.add_argument('--rep-shortlists')
a = ap.parse_args()
J = json.load(open(a.json))
SIZE = {'gcsn': 6918, 'd20k': 20000, 'advtest': 21731, 'fiqa': 57638, 'dall': 140449, 'quora': 522931, 'csn1m': 1004739}
ORDER = sorted(SIZE, key=SIZE.get)
LABEL = {'gcsn': 'gcsn 7k', 'd20k': 'd20k 20k', 'advtest': 'AdvTest 22k', 'fiqa': 'FiQA 58k', 'dall': 'dall 140k',
         'quora': 'Quora 523k', 'csn1m': 'csn1m 1M'}
TYPES = [t for t in ('intel', 'amd', 'arm', 'box', 'mac') if t in J['R']]
TNAME = {'intel': 'Intel Xeon 6975P-C', 'amd': 'AMD EPYC 9R45', 'arm': 'Graviton4', 'box': 'EPYC Milan (box)', 'mac': 'Apple M3 Max'}
plt.rcParams.update({'font.size': 9, 'axes.titlesize': 9, 'legend.fontsize': 8, 'xtick.labelsize': 7.5})
MODELS = (('CodeRankEmbed', 'o', -0.22), ('jina-v2-base-code', 's', 0.0), ('bge-base-en-v1.5', '^', 0.22))


def grid(ax, t):
    ax.set_yscale('log'); ax.set_title(TNAME[t]); ax.grid(alpha=0.3, which='both', axis='y', lw=0.3)
    ax.set_xticks(range(len(ORDER))); ax.set_xticklabels([LABEL[s] for s in ORDER], rotation=50, ha='right', rotation_mode='anchor')
    for i in range(1, len(ORDER)):
        ax.axvline(i - 0.5, color='0.85', lw=0.5)


B = collections.defaultdict(dict)
for r in J['B']:
    B[(r['type'], r['set'], r['model'], r['f'])][r['system']] = r
rows = [TYPES[:3], TYPES[3:]] if len(TYPES) > 3 else [TYPES]
fig, axs = plt.subplots(len(rows), 3, figsize=(7.2, 2.7 * len(rows)), sharey=True, squeeze=False)
for ri, row in enumerate(rows):
    for ci in range(3):
        ax = axs[ri][ci]
        if ci >= len(row):
            ax.axis('off'); continue
        t = row[ci]
        for m, mk, dx in MODELS:
            for i, s in enumerate(ORDER):
                d = B.get((t, s, m, 0.99), {}); h = headline(d, t, s, m, 0.99)
                if not h:
                    continue
                ex = d.get('faiss_exact')
                lab = lambda x: x if (ri, ci, m, i) == (0, 0, 'CodeRankEmbed', 0) else None
                ax.plot(i + dx, h[0]['us'], mk, color='C0', ms=4, label=lab('ours'))
                ax.plot(i + dx, h[2]['us'], mk, mfc='none', color='C3', ms=4, label=lab('rival fastest on dev'))
                if ex:
                    ax.plot(i + dx, ex['us'], mk, color='0.6', ms=2.5, label=lab('exact float32'))
        grid(ax, t)
    axs[ri][0].set_ylabel('held-out µs per query')
h, l = axs[0][0].get_legend_handles_labels()
fig.legend(h, l, loc='lower center', ncol=3, frameon=False, title='circle: CodeRankEmbed, square: jina, triangle: bge', title_fontsize=7.5)
fig.tight_layout(rect=(0, 0.07 if len(rows) > 1 else 0.13, 1, 1)); fig.savefig(os.path.join(HERE, 'figures', 'size.pdf')); plt.close(fig)

A = collections.defaultdict(list)
for r in J['A']:
    if r['C'] == 400 and r['H'] == 100:
        A[(r['type'], r['set'], r['model'], r['system'])].append(r)


def eff_val(e):
    """The declared effort as a tuple of its numbers in field order (ScaNN: leaves, then reorder), so the
    smaller of the two declared efforts sorts first for every family."""
    import re
    return tuple(float(x) for x in re.findall(r'[-+]?\d+(?:\.\d+)?', e)) or (0.0,)


GENS = ['ours_scan', 'ours_walk', 'faiss_bin_flat', 'faiss_bin_hnsw', 'usearch_b1_rescore', 'hnswlib_f32', 'faiss_hnsw_flat', 'scann', 'diskann_vamana']
MK = 'oosDv^<>p'
fig, axs = plt.subplots(len(rows), 3, figsize=(7.2, 2.7 * len(rows)), sharey=True, squeeze=False)
for ri, row in enumerate(rows):
    for ci in range(3):
        ax = axs[ri][ci]
        if ci >= len(row):
            ax.axis('off'); continue
        t = row[ci]
        for gi, g in enumerate(GENS):
            dx = (gi - (len(GENS) - 1) / 2) * 0.08
            for i, s in enumerate(ORDER):
                m = 'bge-base-en-v1.5' if s in ('quora', 'fiqa') else 'CodeRankEmbed'
                v = sorted(A.get((t, s, m, g), []), key=lambda r: eff_val(r['effort']))
                if v and not (g == 'ours_scan' and s in ('quora', 'csn1m')):  # above 150k vectors our scan is the walk
                    ax.plot(i + dx, v[0]['us'], MK[gi], color=f'C{gi}', ms=4 if g.startswith('ours') else 3,
                            label=g if (ri, ci, i) == (0, 0, 0) or (g == 'diskann_vamana' and (ri, ci) == (0, 0) and i == 1) else None)
        grid(ax, t)
    axs[ri][0].set_ylabel('(A) µs per query, C 400 / H 100')
hl = {}
for ax in axs.flat:
    for h_, l_ in zip(*ax.get_legend_handles_labels()):
        hl.setdefault(l_, h_)
fig.legend(list(hl.values()), list(hl.keys()), loc='lower center', ncol=5, frameon=False)
fig.tight_layout(rect=(0, 0.08 if len(rows) > 1 else 0.16, 1, 1)); fig.savefig(os.path.join(HERE, 'figures', 'compA.pdf')); plt.close(fig)

if a.pareto:
    P = json.load(open(a.pareto))
    riv = {}
    for t in ('intel', 'amd', 'arm'):
        sl = json.load(open(os.path.join(a.rep_shortlists, f'shortlist-rep-{t}.json')))
        for s in ('cqadup', 'msmarco1m'):
            riv[(t, s)] = sl[s]['rival']
    SN = {'cqadup': 'CQADupStack (457k)', 'msmarco1m': 'MS MARCO (1M)'}
    fig, axs = plt.subplots(2, 3, figsize=(7.2, 5.0), sharey='row', squeeze=False)
    for ri, s in enumerate(('cqadup', 'msmarco1m')):
        for ci, t in enumerate(('intel', 'amd', 'arm')):
            ax = axs[ri][ci]; by = collections.defaultdict(list)
            for p in P:
                if p['type'] == t and p['set'] == s:
                    by[p['point']['system']].append((p['share'], p['latency_us']))
            for sysn, pts in sorted(by.items()):
                env, best = [], float('inf')  # lower envelope: fastest point at or above each share
                for sh, us in sorted(pts, reverse=True):
                    if us < best:
                        best = us; env.append((sh, us))
                env = [e for e in env if e[0] >= 0.95]
                if not env:
                    continue
                env.sort()
                if sysn == 'ours_cascade':
                    kw = dict(color='C0', lw=1.6, marker='o', ms=3, zorder=5, label='ours')
                elif sysn == riv[(t, s)]:
                    kw = dict(color='C3', lw=1.3, marker='s', ms=2.5, zorder=4, label=f'{sysn} (rival)')
                else:
                    kw = dict(color='0.7', lw=0.7, zorder=1, label='other rivals' if sysn == sorted(by)[0] else None)
                ax.step([e[0] for e in env], [e[1] for e in env], where='post', **kw)
            ax.axvline(0.99, color='k', lw=0.6, ls=':')
            ax.set_xlim(0.95, 1.0005); ax.set_yscale('log'); ax.grid(alpha=0.3, which='both', lw=0.3)
            ax.set_title(f"{ {'intel': 'Intel', 'amd': 'AMD', 'arm': 'Graviton4'}[t]}, {SN[s]}", fontsize=8)
            if ci == 0:
                ax.set_ylabel('dev µs per query')
            ax.legend(loc='upper left', frameon=False, fontsize=6.5)
    fig.supxlabel('dev retained share of exact nDCG@10 (dotted: 0.99)', fontsize=9)
    fig.tight_layout(); fig.savefig(os.path.join(HERE, 'figures', 'pareto.pdf')); plt.close(fig)
print('figures written')
