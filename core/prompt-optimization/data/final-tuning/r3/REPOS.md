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

# r3-hard B repos

Five more fresh public repositories for the r3-hard extension. They add five languages not in r3: Kotlin, Ruby, PHP, C++ and Swift. Cloned 2026-10-01 with `git clone --depth 1` (default branch) into `eval/repos/r3-<short-name>` (gitignored). Nothing was committed. Nothing was indexed, installed or built. Machine-readable copy: `repos-b.json`.

## Table (B)

| name | GitHub URL | language | SHA (HEAD) | main-lang files | main-lang LOC (non-test LOC) | indexable files | size class | license | freshness |
|---|---|---|---|---|---|---|---|---|---|
| okhttp | https://github.com/square/okhttp | Kotlin | e9eae50d36e938603811a41f9e2ab04182bcb515 | 573 (.kt) | 141,044 (57,963) | 795 | large | Apache-2.0 | PASS (note B1) |
| sequel | https://github.com/jeremyevans/sequel | Ruby | 3acf523e8accb7a745e364b4db3bb51b172162b3 | 627 | 173,936 (75,217) | 874 | large | MIT | PASS |
| composer | https://github.com/composer/composer | PHP | 6712f83974b4469f764963f3a65852496f254350 | 537 | 131,723 (76,168) | 1,010 | large | MIT | PASS (note B2) |
| drogon | https://github.com/drogonframework/drogon | C++ | bfb3ae2e13572a30cbdbd623da1798794d5f2706 | 407 (.cc + .h) | 79,518 (62,838) | 519 | medium | MIT | PASS |
| grdb | https://github.com/groue/GRDB.swift | Swift | 0d8cf958b4b66a0473ec6e6986eb9da462171da9 | 478 | 192,455 (72,789) | 605 | large | MIT | PASS |

Total indexable files: 3,803. At 1 minute per 50 files this is about 76 minutes, inside the 90-minute budget. Largest single repo is composer at 1,010 files (about 20 minutes).

Measurement method is the same as for the first six (see "How the numbers were measured" above). Script: `scratchpad/measure.mjs` (picomatch over `FILE_PATTERNS` from `core/infrastructure/config/search.js`, `dot: true`). All five languages are in the indexer include list (`.kt .kts`, `.rb`, `.php`, `.c .cc .cpp .h .hpp .inl`, `.swift`).

Size note. The 40k to 150k request fits non-test LOC for all five (58k, 75k, 76k, 63k, 73k). Total LOC including tests is above 150k for sequel (174k) and grdb (192k). The first six repos were accepted on the same basis (dgraph 265k total, 158k non-test). grdb is the most test-heavy: `Tests/GRDBTests` holds 116k of its 192k Swift LOC.

## Agent-instruction files (B)

Searched the full working tree (not only tracked files, hidden dirs included) of all five clones for AGENTS.md, CLAUDE.md, GEMINI.md, .cursorrules, .cursor, .claude, .windsurfrules, .clinerules, .roorules, .aider*, CONVENTIONS.md, copilot-instructions.md, *.instructions.md, .codex, .llms. Found none. I deleted nothing.

Rejected on this ground (all measured in a scratch clone, then dropped): ktlint (root CLAUDE.md), koin (projects/CLAUDE.md), coil (AGENTS.md + CLAUDE.md), vapor (AGENTS.md), watchman (.codex/AGENTS.md, .llms/rules/AGENTS.md), dependabot-core (.github/copilot-instructions.md and 4 *.instructions.md; also 5,910 indexable files).

## Freshness checks (B)

Same procedure as the first six.

