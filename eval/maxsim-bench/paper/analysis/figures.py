# ~/.ss-eval/maxsim-analysis/venv-plot/bin/python -I paper/analysis/figures.py
#
# Post-freeze analysis code (not frozen). Builds every paper figure as vector PDF from the
# aggregate tables in paper/analysis/tables/*.json (no raw result file is read here), so a
# figure rebuilds with one command. Needs only matplotlib and numpy (a separate plotting
# venv; the frozen benchmark venv is not changed).
#
# Colours: one fixed colour per library in every figure (categorical slots of the dataviz
# reference palette, validated for colour-vision deficiency in this order); every library
# also has its own marker, so identity never rests on colour alone. Sweep heatmaps use a
# diverging blue-red scale on log2(ratio) with a grey midpoint at ratio 1.
import json, math, os

import matplotlib
matplotlib.use('pdf')
import matplotlib.pyplot as plt  # noqa: E402
import matplotlib.ticker  # noqa: E402
from matplotlib.colors import LinearSegmentedColormap, TwoSlopeNorm  # noqa: E402
import numpy as np  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
T = os.path.join(HERE, 'tables')
FIG = os.path.join(os.path.dirname(HERE), 'figures')
PLAT = ['intel', 'amd', 'arm', 'm3max', 'epyc']
PNAME = {'intel': 'Xeon 6 (GNR)', 'amd': 'EPYC 9R45 (Zen 5)', 'arm': 'Graviton4', 'm3max': 'Apple M3 Max', 'epyc': 'EPYC 7003 (Zen 3)'}
LIB = {  # colour, marker, label
    'ours': ('#2a78d6', 'o', 'sweet kernel (int4)'),
    'numpy': ('#eb6834', 's', 'NumPy'),
    'torch': ('#1baf7a', '^', 'PyTorch'),
    'maxsim_cpu': ('#eda100', 'D', 'maxsim-cpu'),
    'nextplaid': ('#e87ba4', 'v', 'NextPlaid'),
    'numkong': ('#6250d6', 'P', 'NumKong (approx.)'),
    'torch_bf16': ('#1baf7a', '<', 'PyTorch bf16'),
}
INK, MUTED, GRID = '#0b0b0b', '#52514e', '#e4e3df'
BM25 = {}

plt.rcParams.update({'font.size': 7.5, 'axes.titlesize': 8, 'axes.labelsize': 7.5, 'legend.fontsize': 7, 'xtick.labelsize': 7,
                     'ytick.labelsize': 7, 'pdf.fonttype': 42, 'ps.fonttype': 42, 'axes.edgecolor': MUTED, 'axes.labelcolor': INK,
                     'xtick.color': MUTED, 'ytick.color': MUTED, 'axes.linewidth': 0.6, 'lines.linewidth': 1.2, 'font.family': 'DejaVu Sans'})


def load(name):
    p = os.path.join(T, name)
    return json.load(open(p)) if os.path.exists(p) else {}


def libkey(row):
    if row['lib'] == 'torch' and row['itype'] == 'bf16':
        return 'torch_bf16'
    return row['lib'] if row['lib'] in LIB else None


def fig_ratios():
    sp = load('speed.json')['warm']
    work = [('agent-ho', 'Agent calls (agent-ho)\npreviously examined'), ('gcsn-ho', 'GCSN calls (gcsn-ho)\npreviously examined'),
            ('beir', 'BEIR, 20 sets\nfresh held-out')]
    plats = [p for p in PLAT if p in sp]
    libs = ['numpy', 'torch', 'torch_bf16', 'maxsim_cpu', 'nextplaid', 'numkong']
    fig, axes = plt.subplots(1, 3, figsize=(7.0, 2.6), sharey=True)
    for ax, (w, title) in zip(axes, work):
        ax.axvline(1, color=INK, lw=0.8)
        for i, p in enumerate(plats):
            rows = [r for r in sp[p].get(w, []) if 'ratio' in r]
            for j, L in enumerate(libs):
                cand = [r for r in rows if libkey(r) == L and (r['itype'] in ('f32', 'bf16') or L == 'numkong')]
                if L == 'numkong':
                    cand = [min(cand, key=lambda r: r['ratio'])] if cand else []
                cand = [r for r in cand if r['lib'] != 'numpy+blis']
                if not cand:
                    continue
                r = cand[0]
                y = i + (j - (len(libs) - 1) / 2) * 0.12
                c, m, _ = LIB[L]
                ax.errorbar(r['ratio'], y, xerr=[[r['ratio'] - r['lo']], [r['hi'] - r['ratio']]], fmt=m, color=c, ms=3.6,
                            mec='white', mew=0.4, elinewidth=0.9, capsize=0)
        ax.set_xscale('log')
        ax.set_xlim(0.25, 20)
        ax.set_xticks([0.25, 0.5, 1, 2, 4, 8, 16]); ax.set_xticklabels(['0.25', '0.5', '1', '2', '4', '8', '16'])
        ax.grid(axis='x', color=GRID, lw=0.5); ax.set_axisbelow(True)
        ax.set_title(title, color=INK)
        for s in ('top', 'right'):
            ax.spines[s].set_visible(False)
    axes[0].set_yticks(range(len(plats))); axes[0].set_yticklabels([PNAME[p] for p in plats]); axes[0].invert_yaxis()
    handles = [plt.Line2D([], [], marker=LIB[L][1], color=LIB[L][0], ls='', ms=4, label=LIB[L][2]) for L in libs]
    fig.supxlabel('rival time / sweet kernel time, geometric mean over calls (> 1: sweet kernel faster); bars: 95% workload interval',
                  fontsize=7.5, color=INK, y=0.09)
    fig.legend(handles=handles, loc='lower center', ncol=6, frameon=False, bbox_to_anchor=(0.5, -0.02))
    fig.tight_layout(rect=(0, 0.1, 1, 1))
    fig.savefig(os.path.join(FIG, 'ratios.pdf'), bbox_inches='tight', pad_inches=0.02); plt.close(fig)


