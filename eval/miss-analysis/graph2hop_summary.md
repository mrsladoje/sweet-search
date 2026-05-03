# Graph-2hop Real-Repo Miss Summary

Generated: 2026-05-03T11:07:18.204Z
Total queries: 300
Repos: fastify, flask, ripgrep
Mode A (none): graphExpand=none, expand=false
Mode B (2hop-adaptive): graphExpand=2hop, adaptiveHop2=true, expand=true
use3Stage=true

## Headline numbers

| metric | mode A (none) | mode B (2hop-adaptive) |
|---|---|---|
| Recall@1  | 140/295 (47.46%) | 140/295 (47.46%) |
| Recall@10 | 243/295 (82.37%) | 243/295 (82.37%) |

Rescue (mode B top10 but mode A miss): **1**
Harm (mode A top10 but mode B miss): **1**
Identical rank in both modes: **281**/295
Queries where graph expansion produced any surviving expanded entry: **230**/295
Queries where gold was *added by expansion* (is_expanded=true): **4**/295

## Buckets (mode B, 2hop-adaptive)

| bucket | count | share |
|---|---|---|
| hit_top10 | 243 | 82.37% |
| graph_seed_missing | 28 | 9.49% |
| reranker_demoted_gold | 20 | 6.78% |
| graph_added_gold_but_reranker_lost | 3 | 1.02% |
| gold_present_without_graph_but_expansion_harmed | 1 | 0.34% |

## Per-repo bucket distribution

| repo | hit_top10 | reranker_demoted | mode_b_pushed_off | graph_seed_missing | graph_added_lost | other |
|---|---|---|---|---|---|---|
| fastify | 60 | 16 | 0 | 16 | 3 | 0 |
| flask | 94 | 2 | 0 | 4 | 0 | 0 |
| ripgrep | 89 | 2 | 0 | 8 | 0 | 1 |

## Top-10 hit rate by category

| category | hits/total | rate |
|---|---|---|
| calls | 97/114 | 85.09% |
| config | 22/24 | 91.67% |
| control | 44/56 | 78.57% |
| extends | 5/7 | 71.43% |
| implements | 41/42 | 97.62% |
| imports | 2/2 | 100.00% |
| other | 0/1 | 0.00% |
| parser | 11/14 | 78.57% |
| route | 9/14 | 64.29% |
| validator | 12/21 | 57.14% |

## Graph expansion behavior

- mean expanded entries surviving in result list: **6.071**
- mean LI rerank pool size: **0.00**
- mean expanded-in-pool slot usage: **0.000**
- queries with cascade actually invoked: **0**

Interpretation: under the validated graph benchmark profile (use3Stage=false because test repos have mixed-dim float vectors), the cascade rerank never runs and graph expansion contributes ~0 entries per query. **Mode B output is essentially identical to mode A output.**

## Representative misses (15)

### fastify-006 [reranker_demoted_gold] (fastify, control, expected_hops=0)
- **query**: definition of FST_ERR_NOT_FOUND error
- **gold**: lib/errors.js (symbols: FST_ERR_NOT_FOUND)
- **rankNone=24, rankExpand=24, goldAddedByExpansion=false**
- expansion: mode=2hop, expanded=0, expandedWithLiChunk=0
- top-3 (mode B): types/errors.d.ts (0.581) | types/errors.d.ts (0.576) | types/errors.d.ts (0.575)

### fastify-007 [reranker_demoted_gold] (fastify, control, expected_hops=0)
- **query**: where is the lifecycle hook list that drives onRequest preParsing preValidation preHandler
- **gold**: lib/hooks.js (symbols: lifecycleHooks)
- **rankNone=15, rankExpand=15, goldAddedByExpansion=false**
- expansion: mode=2hop, expanded=10, expandedWithLiChunk=10
- top-3 (mode B): docs/Reference/Lifecycle.md (0.555) | test/hooks.test.js (0.549) | types/hooks.d.ts (0.546)

### fastify-014 [reranker_demoted_gold] (fastify, control, expected_hops=0)
- **query**: where is FST_ERR_VALIDATION constructed and given its 400 status
- **gold**: lib/errors.js (symbols: FST_ERR_VALIDATION)
- **rankNone=18, rankExpand=18, goldAddedByExpansion=false**
- expansion: mode=2hop, expanded=4, expandedWithLiChunk=4
- top-3 (mode B): types/errors.d.ts (0.507) | types/errors.d.ts (0.491) | test/validation-error-handling.test.js (0.484)

### fastify-015 [reranker_demoted_gold] (fastify, validator, expected_hops=1)
- **query**: helper that attaches statusCode 400 and a validationContext label to a schema-rejected payload
- **gold**: lib/validation.js (symbols: wrapValidationError)
- **rankNone=14, rankExpand=14, goldAddedByExpansion=false**
- expansion: mode=2hop, expanded=4, expandedWithLiChunk=4
- top-3 (mode B): test/schema-feature.test.js (0.462) | test/validation-error-handling.test.js (0.456) | test/validation-error-handling.test.js (0.444)

