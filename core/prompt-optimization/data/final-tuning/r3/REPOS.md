# r3 benchmark repositories

Six fresh public repositories for the r3 code-retrieval benchmark. Cloned 2026-10-01 with `git clone --depth 1` (default branch) into `eval/repos/r3-<short-name>` (gitignored). Nothing was committed. No install or build was run.

## Table

| name | GitHub URL | language | SHA (HEAD) | main-lang files | main-lang LOC (non-test LOC) | indexable files | size class | license | freshness |
|---|---|---|---|---|---|---|---|---|---|
| jj | https://github.com/jj-vcs/jj | Rust | 030ecf22c56b98bf6507067dca0df3dffa6de498 | 422 | 270,967 (147,186) | 681 | large | Apache-2.0 | PASS |
| dgraph | https://github.com/dgraph-io/dgraph | Go | 6cd03dca3b003dae29df904c0a09667f7edb703b | 596 | 264,708 (157,918) | 1,006 | large | Apache-2.0 | PASS (note 1) |
| tortoise-orm | https://github.com/tortoise/tortoise-orm | Python | 1979f27d6a37db991ca5c934e2394faa6c942d52 | 451 | 73,388 (34,235) | 533 | medium | Apache-2.0 | PASS |
| typedoc | https://github.com/TypeStrong/typedoc | TypeScript | 6d8c856bbb46b089371952981f113c3e318818fd | 597 (.ts + .tsx) | 67,693 (47,541) | 838 | medium | Apache-2.0 | PASS |
| zipkin | https://github.com/openzipkin/zipkin | Java | 878ce2a1fad54ca941d17fdcf2e1d924b148eb1f | 428 | 57,034 (30,590) | 740 | medium | Apache-2.0 | PASS (note 2) |
| ocelot | https://github.com/ThreeMammals/Ocelot | C# | fcebf2b96c1811500037e010ee3b09e25ac39b19 | 757 | 71,824 (20,311) | 953 | medium | MIT | PASS |

## How the numbers were measured

- Main-language files and LOC: `git ls-files` filtered by extension. Excluded vendor, third_party, node_modules, dist, build, target, generated directories. Also excluded files with a "Code generated / DO NOT EDIT / @generated" header. LOC is physical lines (`wc -l` style), tests included. Non-test LOC is in parentheses and uses a path heuristic (tests/, testing/, *_test.go, *Tests.cs and similar).
- Indexable files: the real include and exclude glob lists from `core/infrastructure/config/search.js` (`FILE_PATTERNS`), applied with picomatch to the tracked files. This counts code, docs, config and build files the indexer would discover. The script is approximate: it does not apply the size cap or admission policy.
- All six are far below the 2,500-file cap. Highest is dgraph at 1,006 indexable files, about 20 minutes to index at 1 min per 50 files.
- Size classes use total LOC including tests. Large = at least 100k. Medium = 15k to 80k. Both large repos also exceed 100k on non-test LOC. All four medium repos are below 80k total LOC.

## Agent-instruction files

Searched every clone for AGENTS.md, CLAUDE.md, GEMINI.md, .cursorrules, .cursor/, .claude/, .windsurfrules, .clinerules, .roorules, .aider*, CONVENTIONS.md, copilot-instructions.md, *.instructions.md. Found none in all six clones. I deleted nothing.

Rejected on this ground: kopia, juicefs, traefik, rclone (all ship AGENTS.md / CLAUDE.md / .claude/ files).

## Freshness checks (all six)

1. `eval/repos/` and `eval/ast-tester-probes/_repos/`: not present. Existing entries are ai-chatbot, express, fastify, flask, gin, ripgrep, uv, plus chi, hiredis, highway, garnet, dart http, jason, gson, axios, kotlinx.coroutines, Penlight, Slim, click, sinatra, ruff, requests-scala, Alamofire, zod, http.zig. No mirror or fork of the r3 repos.
2. Probe files (`core/prompt-optimization/data/`, `eval/retrieval-probes/`, field "repo"): 20 distinct repo names, no match.
3. Task-bench files (`eval/task-completion-bench/select/`, `"repo"` field, excluding `tasks_heldout2*`): 2,022 distinct repos, no exact or substring match for any of the six, including the old jj owner name (martinvonz) and forks.
4. Known agent benchmarks (SWE-bench, Multilingual, Multi-SWE-bench, SWE-Gym): none of the six is a known member. SWE-smith has 866 repos and no public list was checkable. See concern 3.
5. Text grep of `*.json`, `*.jsonl`, `*.md` for each name, excluding `tasks_heldout2*`, node_modules, .git, eval/repos and `_repos`:
   - jj, jujutsu, martinvonz, typedoc, ocelot, ThreeMammals: no hits.
   - dgraph: see note 1.
   - tortoise-orm: hits only in `eval/data/bright-code/corpus.jsonl` (2 documents from the bright-leetcode split). Not a repo reference. Benign.
   - zipkin: see note 2.

