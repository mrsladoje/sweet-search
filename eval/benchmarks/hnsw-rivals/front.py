# For one scored4.json: our points (sweet) vs every rival point. A rival point is "dominated" when some
# sweet point has MRR >= it and p50 <= it. Lists the fast rival points that no sweet point dominates.
import sys, json
d = json.load(open(sys.argv[1])); q = "mrr10" if d["labelled"] else "recall10"
rows = d["rows"]; ours = [r for r in rows if r["system"] == "sweet"]; riv = [r for r in rows if r["system"] != "sweet"]
print(f"== {d['set']}  ours:", "  ".join(f"{r['param'].split(',')[0]} {r['p50_us']:.0f}us {r[q]:.4f}" for r in sorted(ours, key=lambda r: r['p50_us'])))
und = [r for r in riv if not any(o[q] >= r[q] and o["p50_us"] <= r["p50_us"] for o in ours)]
for r in sorted(und, key=lambda r: r["p50_us"])[:8]:
    print(f"   not dominated: {r['config']} {r['param']} {r['p50_us']:.0f}us {q} {r[q]:.4f}")
print(f"   rival points: {len(riv)}, not dominated by any sweet point: {len(und)}")
