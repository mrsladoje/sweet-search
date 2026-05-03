# GCSN JavaScript/Ruby Attractor Analysis

Generated: 2026-05-03T10:53:12.996Z
Languages scanned: javascript, ruby
Threshold: top1 across ≥3 unrelated queries OR top3 across ≥5 unrelated queries

Total queries scanned: 2000
Misses (non-top1) scanned: 593
Distinct files surfacing in top1/top3 of misses: 1104
Suspect attractors (above threshold): **20**

## Classification (manual, applied 2026-05-03)

| pattern | files | verdict | recommended action |
|---|---|---|---|
| **Single file split into 318 chunks (4.57 % of entire index)** | `emitFiles_57fa9c6b.js` | **chunking issue** (corpus-construction); a 334 KB function chunked into 318 ~500-token slices — every chunk competes for unrelated queries | de-duplicate or cap chunks per source-file in the GCSN corpus loader; do **not** patch production ranker |
| TypeScript-fork giants from `twinssbc/Ionic2-Calendar` | `encodeLastRecordedSourceMapSpan_64647c47.js`, `handleUnionSelections_34b04d69.js`, `emitTempVariableAssignment_54b1f395.js` | **benchmark noise** — the fork shadows real TypeScript compiler internals; queries describing *anything* about JS source maps land here | filter `twinssbc_Ionic2-Calendar/` from the JS split or cap its representation |
| Generic-named Ruby/JS helpers (`each`, `pmt`, `nper`, `with`, `arguments`, `body`, `nav`) | ranks 4-12, 18-20 | **ranking issue (no idf/dampening for generic names)** — 1-chunk files surfacing for many queries because their tokens are too generic | low-risk: add a query/document idf-weighted rerank (or down-weight 1-token / 2-token symbols); **needs ablation before shipping** |
| Repository-internal mass functions (HiddenMarkovModel, ProxettaFactory) | ranks 7, 14 | **chunking + corpus** — entity-extraction split a single big class into 8+ chunks | small impact, monitor only |

### Headline

The single most damaging effect on the JS top1 number is the **emitFiles** chunking pathology. With 318 chunks on a 6962-chunk index, this one file accounts for ~4.57 % of all candidates — and is implicated in 31 distinct query misses (top1+top3 across 31 different gold files). Removing or capping it would lift the JS top1 number by roughly 3-5 pp on its own; it is a **benchmark/corpus-side fix**, not a model fix.

## Index footprint

Total chunks in GCSN index: 6962

## Attractor table

| rank | file | path-kind | chunks | % index | top1 | top3 | langs | distinct gold |
|---:|---|---|---:|---:|---:|---:|---|---:|
| 1 | `emitFiles_57fa9c6b.js` | normal | 318 | 4.57% | 18 | 29 | javascript,ruby | 31 |
| 2 | `encodeLastRecordedSourceMapSpan_64647c47.js` | normal | 3 | 0.04% | 5 | 1 | javascript,ruby | 6 |
| 3 | `handleUnionSelections_34b04d69.js` | normal | 5 | 0.07% | 4 | 3 | javascript,ruby | 5 |
| 4 | `each_4efef1c0.js` | normal | 1 | 0.01% | 4 | 2 | javascript,ruby | 6 |
| 5 | `UiBibz__Ui__Core__Lists__Components.List.body_6aaf39bb.rb` | normal | 1 | 0.01% | 4 | 1 | javascript,ruby | 5 |
| 6 | `Nimbu.Endpoint.arguments_0e54e201.rb` | normal | 1 | 0.01% | 4 | 1 | javascript,ruby | 5 |
| 7 | `ProxettaFactory.newInstance_28568a55.java` | normal | 1 | 0.01% | 3 | 3 | javascript,ruby | 6 |
| 8 | `Exonio.Financial.pmt_14802137.rb` | normal | 1 | 0.01% | 3 | 3 | ruby | 6 |
| 9 | `func_16736602.js` | normal | 1 | 0.01% | 3 | 2 | javascript,ruby | 5 |
| 10 | `Exonio.Financial.nper_3af2dd7a.rb` | normal | 1 | 0.01% | 3 | 2 | ruby | 5 |
| 11 | `UiBibz__Ui__Core__Navigations.Nav.nav_47bc2024.rb` | normal | 1 | 0.01% | 3 | 1 | javascript,ruby | 4 |
| 12 | `Transproc.Registry.___0024cb05.rb` | normal | 1 | 0.01% | 3 | 1 | javascript,ruby | 4 |
| 13 | `Controller.loadHelpers_0d4c2016.php` | normal | 1 | 0.01% | 3 | 1 | ruby | 4 |
| 14 | `HiddenMarkovModel.posterior_mode_642e7ed2.py` | normal | 8 | 0.11% | 3 | 0 | javascript,ruby | 3 |
| 15 | `RedisModelExtension.StoreKeys.store_redis_keys_25805460.rb` | normal | 1 | 0.01% | 3 | 0 | javascript,ruby | 3 |
| 16 | `emitTempVariableAssignment_54b1f395.js` | normal | 1 | 0.01% | 3 | 0 | javascript | 3 |
| 17 | `Webspicy.Scope.each_resource_4f235d75.rb` | normal | 1 | 0.01% | 3 | 0 | javascript,ruby | 3 |
| 18 | `CanCan.Ability.aliases_for_action_46a2c074.rb` | normal | 1 | 0.01% | 3 | 0 | ruby | 3 |
| 19 | `Scheherazade.Story.with_15f093b7.rb` | normal | 1 | 0.01% | 3 | 0 | ruby | 3 |
| 20 | `parseOptionValue_7970169b.js` | normal | 1 | 0.01% | 3 | 0 | ruby | 3 |