def fig_sweep():
    sw = load('speed.json')['sweep']
    plats = [p for p in PLAT if p in sw]
    qs, pools, lens = [8, 32, 64], [1, 4, 16, 64, 256, 1024, 4096], ['nat', '32', '128', '512']
    cmap = LinearSegmentedColormap.from_list('div', ['#c0392b', '#e34948', '#f3a6a2', '#f0efec', '#9cc2ee', '#2a78d6', '#164f94'])
    norm = TwoSlopeNorm(vmin=-2, vcenter=0, vmax=2)
    fig, axes = plt.subplots(len(plats), 3, figsize=(7.0, 1.75 * len(plats)), squeeze=False)
    for i, p in enumerate(plats):
        for j, q in enumerate(qs):
            ax = axes[i][j]
            M = np.full((len(pools), len(lens)), np.nan); lab = [[''] * len(lens) for _ in pools]
            for a, d in enumerate(pools):
                for b, ln in enumerate(lens):
                    c = sw[p].get(f'q{q}-d{d}-len{ln}')
                    if c and c['best']:
                        M[a, b] = math.log2(c['best']['ratio'])
                        lab[a][b] = f"{c['best']['ratio']:.2f}"
            ax.imshow(M, cmap=cmap, norm=norm, aspect='auto')
            for a in range(len(pools)):
                for b in range(len(lens)):
                    if lab[a][b]:
                        ax.text(b, a, lab[a][b], ha='center', va='center', fontsize=5.6,
                                color='white' if abs(M[a, b]) > 1.2 else INK)
                    else:
                        ax.text(b, a, '—', ha='center', va='center', fontsize=5.6, color=MUTED)
            ax.set_xticks(range(len(lens))); ax.set_xticklabels(['natural', '32', '128', '512'])
            ax.set_yticks(range(len(pools))); ax.set_yticklabels([str(x) for x in pools] if j == 0 else [])
            ax.tick_params(length=0)
            for s in ax.spines.values():
                s.set_visible(False)
            if i == 0:
                ax.set_title(f'{q} query tokens', color=INK)
            if j == 0:
                ax.set_ylabel(f'{PNAME[p]}\ndocs per call', color=INK)
            if i == len(plats) - 1:
                ax.set_xlabel('doc tokens')
    fig.tight_layout()
    fig.savefig(os.path.join(FIG, 'sweep.pdf'), bbox_inches='tight', pad_inches=0.02); plt.close(fig)


