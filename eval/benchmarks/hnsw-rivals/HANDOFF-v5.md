# HNSW kernel + paper benchmark — plan and handoff v5

Written 2026-10-15 on main 39a4c4aa. Read `HANDOFF-v4.md` §8–8f first (how we got here), then this file.

Goal, in the owner's order:
1. Keep improving the vector kernel until it stops paying: **memory footprint, storage size, speed**, with
   no loss of accuracy (accuracy has almost no headroom left, see §1.3).
2. Then harden the benchmark until a reviewer cannot dismiss it (models, sets, rivals, metrics, hardware,
   disclosure).
3. Then run the held-out benchmark once, on the frozen kernel, and write the paper tables from it.

Deadline context (owner memory): ETH application 30 Nov 2026, EPFL 15 Dec; Zenodo DOI by ~10 Nov; no
release before an arXiv paper. Phases B–D (kernel) must not eat the time of phase G (benchmark).


## 0. Rules (do not break)

- **Dev for every choice; held-out aggregate only, read once at the end** (phase H). New sets get their
  dev / held-out split (60/40, seed 42, stratified) BEFORE anyone looks at results.
- **No back-compat, no migration code.** An old index can stop working; a full rebuild fixes it. No `SS_FIX_*`
  legacy switches for new work: A/B through `ab.sh` arms (env knobs that are deleted after the decision) or
  through two repo copies (`R=` per arm).
- **Accuracy is not traded.** Output-changing levers ship only when every dev set has MRR@10 change with a 95%
  paired-bootstrap CI that contains 0 and a point estimate >= -0.0002, and recall@10 vs exact does not drop
  by more than 0.002. Identical-output levers ship on any speed / memory / disk win that is mechanistically
  sound and above noise (owner: "any win however small").
- **Kernel knobs: Pareto knee**, not max MRR (owner cut S1 1000 -> 400 on 10-14).
- **One heavy job per machine.** Mac: only when the owner's machine is quiet (two readings 30 min apart:
  5- and 15-min load < 5, top process < 150% CPU, >= 50% memory free; `wait-quiet.sh` pattern). Box first.
- Commit only your own paths (`git commit -- <paths>`); push to main. Another session edits this repo.
- No paid runs (bare-metal rental, API embedding models) without the owner's explicit yes.
- No product reindex or release until the owner says tuning is done (phase H step 4 needs that go).
- macOS tar to the box: `COPYFILE_DISABLE=1` (AppleDouble `._*` files broke 3 test suites on 10-15).


## 1. Where we stand (main 39a4c4aa)

### 1.1 Speed and quality, held-out, 3 interleaved runs, aggregate only

| Set | Vectors | Mac p50 | x86 p50 | MRR@10 | Closest rival at our MRR (Mac / x86) |
|---|---|---|---|---|---|
| GCSN | 6,918 | 38 us | 52 us | .8359 | binflat x2.18 / x2.45 |
| GCSN + distractors | 20,000 | 51 | 77 | .8220 | binflat x2.12 / x2.31 |
| AdvTest | 21,731 | 54 | 85 | .4731 | binflat x5.21 / RaBitQ-flat x4.85 |
| GCSN + all distractors | 140,449 | 173 | 304 | .7881 | binflat x1.67 / x1.62 |
| CSN 1M | 1,004,739 | 145 | 217 | .5330 | USearch i8 x2.28 / x4.19 |

ARM and x86 give identical results query by query. Pareto-best from our fastest point (S1 = 150) upward; below
it rivals are faster at lower MRR (HANDOFF-v4 §8f has both sweeps).

### 1.2 Memory and storage (the weak side)

1M process RSS in the bench: 5.3 GB (Mac). Rivals' index_mb at 1M: USearch i8 2.0 GB, hnswlib 3.1 GB, FAISS
Flat M64 3.1 GB, FAISS RaBitQ+refine 3.0 GB, FAISS SQ8+refine 4.2 GB, binflat 61 MB (+ full vectors to rerank).
Our RSS mixes anonymous memory with file-backed pages of the mmap vector file; nobody has split it yet.

