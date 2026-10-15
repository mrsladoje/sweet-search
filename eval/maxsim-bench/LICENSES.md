# Licences for the MaxSim data release

All checks were done on 2026-10-15. This file is not legal advice.

## Release decision

We release derived data for the 11 code repositories and for BEIR SciFact. We hold back NFCorpus and FiQA-2018 data. We hold back GenCodeSearchNet data.

- **Release under CC-BY-4.0 (our own files):** int4 and float32 token embeddings of code chunks from the 11 repositories, and query token embeddings of our agent queries. Add an attribution file that lists the 11 repositories, their licences and their commits.
- **Release with attribution:** SciFact embeddings, BM25 candidate lists and document IDs. Cite the SciFact source licences (see the dataset table).
- **Release IDs only:** NFCorpus and FiQA-2018. Publish document IDs, query IDs, BM25 candidate lists as ID lists, and the script that rebuilds the embeddings. Do not publish embeddings. Their terms allow only academic or non-commercial use, and CC-BY-4.0 would grant more than that.
- **Release IDs only:** GenCodeSearchNet. The upstream CodeSearchNet data has one licence per source repository, and the dataset does not list them per function. Publish IDs and the rebuild script (`eval/download_data.py`).
- **Never release:** raw code text, raw document text, raw query text. The agent query texts may contain pasted repository code, so we publish only their embeddings.
- **Open point for the authors:** whether an embedding is a derived work of its source text has no settled answer. Permissive licences (MIT, Apache-2.0) make the risk low. Share-alike and non-commercial terms make the risk high. This file uses that rule.
- **Model outputs:** both models have a permissive licence and no stated limit on outputs. Embeddings from them are free to release, subject to the licence of the input text.

## Group 1: code repositories (`eval/repos/r3-*`)

We read each licence file in the local clone. We took the SPDX id from the licence text. All 11 licences are permissive. They require that copies keep the copyright and licence notice. The embeddings do not copy code text. We still ship the notice in an attribution file.

| source | licence (SPDX) | where checked | derived embeddings redistributable? | conditions |
|---|---|---|---|---|
| composer (`https://github.com/composer/composer`) | MIT | `eval/repos/r3-composer/LICENSE`; commit `6712f83974b4469f764963f3a65852496f254350` | yes with attribution | Keep the copyright and licence notice in the attribution file. |
| dgraph (`https://github.com/dgraph-io/dgraph`) | Apache-2.0 | `eval/repos/r3-dgraph/LICENSE.txt`; commit `6cd03dca3b003dae29df904c0a09667f7edb703b` | yes with attribution | Keep the licence text. The nested file `graphql/testdata/datagen/LICENSE` is also Apache-2.0. |
| drogon (`https://github.com/drogonframework/drogon`) | MIT | `eval/repos/r3-drogon/LICENSE`; commit `bfb3ae2e13572a30cbdbd623da1798794d5f2706` | yes with attribution | Keep the notice. |
| GRDB.swift (`https://github.com/groue/GRDB.swift`) | MIT | `eval/repos/r3-grdb/LICENSE`; commit `0d8cf958b4b66a0473ec6e6986eb9da462171da9` | yes with attribution | Keep the notice. |
| jj (`https://github.com/jj-vcs/jj`) | Apache-2.0 | `eval/repos/r3-jj/LICENSE`; commit `030ecf22c56b98bf6507067dca0df3dffa6de498` | yes with attribution | Keep the licence text. |
| Ocelot (`https://github.com/ThreeMammals/Ocelot`) | MIT | `eval/repos/r3-ocelot/LICENSE.md`; commit `fcebf2b96c1811500037e010ee3b09e25ac39b19` | yes with attribution | Keep the notice. |
| okhttp (`https://github.com/square/okhttp`) | Apache-2.0 | `eval/repos/r3-okhttp/LICENSE.txt`; commit `e9eae50d36e938603811a41f9e2ab04182bcb515` | yes with attribution | Keep the licence text. |
| sequel (`https://github.com/jeremyevans/sequel`) | MIT | `eval/repos/r3-sequel/MIT-LICENSE` (the gemspec also says `s.license = 'MIT'`); commit `3acf523e8accb7a745e364b4db3bb51b172162b3` | yes with attribution | Keep the notice. The file has two copyright lines. Keep both. |
| tortoise-orm (`https://github.com/tortoise/tortoise-orm`) | Apache-2.0 | `eval/repos/r3-tortoise-orm/LICENSE.txt`; commit `1979f27d6a37db991ca5c934e2394faa6c942d52` | yes with attribution | Keep the licence text. |
| typedoc (`https://github.com/TypeStrong/typedoc`) | Apache-2.0 | `eval/repos/r3-typedoc/LICENSE`; commit `6d8c856bbb46b089371952981f113c3e318818fd` | yes with attribution | Keep the licence text. |
| zipkin (`https://github.com/openzipkin/zipkin`) | Apache-2.0 | `eval/repos/r3-zipkin/LICENSE`; commit `878ce2a1fad54ca941d17fdcf2e1d924b148eb1f` | yes with attribution | The file lists modified parts of three other libraries, each Apache-2.0. Keep the whole file. |

