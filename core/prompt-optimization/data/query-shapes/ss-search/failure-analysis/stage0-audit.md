# ss-search Stage 0 instrumentation audit

Generated: 2026-05-14T10:15:57.397Z

Dev golds graded (ast-tester only, agentic strategy): 90
- PASS:    51
- PARTIAL: 18
- FAIL:    21

## Fail-mode classification

| Mode | Count | % of FAILs |
|---|---|---|
| db_missing | 0 | 0.0% |
| file_not_indexed | 0 | 0.0% |
| no_chunk_overlapping_gold | 0 | 0.0% |
| chunk_overlaps_but_name_null | 3 | 14.3% |
| chunk_overlaps_but_name_mismatch | 3 | 14.3% |
| chunk_overlaps_with_correct_name | 15 | 71.4% |

## Top-1 file kind (when FAIL)

- code: 19
- doc: 2

## fileRecallAt5 on FAILs: 16/21 = 76.2%

## Per-FAIL detail

### CPP-002 (cpp/C-family, shape=V4)
- mode: **chunk_overlaps_with_correct_name**
- expected: `hwy/highway.h` :: `FunctionCache`
- gold range: 389-441
- chunks overlapping gold:
  - 389-441 name=FunctionCache type=struct
- top1: `hwy/targets.h` :: `hwy` (36-381, kind=code, score=0.313)
- fileRecallAt5: 1
- query: `How does FunctionCache's ChooseAndCall update the chosen target table?`

### CPP-004 (cpp/C-family, shape=V4)
- mode: **chunk_overlaps_but_name_mismatch**
- expected: `hwy/ops/generic_ops-inl.h` :: `Vec`
- gold range: 36-50
- chunks overlapping gold:
  - 36-50 name=hwy type=namespace
  - 37-51 name=HWY_NAMESPACE type=namespace
  - 37-91 name=LaneType type=typeAlias
- top1: `hwy/contrib/random/random-inl.h` :: `VectorXoshiro` (175-344, kind=code, score=0.770)
- fileRecallAt5: 0
- query: `How does the using Vec = decltype(Zero(D())) type alias deduce the vector type?`

### CS-003 (csharp/OO-monolithic, shape=V7)
- mode: **chunk_overlaps_with_correct_name**
- expected: `libs/server/StoreWrapper.cs` :: `WaitForCommitAsync`
- gold range: 479-528
- chunks overlapping gold:
  - 479-528 name=WaitForCommitAsync type=method
- top1: `libs/server/Databases/IDatabaseManager.cs` :: `TakeOnDemandCheckpointAsync` (119-285, kind=code, score=0.558)
- fileRecallAt5: 1
- query: `WaitForCommitAsync method that asynchronously waits for AOF commit completions from all databases`

### CS-008 (csharp/OO-monolithic, shape=V7)
- mode: **chunk_overlaps_with_correct_name**
- expected: `libs/storage/Tsavorite/cs/src/core/Device/AsyncPool.cs` :: `AsyncPool`
- gold range: 9-29
- chunks overlapping gold:
  - 9-29 name=Tsavorite.core type=namespace
  - 10-15 name=(null) type=code
  - 16-35 name=AsyncPool type=class
  - 16-16 name=(null) type=code
  - 17-95 name=AsyncPool type=method
- top1: `libs/client/ClientSession/AsyncPool.cs` :: `AsyncPool` (11-142, kind=code, score=0.672)
- fileRecallAt5: 1
- query: `Generic AsyncPool supporting synchronous and asynchronous get with IDisposable constraint`

### DR-006 (dart/JS-mobile, shape=V2)
- mode: **chunk_overlaps_with_correct_name**
- expected: `pkgs/http/lib/src/response.dart` :: `Response`
- gold range: 16-58
- chunks overlapping gold:
  - 16-58 name=Response type=class
  - 58-67 name=fromStream type=function
- top1: `pkgs/http/lib/src/request.dart` :: `Request` (15-210, kind=code, score=0.436)
- fileRecallAt5: 1
- query: `Where is Response bodyBytes defined?`

### JV-001 (java/OO-monolithic, shape=V7)
- mode: **chunk_overlaps_but_name_mismatch**
- expected: `gson/src/main/java/com/google/gson/GsonBuilder.java` :: `serializeNulls`
- gold range: 247-274
- chunks overlapping gold:
  - 247-274 name=excludeFieldsWithoutExposeAnnotation type=method
