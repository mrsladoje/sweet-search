# Related-work notes for the CPU int4 MaxSim rerank kernel benchmark

Date of search: 2026-10-17. Every entry in `../refs.bib` was checked against a primary source.
Primary sources: arXiv API or abs page, Crossref, publisher or proceedings page, GitHub API.

Our setting in one line: exhaustive (not approximate) MaxSim reranking, on CPU, with an int4 SIMD kernel, checked by a contract.

## Summary for the novelty claim

- No paper found benchmarks a set of CPU MaxSim kernels the way this paper does. Two items come close.
- **Col-Bandit** (`pony2026colbandit`) measures CPU MaxSim on an AMD EPYC 7763 (AVX2) and an Apple M1 Max (NEON). It uses NumKong and compares with maxsim-cpu. It is an approximate method (int8 elimination pass, then exact fp32 rescore). Our paper is exhaustive int4 and covers five CPUs.
- **maxsim-lut** (`joe32140maxsimlut`) is a CPU kernel for compressed residual codes (1, 2, 4 bits) with an int8 query. It is a GitHub repository with no paper. It is the closest kernel to our int4 kernel. The next-plaid 1.7.0 release (August 2026) added a similar LUT scoring kernel.
- Flash-MaxSim, TileMaxSim and ErikKaum/maxsim are GPU only. They are the GPU side of the same topic.
- Do not claim "first CPU MaxSim kernel". The safe claim is a contract-checked comparison of CPU kernels on several CPUs, with captured agent rerank calls.

## A. Late-interaction systems (papers)

**khattab2020colbert** — ColBERT, SIGIR 2020, DOI 10.1145/3397271.3401075, arXiv 2004.12832.
Defines late interaction and the MaxSim operator. Exhaustive MaxSim over stored token vectors is the reranking step it describes. Our kernel computes this same operator.

**santhanam2022colbertv2** — ColBERTv2, NAACL 2022, DOI 10.18653/v1/2022.naacl-main.272, arXiv 2112.01488.
Adds residual compression of token vectors (1 or 2 bits per dimension) and distillation. It also defines the `colbert-ir/colbertv2.0` model that we use on SciFact and NFCorpus. Its compression is a storage format. Our int4 format is a scoring format.

**santhanam2022plaid** — PLAID, CIKM 2022, DOI 10.1145/3511808.3557325, arXiv 2205.09707.
A retrieval engine that prunes candidates with centroid interaction before full scoring. It is approximate in candidate generation. Its final stage is MaxSim reranking over decompressed vectors, so a faster MaxSim kernel helps this stage.

**scheerer2025warp** — WARP, SIGIR 2025, DOI 10.1145/3726302.3729904, arXiv 2501.17788. Authors: Scheerer, Zaharia, Potts, Alonso, Khattab.
A CPU-oriented engine for multi-vector retrieval. It builds on XTR and reports lower latency than PLAID. It is an end-to-end retrieval engine, approximate. We benchmark only the rerank kernel.

**nardini2024emvb** — EMVB, ECIR 2024, DOI 10.1007/978-3-031-56060-6_1, arXiv 2404.02805.
Uses bit vectors for candidate filtering and product quantization for the final scoring. It runs on CPU. It is approximate and targets first-stage plus rerank together. The arXiv title says "Using", the Springer title says "with".

**engels2023dessert** — DESSERT, NeurIPS 2023, arXiv 2210.15748.
Approximate set-to-set search with hash tables. It reports a 2 to 5 times speedup when plugged into ColBERT. It trades recall for speed. Our work keeps the exhaustive result.

**dhulipala2024muvera** — MUVERA, NeurIPS 2024, DOI 10.52202/079017-3204, arXiv 2405.19504.
Turns multi-vector similarity into one fixed-size vector, so a normal ANN index can do first-stage retrieval. Approximate. It still needs an exact MaxSim rerank on the candidates. That rerank is our kernel's job.

**lee2023xtr** — XTR, NeurIPS 2023, DOI 10.52202/075280-0677, arXiv 2304.01982.
Trains the model so that token retrieval alone picks good candidates. It cuts the gather and scoring stage. It changes the model, not the kernel.

