# C# Probe Failure Diagnostics — 2026-05-10

**Summary:** 1/8 PASS, 3/8 PARTIAL, 4/8 FAIL. Five distinct failure modes identified.

---

## Per-Probe Analysis

### CS-001 — FAIL: Cross-direction confusion (server SET handler)

- **Expected:** `libs/server/Resp/BasicCommands.cs` :: `NetworkSET` (method)
- **Got:** `libs/client/GarnetClientAPI/GarnetClientBasicRespCommands.cs` :: `StringSet` (method), score 0.595

**Root cause: Client-vs-server confusion.** The query "how does garnet handle the SET command for string keys" contains no direction signal. Both `NetworkSET` (server, private method called by the RESP dispatch switch) and `StringSet` (client, public async Task<bool>) implement SET. The client method has a higher-BM25 surface: `StringSetAsync`, `ExecuteForStringResultAsync`, direct `SET` constant usage, all in a file dedicated to SET/GET/DEL. The server handler is `private bool NetworkSET` — the name looks less like "handle SET" to a bag-of-words ranker.

**Compounding factor:** `BasicCommands.cs` is a massive partial-class shard (~660 lines) containing dozens of network methods; the client file is entirely SET-focused, giving stronger token density.

**Gold in top-20?** The gold symbol `NetworkSET` is confirmed present in `BasicCommands.cs` at line 282. This is a ranking failure, not a chunker miss. The chunker correctly emits `NetworkSET` as a method symbol.

**Failure mode:** Cross-direction confusion + token-density advantage in client file.

---

### CS-002 — FAIL: Metadata file over-ranks dispatcher (RESP dispatch)

- **Expected:** `libs/server/Resp/RespServerSession.cs` :: `RespServerSession` (class)
- **Got:** `libs/server/Resp/RespCommandsInfo.cs` :: `RespCommandsInfo` (class, lines 20–479), score 0.463

**Root cause: `RespCommandsInfo.cs` is a large, information-dense metadata class** (479 lines) that holds `RespCommand` enum mappings, dispatch tables, command name dictionaries, init-only properties (`Command`, `Name`, `Flags`, `AclCategories`, etc.), and registry lookup methods (`TryGetRespCommandInfo`, `TryGetRespCommandsInfo`). The query "where does garnet dispatch RESP commands to their handler methods" hits multiple high-weight tokens: `RESP`, `commands`, `handler`. `RespCommandsInfo` contains the word "commands" in every method name and a `FlattenedRespCommandsInfo` dictionary that looks like a dispatch table to the ranker.

The actual dispatcher `RespServerSession.cs` has the switch expression `RespCommand.SET => NetworkSET(...)`, but the switch is buried 769 lines into a large partial-class file (~1800 lines total); the chunk returned would be the class header (lines ~1–50), not the switch. The ranker therefore sees the class doc-comment and partial-class declaration — less lexically relevant than the methods in `RespCommandsInfo.cs`.

**Failure mode:** Documentation/metadata class with high command-token density over-ranks the impl class. This is the primary doc-demotion validation case.

---

### CS-003 — FAIL: Adjacent method over-ranking (AOF commit)

- **Expected:** `libs/server/StoreWrapper.cs` :: `WaitForCommitAsync` (method)
- **Got:** `libs/server/Databases/DatabaseManagerBase.cs` :: `CompactionCommitAof` (method, lines 596–614), score 0.469

**Root cause: Adjacent AOF method in sibling file.** `CompactionCommitAof` (DatabaseManagerBase, line 596) calls `db.AppendOnlyFile?.Commit()` and has "AOF" in its name — a direct token match. The gold target `WaitForCommitAsync` in `StoreWrapper.cs` (line 479) calls `databaseManager.WaitForCommitToAofAsync(token)` — the primary AOF commit wait-loop. The query "persist AOF log entries and wait for commit" hits `CompactionCommitAof` strongly via "AOF" + "Commit" token exact match, whereas `WaitForCommitAsync` contains "WaitForCommit" as a compound identifier that decomposes differently.

**Secondary factor:** `DatabaseManagerBase` also defines `CommitToAofAsync`, `WaitForCommitToAofAsync`, `EnqueueCommit` as abstract methods (lines 56–96), making the file extremely dense with AOF-commit vocabulary. `StoreWrapper.cs` is the consumer, not the definition site.

**Failure mode:** Adjacent-method over-ranking (sibling file with higher AOF term density).

---

### CS-004 — FAIL: Metadata over-ranking + identical property name (init-only property)

- **Expected:** `libs/server/Resp/RespCommandDocs.cs` :: `Command` (property)
- **Got:** `libs/server/Resp/RespCommandsInfo.cs` :: `RespCommandsInfo` (class header chunk, lines 20–479), score 0.623

