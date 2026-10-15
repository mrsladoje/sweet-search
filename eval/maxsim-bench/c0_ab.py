# python3 c0_ab.py <group dir> <base arm> <cand arm>     (C0 A/B, PAPER_PLAN.md S5.5-S5.7)
# python3 c0_ab.py --aa <group dir> <arm> <copy arm>      (A/A noise: cv and band n)
#
# A/B: reads run_matrix.py results of one group (jobs.json maps arms to files; both arms ran
# with --keep-scores). Per set (sweep cells pooled as "sweep-dev", and also per cell) and per
# round: the geometric mean over calls of base time / candidate time (per-call median of
# the timed repetitions; above 1 = the candidate is faster), and the share of calls whose
# scores are the same f64 in both arms (the bit-identical gate). Dev data only.
#
# A/A: per set, the geometric-mean time of each arm in each process repetition; cv = the
# coefficient of variation over repetitions of the ratio copy / arm; band n = max(1%, 2 cv).
import collections, json, math, os, statistics, sys


def load(gdir):
    jobs = json.load(open(os.path.join(gdir, 'jobs.json')))['jobs']
    out = collections.defaultdict(dict)   # (arm, round, proc) -> {(set, file): call}
    for j in jobs:
        f = os.path.join(gdir, j['file'])
        if not os.path.exists(f):
            continue
        d = json.load(open(f))
        out[(j['arm'], j['round'], j['proc'])] = {(c['set'], c['file']): c for c in d['calls']}
    return out


def med(c):
    t = sorted(c['ts_ns'])
    return t[len(t) // 2]


def family(s):
    return 'sweep-dev' if s.startswith(('q', 'sweep')) and s not in ('agent-dev', 'gcsn-dev') else s


def ab(gdir, base, cand):
    R = load(gdir)
    rounds = sorted({r for (a, r, p) in R if a == base})
    print(f'{gdir}\n  speedup = base/cand geomean (above 1: {cand} faster); same = calls with identical scores')
    for fam_mode in ('family', 'set'):
        rows = collections.defaultdict(lambda: collections.defaultdict(list))
        same = collections.defaultdict(lambda: [0, 0])
        for r in rounds:
            B, C = R[(base, r, 0)], R[(cand, r, 0)]
            for k, cb in B.items():
                cc = C.get(k)
                if cc is None:
                    continue
                key = family(k[0]) if fam_mode == 'family' else k[0]
                rows[key][r].append(math.log(med(cb) / med(cc)))
                if 'scores' in cb and 'scores' in cc:
                    s = same[key]; s[1] += 1; s[0] += cb['scores'] == cc['scores']
        if fam_mode == 'set' and len(rows) <= 3:
            continue
        print(f'  -- per {fam_mode}')
        for key in sorted(rows):
            parts = '  '.join(f'r{r}: {math.exp(statistics.fmean(v)):.3f} (n={len(v)})' for r, v in sorted(rows[key].items()))
            s = same[key]
            print(f'  {key:<22} {parts}   same {s[0]}/{s[1]}')


def aa(gdir, arm, copy):
    R = load(gdir)
    procs = sorted({p for (a, r, p) in R if a == arm})
    sets = sorted({family(k[0]) for k in R[(arm, 0, 0)]})
    for s in sets:
        ratios, gm = [], []
        for p in procs:
            for r in sorted({r for (a, r, q) in R if a == arm and q == p}):
                A, C = R[(arm, r, p)], R[(copy, r, p)]
                v = [math.log(med(C[k]) / med(A[k])) for k in A if family(k[0]) == s and k in C]
                ratios.append(math.exp(statistics.fmean(v)))
                gm.append(math.exp(statistics.fmean(math.log(med(A[k])) for k in A if family(k[0]) == s)))
        cv = statistics.pstdev(ratios) / statistics.fmean(ratios)
        cvg = statistics.pstdev(gm) / statistics.fmean(gm)
        print(f'{s:<12} runs={len(ratios)} copy/arm geomean per run: {" ".join(f"{x:.3f}" for x in ratios)}  cv(ratio)={cv:.4f}  '
              f'cv(set geomean)={cvg:.4f}  band n=max(1%, 2cv)={max(0.01, 2 * cvg):.4f}')


if __name__ == '__main__':
    if sys.argv[1] == '--aa':
        aa(*sys.argv[2:5])
    else:
        ab(*sys.argv[1:4])
