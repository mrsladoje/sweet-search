# Path/file-type demotion offline test

Generated: 2026-05-03T11:20:18.198Z
Records source: graph2hop_records.json  (295 usable)
Demotion factors: doc=0.4, test=0.4, type=0.5
Intent gating: skip demotion when query mentions doc/test/type-seeking keywords.

## Headline

| metric | baseline | with demotion | delta |
|---|---:|---:|---:|
| Recall@1  | 140/295 (47.46%) | 188/295 (63.73%) | 48 |
| Recall@10 | 243/295 (82.37%) | 243/295 (82.37%) | 0 |
| MRR@10    | 58.99% | 70.54% | +11.55pp |

Rescue (top10 with demotion that wasn't with baseline): **0**
Harm (top10 with baseline that isn't with demotion): **0**
Identical rank in both: **226**/295
Queries where the rule fired (any demotion in top10): **219**/295

## Query intent distribution

| intent | n |
|---|---:|
| docs  | 1 |
| tests | 2 |
| types | 19 |
| none  | 273 |

## Rank flips

Total queries with a different rank under demotion: **69**

- gold rank improved (positive delta): 68
- gold rank worsened (negative delta): 1
- new gold-in-top10 (was ≤0 → now in): 0
- new gold-not-in-top10 (was in → now out): 0

### 10 representative flips

- `fastify-008` (fastify) base=2 → demote=1 (Δ=1)
  - query: *"what generates per-request unique ids when an incoming HTTP request arrives"*  intent={docs:n,tests:n,types:n}
  - top3 base: `Server.md | req-id-gen-factory.js | Logging.md`
  - top3 demote: `req-id-gen-factory.js | Server.md | Logging.md`
- `fastify-011` (fastify) base=7 → demote=2 (Δ=5)
  - query: *"the function called when a payload thrown from an async handler resolves successfully"*  intent={docs:n,tests:n,types:n}
  - top3 base: `Routes.md | TypeScript.md | TypeScript.md`
  - top3 demote: `content-type-parser.js | wrap-thenable.js | instance.d.ts`
- `fastify-016` (fastify) base=3 → demote=1 (Δ=2)
  - query: *"where is the singleton 404 router built by the FindMyWay library"*  intent={docs:n,tests:n,types:n}
  - top3 base: `404s.test.js | Server.md | four-oh-four.js`
  - top3 demote: `four-oh-four.js | four-oh-four.js | four-oh-four.js`
- `fastify-019` (fastify) base=2 → demote=1 (Δ=1)
  - query: *"where is the last-resort fallback that bypasses user error handling and writes the raw response"*  intent={docs:n,tests:n,types:n}
  - top3 base: `Reply.md | error-handler.js | Reply.md`
  - top3 demote: `error-handler.js | error-handler.js | reply.js`
- `fastify-020` (fastify) base=5 → demote=2 (Δ=3)
  - query: *"central dispatcher that selects the parent prototype error function and unwinds on rethrow"*  intent={docs:n,tests:n,types:n}
  - top3 base: `error-serializer.js | errors.d.ts | errors.d.ts`
  - top3 demote: `error-serializer.js | error-handler.js | error-handler.js`
- `ripgrep-039` (ripgrep) base=1 → demote=5 (Δ=-4)
  - query: *"renderer for the long-form usage banner emitted when the user passes -h on the command line"*  intent={docs:n,tests:n,types:n}
  - top3 base: `help.rs | defs.rs | help.rs`
  - top3 demote: `defs.rs | bash.rs | rg.zsh`

## Per-repo Recall@10

| repo | n | baseline | with demotion | delta |
|---|---:|---:|---:|---:|
| fastify | 95 | 63.16% | 63.16% | 0 |
| flask | 100 | 94.00% | 94.00% | 0 |
| ripgrep | 100 | 89.00% | 89.00% | 0 |