Full path key:

1. `javascript/twinssbc_Ionic2-Calendar/emitFiles_57fa9c6b.js`
2. `javascript/twinssbc_Ionic2-Calendar/encodeLastRecordedSourceMapSpan_64647c47.js`
3. `javascript/acarl005_join-monster/handleUnionSelections_34b04d69.js`
4. `javascript/pureqml_qmlcore/each_4efef1c0.js`
5. `ruby/thooams_Ui-Bibz/UiBibz__Ui__Core__Lists__Components.List.body_6aaf39bb.rb`
6. `ruby/nimbu_nimbu-api/Nimbu.Endpoint.arguments_0e54e201.rb`
7. `java/oblac_jodd/ProxettaFactory.newInstance_28568a55.java`
8. `ruby/noverde_exonio/Exonio.Financial.pmt_14802137.rb`
9. `javascript/moxiecode_moxie/func_16736602.js`
10. `ruby/noverde_exonio/Exonio.Financial.nper_3af2dd7a.rb`
11. `ruby/thooams_Ui-Bibz/UiBibz__Ui__Core__Navigations.Nav.nav_47bc2024.rb`
12. `ruby/solnic_transproc/Transproc.Registry.___0024cb05.rb`
13. `php/codeigniter4_CodeIgniter4/Controller.loadHelpers_0d4c2016.php`
14. `python/tensorflow_probability/HiddenMarkovModel.posterior_mode_642e7ed2.py`
15. `ruby/ondrejbartas_redis-model-extension/RedisModelExtension.StoreKeys.store_redis_keys_25805460.rb`
16. `javascript/twinssbc_Ionic2-Calendar/emitTempVariableAssignment_54b1f395.js`
17. `ruby/enspirit_webspicy/Webspicy.Scope.each_resource_4f235d75.rb`
18. `ruby/ryanb_cancan/CanCan.Ability.aliases_for_action_46a2c074.rb`
19. `ruby/marcandre_scheherazade/Scheherazade.Story.with_15f093b7.rb`
20. `javascript/pureqml_qmlcore/parseOptionValue_7970169b.js`

## Top attractor details

### #1  `javascript/twinssbc_Ionic2-Calendar/emitFiles_57fa9c6b.js`

- path-kind: **normal**
- top1 count: 18, top3 count: 29
- languages: javascript, ruby
- distinct queries: 31, distinct gold files: 31

Representative misses:

- `GC01023` (javascript, score=0.430) — query: *"Targeted scripts can only be invoked by you, the user, eg via a right-click option on the Sites or History tab"* — gold: `invokeWith_6248e778.js`
- `GC01094` (javascript, score=0.268) — query: *"Copyright IBM Corp. 2016, 2018"* — gold: `svgToggleClass_1da5b270.js`
- `GC01151` (javascript, score=0.570) — query: *"code for operands & | ^"* — gold: `func_16734f7a.js`
- `GC01394` (javascript, score=0.564) — query: *"All container nodes are kept on a linked list in declaration order. This list is used by the getLocalNameOfCon"* — gold: `bindChildren_5c887a57.js`
- `GC01405` (javascript, score=0.438) — query: *"This function is only for imports with entity names"* — gold: `getSymbolOfPartOfRightHandSideOfImportEquals_5df326ec.js`

### #2  `javascript/twinssbc_Ionic2-Calendar/encodeLastRecordedSourceMapSpan_64647c47.js`

- path-kind: **normal**
- top1 count: 5, top3 count: 1
- languages: javascript, ruby
- distinct queries: 6, distinct gold files: 6

Representative misses:

