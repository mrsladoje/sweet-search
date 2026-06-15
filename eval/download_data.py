#!/usr/bin/env python3
"""
Download benchmark datasets for Sweet Search evaluation.

Requires: datasets>=3.0.0  (pip install datasets)

Datasets:
  1. CodeSearchNet   - Code-to-NL retrieval (6 langs)
  2. CosQA           - Web queries -> Python code
  3. AdvTest         - Adversarial Python code search (obfuscated vars)
  4. COIR            - Comprehensive code IR (14 languages)
  5. CoQuIR          - Quality-aware code retrieval (11 languages)
  6. GenCodeSearchNet - Generalization testing (6 languages)
  7. CrossCodeEval   - Cross-file retrieval (4 languages)
  8. CLARC           - C/C++ code retrieval
  9. M2CRB           - Multilingual NL→code (ES/PT/DE/FR × Python/Java/JS)

Output: eval/data/{dataset_name}/{corpus,queries}.jsonl

Usage:
  python download_data.py [--full|--small] [--dataset=NAME] [--list]
"""

import json, gzip, io, sys, zipfile, urllib.request
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data"
HF_CSN_BASE = "https://huggingface.co/datasets/code-search-net/code_search_net/resolve/main/data"

DATASETS = {
    "codesearchnet":    "CodeSearchNet (code-to-NL, 6 langs)",
    "cosqa":            "CosQA (web queries -> Python)",
    "advtest":          "AdvTest (adversarial Python, obfuscated vars)",
    "coir":             "COIR (comprehensive code IR, 14 langs)",
    "coquir":           "CoQuIR (quality-aware retrieval, 11 langs)",
    "gencodesearchnet": "GenCodeSearchNet (generalization, 6 langs)",
    "crosscodeeval":    "CrossCodeEval (cross-file, 4 langs)",
    "clarc":            "CLARC (C/C++ retrieval)",
    "m2crb":            "M2CRB (multilingual NL→code, ES/PT/DE/FR × Py/Java/JS)",
    "cosqaplus":        "CoSQA+ (multi-choice NL→code, test-driven, Python)",
    "coreb":            "CoREB (contamination-limited multitask, 5 langs, t2c)",
    "bright-code":      "BRIGHT code subsets (LeetCode + Pony + StackOverflow)",
}

# --- Helpers ---------------------------------------------------------------

def _write_output(out_dir, entries, pfx="Q"):
    """Write normalized corpus.jsonl + queries.jsonl."""
    with open(out_dir / "corpus.jsonl", "w") as f:
        for e in entries:
            f.write(json.dumps({
                "doc_id": e["doc_id"], "code": e["code"], "language": e["language"],
                "func_name": e.get("func_name", ""), "repo": e.get("repo", ""),
                "path": e.get("path", ""),
            }) + "\n")
    with open(out_dir / "queries.jsonl", "w") as f:
        for i, e in enumerate(entries):
            f.write(json.dumps({
                "query_id": f"{pfx}{i:05d}", "query": e["query"],
                "relevant_doc_ids": e.get("relevant_doc_ids", [e["doc_id"]]),
                "language": e["language"],
            }) + "\n")


def _cached(out_dir):
    """Return cached corpus count or None."""
    cf = out_dir / "corpus.jsonl"
    return sum(1 for _ in open(cf)) if cf.exists() else None


def _hf_load():
    """Import HuggingFace load_dataset."""
    from datasets import load_dataset
    return load_dataset


def _try_hf(names, load_fn, **kwargs):
    """Try multiple HuggingFace dataset identifiers, return first success or None."""
    for name in names:
        try:
            return load_fn(name, **kwargs)
        except Exception:
            continue
    return None


def _q(text):
    """Normalize query text: strip, first line, max 500 chars."""
    return str(text).strip().split("\n")[0][:500]


def _strip_doc_leak(code, doc):
    """Remove the docstring/NL text from the code so the query can't match itself
    verbatim. For docstring-derived benchmarks (AdvTest, M2CRB) the query IS the
    function's docstring, which is also embedded in the code — indexing the raw
    code leaks the answer to BM25. Published baselines score docstring-stripped
    code, so we strip it. Language-agnostic: delete the docstring block and its
    per-line fragments wherever they appear."""
    if not doc:
        return code
    d = str(doc).strip()
    if d and d in code:
        code = code.replace(d, " ")
    for line in d.split("\n"):
        line = line.strip()
        if len(line) >= 8 and line in code:
            code = code.replace(line, " ")
    return code


# --- 1. CodeSearchNet ------------------------------------------------------

