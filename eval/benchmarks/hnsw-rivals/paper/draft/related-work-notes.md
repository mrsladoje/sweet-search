# Related-work notes for the ANN candidate-generator paper

Status: all 44 entries in `refs.bib` were checked on 2026-10-18 against a primary source.
Sources: arXiv API, Crossref, PMLR and NeurIPS proceedings pages, ACL Anthology, OpenReview, GitHub API.

Main finding: no cited work does what our paper does. No work puts every generator behind one
rescoring procedure, reports task quality as a fraction of exact search with cluster-bootstrap
bounds, and measures single-thread latency on five CPUs.

Reading depth: I read the abstracts of Iceberg, Operational Advice, Recall What Matters,
CRouting, Ada-ef and Big-ANN 2023 in this session. Other notes come from the paper titles and
general knowledge. They are marked "(not re-read)". Check these claims before you print them.

## A. Benchmarks and evaluation studies

**aumuller2020annbenchmarks** (ANN-Benchmarks, Information Systems 87, 2020).
It is the standard recall-versus-QPS benchmark for ANN libraries. It scores a method by overlap with
exact neighbours, not by task quality. We use the same libraries (hnswlib, FAISS, ScaNN) but score the
final ranking on the task. (not re-read)

**simhadri2022bigann21** (NeurIPS 2021 Big-ANN challenge report, PMLR 176).
It compares billion-scale methods on fixed hardware, with recall and throughput as the metrics.
Its scale (1B vectors) is far above ours (7k to 1M). It does not use task labels. (not re-read)

**simhadri2024bigann23** (Big-ANN NeurIPS 2023 report, arXiv 2409.17424).
It covers filtered, out-of-distribution, sparse and streaming search. It is not a dense-retrieval
quality study. Unsure about the venue: see UNVERIFIED.

**wang2021graphsurvey** (VLDB 2021 survey and experiments, graph ANN).
It compares many graph indexes and builds a taxonomy. Its metric is recall on vector benchmarks.
It has no quantised cascade and no task-quality metric. (not re-read)

