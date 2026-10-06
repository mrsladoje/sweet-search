# HNSW rival benchmark (FAISS, USearch, hnswlib)

Method and results: `docs/HNSW_APPROACH.md#competitor-benchmark-2026-10`.
Run from a work directory (scripts write `<name>/` there); paths to the repo
are hardcoded to `/Users/admin/Projects/sweet-search-private` — edit `R`.
Python: `pip install faiss-cpu usearch hnswlib numpy`.

1. `node export2.mjs <name> <indexRoot> <queries.jsonl> <corpus.jsonl> <nQ> [split.json]`
   — corpus 768-d vectors, query embeddings, gold labels.
2. `node build-scale.mjs` / `build-cap.mjs` — distractor sets (GCSN + non-held-out dev repos).
3. `node ours2.mjs <name>` — our production cascade → `<name>/ours.json`.
4. `python theirs3.py <name>` — rival build/efSearch grid → `<name>/results3.json`.
5. `node oursmem.mjs <name> [rebuild]`, `node tput-ours.mjs <name> 12`,
   `python tput-theirs.py <name> '<configs>'`, `python summarize3.py <names...>`.

Held-out sets: report aggregate numbers only.