- top1: `gson/src/main/java/com/google/gson/LongSerializationPolicy.java` :: `LongSerializationPolicy` (21-83, kind=code, score=0.570)
- fileRecallAt5: 1
- query: `GsonBuilder's serializeNulls method that configures serialization of null fields in Gson`

### JV-004 (java/OO-monolithic, shape=V7)
- mode: **chunk_overlaps_but_name_mismatch**
- expected: `gson/src/main/java/com/google/gson/reflect/TypeToken.java` :: `getType`
- gold range: 121-168
- chunks overlapping gold:
  - 121-168 name=verifyNoTypeVariable type=method
- top1: `gson/src/main/java/com/google/gson/internal/bind/TypeAdapterRuntimeTypeWrapper.java` :: `TypeAdapterRuntimeTypeWrapper` (27-103, kind=code, score=0.518)
- fileRecallAt5: 0
- query: `Method getType that returns the underlying runtime Type instance`

### JV-005 (java/OO-monolithic, shape=V7)
- mode: **chunk_overlaps_with_correct_name**
- expected: `gson/src/main/java/com/google/gson/GsonBuilder.java` :: `registerTypeAdapter`
- gold range: 738-780
- chunks overlapping gold:
  - 738-780 name=registerTypeAdapter type=method
- top1: `gson/src/main/java/com/google/gson/InstanceCreator.java` :: `InstanceCreator` (50-93, kind=code, score=0.610)
- fileRecallAt5: 1
- query: `registerTypeAdapter method for custom JsonSerializer JsonDeserializer and InstanceCreator for a type`

### KT-004 (kotlin/OO-monolithic, shape=V7)
- mode: **chunk_overlaps_with_correct_name**
- expected: `kotlinx-coroutines-core/common/src/Builders.common.kt` :: `launch`
- gold range: 200-213
- chunks overlapping gold:
  - 200-213 name=launch type=function
- top1: `kotlinx-coroutines-core/common/src/CoroutineScope.kt` :: `coroutineScope` (812-850, kind=code, score=0.656)
- fileRecallAt5: 1
- query: `launch function on CoroutineScope that accepts a suspend block and returns a Job`

### PHP-008 (php/Scripting-dynamic, shape=V7)
- mode: **chunk_overlaps_with_correct_name**
- expected: `Slim/App.php` :: `__construct`
- gold range: 39-59
- chunks overlapping gold:
  - 39-59 name=App type=class
  - 39-39 name=(null) type=class
  - 40-106 name=__construct type=method
- top1: `Slim/Factory/AppFactory.php` :: `create` (48-70, kind=code, score=0.481)
- fileRecallAt5: 1
- query: `Slim App __construct with multiple nullable typed parameters and default values`

### PY-002 (python/Scripting-dynamic, shape=V7)
- mode: **chunk_overlaps_with_correct_name**
- expected: `src/click/core.py` :: `Context`
- gold range: 185-199
- chunks overlapping gold:
  - 185-199 name=Context type=class
  - 186-282 name=(null) type=code
- top1: `docs/complex.md` :: `Contexts` (31-49, kind=doc, score=0.505)
- fileRecallAt5: 1
- query: `Click Context that carries parent chain, shared object, and meta dict`

### RB-001 (ruby/Scripting-dynamic, shape=V7)
- mode: **chunk_overlaps_with_correct_name**
- expected: `lib/sinatra/base.rb` :: `Base`
- gold range: 971-994
- chunks overlapping gold:
  - 971-994 name=Base type=class
  - 972-1049 name=initialize type=method
- top1: `rack-protection/lib/rack/protection/base.rb` :: `Base` (11-145, kind=code, score=0.473)
- fileRecallAt5: 1
- query: `Sinatra::Base core class that owns route table and dispatch logic`

### RB-006 (ruby/Scripting-dynamic, shape=V7)
- mode: **chunk_overlaps_with_correct_name**
- expected: `lib/sinatra/base.rb` :: `Helpers`
- gold range: 286-302
- chunks overlapping gold:
  - 286-302 name=Helpers type=module
  - 286-287 name=(null) type=module
  - 288-346 name=status type=method
