# r3-hard2 — DEV-ONLY deep questions (one agent per repo)

r3-hard2 is a DEV-ONLY tuning set. It is never part of a held-out claim. The frozen r3-hard set
(`r3/r3-hard-probes.json`, sha 09b0ab9f…) stays unchanged.

## Why a second set (measured, 2026-10-01 pilot, 20 r3-hard dev questions, native Claude Code + Opus 5.5)

- Native Opus answered 84% correctly with a MEDIAN OF 4 TOOL CALLS (range 2–7). The drafters had
  estimated 6–8 turns. Target for r3-hard2: **median ≥ 7 tool calls for native Opus**, accuracy 55–80%.
- Opus runs **several greps / reads in ONE shell call** (`grep … ; grep … ; sed -n …`). A route step
  therefore costs a call ONLY when the agent cannot know the next search term before it reads the
  output of the previous step. "≥ 4 steps" that are independent greps collapse into 1–2 calls.
- Questions whose whole answer sits in one central function or one file cost 2–4 calls, whatever the
  stratum. Negative questions scored 1.0 with 4–6 calls (do not write them for r3-hard2).

Pilot examples (dev, calls / score): a 3-hop "trace how the opt-in parameter reaches the regex
function" chain = 3 calls / 0.85; "how does a write-listener refusal become an error the caller sees" =
4 / 0.7; "every place where the converter decides which re-export name is canonical" = 7 / 0.8.

## The binding design rule: CONTENT-GATED HOPS

A hop is **content-gated** when the search term for the next hop appears ONLY inside code the agent
must read in the previous hop (a function BODY, a table, a registration call's argument, a map/registry
entry, a value assigned in a constructor, a function passed as a callback, an enum value handled in a
switch) — and NOT in the question, NOT in the domain words, and NOT in the grep hit line of the previous
step. Each content-gated hop forces a new tool call.

Every question needs **≥ 5 content-gated hops**, or **≥ 6 gold locations in ≥ 4 files in ≥ 3
directories** that do NOT share one searchable token, or both.

Mechanisms that create content-gated hops (use them):
- registries, routing / command / handler tables, plugin or codec maps, dependency injection,
  decorators / annotations / macros / derive, code generation tables;
- a callback or strategy object passed through 2+ layers and invoked far from where it is set;
- a default set in one layer, overridden in another, read in a third (precedence questions);
- interface / trait / protocol dispatch where the concrete type is chosen at runtime by data;
- middleware / interceptor / hook ordering; event-bus subscribe → publish;
- platform files, build tags, feature flags, version branches (the default path is the decoy).

Avoid: one function that holds all the facts; a call chain whose names a single `grep -n` of the first
function shows; "list every X" where X is one identifier; answers in docs, comments, tests or README.

## Self-check (write it in `notes`, the question is invalid without it)

`ROUTE:` the cheapest route for an agent that may run up to 5 greps/reads in ONE call. Mark each
content-gated hop with `[G]` and say which read revealed the next term. Then `MIN CALLS: N` (count
only calls that must wait for the previous output). **N must be ≥ 7.** Then `FIRST CALL:` the 5 greps
the agent would run from the question's own words, and confirm they reach at most ONE gold file.

## Mix (8 questions per repo)

| Stratum | Count | Notes |
|---|---|---|
| `chain` | 4 | ≥ 5 content-gated hops; gold = every hop's file + symbol; one fact per hop |
| `completeness` | 2 | 6–8 locations, different names, different layers |
| `condition` | 2 | the decision depends on logic spread over ≥ 3 functions in ≥ 2 files (defaults, precedence, ordering) |

No negative questions. Use the repo's less-central subsystems as well as its core.

## Rules (unchanged from r3-hard)

- Read the code yourself (Read, Grep, Glob, rg, sed). **No `ss-*` / `sweet-search` tools**, never open
  `.sweet-search/`. Never touch `eval/task-completion-bench/` or files named `tasks_heldout2*`.
- **No identifier, string literal, error message, config key, CLI flag, env var or numeric constant
  from the code in the question.** Domain words only.
- **No overlap:** read `r3/r3-probes.json` and `r3/r3-hard-probes.json` (filter by your repo, both
  dev and held-out) and pick DIFFERENT mechanisms and areas. A question that shares a gold file with a
  held-out question must ask about a different mechanism in it.
- Gold = production source. One correct answer set. Every gold file, symbol and fact verified by reading;
  `notes` holds exact file:line evidence and the decoys.
- Facts: 4–6 atomic claims; mark 1–2 with a leading "CRITICAL:".

## Output

`r3/hard2-drafts/<repo>.json` = `{ "repo": "<repo>", "sha": "<commit>", "probes": [ … 8 … ] }`, with
`id` = `r3x-<repo>-NN`, `tier` = `r3-hard2`, `difficulty` = `hard`, `set` = `dev`, `max_turns` = 25,
`author` = `r3x-<repo>-drafter`, `date` = `2026-10-01`, `expectedNoMatch` = false, and the same fields
as r3-hard otherwise (`stratum`, `query`, `expectedFiles`, `expectedSymbols`, `expectedFacts`, `notes`).
Final message: per question `id stratum MIN CALLS`, and the 2 you are least sure are hard enough.
