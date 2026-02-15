#!/usr/bin/env python3
"""
Download benchmark datasets from HuggingFace for Sweet Search evaluation.

Datasets:
  1. CodeSearchNet (code-to-NL retrieval) - Python, JavaScript, Go
     Downloaded via HuggingFace zip files, extracted to JSONL.
  2. CosQA (NL-to-code, web queries) - Python (optional)

Output: eval/data/{dataset_name}/{corpus,queries}.jsonl
"""

import json
import gzip
import io
import sys
import zipfile
import urllib.request
from pathlib import Path


HF_CSN_BASE = "https://huggingface.co/datasets/code-search-net/code_search_net/resolve/main/data"


def download_codesearchnet(languages=("python", "javascript", "go", "ruby", "java", "php"), max_per_lang=1000):
    """Download CodeSearchNet test splits directly from HuggingFace zip files."""
    out_dir = Path(__file__).parent / "data" / "codesearchnet"
    out_dir.mkdir(parents=True, exist_ok=True)

    all_entries = []

    for lang in languages:
        lang_file = out_dir / f"{lang}_test.jsonl"

        # Check if already downloaded
        if lang_file.exists():
            print(f"  {lang}: Using cached {lang_file}")
            with open(lang_file) as f:
                entries = [json.loads(line) for line in f if line.strip()]
            all_entries.extend(entries)
            continue

        url = f"{HF_CSN_BASE}/{lang}.zip"
        print(f"  Downloading {lang}.zip from HuggingFace...")

        try:
            resp = urllib.request.urlopen(url)
            zip_bytes = io.BytesIO(resp.read())
        except Exception as e:
            print(f"    Failed to download {lang}: {e}")
            continue

        # Extract test split from the zip
        # Structure: {lang}/final/jsonl/test/{lang}_test_0.jsonl.gz
        entries = []
        seen_ids = set()
        idx = 0

        with zipfile.ZipFile(zip_bytes) as zf:
            test_files = sorted([
                n for n in zf.namelist()
                if '/test/' in n and n.endswith('.jsonl.gz')
            ])

            if not test_files:
                # Fallback: try flat structure
                test_files = sorted([
                    n for n in zf.namelist()
                    if 'test' in n.lower() and (n.endswith('.jsonl.gz') or n.endswith('.jsonl'))
                ])

            print(f"    Found {len(test_files)} test files in zip")

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
                    func_name = row.get("func_name", f"func_{idx}")
                    repo = row.get("repo", row.get("repository_name", "unknown"))
                    fpath = row.get("path", "")
                    code = row.get("whole_func_string", row.get("code", ""))
                    docstring = row.get("func_documentation_string", row.get("docstring", ""))

                    if not code or not docstring or len(docstring.strip()) < 10:
                        idx += 1
                        continue

                    doc_id = f"{lang}/{repo}/{func_name}"
                    if doc_id in seen_ids:
                        doc_id = f"{doc_id}_{idx}"
                    seen_ids.add(doc_id)

                    entries.append({
                        "query": docstring.strip().split("\n")[0][:500],
                        "doc_id": doc_id,
                        "code": code,
                        "language": lang,
                        "repo": repo,
                        "path": fpath,
                        "func_name": func_name,
                    })
                    idx += 1

                if max_per_lang and len(entries) >= max_per_lang:
                    break

        with open(lang_file, "w") as f:
            for entry in entries:
                f.write(json.dumps(entry) + "\n")

        print(f"    Saved {len(entries)} entries to {lang_file}")
        all_entries.extend(entries)

    # Write combined corpus and queries files
    corpus_file = out_dir / "corpus.jsonl"
    with open(corpus_file, "w") as f:
        for entry in all_entries:
            f.write(json.dumps({
                "doc_id": entry["doc_id"],
                "code": entry["code"],
                "language": entry["language"],
                "func_name": entry["func_name"],
                "repo": entry["repo"],
                "path": entry.get("path", ""),
            }) + "\n")

    queries_file = out_dir / "queries.jsonl"
    with open(queries_file, "w") as f:
        for i, entry in enumerate(all_entries):
            f.write(json.dumps({
                "query_id": f"Q{i:05d}",
                "query": entry["query"],
                "relevant_doc_ids": [entry["doc_id"]],
                "language": entry["language"],
            }) + "\n")

    print(f"\n  Combined: {len(all_entries)} entries")
    print(f"  Corpus:  {corpus_file}")
    print(f"  Queries: {queries_file}")
    return len(all_entries)


def download_cosqa(max_entries=500):
    """Download CosQA dataset (web queries -> Python code) via HuggingFace datasets library."""
    out_dir = Path(__file__).parent / "data" / "cosqa"
    out_dir.mkdir(parents=True, exist_ok=True)

    corpus_file = out_dir / "corpus.jsonl"
    if corpus_file.exists():
        count = sum(1 for _ in open(corpus_file))
        print(f"  CosQA: Using cached ({count} entries)")
        return count

    print("  Downloading CosQA...")
    try:
        from datasets import load_dataset
        ds = load_dataset("code_x_glue_tc_nl_code_search_adv", split="test")
    except Exception as e:
        print(f"    CosQA download failed: {e}")
        print("    Skipping CosQA (optional dataset)")
        return 0

    entries = []
    for i, row in enumerate(ds):
        if max_entries and len(entries) >= max_entries:
            break

        query = row.get("docstring", row.get("nl", ""))
        code = row.get("code", row.get("code_tokens", ""))
        label = row.get("label", 1)

        if isinstance(code, list):
            code = " ".join(code)

        if not query or not code or label != 1:
            continue

        doc_id = f"cosqa/python/func_{i}"
        entries.append({
            "query": query.strip()[:500],
            "doc_id": doc_id,
            "code": code,
            "language": "python",
            "func_name": f"func_{i}",
        })

    with open(corpus_file, "w") as f:
        for entry in entries:
            f.write(json.dumps({
                "doc_id": entry["doc_id"],
                "code": entry["code"],
                "language": entry["language"],
                "func_name": entry["func_name"],
            }) + "\n")

    queries_file = out_dir / "queries.jsonl"
    with open(queries_file, "w") as f:
        for i, entry in enumerate(entries):
            f.write(json.dumps({
                "query_id": f"CQ{i:04d}",
                "query": entry["query"],
                "relevant_doc_ids": [entry["doc_id"]],
                "language": entry["language"],
            }) + "\n")

    print(f"    Saved {len(entries)} entries")
    return len(entries)


def main():
    print("=" * 60)
    print("Sweet Search Benchmark Data Download")
    print("=" * 60)

    max_per_lang = 1000
    if "--full" in sys.argv:
        max_per_lang = None
        print("\nMode: FULL (all test data)")
    elif "--small" in sys.argv:
        max_per_lang = 200
        print("\nMode: SMALL (200 per language, for quick testing)")
    else:
        print(f"\nMode: DEFAULT ({max_per_lang} per language)")
        print("  Use --full for complete test sets, --small for quick validation")

    print("\n[1/2] CodeSearchNet (Python, JavaScript, Go)")
    csn_count = download_codesearchnet(max_per_lang=max_per_lang)

    print("\n[2/2] CosQA (Web queries -> Python code)")
    cosqa_count = download_cosqa(max_entries=max_per_lang // 2 if max_per_lang else None)

    print("\n" + "=" * 60)
    print(f"Total: {csn_count + cosqa_count} benchmark entries downloaded")
    print(f"Data directory: {Path(__file__).parent / 'data'}")
    print("=" * 60)


if __name__ == "__main__":
    main()
