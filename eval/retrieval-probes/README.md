# Retrieval-quality probes

Curated 20-query regression gate for sweet-search's retrieval layer.

## Why this exists

Agent-in-the-loop benches (`eval/agent-read-workflows/`) are slow, model-dependent, and noisy at small N. This probe set runs in **under 60 seconds** with no agent and no judge, against pinned bench repos, and grades top-1 deterministically against expected file/symbol/type. It's the regression gate to run **before** committing retrieval changes.

## Probe set

20 queries across `fastify`, `gin`, and `ripgrep`, mixing:
- explicit symbol lookups (e.g., "what is kSchemaController")
- abstract behaviour questions (e.g., "how does Gin redirect on trailing slash")
- multi-file flows (e.g., "where is the route handler invoked after pre-handler hooks")
- entity-kind queries (e.g., "what enum represents output mode")

The probes were collected from real failure investigations during the May 2026 retrieval refactor. They are NOT the optimization target — they're a canary set. Adding fixes that pass these probes but break unseen queries is exactly the failure mode the broader QE process is designed to catch.

## Usage

```bash
# All 20 probes
node eval/retrieval-probes/run-probes.mjs

# One repo
node eval/retrieval-probes/run-probes.mjs --repo=fastify

# One probe
node eval/retrieval-probes/run-probes.mjs --id=S2-Q3

# Save artifact + diff against baseline
node eval/retrieval-probes/run-probes.mjs --json eval/retrieval-probes/results-current.json
node eval/retrieval-probes/run-probes.mjs --baseline eval/retrieval-probes/results-current.json
```

Exit codes:
- `0` — all PASS
- `1` — at least one FAIL (no baseline supplied)
- `3` — at least one regression vs baseline

## Grading rubric

Top-1 only. Each probe carries:
- `expectedFile` (string) or `expectedFileAnyOf` (array)
- optional `expectedSymbol` / `expectedSymbolAnyOf`
- optional `expectedSymbolType` / `expectedSymbolTypeAnyOf`

Verdicts:
- `PASS`: top-1 file matches AND symbol matches (if specified) AND type matches (if specified)
- `PARTIAL`: file matches but symbol/type does not (still useful, less precise)
- `FAIL`: top-1 file does not match expected

## When to update the probe set

- Add a probe when a real query failure is fixed and you want a regression canary for it.
- Don't tweak `expectedFile`/`expectedSymbol` to match the current behaviour; that's overfitting. The expected set should encode the human-correct answer, not what the system happens to return today.
- Probes whose `notes` say "currently fails" are documented gaps. Removing them once fixed is fine; loosening the `expected*` to match a wrong answer is not.

## Repo dependency

Requires the bench repos under `eval/repos/{fastify,gin,ripgrep}/` with their `.sweet-search/` indexes. If a repo is missing, those probes fail with reason `repo_missing` rather than crashing.