- `GC01312` (javascript, score=0.609) — query: *"Compiles shared bitcode used to build the targets below."* — gold: `compileShared_6e6e2583.js`
- `GC01844` (javascript, score=0.568) — query: *"Images smaller than 10kb are loaded as a base64 encoded url instead of file url"* — gold: `imageLoader_3ff93bbd.js`
- `GC01969` (javascript, score=0.604) — query: *"source map file path"* — gold: `func_16736dbe.js`
- `GC03351` (ruby, score=0.564) — query: *"initially borrowed from omniauth-cas"* — gold: `RackCAS.ServiceValidationResponse.parse_user_info_45c75a59.rb`
- `GC03600` (ruby, score=0.578) — query: *"convert value for valid format which can be saved in redis"* — gold: `RedisModelExtension.ValueTransform.value_transform_05d54c1d.rb`

### #3  `javascript/acarl005_join-monster/handleUnionSelections_34b04d69.js`

- path-kind: **normal**
- top1 count: 4, top3 count: 3
- languages: javascript, ruby
- distinct queries: 5, distinct gold files: 5

Representative misses:

- `GC01209` (javascript, score=0.564) — query: *"This is where the action is."* — gold: `runmath_0c06ab9a.js`
- `GC01212` (javascript, score=0.645) — query: *"the selections could be several types, recursively handle each type here"* — gold: `handleSelections_351cda11.js`
- `GC01601` (javascript, score=0.613) — query: *"Update the selection. Last two args are only used by updateDoc, since they have to be expressed in the line nu"* — gold: `setSelection_68f2276e.js`
- `GC03671` (ruby, score=0.574) — query: *"Standard Rails date selector."* — gold: `Informant.Standard.date_select_0f5f7e45.rb`
- `GC01212` (javascript, score=0.625) — query: *"the selections could be several types, recursively handle each type here"* — gold: `handleSelections_351cda11.js`

### #4  `javascript/pureqml_qmlcore/each_4efef1c0.js`

- path-kind: **normal**
- top1 count: 4, top3 count: 2
- languages: javascript, ruby
- distinct queries: 6, distinct gold files: 6

Representative misses:

- `GC01004` (javascript, score=0.542) — query: *"Iterate over an Array or an Object invoking a function for each item."* — gold: `forEach_70551f2c.js`
- `GC01633` (javascript, score=0.572) — query: *"Iterate each element of an object"* — gold: `each_4efef1fc.js`
- `GC03941` (ruby, score=0.512) — query: *"The classical each"* — gold: `Rufus__Tokyo.TableResultSet.each_62f496dc.rb`
- `GC03992` (ruby, score=0.350) — query: *"carattere per carattere..."* — gold: `Ric.Colors.rainbow_57fa2b75.rb`
- `GC01792` (javascript, score=0.421) — query: *"Iterator used to walk down a nested object."* — gold: `getNested_3c2be70c.js`

### #5  `ruby/thooams_Ui-Bibz/UiBibz__Ui__Core__Lists__Components.List.body_6aaf39bb.rb`

- path-kind: **normal**
- top1 count: 4, top3 count: 1
- languages: javascript, ruby
- distinct queries: 5, distinct gold files: 5

Representative misses:

- `GC01083` (javascript, score=0.562) — query: *"Creates a body primitive"* — gold: `func_21c1a890.js`
- `GC01084` (javascript, score=0.501) — query: *"Initialises body properties."* — gold: `func_21c1a891.js`
- `GC03528` (ruby, score=0.527) — query: *"Add Body div which is a component"* — gold: `UiBibz__Ui__Core__Boxes.Card.body_6ed77ec3.rb`
- `GC03535` (ruby, score=0.545) — query: *"Add Body which is a component"* — gold: `UiBibz__Ui__Core__Notifications.Alert.body_41e5832a.rb`
- `GC01160` (javascript, score=0.482) — query: *"The argument convention is options first where possible, options always before response, and body always after"* — gold: `onRequestResponse_70860333.js`

### #6  `ruby/nimbu_nimbu-api/Nimbu.Endpoint.arguments_0e54e201.rb`

- path-kind: **normal**
- top1 count: 4, top3 count: 1
- languages: javascript, ruby
- distinct queries: 5, distinct gold files: 5

Representative misses:

- `GC01160` (javascript, score=0.497) — query: *"The argument convention is options first where possible, options always before response, and body always after"* — gold: `onRequestResponse_70860333.js`
- `GC03333` (ruby, score=0.451) — query: *"Assign named arguments to this log entry, supplying defaults where applicable"* — gold: `SemanticLogger.Log.assign_356bf8f9.rb`
- `GC03334` (ruby, score=0.453) — query: *"Assign positional arguments to this log entry, supplying defaults where applicable"* — gold: `SemanticLogger.Log.assign_positional_4b9f0075.rb`
- `GC03594` (ruby, score=0.446) — query: *"take all arguments and send them out"* — gold: `RedisModelExtension.Attributes.to_arg_2782597f.rb`
- `GC03588` (ruby, score=0.412) — query: *"set old arguments"* — gold: `RedisModelExtension.StoreKeys.store_redis_keys_25805460.rb`

