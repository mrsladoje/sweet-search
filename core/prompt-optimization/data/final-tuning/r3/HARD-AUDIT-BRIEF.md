# r3-hard audit brief (final audit before the hard split is frozen)

Input per repo: the draft file (`r3/hard-drafts/<repo>.json` or `r3/hard-drafts-b/<repo>.json`), the
verifier flags (`r3/hard-verify/<repo>.json` or `r3/hard-verify-b/<repo>.json`: per question, two
non-Claude models answered from the (TRUNCATED) gold files and marked each fact supported /
unsupported — treat these as FLAGS, not verdicts), and the closed-book screen
(`r3/hard-drafts*/closed-book.json`: `drop: true` = a model named the gold files + symbols WITHOUT
seeing code → the question is too easy or memorised).

For every question of your repos:
1. **Closed-book `drop: true`** → drop (reason "closed-book solvable"), unless you can harden it so the
   gold is no longer guessable (then rewrite the query and mark it "hardened").
2. **Facts flagged unsupported by BOTH verifiers** → read the code. If the fact is wrong or overstated,
   correct it to exactly what the code shows; if the question depends on it and it cannot be fixed, drop.
   Facts flagged by ONE verifier only: spot-check (often truncation).
3. **Hardness (HARD-DRAFTING-BRIEF.md + ADDENDUM):** no identifier / literal / config key / error text
   from the answer in the query; the cheapest route in `notes` really needs ≥ 4 dependent steps. If a
   question is a 1–3 step lookup in disguise, harden or drop. Keep the stratum mix.
4. **Unambiguous + gradeable:** exactly one correct answer set (if two places are equally right, both are
   gold); 3–6 atomic facts with 1–2 "CRITICAL:"; gold = production code. Negatives: verify absence with
   ≥ 3 greps and that the named decoy really does not do the asked thing.
5. Do not make questions easier. Do not add identifiers.

Rules: never use `ss-*` / `sweet-search` tools, never open `.sweet-search/`, never touch
`eval/task-completion-bench/` or files named `tasks_heldout2*`. Clones are read-only. Do not edit the
drafts. No paid APIs.

Output per repo: `r3/hard-audit/<repo>.json` =
`{ "repo": "...", "keep": [ids], "fixes": { "id": { "query"?, "expectedFacts"?, "expectedFiles"?, "expectedSymbols"?, "expectedNoMatch"? } }, "dropped": { "id": "reason" }, "hardened": [ids] }`
Final message: per repo kept / fixed / hardened / dropped, and any systematic problem.
