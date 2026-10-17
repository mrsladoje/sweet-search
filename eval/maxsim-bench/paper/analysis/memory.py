# venv/bin/python -I paper/analysis/memory.py
#
# Post-freeze analysis code (not frozen). RAM per arm (W11) across machines: reads the
# summary block of every ho-mem record (one untimed pass per arm and set in a fresh process)
# and writes tables/memory.json and tables/memory.md. Per arm and set group (agent-ho,
# gcsn-ho, BEIR dim 128, BEIR dim 96, size sweep): resident bytes per stored doc token
# (median over the sets of the group), peak temporary memory for the median-size call and
# for the largest call, and the computed bytes beside.
import glob, json, os, sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import PLATFORMS, SHORT, OUT, dump, family  # noqa: E402

CLOUD = os.path.expanduser('~/.ss-eval/maxsim-cloud/s8')
LOCAL = os.path.expanduser('~/.ss-eval/maxsim-local')


def group_of(s):
    f = family(s)
    if f == 'beir':
        return 'beir-dim96' if 'answersmall' in s else 'beir-dim128'
    return {'agent': 'agent-ho', 'gcsn': 'gcsn-ho', 'sweep': 'sweep'}.get(f, f)


def mem_files(platform):
    if platform in ('intel', 'amd', 'arm'):
        return sorted(glob.glob(os.path.join(CLOUD, f'{platform}-[0-9]*', 'ho-mem', '*', '*.r0.p0.json')))
    return sorted(glob.glob(os.path.join(LOCAL, platform, 'ho-mem', '*', '*.r0.p0.json')))


def main():
    res = {}
    for p in PLATFORMS:
        recs = {}
        for f in mem_files(p):
            d = json.load(open(f))
            if not d.get('complete'):
                continue
            g = group_of(os.path.basename(os.path.dirname(f)))
            recs.setdefault(g, {}).setdefault(d['arm'], []).append(d['summary'])
        if not recs:
            continue
        res[p] = {}
        for g, arms in recs.items():
            res[p][g] = {}
            for arm, ss in arms.items():
                med = lambda k: float(np.median([s[k] for s in ss]))
                res[p][g][arm] = dict(
                    sets=len(ss), resident_B_per_token=med('resident_bytes_per_token'),
                    store_B_per_token=float(np.median([s['store_bytes_per_token'] if s['uses_store'] else 0 for s in ss])),
                    own_copy_B_per_token=med('arm_copy_bytes_per_token'),
                    temp_median_call_KiB=float(np.median([s['score_temp'].get('p50', {}).get('temp', 0) for s in ss])) / 1024,
                    temp_largest_call_MiB=float(max(s['score_temp'].get('max', {}).get('temp', 0) for s in ss)) / 1048576,
                    prepare_peak_MiB=float(max(s['prep_peak_bytes'] for s in ss)) / 1048576,
                    library_MiB=med('library_delta_bytes') / 1048576,
                    computed=ss[0].get('computed_bytes_per_token'))
    dump('memory.json', res)
    L = ['# RAM per arm (held-out sets; untimed pass in a fresh process; resident memory, not cache traffic)', '',
         'resident B/token = int4 store (arms that read it when scoring) + the arm\'s own prepared copy; temp = peak above the '
         'resident memory before scoring, one call. Median over the sets of each group; largest-call and prepare peaks = max.', '']
    for p, gs in res.items():
        for g, arms in sorted(gs.items()):
            L += [f'## {SHORT[p]} — {g}', '', '| arm | sets | resident B/token | store | own copy | computed int4 / f32 / bf16 | temp median call KiB | temp largest call MiB | prepare peak MiB |',
                  '|---|--:|--:|--:|--:|--:|--:|--:|--:|']
            for arm in sorted(arms, key=lambda a: (a != 'ours', not a.startswith('node'), a)):
                r = arms[arm]; c = r['computed'] or {}
                L.append(f"| `{arm}` | {r['sets']} | {r['resident_B_per_token']:.1f} | {r['store_B_per_token']:.1f} | {r['own_copy_B_per_token']:.1f} | "
                         f"{c.get('int4', '?')} / {c.get('f32', '?')} / {c.get('bf16', '?')} | {r['temp_median_call_KiB']:.0f} | {r['temp_largest_call_MiB']:.2f} | {r['prepare_peak_MiB']:.0f} |")
            L.append('')
    open(os.path.join(OUT, 'memory.md'), 'w').write('\n'.join(L) + '\n')


if __name__ == '__main__':
    main()
