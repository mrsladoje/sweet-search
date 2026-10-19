# Literature review B: classical and systems foundations for ss-grep (2026-10-19)

Status tags: VERIFIED = I opened the page or got the metadata from a search result that matched across sources. UNVERIFIED = recalled or not confirmed here.

## 1. Code search engines and indexed grep (prior art for the trigram/sparse index and the speed claim)

1. Russ Cox, "Regular Expression Matching with a Trigram Index (or How Google Code Search Worked)", Jan 2012 (web article, not peer reviewed).
   URL: https://swtch.com/~rsc/regexp/regexp4.html . VERIFIED (date from page body: January 2012).
   Does: converts a regex to a trigram query, intersects posting lists, runs the real regex only on candidate files. Open-source Go `codesearch`.
   Prior art for: the trigram index prefilter. NOT novel. Must cite.

2. Zoekt (Sourcegraph fork of Han-Wen Nienhuys's Google/Gerrit project). Design doc: https://github.com/sourcegraph/zoekt/blob/main/doc/design.md . VERIFIED.
   Does: positional trigram index (about 3x corpus size), regex reduced to literal substrings, candidates verified with the full regex. Design doc lists ranking signals: atoms matched, word boundaries, filename length, comment/string, "is a symbol definition" (needs ctags at index time).
   Prior art for: index prefilter AND definition-first ranking idea. NOT novel as a signal.

3. GitHub Blackbird. Timothy Clem, "The technology behind GitHub's new code search", GitHub Blog, 2023-02-06.
   URL: https://github.blog/engineering/the-technology-behind-githubs-new-code-search/ . VERIFIED.
   Does: ngram index, sparse grams (weights on character pairs, choose substrings whose inner weights are below border weights), lazy index reads, posting lists compacted by score so high-score docs get low ids, top 100 re-sorted across shards. Symbols are extracted and indexed in a separate ngram index. The post does NOT describe a symbol ranking boost.
   Prior art for: sparse-gram index. NOT novel. If ss-grep "sparse-gram" follows this scheme, must cite and say how it differs.

4. Cursor, Vicent Marti, "Fast regex search", Cursor research blog, 2026-03-23. https://cursor.com/blog/fast-regex-search . VERIFIED (page fetched).
   Does: local trigram and sparse n-gram regex index for AI agents, tied to a git commit with edit layers; weights pairs by rarity in open-source code; claims ripgrep needs over 15 s per search on big monorepos. Own claims, no independent benchmark.
   Prior art for: "indexed grep for LLM agents" framing and fresh-on-write index. Closest competitor to the speed contribution. Must cite and compare. Highest novelty threat for the speed claim.

5. livegrep. Nelson Elhage, "Regular expression search with suffix arrays", 2015-02. https://blog.nelhage.com/2015/02/regular-expression-search-with-suffix-arrays/ . VERIFIED (exists, opening summarised; I did not read full text).
   Does: suffix-array index over the corpus plus RE2 to confirm. Prior art for index-then-verify. Alternative index family.

6. Cho and Rajagopalan, "A fast regular expression indexing engine" (FREE), ICDE 2002. https://ieeexplore.ieee.org/document/994755 . VERIFIED (venue, authors per Crossref).
   Does: prebuilt multigram index, selects useful grams, returns candidate units that are then checked. Earliest index-then-verify regex work found. Must cite as origin of useful-gram selection (parent idea of sparse grams).

7. Zhang, Deep, Patel, Sankaralingam, "An Evaluation of N-Gram Selection Strategies for Regular Expression Indexing in Contemporary Text Analysis Tasks", PVLDB 18 (2025) (arXiv 2504.12251). https://arxiv.org/abs/2504.12251 . VERIFIED (arXiv and VLDB 2025 vol 18 per search).
   Does: compares FREE, BEST and a third strategy on five modern workloads; releases code. Best recent academic baseline for index design. Cite as the empirical reference for n-gram selection.

8. Wang et al., "Hyperscan: A Fast Multi-pattern Regex Matcher for Modern CPUs", NSDI 2019. https://www.usenix.org/conference/nsdi19/presentation/wang-xiang . VERIFIED.
   Does: graph decomposition into literal and automata parts, SIMD. Prior art for literal-extraction prefilter. Background only; ripgrep's Teddy matcher descends from it.

9. Andrew Gallant (BurntSushi), "ripgrep is faster than {grep, ag, git grep, ucg, pt, sift}", 2016-09-23. https://burntsushi.net/ripgrep/ . VERIFIED.
   Does: Rust regex automata, literal extraction (memchr, Teddy SIMD), parallel directory walk, gitignore respect, mmap only for few large files. This is the exact-semantics baseline. Must cite and use as the baseline.

10. ugrep and ugrep-indexer (Genivia). https://github.com/Genivia/ugrep-indexer/blob/main/README.md . VERIFIED via search summary (README). Per search, the indexer is part of ugrep 6.0; stores hidden per-directory index, checks mtimes so updated files are still searched, accuracy levels trade index size for false positives.
    Prior art for: index with safe fallback on modified files. Cite as a drop-in grep with index.

11. qgrep (zeux): compressed indexed copy of the source, fast grep. https://github.com/zeux/qgrep . VERIFIED (exists, one-line summary only).

12. git grep, The Silver Searcher (ag), OpenGrok, Hound, Facebook BigGrep. No academic paper found. UNVERIFIED for BigGrep: a `big_grep.ml` module exists in the OCaml `pfff` package (https://ocaml.org/p/pfff/0.39.4/doc/src/pfff-h_program-lang/big_grep.ml.html); the search did not confirm a Facebook link or any publication. Do not cite BigGrep without opening the source. For git grep and ag cite their man pages or the ripgrep blog benchmark.

13. Sadowski, Stolee, Elbaum, "How Developers Search for Code: A Case Study", ESEC/FSE 2015. https://research.google/pubs/pub43835/ . VERIFIED.
    Does: survey (396 responses) plus logs from 27 developers; about 5 sessions and 12 queries per workday; searches usually target specific code location. Follow-up: "10 Years Later: Revisiting How Developers Search for Code", FSE 2025, https://conf.researchr.org/details/fse-2025/fse-2025-research-papers/113/10-years-later-revisiting-how-developers-search-for-code . VERIFIED (page exists; over 1,200 developers).
    Motivation citation for code search, not prior art for a mechanism.

## 2. Ranking lexical code-search hits; file-type priors; definition-first

14. Zoekt scoring code (index/score.go). Source URL: https://github.com/sourcegraph/zoekt/blob/main/index/score.go . VERIFIED (fetched; summary).
    Facts: symbol-span match adds scoreSymbol (exact) or partial; symbol kind adds a per-language, per-kind score via ctags kinds; filename and symbol matches count x5 in BM25 term frequency (importantTermBoost = 5); low-priority files (test or vendor, detected by file category or go-enry fallback) have term frequency divided by 5 (lowPriorityFilePenalty = 5).
    Prior art for: file-type prior (test below source) and definition/symbol boost. Both mechanisms exist in production. ss-grep's weights (test 0.5, generated 0.25) are new numbers, not a new idea. NOT novel as concepts. Caution: Zoekt uses them to rank files/lines when selecting, not to apportion output lines.

15. Julie Tibshirani, "Keeping it boring (and relevant) with BM25F", Sourcegraph blog, 2025-04-04. https://sourcegraph.com/blog/keeping-it-boring-and-relevant-with-bm25f . VERIFIED.
    Does: BM25F with 5x boost for symbol-definition and filename matches; lists file category (test, generated, third-party) as a ranking signal, plus recent commit count. No weights given for categories.
    Prior art for: file-kind prior and definition boost. Must cite.

16. Steve Yegge, "Rethinking search results ranking on Sourcegraph.com", 2022-11-08. https://sourcegraph.com/blog/new-search-ranking . VERIFIED.
    Does: PageRank on the code symbol graph (usages as links) as a file-importance prior. Prior art for global file-importance priors. ss-grep's prior is type-based, not graph-based.

17. GitHub code search ranking: Blackbird post (item 3) shows score-ordered posting lists; the 2021 preview post says symbols are searchable and "smart ranking" is used: https://github.blog/2021-12-08-improving-github-code-search/ . The Sourcegraph comparison doc says GitHub uses match count, match quality, file kind, symbol matches (secondary; UNVERIFIED against GitHub's own docs). Do not claim details of GitHub's ranking.

18. GitHub Linguist: `linguist-generated`, `linguist-vendored`, `linguist-documentation` attributes and built-in generated-file heuristics. Repo: https://github.com/github-linguist/linguist . VERIFIED via search summaries of overrides docs (secondary mirrors). Prior art for generated-file detection. If ss-grep's "generated" class uses Linguist-like rules or enry, say so.

19. Universal Ctags / Zoekt ctags doc: https://gerrit.googlesource.com/zoekt/+/f7d54faa261b31f7258a2d1291531ebd89ce8ee5/doc/ctags.md (mirror of Zoekt doc/ctags.md). VERIFIED (via search). Prior art for definition extraction from source for ranking.

20. Bajracharya et al., "A Study of Ranking Schemes in Internet-Scale Code Search", UCI-ISR-07-8 tech report, 2007. https://isr.uci.edu/sites/isr.uci.edu/files/techreports/UCI-ISR-07-8.pdf . VERIFIED (exists; abstract only). Older academic ranking of code search results using structural info. Also survey: "Code Search: A Survey of Techniques for Finding Code", arXiv 2204.02765, https://arxiv.org/abs/2204.02765 . VERIFIED. The survey says most engines rely on the retrieval score, so literature on ranking exact-match hits for output budgeting is thin.

21. Grep-like tools with test-file penalties: vendor docs only (grepai, Probe). UNVERIFIED as stable references; skip or cite as tool docs.

Gap found: I found NO paper that ranks grep/regex output lines under an output budget. The nearest are Zoekt display limits (Sourcebot and GitLab issues: MaxMatchDisplayCount truncates after sort; TotalMaxMatchCount = display + 1 is used to detect truncation; GitLab per-file line caps; "open the file to view all results" link). Sources: https://github.com/sourcebot-dev/sourcebot/pull/555 and https://gitlab.com/gitlab-org/gitlab/-/merge_requests/218798/commits . VERIFIED via search summaries (issue trackers, not papers). These are prior art for "tell the user results were truncated" (mechanism 4).

## 3. Apportionment in IR

22. Van Dang and W. Bruce Croft, "Diversity by Proportionality: An Election-based Approach to Search Result Diversification", SIGIR 2012, pp. 65-74. DOI 10.1145/2348283.2348296. PDF: https://ciir-publications.cs.umass.edu/getpdf.php?id=1050 . VERIFIED (I read the PDF text).
    Confirmed details:
    - Algorithm 1 is the Sainte-Laguë method; the quotient is qt[i] = v_i / (2 s_i + 1), v_i = votes (aspect popularity), s_i = seats already given. The seat goes to the arg-max quotient.
    - PM-1 (Algorithm 3) is the naive adaptation: one aspect per document. PM-2 (Algorithm 4) picks the aspect by Sainte-Laguë, then picks the document that maximises lambda * qt[i*] * P(d|t_i*) + (1 - lambda) * sum over i != i* of qt[i] * P(d|t_i); after selection each aspect's s_i grows by its normalised share P(d*|t_i) / sum_j P(d*|t_j) (fractional seats).
    - Keywords include Sainte-Laguë. Evaluated on TREC Web track 2009/2010 diversity (WT-2010 mentioned), baselines include xQuAD. Also proposes a proportionality metric (disproportionality at rank K, based on the Least-Squares index).
    What it covers: apportioning RANK POSITIONS in one list among query aspects (topics). Parties = aspects; seats = list positions.
    How it relates: ss-grep uses the same divisor rule (Sainte-Laguë) to apportion LINES among FILES, with weight = hits/(hits+2) x type prior as "votes". The method is prior art as an IR technique. Using Sainte-Laguë to split an output line budget among files is a different application. Do NOT claim "first use of Sainte-Laguë in IR". Must cite and state the analogy and differences (ss-grep: no topic model, votes come from hit counts and file-type priors, one-line floor per file, deterministic and exact).

23. Santos, Macdonald, Ounis, "Exploiting Query Reformulations for Web Search Result Diversification", WWW 2010 (xQuAD), DOI 10.1145/1772690.1772780. https://archives.iw3c2.org/www2010/proceedings/www/p881.pdf . VERIFIED (venue, DOI per search). Coverage-based diversification baseline that PM-2 compares against. Cite alongside PM-2.

24. Skowron, Lackner, Brill, Peters, Elkind, "Proportional Rankings", IJCAI 2017, pp. 409-415, DOI 10.24963/ijcai.2017/58. https://www.ijcai.org/proceedings/2017/58 . VERIFIED. Proportional representation applied to ranked outputs (fair representation in every prefix). Related prior art for "proportional shares of a ranked list". Cite as related work on proportionality in rankings.

25. Apportionment theory: Webster = Sainte-Laguë (divisors 1, 3, 5, ...); D'Hondt = Jefferson (divisors 1, 2, 3, ...). Reference: Balinski and Young, "Fair Representation: Meeting the Ideal of One Man, One Vote" (Yale UP, 1982). UNVERIFIED here (recalled; I did not open a source). Also arXiv "Apportionment methods", https://arxiv.org/abs/1510.07528 , VERIFIED as listed by search (not read). Use Balinski and Young for the claim that Sainte-Laguë/Webster is the unbiased divisor method (property claims: UNVERIFIED in this review).

26. Search for recommender/fair-ranking work using D'Hondt or Sainte-Laguë: none found in one targeted search (only calibration papers, e.g. arXiv 2507.02643 "Calibrated Recommendations: Survey and Future Directions", VERIFIED exists). UNVERIFIED claim that no such work exists. A D'Hondt-based multi-stakeholder recommender line exists in my memory (Sanchez/Bellogin, "Dynamic democratic re-ranking"?). UNVERIFIED, search before claiming novelty.

27. Budgeted context packing for LLMs (2025-2026, all from one search; VERIFIED listing only, not read):
    - AdaGReS, arXiv 2512.25052, greedy context selection with redundancy penalty for token-budgeted RAG. https://arxiv.org/abs/2512.25052
    - "Recall Is Not Enough: A Reader-Context Diagnostic for Budget-Constrained RAG", arXiv 2607.00725, cost-scaled greedy packer. https://arxiv.org/abs/2607.00725
    - PACMS, arXiv 2606.20047, agent context assembly as submodular maximisation under a knapsack token constraint.
    - "When Knowledge Is Not Free: Cost-Aware Evidence Selection in RAG", arXiv 2606.02245.
    - "Budget-Aware Routing for Long Clinical Text", ACL Findings 2026 / arXiv 2605.00336.
    All treat budgeted selection as knapsack/submodular with relevance and redundancy scores, mostly embedding-based. Prior art for "select under a token budget". They do not use an apportionment rule or exact-match semantics. Need to read before claiming any difference.
    Classic backbones (recalled, UNVERIFIED): MMR (Carbonell and Goldstein, SIGIR 1998), Lin and Bilmes 2011 submodular summarisation.

## 4. Snippets, KWIC, crowding

28. Tombros and Sanderson, "Advantages of Query Biased Summaries in Information Retrieval", SIGIR 1998, pp. 2-10, DOI 10.1145/290941.290947. https://people.eng.unimelb.edu.au/ammoffat/sigir98/abstracts/tombros.html . VERIFIED. Query-biased summaries improve speed and accuracy of relevance judgments. Prior art for showing matching context instead of a static prefix. Supports the design of showing matched lines. Not prior art for apportionment.

29. Turpin, Tsegay, Hawking, Williams, "Fast Generation of Result Snippets in Web Search", SIGIR 2007, pp. 127-134, DOI 10.1145/1277741.1277766. https://researchportalplus.anu.edu.au/en/publications/fast-generation-of-result-snippets-in-web-search/ . VERIFIED (metadata). Snippet generation cost and caching. Cite for snippet generation as a systems problem.

30. Result crowding / site collapsing: Solr/Lucene Collapsing and Grouping ("Collapse and Expand Results"), https://solr.apache.org/guide/8_9/collapse-and-expand-results.html . VERIFIED; Lucidworks post on collapsing on a site field: https://lucidworks.com/blog/2446 . VERIFIED. Elasticsearch `collapse` parameter, https://opster.com/guides/elasticsearch/how-tos/elasticsearch-collapse/ . VERIFIED (secondary).
    Prior art for "at most one result per group, first": collapse = keep best document per group. ss-grep's "one line per kept file first, then share the rest" is a graded version of collapsing. Concept NOT novel. No academic citation found for Google host crowding; UNVERIFIED. Do not cite Bar-Ilan et al. (search did not support it).

## 5. Developer studies of grep use

31. Singer, Lethbridge, Vinson, Anquetil, "An Examination of Software Engineering Work Practices", CASCON 1997. https://www.site.uottawa.ca/~tcl/papers/Cascon/Cascon97MergedPages.doc . VERIFIED exists; I did NOT confirm that it names grep. A secondary summary says grep variants were the second most used tool after the compiler. UNVERIFIED claim; open the document before citing.

32. Sim, Clarke, Holt, "Archetypal Source Code Searches: A Survey of Software Developers and Maintainers", IWPC 1998, DOI 10.1109/WPC.1998.693351. VERIFIED (catalog record). Not confirmed to discuss grep.

33. Sadowski et al. 2015 (item 13) and its 2025 revisit. These are about code search engines, not grep.

34. Found no dedicated empirical study of how developers use grep. State this as a gap (in one search; extend with "Ko, Myers, Coblenz, Aung 2006 exploratory study of program understanding" UNVERIFIED).

35. Agent side (outside my slice but needed here): Yang et al., "SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering", arXiv 2405.15793 (NeurIPS 2024 per my recall; the arXiv page does not state it). https://arxiv.org/abs/2405.15793 . VERIFIED title and authors. I could NOT confirm from the page that search commands cap results and ask the agent to refine. UNVERIFIED claim; read the paper. Best precedent for output caps in agent tools.

## Conclusions

(a) Clearly prior art (must cite, cannot claim as novel)
- Trigram or sparse-gram indexed regex search with verify step: Cox 2012, FREE 2002, Zoekt, Blackbird (sparse grams), livegrep, ugrep-indexer, Cursor 2026, PVLDB 2025 evaluation.
- Literal-prefilter and fast exact regex: ripgrep, Hyperscan.
- Sainte-Laguë as an IR re-ranking rule: PM-2 (Dang and Croft 2012).
- File-kind prior (test, vendor, generated penalised): Zoekt (divide TF by 5 for low-priority files), Sourcegraph BM25F (file category as signal), Linguist for generated detection.
- Definition/symbol boost: Zoekt (symbol kinds), Sourcegraph BM25F (5x), GitHub symbol index.
- Query-biased snippets: Tombros and Sanderson 1998.
- Site/group collapsing (best doc per group): Solr, Elasticsearch.
- Report that results were truncated: Zoekt display-limit logic (Sourcebot, GitLab), standard CLI tools.
- Budgeted selection of context under a token limit: 2025-2026 RAG packing papers.

(b) Combinations that look new (only from this search; not an exhaustive check)
- Sainte-Laguë applied to apportion output LINES across FILES under a line budget, using weight = hits/(hits+2) x file-type prior as the votes, with a one-line-per-file floor.
- Doing that while keeping exact grep match semantics (same matches as ripgrep) and only shaping the overflow output; every ranking system above reorders or drops matches at the search level.
- Declaration-first ordering of lines inside a file under a budget, with an explicit dropped-match count, packaged as a drop-in grep for LLM agents.
- Pairing a warm daemon, native lane and index with the above (speed and output shaping together). Cursor 2026 is the nearest on the speed side but gives no output-shaping mechanism (per the blog summary I read).
Risk: Skowron et al. 2017 and PM-2 make "proportional representation in rankings" an established idea; claim the application and the guarantees, not the principle.

(c) Five must-cite references
1. Cox 2012, trigram index (https://swtch.com/~rsc/regexp/regexp4.html).
2. Dang and Croft, SIGIR 2012, PM-2 / Sainte-Laguë (DOI 10.1145/2348283.2348296).
3. Gallant (BurntSushi), ripgrep blog 2016 (https://burntsushi.net/ripgrep/), the exact-semantics baseline.
4. Clem, GitHub Blackbird / sparse grams, 2023 (https://github.blog/engineering/the-technology-behind-githubs-new-code-search/).
5. Zoekt design/scoring plus Sourcegraph BM25F blog 2025 (https://github.com/sourcegraph/zoekt/blob/main/doc/design.md; https://sourcegraph.com/blog/keeping-it-boring-and-relevant-with-bm25f) for file-kind and symbol priors.
Strong next picks: Cursor "Fast regex search" 2026, Zhang et al. PVLDB 2025, Cho and Rajagopalan ICDE 2002, Tombros and Sanderson SIGIR 1998, Sadowski et al. FSE 2015.

## Open checks before submission
- Read Singer 1997 and SWE-agent for the exact statements before citing them for grep use or output caps.
- Confirm BigGrep provenance or drop it.
- Read the 2025-2026 context packing papers; confirm none uses apportionment.
- Search once more for D'Hondt/Sainte-Laguë in recommender and fair ranking (Balinski and Young is a recalled reference, unopened).
- Check the Sourcegraph/GitHub ranking pages for how matches inside a file are ordered (not covered by what I read).