**Root cause: Both files have `public RespCommand Command { get; init; }` at line 22–23**, and the query explicitly names "RespCommandDocs". Despite the filename token in the query, `RespCommandsInfo.cs` outranks. The reasons:

1. `RespCommandsInfo.cs` is 479 lines (large file → larger chunk → more tokens overall → higher BM25 document length advantage when TF is similar).
2. The query token "RespCommandDocs" does not appear inside `RespCommandsInfo.cs`, but the ranker has enough other signal (`Command`, `init`, `property`, `RespCommand`) to still prefer the larger, higher-density file.
3. The chunk returned (lines 20–479, class header) includes the string `Command { get; init; }` at line 23 — so `RespCommandsInfo` technically has the target property too, just not as the gold-specified file.

**Compounding factor:** Same `Command` property exists in both files (both implement `IRespCommandData<T>`). The C# grammar correctly emits `Command` as a property symbol in each; the ranker just prefers the larger class.

**Failure mode:** Sibling-class collision (both classes implement the same interface → same property name in both) + metadata file size advantage.

---

### CS-005 — PARTIAL: Chunker parse error on positional record syntax

- **Expected:** `libs/server/Lua/LuaRunner.Loader.cs` :: `LoaderBlockCache` (record)
- **Got:** same file, lines 361–517, **symbol=`is`, symbolType=`struct`**, score 0.684

**Root cause: Chunker misparse of `is` pattern-match keyword as struct identifier.**

The actual `LoaderBlockCache` record is defined at line 20:
```csharp
private sealed record LoaderBlockCache(HashSet<string> AllowedFunctions, ReadOnlyMemory<byte> LoaderBlockBytes);
```

That is a one-liner at the top of a partial-class shard. The returned chunk starts at line 361 — which is the middle of a method containing code like:
```csharp
var cache = CachedLoaderBlock;
if (cache != null && ReferenceEquals(cache.AllowedFunctions, allowedFunctions))
```

The `is` symbol returned (type=struct) is almost certainly the C# pattern-match `is` keyword appearing in a guard expression around that region. The C# grammar rule for structs likely fires on `record struct` or an inline pattern-match `is StructType` expression. This is a **tree-sitter grammar false-positive**: the C# grammar extracts `is` from an `is_pattern_expression` or a similar node and misclassifies it as a struct type declaration.

The gold chunk itself (around line 20) is in the file but the chunk at line 361 outranks it, suggesting either: (a) the record on line 20 is not emitted as a distinct chunk because it is a one-liner inside a class body, or (b) the line-20 chunk is emitted but scored lower than the line-361 chunk which has more LuaRunner-related vocabulary matching the query.

**Failure mode:** Chunker grammar bug — `is` keyword extracted as struct symbol from pattern-matching expression. Positional record on line 20 may also be unchunked if it is too short for a standalone chunk.

---

### CS-006 — PARTIAL: Correct file, wrong overload (IAsyncEnumerable)

- **Expected:** `TsavoriteLogIterator.cs` :: `GetAsyncEnumerable` (method)
- **Got:** same file, lines 144–164, **symbol=`WaitAsync`**, score 0.598

**Root cause: `WaitAsync` chunk outranks `GetAsyncEnumerable` chunk within the same file.**

`GetAsyncEnumerable` is at lines 66–82 (first overload) and 88–103 (second overload). `WaitAsync` is at lines 148–164. The query "GetAsyncEnumerable method" is explicit, so this is a within-file symbol disambiguation failure.

`WaitAsync` is **called from inside `GetAsyncEnumerable`** (`if (!await WaitAsync(token).ConfigureAwait(false))`), so both symbols appear in the same region. The `WaitAsync` chunk at 144–164 is also a stand-alone short method (20 lines) with `async`/`await` vocabulary and the word `WaitAsync` as both name and content, whereas the `GetAsyncEnumerable` chunk at 66–82 has `IAsyncEnumerable` as the primary token — a type-system token that may embed differently from the query token `GetAsyncEnumerable`.

**Failure mode:** Within-file symbol disambiguation — BM25 token overlap with adjacent method (`WaitAsync`) outranks the exact-symbol-name match (`GetAsyncEnumerable`). Possible encoder representation gap between `IAsyncEnumerable` (type) and the method name token.

---

### CS-007 — PARTIAL: Partial-class shard returns class header not method symbol

- **Expected:** `libs/server/Resp/AsyncProcessor.cs` :: `AsyncGetProcessorAsync` (method)
- **Got:** same file, lines 12–144, **symbol=`RespServerSession`, symbolType=class**, score 0.766