Note 1 (dgraph). Case-insensitive `dgraph` matches the substring in `AddGraphQL` inside prompt-optimization trace files (false positive). `REJECTED_heldout2.json` has the string `dgraph-io/badger` (a different repository, a dependency of dgraph, not vendored in the clone). The string `dgraph-io/dgraph` appears nowhere. `dgraph-io/badger` is also in the task-bench repo list. The dgraph clone has no badger source in the tree (Go modules, no vendor directory). I kept dgraph. Drop it if you treat the same GitHub organisation as a conflict.

Note 2 (zipkin). The word "Zipkin" appears 3 times (case-insensitive) in `select/.cache/tasks_full_heldout2_reserve.json`, and the string `openzipkin/` appears 0 times. I checked counts only and did not read that file. It is most likely a class or dependency name inside another repo's task text. Also 37 leetcode/stackoverflow documents in `eval/data/bright-code/corpus.jsonl` mention it as text (not repo content). I kept zipkin. This is the weakest freshness call.

## Per-repo notes

### jj (Rust, large)
Layout:
- `lib/` core library: repo, operation log, commit graph, revset engine, git backend, working copy
- `cli/` the `jj` binary: 50 command modules, templater, config
- `core/` small shared crates, `docs/` mkdocs site, `web/`
- `lib/tests`, `cli/tests` integration tests
- `Cargo.toml` workspace, `flake.nix`, `deny.toml`

Architecture for multi-hop questions:
- A user command in `cli/src/commands/*` goes through `cli_util.rs` into the `lib` Repo and Transaction types. A transaction writes an operation into the op store (`op_heads_store`, `simple_op_store`) and then the working copy (`local_working_copy`).
- Revset text is parsed in `revset_parser.rs` (pest grammar), resolved and optimized in `revset.rs`, then evaluated by the default index. Templates follow a parallel path: `template.pest`, `template_parser.rs`, `template_builder.rs`, `templater.rs`.
- Storage and signing are pluggable traits (`backend`, `git_backend`, `simple_backend`, `secret_backend`, `signing_factory`). Layered config (`config.rs`, `config_resolver.rs`, `settings.rs`, `config-schema.json`) is validated against a schema. Good for "where is X enforced" questions.

### dgraph (Go, large)
Layout:
- `edgraph/` alpha server entry points, ACL, multi-tenancy, namespaces
- `query/`, `dql/`, `graphql/` query parsing, execution, and GraphQL schema, resolvers, admin
- `worker/`, `posting/`, `raftwal/`, `conn/` distributed task execution, posting lists, Raft, connections
- `schema/`, `tok/`, `types/`, `x/` schema state, tokenizers, value types, utilities
- `dgraph/cmd/` (alpha, zero, bulk, live) plus `systest/`, `tlstest/` integration tests

Architecture for multi-hop questions:
- A request enters `edgraph/server.go`, passes ACL and namespace guards (`access_control.go`, `predicate_acl.go`, `multi_tenancy.go`), is parsed by `dql/` or translated from `graphql/`, then built into a `query.SubGraph` tree.
- The query layer dispatches tasks to `worker/` (`task.go`, `groups.go`). Workers route by predicate to the group leader over gRPC, read posting lists in `posting/`, and commit mutations via Raft proposals (`proposal.go`, `draft.go`) coordinated by Zero.
- Cross-cutting policy lives in separate places: schema validation (`schema/`), reserved-predicate guards, TLS and audit (`audit/`), backup and restore (`worker/backup*.go`).

### tortoise-orm (Python, medium)
Layout:
- `tortoise/` package: `models.py`, `queryset.py`, `query_utils.py`, `expressions.py`, `functions.py`, `filters.py`, `router.py`, `signals.py`, `validators.py`, `transactions.py`
- `tortoise/fields/` (base, data, relational), `tortoise/backends/` (sqlite, asyncpg, psycopg, mysql, mssql, oracle, odbc, base executors and schema generators)
- `tortoise/migrations/`, `tortoise/cli/`, `tortoise/contrib/` framework integrations
- `tests/`, `docs/`, `examples/`

Architecture for multi-hop questions:
- Model metaclass builds field maps and relations. A QuerySet builds a pypika query using filters and expressions. The backend executor and client run it, and converters map values back to Python. Dialect differences live in per-backend executors and schema generators.
- Validation and defaults sit on the field layer (`fields/base.py`, `validators.py`). Connection routing (`router.py`, `connection.py`, `context.py`) and signals and transactions cut across this flow.
- Config parsing (`config.py`, `apps.py`) wires apps, models and connections. Good for "how does a filter reach SQL" and "where is X validated" questions.

