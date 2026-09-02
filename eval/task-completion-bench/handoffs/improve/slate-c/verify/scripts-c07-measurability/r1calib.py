import json, statistics as st
rows=json.load(open("/tmp/wf-slatec/c07-measurability/v2/r1size.json"))
# calibration: on untruncated packs the delivered rank-1 block IS the full body
cal=[r for r in rows if not r["trunc"] and r["est_full_r1"] and r["n_numbered"]>=5]
err=[(r["est_full_r1"]-r["r1_delivered"])/r["r1_delivered"] for r in cal]
err=sorted(err)
print(f"calibration n={len(cal)}  relative error of estimator vs delivered truth:")
print(f"  median={err[len(err)//2]:+.3f}  p10={err[int(.1*len(err))]:+.3f}  p90={err[int(.9*len(err))-1]:+.3f}  mean={sum(err)/len(err):+.3f}")
print()
# only packs whose rank-1 is presented full AND the pack itself was cut inside rank1 or after
for label,sel in [
  ("truncated packs, cut begins inside rank-1 (n should be 25)", lambda r: r["cut_in_r1"]),
  ("truncated packs, cut elsewhere", lambda r: r["trunc"] and not r["cut_in_r1"]),
]:
    ps=[r for r in rows if sel(r) and r["est_full_r1"]]
    e=sorted(r["est_full_r1"] for r in ps)
    ob=[r for r in ps if r["est_full_r1"]>4800]
    op=[r for r in ps if r["est_full_r1"]+r["pre_r1_chars"]>4800]
    print(f"{label}: n={len(ps)} med={e[len(e)//2]:.0f} body>4800 {len(ob)}/{len(ps)} ({100*len(ob)/len(ps):.0f}%) preamble+body>4800 {len(op)}/{len(ps)} ({100*len(op)/len(ps):.0f}%)")
print()
# span line counts
for label,sel in [("truncated",lambda r:r["trunc"]),("cut_in_r1",lambda r:r["cut_in_r1"])]:
    ps=[r for r in rows if sel(r)]
    s=sorted(r["span"] for r in ps)
    print(f"{label}: rank-1 span lines med={s[len(s)//2]} p90={s[int(.9*len(s))-1]} max={s[-1]}")
print()
# would an all-rank manifest fit 4600 chars?  results= n, one line ~ file:start-end [symbol]
ps=[r for r in rows if r["trunc"] and r["results"]]
print("manifest sizing: results= per truncated pack:", "median", st.median([r["results"] for r in ps]), "max", max(r["results"] for r in ps))
print("  a manifest line like  #12 path/to/file.js:1234-1299 [method: name]  is ~55-70 chars ->",
      f"median pack manifest ~{st.median([r[chr(114)+chr(101)+chr(115)+chr(117)+chr(108)+chr(116)+chr(115)] for r in ps])*62:.0f} chars")
