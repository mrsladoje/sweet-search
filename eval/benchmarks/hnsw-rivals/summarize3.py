# Per dataset: sweet vs each rival config at matched quality (aggregate only).
import json, sys
for name in sys.argv[1:]:
    rows = json.load(open(f'{name}/results3.json'))
    sw = rows[0]; ex = rows[1]
    try: om = json.load(open(f'{name}/oursmem.json'))
    except Exception: om = {}
    print(f"\n== {name}: exact-kNN ceiling MRR {ex['mrr10']:.4f}")
    print(f"  sweet: p50 {sw['p50_us']:.0f} us, p99 {sw['p99_us']:.0f}, R@10ex {sw['recall10_vs_exact']:.4f}, MRR {sw['mrr10']:.4f}, index {om.get('index_mb','?')} MB, build {om.get('build_s','?')} s (1 thread)")
    cfgs = {}
    for r in rows[2:]: cfgs.setdefault((r['method'], r['M'], r['efC']), []).append(r)
    for (m, M, efC), rs in cfgs.items():
        def first(key, thr):
            ok = [r for r in rs if r[key] >= thr]
            return f"{ok[0]['p50_us']:.0f} us (ef {ok[0]['ef']})" if ok else f"never (max {max(r[key] for r in rs):.4f})"
        print(f"  {m:20} M{M:<3} efC{efC:<4} build {rs[0]['build_s']:>6}s {rs[0]['index_mb']:>7} MB | at sweet R@10ex: {first('recall10_vs_exact', sw['recall10_vs_exact']):24} | at sweet MRR: {first('mrr10', sw['mrr10'])}")