def download_codesearchnet(languages=("python", "javascript", "go", "ruby", "java", "php"),
                           max_per_lang=1000):
    out_dir = DATA_DIR / "codesearchnet"
    out_dir.mkdir(parents=True, exist_ok=True)
    all_entries = []

    for lang in languages:
        lang_file = out_dir / f"{lang}_test.jsonl"
        if lang_file.exists():
            print(f"  {lang}: cached")
            with open(lang_file) as f:
                all_entries.extend(json.loads(l) for l in f if l.strip())
            continue

        print(f"  Downloading {lang}.zip...")
        try:
            resp = urllib.request.urlopen(f"{HF_CSN_BASE}/{lang}.zip")
            zip_bytes = io.BytesIO(resp.read())
        except Exception as e:
            print(f"    Failed: {e}"); continue

        entries, seen, idx = [], set(), 0
        with zipfile.ZipFile(zip_bytes) as zf:
            test_files = sorted(n for n in zf.namelist() if '/test/' in n and n.endswith('.jsonl.gz'))
            if not test_files:
                test_files = sorted(n for n in zf.namelist()
                                    if 'test' in n.lower() and n.endswith(('.jsonl.gz', '.jsonl')))
            for tf in test_files:
                raw = zf.read(tf)
                if tf.endswith('.gz'):
                    raw = gzip.decompress(raw)
                for line in raw.decode('utf-8').strip().split('\n'):
                    if not line.strip():
                        continue
                    if max_per_lang and len(entries) >= max_per_lang:
                        break
                    row = json.loads(line)
                    fn = row.get("func_name", f"func_{idx}")
                    repo = row.get("repo", row.get("repository_name", "unknown"))
                    code = row.get("whole_func_string", row.get("code", ""))
                    doc = row.get("func_documentation_string", row.get("docstring", ""))
                    if not code or not doc or len(doc.strip()) < 10:
                        idx += 1; continue
                    did = f"{lang}/{repo}/{fn}"
                    if did in seen:
                        did = f"{did}_{idx}"
                    seen.add(did)
                    entries.append({"query": _q(doc), "doc_id": did, "code": code,
                                    "language": lang, "repo": repo, "path": row.get("path", ""),
                                    "func_name": fn})
                    idx += 1
                if max_per_lang and len(entries) >= max_per_lang:
                    break

        with open(lang_file, "w") as f:
            for e in entries:
                f.write(json.dumps(e) + "\n")
        print(f"    {len(entries)} entries")
        all_entries.extend(entries)

    _write_output(out_dir, all_entries, "Q")
    print(f"  Total: {len(all_entries)} entries")
    return len(all_entries)


# --- 2. CosQA --------------------------------------------------------------

# Canonical CoSQA retrieval (Huang et al., ACL 2021): 500 web-query test set
# ranked against the *fixed 6,267-code database*, MRR. We source the exact files
# from the official CoCLR release so our pool matches every published CoSQA MRR
# (CodeBERT 64.7 ... UniXcoder 70.1 fine-tuned; CodeSage/OpenAI/OASIS 47-56
# zero-shot). The legacy 500-vs-500 form has no published counterpart, so we
# ignore max_entries and always build the full canonical pool.
_COCLR_BASE = "https://raw.githubusercontent.com/Jun-jie-Huang/CoCLR/main/data/search/"

def download_cosqa(max_entries=None):
    out_dir = DATA_DIR / "cosqa"
    out_dir.mkdir(parents=True, exist_ok=True)
    c = _cached(out_dir)
    if c is not None:
        print(f"  CosQA: cached ({c})"); return c

    print("  Downloading CosQA (canonical 500 queries x 6,267-code database)...")
    try:
        # code_idx_map: { code_string: idx } for all 6,267 database codes
        code_idx_map = json.loads(urllib.request.urlopen(_COCLR_BASE + "code_idx_map.txt", timeout=60).read())
        test500 = json.loads(urllib.request.urlopen(_COCLR_BASE + "cosqa-retrieval-test-500.json", timeout=60).read())
    except Exception as e:
        print(f"    Failed: {e}"); return 0

    # Corpus: the full 6,267-code database, keyed by retrieval idx.
    idx_to_code = {str(idx): code for code, idx in code_idx_map.items()}
    with open(out_dir / "corpus.jsonl", "w") as f:
        for idx, code in sorted(idx_to_code.items(), key=lambda kv: int(kv[0])):
            f.write(json.dumps({
                "doc_id": f"cosqa/python/code_{idx}", "code": code,
                "language": "python", "func_name": f"code_{idx}", "repo": "", "path": "",
            }) + "\n")

    # Queries: 500 web queries; gold = the code at `retrieval_idx` in the database.
    written = 0
    with open(out_dir / "queries.jsonl", "w") as f:
        for i, row in enumerate(test500):
            q = _q(row.get("doc", ""))
            gold = str(row.get("retrieval_idx", ""))
            if not q or gold not in idx_to_code:
                continue
            f.write(json.dumps({
                "query_id": f"CQ{i:05d}", "query": q,
                "relevant_doc_ids": [f"cosqa/python/code_{gold}"], "language": "python",
            }) + "\n")
            written += 1

    print(f"    corpus={len(idx_to_code)} codes, queries={written}"); return len(idx_to_code)


# --- 3. AdvTest -------------------------------------------------------------

# Canonical AdvTest (Lu et al., CodeXGLUE NeurIPS 2021): the entire 19,210-function
# Python test set is the candidate pool for every query, with identifiers obfuscated
# (def Func(arg_0), ...). This is the *defining* protocol — the older 1,000-candidate
# setting was explicitly replaced. We always build the full pool (ignore max_entries)
# so our MRR is comparable to published AdvTest numbers (CodeRankEmbed 59.5 zero-shot,
# UniXcoder 41.3 / CodeSage-Large 52.67, all full-19,210-pool).
def download_advtest(max_entries=None):
    out_dir = DATA_DIR / "advtest"
    out_dir.mkdir(parents=True, exist_ok=True)
    c = _cached(out_dir)
    if c is not None:
        print(f"  AdvTest: cached ({c})"); return c

    print("  Downloading AdvTest (canonical obfuscated 19,210-function pool)...")
    try:
        ds = _hf_load()("code_x_glue_tc_nl_code_search_adv", split="test")
    except Exception as e:
        print(f"    Failed: {e}"); return 0

    entries = []
    for i, row in enumerate(ds):
        # Document = the raw (naturally-formatted) obfuscated code with the docstring
        # REMOVED. Stripping is mandatory: the query IS the function's docstring, so
        # leaving it in leaks the answer to BM25 (our no-strip run scored 0.976 vs the
        # published ceiling ~0.59 — pure lexical echo). But we strip from the *real*
        # `code` field rather than the space-tokenized `code_tokens` field, so the
        # encoder/AST-chunker see natural `def Func(arg_0):` formatting like every
        # published baseline (CodeRankEmbed 59.5, CodeSage 52.7), not "def Func ( arg_0 )".
        code, doc = row.get("code", ""), row.get("docstring", "")
        if isinstance(code, list): code = " ".join(code)
        if isinstance(doc, list): doc = " ".join(doc)
        if not code or not doc or len(doc.strip()) < 3:
            continue
        code = _strip_doc_leak(code, doc)
        entries.append({"query": _q(doc), "doc_id": f"advtest/python/func_{i}",
                        "code": code, "language": "python", "func_name": f"func_{i}"})

    _write_output(out_dir, entries, "AT")
    print(f"    {len(entries)} entries (full obfuscated, docstring-stripped, natural format)"); return len(entries)


