"""c05 verify: run the candidate's unrun $0 falsifier (a) over all 22 fresh-pool goldens.
For every non-test source function with >=2 non-ambiguous call sites, count how many have >=1
call site flagged by the census face (broad: fallback / filtered / empty / keys-split, as the
candidate describes the shipped face) and by a strict variant (filter / empty only, as in
binding_face.py's possiblyEmptyCollection). Base tree only, no task knowledge."""
import sys, os, time, json
sys.path.insert(0, "/tmp/wf-slatec/resolution-computed-facts")
import census_edited_functions as C

GOLD = "/root/.ss-eval/golden"
tasks = json.load(open("/root/sweet-search-private/eval/task-completion-bench/results/fp-codex-tab-20260826/sweet/tasks.json"))
LANGS = ("js", "py", "cs", "go", "java", "php", "ex", "cpp", "jam")


def strict(flags):
    return any(("<-filter" in f) or ("<-empty" in f) or (f == "empty-literal") or (f == "filtered-inline") for f in flags)


print("task | lang | srcFiles | fnScanned | >=2callers | flaggedBroad | flaggedStrict | secs")
n = broad_over5 = strict_over5 = 0
for t in tasks:
    root = "%s/%s@%s" % (GOLD, t["repo"].replace("/", "__"), t["base_commit"])
    t0 = time.time()
    files = C.repo_files(root)
    src = [p for p in files if not C.TEST_MARK.search(os.path.relpath(p, root)) and C.lang_of(p) in LANGS]
    n_fn = multi = broad = strict_n = 0
    seen = set()
    timed_out = False
    for p in src:
        lang = C.lang_of(p)
        s = C.read_src(p)
        lines = s.split("\n")
        try:
            fns = C.functions_in_file(lines, lang)
        except Exception:
            continue
        for name, params, a, b in fns:
            if len(name) < 4 or name in C.KEYWORDS or (name, p) in seen:
                continue
            seen.add((name, p))
            n_fn += 1
            nt, te, defs = C.call_sites(root, files, name, p, a, lang)
            if defs > 1:
                continue
            if len(nt) >= 2:
                multi += 1
                if any(x.get("possiblyEmpty") for x in nt):
                    broad += 1
                if any(strict(fs) for x in nt for fs in x.get("flags", [])):
                    strict_n += 1
            if time.time() - t0 > 240:
                timed_out = True
                break
        if timed_out:
            break
    n += 1
    broad_over5 += broad > 5
    strict_over5 += strict_n > 5
    print("%-40s %-7s %5d %6d %6d %6d %6d %5.0f%s" % (t["instance_id"][:40], t["language"], len(src), n_fn, multi, broad, strict_n, time.time() - t0, " TIMEOUT" if timed_out else ""))
print("goldens=%d broad>5: %d  strict>5: %d  (candidate kill: >5 flagged per repo on >4 of 22)" % (n, broad_over5, strict_over5))
