# boundary-check report

## Done
- scripts/check-boundaries.js T1: removed every execSync/grep call. core/ *.js/*.mjs files are read once in-process; checks 1-3 filter that list. Walker for checks 4-5 skips big non-code dirs under eval/ (repos, corpus, task-completion-bench/results, maxsim-bench/venv, venv-prep, ast-tester-probes/_repos). Wall time 201 s -> 0.5 s.
- T1 equality: SCRATCH/boundaries-after-speedup.txt (speed-up only, old rules, old blanket exemption) is identical to boundaries-before.txt after sorting (3 OK lines, 70 internal, 602 external, exit 0). Only line ORDER differs (grep order vs sorted walk).
- scripts/check-boundaries.js T2: DOMAINS += agent-tools, incremental-indexing (12 domains). They have no index.js, so they are excluded from barrel-only checks 3 and 4 (NO_BARREL_DOMAINS/BARREL_DOMAINS); otherwise every import would be a bypass warning. New direction rules (12 rules total): agent-tools/ added to the forbidden list of infrastructure, vector-store, embedding, query, ranking, graph, vocabulary, indexing; core/agent-tools -> prompt-optimization, training; core/incremental-indexing -> search, query, prompt-optimization, agent-tools. New exceptions (with max = today's count): search -> agent-tools 3; indexing -> incremental-indexing 30; incremental-indexing -> indexing 16; indexing -> search 3; prompt-optimization -> indexing 1.
- docs/DDD_ARCHITECTURE.md: overview count (11 runtime + 1 build-time = 12), matrix rows for agent-tools and incremental-indexing and the new forbidden columns, exceptions 6-9, exception 1 max 7 -> 8 (encoder-host.mjs), allowlist snippet max 2 -> 8, "Honest Assessment" count, last-updated date.
- tests/integration/boundary-enforcement.test.js: timeout 900 s -> 60 s (run takes ~0.5 s), comment updated; new negative test (vocabulary -> agent-tools is caught).

## Not done / differences to know
- Exemption logic was a bug. Old rule: a line was excepted when it contained the exception's `from` folder and the forbidden target, with the exception's own `to` never compared. So an indexing -> ranking exception silently exempted every forbidden import under core/indexing/ (and likewise core/query, core/prompt-optimization). I made it precise (line under exc.from AND exc.to equals the forbidden target). This exposed 4 hidden violations, now declared as exceptions with max = today's count (not edited in product code):
  - core/indexing/rss-budget.mjs:56 (../search/daemon-registry.js), core/indexing/worktree-index.mjs:57 (../search/daemon-client.js), :62 (../search/server-identity.js) -> exception "indexing -> search" max 3.
  - core/prompt-optimization/scripts/preprocess.mjs:30 (../../indexing/ast-chunker.js) -> "prompt-optimization -> indexing" max 1.
- Check 1 now scans only .js/.mjs (grep scanned every file type, including data and binaries). Before and after reports are the same today.
- Skipped eval dirs: no warning or Sealed-1 hit came from them in the "before" run (0 matches).
- Counts: indexing -> incremental-indexing is 30 (23 static + 7 dynamic), incremental-indexing -> indexing is 16 (not 31/14 as in the brief). Matching is single-line `from '...'` / `import('...')` as before; multi-line dynamic imports are not seen.
- search -> agent-tools sites (3): core/search/agent-span-ledger.js:12 (chain.js), core/search/search-server.js:1014 (daemon-route.js), :2101 (tools.js). Matches the allowed set.
- Rules that held with no exception: incremental-indexing does not import search/query/prompt-optimization; agent-tools does not import prompt-optimization/training; nothing else imports agent-tools.

## Behavior questions
- None for product behavior. Output format of the script is unchanged.

## Needs follow-up
- The lead may want to remove the 4 newly declared hidden violations later (indexing -> search 3 sites; preprocess.mjs). Research file preprocess.mjs was not touched.

## Verification
- `time node scripts/check-boundaries.js`: 0.54 s wall, exit 0. Last 8 lines:
  70 internal barrel bypass(es) within core/. / 602 external barrel bypass warning(s). / Run with --fix-hints for migration suggestions. / Run with --strict-external to escalate these to CI errors. / (blank) / All domain boundaries clean. / Checked: 12 domains, 12 direction rules, barrel-only enforcement (external + internal). / 70 internal, 602 external barrel bypass warning(s) — not blocking.
- `npx vitest run tests/integration/boundary-enforcement.test.js`: 1 file, 5 tests passed, 2.8 s.
- `node --check scripts/check-boundaries.js` and the test file: clean. Files saved: SCRATCH/boundaries-before.txt, boundaries-after-speedup.txt, boundaries-final.txt.