### typedoc (TypeScript, medium)
Layout:
- `src/lib/application.ts` orchestrator, `cli.ts`
- `src/lib/converter/` TS program to reflection model (`converter.ts`, `context.ts`, `symbols.ts`, `types.ts`, `comments/`, `plugins/`)
- `src/lib/models/` reflection model, `src/lib/serialization/` JSON serializers and deserializers
- `src/lib/output/` renderer, themes, plugins (default theme, JSX, navigation), `src/lib/utils/options/` option declarations, readers, validation
- `src/test/`, `site/` docs, `example/`

Architecture for multi-hop questions:
- Application reads options from several readers (CLI, tsconfig, typedoc.json, package.json), validates each against declarations, converts a TypeScript program to a reflection tree through converter components and plugins, then serializes or renders it.
- The renderer dispatches through themes to JSX templates and emits events that plugins hook. Option validation, deprecation and validation of documentation links (`src/lib/validation/`) give clear "where is X enforced" questions.
- Internationalisation (`internationalization/`) and the event system cross many modules.
- Caveat: `src/test/converter` and `src/test/converter2` hold 321 tiny `.ts` fixture files (about 5k LOC) that the indexer will include. Real library code is `src/lib` (191 files).

### zipkin (Java, medium)
Layout:
- `zipkin/` core model (`zipkin2.Span`), codecs, storage SPI (`zipkin2.storage`: `SpanStore`, `Traces`, `QueryRequest`)
- `zipkin-collector/` transports (Kafka, RabbitMQ, ActiveMQ, Pulsar, Scribe, core)
- `zipkin-storage/` (Cassandra, Elasticsearch, MySQL v1), `zipkin-server/` Armeria and Spring Boot server, config, query API, self-tracing
- `zipkin-lens/` web UI (about 95 TS/TSX files, 29 JS), `zipkin-tests/`, `docker/`, `benchmarks/`

Architecture for multi-hop questions:
- Spans arrive through a collector transport, are decoded by format-specific codecs, go through `zipkin2.collector.Collector` sampling and validation, and are stored through the `StorageComponent` SPI to a backend.
- Queries flow from the HTTP API in `zipkin-server` through `QueryRequest` validation into storage `SpanStore` and `Traces` interfaces. Each backend builds its own query.
- Server config is bound by Spring Boot property classes per collector and storage type, with conditional auto-configuration. Good for "how does a configuration flag reach a storage call".
- Caveat: the repo also holds the `zipkin-lens/` web UI (about 95 TS/TSX files, 29 JS). Test sources are about 46% of Java LOC.

### ocelot (C#, medium)
Layout:
- `src/` with one folder per pipeline concern: `Configuration`, `DownstreamRouteFinder`, `DownstreamUrlCreator`, `LoadBalancer`, `ServiceDiscovery`, `Authentication`, `Authorization`, `RateLimiting`, `Cache`, `Requester`, `Responder`, `Middleware`, `WebSockets`, `Multiplexer`, `Headers`, `QualityOfService`
- `src/DependencyInjection/` service registration
- `unit/` and `acceptance/` test projects, `docs/` (rst), `samples/`, `benchmark/`

Architecture for multi-hop questions:
- An API gateway built as an ASP.NET Core middleware pipeline. The pipeline is assembled in `src/Middleware` (`OcelotPipelineExtensions.cs`). Steps share state through the HTTP context items.
- Route configuration (`ocelot.json`) is loaded, validated by FluentValidation-based validators in `src/Configuration/Validator` (`FileConfigurationFluentValidator`, `RouteFluentValidator`), then turned into route objects. The route finder matches the upstream path and method, then a URL creator builds the downstream address.
- Policies (load balancer, QoS, rate limit, cache, auth) are chosen per route through factories and creators. Good for "where is this route option validated" and "how does a request reach the downstream URL".
- Caveat: `.cs` totals include 285 test files (51.5k LOC of 71.8k). Non-test C# is 20k LOC.

## Concerns

1. Indexable-file counts are estimates from the `FILE_PATTERNS` globs on `git ls-files`. The real index may differ slightly. All are far under the 2,500 cap.
2. "Non-test LOC" uses a path heuristic. Treat it as approximate.
3. SWE-smith (866 repos) and SWE-rebench have no checkable public list in this session. None of the six is in SWE-bench, Multilingual, Multi-SWE-bench or SWE-Gym as far as known. tortoise-orm and typedoc are the ones most likely to appear in a large scraped set.
4. See freshness notes 1 and 2 (dgraph and zipkin).
5. dgraph is 123 MB on disk, mostly docs and assets. Fine for indexing.
6. Ocelot default branch is `develop`, tortoise-orm is `develop`, typedoc is `master`. SHAs are pinned above.
