# ss-search Stage 3 top-5 deep dive

Generated: 2026-05-14T10:30:00.175Z
21 dev FAILs re-queried under their agentic winning shape.

## RS-003 (rust/Systems-modular-terse, shape=V7)
- query: `Checker AST visitor state machine that accumulates lint diagnostics`
- expected: `crates/ruff_linter/src/checkers/ast/mod.rs` :: `Checker` (gold range 196-208)
- expectedFileRank: 3; expectedSymbolRank: 3
- top-5:
  1. `crates/ruff_linter/src/linter.rs` :: `check_path` lines 120-373 score=0.488 path=
  2. `crates/ruff_linter/src/linter.rs` :: `is_empty` lines 88-90 score=0.424 path=
  3. `crates/ruff_linter/src/checkers/ast/mod.rs` :: `Checker` lines 196-253 score=0.486 path=
  4. `crates/ruff_linter/src/checkers/ast/mod.rs` :: `LintContext` lines 3403-3412 score=0.478 path=
  5. `crates/ruff_linter/src/checkers/ast/mod.rs` :: `check_ast` lines 3313-3401 score=0.474 path=

## RS-008 (rust/Systems-modular-terse, shape=V7)
- query: `The detect_package_root function that returns an Option of &Path from a given Path and namespace_packages`
- expected: `crates/ruff_linter/src/packaging.rs` :: `detect_package_root` (gold range 35-47)
- expectedFileRank: 3; expectedSymbolRank: never
- top-5:
  1. `crates/ruff_workspace/src/resolver.rs` :: `detect_package_root_with_cache` lines 275-289 score=0.594 path=
  2. `crates/ruff_workspace/src/resolver.rs` :: `package_roots` lines 200-266 score=0.522 path=
  3. `crates/ruff_linter/src/packaging.rs` :: `is_package` lines 1-33 score=0.510 path=
  4. `crates/ruff_workspace/src/resolver.rs` :: `package_roots` lines 200-266 score=0.479 path=
  5. `crates/ruff_workspace/src/resolver.rs` :: `package_roots` lines 200-266 score=0.461 path=

## KT-004 (kotlin/OO-monolithic, shape=V7)
- query: `launch function on CoroutineScope that accepts a suspend block and returns a Job`
- expected: `kotlinx-coroutines-core/common/src/Builders.common.kt` :: `launch` (gold range 200-213)
- expectedFileRank: 5; expectedSymbolRank: 5
- top-5:
  1. `kotlinx-coroutines-core/common/src/CoroutineScope.kt` :: `coroutineScope` lines 812-850 score=0.799 path=
  2. `kotlinx-coroutines-core/common/src/CoroutineScope.kt` :: `CoroutineScope` lines 1090-1092 score=0.734 path=
  3. `kotlinx-coroutines-core/common/src/CoroutineScope.kt` :: `CoroutineScope` lines 437-471 score=0.634 path=
  4. `kotlinx-coroutines-core/common/src/Guidance.kt` :: `launch` lines 179-188 score=0.637 path=
  5. `kotlinx-coroutines-core/common/src/Builders.common.kt` :: `launch` lines 200-213 score=0.630 path=

## CS-003 (csharp/OO-monolithic, shape=V7)
- query: `WaitForCommitAsync method that asynchronously waits for AOF commit completions from all databases`
- expected: `libs/server/StoreWrapper.cs` :: `WaitForCommitAsync` (gold range 479-528)
- expectedFileRank: 1; expectedSymbolRank: 1
- top-5:
  1. `libs/server/StoreWrapper.cs` :: `WaitForCommitAsync` lines 31-975 score=0.592 path=
  2. `libs/server/Databases/IDatabaseManager.cs` :: `TakeOnDemandCheckpointAsync` lines 125-285 score=0.558 path=
  3. `libs/server/Databases/SingleDatabaseManager.cs` :: `SingleDatabaseManager` lines 17-446 score=0.521 path=
  4. `libs/storage/Tsavorite/cs/src/core/TsavoriteLog/TsavoriteLog.cs` :: `WaitForCommitAsync` lines 21-3154 score=0.511 path=
  5. `libs/storage/Tsavorite/cs/src/core/TsavoriteLog/TsavoriteLog.cs` :: `WaitForCommitAsync` lines 21-3154 score=0.470 path=