Read from the code (NOT measured; phase A measures it):
- The level lists live twice: JS `this.graph[l][i]` (arrays of numbers, ~8 B per link + array headers, ~1 GB+
  at 1M) and the native CSR copy (4 B per link, ~0.5 GB). The JS copy stays because inserts
  (`addToGraph`, `pruneNeighbors`) are JS, and incremental indexing inserts into a live index.
- Per node: a `{id, binary, metadata}` object, an `idToIndex` Map entry with a string key, and an Int8Array view
  per int8 row (`Int8VectorMap`, rows rebound into one slab). Several hundred MB at 1M.
- Codes: JS slab + native aligned copy (64 B each per vector).
- `oursmem.mjs` is stale: it still counts `float512` and `full768Cache`.

Disk per vector at 1M (csn1m bench index):

| File | Bytes / vector | Note |
|---|---|---|
| `.vectors.json` (ids + binary codes as JSON) | 366 | codes are 64 B raw |
| `.graph.json` | 1,258 | CSR would be ~500 (<=128 links x 4 B) |
| `.int8.json` | 1,415 | raw is 512 |
| `.fullvec.bin` (+ `.map`) | 3,072 + 4 | f32, node order |
| SQLite `vectors.embedding` BLOB (product, `indexer-build.js:254`) | 3,072 | same vector a second time |
| **Total vector data** | **~9,200** | |

### 1.3 Accuracy headroom

Brute-force sims on csn1m-dev (HANDOFF-v4 §8b): exact 768-d search .5555; ours (S1 = 400) .5538. The whole
remaining gap to exact search at 1M is ~.0017, and S1 1000 buys +.0018 at 1.9x time (rejected at the knee).
Already rejected: int8 scale change, centring before the sign bit, asymmetric binary codes (HNSW_APPROACH.md),
weight 0.8 blend, re-prune without back-fill, walk floor 300, head x0.5. So accuracy work is limited to "do not
lose any" while memory and storage shrink (phase E holds the few untested ideas).


## 2. How each round runs (the loop)

For every lever in phases B–E:
1. Measure the baseline with the phase-A tools (same machine, same build, 3 interleaved runs).
2. Implement on a scratch copy or behind a temporary env knob read only by the bench (deleted after the decision).
3. Dev A/B: `ab.sh <set> <tag> 3 "base|" "arm|KNOB=1"` on all 5 dev sets (3,600 queries each), score with
   `abscore.py` (identical share, MRR CI, recall, p50 per run). Memory / disk levers also record the phase-A
   memory and disk numbers.
4. Decide with the rules in §0. Identical-output levers need `same = 1.0000` on every dev set.
5. Ship: final code without the knob, parity check final code vs the tested arm (0 diffs), tests on the box,
   commit + push, one line in this file's log (§9), wiki update (artifact M1SCsePXYngJba19gvcnve).
6. Mac check of each shipped batch when the Mac is quiet (ARM parity + p50).

Stop rule per axis: stop that axis after two rounds in a row ship nothing, or when its target in §3 is met.


## 3. Targets (1M, both machines)

| Axis | Now | Target | Why it is reachable |
|---|---|---|---|
| Disk, vector data | ~9.2 KB/vector | <= 2.6 KB | raw binary (64 + ~500 + 512) + f16 full vectors (1,536) + no SQLite copy |
| Anonymous RAM in the search process | unknown (RSS 5.3 GB total) | <= 1.3 GB | codes 64 MB + CSR ~0.5 GB + int8 0.5 GB + id table; no JS copies |
| File-backed RAM | up to the whole vector file | report separately; halves with f16 | page cache, reclaimable |
| Load time (1M) | JSON parse, 24–35 s on x86 | < 3 s | read raw arrays |
| p50 at 6.9k (Mac / x86) | 38 / 52 us | <= 28 / 40 us | fused native cascade (phase B) |
| p50 at 1M | 145 / 217 us | <= 125 / 190 us | same; stage 1 unchanged |
| Our build time + peak RAM (1M) | not measured; JS build | measured; native build if > rivals' | reviewers ask |
| MRR@10 | as §1.1 | equal (rules §0) | |