1. `eval/repos/` and `eval/ast-tester-probes/_repos/`: no match. I compared the `origin` remote of every git clone there. The language slots hold kotlinx.coroutines (Kotlin), Slim (PHP), sinatra (Ruby), highway (C++), Alamofire (Swift). None is a mirror or fork of the five.
2. Probe files and task-bench files: I extracted every value of the keys `repo`, `repo_name`, `repository`, `github_repo`, `source_repo` from all `*.json` and `*.jsonl` under `eval/` and `core/` (excluding `tasks_heldout2*`, node_modules, .git, `eval/repos`, `_repos`). That gives 3,061 distinct names. No exact or substring match for okhttp, sequel, jeremyevans, composer, drogon, grdb or groue.
3. Text grep (case-insensitive) of `*.json *.jsonl *.md *.tsv *.txt *.py *.mjs *.sh` under `eval/` and `core/`, same exclusions, plus `eval/task-completion-bench/select/exclusion-sources/` (golden-key and run-history lists): no repository reference. Hits are listed in notes B1 to B3.
4. Held-out-2 files: I used counts only and opened nothing. For `tasks_full_heldout2.json`, `tasks_full_heldout2_reserve.json` and `REJECTED_heldout2.json`: zero `repo` fields and zero `github.com/<owner>/` URLs for the five owners. Instance-id forms (`square__okhttp` and similar): zero.
5. Known agent benchmarks: none of the five is a known member of SWE-bench, SWE-bench Multilingual (its PHP repos are carbon, php-cs-fixer, laravel/framework, phpspreadsheet; Ruby repos are jekyll, fluentd, fastlane, rubocop, faker, fpm), Multi-SWE-bench (its C++ repos are nlohmann/json, fmt, simdjson, Catch2 and similar) or SWE-Gym. SWE-smith and SWE-PolyBench have no list I could check here. This is from memory, not from a live list. See concern B3.

Note B1 (okhttp). `eval/task-completion-bench/handoffs/improve/slate-c/research/competitor-mechanisms.md` quotes the public CodeGraph README benchmark, which includes OkHttp (about 645 files) as one of its seven repos. That is a competitor's published result, not our data, and no OkHttp probe or task exists in our files. Other hits are benign text: a `microsoft-kiota-http-okHttp` dependency line inside `tasks_full_multilingual.json` (kiota is a different repo), a grep pattern inside one r282 capture, and 2 synthetic documents in `eval/data/m2crb`. I kept okhttp. Fallback if you treat the competitor overlap as a conflict: kotlinx.serialization (Kotlin, Apache-2.0, 68.6k LOC, 1,050 indexable files, no agent files; measured but not cloned).

Note B2 (composer, sequel). The text `composer/composer` appears once in `tasks_full_heldout2.json` (count only, not opened) and once in `eval/data/gencodesearchnet/corpus.jsonl` (dataset text). It is not a `repo` field and not a URL, so most likely a package name in another repo's text. The substring `sequel` appears once in the same file, most likely from `sequelize`. `jeremyevans` appears once, as a link to `rack-unreloader` inside a Sinatra README copy (`query-shapes/inputs/ruby-DP-RB-002.json`). I kept both. This is the weakest freshness call of the five (composer).

Note B3 (drogon, grdb). `drogon` and `grdb` appear only as text inside `eval/data/bright-code/corpus.jsonl` (LeetCode and StackOverflow documents). Benign.

## Per-repo notes (B)

### okhttp (Kotlin, large)
Layout:
- `okhttp/src/commonJvmAndroid/kotlin/okhttp3/` public API (`OkHttpClient`, `Dispatcher`, `CertificatePinner`, `ConnectionSpec`, `Cache`) and `internal/` (`connection`, `http`, `http1`, `http2`, `cache`, `tls`, `ws`, `concurrent`, `dns`, `proxy`, `publicsuffix`, `idn`, `platform`, `authenticator`, `ech`)
- Separate modules: `mockwebserver`, `mockwebserver-deprecated`, `mockwebserver-junit4/5`, `okhttp-tls`, `okhttp-sse`, `okhttp-dnsoverhttps`, `okhttp-logging-interceptor`, `okhttp-urlconnection`, `okhttp-coroutines`, `okhttp-brotli`, `okhttp-zstd`, `okcurl`, `okhttp-testing-support`
- `docs/` (mkdocs), `samples/`, `android-test`, build logic in Gradle Kotlin DSL