# --- 4. COIR ----------------------------------------------------------------
# COIR uses BEIR-format datasets: corpus, queries, qrels as separate splits.
# Main dataset: CoIR-Retrieval/CodeSearchNet-queries-corpus (corpus+queries)
# Qrels:        CoIR-Retrieval/CodeSearchNet (test split with query-id, corpus-id, score)
# Also: CoIR-Retrieval/cosqa-queries-corpus, CoIR-Retrieval/apps-queries-corpus, etc.

COIR_TASKS = [
    ("CodeSearchNet", "codesearchnet"),
    ("cosqa", "cosqa"),
    ("apps", "apps"),
    ("codefeedback-st", "codefeedback-st"),
    ("stackoverflow-qa", "stackoverflow-qa"),
    ("synthetic-text2sql", "synthetic-text2sql"),
]


def download_coir(max_per_task=1000):
    out_dir = DATA_DIR / "coir"
    out_dir.mkdir(parents=True, exist_ok=True)
    c = _cached(out_dir)
    if c is not None:
        print(f"  COIR: cached ({c})"); return c

    print("  Downloading COIR (BEIR-format datasets)...")
    try:
        load_ds = _hf_load()
    except Exception as e:
        print(f"    Failed: {e}"); return 0

    all_entries = []
    for task_name, task_key in COIR_TASKS:
        qc_repo = f"CoIR-Retrieval/{task_name}-queries-corpus"
        qrel_repo = f"CoIR-Retrieval/{task_name}"
        print(f"    {task_key}...", end=" ")

        try:
            corpus_ds = load_ds(qc_repo, split="corpus")
            queries_ds = load_ds(qc_repo, split="queries")
        except Exception as e:
            print(f"skip (corpus/queries: {e})")
            continue

        corpus = {}
        for r in corpus_ds:
            cid = str(r.get("_id", r.get("id", "")))
            corpus[cid] = r.get("text", r.get("code", ""))

        queries = {}
        for r in queries_ds:
            qid = str(r.get("_id", r.get("id", "")))
            queries[qid] = r.get("text", r.get("query", ""))

        # Load qrels for relevance mapping
        qrels = {}
        try:
            qrel_ds = load_ds(qrel_repo, split="test")
            for r in qrel_ds:
                qid = str(r.get("query-id", r.get("query_id", "")))
                cid = str(r.get("corpus-id", r.get("corpus_id", "")))
                if r.get("score", 1) > 0:
                    qrels.setdefault(qid, []).append(cid)
        except Exception:
            pass  # proceed without explicit qrels

        ct = 0
        if qrels:
            for qid, qt in queries.items():
                if max_per_task and ct >= max_per_task: break
                for cid in qrels.get(qid, []):
                    if max_per_task and ct >= max_per_task: break
                    if cid not in corpus: continue
                    did = f"coir/{task_key}/{cid}"
                    lang = _guess_lang(corpus[cid], task_key)
                    all_entries.append({"query": _q(qt), "doc_id": did, "code": corpus[cid],
                                        "language": lang, "func_name": f"{task_key}_{cid}"})
                    ct += 1
        else:
            # No qrels: pair queries with corpus positionally
            cids = list(corpus.keys())
            for i, (qid, qt) in enumerate(queries.items()):
                if max_per_task and i >= max_per_task or i >= len(cids): break
                cid = cids[i]
                did = f"coir/{task_key}/{cid}"
                lang = _guess_lang(corpus[cid], task_key)
                all_entries.append({"query": _q(qt), "doc_id": did, "code": corpus[cid],
                                    "language": lang, "func_name": f"{task_key}_{cid}"})
                ct += 1
        print(f"{ct}")

    if all_entries:
        _write_output(out_dir, all_entries, "CR")
    print(f"  Total: {len(all_entries)} entries")
    return len(all_entries)


def _guess_lang(code, task_key):
    """Heuristic language detection for COIR entries."""
    if task_key == "synthetic-text2sql": return "sql"
    if task_key == "cosqa": return "python"
    if "def " in code[:100] or "import " in code[:100]: return "python"
    if "function " in code[:100] or "const " in code[:100]: return "javascript"
    if "func " in code[:100]: return "go"
    if "public class " in code[:100]: return "java"
    if "<?php" in code[:100]: return "php"
    if "def " in code[:100] and "end" in code: return "ruby"
    return "unknown"


# --- 5. CoQuIR --------------------------------------------------------------
# CoQuIR has per-subset repos: Defects4J, CVEFixes, CodeNet-E, SQLR2, DepreAPI
# Each has configs: "corpus", "query", and default (qrels with pos-docids/neg-docids)

COQUIR_SUBSETS = [
    ("CoQuIR/Defects4J", "java"),
    ("CoQuIR/CVEFixes", "c"),
    ("CoQuIR/CodeNet-E", "python"),
    ("CoQuIR/SQLR2", "sql"),
    ("CoQuIR/DepreAPI", "java"),
]