## 4. Phase A — measure first (box, then Mac)

A1. Memory breakdown tool (replace `oursmem.mjs`): after load and after 3 query runs, print
    - anonymous vs file-backed RSS: Linux `/proc/self/smaps_rollup` (Anonymous, Rss, Shared_Clean/Private_Clean
      of the fullvec mapping via `/proc/self/smaps`); macOS `vmmap --summary <pid>` or `footprint <pid>`;
    - V8 heap (`process.memoryUsage()`: heapUsed, external, arrayBuffers);
    - per structure, computed: JS graph arrays, native CSR (`exportLevel` lengths x 4), code slabs (JS + native),
      int8 slab, per-node objects (heap snapshot diff or `--expose-gc` before/after dropping them), id maps.
    Output one JSON per set; add a `mem` column to the results tables.
A2. Disk table per file per vector (as §1.2) for every set, written by the same tool.
A3. Load time and peak RSS during load (1M).
A4. Build time and peak RSS of our index build at 1M and 140k (the JS build, `build-1m.mjs` path), single run;
    rivals already record build_s with 12 threads.
A5. Stage time split for the floor: hrtime around query encode, stage 1, int8, head trim, full-vector rescore,
    result objects, in the product call path that `ours.mjs` times. 3,600 dev queries, 6.9k and 1M.
A6. Fix `tput-ours.mjs`: today each worker loads its own index (memory x workers). Throughput must share one
    index (native searcher used from several threads, or worker threads over one SharedArrayBuffer-backed
    index). Without this the throughput comparison is unfair to us on memory and to the rivals on setup.

Deliverable: a filled §1.2 with measured numbers, and the order of B–D items re-ranked by measured size.


## 5. Phase B — speed (identical output)

B1. **Fused native cascade.** One native call: query encode (cut to 512, renormalise, sign bits, int8),
    stage 1 (scan or walk), int8 rescore of all candidates, head trim, full-vector rescore from the mmap
    file, top-k. Returns a typed array of node numbers + scores; JS maps only the k final nodes to ids.
    Today `searchCascade` makes `cascade_stage1` + `cascade_int8` calls and the full-vector step in JS with
    per-candidate arrays. Must keep the same float order of operations (bit-identical scores) or prove ties.
B2. Prefetch the head's full vectors (`madvise(WILLNEED)` or software prefetch of the first lines) while the
    int8 stage runs.
B3. No per-candidate JS objects anywhere in the vector path; results objects only for the final k.
B4. Expose S1 below 150 at k = 10 for the bench sweep only (today stage 1 never returns fewer than 150), so the
    paper's Pareto curve can go to the low-MRR end. Product default stays at the knee (400).
B5. Native build / insert (only if A4 shows our build is a reviewer problem, or if C1 needs it anyway).


## 6. Phase C — memory (identical output)

C1. **One owner of the graph.** Native CSR is the only copy at query time. Inserts: either native insert
    (port `addToGraph` / `searchLayer` / `pruneNeighbors` / `selectNeighborsHeuristic` to Rust, which also
    speeds the build), or append-only overflow lists in native for incremental adds plus a CSR rebuild on
    save. Same neighbour choice and order as the JS today (identical graph from identical input), checked by
    `exportLevel` equality on the 5 bench indexes.
C2. **Node table instead of objects.** Ids in one string table (or one offsets + UTF-8 buffer), metadata out of
    the per-node object (it is unused on the search path, check), id -> node via one hash map built at load.
    No Int8Array view per row: the slab and the node number are enough.
C3. Codes: one aligned native copy only.
C4. int8 slab: anonymous (today) vs mmap from the new index file. A/B, it is a speed risk (400 random rows per
    query). Keep anonymous if it costs > noise.