### #7  `java/oblac_jodd/ProxettaFactory.newInstance_28568a55.java`

- path-kind: **normal**
- top1 count: 3, top3 count: 3
- languages: javascript, ruby
- distinct queries: 6, distinct gold files: 6

Representative misses:

- `GC01567` (javascript, score=0.595) — query: *"Creates a new instance if the currentInstance is not valid for the"* — gold: `getByVersion_15c3326e.js`
- `GC01676` (javascript, score=0.563) — query: *"Create an instance of this class.."* — gold: `TextTrackCueList_3e902e95.js`
- `GC03059` (ruby, score=0.457) — query: *"Create a new software object."* — gold: `Omnibus.Software.manifest_entry_57a10081.rb`
- `GC03423` (ruby, score=0.369) — query: *"Create a new Activity object."* — gold: `Fit4Ruby.Activity.check_1839216e.rb`
- `GC03560` (ruby, score=0.507) — query: *"Instantiate new model"* — gold: `YoutubeDL.Video.download_607d3e4c.rb`

### #8  `ruby/noverde_exonio/Exonio.Financial.pmt_14802137.rb`

- path-kind: **normal**
- top1 count: 3, top3 count: 3
- languages: ruby
- distinct queries: 6, distinct gold files: 6

Representative misses:

- `GC03480` (ruby, score=0.440) — query: *"Calculates the payment on interest for an investment based on"* — gold: `Exonio.Financial.ipmt_414ff118.rb`
- `GC03481` (ruby, score=0.415) — query: *"Calculates the number of payment periods for an investment based on"* — gold: `Exonio.Financial.nper_3af2dd7a.rb`
- `GC03486` (ruby, score=0.434) — query: *"This method was borrowed from the NumPy rate formula"* — gold: `Exonio.Financial.newton_iter_6857bca6.rb`
- `GC03483` (ruby, score=0.430) — query: *"Calculates the interest rate of an annuity investment based on"* — gold: `Exonio.Financial.rate_26246813.rb`
- `GC03484` (ruby, score=0.481) — query: *"Calculates the net present value of an investment based on a"* — gold: `Exonio.Financial.npv_7911ded8.rb`

### #9  `javascript/moxiecode_moxie/func_16736602.js`

- path-kind: **normal**
- top1 count: 3, top3 count: 2
- languages: javascript, ruby
- distinct queries: 5, distinct gold files: 5

Representative misses:

- `GC01658` (javascript, score=0.524) — query: *"x and y coordinates for a dom element or mouse pointer"* — gold: `getPointerPosition_48d245d6.js`
- `GC01754` (javascript, score=0.577) — query: *"Returns the x, y cordinate for an element on IE 6 and IE 7"* — gold: `getIEPos_0de663fb.js`
- `GC03296` (ruby, score=0.377) — query: *"Returns x - y element-wise."* — gold: `TensorStream.OpStub.sub_1f34f708.rb`
- `GC01149` (javascript, score=0.418) — query: *"cross-browser utility functions"* — gold: `_getMouseOffset_2b2c6348.js`
- `GC01336` (javascript, score=0.369) — query: *"For IE8 and IE9."* — gold: `getTargetInstForInputEventPolyfill_2cb3761e.js`

### #10  `ruby/noverde_exonio/Exonio.Financial.nper_3af2dd7a.rb`

- path-kind: **normal**
- top1 count: 3, top3 count: 2
- languages: ruby
- distinct queries: 5, distinct gold files: 5

Representative misses:

- `GC03483` (ruby, score=0.430) — query: *"Calculates the interest rate of an annuity investment based on"* — gold: `Exonio.Financial.rate_26246813.rb`
- `GC03484` (ruby, score=0.492) — query: *"Calculates the net present value of an investment based on a"* — gold: `Exonio.Financial.npv_7911ded8.rb`
- `GC03485` (ruby, score=0.468) — query: *"Calculates the internal rate of return on an investment based on a"* — gold: `Exonio.Financial.irr_7e5fb3e2.rb`
- `GC03480` (ruby, score=0.414) — query: *"Calculates the payment on interest for an investment based on"* — gold: `Exonio.Financial.ipmt_414ff118.rb`
- `GC03486` (ruby, score=0.433) — query: *"This method was borrowed from the NumPy rate formula"* — gold: `Exonio.Financial.newton_iter_6857bca6.rb`