def download_coquir(max_per_subset=500):
    out_dir = DATA_DIR / "coquir"
    out_dir.mkdir(parents=True, exist_ok=True)
    c = _cached(out_dir)
    if c is not None:
        print(f"  CoQuIR: cached ({c})"); return c

    print("  Downloading CoQuIR (per-subset repos)...")
    try:
        load_ds = _hf_load()
    except Exception as e:
        print(f"    Failed: {e}"); return 0

    import ast

    all_entries = []
    for repo, default_lang in COQUIR_SUBSETS:
        subset_name = repo.split("/")[1]
        print(f"    {subset_name}...", end=" ")

        try:
            # CoQuIR uses HF configs: "corpus" config -> "corpus" split, "query" -> "query" split
            corpus_ds = load_ds(repo, "corpus", split="corpus")
            query_ds = load_ds(repo, "query", split="query")
            qrel_ds = load_ds(repo, split="test")
        except Exception as e:
            print(f"skip ({e})"); continue

        # Build corpus dict: id -> {text, lang}
        corpus = {}
        for r in corpus_ds:
            cid = str(r.get("id", ""))
            corpus[cid] = {"text": r.get("text", ""), "lang": r.get("lang", default_lang)}

        # Build query dict: id -> text
        queries = {}
        for r in query_ds:
            qid = str(r.get("id", ""))
            queries[qid] = r.get("text", "")

        # Join via qrels: pos-docids is a string like "['id1', 'id2']"
        ct = 0
        for row in qrel_ds:
            if max_per_subset and ct >= max_per_subset: break
            qid = str(row.get("qid", ""))
            qt = queries.get(qid, "")
            if not qt: continue

            raw_pos = row.get("pos-docids", "[]")
            pos_ids = ast.literal_eval(raw_pos) if isinstance(raw_pos, str) else raw_pos

            for pid in pos_ids[:1]:
                pid = str(pid)
                if pid not in corpus: continue
                code = corpus[pid]["text"]
                lang = corpus[pid]["lang"] or default_lang
                if not code: continue
                did = f"coquir/{subset_name}/{pid}"
                all_entries.append({"query": _q(qt), "doc_id": did, "code": code,
                                    "language": lang, "func_name": f"{subset_name}_{ct}"})
                ct += 1
        print(f"{ct}")

    if all_entries:
        _write_output(out_dir, all_entries, "CQR")
    print(f"    Total: {len(all_entries)}"); return len(all_entries)


# --- 6. GenCodeSearchNet ----------------------------------------------------
# Uses per-language datasets from Semeru lab: semeru/code-text-{lang}
# Plus drndr/StatCodeSearch for R language subset

GCSN_LANGS = {
    "python": "semeru/code-text-python",
    "javascript": "semeru/code-text-javascript",
    "go": "semeru/code-text-go",
    "ruby": "semeru/code-text-ruby",
    "java": "semeru/code-text-java",
    "php": "semeru/code-text-php",
}


def download_gencodesearchnet(max_per_lang=1000):
    out_dir = DATA_DIR / "gencodesearchnet"
    out_dir.mkdir(parents=True, exist_ok=True)
    c = _cached(out_dir)
    if c is not None:
        print(f"  GenCSN: cached ({c})"); return c

    print("  Downloading GenCodeSearchNet (semeru/code-text-*)...")
    try:
        load_ds = _hf_load()
    except Exception as e:
        print(f"    Failed: {e}"); return 0

    entries = []
    for lang, repo in GCSN_LANGS.items():
        print(f"    {lang}...", end=" ")
        try:
            ds = load_ds(repo, split="test")
        except Exception as e:
            print(f"skip ({e})"); continue

        ct = 0
        for i, row in enumerate(ds):
            if max_per_lang and ct >= max_per_lang: break
            code = row.get("code", row.get("original_string", ""))
            doc = row.get("docstring", row.get("func_documentation_string", ""))
            if not code or not doc or len(str(doc).strip()) < 10:
                continue
            fn = row.get("func_name", f"func_{i}")
            entries.append({"query": _q(doc), "doc_id": f"gencodesearchnet/{lang}/{fn}_{i}",
                            "code": str(code), "language": lang, "func_name": fn,
                            "repo": row.get("repo", ""), "path": row.get("path", "")})
            ct += 1
        print(f"{ct}")

    # R language from StatCodeSearch
    print(f"    r...", end=" ")
    try:
        ds = load_ds("drndr/StatCodeSearch", split="test")
        ct = 0
        for i, row in enumerate(ds):
            if max_per_lang and ct >= max_per_lang: break
            code = row.get("code", "")
            doc = row.get("comment", row.get("docstring", ""))
            if not code or not doc: continue
            entries.append({"query": _q(doc), "doc_id": f"gencodesearchnet/r/func_{i}",
                            "code": str(code), "language": "r", "func_name": f"func_{i}"})
            ct += 1
        print(f"{ct}")
    except Exception as e:
        print(f"skip ({e})")

    if entries:
        _write_output(out_dir, entries, "GC")
    print(f"    Total: {len(entries)}"); return len(entries)


# --- 7. CrossCodeEval ------------------------------------------------------
# Primary: Vincentvmt/CrossCodeEval on HuggingFace (community upload)
# Fallback: Download from GitHub amazon-science/cceval

CCEVAL_LANGS = {"python", "java", "typescript", "csharp", "c_sharp"}
CCEVAL_LANG_MAP = {"c_sharp": "csharp", "c#": "csharp", "ts": "typescript", "py": "python"}