**formal2024splate** — SPLATE, arXiv 2404.13950.
Maps ColBERT token vectors to a sparse space so a CPU inverted index can pick candidates. Approximate candidate generation, with ColBERT MaxSim for reranking. It reports CPU-only reranking pipelines. Relevant as a CPU use case for our kernel.

**hofstatter2022colberter** — ColBERTer, arXiv 2203.13088 (CIKM 2022).
Reduces the vector count and size through whole-word pooling and dimension reduction. A storage and model change.

**lassance2022learnedpruning** — Learned token pruning for ColBERT, SIGIR 2022, DOI 10.1145/3477495.3531835.
Drops document tokens to shrink the index and speed up scoring. Token pruning reduces the work per document. Our kernel makes each remaining token cheaper. The two ideas add up.

**schlatt2026tokenpruning** — Comparing token pruning approaches, SIGIR 2026, DOI 10.1145/3805712.3808564.
A 2026 comparison of token pruning methods for multi-vector retrieval. I read only the Crossref record. It is a recent baseline for the pruning family.

**clavie2026tokenpooling** — Token pooling, Journal of Natural Language Processing 33(3), 2026, DOI 10.5715/jnlp.33.1484. Earlier arXiv 2409.14683 (Clavié, Chaffin, Adams).
Clusters and averages similar token vectors. It cuts index size by 50 to 66 percent in the arXiv abstract's claim, with small quality loss. I did not re-check these numbers. The journal version has a fourth author (Kato).

**salla2026crossq** — CrossQ, arXiv 2608.19204, ICML 2026 poster.
CrossQ is a quantization method. Full title: "Task-Aligned Cross-Token Conditional Quantization for Late Interaction Retrieval". It conditions token codes on document context and stores 2 to 8 bytes per token. It reports quality and storage. It is not a CPU kernel paper. It reports one latency table in an appendix, which I did not verify. Relevant as a competing compression format. Our int4 format uses 4 bits per dimension, which is much larger.

**jaasaari2026lemur** — LEMUR, arXiv 2601.21853, ICML 2026 (per arXiv comment).
Learns a small network that maps multi-vector similarity to single-vector search. Approximate. I did not check which hardware it used.

## B. MaxSim kernels (the closest work)

**pony2026flashmaxsim** — Flash-MaxSim, arXiv 2605.29517 (v1 2026-05-28, v3 2026-09-27).
A fused GPU kernel (A100) that does not build the full query-by-document similarity tensor. It is exact in fp16 and fp32, within 5e-4 nDCG@10 of the reference. It has a separate int8 path that is approximate. GPU only. It shows the "fused, no similarity matrix" idea that our CPU kernel also uses.

**sharma2026tilemaxsim** — TileMaxSim, arXiv 2606.26439 (single author, 2026-06-24).
Triton GPU kernels (H100) with dimension tiling and fused product quantization. It states exact quality for the non-PQ path. It compares against the WARP CPU engine. GPU only. It is the GPU counterpart of a quantized MaxSim kernel.

**kaum2026maxsim** — ErikKaum/maxsim (GitHub).
An exact MaxSim kernel for CUDA (sm_80 to sm_90) and Apple Metal. fp32, fp16 and bf16 inputs. No CPU backend. Created 2026-05-17, last commit 2026-05-27. No paper. It names Flash-MaxSim as related work. The README reports 1.2 to 4.2 times speedup over PyTorch for padded rerank on A100 and H200.

**pony2026colbandit** — Col-Bandit, arXiv 2602.02827 (IBM Research). Authors: Pony, Goldfarb, Naparstek, Friedman, Barzelay, Schwartz.
A query-time method that skips most document-token comparisons. It uses an int8 elimination pass and an exact fp32 rescore. CPU runs use the NumKong C extension. Reported hardware: AMD EPYC 7763 (AVX2) and Apple M1 Max (NEON). It reports single-thread speedups up to about 13 times over exhaustive MaxSim, and 3 to 6 times over maxsim-cpu on M1 Max. The paper says its Overlap@K is at least 0.90, so it is approximate. **This is the paper that matters most for novelty.** It also shows that exhaustive CPU MaxSim at 2.68M documents takes 37 seconds single-thread on EPYC.
Note: the HTML version I read has duplicated digits in a few places. Check numbers against the PDF before quoting them.

