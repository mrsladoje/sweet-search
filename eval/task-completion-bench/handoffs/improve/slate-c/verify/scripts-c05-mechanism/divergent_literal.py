"""c05 mechanism verify: the candidate's described trigger set includes 'a caller-divergent literal', which
neither the census nor the noise sweep measured. Count, per golden, non-test functions with >=2 non-ambiguous
call sites where some parameter position receives >=2 distinct string literals across callers."""
import sys, os, time, re, json
sys.path.insert(0, "/tmp/wf-slatec/resolution-computed-facts")
import census_edited_functions as C
LIT = re.compile(r"^(['\"`]).*\1$")
def run(root, budget):
    t0=time.time(); files=C.repo_files(root)
    src=[p for p in files if not C.TEST_MARK.search(os.path.relpath(p, root)) and C.lang_of(p) in ("js","py","cs","go","java","php")]
    n_fn=multi=div=0; flagged_any=0; seen=set(); examples=[]; timed_out=False
    for p in src:
        lang=C.lang_of(p); lines=C.read_src(p).split("\n")
        for name, params, s, e in C.functions_in_file(lines, lang):
            if len(name)<4 or name in C.KEYWORDS or (name,p) in seen: continue
            seen.add((name,p)); n_fn+=1
            nt, te, defs = C.call_sites(root, files, name, p, s, lang)
            if defs>1 or len(nt)<2: continue
            multi+=1
            maxpos=max(len(x["args"]) for x in nt)
            d=False
            for i in range(maxpos):
                lits=set(x["args"][i] for x in nt if i<len(x["args"]) and LIT.match(x["args"][i]))
                if len(lits)>=2: d=True; break
            pe=any(x.get("possiblyEmpty") for x in nt)
            if d: div+=1
            if d or pe: flagged_any+=1
            if d and len(examples)<6: examples.append((os.path.relpath(p,root)[-40:], name, len(nt)))
            if time.time()-t0>budget: timed_out=True; break
        if timed_out: break
    return dict(golden=os.path.basename(root)[:45], srcFiles=len(src), fnScanned=n_fn, ge2callers=multi, divergentLiteral=div, divergentOrPossiblyEmpty=flagged_any, timedOut=timed_out, secs=round(time.time()-t0), examples=examples)
GOLD="/root/.ss-eval/golden"
tasks=json.load(open("/root/sweet-search-private/eval/task-completion-bench/results/fp-codex-tab-20260826/sweet/tasks.json"))
want=set(sys.argv[1].split(",")) if len(sys.argv)>1 else None
for t in tasks:
    if want and not any(t["instance_id"].startswith(w) for w in want): continue
    root="%s/%s@%s"%(GOLD, t["repo"].replace("/","__"), t["base_commit"])
    print(json.dumps(run(root, 240)), flush=True)