C5. Report the vector file's page-cache share separately (file-backed, reclaimable). No change needed.


## 7. Phase D — storage

D1. **One binary index file** replacing `.vectors.json`, `.graph.json`, `.int8.json`, `.meta.json` and the
    opt-in packed format (`SWEET_SEARCH_HNSW_MMAP=1`, `saveMmap`/`loadMmap`): header (version, dims, counts,
    M, levels, entry point), id table, codes, CSR per level, int8 rows, aligned sections. Load = read into the
    native 2 MB-aligned huge-page buffers (NOT a direct mmap of codes / graph: file-backed pages lose THP on
    x86, and huge pages gave ~2x at 1M). Delete the JSON and the packed paths (no back-compat).
D2. Re-prune level 0 to 128 links at build time (owed since 10-14; today it runs at every load above 150k).
D3. Graph compression on disk only (sorted neighbour lists, delta + varint), decoded at load. Disk lever only;
    take it if load stays < 3 s at 1M.
D4. **f16 full vectors** in the vector file (3,072 -> 1,536 B, also halves its page cache). Output-changing:
    dev A/B with the §0 accuracy rule. bf16 as the second arm. If f16 passes, the rescore kernels read f16
    (NEON has native f16; AVX2 via F16C `vcvtph2ps`).
D5. **No second copy of the full vector in SQLite.** `vectors.embedding BLOB NOT NULL` duplicates the vector
    file. Readers to move: `getEmbeddingsByIds` (only the SQLite fallback `_loadFloatVectors` of the float-512
    stage, `search-semantic.js:514`; that stage and its float store are off by default behind `SS_FIX_FLOAT512=1`
    and were measured equal without them: delete stage, store and fallback), `vector-delta-writer.mjs` (reuses the BLOB for row
    versions), the rebuild path (reads embeddings from SQLite to rebuild the index without re-embedding; it must
    read the vector file instead). Product-wide change in the indexer: show the owner the reader list first.


## 8. Phase E — accuracy (only if B–D leave time; low expectations)

Untested ideas, each a dev A/B at the knee:
- Wider full-vector head (k x 8, k x 10): cheap at stage 3, may close part of the .0017 gap at 1M.
- int8 over all 768 dims instead of the first 512 (+256 B/vector RAM; check the cost against D/C gains).
- Binary codes over 768 bits for the scan path only (<= 150k sets), where stage 1 is a scan, not a walk.
Do not retry the rejected list in §1.3.


## 9. Phase F — freeze

Tag the kernel commit (`hnsw-kernel-freeze-YYYYMMDD`). Rebuild the Mac addon locally (gitignored). From here
until phase H ends, no kernel change; if one is unavoidable, restart phase H for every system.


## 10. Phase G — harden the benchmark (before any final run)

G1. **Embedding models.** Today one model (CodeRankEmbed, 768-d). Add one more code model and one text model,
    open weights, run on our GPU box. Prefer 768-d first (no kernel change); one model with another width
    shows generality but needs the kernel's "first 512 dims" assumption made a parameter. Check per model on
    dev whether codes from the first 512 dims or from all dims are better (CodeRankEmbed truncation may not
    transfer to models without nested-dimension training). Owner picks the models (candidates: a jina code
    model, CodeSage, bge-base / e5-base / gte-base for text; API models are paid: owner approval).
G2. **Sets.** Keep the 5 code sets. Add a BEIR text set at 0.5–3M docs (Quora 523k or NQ 2.68M) and one small
    BEIR set. Split 60/40 seed 42 before any run. Quality: MRR@10 and nDCG@10 for BEIR, recall@10 vs exact for
    all.
G3. **Rivals.** Add ScaNN and DiskANN (in-memory Vamana; disk mode optional). Keep FAISS (HNSW Flat / SQ8+refine
    / RaBitQ / IVF-PQ / binflat cascade), hnswlib, USearch (f16, i8, i8+rescore, b1 cascade). One rival build,
    same versions on both machines (the Mac rivals binary is older and rebuilt graphs per round; rebuild it
    from the current `rivals.cpp`). Document each rival's sweep (M / efC / ef; ScaNN leaves / reorder; DiskANN
    R / L) and give each its best rescore option.