**joe32140maxsimlut** — maxsim-lut (GitHub, owner joe32140).
A CPU-only Rust crate. It scores residual-coded document tokens (1, 2, 4 bits per dimension) with an int8 query and an in-register lookup table. It uses NEON sdot and smmla, x86 maddubs and vpdpbusd. SIMD paths return the same bits as the scalar reference. The README reports end-to-end time on SciFact on an Apple M4 (3.87 ms with this crate against 19.26 ms for next-plaid 1.6.5). Kernels were extracted from next-plaid. No paper, no release, 0 stars at the time of reading. It compares with no other kernel. This is the closest public kernel to our int4 kernel. It scores the ColBERTv2/PLAID residual format. Our kernel scores a plain int4 vector format.

**clavie2025maxsimcpu** — maxsim-cpu (Mixedbread; blog by Clavié and Lee, 2025; repo release 0.1.0 on 2025-07-10).
A Rust Python package. fp32 only in the README examples. Uses libxsmm on x86 (AVX2 needed, no AVX-512) and Apple Accelerate on ARM. The blog reports about 10 times speedup over a PyTorch baseline on an AMD EPYC 9354 and 2 to 5 times on an Apple M4 Max, for 1000 documents. It is an exhaustive fp32 baseline. It is one of the baselines in our paper.

**lightonai2026nextplaid** — NextPlaid / next-plaid (lightonai, Apache-2.0). Release v1.8.5 on 2026-10-10, commit c6c091d7ee.
A local multi-vector search engine, with a REST API and the ColGREP code-search tool on top. "Designed to run fast on CPU", with CUDA optional. It uses 2-bit or 4-bit compression. It wraps the FastPlaid algorithm. A LUT scoring kernel arrived in v1.7.0 (2026-08-18). It is a baseline in our paper. ColGREP is a coding-agent use case close to ours.

**vardanian2026numkong** — NumKong (Ash Vardanian). Release v7.8.5, 2026-10-05.
NumKong is the renamed SimSIMD. Check: the GitHub API answers a request for `ashvardanian/SimSIMD` with "301 Moved Permanently" to repository id 613772664. That is the same repository as NumKong, created 2023-03-14. The README does not state the rename in words. It provides typed `nk_maxsim_packed_*` MaxSim kernels and signed and unsigned int4 and int8 dot products with int32 accumulation. The README tables show only i8 timings and no i4 timings. The README asks users to cite it as "NumKong: 2000 Mixed Precision Kernels For All" with a Zenodo DOI. I could not check that DOI.

**chaffin2025pylate** and **chaffin2025pylatecikm** — PyLate, arXiv 2508.03555, CIKM 2025, DOI 10.1145/3746252.3761608, pages 6334 to 6339.
A training and retrieval library on top of Sentence Transformers. It includes PLAID-style and simple indexes. Used as a baseline. Use the CIKM entry for citation. The arXiv entry is there for the preprint.

## C. Vector databases with multi-vector support

**bergum2024vespacolbert** and **vespa2026embedding** — Vespa.
Vespa has a native ColBERT embedder (blog dated 2024-02-14). Document token vectors can be binarized into int8 (dim/8 bytes, 32 times smaller). The query vector stays full precision. Ranking uses a `max_sim` tensor expression. I read the blog in full. The docs URL `docs.vespa.ai/en/embedding.html` was seen only in a search result, not opened. The page `docs.vespa.ai/en/rag/colbert-embedder.html` returned 404.

**qdrant2026multivector** — Qdrant.
Native multivector fields with a `MAX_SIM` comparator. Tutorials set HNSW `m=0` on the multivector field, so queries run exhaustive MaxSim over the candidates, as a rerank. Read through a search-result summary only.