def download_crosscodeeval(max_per_lang=1000):
    out_dir = DATA_DIR / "crosscodeeval"
    out_dir.mkdir(parents=True, exist_ok=True)
    c = _cached(out_dir)
    if c is not None:
        print(f"  CrossCodeEval: cached ({c})"); return c

    print("  Downloading CrossCodeEval...")
    try:
        load_ds = _hf_load()
    except Exception as e:
        print(f"    Failed: {e}"); return 0

    entries, lc = [], {}

    # Load per-language line_completion.jsonl to avoid schema mismatch
    # First, trigger HF download to cache the files
    try:
        from huggingface_hub import snapshot_download
        cache_dir = snapshot_download("Vincentvmt/CrossCodeEval", repo_type="dataset")
        print(f"    Cached at: {cache_dir}")
    except Exception as e:
        print(f"    Download failed: {e}"); return 0

    lang_dirs = {"python": "python", "java": "java", "typescript": "typescript", "csharp": "csharp"}
    for lang, lang_dir in lang_dirs.items():
        jsonl_path = Path(cache_dir) / "crosscodeeval_data" / lang_dir / "line_completion.jsonl"
        if not jsonl_path.exists():
            print(f"    {lang}: no data"); continue

        ct = 0
        with open(jsonl_path) as f:
            for i, line in enumerate(f):
                if max_per_lang and ct >= max_per_lang: break
                row = json.loads(line)
                prompt = row.get("prompt", "")
                gt = row.get("groundtruth", "")
                if not prompt or not gt: continue
                # Combine prompt context + groundtruth as the retrievable code
                code = prompt + gt + row.get("right_context", "")
                # Use last meaningful line of prompt as query
                query_lines = [l for l in prompt.strip().split("\n") if l.strip() and not l.strip().startswith("#")]
                query = query_lines[-1].strip() if query_lines else prompt[-200:]
                meta = row.get("metadata", {})
                if isinstance(meta, str):
                    try: meta = json.loads(meta.replace("'", '"'))
                    except Exception: meta = {}
                entries.append({"query": _q(query), "doc_id": f"crosscodeeval/{lang}/{i}",
                                "code": code[:5000], "language": lang, "func_name": f"func_{i}",
                                "repo": meta.get("repository", "")})
                ct += 1
                lc[lang] = lc.get(lang, 0) + 1
        print(f"    {lang}: {ct}")

    if entries:
        _write_output(out_dir, entries, "CC")
    print(f"    Total: {len(entries)}"); return len(entries)


# --- 8. CLARC ---------------------------------------------------------------
# ClarcTeam/CLARC: splits like group1_original, group2_original
# Schema: query_id, query_text, code_id, code_text, relevance

CLARC_SPLITS = [
    "group1_original", "group2_original",
    "group3_helper_as_part_of_groundtruth_original",
]


def _clarc_lang(code, code_id):
    """Best-effort C vs C++ classifier for CLARC code.

    The HF dataset doesn't carry a language column; the project's original
    downloader had a brittle 'std:: in code' heuristic that mis-labeled
    889/106 split (real distribution is closer to 50/50 per the paper).
    This version checks for stronger C++ signals while letting C be the
    default — language label only feeds the per-language breakdown,
    NOT retrieval, so a bias here is a reporting artifact only.
    """
    head = code[:600]
    cpp_signals = (
        "std::", "namespace ", "template<", "template <", "::",
        "class ", "public:", "private:", "protected:", "virtual ",
        "->std::", "<cstring>", "<vector>", "<string>", "<iostream>",
        "nullptr", "inline bool", "constexpr",
    )
    if any(s in head for s in cpp_signals):
        return "cpp"
    return "c"


def download_clarc(max_per_lang=None):
    """Download CLARC (ICLR 2026) — full standard splits incl. Group 3.

    CLARC is a (query, code, relevance) per-row dataset. For each split,
    every query has exactly one positive code; the retrieval pool is the
    union of code_ids in the same group. Queries are paragraph-length
    descriptions (up to ~500 chars) — do NOT pass them through the
    generic _q() helper, which would truncate mid-word.
    """
    out_dir = DATA_DIR / "clarc"
    out_dir.mkdir(parents=True, exist_ok=True)
    c = _cached(out_dir)
    if c is not None:
        print(f"  CLARC: cached ({c})"); return c

    print("  Downloading CLARC (ClarcTeam/CLARC)...")
    try:
        load_ds = _hf_load()
    except Exception as e:
        print(f"    Failed: {e}"); return 0

    ds = _try_hf(["ClarcTeam/CLARC"], load_ds)
    if ds is None:
        print("    Not found on HuggingFace"); return 0

    entries, seen = [], set()
    for split_name in CLARC_SPLITS:
        if split_name not in ds:
            print(f"    {split_name}: not in dataset, skip")
            continue
        print(f"    {split_name}...", end=" ", flush=True)
        ct = 0
        for row in ds[split_name]:
            if max_per_lang and ct >= max_per_lang: break
            code = row.get("code_text", "") or ""
            query = row.get("query_text", "") or ""
            relevance = int(row.get("relevance", 0))
            code_id = row.get("code_id", "")
            if not code or not query or relevance < 1: continue
            if code_id in seen: continue
            seen.add(code_id)
            lang = _clarc_lang(code, code_id)
            # IMPORTANT: do NOT truncate CLARC queries. They are designed
            # as descriptive paragraphs (~150-500 chars) and the encoder
            # context easily fits them. _q() would chop mid-word.
            entries.append({
                "query": str(query).strip(),
                "doc_id": f"clarc/{lang}/{code_id}",
                "code": code,
                "language": lang,
                "func_name": code_id,
            })
            ct += 1
        print(f"{ct}")

    if entries:
        _write_output(out_dir, entries, "CL")
    print(f"    Total: {len(entries)}"); return len(entries)


# --- 9. M2CRB ---------------------------------------------------------------

# Language code mapping for M2CRB
_M2CRB_LANG_MAP = {"python": "python", "java": "java", "javascript": "javascript"}

