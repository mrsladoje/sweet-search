# Graph-2hop Real-Repo Miss Summary

Generated: 2026-05-03T10:06:23.361Z
Total queries: 300
Repos: fastify, flask, ripgrep
Mode A (none): graphExpand=none, expand=false
Mode B (2hop-adaptive): graphExpand=2hop, adaptiveHop2=true, expand=true
use3Stage=false (test repos have mixed-dim float vectors → cascade off)

> See `FIX_TABLE.md` for ranked low-hanging fix recommendations. Top candidates: path/file-type penalty for `.md`/`/test/`/`.d.ts` (#1 — 49/62 misses have one of these in top-3), re-index real repos so cascade can run (#2), and investigate why graph expansion is essentially inert (#3 — only 1/300 queries had gold added by expansion).

## Headline numbers

| metric | mode A (none) | mode B (2hop-adaptive) |
|---|---|---|
| Recall@1  | 140/300 (46.67%) | 140/300 (46.67%) |
| Recall@10 | 238/300 (79.33%) | 238/300 (79.33%) |

Rescue (mode B top10 but mode A miss): **0**
Harm (mode A top10 but mode B miss): **0**
Identical rank in both modes: **282**/300
Queries where graph expansion produced any surviving expanded entry: **11**/300
Queries where gold was *added by expansion* (is_expanded=true): **1**/300

## Buckets (mode B, 2hop-adaptive)

| bucket | count | share |
|---|---|---|
| hit_top10 | 238 | 79.33% |
| reranker_demoted_gold | 36 | 12.00% |
| mode_b_pushed_gold_off | 16 | 5.33% |
| graph_seed_missing | 9 | 3.00% |
| graph_added_gold_but_reranker_lost | 1 | 0.33% |

## Per-repo bucket distribution

| repo | hit_top10 | reranker_demoted | mode_b_pushed_off | graph_seed_missing | graph_added_lost | other |
|---|---|---|---|---|---|---|
| fastify | 58 | 25 | 12 | 4 | 1 | 0 |
| flask | 91 | 6 | 1 | 2 | 0 | 0 |
| ripgrep | 89 | 5 | 3 | 3 | 0 | 0 |

## Top-10 hit rate by category

| category | hits/total | rate |
|---|---|---|
| calls | 94/116 | 81.03% |
| config | 21/24 | 87.50% |
| control | 43/57 | 75.44% |
| extends | 4/7 | 57.14% |
| implements | 40/42 | 95.24% |
| imports | 2/2 | 100.00% |
| other | 1/1 | 100.00% |
| parser | 12/14 | 85.71% |
| route | 8/15 | 53.33% |
| validator | 13/22 | 59.09% |

## Graph expansion behavior

- mean expanded entries surviving in result list: **0.247**
- mean LI rerank pool size: **29.25**
- mean expanded-in-pool slot usage: **0.247**
- queries with cascade actually invoked: **0**

Interpretation: under the validated graph benchmark profile (use3Stage=false because test repos have mixed-dim float vectors), the cascade rerank never runs and graph expansion contributes ~0 entries per query. **Mode B output is essentially identical to mode A output.**

## Representative misses (15)

### fastify-005 [reranker_demoted_gold] (fastify, control, expected_hops=0)
- **query**: private property keys symbol for tracking whether an instance was decorated
- **gold**: lib/symbols.js (symbols: kHasBeenDecorated)
- **rankNone=78, rankExpand=78, goldAddedByExpansion=false**
- expansion: mode=2hop, expanded=0, expandedWithLiChunk=0
- top-3 (mode B): docs/Reference/Decorators.md (0.418) | docs/Reference/Decorators.md (0.408) | docs/Reference/Decorators.md (0.362)

### fastify-006 [reranker_demoted_gold] (fastify, control, expected_hops=0)
- **query**: definition of FST_ERR_NOT_FOUND error
- **gold**: lib/errors.js (symbols: FST_ERR_NOT_FOUND)
- **rankNone=20, rankExpand=20, goldAddedByExpansion=false**
- expansion: mode=2hop, expanded=0, expandedWithLiChunk=0
- top-3 (mode B): types/errors.d.ts (0.596) | types/errors.d.ts (0.570) | types/errors.d.ts (0.566)

### fastify-007 [reranker_demoted_gold] (fastify, control, expected_hops=0)
- **query**: where is the lifecycle hook list that drives onRequest preParsing preValidation preHandler
- **gold**: lib/hooks.js (symbols: lifecycleHooks)
- **rankNone=43, rankExpand=43, goldAddedByExpansion=false**
- expansion: mode=2hop, expanded=0, expandedWithLiChunk=0
- top-3 (mode B): test/skip-reply-send.test.js (0.565) | test/hooks.test.js (0.562) | docs/Reference/TypeScript.md (0.561)

### fastify-013 [reranker_demoted_gold] (fastify, calls, expected_hops=2)
- **query**: what runs the chain of preValidation user callbacks before AJV is invoked
- **gold**: lib/hooks.js (symbols: preValidationHookRunner, hookRunnerGenerator)
- **rankNone=81, rankExpand=81, goldAddedByExpansion=false**
- expansion: mode=2hop, expanded=0, expandedWithLiChunk=0
- top-3 (mode B): test/hooks.test.js (0.509) | test/schema-special-usage.test.js (0.494) | test/types/hooks.test-d.ts (0.481)

### fastify-014 [reranker_demoted_gold] (fastify, control, expected_hops=0)
- **query**: where is FST_ERR_VALIDATION constructed and given its 400 status
- **gold**: lib/errors.js (symbols: FST_ERR_VALIDATION)
- **rankNone=44, rankExpand=44, goldAddedByExpansion=false**
- expansion: mode=2hop, expanded=0, expandedWithLiChunk=0
- top-3 (mode B): types/errors.d.ts (0.493) | types/errors.d.ts (0.463) | test/validation-error-handling.test.js (0.458)

### fastify-003 [mode_b_pushed_gold_off] (fastify, calls, expected_hops=1)
- **query**: where is the wrapper that resolves a promise returned by an async route handler
- **gold**: lib/wrap-thenable.js (symbols: wrapThenable)
- **rankNone=76, rankExpand=-1, goldAddedByExpansion=false**
- expansion: mode=2hop, expanded=0, expandedWithLiChunk=0
- top-3 (mode B): docs/Reference/Routes.md (0.502) | docs/Reference/Routes.md (0.496) | docs/Reference/TypeScript.md (0.473)

### fastify-010 [mode_b_pushed_gold_off] (fastify, calls, expected_hops=2)
- **query**: how does encapsulation duplicate the lifecycle handler arrays so child plugins do not pollute the parent instance
- **gold**: lib/hooks.js (symbols: buildHooks)
- **rankNone=86, rankExpand=-1, goldAddedByExpansion=false**
- expansion: mode=2hop, expanded=0, expandedWithLiChunk=0
- top-3 (mode B): test/hooks.test.js (0.499) | test/hooks.test.js (0.495) | lib/plugin-override.js (0.491)

### fastify-012 [mode_b_pushed_gold_off] (fastify, calls, expected_hops=2)
- **query**: where the route configuration is canonicalized and the query alias is mapped to querystring before validators are compiled
- **gold**: lib/schemas.js (symbols: normalizeSchema)
- **rankNone=248, rankExpand=-1, goldAddedByExpansion=false**
- expansion: mode=2hop, expanded=0, expandedWithLiChunk=0
- top-3 (mode B): test/internals/request-validate.test.js (0.491) | test/internals/request-validate.test.js (0.488) | test/types/route.test-d.ts (0.480)

### fastify-025 [mode_b_pushed_gold_off] (fastify, calls, expected_hops=1)
- **query**: what executes application-level callbacks like onReady recursively across child encapsulated instances
- **gold**: lib/hooks.js (symbols: hookRunnerApplication)
- **rankNone=56, rankExpand=-1, goldAddedByExpansion=false**
- expansion: mode=2hop, expanded=0, expandedWithLiChunk=0
- top-3 (mode B): docs/Reference/Hooks.md (0.473) | test/hooks.on-ready.test.js (0.473) | test/hooks.on-ready.test.js (0.471)

### fastify-026 [mode_b_pushed_gold_off] (fastify, calls, expected_hops=2)
- **query**: where the request payload stream is set into the request before content-type parsing
- **gold**: lib/route.js (symbols: runPreParsing)
- **rankNone=602, rankExpand=-1, goldAddedByExpansion=false**
- expansion: mode=2hop, expanded=0, expandedWithLiChunk=0
- top-3 (mode B): docs/Reference/Hooks.md (0.508) | docs/Reference/ContentTypeParser.md (0.479) | docs/Guides/Getting-Started.md (0.473)

### fastify-004 [graph_seed_missing] (fastify, route, expected_hops=2)
- **query**: how does fastify scope the not-found handler context when a plugin is mounted with a prefix
- **gold**: lib/four-oh-four.js (symbols: arrange404, setContext)
- **rankNone=-1, rankExpand=-1, goldAddedByExpansion=false**
- expansion: mode=2hop, expanded=0, expandedWithLiChunk=0
- top-3 (mode B): test/404s.test.js (0.525) | test/404s.test.js (0.509) | test/404s.test.js (0.503)

### fastify-062 [graph_seed_missing] (fastify, calls, expected_hops=1)
- **query**: closes any tracked HTTP/2 sessions when the framework shuts down on older Node versions
- **gold**: lib/server.js (symbols: createCloseHttp2SessionsByHttp2Server)
- **rankNone=-1, rankExpand=-1, goldAddedByExpansion=false**
- top-3 (mode B): 

### fastify-080 [graph_seed_missing] (fastify, control, expected_hops=0)
- **query**: definition of FST_ERR_HOOK_TIMEOUT
- **gold**: lib/errors.js (symbols: FST_ERR_HOOK_TIMEOUT)
- **rankNone=-1, rankExpand=-1, goldAddedByExpansion=false**
- expansion: mode=2hop, expanded=2, expandedWithLiChunk=1
- top-3 (mode B): types/errors.d.ts (0.531) | .github/labeler.yml (0.500,exp) | types/errors.d.ts (0.498)

### fastify-088 [graph_seed_missing] (fastify, control, expected_hops=0)
- **query**: how Fastify exposes the FastifyError-like classes including @fastify/error createError calls
- **gold**: lib/errors.js (symbols: codes)
- **rankNone=-1, rankExpand=-1, goldAddedByExpansion=false**
- top-3 (mode B): 

### flask-080 [graph_seed_missing] (flask, extends, expected_hops=1)
- **query**: Where is the outgoing envelope subclass with a default text/html mimetype declared?
- **gold**: src/flask/wrappers.py (symbols: Response)
- **rankNone=-1, rankExpand=-1, goldAddedByExpansion=false**
- top-3 (mode B): 