def fig_budget():
    bd = load('budget.json')
    global BM25
    BM25 = load('quality_extra.json').get('bm25', {})
    plats = [p for p in PLAT if p in bd]
    cells = ['scifact|colbertv2', 'nfcorpus|colbertv2', 'scifact|answersmall', 'nfcorpus|answersmall']
    fig, axes = plt.subplots(len(plats), 4, figsize=(7.0, 1.6 * len(plats) + 0.4), squeeze=False)
    for i, p in enumerate(plats):
        for j, cell in enumerate(cells):
            ax = axes[i][j]
            curves = bd[p].get(cell, {}).get('curves', {})
            fs = curves.get('f32store')
            if fs:
                ax.plot([x['p95_ms'] for x in fs['points']], [x['ndcg10'] for x in fs['points']], marker='x', color=INK, ls='--', ms=3, lw=0.9, zorder=4)
            for arm, c in sorted(curves.items(), key=lambda x: x[0] != 'ours'):
                if arm == 'f32store':
                    continue
                lab = c['label']
                if 'int4-self' in lab:
                    continue
                L = ('ours' if arm == 'ours' else 'torch_bf16' if lab.startswith('PyTorch, bf16') else
                     next((k for k, v in (('numpy', 'NumPy'), ('torch', 'PyTorch'), ('maxsim_cpu', 'maxsim-cpu'), ('nextplaid', 'NextPlaid'),
                                          ('numkong', 'NumKong')) if lab.startswith(v)), None))
                if L is None:
                    continue
                pts = [x for x in c['points'] if x['ndcg10'] is not None]
                ax.plot([x['p95_ms'] for x in pts], [x['ndcg10'] for x in pts], marker=LIB[L][1], color=LIB[L][0], ms=2.8, lw=1.0,
                        mec='white', mew=0.3, zorder=3 if L == 'ours' else 2)
            bm = BM25.get(f'{cell}|k100')
            if bm is not None:
                ax.axhline(bm, color=MUTED, ls=':', lw=0.9, zorder=1)
            ax.set_xscale('log')
            ax.grid(color=GRID, lw=0.5); ax.set_axisbelow(True)
            for s in ('top', 'right'):
                ax.spines[s].set_visible(False)
            if i == 0:
                ds, mk = cell.split('|')
                ax.set_title(f"{'SciFact' if ds == 'scifact' else 'NFCorpus'}\n{'ColBERTv2' if mk == 'colbertv2' else 'AnswerAI-small'}", color=INK)
            if j == 0:
                ax.set_ylabel(f'{PNAME[p]}\nnDCG@10', color=INK)
            if i == len(plats) - 1:
                ax.set_xlabel('per-request p95, ms')
    handles = [plt.Line2D([], [], marker=LIB[L][1], color=LIB[L][0], ms=4, label=LIB[L][2])
               for L in ('ours', 'numpy', 'torch', 'torch_bf16', 'maxsim_cpu', 'nextplaid', 'numkong')]
    handles[-1] = plt.Line2D([], [], marker=LIB['numkong'][1], color=LIB['numkong'][0], ms=4, label='NumKong (approx.), every input type')
    handles.append(plt.Line2D([], [], marker='x', color=INK, ls='--', ms=4, label='float32 storage (constructed)'))
    handles.append(plt.Line2D([], [], color=MUTED, ls=':', label='BM25 order (no reranking)'))
    fig.legend(handles=handles, loc='lower center', ncol=3, frameon=False, bbox_to_anchor=(0.5, -0.005))
    fig.tight_layout(rect=(0, 0.075, 1, 1))
    fig.savefig(os.path.join(FIG, 'budget.pdf'), bbox_inches='tight', pad_inches=0.02); plt.close(fig)


def fig_conc():
    cc = load('conc.json')
    plats = [p for p in PLAT if p in cc]
    fig, axes = plt.subplots(2, len(plats), figsize=(7.0, 3.2), squeeze=False)
    groups = {'ours': lambda a: a == 'ours', 'numpy': lambda a: a.startswith('numpy') and 'blis' not in a,
              'torch': lambda a: a.startswith('torch'), 'maxsim_cpu': lambda a: a.startswith('maxsim_cpu'),
              'nextplaid': lambda a: a.startswith('nextplaid'), 'numkong': lambda a: a.startswith('numkong')}
    for j, p in enumerate(plats):
        for i, fam in enumerate(('agent', 'gcsn')):
            ax = axes[i][j]
            arms = cc[p].get(fam, {})
            for L, pred in groups.items():
                xs, ys = [], []
                for n in (1, 4, 16):
                    best = [r['throughput'] for a, d in arms.items() if pred(a) for r in d['runs'] if r['type'] == 'closed' and r['callers'] == n]
                    if best:
                        xs.append(n); ys.append(max(best) / 1000)
                if xs:
                    ax.plot(xs, ys, marker=LIB[L][1], color=LIB[L][0], ms=3, lw=1.0, mec='white', mew=0.3)
            ax.set_xscale('log', base=2); ax.set_xticks([1, 4, 16]); ax.set_xticklabels(['1', '4', '16'])
            ax.set_yscale('log')
            ax.yaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: f'{v:g}'))
            ax.yaxis.set_minor_formatter(matplotlib.ticker.NullFormatter())
            ax.grid(color=GRID, lw=0.5); ax.set_axisbelow(True)
            for s in ('top', 'right'):
                ax.spines[s].set_visible(False)
            if i == 0:
                ax.set_title(PNAME[p], color=INK)
            if j == 0:
                ax.set_ylabel(f"{'agent-ho' if fam == 'agent' else 'gcsn-ho'}\nkcalls/s", color=INK)
            if i == 1:
                ax.set_xlabel('callers')
    handles = [plt.Line2D([], [], marker=LIB[L][1], color=LIB[L][0], ms=4, label=LIB[L][2]) for L in groups]
    fig.legend(handles=handles, loc='lower center', ncol=6, frameon=False, bbox_to_anchor=(0.5, -0.01))
    fig.tight_layout(rect=(0, 0.08, 1, 1))
    fig.savefig(os.path.join(FIG, 'conc.pdf'), bbox_inches='tight', pad_inches=0.02); plt.close(fig)


if __name__ == '__main__':
    os.makedirs(FIG, exist_ok=True)
    fig_ratios(); fig_sweep(); fig_budget(); fig_conc()
    print('figures written to', FIG)