Notes:

- Each repository can hold vendored files under other licences. We checked only the top-level licence file, plus a search for nested licence files in dgraph. We did not scan the other 10 repositories for nested licences. Do this scan before the release, or accept the small risk.
- Agent query texts come from our own agent runs. The agent wrote them. They have no third-party licence, but they can quote repository code. Release embeddings only.

## Group 2: datasets

| source | licence (SPDX) | where checked | derived embeddings redistributable? | conditions |
|---|---|---|---|---|
| GenCodeSearchNet, as used by `eval/download_data.py` (function `download_gencodesearchnet`) | mixed: one licence per source repository (no single SPDX id) | Local: `eval/download_data.py` lines 461-500. It loads `semeru/code-text-{python,javascript,go,ruby,java,php}`, the CodeSearchNet test splits. These are not the benchmark of Diera et al. (arXiv 2311.09707), although we call them GenCodeSearchNet. Remote: `https://huggingface.co/datasets/semeru/code-text-python` (tag `mit`, no source named, checked 2026-10-15); `https://huggingface.co/datasets/code-search-net/code_search_net` (tag `other`: "Example-wise license information is not (yet) included in this dataset: you will need to find out yourself which license the code is using."); `https://github.com/github/CodeSearchNet` ("licenses for source code used as data ... are provided with the data download", in `_licenses.pkl`; code and docs are MIT); `https://arxiv.org/pdf/2311.09707` (ethics section says CodeSearchNet was filtered to projects with licences that permit redistribution; we did not verify this claim against the `_licenses.pkl` files) | unclear | The `mit` tag on the `semeru` mirror is not reliable, because the underlying code has per-repository licences. To resolve: download `_licenses.pkl` and check that every licence is permissive. Until then, release IDs and the rebuild script only. |
| BEIR SciFact | Corpus: ODC-By 1.0. Claims: CC-BY-4.0. | `https://raw.githubusercontent.com/allenai/scifact/master/LICENSE.md` (claims "released under CC BY 4.0"; abstracts "licensed under ODC-By 1.0"; code Apache-2.0), checked 2026-10-15. BEIR table: `https://github.com/beir-cellar/beir` (gives no per-dataset licence; says each user must check permission). Mirror: `https://huggingface.co/datasets/BeIR/scifact` (tag `cc-by-sa-4.0`) | yes with attribution | Cite the source and the licences. The BEIR mirror tag says CC-BY-SA-4.0, which conflicts with the source licence. We follow the source (allenai) licence. If a reviewer asks, note the conflict. Under the mirror tag, embeddings would need a share-alike licence. |
| BEIR NFCorpus | no named licence; "free to use for academic purposes" | `https://www.cl.uni-heidelberg.de/statnlpgroup/nfcorpus/` (Terms of Use: "NFCorpus is free to use for academic purposes. For any other uses of the included NutritionFacts.org data please consult Terms of Service"), checked 2026-10-15. Mirror: `https://huggingface.co/datasets/BeIR/nfcorpus` (tag `cc-by-sa-4.0`, no source for it) | unclear | The source page has no redistribution statement. Do not release embeddings. Release IDs, ID-only candidate lists and the rebuild script. To resolve: ask the NFCorpus authors in writing. |
| BEIR FiQA-2018 | no named licence; "available only for non-commercial use" | `https://sites.google.com/view/fiqa/home` (train and test data: "available only for non-commercial use"; no redistribution statement), checked 2026-10-15. Mirror: `https://huggingface.co/datasets/BeIR/fiqa` (tag `cc-by-sa-4.0`, no source for it) | no (for a CC-BY-4.0 release) | CC-BY-4.0 allows commercial use, so it would grant more than the source allows. Release IDs and the rebuild script only. FiQA is optional in the paper plan, so dropping its embeddings costs little. |