def download_m2crb(max_per_lang=1000):
    """Download M2CRB: multilingual NL→code (ES/PT/DE/FR × Python/Java/JS)."""
    out_dir = DATA_DIR / "m2crb"
    out_dir.mkdir(parents=True, exist_ok=True)
    cached = _cached(out_dir)
    if cached:
        print(f"    Cached: {cached}"); return cached

    try:
        load_ds = _hf_load()
    except Exception as e:
        print(f"    Failed: {e}"); return 0

    ds = _try_hf(["blindsubmissions/M2CRB"], load_ds)
    if ds is None:
        print("    Not found on HuggingFace"); return 0

    entries, seen = [], set()
    # M2CRB may have train/test splits or just 'train'
    for split_name in ds:
        print(f"    {split_name}...", end=" ")
        ct = 0
        lang_counts = {}
        for row in ds[split_name]:
            prog_lang = str(row.get("language", "")).lower().strip()
            if prog_lang not in _M2CRB_LANG_MAP:
                continue
            lang = _M2CRB_LANG_MAP[prog_lang]

            # Per-language cap
            lang_counts.setdefault(lang, 0)
            if max_per_lang and lang_counts[lang] >= max_per_lang:
                continue

            code = row.get("function", "")
            query = row.get("docstring", "") or row.get("docstring_summary", "")
            ident = row.get("identifier", "")
            doc_lang = str(row.get("docstring_language", "")).lower().strip()
            if not code or not query:
                continue
            # Strip the docstring from the code: the query is that docstring, so
            # leaving it in leaks the answer to lexical search (65% verbatim match).
            code = _strip_doc_leak(code, query)

            doc_id = f"m2crb/{lang}/{ident}" if ident else f"m2crb/{lang}/{ct}"
            if doc_id in seen:
                continue
            seen.add(doc_id)

            entries.append({
                "query": _q(query),
                "doc_id": doc_id,
                "code": code,
                "language": lang,
                "func_name": ident,
                "path": f"{doc_lang}/{lang}/{ident}",
                "repo": f"m2crb-{doc_lang}",
            })
            lang_counts[lang] = lang_counts.get(lang, 0) + 1
            ct += 1
        print(f"{ct}")

    if entries:
        _write_output(out_dir, entries, "M2")
    print(f"    Total: {len(entries)}"); return len(entries)


# --- 10. CoSQA+ -------------------------------------------------------------
# thinkerhui/CoSQA_Plus on HF. Three JSON files:
#   query.json                                      list of {query-idx, query}
#   gpt4o_augment_codebase.json                     list of {code-idx, code}
#   gpt4o_augment_query_code_pairs_for_search.json  list of {query-idx, code-idx, label}
# We materialize multi-positive qrels (label=1) per query.

def download_cosqaplus(max_queries=None):
    """Download CoSQA+: multi-choice NL→Python code, test-driven labels."""
    out_dir = DATA_DIR / "cosqaplus"
    out_dir.mkdir(parents=True, exist_ok=True)
    c = _cached(out_dir)
    if c is not None:
        print(f"  CoSQA+: cached ({c})"); return c

    print("  Downloading CoSQA+ (thinkerhui/CoSQA_Plus)...")
    try:
        from huggingface_hub import hf_hub_download
    except Exception as e:
        print(f"    Failed: {e}"); return 0

    try:
        qp = hf_hub_download("thinkerhui/CoSQA_Plus", "query.json", repo_type="dataset")
        cp = hf_hub_download("thinkerhui/CoSQA_Plus", "gpt4o_augment_codebase.json", repo_type="dataset")
        pp = hf_hub_download("thinkerhui/CoSQA_Plus", "gpt4o_augment_query_code_pairs_for_search.json", repo_type="dataset")
        # Full pairs file gives ~5 candidates per query (mix of label=0 and label=1).
        # The paper claims 20-per-query in Table V but the public HF release ships
        # the ~5/query version. Used to populate candidate_doc_ids for paper-method
        # restricted-pool evaluation (see --restrict-to-candidates).
        ap = hf_hub_download("thinkerhui/CoSQA_Plus", "gpt4o_augment_query_code_pairs.json", repo_type="dataset")
    except Exception as e:
        print(f"    Download failed: {e}"); return 0

    with open(qp) as f: queries = json.load(f)
    with open(cp) as f: codes = json.load(f)
    with open(pp) as f: pairs = json.load(f)
    with open(ap) as f: all_pairs = json.load(f)

    # Build code corpus indexed by code-idx
    code_by_idx = {c["code-idx"]: c["code"] for c in codes}
    query_by_idx = {q["query-idx"]: q["query"] for q in queries}

    # Build qrels: query-idx -> [code-idx, ...] (positives only)
    qrels = {}
    for p in pairs:
        if int(p.get("label", 0)) != 1:
            continue
        qrels.setdefault(p["query-idx"], []).append(p["code-idx"])

    # Build per-query candidate sets from the full pairs file: query-idx ->
    # [code-idx, ...] (mix of positives + judged negatives). Used by the
    # paper-method evaluation mode where retrieval scope is restricted to
    # the per-query candidate pool instead of the full 51k corpus.
    cand_pool = {}
    for p in all_pairs:
        cand_pool.setdefault(p["query-idx"], []).append(p["code-idx"])

    # Materialize corpus: only codes that appear as positives anywhere (keeps it
    # focused on judged docs). Plus a sample of unjudged ones as hard distractors.
    pos_code_ids = {cid for ids in qrels.values() for cid in ids}
    cand_sizes = [len(v) for v in cand_pool.values()]
    print(f"    queries={len(queries)} codes={len(codes)} qrels-queries={len(qrels)} positive-codes={len(pos_code_ids)}")
    if cand_sizes:
        print(f"    candidate-pool: min={min(cand_sizes)} median={sorted(cand_sizes)[len(cand_sizes)//2]} max={max(cand_sizes)} (avg {sum(cand_sizes)/len(cand_sizes):.1f}/query)")

    # Use all positive codes as the searchable corpus (multi-choice retrieval).
    # 51k codes is small; we keep the full corpus so distractor density matches
    # the published benchmark.
    corpus_ids = sorted(code_by_idx.keys())

    with open(out_dir / "corpus.jsonl", "w") as f:
        for cid in corpus_ids:
            doc_id = f"cosqaplus/python/code_{cid}"
            f.write(json.dumps({
                "doc_id": doc_id, "code": code_by_idx[cid], "language": "python",
                "func_name": f"code_{cid}", "repo": "", "path": "",
            }) + "\n")

    written = 0
    with open(out_dir / "queries.jsonl", "w") as f:
        for qidx, pos_cids in sorted(qrels.items()):
            if max_queries and written >= max_queries: break
            q_text = query_by_idx.get(qidx)
            if not q_text: continue
            rel_ids = [f"cosqaplus/python/code_{cid}" for cid in pos_cids]
            # candidate_doc_ids: the per-query restricted pool from full pairs
            # file. Always includes the relevant_doc_ids (positives). Used by
            # the runner when --restrict-to-candidates is passed.
            cand_cids = cand_pool.get(qidx, list(pos_cids))
            # Defensive: make sure all positives are in the candidate set
            # (they always should be — pairs.json is a superset of for_search.json)
            cand_cids = sorted(set(cand_cids) | set(pos_cids))
            cand_ids = [f"cosqaplus/python/code_{cid}" for cid in cand_cids]
            f.write(json.dumps({
                "query_id": f"CQP{written:05d}",
                "query": _q(q_text),
                "relevant_doc_ids": rel_ids,
                "candidate_doc_ids": cand_ids,
                "language": "python",
            }) + "\n")
            written += 1

    print(f"    Corpus: {len(corpus_ids)}  Queries: {written}")
    return written