## CS-008 (csharp/OO-monolithic, shape=V7)
- query: `Generic AsyncPool supporting synchronous and asynchronous get with IDisposable constraint`
- expected: `libs/storage/Tsavorite/cs/src/core/Device/AsyncPool.cs` :: `AsyncPool` (gold range 9-29)
- expectedFileRank: 2; expectedSymbolRank: 2
- top-5:
  1. `libs/client/ClientSession/AsyncPool.cs` :: `AsyncPool` lines 11-142 score=0.819 path=
  2. `libs/storage/Tsavorite/cs/src/core/Device/AsyncPool.cs` :: `AsyncPool` lines 11-142 score=0.806 path=
  3. `libs/client/ClientSession/AsyncPool.cs` :: `AsyncPool` lines 16-142 score=0.790 path=
  4. `libs/client/ClientSession/AsyncPool.cs` :: `AsyncPool` lines 16-142 score=0.770 path=
  5. `libs/storage/Tsavorite/cs/src/core/Device/AsyncPool.cs` :: `AsyncPool` lines 16-142 score=0.769 path=

## CPP-002 (cpp/C-family, shape=V4)
- query: `How does FunctionCache's ChooseAndCall update the chosen target table?`
- expected: `hwy/highway.h` :: `FunctionCache` (gold range 389-441)
- expectedFileRank: 1; expectedSymbolRank: never
- top-5:
  1. `hwy/highway.h` :: `ChooseAndCall` lines 38-664 score=0.434 path=
  2. `hwy/highway.h` :: `ChooseAndCall` lines 38-664 score=0.377 path=
  3. `hwy/targets.h` :: `hwy` lines 36-381 score=0.313 path=

## CPP-004 (cpp/C-family, shape=V4)
- query: `How does the using Vec = decltype(Zero(D())) type alias deduce the vector type?`
- expected: `hwy/ops/generic_ops-inl.h` :: `Vec` (gold range 36-50)
- expectedFileRank: >5; expectedSymbolRank: never
- top-5:
  1. `hwy/contrib/random/random-inl.h` :: `VectorXoshiro` lines 175-344 score=0.770 path=
  2. `hwy/aligned_allocator.h` :: `AlignedVector` lines 204-204 score=0.649 path=
  3. `hwy/ops/arm_neon-inl.h` :: `Vec128` lines 807-846 score=0.616 path=
  4. `hwy/ops/loongarch_lsx-inl.h` :: `RawMask` lines 2956-2956 score=0.616 path=
  5. `hwy/print.h` :: `TypeInfo` lines 33-38 score=0.616 path=

## JV-001 (java/OO-monolithic, shape=V7)
- query: `GsonBuilder's serializeNulls method that configures serialization of null fields in Gson`
- expected: `gson/src/main/java/com/google/gson/GsonBuilder.java` :: `serializeNulls` (gold range 247-274)
- expectedFileRank: 1; expectedSymbolRank: never
- top-5:
  1. `gson/src/main/java/com/google/gson/GsonBuilder.java` :: `GsonBuilder` lines 92-1076 score=0.952 path=
  2. `gson/src/main/java/com/google/gson/GsonBuilder.java` :: `GsonBuilder` lines 92-1076 score=0.650 path=
  3. `gson/src/main/java/com/google/gson/GsonBuilder.java` :: `GsonBuilder` lines 92-1076 score=0.597 path=
  4. `gson/src/main/java/com/google/gson/LongSerializationPolicy.java` :: `LongSerializationPolicy` lines 28-83 score=0.570 path=
  5. `gson/src/main/java/com/google/gson/internal/bind/ReflectiveTypeAdapterFactory.java` :: `Adapter` lines 474-541 score=0.569 path=

