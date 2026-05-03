# GenCodeSearchNet Dense Profile Miss Summary

Generated: 2026-05-03T10:23:06.259Z
Total queries: 6000  errors: 0
Profile: graphExpand=none, stage3Candidates=15, k=100
Second pass (rerank=false) for misses: true

## Headline metrics

- MRR@10: **85.61%**
- Recall@10: 93.80%, Recall@50: 95.90%, Recall@100: 96.28%

> See `FIX_TABLE.md` for ranked low-hanging fix recommendations. Top candidates: rerank-window enlargement (#4 — 132 misses sit at no-rerank rank 16-30, just outside s3=15), JS/Ruby chunk-extraction audit (#6 — ~25 pp gap to Python/Go), benchmark-noise filtering (#5 — copyright headers and bare type signatures appear as queries).

## Buckets

| bucket | count | share |
|---|---|---|
| hit_top1 | 4816 | 80.27% |
| hit_top10 | 812 | 13.53% |
| gold_not_in_top100_candidate_generation | 223 | 3.72% |
| gold_present_but_not_top10 | 138 | 2.30% |
| reranker_demoted_gold | 11 | 0.18% |

## Per-language hit rate

| language | total | top1 | top1 rate | top10 rate | miss rate |
|---|---|---|---|---|---|
| go | 1000 | 922 | 92.20% | 98.30% | 1.70% |
| java | 1000 | 801 | 80.10% | 95.50% | 4.50% |
| javascript | 1000 | 705 | 70.50% | 88.80% | 11.20% |
| php | 1000 | 731 | 73.10% | 93.00% | 7.00% |
| python | 1000 | 955 | 95.50% | 98.50% | 1.50% |
| ruby | 1000 | 702 | 70.20% | 88.70% | 11.30% |

## Miss-bucket distribution per language

| language | gold_not_in_top100_candidate_generation | gold_present_but_not_top10 | reranker_demoted_gold |
|---|---|---|---|
| go | 7 | 9 | 1 |
| java | 21 | 23 | 1 |
| javascript | 73 | 36 | 3 |
| php | 36 | 32 | 2 |
| python | 7 | 8 | 0 |
| ruby | 79 | 30 | 4 |

## Query shape vs hit rate

| shape | total | top1 rate | top10 rate |
|---|---|---|---|
| few_words | 358 | 69.83% | 85.20% |
| normal | 5605 | 81.14% | 94.56% |
| title_caps | 8 | 75.00% | 100.00% |
| type_signature | 1 | 0.00% | 0.00% |
| very_short | 28 | 42.86% | 53.57% |

## Representative misses (20)

### GC00008 [gold_not_in_top100_candidate_generation] (python, shape=very_short)
- **query**: str->dict
- **gold**: ckplayer_get_info_by_xml_520c4ee9.py (funcs: ckplayer_get_info_by_xml)
- **rankFinal=-1, rankNoRerank=-1**
- top-3: TransferJobPreprocessor._convert_date_to_dict_35b8441a.py (0.340) | TransferJobPreprocessor._convert_time_to_dict_7acf9765.py (0.323) | alchemy_to_dict_420a11f1.py (0.296)

### GC00021 [gold_not_in_top100_candidate_generation] (python, shape=very_short)
- **query**: int->None
- **gold**: wanmen_download_by_course_50c99a9d.py (funcs: wanmen_download_by_course)
- **rankFinal=-1, rankNoRerank=-1**
- top-3: Produce.encodeMessageSet_27f413bb.php (16.185)

### GC00010 [gold_not_in_top100_candidate_generation] (python, shape=type_signature)
- **query**: str->list of str
- **gold**: MGTV.get_mgtv_real_url_160a4d33.py (funcs: MGTV.get_mgtv_real_url)
- **rankFinal=-1, rankNoRerank=-1**
- top-3: sina_xml_to_url_list_6b3f70a1.py (0.434) | AzureDataLakeHook.list_2aa6600b.py (0.317) | append_17c3d4b8.js (0.305)

### GC00014 [gold_not_in_top100_candidate_generation] (python, shape=normal)
- **query**: str, str, str, bool, bool ->None
- **gold**: acfun_download_by_vid_70df217f.py (funcs: acfun_download_by_vid)
- **rankFinal=-1, rankNoRerank=-1**
- top-3: _bq_cast_25dfadbc.py (0.309) | BaseBuilder.getOperator_77c79875.php (0.298) | FormatRules.valid_emails_325e1e91.php (0.297)

### GC00022 [gold_not_in_top100_candidate_generation] (python, shape=few_words)
- **query**: int, int, int->None
- **gold**: wanmen_download_by_course_topic_part_3856aa9c.py (funcs: wanmen_download_by_course_topic_part)
- **rankFinal=-1, rankNoRerank=-1**
- top-3: ProxettaAsmUtil.pushInt_57f8d141.java (0.367) | JsonPath.getInt_74e511f3.java (0.318) | Session.set_3bb0c355.php (0.247)

### GC01241 [reranker_demoted_gold] (javascript, shape=normal)
- **query**: Comparator function to pass to Array.sort
- **gold**: compareCapabilities_4c7a7da1.js (funcs: compareCapabilities)
- **rankFinal=11, rankNoRerank=8**
- top-3: ParallelSorter.quickSort_284641fd.java (0.442) | Observable.sorted_19c0f7c5.java (0.431) | Flowable.sorted_6e4dcf0d.java (0.423)

### GC01613 [reranker_demoted_gold] (javascript, shape=normal)
- **query**: Returns a boolean indicating whether or not the instance is currently
- **gold**: func_167361c5.js (funcs: )
- **rankFinal=12, rankNoRerank=6**
- top-3: Router.current_4b982587.php (0.550) | TaskInstance.ready_for_retry_78fb560d.py (0.518) | Time.getDst_42a1409e.php (0.498)

### GC01669 [reranker_demoted_gold] (javascript, shape=normal)
- **query**: Wraps the given function, `fn`, with a new function that only invokes `fn`
- **gold**: throttle_54c9925b.js (funcs: throttle)
- **rankFinal=11, rankNoRerank=7**
- top-3: Transproc.Registry.___0024cb05.rb (0.577) | _copy_fn_17c6cb23.py (0.558) | interceptable_317e40be.py (0.552)

### GC02813 [reranker_demoted_gold] (go, shape=normal)
- **query**: // get returns the found value if any. If not found, we return nil.
- **gold**: get_543aba1f.go (funcs: get)
- **rankFinal=13, rankNoRerank=4**
- top-3: Get_0efdde5e.go (0.613) | Find_3290ba60.go (0.586) | Engine.get_193e80d0.php (0.567)

### GC03047 [reranker_demoted_gold] (ruby, shape=normal)
- **query**: Copy the given source to the destination. This method accepts a single
- **gold**: Omnibus.Builder.copy_44d792f5.rb (funcs: Omnibus.Builder.copy)
- **rankFinal=11, rankNoRerank=1**
- top-3: GoogleCloudStorageHook.copy_2f067066.py (0.522) | Omnibus.Util.copy_file_79d3a43b.rb (0.500) | Omnibus.FileSyncer.sync_4b81f069.rb (0.479)

### GC00112 [gold_present_but_not_top10] (python, shape=normal)
- **query**: Use multiple processes to parse and generate tasks for the
- **gold**: DagFileProcessorManager.start_138a9b4e.py (funcs: DagFileProcessorManager.start)
- **rankFinal=17, rankNoRerank=17**
- top-3: DagFileProcessorManager.heartbeat_64084786.py (0.487) | DagFileProcessorManager.heartbeat_64084786.py (0.433) | CeleryExecutor._num_tasks_per_fetch_process_01de59d3.py (0.413)

### GC00316 [gold_present_but_not_top10] (python, shape=normal)
- **query**: BACKPORT FROM PYTHON3 FTPLIB.
- **gold**: mlsd_1df9fcd9.py (funcs: mlsd)
- **rankFinal=21, rankNoRerank=21**
- top-3: FTPHook.get_conn_12cc5eb6.py (0.332) | DropPort_45f19b45.go (0.307) | FTPHook.retrieve_file_5ebf85b3.py (0.271)

### GC00446 [gold_present_but_not_top10] (python, shape=normal)
- **query**: Executed by task_instance at runtime
- **gold**: MongoToS3Operator.execute_50f6d297.py (funcs: MongoToS3Operator.execute)
- **rankFinal=39, rankNoRerank=39**
- top-3: SchedulerJob._process_task_instances_10dc825a.py (0.516) | task_state_31249252.py (0.505) | SchedulerJob._change_state_for_executable_task_instances_2c9b3884.py (0.486)

### GC00542 [gold_present_but_not_top10] (python, shape=normal)
- **query**: Establishes a connection depending on the security mode set via config or environment variable.
- **gold**: WebHDFSHook.get_conn_332ee4cb.py (funcs: WebHDFSHook.get_conn)
- **rankFinal=19, rankNoRerank=19**
- top-3: Services.security_41372768.php (0.459) | Config.connect_5a5fd3fc.php (0.435) | SalesforceHook.get_conn_1b33066e.py (0.428)

### GC00607 [gold_present_but_not_top10] (python, shape=normal)
- **query**: remove first and last lines to get only json
- **gold**: response_3ab8ec23.py (funcs: response)
- **rankFinal=16, rankNoRerank=16**
- top-3: Browser.Storage.to_json_25eff98b.rb (0.341) | IncomingRequest.getJSON_6ab62ea9.php (0.336) | Snoo.Listings.get_listing_136feeaa.rb (0.333)