### fastify-028 [reranker_demoted_gold] (fastify, calls, expected_hops=2)
- **query**: where is the keepAliveConnections set tracked so sockets close on shutdown
- **gold**: lib/route.js (symbols: routeHandler, removeTrackedSocket)
- **rankNone=13, rankExpand=13, goldAddedByExpansion=false**
- expansion: mode=2hop, expanded=10, expandedWithLiChunk=10
- top-3 (mode B): test/close.test.js (0.455) | test/close.test.js (0.452) | docs/Reference/Server.md (0.448)

### fastify-010 [graph_seed_missing] (fastify, calls, expected_hops=2)
- **query**: how does encapsulation duplicate the lifecycle handler arrays so child plugins do not pollute the parent instance
- **gold**: lib/hooks.js (symbols: buildHooks)
- **rankNone=-1, rankExpand=-1, goldAddedByExpansion=false**
- expansion: mode=2hop, expanded=4, expandedWithLiChunk=4
- top-3 (mode B): docs/Guides/Plugins-Guide.md (0.521) | docs/Guides/Plugins-Guide.md (0.517) | test/hooks.test.js (0.501)

### fastify-012 [graph_seed_missing] (fastify, calls, expected_hops=2)
- **query**: where the route configuration is canonicalized and the query alias is mapped to querystring before validators are compiled
- **gold**: lib/schemas.js (symbols: normalizeSchema)
- **rankNone=-1, rankExpand=-1, goldAddedByExpansion=false**
- expansion: mode=2hop, expanded=10, expandedWithLiChunk=10
- top-3 (mode B): test/internals/request-validate.test.js (0.495) | test/internals/validation.test.js (0.484) | test/internals/request-validate.test.js (0.482)

### fastify-013 [graph_seed_missing] (fastify, calls, expected_hops=2)
- **query**: what runs the chain of preValidation user callbacks before AJV is invoked
- **gold**: lib/hooks.js (symbols: preValidationHookRunner, hookRunnerGenerator)
- **rankNone=-1, rankExpand=-1, goldAddedByExpansion=false**
- expansion: mode=2hop, expanded=10, expandedWithLiChunk=10
- top-3 (mode B): docs/Reference/TypeScript.md (0.471) | types/instance.d.ts (0.466) | lib/handle-request.js (0.459)

### fastify-025 [graph_seed_missing] (fastify, calls, expected_hops=1)
- **query**: what executes application-level callbacks like onReady recursively across child encapsulated instances
- **gold**: lib/hooks.js (symbols: hookRunnerApplication)
- **rankNone=-1, rankExpand=-1, goldAddedByExpansion=false**
- expansion: mode=2hop, expanded=0, expandedWithLiChunk=0
- top-3 (mode B): test/hooks.on-ready.test.js (0.495) | test/hooks.on-ready.test.js (0.488) | test/hooks.on-listen.test.js (0.477)

### fastify-026 [graph_seed_missing] (fastify, calls, expected_hops=2)
- **query**: where the request payload stream is set into the request before content-type parsing
- **gold**: lib/route.js (symbols: runPreParsing)
- **rankNone=-1, rankExpand=-1, goldAddedByExpansion=false**
- expansion: mode=2hop, expanded=2, expandedWithLiChunk=2
- top-3 (mode B): docs/Reference/Hooks.md (0.510) | lib/content-type-parser.js (0.482) | docs/Guides/Getting-Started.md (0.474)

### fastify-048 [graph_added_gold_but_reranker_lost] (fastify, route, expected_hops=2)
- **query**: the prototype method that lets a route handler manually trigger the encapsulated 404 path
- **gold**: lib/reply.js (symbols: callNotFound, notFound)
- **rankNone=-1, rankExpand=56, goldAddedByExpansion=true**
- expansion: mode=2hop, expanded=8, expandedWithLiChunk=8
- top-3 (mode B): docs/Reference/Server.md (0.502) | test/404s.test.js (0.492) | docs/Reference/Server.md (0.483)

### fastify-090 [graph_added_gold_but_reranker_lost] (fastify, validator, expected_hops=1)
- **query**: where the hook registration api validates async handler arity for onRequestAbort and onSend variants
- **gold**: fastify.js (symbols: addHook)
- **rankNone=-1, rankExpand=31, goldAddedByExpansion=true**
- expansion: mode=2hop, expanded=10, expandedWithLiChunk=9
- top-3 (mode B): test/hooks-async.test.js (0.471) | test/hooks-async.test.js (0.471) | types/hooks.d.ts (0.463)

### fastify-091 [graph_added_gold_but_reranker_lost] (fastify, route, expected_hops=1)
- **query**: the api method that prepares routes for HTTP custom verbs and decorates a shorthand on the instance
- **gold**: fastify.js (symbols: addHttpMethod)
- **rankNone=-1, rankExpand=45, goldAddedByExpansion=true**
- expansion: mode=2hop, expanded=10, expandedWithLiChunk=10
- top-3 (mode B): types/route.d.ts (0.483) | types/route.d.ts (0.471) | docs/Reference/TypeScript.md (0.471)
