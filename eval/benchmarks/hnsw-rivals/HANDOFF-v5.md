# HNSW kernel + paper benchmark — plan and handoff v5

Written 2026-10-15 on main 39a4c4aa. Read first, in this order:
1. The wiki artifact **https://claude.ai/artifact/M1SCsePXYngJba19gvcnve** (v11; read it with the Artifact tool,
   `action: "read"`). It holds the cascade, every trick with its evidence, the open questions (§10), the action
   plan (§11), the research findings (§12), the rival playbook (§13) and the paper strategy (§14). §5 of this file
   lists every wiki strategy that is still untested; each one gets a test (owner: "try each of those that we
   haven't yet").
2. `HANDOFF-v4.md` §8–8f (how we got here).
3. This file.

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
- **Never slower and never less accurate, unless the trade is clearly worth it** (owner, 10-15). Decision
  rule for every lever, with deltas from the phase-A tools on all 5 dev sets, both machines:

  | Lever result | Ship? |
  |---|---|
  | Identical output, faster or smaller, above noise | Yes, any size (owner: "any win however small") |
  | Identical output, no gain | No (no code for nothing) |
  | MRR equal (95% paired CI contains 0, point >= -0.0002, recall@10 vs exact >= -0.002), faster and/or smaller | Yes |
  | MRR equal, slower by <= 5% p50 on every set, AND a large saving: >= 20% of working RAM or >= 25% of disk at 1M | Yes, if still Pareto-best (below) |
  | MRR equal, more RAM or disk by <= 5%, AND >= 10% faster on the 1M and 140k sets | Yes, if still Pareto-best |
  | MRR down beyond the equal band | No, whatever the gain |
  | Slower by > 5%, or more RAM / disk by > 5% | No (re-run the knee instead if it is a knob) |

  "Still Pareto-best": rivals were run on held-out queries only, so do not read held-out for this. Take the
  closest-rival ratio of §1.1 for each set and machine and divide it by (new p50 / old p50) from the dev runs.
  It must stay > 1.2 on every set (the smallest today is x1.62 at 140k). MRR is inside the equal band by the
  rows above, so the rival points at or above our MRR do not change.
  **Slowdown budget:** all accepted slowdowns together may cost at most 5% p50 per set from the phase-A
  baseline. They do not stack beyond that: a later trade must first win back time elsewhere.
  Prefer to pair a slowing memory lever with a speed lever in the same round, so the net change is >= 0.
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

Read from the code before phase A (two of the three readings were wrong, see the measured table below):
- ~~The level lists live twice~~: no. The native load path (`_loadGraphNative`) released the JS graph; JS
  arrays exist only after a write thaws them.
- Per node: a `{id, binary view, metadata}` object, an `idToIndex` Map entry, and an Int8Array view per int8 row.
- Codes: THREE copies, not two: JS slab + its WASM mirror + the native aligned copy.

**Phase A measured (2026-10-15, x86 box, main 4ead179f code, 3,600 dev queries x 3 runs, `oursmem.mjs`):**

| | 6.9k | 20k | AdvTest 22k | 140k | 1M |
|---|---|---|---|---|---|
| load s | 0.2 | 0.5 | 0.7 | 3.1 | 35.3 |
| peak RSS during load MB | 149 | 210 | 344 | 565 | 4,279 |
| anonymous MB after load | 89 | 133 | 251 | 439 | 2,640 |
| vector-file pages in RSS after queries MB | 20 | 59 | 64 | 412 | 2,872 |
| native CSR graph MB | 5 | 14 | 15 | 100 (unused: exact scan) | 527 |
| int8 slab MB + per-row JS views MB | 3 + 1 | 10 + 4 | 11 + 4 | 69 + 30 | 491 + 234 |
| node records (heap freed when dropped) MB | 3 | 5 | 9 | 38 | 313 |
| codes: native + JS slab (+ WASM mirror) MB | 0.4 + 0.5 | 1 + 2 | 1 + 2 | 9 + 16 | 61 + 64 |
| V8 heap total / used MB | 63 / 14 | 69 / 21 | 125 / 25 | 146 / 96 | 917 / 712 |
| disk B/vector (index files + codebase.db) | 11,455 | 9,913 | 11,142 | 10,054 | 10,346 |

(1M "anonymous after queries" in the first tool run read 3,164 MB; 520 MB of that was the tool's own `exportLevel`
copies. `oursmem.mjs` now reads the graph after the memory readings; a per-mapping diff over 10,800 queries shows
+16 MB, no leak.) Bench metadata is `{}` per node; product indexes hold a 12-field object per node (file, lines,
language, simhash, cluster ids), so product node records are larger than the bench shows.

Build (A4, `buildtime.mjs`, one JS thread): 140k 266 s, peak RSS 1,653 MB (input embeddings 558 MB of it);
1M: see the log (§15).

Time split per query (A5, `split.mjs`, x86, p50 us; total = semanticSearch3Stage as ours.mjs times it):

| Set | total | embed (LRU) | encode | stage-1 JS prelude | stage 1 native | int8 (400) | head objects | full-vector (50) | rest |
|---|---|---|---|---|---|---|---|---|---|
| 6.9k | 50.3 | 0.9 | 2.9 | 3.7 | 13.6 | 13.1 | 1.4 | 10.1 | 4.8 |
| 20k | 75.8 | 0.9 | 3.5 | 3.7 | 37.3 | 13.5 | 1.5 | 10.7 | 4.9 |
| AdvTest | 84.3 | 0.9 | 3.5 | 3.9 | 43.9 | 13.9 | 1.6 | 10.8 | 4.9 |
| 140k | 295.6 | 1.0 | 3.4 | 4.3 | 249.9 | 15.3 | 1.8 | 11.5 | 7.9 |
| 1M | 200.2 | 1.1 | 4.4 | 9.9 | 147.4 | 16.6 | 2.2 | 12.4 | 2.9 |

JS around the native calls costs 13-21 us per query (26% at 6.9k, 10% at 1M). The int8 stage costs 13-17 us at
every size, so it is compute-bound, not memory-bound (the query was re-widened for each of the 400 rows; ARM used a
plain loop, not `sdot`). The 400-key sort is 2.4 us on the M3 (a radix sort saves 0.4 us: not worth it).

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

Stop rule per axis: stop that axis after two rounds in a row ship nothing AND every §5 item for that axis has
had its test, or when its target in §3 is met and the §5 items for it are done.


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


## 5. Every untested strategy from the wiki (artifact §10–§14), and where it runs

Status as of v11. "Already done" items are left out (huge pages, S1 split + knee, re-prune with back-fill,
vector file, W = 1, int8-all, AVX2 kernels). Rejected items stay rejected (sliding prefetch window, tie stop,
per-vector int8 scale, centring, asymmetric rotation, inline neighbour codes, ScaNN partitions + 4-bit scan,
LVQ navigation, Hamming early-abandon, RaBitQ bound skipping). Each item below is one round of §2.

| # | Strategy (wiki ref) | Output | Axis | Phase | Note for the test |
|---|---|---|---|---|---|
| W1 | Node per-query overhead: LRU lookup, promise hops, result objects (H6) | identical | speed | B1–B3 | measure in A5 first |
| W2 | Prefetch the visited byte and CSR offset of the next node (plan #3, hnswlib hnswalg.h:398-436) | identical | speed | B | skipped on 10-14; visited bytes fit in cache at 1M, so expect noise; one A/B on x86 |
| W3 | Greedy descent outside the v3 kernel copies (O7) | identical | speed | B | check its share in the profile; move into the v3 copy if > noise |
| W4 | Stride / small prefetch per VSAG (+2–7%, §12) | identical | speed | B | not the rejected window; a 1–2 node lookahead on the candidate heap |
| W5 | Relabel nodes by k-means leaf or hub order (Gorder / RCM, plan #14, Coleman et al.) | identical if ties do not depend on id | speed | B | BFS failed at 157k on the Mac; test 1M on x86 where memory latency dominates; check ties |
| W6 | Adaptive early stop: Elastic 2026 rule, Ada-ef, DARTH (plan #12, O11) | changes | speed | B | calibrate on final MRR on dev, not Hamming recall; also gives low-MRR points for the paper curve |
| W7 | Stored edge length to skip code fetches (CRouting, plan #13; 2 B/edge) | changes | speed vs RAM | B | +~0.25 GB at 1M: falls under the "+<=5% RAM for >= 10% faster" row; likely fails the RAM side unless the edge data replaces something |
| W8 | Forward links at M = 64 and Vamana alpha = 1.2 pruning, or RP-Tuning alpha after build (plan #6 rest, §12) | changes | speed + RAM | C/D | fewer links = smaller CSR and fewer distances; must keep MRR |
| W9 | Compressed links (delta / bit-packed, Qdrant) in RAM, not only on disk | identical | RAM vs speed | C | decode cost on every expansion: the <= 5% slower row; measure CSR saving first |
| W10 | int8 walk arm (USearch playbook idea): walk on int8 instead of sign bits | changes | speed? | E | int8 slab is already in RAM, so no RAM cost; fewer hops may beat costlier distances |
| W11 | Asymmetric 4-bit query against 1-bit codes (plan #11, Qdrant / Weaviate / Knowhere / Elastic BBQ) | changes | accuracy / speed | E | never tested without rotation; may let S1 shrink at equal MRR |
| W12 | Stale-aware walk: stale nodes steer but do not fill results (plan #10, MN-RU, MERIT, IP-DiskANN) | identical on a fresh index | speed with edits | B | removes the 2x ef retry; needs a dev bench with edits (incremental indexing) |
| W13 | Deterministic parallel build in Rust (plan #15, ParlayANN, FAISS main) | new graph | build time | B5 / C1 | same as the native insert of C1; parity = deterministic output, then dev MRR |
| W14 | Bare-metal x86 run (O6, H3) | — | paper | G7 | paid: owner decides |

Read-only checks from wiki §11 still open and still useful for the paper (phase G): share of walk expansions
that are Hamming ties (O10), sign entropy per dimension (partly done 10-14: mean |p - 0.5| = 0.116).


## 6. Phase B — speed (identical output)

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


## 7. Phase C — memory (identical output)

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


## 8. Phase D — storage

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


## 9. Phase E — accuracy and walk-metric ideas (every item gets its test; low expectations)

Untested ideas, each a dev A/B at the knee (plus W10 and W11 from §5):
- Wider full-vector head (k x 8, k x 10): cheap at stage 3, may close part of the .0017 gap at 1M.
- int8 over all 768 dims instead of the first 512 (+256 B/vector RAM; check the cost against D/C gains).
- Binary codes over 768 bits for the scan path only (<= 150k sets), where stage 1 is a scan, not a walk.
Do not retry the rejected list in §1.3.


## 10. Phase F — freeze

Tag the kernel commit (`hnsw-kernel-freeze-YYYYMMDD`). Rebuild the Mac addon locally (gitignored). From here
until phase H ends, no kernel change; if one is unavoidable, restart phase H for every system.


## 11. Phase G — harden the benchmark (before any final run)

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
G10. **Paper items from wiki §14:** tie / duplicate / oversampling analyses (read-only, back contributions 3, 4
    and 6; note the product no longer has a candidate cut, since int8 scores all of stage 1, so the tie finding
    becomes "ties decide the cut; scoring the whole stage-1 list removes it"); Elastic BBQ and Qdrant BQ configs
    if possible (their users then read and cite); licence check of the CodeSearchNet-derived data before
    release; publish vectors / splits / qrels on Hugging Face and propose the suite to ANN-Benchmarks; repeat
    the gap search with a Semantic Scholar API key before submission; cite and set us apart from Iceberg,
    Recall What Matters, Bang for the Buck and Lin early. Venue: PVLDB Experiment, Analysis & Benchmark
    (rolling, 1st of each month), arXiv first; the owner chooses its order against the MSR paper.
G11. **Dry run on dev** of the whole matrix (all models x sets x systems, reduced sweeps) to catch harness
    bugs before held-out.


## 12. Phase H — the held-out run (once)

1. Box: all systems x models x sets, 3 rounds, held-out queries. Then the Mac, same matrix, when quiet.
2. Score aggregates only (`score4.py`, `closest.py`, `front.py`), write the paper tables. No tuning after this.
3. Publish: wiki §09 replaced by the final tables; HANDOFF line; Zenodo upload.
4. Product end-to-end held-out (GCSN full pipeline, BM25 + late interaction, `run_benchmark --profile=full`)
   after the reindex, only when the owner says tuning is done (all product indexes need a full rebuild to get
   the new index file anyway).


## 13. Owner decisions needed (ask when the phase starts, not before)

- Models for G1 and the BEIR sets for G2.
- Bare-metal x86 rental (G7), any API model (G1): paid.
- D5 (drop the SQLite embedding copy): touches the indexer and incremental indexing.
- Phase H step 4 timing (reindex).
- If the deadline gets close: the owner wants every §5 item tested, so any cut needs the owner's OK. Proposed
  cut order then: E, then B5, then D3, then G7. Never cut G1, G3, G4, G6, G8.


## 14. Tools and places

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


## 15. Log

- 2026-10-15: plan written (main 39a4c4aa). Nothing from phases A–H started.
- 2026-10-15 phase A done (box): §1.2 holds the measured memory, disk, load and per-stage time. Tools:
  `oursmem.mjs` (rewritten), `split.mjs`, `buildtime.mjs`; `ROOT=` lets an arm use another copy of an index.
  A4 build (one JS thread): 140k 266 s / peak 1,653 MB; **1M 7,245 s (2 h) / peak 9,794 MB** (input embeddings
  3,617 MB of it; save 56 s). Rivals build 1M in minutes on 12 threads: B5 (native parallel build) is a reviewer
  item, not optional. A6 (shared-index throughput) needs a native multi-query entry point: after B1.
  AdvTest has no dev/held-out split (the same 3,000 queries served both): fine for identical-output timing,
  not for MRR choices; split it 60/40 seed 42 in phase G and disclose (G8).
- 2026-10-15 round S1 (storage, C1-C3 + D1, identical output): one binary index file (format 3, magic
  `SSHNSW3`, one atomic rename) replaces `.meta/.vectors/.graph/.int8/.calibration.json` and the packed mmap
  format (deleted, no back-compat); ids + metadata in two arrays instead of per-node objects; int8 rows in one
  node-ordered Int8Array (no per-row views, no id map); the JS code slab and, for indexes the exact scan answers
  (<= 150k), the graph are left in the open file until a write needs them. Bench indexes converted with
  `convert-v3.mjs` (same graph). Box, 3 interleaved runs x 3,600 dev queries: same = 1.0000 on all 5 sets,
  p50 equal (6.9k 53/52, 20k 78/80, AdvTest 86/83, 140k 304/301, 1M 216/213 us). Memory/load (before -> after):
  1M load 35.4 -> 2.4 s, load peak 4,270 -> 3,098 MB, anonymous RSS 2,652 -> 1,522 MB (-43%), V8 heap 917 -> 387 MB;
  140k anon 440 -> 175 MB, load 3.0 -> 0.17 s; 6.9k anon 89 -> 27 MB. Index file 1,220 B/vector at 1M (JSON
  sidecars 3,038). Tests: index-file test (new, 10 cases incl. truncation), 13 test files ported, pass on the Mac.
- 2026-10-15 round 2 (B1 part, W3, D4, D2 part), box, 3 interleaved runs, arms base = S1, b, h = b + f16:
  - B1 (part): `cascadeFull` (native) does the final full-vector step on the int8 head: dots from the vector file,
    min-max norm, stable sort, as `applyFullVectorStageRescore`; JS builds result objects only for what the caller
    reads (k, cascadeK, or the whole head when a reranker runs). W3: the greedy descent scores each neighbor list
    with the walk's batch kernels (it used the baseline-x86 software popcount). b vs base: same = 1.0000 on all 5
    sets; p50 6.9k 53 -> 50, 20k 77 -> 74, AdvTest 85 -> 80, 140k 298 -> 297, 1M 215 -> 204 us. Split: head objects
    1.3 -> 0.1 us, 1M stage-1 JS prelude 9.0 -> 6.7 us.
  - int8 kernels: x86 query widened to i16 once: no gain (int8 stage 13 -> 14 us, noise): REMOVED. ARM `sdot`
    (exact, Rust unit test incl. -128/127): kept, Mac timing owed (step 6). The int8 stage is not dot-bound on x86.
  - D4 f16 full vectors (`SSFVEC2`, round to nearest even; JS + Rust converters exact on all 65,536 values, F16C
    and `fcvtl` widen exactly): bench corpora are 99.99-100% f16-exact already (CodeRankEmbed inference output), so
    6.9k / 20k / AdvTest / 140k results are identical; 1M changes 1.2% of queries, MRR@10 .5538 = .5538, R@10
    .9393 = .9393, CI [+0.0000, +0.0000]. Sim (`sim-f16.py`, 6.9k): bf16 (8x coarser) changes 2 / 3,600 queries,
    MRR +-0.00001. Vector file 3,072 -> 1,536 B/vector (1M 2,943 -> 1,472 MB, page cache halves). Cost 2-3 us per
    query (row widening): h vs b p50 +3..+7% on <=140k, vs the phase-A baseline <= +2.6% (20k) -> inside the 5%
    budget with a >= 25% disk saving (vector data 4,296 -> 2,760 B/vector, -36%); closest-rival ratio stays > 1.2
    (smallest x1.62 / 1.026 = x1.58). SHIPPED with b. Budget used: 20k +2.6%, 140k +2.0% (6.9k, AdvTest, 1M none).
  - D2 (part): save() writes level 0 already pruned (the native routine, JS lists untouched) when n > 150k; the
    native re-prune skips the per-node pass when every list is within the cap, and uses POPCNT on x86. Identical
    output; load-time gain not measured yet (round 3).
  - Final code = tested h arm on all 5 sets (same = 1.0000). Box vitest (vector-store, search, indexing,
    infrastructure, embedding): 4,594 pass; the 16 other failing files fail the same way on the unchanged base copy
    (the box repo lacks `eval/agent-read-workflows` etc.). Linux Rust test binaries cannot load (napi symbols):
    F16C exactness checked with a standalone program (0 / 65,536 mismatches).
  - Owed: Mac (ARM) parity + `sdot` timing when the Mac is quiet; product indexes need a full rebuild for the new
    file (owner: no reindex until tuning is done).
- 2026-10-15 round 3 (box, csn1m-dev): D2 measured: 1M load 2.37 -> 1.79 s, load peak 3,100 -> 2,077 MB
  (2 loads each; part of de66e593). Phase-A to now at 1M: load 35.4 -> 1.8 s, load peak 4,279 -> 2,077 MB.
  W5 BFS relabel over level 0 from the entry point (`relabel.mjs`, every node reached): same = 1.0000, p50
  204 -> 203 us (runs 204/204/209 vs 205/199/203): noise, REJECTED (as BFS at 157k on the Mac). Locality of the
  node numbering is not what bounds the x86 walk now that the buffers sit in huge pages.
- 2026-10-15 round 4 (box, csn1m-dev, 3 runs; bench-only env knobs, deleted): W8 graph shape, via the load-time
  re-prune (no rebuild): cap 96 -0.0015 [-0.0029, -0.0003] (185 us), cap 64 -0.0034 (161 us), alpha 1.2 on every
  list no fill +0.0000 but 209 us, alpha 1.2 + fill +0.0000 / 204 us (no gain), alpha 1.2 + cap 96 -0.0011
  [-0.0024, -0.0001]: ALL REJECTED (fewer links lose MRR at equal S1; alpha alone buys nothing). W6 discovery-rate
  stop, thresholds only (`ET=` knob in ours.mjs): knee sweep on csn1m-dev (+ the 140k set forced to walk as a
  second walk set, not a product path):
    base [[.3,.05],[.6,.10]] 201 us | e2 [[.3,.10],[.6,.15]] -0.0001 [-0.0003,+0.0000] 185 | e4 same results 183 |
    e5 [[.2,.10],[.5,.15]] -0.0001 [-0.0003,+0.0000] R@10 .9393 = .9393 181 | e6 [[.3,.15],[.6,.20]] -0.0005
    [-0.0012,-0.0000] 172 | e7 [[.3,.08],[.6,.12]] +0.0000 201. 140k-walk: e2 -0.0004, e5 -0.0003, e6 -0.0007
    (all CIs cross 0).
  SHIPPED e5 (knee: fastest arm inside the equal band at 1M; only > 150k indexes walk, the 4 smaller sets are
  unchanged). 1M x86 p50 201 -> 181 us (-10%). Final code = tested arm (0 diffs, 1M and 6.9k). Caution for the
  held-out read: the 140k-walk point estimates are negative (ns). The rule scales with ef: at ef 50 a clustered
  synthetic walk now stops before an exact self-match (test changed to check the update at ef 400; production
  ef >= 400). The B4 low-S1 sweep points get faster and lower; that is the curve, not a bug.

