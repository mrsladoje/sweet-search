"""Bounded run of c05 falsifier (a): for one golden, every non-test source function with >=2 non-test call sites,
count how many have >=1 possibly-empty flagged call site. Base tree only, no task knowledge."""
import sys, os, time, collections
sys.path.insert(0, "/tmp/wf-slatec/resolution-computed-facts")
import census_edited_functions as C
root = sys.argv[1]; budget = float(sys.argv[2]) if len(sys.argv) > 2 else 120
t0 = time.time()
files = C.repo_files(root)
src_files = [p for p in files if not C.TEST_MARK.search(os.path.relpath(p, root)) and C.lang_of(p) in ("js","py","cs","go","java","php")]
n_fn = 0; multi = 0; flagged = []; seen = set(); timed_out = False
for p in src_files:
    lang = C.lang_of(p); src = C.read_src(p); lines = src.split("\n")
    for name, params, s, e in C.functions_in_file(lines, lang):
        if len(name) < 4 or name in C.KEYWORDS or (name, p) in seen: continue
        seen.add((name, p)); n_fn += 1
        nt, te, defs = C.call_sites(root, files, name, p, s, lang)
        if defs > 1: continue
        if len(nt) >= 2:
            multi += 1
            fl = [x for x in nt if x.get("possiblyEmpty")]
            if fl: flagged.append((os.path.relpath(p, root), name, len(nt), len(fl), sorted(set(f for x in fl for fs in x["flags"] for f in fs))[:4]))
        if time.time() - t0 > budget: timed_out = True; break
    if timed_out: break
print(f"root={os.path.basename(root)[:50]} srcFiles={len(src_files)} functionsScanned={n_fn} nonAmbiguous>=2callers={multi} flaggedFunctions={len(flagged)} timedOut={timed_out} secs={time.time()-t0:.0f}")
for f in flagged[:25]: print("   ", f)