- top1: `sinatra-contrib/lib/sinatra/haml_helpers.rb` :: `Sinatra` (1-50, kind=code, score=0.529)
- fileRecallAt5: 0
- query: `Sinatra::Helpers module providing view and response helper methods to routes and filters`

### RS-003 (rust/Systems-modular-terse, shape=V7)
- mode: **chunk_overlaps_with_correct_name**
- expected: `crates/ruff_linter/src/checkers/ast/mod.rs` :: `Checker`
- gold range: 196-208
- chunks overlapping gold:
  - 196-208 name=Checker type=struct
  - 196-236 name=(null) type=code
- top1: `crates/ruff_linter/src/linter.rs` :: `check_path` (120-373, kind=code, score=0.488)
- fileRecallAt5: 1
- query: `Checker AST visitor state machine that accumulates lint diagnostics`

### RS-008 (rust/Systems-modular-terse, shape=V7)
- mode: **chunk_overlaps_with_correct_name**
- expected: `crates/ruff_linter/src/packaging.rs` :: `detect_package_root`
- gold range: 35-47
- chunks overlapping gold:
  - 35-47 name=detect_package_root type=function
- top1: `crates/ruff_workspace/src/resolver.rs` :: `detect_package_root_with_cache` (275-289, kind=code, score=0.594)
- fileRecallAt5: 1
- query: `The detect_package_root function that returns an Option of &Path from a given Path and namespace_packages`

### SC-004 (scala/OO-monolithic, shape=V7)
- mode: **chunk_overlaps_with_correct_name**
- expected: `requests/src/requests/Model.scala` :: `Response`
- gold range: 196-197
- chunks overlapping gold:
  - 196-197 name=Response type=class
- top1: `readme.md` :: `Response Content` (145-175, kind=doc, score=0.474)
- fileRecallAt5: 1
- query: `Response that includes url, status code, headers, and binary body data`

### TSL-004 (typescript-lib/JS-mobile, shape=V2)
- mode: **chunk_overlaps_but_name_null**
- expected: `packages/zod/src/v4/core/schemas.ts` :: `$ZodType`
- gold range: 167-188
- chunks overlapping gold:
  - 167-188 name=(null) type=code
- top1: `packages/zod/src/v3/types.ts` :: `ZodType` (158-535, kind=code, score=0.657)
- fileRecallAt5: 0
- query: `How does $ZodType define schema output?`

### TSL-006 (typescript-lib/JS-mobile, shape=V2)
- mode: **chunk_overlaps_but_name_null**
- expected: `packages/zod/src/v4/core/schemas.ts` :: `$ZodTypeInternals`
- gold range: 167-188
- chunks overlapping gold:
  - 167-188 name=(null) type=code
- top1: `packages/zod/src/v3/types.ts` :: `ZodType` (158-535, kind=code, score=0.509)
- fileRecallAt5: 1
- query: `How does $ZodTypeInternals define output/infer?`

### TSL-008 (typescript-lib/JS-mobile, shape=V2)
- mode: **chunk_overlaps_but_name_null**
- expected: `packages/zod/src/v4/core/schemas.ts` :: `$ZodType`
- gold range: 167-188
- chunks overlapping gold:
  - 167-188 name=(null) type=code
- top1: `packages/zod/src/v3/types.ts` :: `ZodType` (158-535, kind=code, score=0.532)
- fileRecallAt5: 0
- query: `What variance modifiers does $ZodType use?`

### ZG-001 (zig/C-family, shape=V4)
- mode: **chunk_overlaps_with_correct_name**
- expected: `src/request.zig` :: `Request`
- gold range: 22-83
- chunks overlapping gold:
  - 22-83 name=Request type=struct
- top1: `src/config.zig` :: `Request` (72-83, kind=code, score=0.633)
- fileRecallAt5: 1
- query: `How does the Request struct handle HTTP headers, body, and query params?`

### ZG-004 (zig/C-family, shape=V4)
- mode: **chunk_overlaps_with_correct_name**
- expected: `src/request.zig` :: `Request`
- gold range: 22-83
- chunks overlapping gold:
  - 22-83 name=Request type=struct
- top1: `src/config.zig` :: `Request` (72-83, kind=code, score=0.546)
- fileRecallAt5: 1
- query: `How does the httpz Request struct parse the querystring?`
