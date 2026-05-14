# ss-search Stage 1-2 best-shape filter + per-language failure rates

Generated: 2026-05-14T10:18:18.698Z

## Strategies
- agentic: V7 default; V2 for JS-mobile; V4 for C-family
- popular: V1 (≤3 tokens symbol-only)

## Strategy: agentic (dev only, ast-tester only)

Overall: PASS=51 PARTIAL=18 FAIL=21 / 90; file_recall@5 hits=85

### Per family

| family | n | PASS | PARTIAL | FAIL | fail_pct | file_recall@5 |
|---|---|---|---|---|---|---|
| OO-monolithic | 20 | 11 | 2 | 7 | 35.0% | 95.0% |
| C-family | 15 | 6 | 5 | 4 | 26.7% | 93.3% |
| JS-mobile | 20 | 12 | 4 | 4 | 20.0% | 90.0% |
| Systems-modular-terse | 10 | 5 | 3 | 2 | 20.0% | 100.0% |
| Scripting-dynamic | 25 | 17 | 4 | 4 | 16.0% | 96.0% |

### Per language (sorted by FAIL desc)

| language | family | PASS | PARTIAL | FAIL | file_recall@5 |
|---|---|---|---|---|---|
| java | OO-monolithic | 2 | 0 | 3 | 80.0% |
| typescript-lib | JS-mobile | 1 | 1 | 3 | 60.0% |
| cpp | C-family | 0 | 3 | 2 | 80.0% |
| csharp | OO-monolithic | 1 | 2 | 2 | 100.0% |
| ruby | Scripting-dynamic | 3 | 0 | 2 | 80.0% |
| rust | Systems-modular-terse | 2 | 1 | 2 | 100.0% |
| zig | C-family | 3 | 0 | 2 | 100.0% |
| dart | JS-mobile | 3 | 1 | 1 | 100.0% |
| kotlin | OO-monolithic | 4 | 0 | 1 | 100.0% |
| php | Scripting-dynamic | 4 | 0 | 1 | 100.0% |
| python | Scripting-dynamic | 2 | 2 | 1 | 100.0% |
| scala | OO-monolithic | 4 | 0 | 1 | 100.0% |
| c | C-family | 3 | 2 | 0 | 100.0% |
| elixir | Scripting-dynamic | 5 | 0 | 0 | 100.0% |
| go | Systems-modular-terse | 3 | 2 | 0 | 100.0% |
| javascript | JS-mobile | 5 | 0 | 0 | 100.0% |
| lua | Scripting-dynamic | 3 | 2 | 0 | 100.0% |
| typescript | JS-mobile | 3 | 2 | 0 | 100.0% |

## Strategy: popular (dev only, ast-tester only)

Overall: PASS=48 PARTIAL=15 FAIL=27 / 90; file_recall@5 hits=78

### Per family

| family | n | PASS | PARTIAL | FAIL | fail_pct | file_recall@5 |
|---|---|---|---|---|---|---|
| C-family | 15 | 4 | 5 | 6 | 40.0% | 86.7% |
| OO-monolithic | 20 | 10 | 2 | 8 | 40.0% | 85.0% |
| Systems-modular-terse | 10 | 6 | 1 | 3 | 30.0% | 90.0% |
| Scripting-dynamic | 25 | 13 | 6 | 6 | 24.0% | 88.0% |
| JS-mobile | 20 | 15 | 1 | 4 | 20.0% | 85.0% |

### Per language (sorted by FAIL desc)

| language | family | PASS | PARTIAL | FAIL | file_recall@5 |
|---|---|---|---|---|---|
| csharp | OO-monolithic | 1 | 1 | 3 | 80.0% |
| java | OO-monolithic | 1 | 1 | 3 | 80.0% |
| typescript-lib | JS-mobile | 2 | 0 | 3 | 40.0% |
| c | C-family | 2 | 1 | 2 | 80.0% |
| cpp | C-family | 0 | 3 | 2 | 80.0% |
| go | Systems-modular-terse | 2 | 1 | 2 | 80.0% |
| php | Scripting-dynamic | 3 | 0 | 2 | 80.0% |
| python | Scripting-dynamic | 2 | 1 | 2 | 80.0% |
| zig | C-family | 2 | 1 | 2 | 100.0% |
| dart | JS-mobile | 4 | 0 | 1 | 100.0% |
| elixir | Scripting-dynamic | 2 | 2 | 1 | 80.0% |
| kotlin | OO-monolithic | 4 | 0 | 1 | 80.0% |
| ruby | Scripting-dynamic | 3 | 1 | 1 | 100.0% |
| rust | Systems-modular-terse | 4 | 0 | 1 | 100.0% |
| scala | OO-monolithic | 4 | 0 | 1 | 100.0% |
| javascript | JS-mobile | 5 | 0 | 0 | 100.0% |
| lua | Scripting-dynamic | 3 | 2 | 0 | 100.0% |
| typescript | JS-mobile | 4 | 1 | 0 | 100.0% |

## Cross-strategy: V7-FAIL vs V1-PASS hypothesis

Cross-tabulation (dev only). Rows = agentic verdict, columns = popular verdict.

| agentic\popular | PASS | PARTIAL | FAIL |
|---|---|---|---|
| PASS | 41 | 3 | 7 |
| PARTIAL | 2 | 9 | 7 |
| FAIL | 5 | 3 | 13 |

agentic-FAIL distribution under popular: {"PASS":5,"PARTIAL":3,"FAIL":13}

### Agentic-FAIL but popular(V1)-PASS — 5 cases

- **DR-006** (dart/JS-mobile)
  - agentic(V2): `pkgs/http/lib/src/request.dart` :: `Request` (query: Where is Response bodyBytes defined?)
  - popular(V1): `pkgs/http/lib/src/response.dart` :: `Response` (query: Find Response statusCode)
- **JV-001** (java/OO-monolithic)
  - agentic(V7): `gson/src/main/java/com/google/gson/LongSerializationPolicy.java` :: `LongSerializationPolicy` (query: GsonBuilder's serializeNulls method that configures serialization of null fields)
  - popular(V1): `gson/src/main/java/com/google/gson/GsonBuilder.java` :: `serializeNulls` (query: find serializeNulls method)
- **RB-006** (ruby/Scripting-dynamic)
  - agentic(V7): `sinatra-contrib/lib/sinatra/haml_helpers.rb` :: `Sinatra` (query: Sinatra::Helpers module providing view and response helper methods to routes and)
  - popular(V1): `lib/sinatra/base.rb` :: `Helpers` (query: review Helpers module)
- **RS-003** (rust/Systems-modular-terse)
  - agentic(V7): `crates/ruff_linter/src/linter.rs` :: `check_path` (query: Checker AST visitor state machine that accumulates lint diagnostics)
  - popular(V1): `crates/ruff_linter/src/checkers/ast/mod.rs` :: `Checker` (query: find Checker struct)
- **TSL-006** (typescript-lib/JS-mobile)
  - agentic(V2): `packages/zod/src/v3/types.ts` :: `ZodType` (query: How does $ZodTypeInternals define output/infer?)
  - popular(V1): `packages/zod/src/v4/core/schemas.ts` :: `$ZodTypeInternals` (query: show $ZodTypeInternals)