G4. **Metrics per point:** p50 / p95 / p99 single-thread; QPS at 1, 4, 8 threads with one shared index (A6);
    recall@10 vs exact; MRR@10 (+ nDCG@10); build time and build peak RAM; steady RAM split anonymous /
    file-backed; disk bytes; load time; cold-cache first-query and steady latency (Linux `drop_caches`, macOS
    `purge`).
G5. **Our harness overhead.** Our timings include JS; rivals are C++. Keep that (it is against us) and add a
    native-only timing of the same cascade, so the paper can show both.
G6. **Statistics.** >= 3 interleaved rounds per config, medians; paired bootstrap CIs for quality; a noise row
    (one config repeated) per machine.
G7. **Hardware.** M3 Max + x86 KVM box (noise up to 15%). A bare-metal x86 server removes the noise
    attack; it is a paid rental: owner decides.
G8. **Disclosure, written now:** held-out aggregates were read at milestones on 10-14/15 while choices were
    made on dev; seeds; library versions; machine specs; all configs swept.
G9. **Release kit:** data splits, ground truth, harness, "add a system" guide, licence; Zenodo DOI (target
    ~10 Nov).
G10. **Dry run on dev** of the whole matrix (all models x sets x systems, reduced sweeps) to catch harness
    bugs before held-out.


## 11. Phase H — the held-out run (once)

1. Box: all systems x models x sets, 3 rounds, held-out queries. Then the Mac, same matrix, when quiet.
2. Score aggregates only (`score4.py`, `closest.py`, `front.py`), write the paper tables. No tuning after this.
3. Publish: wiki §09 replaced by the final tables; HANDOFF line; Zenodo upload.
4. Product end-to-end held-out (GCSN full pipeline, BM25 + late interaction, `run_benchmark --profile=full`)
   after the reindex, only when the owner says tuning is done (all product indexes need a full rebuild to get
   the new index file anyway).


## 12. Owner decisions needed (ask when the phase starts, not before)

- Models for G1 and the BEIR sets for G2.
- Bare-metal x86 rental (G7), any API model (G1): paid.
- D5 (drop the SQLite embedding copy): touches the indexer and incremental indexing.
- Phase H step 4 timing (reindex).
- If the deadline gets close: cut order is E, then B5, then D3, then G7. Never cut G1, G3, G4, G6, G8.


## 13. Tools and places

Repo `eval/benchmarks/hnsw-rivals/`: `ours.mjs` (our arm, knobs S1 / EF / K, OUT=), `ab.sh` (interleaved
arms, rotated order, `R=` per arm), `abscore.py` (A/B scorer), `score4.py` (rival + ours scoring, writes
scored4.json), `closest.py` (closest rival at our MRR), `front.py` (rival points we do not dominate),
`build-fullvec.mjs` (vector file for an existing index), `rivals.cpp` + `build-native.sh` /
`build-native-linux.sh`, `tput-ours.mjs` / `tput-theirs.py` (throughput; fix per A6), `oursmem.mjs` (stale,
replace per A1), `sim-*.py` (brute-force cascade sims), `run-all*.sh` / `run4.sh` (rival rounds).

Mac: sets in `~/.ss-eval/hnsw-bench/{v4/<set>, gcsn-dev-mac, csn1m-dev, ...}`, scoring dirs `v4s/<set>`,
python `~/.ss-eval/hnsw-bench/venv/bin/python`. Box: `/root/hnsw-x86/{repo, repo-prev, test-repo, sets, hb/kab}`,
queues `queue-box*`, scoring dirs `v4s/<set>`.
Wiki: https://claude.ai/artifact/M1SCsePXYngJba19gvcnve (v11).


## 14. Log

- 2026-10-15: plan written (main 39a4c4aa). Nothing from phases A–H started.
