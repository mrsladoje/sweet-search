import json, sys
d = json.load(open(sys.argv[1])); t = [e for e in d["time_to_our_quality"] if e.get("at_our_quality")]
t.sort(key=lambda e: e["at_our_quality"]["p50_ratio"])
p = d["sweet_prod"]
print(f"{d['set']}: ours {p['p50_us']} us MRR {p['mrr10']} | closest: " + "; ".join(f"{e['config']} M{e['M']} x{e['at_our_quality']['p50_ratio']} {e['at_our_quality']['p50_ratio_ci']}" for e in t[:3]) + f" | never: {sum(1 for e in d['time_to_our_quality'] if not e.get('at_our_quality'))}")