**lancedb2026multivector** — LanceDB.
Multivector search with cosine only. Vector types float16, float32, float64. Read through a search-result summary only. Not opened. The docs mention integration with XTR.

**weaviate2026multivector** and **weaviate2025muvera** — Weaviate.
Multi-vector (ColBERT, ColPali) support is generally available from v1.30. MUVERA encoding came with v1.31. Read through search-result summaries only.

Relevance of section C: all four systems run MaxSim, usually as a rerank on a candidate set, in float formats (LanceDB) or binary (Vespa). None of the pages I saw describes an int4 kernel. This supports the claim that production systems need a fast exact CPU rerank step.

## D. Datasets, models, baselines

**thakur2021beir** — BEIR, NeurIPS 2021 Datasets and Benchmarks Track (Round 2), arXiv 2104.08663, OpenReview wCu6T5xFjeJ.
Source of the SciFact and NFCorpus evaluation sets.

**wadden2020scifact** — SciFact, EMNLP 2020, DOI 10.18653/v1/2020.emnlp-main.609. Seven authors.

**boteva2016nfcorpus** — NFCorpus, ECIR 2016, DOI 10.1007/978-3-319-30671-1_58. Authors: Boteva, Gholipour, Sokolov, Riezler.
Note: my first DOI guess (`_30`) was a different paper. The `_58` DOI was checked in Crossref.

**husain2019codesearchnet** — CodeSearchNet, arXiv 1909.09436 (preprint, no venue).

**diera2023gencodesearchnet** — GenCodeSearchNet, arXiv 2311.09707. Six authors. Preprint, no venue found.

**clavie2024answerai** — answerai-colbert-small-v1, Answer.AI blog "Small but Mighty", 2024-08-13, by Benjamin Clavié.
There is no arXiv paper for this model. The blog says it is a 33M-parameter model built on the JaColBERTv2.5 recipe. Cite the blog and the Hugging Face model card.

**clavie2025jacolbertv25** — JaColBERTv2.5, JNLP 32(1), 2025, DOI 10.5715/jnlp.32.176, arXiv 2407.20750.
The training recipe behind the answerai model. Cite it as the recipe source if needed.

**lu2024bm25s** — BM25S, arXiv 2407.03618 (Xing Han Lù, 2024-07-04). Preprint, no venue found.

## E. Statistics and measurement method

**holm1979simple** — Holm 1979, Scandinavian Journal of Statistics 6(2), pages 65 to 70. JSTOR stable 4615733.
Crossref has no record for the DOI 10.2307/4615733 (HTTP 404), so the bib entry uses the JSTOR URL. Details come from a search result that quotes the JSTOR record.

**sakai2006bootstrap** — Sakai, SIGIR 2006, DOI 10.1145/1148170.1148261. Bootstrap tests for IR metrics.

**efron1993bootstrap** — Efron and Tibshirani, Chapman & Hall, 1993, ISBN 0-412-04231-2. ISBN checked in library catalogue records returned by web search, not in a publisher page.

**schuirmann1987tost** — Schuirmann 1987, J. Pharmacokinetics and Biopharmaceutics 15(6), 657 to 680, DOI 10.1007/BF01068419.
Added by me. It is the standard two one-sided tests (TOST) reference for equivalence and non-inferiority. Use it if the paper has a non-inferiority claim on nDCG. See UNVERIFIED for the IR-specific gap.

**leitner2016patterns** — Leitner and Cito, ACM TOIT 16(3), 2016, DOI 10.1145/2885497. Cloud performance variation.

**uta2020bigdata** — Uta, Custura, Duplyakin, Jimenez, Rellermeyer, Maltzahn, Ricci, Iosup. NSDI 2020, pages 513 to 527, arXiv 1912.09256.
Cloud network variability and repeatability of experiments. Supports a cloud-variability caveat for the AWS machines.