# --- 11. CoREB --------------------------------------------------------------
# hq-bench/coreb-t2c-retrieval is the NL→code (text-to-code) subtask, the
# closest match to our shape. BEIR-style parquet:
#   corpus/corpus-00000-of-00001.parquet   {_id, text, language, ...}
#   queries/queries-00000-of-00001.parquet {_id, text, language_constraint, ...}
#   data/test-00000-of-00001.parquet       {query-id, corpus-id, score}

def download_coreb(max_queries=None):
    """Download CoREB (text-to-code retrieval subtask)."""
    out_dir = DATA_DIR / "coreb"
    out_dir.mkdir(parents=True, exist_ok=True)
    c = _cached(out_dir)
    if c is not None:
        print(f"  CoREB: cached ({c})"); return c

    print("  Downloading CoREB t2c-retrieval (hq-bench/coreb-t2c-retrieval)...")
    try:
        import pandas as pd
        from huggingface_hub import hf_hub_download
    except Exception as e:
        print(f"    Failed: {e}"); return 0

    try:
        corp = hf_hub_download("hq-bench/coreb-t2c-retrieval", "corpus/corpus-00000-of-00001.parquet", repo_type="dataset")
        qry  = hf_hub_download("hq-bench/coreb-t2c-retrieval", "queries/queries-00000-of-00001.parquet", repo_type="dataset")
        qrl  = hf_hub_download("hq-bench/coreb-t2c-retrieval", "data/test-00000-of-00001.parquet", repo_type="dataset")
    except Exception as e:
        print(f"    Download failed: {e}"); return 0

    df_c = pd.read_parquet(corp)
    df_q = pd.read_parquet(qry)
    df_r = pd.read_parquet(qrl)

    # Build qrels: query-id -> [corpus-id, ...] (positives only, score > 0)
    qrels = {}
    for _, row in df_r.iterrows():
        if int(row["score"]) <= 0: continue
        qrels.setdefault(row["query-id"], []).append(row["corpus-id"])

    print(f"    corpus={len(df_c)} queries={len(df_q)} qrels-queries={len(qrels)}")

    with open(out_dir / "corpus.jsonl", "w") as f:
        for _, row in df_c.iterrows():
            cid = row["_id"]
            lang = str(row.get("language", "")).lower() or "unknown"
            f.write(json.dumps({
                "doc_id": f"coreb/{lang}/{cid}",
                "code": str(row["text"]),
                "language": lang,
                "func_name": cid,
                "repo": str(row.get("meta_source_problem_id", "")),
                "path": "",
            }) + "\n")

    # Index corpus rows by _id → language so we can map corpus-id → doc_id
    cid_to_lang = {row["_id"]: (str(row.get("language", "")).lower() or "unknown")
                   for _, row in df_c.iterrows()}

    written = 0
    with open(out_dir / "queries.jsonl", "w") as f:
        for _, row in df_q.iterrows():
            if max_queries and written >= max_queries: break
            qid = row["_id"]
            pos = qrels.get(qid, [])
            if not pos: continue
            rel_ids = [f"coreb/{cid_to_lang.get(c, 'unknown')}/{c}" for c in pos]
            # Query language: language_constraint if set, else "any".
            # CoREB queries store the language as metadata only; the NL text
            # is identical across language variants. Bake the constraint into
            # the query text so the retriever can disambiguate the 5 corpus
            # versions of each problem (no instruction-tuning required).
            lc = str(row.get("language_constraint", "")).lower()
            qlang = lc if lc and lc != "none" else "any"
            qtext = _q(row["text"])
            if qlang != "any":
                qtext = f"In {qlang}, {qtext}"
            f.write(json.dumps({
                "query_id": f"CRB{written:05d}",
                "query": qtext,
                "relevant_doc_ids": rel_ids,
                "language": qlang,
            }) + "\n")
            written += 1

    print(f"    Corpus: {len(df_c)}  Queries: {written}")
    return written


# --- 12. BRIGHT code subsets ------------------------------------------------
# xlangai/BRIGHT, code-relevant configs: leetcode, pony, stackoverflow.
# documents/{config} → {id, content}
# examples/{config}  → {query, reasoning, id, excluded_ids, gold_ids_long, gold_ids, gold_answer}