Architecture for multi-hop questions:
- Client builder config goes to `RealCall`, which runs the interceptor chain: `RetryAndFollowUp`, `Bridge`, `CacheInterceptor`, `ConnectInterceptor`, then `CallServerInterceptor`. State passes through `RealInterceptorChain`.
- `ConnectInterceptor` goes through `RoutePlanner` / `RealRoutePlanner` and `RealConnectionPool`, then to `http1` or `http2` codecs. TLS policy sits in `ConnectionSpec`, `CertificatePinner` and `internal/tls`. Good for "where is X enforced" and "how does a config flag reach the socket" questions.
- Decoys: `mockwebserver` and `mockwebserver-deprecated` have parallel `Dispatcher` and `QueueDispatcher` classes. The OkHttp `Dispatcher` is a different class with the same name. Many `*Common.kt` and `*Jvm.kt` file pairs.
- Caveat: 71 `.java` files and 44 `.kts` build files sit beside the 573 Kotlin files. Tests are 59% of the Kotlin LOC (`okhttp/src` holds 105k of the 141k, with test source sets inside).

### sequel (Ruby, large)
Layout:
- `lib/sequel/` core: `database/` (connecting, query, transactions, schema methods), `dataset/` (sql, query, actions, features), `connection_pool/` (single, threaded, timed_queue, sharded variants), `model/` (base, associations, plugins), `sql.rb`
- `lib/sequel/adapters/` 15 adapter files plus `jdbc/` and `shared/` subdirs (postgres, mysql2, sqlite, jdbc, oracle, tinytds and others) with `shared/` dialect modules
- `lib/sequel/plugins/` (110 files) and `lib/sequel/extensions/` (104 files)
- `spec/` (core, model, extensions, adapters, integration), `doc/` (rdoc guides), `www/`

Architecture for multi-hop questions:
- `Sequel.connect` parses options, loads an adapter, and builds a `Database` with a connection pool. A `Dataset` clones itself on each query-method call and generates SQL in `dataset/sql.rb`. Dialect differences live in `adapters/shared/*`. Actions (`all`, `first`, `insert`) run through the database and the pool.
- Models are built on datasets. Behaviour is added by plugins that override model class, instance and dataset methods through nested modules. Validation (`validation_helpers`, `validation_class_methods`), association helpers and hooks are all plugins. Good for "which layer implements X" and for completeness questions ("list every plugin that touches Y").
- Decoys: many plugins with near-identical names (`association_pks`, `association_proxies`, `association_dependencies`) and per-adapter duplicates of the same method.
- Caveat: `doc/` and `www/` add 226 `.txt` and 32 `.rdoc` files (CHANGELOG, release notes) that the indexer includes. `spec/` is 57% of the Ruby LOC.

### composer (PHP, large)
Layout:
- `src/Composer/`: `Command/` (39 files, about 35 CLI commands), `Installer.php`, `Installer/` (installers and `InstallationManager`), `DependencyResolver/` (`PoolBuilder`, `Solver`, rules, `Transaction`), `Repository/`, `Downloader/`, `Package/`, `Config.php` and `Config/`, `Json/` (schema validation), `Plugin/`, `EventDispatcher/`, `Script/`, `Autoload/`, `Policy/`, `Advisory/`, `Platform/`, `Util/`
- `tests/Composer/` (unit and functional, 257 `.test` fixture files and about 250 other fixtures), `res/` JSON schemas (`composer-schema.json` and two more), `doc/`

Architecture for multi-hop questions:
- A command (`install`, `update`, `require`) builds the `Composer` object through `Factory` (config, repositories, installers, event dispatcher). `Installer` loads the lock file, runs the `PoolBuilder` and `Solver` to compute a `Transaction`, then `InstallationManager` and `DownloadManager` apply it.
- Config and `composer.json` are validated with JSON schema (`Json/JsonFile`, `ConfigValidator`, `ValidateCommand`). Plugins and scripts hook through `EventDispatcher` and `PluginManager`. Good for "where is X validated" and "how does a flag reach the solver" questions.
- Decoys: many `*Repository`, `*Downloader` and `*Installer` classes with parallel structure. Newer `Policy/` and `Advisory/` classes sit next to older audit code.
- Caveat: fixtures. 511 tracked files sit under `Fixtures` dirs, 257 of them `.test` files that the indexer includes. Real library code is `src/Composer` (about 76k LOC).