**azizi2025graphvector** (SIGMOD 2025, "Graph-Based Vector Search: An Experimental Evaluation of the
State-of-the-Art", PACMMOD 3(1)).
It is the newest large evaluation of graph methods. The exact title is verified through Crossref.
It measures recall and cost on vector datasets. We add rescoring, binary and int8 screens, and task labels. (not re-read)

**chen2026iceberg** (Iceberg, SIGMOD 2026, arXiv 2512.12980).
The paper title is "Reveal Hidden Pitfalls and Navigate Next Generation of Vector Similarity Search
from Task-Centric Views". Iceberg is the name of its benchmark suite. It argues that
recall against exact neighbours can mislead, and it names an "Information Loss Funnel" with three
sources of end-to-end loss (the abstract lists embedding loss first). This is our closest
motivation. It does not set one common rescoring step for all generators. Read the full paper
before we claim a difference in method.

**lin2025operational** (ACL 2025 industry track, arXiv 2409.06464).
It compares HNSW and flat indexes in Lucene on BEIR, including quantised variants. It reports
indexing time, query speed and retrieval quality. It covers one engine only. We compare many
libraries and a binary cascade. Note: the "HNSW or flat?" paper you asked for is this same paper.
I found no second Lin paper with that title.

**kuffo2025bang** (Bang for the Buck, DaMoN 2025, arXiv 2505.07621).
It compares vector search on cloud CPUs for cost and speed. It is the closest hardware-focused work.
It measures recall, not task quality. Our five-CPU single-thread latency is a smaller, controlled
version of the same question. (not re-read)

**dimitropoulos2026recall** (Recall What Matters, arXiv 2606.04522, preprint).
It argues that Recall@k forces extra compute. It proposes 1/Ratio@k, based on distances. It is judge-free
and uses no task labels. We differ: we use real task labels (MRR@10, nDCG@10). The two papers
support the same point from different sides. Preprint only, no venue found.

**xian2024lucene** (WSDM 2024, "Lucene Is All You Need").
It shows that Lucene HNSW is enough for dense retrieval with OpenAI embeddings. It is a practical
argument for one general engine. The published author order is Xian, Teofili, Pradeep, Lin. The arXiv
version puts Lin first. We keep the published order.

## B. Indexes and methods we test or discuss

**malkov2020hnsw** (HNSW, TPAMI 2020). The base graph index. Our cascade, FAISS HNSW, hnswlib and
USearch all build on it.

**johnson2021faissgpu** and **douze2024faiss** (FAISS). The first paper covers GPU search and
k-selection, plus product-quantised indexes. The second describes the whole library, including binary
HNSW, flat, SQ8 and IVF-PQ fast-scan. Cite the second for the CPU indexes we run.

**jegou2011pq** (product quantization, TPAMI 2011). The base of IVF-PQ. (not re-read)

**gao2024rabitq** and **gao2025extrabitq** (RaBitQ, SIGMOD 2024; Extended RaBitQ, SIGMOD 2025).
RaBitQ gives 1-bit codes with an error bound. The extension gives multi-bit codes. The extended
paper's text uses the name "Extended RaBitQ" (checked). Both report recall and speed, not task quality.

**guo2020scann** and **sun2023soar** (ScaNN, ICML 2020; SOAR, NeurIPS 2023). ScaNN uses anisotropic
quantisation, which targets inner-product ranking. SOAR adds spilled assignment for IVF-style
indexes. SOAR is not a separate library in our list, so cite it as method background. (not re-read)

**subramanya2019diskann** (DiskANN/Vamana, NeurIPS 2019). A graph index built for SSD. At 7k to 1M
vectors in RAM we use it as an in-memory graph. The NeurIPS page gives no page numbers, so none are in the entry.

**aguerrebere2023lvq** and **tepper2024leanvec** (Intel SVS: LVQ, VLDB 2023; LeanVec, TMLR 2024).
LVQ is a locally-adaptive scalar quantisation. LeanVec adds dimension reduction for
high-dimensional embeddings. Our 768-d vectors fit the LeanVec target well. (not re-read)

**li2025crouting**, **zhang2026adaef**, **chatzakis2025darth**, **zhong2025vsag**.
These are search-time improvements for graph indexes. CRouting skips distance calls (abstract:
up to 1.48x QPS on HNSW and NSG). Ada-ef sets the HNSW ef value per query. DARTH stops search early to meet a
recall target. VSAG is a tuned framework (VLDB 2025). All four tune the recall-speed curve.
None sets a task-quality target. CRouting has no venue that I could find.

**vardanian2023usearch** and **nmslib2017hnswlib** (software). They have no paper. Cite the version
we run. Replace the "latest release seen" note in the entries with the real tested version.

**yamada2021bpr** (BPR, ACL 2021). It learns binary codes for passage retrieval and then reranks with
full vectors. This is the closest published pattern to our binary-screen then full-rescore cascade. The
difference is that BPR trains the hash; we quantise an existing embedding.

## C. Models and datasets

**suresh2025cornstack** (CoRNStack, ICLR 2025): source of CodeRankEmbed. **gunther2023jina2**
(Jina Embeddings 2): source of jina-embeddings-v2-base-code; arXiv only. **xiao2024cpack**
(C-Pack, SIGIR 2024): source of the BGE family, including bge-base-en-v1.5. The C-Pack title says
"Chinese" but the English v1.5 models are in this release line; confirm the model card before you print this.

**husain2019codesearchnet**, **diera2023gencodesearchnet**, **lu2021codexglue** (code search data).
CodeXGLUE holds CoSQA and AdvTest. The original CoSQA paper (Huang et al., ACL 2021) is not in the bib.
**thakur2021beir** is the source for Quora and FiQA as used in BEIR. **maia2018fiqa** is the FiQA-2018
challenge paper. There is no separate Quora citation in BEIR; cite BEIR.

**Stats and methods** (copied, keys unchanged): holm1979simple, sakai2006bootstrap,
efron1993bootstrap, schuirmann1987tost, hoefler2015scientific, mytkowicz2009wrongdata,
leitner2016patterns, uta2020bigdata.

## D. Gap statement for the introduction (draft)

Existing studies score ANN methods by overlap with exact neighbours. Iceberg and Recall What Matters
say this is not enough. Lin tests HNSW against flat on BEIR in one engine. Nobody compares a binary
cascade, FAISS, USearch, hnswlib, RaBitQ, ScaNN, DiskANN and SVS under one rescoring step, with the
task metric reported as a fraction of exact search and cluster-bootstrap bounds. Hedge this with
"to our knowledge". I searched arXiv, Crossref and OpenReview, not every venue.

## UNVERIFIED and caveats

Nothing was dropped from the .bib for lack of a source. These items need your decision:

1. "HNSW or flat" (Lin): no separate paper found. It is the same paper as "Operational Advice" (arXiv 2409.06464).
2. Big-ANN 2023 report: arXiv 2409.17424 (23 authors, 2024) is verified. Crossref also lists it in NeurIPS 2025
   proceedings (vol. 38, pp. 76394-76408, doi 10.52202/085713-2303) with 21 authors. I did not open that page. I kept the arXiv entry.
3. CRouting: arXiv 2509.00365 only. No venue found.
4. Recall What Matters (2606.04522), Faiss library (2401.08281), Jina Embeddings 2 (2310.19923), CodeXGLUE
   (2102.04664): arXiv only in the bib. CodeXGLUE may also have a NeurIPS 2021 Datasets and Benchmarks
   record. I did not confirm it.
5. DiskANN: page numbers not verified, so none are listed. NeurIPS metadata lists authors in a
   different order than the PDF first page. I used the PDF order.
6. DBLP was unreachable (blocked), so I used Crossref instead of DBLP for venue checks.
7. USearch and hnswlib: versions and the hnswlib author field are placeholders. "nmslib contributors" is a group name I chose.
8. Lucene paper: the user brief said "Lin et al." The published WSDM author order starts with Xian.
9. Reading depth: see the top of this file.