## JV-004 (java/OO-monolithic, shape=V7)
- query: `Method getType that returns the underlying runtime Type instance`
- expected: `gson/src/main/java/com/google/gson/reflect/TypeToken.java` :: `getType` (gold range 121-168)
- expectedFileRank: >5; expectedSymbolRank: never
- top-5:
  1. `extras/src/main/java/com/google/gson/typeadapters/RuntimeTypeAdapterFactory.java` :: `RuntimeTypeAdapterFactory` lines 158-331 score=0.554 path=
  2. `gson/src/main/java/com/google/gson/internal/bind/TypeAdapterRuntimeTypeWrapper.java` :: `TypeAdapterRuntimeTypeWrapper` lines 27-103 score=0.518 path=
  3. `gson/src/main/java/com/google/gson/internal/bind/TypeAdapterRuntimeTypeWrapper.java` :: `TypeAdapterRuntimeTypeWrapper` lines 27-103 score=0.517 path=
  4. `gson/src/main/java/com/google/gson/internal/bind/TypeAdapterRuntimeTypeWrapper.java` :: `TypeAdapterRuntimeTypeWrapper` lines 27-103 score=0.510 path=
  5. `gson/src/main/java/com/google/gson/internal/bind/TypeAdapterRuntimeTypeWrapper.java` :: `TypeAdapterRuntimeTypeWrapper` lines 27-103 score=0.500 path=

## JV-005 (java/OO-monolithic, shape=V7)
- query: `registerTypeAdapter method for custom JsonSerializer JsonDeserializer and InstanceCreator for a type`
- expected: `gson/src/main/java/com/google/gson/GsonBuilder.java` :: `registerTypeAdapter` (gold range 738-780)
- expectedFileRank: 3; expectedSymbolRank: 3
- top-5:
  1. `gson/src/main/java/com/google/gson/InstanceCreator.java` :: `InstanceCreator` lines 50-93 score=0.743 path=
  2. `gson/src/main/java/com/google/gson/JsonDeserializer.java` :: `JsonDeserializer` lines 46-95 score=0.723 path=
  3. `gson/src/main/java/com/google/gson/GsonBuilder.java` :: `registerTypeAdapter` lines 92-1076 score=0.672 path=
  4. `gson/src/main/java/com/google/gson/JsonSerializer.java` :: `JsonSerializer` lines 74-91 score=0.652 path=
  5. `gson/src/main/java/com/google/gson/internal/bind/JsonAdapterAnnotationTypeAdapterFactory.java` :: `JsonAdapterAnnotationTypeAdapterFactory` lines 37-204 score=0.571 path=

## PY-002 (python/Scripting-dynamic, shape=V7)
- query: `Click Context that carries parent chain, shared object, and meta dict`
- expected: `src/click/core.py` :: `Context` (gold range 185-199)
- expectedFileRank: >5; expectedSymbolRank: never
- top-5:
  1. `docs/complex.md` :: `Contexts` lines 31-49 score=0.505 path=
  2. `docs/complex.md` :: `The Root Command` lines 70-114 score=0.425 path=
  3. `docs/complex.md` :: `The First Child Command` lines 115-142 score=0.397 path=
  4. `docs/commands.md` :: `Nested Handling and Contexts` lines 48-98 score=0.434 path=
  5. `docs/api.md` :: `Context` lines 185-203 score=0.431 path=

## RB-001 (ruby/Scripting-dynamic, shape=V7)
- query: `Sinatra::Base core class that owns route table and dispatch logic`
- expected: `lib/sinatra/base.rb` :: `Base` (gold range 971-994)
- expectedFileRank: 3; expectedSymbolRank: 3
- top-5:
  1. `rack-protection/lib/rack/protection/base.rb` :: `Base` lines 11-145 score=0.473 path=
  2. `sinatra-contrib/lib/sinatra/contrib.rb` :: `Sinatra` lines 1-42 score=0.449 path=
  3. `lib/sinatra/base.rb` :: `Base` lines 971-2076 score=0.438 path=
  4. `lib/sinatra/base.rb` :: `Base` lines 971-2076 score=0.438 path=
  5. `sinatra-contrib/lib/sinatra/contrib/setup.rb` :: `Sinatra` lines 1-53 score=0.427 path=