## Group 3: models

Embeddings are model outputs. Neither model card states a limit on outputs.

| source | licence (SPDX) | where checked | derived embeddings redistributable? | conditions |
|---|---|---|---|---|
| `answerdotai/answerai-colbert-small-v1` | Apache-2.0 | `https://huggingface.co/answerdotai/answerai-colbert-small-v1` (model card metadata `apache-2.0`; no output or training-data restriction stated), checked 2026-10-15 | yes with attribution | Cite the model. The card does not describe its training-data terms. We did not check them, and we do not treat them as a limit on outputs. |
| `colbert-ir/colbertv2.0` | MIT | `https://huggingface.co/colbert-ir/colbertv2.0` (metadata `mit`; trained on MS MARCO passage ranking; no output restriction stated), checked 2026-10-15 | yes with attribution | Cite the model. We did not check the MS MARCO terms. We do not treat them as a limit on outputs. |

## Group 4: rival libraries (we call them; we do not redistribute them)

| source | licence (SPDX) | where checked | derived embeddings redistributable? | conditions |
|---|---|---|---|---|
| maxsim-cpu 0.1.0 | Apache-2.0 | Local: `eval/maxsim-bench/venv/lib/*/site-packages/maxsim_cpu-0.1.0.dist-info/METADATA`. Remote: `https://raw.githubusercontent.com/mixedbread-ai/maxsim-cpu/main/LICENSE` (Apache-2.0 text), 2026-10-15 | not applicable (not redistributed) | Cite in the paper. No notice needed, because we ship no copy. |
| NumKong 7.8.5 | Apache-2.0 | Local: `.../numkong-7.8.5.dist-info/METADATA` (`License: Apache-2.0`). We did not check the upstream repository. | not applicable | Same as above. |
| NumPy 2.5.4 | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 | Local: `.../numpy-2.5.4.dist-info/METADATA` (`License-Expression`) | not applicable | Same as above. |
| PyTorch 2.14.1 | Apache-2.0 AND Apache-2.0 WITH LLVM-exception AND BSD-2-Clause AND BSD-3-Clause AND BSL-1.0 AND MIT | Local: `.../torch-2.14.1.dist-info/METADATA` (`License-Expression`) | not applicable | Same as above. |
| next-plaid crate | Apache-2.0 | Remote only: `https://raw.githubusercontent.com/lightonai/next-plaid/main/Cargo.toml` (`[workspace.package]` licence Apache-2.0; members include `next-plaid`) and `https://github.com/lightonai/next-plaid`, 2026-10-15. It is not in the local venv. The shim is planned, not built. | not applicable | Re-check the licence of the exact version when the shim pins it. |
| colbert-ai (vendored file `eval/maxsim-bench/third_party/segmented_maxsim.cpp`) | MIT | Local: `eval/maxsim-bench/third_party/LICENSE.colbert`. Remote: `https://raw.githubusercontent.com/stanford-futuredata/ColBERT/main/LICENSE` (MIT, copyright 2019, 2020), 2026-10-15 | not applicable | We comply. The vendored licence file keeps the copyright line and the permission notice. `third_party/README.md` states the file is unchanged and gives the source commit. Keep `LICENSE.colbert` in every code bundle that includes the vendored file. |

## Open actions before the release

1. Download CodeSearchNet `_licenses.pkl` and check that all licences are permissive. This decides whether GenCodeSearchNet embeddings can ever join the release.
2. Scan the 10 other repositories for nested licence files.
3. Ask the NFCorpus authors about redistribution of derived data. Optional.
4. Re-check next-plaid and NumKong upstream licences when versions are pinned.
5. Have a person with legal knowledge confirm the rule on embeddings as derived works.