**hoefler2015scientific** — Hoefler and Belli, SC '15, DOI 10.1145/2807591.2807644.
Rules for reporting parallel performance. The subtitle in the bib ("Twelve Ways to Tell the Masses...") is from the known ACM title. Crossref returns only the short title.

**mytkowicz2009wrongdata** — Mytkowicz, Diwan, Hauswirth, Sweeney. ASPLOS XIV, 2009, DOI 10.1145/1508244.1508275.
Measurement bias from environment size and link order. Supports pinning the environment and using the contract check. A SIGPLAN Notices version has DOI 10.1145/1508284.1508275.

## UNVERIFIED

1. **"The slow half of PLAID" blog post.** The maxsim-lut README cites it. I could not find a URL. I did not add it to the bib.
2. **NumKong Zenodo DOI 10.5281/zenodo.21480519.** It comes from the NumKong README citation block. The Zenodo API did not answer. The bib entry does not use it. The rename from SimSIMD is confirmed by the GitHub redirect only. The README does not say it in words.
3. **Mixedbread maxsim-cpu blog publication date.** The page shows no date. The citation block says 2025. The first public commit and release are from July 2025. "Sean Lee" is the co-author name in the citation block. I did not find a fuller name.
4. **CrossQ arXiv date.** RESOLVED 2026-10-17: the arXiv API returns 2608.19204v1 with this exact title (published field 2026-06-10); the ID in the bib is correct. Original note: The arXiv ID 2608.19204 would mean August 2026. The abs page I read showed a submission date of 10 June 2026. The ICML 2026 poster page agrees on the title and authors. I could not reach the arXiv API again (HTTP 429 rate limit). Please recheck the ID before submission. The PMLR proceedings entry was not checked.
5. **LEMUR hardware.** The abs page does not state CPU or GPU. I did not read the full paper.
6. **Qdrant, LanceDB and Weaviate documentation.** I read only search-result summaries of these pages. I did not open the pages. The URLs are from search results. Open them once before citing a specific claim (for example "cosine only" for LanceDB).
7. **Vespa docs page.** `docs.vespa.ai/en/embedding.html` was seen only in a search result. The blog post is the verified source.
8. **Non-inferiority testing in IR.** I found no IR-specific paper. I only found clinical and pharmacology sources. The two-one-sided-tests entry (Schuirmann 1987) is the general method. Do not claim an IR precedent without more searching. An IR source I know from memory (Sakai's work on statistical reform) was not looked up, so it is not included.
9. **Numeric claims in summaries above** (speedups, bytes per token, millisecond figures) come from abstracts, READMEs and HTML pages read through a summarizing fetch tool. Re-read the original paper before quoting any number in the manuscript. This is most important for Col-Bandit (duplicated digits in the HTML) and for Token Pooling (50 to 66 percent claim, not re-checked).
9b. **Method descriptions from background knowledge.** Bibliographic data is verified for every entry. Some one-line method descriptions are not re-read from the paper in this session: ColBERTv2 residual bits, WARP "builds on XTR", SPLATE "CPU-only", EMVB "bit vectors plus product quantization", DESSERT "hash tables". Check them against the abstracts before the related-work text is final.
10. **DBLP.** DBLP queries were rate limited. Venue data for the NeurIPS and ECIR papers comes from Crossref and proceedings pages instead. Volume numbers for the ECIR 2024 LNCS book were not checked.
11. **ColBERTer CIKM 2022 DOI.** Not checked. The bib entry cites arXiv only.
12. **Weaviate GA version.** The v1.30 general-availability statement comes from the Weaviate 1.31 release blog snippet in a search result. I did not open it.

## Other candidates seen but not included

- arXiv 2609.29652, SmallReason-ColBERT (a small late-interaction model). Seen only as a title.
- arXiv 2607.05803, a theory paper on MaxSim capacity. Seen only through a Hugging Face summary. Not about kernels.
- arXiv 2510.12327, "Simple Projection Variants Improve ColBERT Performance". Not about kernels.
- arXiv 2603.26259, "Working Notes on Late Interaction Dynamics" (ECIR 2026 LIR workshop). About length bias, not efficiency.
