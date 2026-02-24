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

def download_cosqa(max_entries=500):
    out_dir = DATA_DIR / "cosqa"
    out_dir.mkdir(parents=True, exist_ok=True)
    c = _cached(out_dir)
    if c is not None:
        print(f"  CosQA: cached ({c})"); return c

    print("  Downloading CosQA...")
    try:
        ds = _hf_load()("code_x_glue_tc_nl_code_search_adv", split="test")
    except Exception as e:
        print(f"    Failed: {e}"); return 0

    entries = []
    for i, row in enumerate(ds):
        if max_entries and len(entries) >= max_entries:
            break
        query = row.get("docstring", row.get("nl", ""))
        code = row.get("code", row.get("code_tokens", ""))
        if isinstance(code, list):
            code = " ".join(code)
        if not query or not code or row.get("label", 1) != 1:
            continue
        entries.append({"query": _q(query), "doc_id": f"cosqa/python/func_{i}",
                        "code": code, "language": "python", "func_name": f"func_{i}"})

    _write_output(out_dir, entries, "CQ")
    print(f"    {len(entries)} entries"); return len(entries)


# --- 3. AdvTest -------------------------------------------------------------

def download_advtest(max_entries=1000):
    out_dir = DATA_DIR / "advtest"
    out_dir.mkdir(parents=True, exist_ok=True)
    c = _cached(out_dir)
    if c is not None:
        print(f"  AdvTest: cached ({c})"); return c

    print("  Downloading AdvTest...")
    try:
        ds = _hf_load()("code_x_glue_ct_code_to_text", "python", split="test")
    except Exception as e:
        print(f"    Failed: {e}"); return 0

    entries = []
    for i, row in enumerate(ds):
        if max_entries and len(entries) >= max_entries:
            break
        code, doc = row.get("code", ""), row.get("docstring", "")
        if isinstance(code, list): code = " ".join(code)
        if isinstance(doc, list): doc = " ".join(doc)
        if not code or not doc or len(doc.strip()) < 10 or code.strip() == doc.strip():
            continue
        entries.append({"query": _q(doc), "doc_id": f"advtest/python/func_{i}",
                        "code": code, "language": "python", "func_name": f"func_{i}"})

    _write_output(out_dir, entries, "AT")
    print(f"    {len(entries)} entries"); return len(entries)


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

CLARC_SPLITS = ["group1_original", "group2_original"]


def download_clarc(max_per_lang=1000):
    out_dir = DATA_DIR / "clarc"
    out_dir.mkdir(parents=True, exist_ok=True)
    c = _cached(out_dir)
    if c is not None:
        print(f"  CLARC: cached ({c})"); return c

    print("  Downloading CLARC...")
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
            continue
        print(f"    {split_name}...", end=" ")
        ct = 0
        for row in ds[split_name]:
            if max_per_lang and ct >= max_per_lang: break
            code = row.get("code_text", "")
            query = row.get("query_text", "")
            relevance = int(row.get("relevance", 0))
            code_id = row.get("code_id", "")
            if not code or not query or relevance < 1: continue
            if code_id in seen: continue
            seen.add(code_id)
            # Detect C vs C++: std:: or templates indicate C++
            lang = "cpp" if ("std::" in code or "template" in code[:200] or
                             "#include <" in code and ("vector" in code or "string" in code)) else "c"
            entries.append({"query": _q(query), "doc_id": f"clarc/{lang}/{code_id}",
                            "code": code, "language": lang, "func_name": code_id})
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


# --- Main -------------------------------------------------------------------

_DOWNLOADERS = [
    ("codesearchnet", "CodeSearchNet"), ("cosqa", "CosQA"), ("advtest", "AdvTest"),
    ("coir", "COIR"), ("coquir", "CoQuIR"), ("gencodesearchnet", "GenCodeSearchNet"),
    ("crosscodeeval", "CrossCodeEval"), ("clarc", "CLARC"), ("m2crb", "M2CRB"),
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