### drogon (C++, medium)
Layout:
- `lib/inc/drogon/` public headers, `lib/src/` implementation (`HttpAppFrameworkImpl`, `HttpServer`, `HttpControllersRouter`, `StaticFileRouter`, `ConfigLoader`, `AOPAdvice`, `SessionManager`, `FixedWindowRateLimiter`, `WebSocketConnectionImpl`, request and response parsers)
- `orm_lib/` (DbClient, Mapper, SqlBinder, `postgresql_impl`, `mysql_impl`, sqlite), `nosql_lib/redis`, `drogon_ctl/` (code generator for controllers, models, views), `examples/`, `lib/tests`, `orm_lib/tests`
- `config.example.json` and `config.example.yaml`, `cmake/`

Architecture for multi-hop questions:
- `ConfigLoader` reads JSON or YAML (`ConfigAdapter` plus manager) and sets up listeners, DB clients, plugins and session options on `HttpAppFrameworkImpl`. `HttpServer` parses requests, then AOP advice points, global filters and the controller router decide the handler. Handler return values go back through response creation.
- Controllers are registered by macros and class maps (`DrClassMap`). Filters, plugins and rate limiting (`Hodor`, `FixedWindowRateLimiter`) are separate extension points. The ORM has its own layered path: `DbClient` to `DbClientImpl` to connection to per-database implementation.
- Decoys: `DbClientImpl` vs `DbClientLockFree`, `.cc` and `.h` pairs, and coroutine variants (`CoroMapper`).
- Caveat: the `trantor` network library is a git submodule and is empty in a shallow clone. Network-layer symbols (`TcpConnection`, `EventLoop`) have no definitions in the tree. `third_party/` holds only `mman-win32` (excluded by the index globs). `.csp` view templates are not indexed.

### grdb (Swift, large)
Layout:
- `GRDB/Core/` (Database, DatabaseQueue, DatabasePool, Configuration, statements, SerializedDatabase, TransactionObserver, StatementAuthorizer, DatabaseValue conversion), `GRDB/QueryInterface/` (SQL generation, requests, associations), `GRDB/Record/`, `GRDB/ValueObservation/`, `GRDB/Migration/`, `GRDB/FTS/`, `GRDB/JSON/`, `GRDB/Dump/`, `GRDB/Utils/`
- `Sources/GRDBSQLite` and `GRDBSQLCipher` (module shims), `SQLiteCustom/` (config header), `Tests/` (`GRDBTests`, `Performance`), `Documentation/`, `GRDB.docc`

Architecture for multi-hop questions:
- `Configuration` flows into `DatabaseQueue` or `DatabasePool`. Both wrap a `SerializedDatabase` that enforces access through a scheduling watchdog. Requests are built through the query interface (`QueryInterfaceRequest`, `SQLRequest`, associations), compiled to SQL and statements, then decoded by `FetchableRecord` and written by `PersistableRecord`.
- Migrations (`DatabaseMigrator`) and observation (`ValueObservation`, `TransactionObserver`, database regions) cross the same layers. Good for "how does a read reach SQLite" and "where is X checked" questions.
- Decoys: queue, pool and snapshot variants of the same API, and several FTS versions (`FTS3`, `FTS4`, `FTS5`).
- Caveat: tests dominate. `Tests/GRDBTests` is 116k of 192k Swift LOC. The Xcode project files (`.xcodeproj`, `.xcworkspace`, `.plist`) and 30 PNG files are tracked but are not source.

## Concerns (B)

1. Indexable-file counts are estimates from the `FILE_PATTERNS` globs on `git ls-files`. Same caveat as concern 1 above. All five are under the 1,500-file request.
2. Total LOC for sequel and grdb is above 150k (non-test is 73k to 75k). See the size note.
3. SWE-smith, SWE-PolyBench and SWE-rebench have no list I could check in this session. Composer and okhttp are the most likely to appear in a large scraped set.
4. okhttp appears in a competitor's public benchmark (note B1). composer has one unexplained text hit in a held-out-2 file (note B2, count only).
5. drogon is missing its `trantor` submodule (shallow clone). It does not affect indexing, but questions must not depend on trantor internals.
6. Default branches: okhttp `main`, sequel `master`, composer `main`, drogon `master`, grdb `master`. SHAs are pinned above.
7. Alternates that passed size, license and agent-file checks but were not cloned: kotlinx.serialization (Kotlin), gatling (Scala, 67k Scala LOC, 1,091 indexable files), http4k was skipped for its non-standard license.