**Root cause: The chunker emits the file as a single chunk anchored on the class header `RespServerSession`, not split into per-method chunks.**

`AsyncProcessor.cs` is 144 lines. The class header is at line 15:
```csharp
internal sealed partial class RespServerSession : ServerSessionBase
```

The method `AsyncGetProcessorAsync` starts at line 79. The chunk covers lines 12–144, encompassing both the class declaration and the entire method. The reported symbol is `RespServerSession` (the outermost C# declaration), not `AsyncGetProcessorAsync`.

This confirms the issue: for partial-class shards, the C# grammar extractor anchors the chunk on the `class` node (line 15) and captures the whole file as a single class-level chunk. The method `AsyncGetProcessorAsync` is inside that chunk but is not extracted as a separate symbol because either (a) the chunk-size budget is not exceeded so no sub-chunking occurs, or (b) method-level extraction is only triggered when a method is the top-level or a distinct class-body member in a non-partial context.

**Consequence:** The file match is correct (PARTIAL), but the symbol returned is the class header — any query asking for a specific method in a small partial-class shard will always return the class symbol.

**Failure mode:** Partial-class shard symbol extraction — method-level symbols in small shard files are subsumed by the class-header chunk.

---

## Cluster Summary

| ID | Verdict | Failure Mode | Fix Tier |
|----|---------|-------------|----------|
| CS-001 | FAIL | Cross-direction confusion: client `StringSet` beats server `NetworkSET` | Ranker |
| CS-002 | FAIL | Metadata/registry class (`RespCommandsInfo`) over-ranks dispatcher | Doc-demotion |
| CS-003 | FAIL | Adjacent AOF method in sibling file beats correct async wait method | Ranker |
| CS-004 | FAIL | Same property in both `RespCommandsInfo` + `RespCommandDocs`; larger file wins | Doc-demotion + tie-break |
| CS-005 | PARTIAL | Chunker grammar bug: `is` keyword extracted as `struct` symbol | Chunker/grammar |
| CS-006 | PARTIAL | Within-file: `WaitAsync` (adjacent) beats `GetAsyncEnumerable` (queried) | Ranker |
| CS-007 | PARTIAL | Partial-class shard: class header chunk subsumes method-level symbol | Chunker |
| CS-008 | PASS | — | — |

---

## Top Findings

### Finding 1 (HIGH PRIORITY): `RespCommandsInfo.cs` is a persistent metadata magnet (CS-002, CS-004)

`RespCommandsInfo.cs` (479 lines, 22 init-only properties, 10 lookup methods, all containing "RespCommand" and "command" tokens) ranks at top-1 for two structurally different queries. Both queries contain RESP/command vocabulary that this file satisfies lexically better than the actual target. This is the strongest doc-demotion validation case in the C# suite: the file is an application-layer registry class, not a handler, yet it consistently beats handler and docs files. Adding a large-registry-class demotion (analogous to existing doc-file demotion) gated on `_isAgentFormat` would address both CS-002 and CS-004 together.

### Finding 2 (HIGH PRIORITY): Partial-class shard chunker does not emit sub-method symbols (CS-007)

`AsyncProcessor.cs` (144 lines) is chunked as one unit anchored on `RespServerSession` (the `partial class` header). The method `AsyncGetProcessorAsync` at line 79 is inside the chunk but not registered as an independent symbol. Any query targeting a specific method in a file whose only top-level declaration is a `partial class` continuation will hit this: the returned symbol is always the class header regardless of what method the user asks for. The fix is to ensure method-level `MemberDeclarationSyntax` nodes are emitted as independent symbols from within partial-class shards, even when the whole file fits in one chunk.

### Finding 3 (MEDIUM): Grammar false-positive — `is` emitted as `struct` symbol (CS-005)

The C# tree-sitter grammar extracts `is` as a struct-type symbol from a pattern-matching expression. This is a grammar rule misfire affecting any file containing C# 8+ pattern-matching. The `LoaderBlockCache` record (line 20, one-liner positional record) may also be failing to generate a stand-alone chunk due to its brevity. Both the grammar bug and the chunk-size floor for one-liner declarations need investigation together.

---

## Recommended Investigation Order

1. Confirm `RespCommandsInfo.cs` chunk is NOT gated by existing doc-demotion → if not, widen demotion to include registry/info classes (CS-002, CS-004).
2. Audit C# grammar `struct` extraction rules for `is_pattern_expression` nodes (CS-005).
3. Verify whether partial-class method nodes are emitted as separate symbols in the chunker's C# grammar rules (CS-007).
4. Investigate cross-library penalty for client-vs-server disambiguation (CS-001) — could be addressed by a `libs/client` path demotion gated on `_isAgentFormat`.
