# python3 analyze.py <set> <round...>
import json, sys, random, math
import statistics as st
set_, rounds = sys.argv[1], sys.argv[2:]
def pct(a, p): a = sorted(a); return a[min(len(a)-1, int(len(a)*p))]
for r in rounds:
    o = json.load(open(f'ours-{set_}-{r}.json')); t = json.load(open(f'theirs-{set_}-{r}.json'))
    arms = {f'ours:{k}': v for k, v in o['variants'].items()} | {k: v for k, v in t['arms'].items()}
    n = len(o['calls'])
    print(f'\n### set={set_} round={r} calls={n} reps={o["reps"]}')
    print(f'| arm | p50 ms | p95 ms | p99 ms | total s | calls/s |')
    print('|---|---|---|---|---|---|')
    for a, v in arms.items():
        l = v['lat']; print(f'| {a} | {pct(l,.5):.3f} | {pct(l,.95):.3f} | {pct(l,.99):.3f} | {sum(l)/1e3:.2f} | {n/(sum(l)/1e3):.0f} |')
    base = arms['ours:int4']['lat']
    print('\nper-call speed ratio (other / ours:int4; >1 = ours faster), geomean + 95% bootstrap CI:')
    random.seed(42)
    for a, v in arms.items():
        if a == 'ours:int4': continue
        lr = [math.log(x / y) for x, y in zip(v['lat'], base)]
        g = math.exp(st.mean(lr)); bs = sorted(math.exp(st.mean(random.choices(lr, k=len(lr)))) for _ in range(1000))
        wins = sum(1 for x in lr if x > 0) / len(lr)
        print(f'  {a}: {g:.2f}x [{bs[25]:.2f}, {bs[974]:.2f}]  ours faster on {wins*100:.0f}% of calls')
    # parity vs maxsim_cpu and vs captured production scores
    def rank(s): return sorted(range(len(s)), key=lambda i: -s[i])
    for other in ['maxsim_cpu', 'ours:int8']:
        top1 = top5 = 0; maxd = 0; cnt = 0
        for i in range(n):
            a = arms['ours:int4']['scores'][i]; b = arms[other]['scores'][i]
            maxd = max(maxd, max(abs(x - y) for x, y in zip(a, b)))
            ra, rb = rank(a), rank(b); top1 += ra[0] == rb[0]
            k = min(5, len(a)); top5 += len(set(ra[:k]) & set(rb[:k])) / k; cnt += 1
        print(f'  parity ours:int4 vs {other}: max|diff|={maxd:.2e} top1-agree={top1/cnt*100:.2f}% top5-overlap={top5/cnt*100:.2f}%')
    refd = max(max(abs(x - y) for x, y in zip(arms['ours:int4']['scores'][i], o['calls'][i]['ref'])) for i in range(n))
    print(f'  ours:int4 vs captured production scores: max|diff|={refd:.2e}')