## RB-006 (ruby/Scripting-dynamic, shape=V7)
- query: `Sinatra::Helpers module providing view and response helper methods to routes and filters`
- expected: `lib/sinatra/base.rb` :: `Helpers` (gold range 286-302)
- expectedFileRank: 3; expectedSymbolRank: 3
- top-5:
  1. `sinatra-contrib/lib/sinatra/respond_with.rb` :: `Helpers` lines 133-199 score=0.530 path=
  2. `sinatra-contrib/lib/sinatra/haml_helpers.rb` :: `Sinatra` lines 1-50 score=0.529 path=
  3. `lib/sinatra/base.rb` :: `Helpers` lines 286-722 score=0.527 path=
  4. `lib/sinatra/base.rb` :: `delete` lines 1543-1543 score=0.497 path=
  5. `sinatra-contrib/lib/sinatra/contrib.rb` :: `Sinatra` lines 1-42 score=0.487 path=

## PHP-008 (php/Scripting-dynamic, shape=V7)
- query: `Slim App __construct with multiple nullable typed parameters and default values`
- expected: `Slim/App.php` :: `__construct` (gold range 39-59)
- expectedFileRank: 1; expectedSymbolRank: never
- top-5:
  1. `Slim/App.php` :: `App` lines 34-226 score=0.654 path=
  2. `Slim/Exception/HttpException.php` :: `HttpException` lines 1-65 score=0.572 path=
  3. `Slim/App.php` :: `addRoutingMiddleware` lines 125-133 score=0.447 path=
  4. `Slim/Factory/AppFactory.php` :: `Slim\Factory` lines 1-27 score=0.427 path=
  5. `Slim/App.php` :: `Slim` lines 1-38 score=0.414 path=

## TSL-004 (typescript-lib/JS-mobile, shape=V2)
- query: `How does $ZodType define schema output?`
- expected: `packages/zod/src/v4/core/schemas.ts` :: `$ZodType` (gold range 167-188)
- expectedFileRank: >5; expectedSymbolRank: never
- top-5:
  1. `packages/zod/src/v3/types.ts` :: `ZodType` lines 158-535 score=0.800 path=
  2. `packages/zod/src/v4/classic/schemas.ts` :: `ZodType` lines 78-210 score=0.676 path=
  3. `packages/zod/src/v3/types.ts` :: `_parseSync` lines 210-216 score=0.466 path=
  4. `packages/zod/src/v4/classic/schemas.ts` :: `string` lines 569-571 score=0.451 path=
  5. `packages/zod/src/v4/core/api.ts` :: `_string` lines 63-71 score=0.420 path=

## TSL-006 (typescript-lib/JS-mobile, shape=V2)
- query: `How does $ZodTypeInternals define output/infer?`
- expected: `packages/zod/src/v4/core/schemas.ts` :: `$ZodTypeInternals` (gold range 167-188)
- expectedFileRank: 2; expectedSymbolRank: 2
- top-5:
  1. `packages/zod/src/v3/types.ts` :: `ZodType` lines 158-535 score=0.509 path=
  2. `packages/zod/src/v4/core/schemas.ts` :: `$ZodTypeInternals` lines 167-188 score=0.470 path=
  3. `packages/zod/src/v4/core/schemas.ts` :: `$ZodFunction` lines 4388-4421 score=0.425 path=
  4. `packages/zod/src/v4/core/schemas.ts` :: `$ZodFunctionArgs` lines 4349-4386 score=0.423 path=
  5. `packages/zod/src/v4/core/schemas.ts` :: `OptionalOutSchema` lines 1683-1734 score=0.396 path=

