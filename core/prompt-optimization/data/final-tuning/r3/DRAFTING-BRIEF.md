# r3 — question drafting brief (one agent per repo)

r3 is a NEW code-retrieval benchmark for coding agents. An agent gets one question about a
repository and must answer with the file path(s) + symbol(s) that answer it and one to three
sentences on how they answer it (or "No match found."). It is graded against your gold.

## Goal: hard, realistic, unambiguous

- **Realistic:** questions an engineer or coding agent actually needs answered before changing code
  in this repo: "where is X decided/enforced", "how does a request/value get from A to B", "which
  component is responsible for Y", "where would I change Z".
- **Hard because a human judges them hard** — not tricky wording. Target: a strong agent with grep
  and file reading gets ~60–85% right. Hardness comes from: multiple hops across files, no
  greppable identifier in the question, the obvious-looking file being the wrong one (a wrapper,
  a test, a doc, a similarly named module), the answer living in a different layer than the
  question's vocabulary.
- **Unambiguous:** exactly one correct answer set. If two places could reasonably be "the" answer,
  either make both part of the gold or rephrase so one is clearly meant.

## Mix per repo (draft 36 questions)

| Type (`stratum`) | Count | Description |
|---|---|---|
| `multi-hop` | 9 | trace caller → callee → config/handler across ≥ 2 files; gold = the files/symbols of the chain the question asks for (usually the final hop + the link) |
| `concept` | 8 | behaviour described in plain words, no identifier from the code in the question |
| `enforcement` | 8 | "where is X validated / enforced / rejected / limited / authorized" — the place the rule is actually checked, not where it is declared or documented |
| `locate-explain` | 5 | a specific mechanism (retry, caching, ordering, escaping, parsing …) — where it lives and what decides its behaviour |
| `negative` | 6 | a plausible feature this repo does NOT have (it is common in similar projects). Gold: `expectedNoMatch: true`, and `expectedFacts` state what the repo has instead / how you verified absence |

## Rules

- Read the code yourself (Read, Grep, Glob, `rg`, `sed`). **Do not use any `ss-*` or `sweet-search`
  tool**, and do not open any `.sweet-search/` folder.
- **Never put an identifier from the answer into the question** (function, class, file, config key
  names). Use domain words a user would use. Do not quote code.
- Do not use tests, docs, examples, changelogs or generated files as the gold, unless the question
  explicitly asks about them. Gold is production source.
- Every question must be answerable from the repository alone (no web, no git history).
- Negative questions must be genuinely absent: check with at least 3 different greps (synonyms)
  and state them in `notes`. Avoid features that exist in a dependency the repo vendors.
- Keep questions independent (no "the function from the previous question").
- One or two sentences per question. English.

## Gold per question (JSON, same schema as the r282 probes)

```json
{
  "id": "r3-<repo>-NN",
  "repo": "<repo short name from repos.json>",
  "language": "<Language>",
  "stratum": "multi-hop|concept|enforcement|locate-explain|negative",
  "difficulty": "medium|hard",
  "query": "…",
  "expectedFiles": ["path/relative/to/repo/root.ext", "…"],
  "expectedSymbols": ["SymbolName", "Type.method", "…"],
  "expectedFacts": ["2–4 short checkable claims, each verifiable by reading the gold code (what it does, what decides it)"],
  "expectedNoMatch": false,
  "max_turns": 6,
  "tier": "r3",
  "author": "r3-<repo>-drafter",
  "date": "2026-10-01",
  "notes": "VERIFICATION: exact file:line evidence for every expected file/symbol/fact (and the greps for negatives)."
}
```

`expectedFiles` / `expectedSymbols`: the minimal set a correct answer must name (1–3 files usually).
`expectedFacts`: claims a grader can check against an answer; no claim that needs running code.

## Output

Write `r3/drafts/<repo>.json` = `{ "repo": "<repo>", "sha": "<commit>", "probes": [ … 36 … ] }`.
Final message: counts per stratum, and the 5 questions you think are hardest (id + one line why).