_BRIGHT_CODE_SUBSETS = ["leetcode", "pony", "stackoverflow"]
_BRIGHT_SUBSET_LANG = {"leetcode": "python", "pony": "pony", "stackoverflow": "any"}

def download_bright_code(max_queries=None):
    """Download BRIGHT code-relevant subsets (LeetCode + Pony + StackOverflow)."""
    out_dir = DATA_DIR / "bright-code"
    out_dir.mkdir(parents=True, exist_ok=True)
    c = _cached(out_dir)
    if c is not None:
        print(f"  BRIGHT-code: cached ({c})"); return c

    print("  Downloading BRIGHT code subsets (xlangai/BRIGHT)...")
    try:
        load_ds = _hf_load()
    except Exception as e:
        print(f"    Failed: {e}"); return 0

    # Doc IDs in BRIGHT are already namespaced like "leetcode/leetcode_11.txt".
    # We prefix with bright/ to disambiguate from other benches and keep our
    # repo/path metadata informative.
    total_docs = 0
    with open(out_dir / "corpus.jsonl", "w") as fc:
        for subset in _BRIGHT_CODE_SUBSETS:
            print(f"    docs/{subset}...", end=" ", flush=True)
            try:
                docs = load_ds("xlangai/BRIGHT", "documents", split=subset)
            except Exception as e:
                print(f"skip ({e})"); continue
            lang = _BRIGHT_SUBSET_LANG[subset]
            for row in docs:
                doc_id = f"bright-code/{subset}/{row['id']}"
                fc.write(json.dumps({
                    "doc_id": doc_id,
                    "code": str(row.get("content", ""))[:8000],  # cap absurdly long entries
                    "language": lang,
                    "func_name": row["id"],
                    "repo": f"bright-{subset}",
                    "path": row["id"],
                }) + "\n")
                total_docs += 1
            print(f"{len(docs)}")

    written = 0
    with open(out_dir / "queries.jsonl", "w") as fq:
        for subset in _BRIGHT_CODE_SUBSETS:
            print(f"    queries/{subset}...", end=" ", flush=True)
            try:
                ex = load_ds("xlangai/BRIGHT", "examples", split=subset)
            except Exception as e:
                print(f"skip ({e})"); continue
            lang = _BRIGHT_SUBSET_LANG[subset]
            ct = 0
            for row in ex:
                if max_queries and written >= max_queries: break
                gold = row.get("gold_ids", []) or []
                if not gold: continue
                rel_ids = [f"bright-code/{subset}/{gid}" for gid in gold]
                fq.write(json.dumps({
                    "query_id": f"BR{written:05d}",
                    "query": _q(row["query"]),
                    "relevant_doc_ids": rel_ids,
                    "language": lang,
                }) + "\n")
                written += 1; ct += 1
            print(f"{ct}")

    print(f"    Corpus: {total_docs}  Queries: {written}")
    return written


# --- Main -------------------------------------------------------------------

_DOWNLOADERS = [
    ("codesearchnet", "CodeSearchNet"), ("cosqa", "CosQA"), ("advtest", "AdvTest"),
    ("coir", "COIR"), ("coquir", "CoQuIR"), ("gencodesearchnet", "GenCodeSearchNet"),
    ("crosscodeeval", "CrossCodeEval"), ("clarc", "CLARC"), ("m2crb", "M2CRB"),
    ("cosqaplus", "CoSQA+"), ("coreb", "CoREB"), ("bright-code", "BRIGHT-code"),
]

_DISPATCH = {
    "codesearchnet": lambda m: download_codesearchnet(max_per_lang=m),
    "cosqa":         lambda m: download_cosqa(max_entries=m // 2 if m else None),
    "advtest":       lambda m: download_advtest(max_entries=m),
    "coir":          lambda m: download_coir(max_per_task=m),
    "coquir":        lambda m: download_coquir(max_per_subset=m // 2 if m else 500),
    "gencodesearchnet": lambda m: download_gencodesearchnet(max_per_lang=m),
    "crosscodeeval": lambda m: download_crosscodeeval(max_per_lang=m),
    "clarc":         lambda m: download_clarc(max_per_lang=m),
    "m2crb":         lambda m: download_m2crb(max_per_lang=m),
    "cosqaplus":     lambda m: download_cosqaplus(max_queries=None),
    "coreb":         lambda m: download_coreb(max_queries=None),
    "bright-code":   lambda m: download_bright_code(max_queries=None),
}


def main():
    print("=" * 60)
    print("Sweet Search Benchmark Data Download")
    print("=" * 60)

    target = "all"
    for arg in sys.argv[1:]:
        if arg.startswith("--dataset="):
            target = arg.split("=", 1)[1].lower()

    if "--list" in sys.argv:
        print("\nAvailable datasets:")
        for k, desc in DATASETS.items():
            print(f"  {k:20s} {desc}")
        print("\nUse --dataset=NAME to download one dataset")
        return

    mpl = 1000
    if "--full" in sys.argv:
        mpl = None; print("\nMode: FULL")
    elif "--small" in sys.argv:
        mpl = 200; print("\nMode: SMALL (200/lang)")
    else:
        print(f"\nMode: DEFAULT ({mpl}/lang)  [--full|--small]")

    if target != "all":
        if target not in DATASETS:
            print(f"\nUnknown: {target}. Available: {', '.join(DATASETS)}"); sys.exit(1)
        print(f"\nDataset: {DATASETS[target]}")

    to_dl = [(k, l) for k, l in _DOWNLOADERS if target in ("all", k)]
    total = 0
    for idx, (key, label) in enumerate(to_dl, 1):
        print(f"\n[{idx}/{len(to_dl)}] {label}")
        total += _DISPATCH[key](mpl)

    print(f"\n{'=' * 60}\nTotal: {total} entries\nData: {DATA_DIR}\n{'=' * 60}")


if __name__ == "__main__":
    main()