## TSL-008 (typescript-lib/JS-mobile, shape=V2)
- query: `What variance modifiers does $ZodType use?`
- expected: `packages/zod/src/v4/core/schemas.ts` :: `$ZodType` (gold range 167-188)
- expectedFileRank: >5; expectedSymbolRank: never
- top-5:
  1. `packages/zod/src/v3/types.ts` :: `ZodType` lines 158-535 score=0.647 path=
  2. `packages/zod/src/v3/types.ts` :: `ZodDate` lines 1877-1996 score=0.415 path=
  3. `packages/zod/src/v3/types.ts` :: `ZodFunction` lines 3817-3960 score=0.400 path=
  4. `packages/zod/src/v4/classic/schemas.ts` :: `ZodType` lines 78-210 score=0.506 path=
  5. `packages/zod/src/v3/types.ts` :: `_parseSync` lines 210-216 score=0.369 path=

## DR-006 (dart/JS-mobile, shape=V2)
- query: `Where is Response bodyBytes defined?`
- expected: `pkgs/http/lib/src/response.dart` :: `Response` (gold range 16-58)
- expectedFileRank: 4; expectedSymbolRank: 4
- top-5:
  1. `pkgs/http/lib/src/request.dart` :: `bodyBytes` lines 15-210 score=0.610 path=
  2. `pkgs/http/lib/src/request.dart` :: `Request` lines 16-210 score=0.550 path=
  3. `pkgs/http/lib/src/request.dart` :: `bodyBytes` lines 16-210 score=0.443 path=
  4. `pkgs/http/lib/src/response.dart` :: `Response` lines 16-67 score=0.351 path=
  5. `pkgs/http/lib/src/response.dart` :: `Response` lines 16-67 score=0.351 path=

## SC-004 (scala/OO-monolithic, shape=V7)
- query: `Response that includes url, status code, headers, and binary body data`
- expected: `requests/src/requests/Model.scala` :: `Response` (gold range 196-197)
- expectedFileRank: 4; expectedSymbolRank: 4
- top-5:
  1. `readme.md` :: `Response Content` lines 145-175 score=0.474 path=
  2. `readme.md` :: `0.1.6` lines 816-821 score=0.409 path=
  3. `readme.md` :: `0.6.5` lines 769-777 score=0.365 path=
  4. `requests/src/requests/Model.scala` :: `Response` lines 196-238 score=0.446 path=
  5. `requests/src/requests/Requester.scala` :: `readBytesThrough` lines 292-518 score=0.438 path=

## ZG-001 (zig/C-family, shape=V4)
- query: `How does the Request struct handle HTTP headers, body, and query params?`
- expected: `src/request.zig` :: `Request` (gold range 22-83)
- expectedFileRank: 2; expectedSymbolRank: 2
- top-5:
  1. `src/config.zig` :: `Request` lines 72-83 score=0.633 path=
  2. `src/request.zig` :: `Request` lines 22-576 score=0.557 path=
  3. `src/request.zig` :: `Request` lines 22-576 score=0.556 path=
  4. `src/request.zig` :: `Request` lines 22-576 score=0.535 path=
  5. `src/request.zig` :: `Request` lines 22-576 score=0.500 path=

## ZG-004 (zig/C-family, shape=V4)
- query: `How does the httpz Request struct parse the querystring?`
- expected: `src/request.zig` :: `Request` (gold range 22-83)
- expectedFileRank: 3; expectedSymbolRank: 3
- top-5:
  1. `src/config.zig` :: `Request` lines 72-83 score=0.546 path=
  2. `src/t.zig` :: `Context` lines 36-341 score=0.501 path=
  3. `src/request.zig` :: `Request` lines 22-576 score=0.487 path=
  4. `src/testing.zig` :: `Testing` lines 44-240 score=0.475 path=
  5. `src/httpz.zig` :: `Executor` lines 613-647 score=0.439 path=
