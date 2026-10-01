# r3-hard — question drafting brief (one agent per repo)

r3-hard extends the r3 code-retrieval benchmark with HARD questions. r3 turned out too easy: native
Opus answers 95% correctly with a median of 3 tool calls. Your questions must need real
investigation: **target — a strong agent with grep and file reading gets only ~60–80% right and needs
6–15 tool calls.** An agent answers with the file path(s) + symbol(s) + one to three sentences (or
"No match found.") and is graded against your gold (judge panel, partial credit per fact).

## What makes a question hard (use these; every question must use at least one, most two)

| Type (`stratum`) | Per repo | What it demands |
|---|---|---|
| `chain` | 6 | a 3–5 hop chain across ≥ 3 files (entry → dispatch → handler → effect/config). Gold = EVERY hop's file+symbol; facts state each link. |
| `completeness` | 5 | "every place where X is enforced / validated / handled / cleaned up" — 3–6 gold locations, each a fact. Not a list grep can produce from one identifier. |
| `decoy` | 4 | several plausible candidates exist (a wrapper, a test helper, a deprecated or unused path, a same-named function in another module, a doc example); the question contains the detail that makes exactly one correct. Name the decoys in `notes`. |
| `cross-layer` | 4 | the question uses user/config/CLI/protocol vocabulary; the deciding code lives in an internal layer with different names (no identifier from the answer appears in the question, and the obvious grep terms lead elsewhere). |
| `condition` | 3 | "under which condition / why does X happen / what decides Y" — the agent must read and reason about the logic (branches, ordering, defaults, precedence), not just locate a file. Facts state the condition precisely. |
| `negative-decoy` | 2 | the feature looks present (dead code, an unused helper, a flag that is parsed but never read, a config key that is ignored) but the asked behaviour does not happen. Gold: `expectedNoMatch: true` + facts saying what exists and why it does not do the asked thing. |

24 questions per repo. Do NOT write questions a single grep of an obvious word answers.

## Rules (same as r3, stricter)

- Read the code yourself (Read, Grep, Glob, rg, sed). **No `ss-*` / `sweet-search` tools**, never open `.sweet-search/`.
- **Never put an identifier from the answer into the question.** Domain words only. No code quotes.
- **Do not reuse or paraphrase the existing r3 questions** for your repo: read `r3/r3-probes.json` (filter by your repo) and pick different mechanisms/areas.
- Gold = production source (not tests/docs/fixtures/generated) unless the question asks about them.
- Answerable from the repository alone. Unambiguous: one correct answer set (if two places are equally right, both are gold).
- Every gold file, symbol and fact verified by reading; `notes` = exact file:line evidence (+ the decoys, + ≥ 3 greps for negatives).
- Facts: 3–6 short checkable claims (chain/completeness: one per hop/location).

## Gold JSON (same schema as r3)

```json
{"id": "r3h-<repo>-NN", "repo": "<repo>", "language": "...", "stratum": "chain|completeness|decoy|cross-layer|condition|negative-decoy",
 "difficulty": "hard", "query": "...", "expectedFiles": ["..."], "expectedSymbols": ["..."],
 "expectedFacts": ["..."], "expectedNoMatch": false, "max_turns": 15, "tier": "r3-hard",
 "author": "r3h-<repo>-drafter", "date": "2026-10-01", "notes": "VERIFICATION: …"}
```

Output: `r3/hard-drafts/<repo>.json` = `{ "repo": "<repo>", "sha": "<commit>", "probes": [ … 24 … ] }`.
Final message: counts per stratum + the 5 hardest (id + why) + how many tool calls you think a strong agent needs on average.
