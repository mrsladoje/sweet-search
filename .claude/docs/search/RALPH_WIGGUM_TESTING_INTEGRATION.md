# Ralph Wiggum Integration for Indexing System Testing

> **Version:** 2.1 (Revised with ChatGPT 5.2 + Claude Code cross-validation)
> **Created:** 2026-01-02
> **Updated:** 2026-01-03
> **Purpose:** Autonomous testing loops for Sweet Search indexing system
> **Cross-Validated:** ChatGPT 5.2 + Cursor AI + Claude Code Opus 4.5

---

## ⚠️ CRITICAL: Pre-Implementation Corrections

Before using these loops, ensure you've read and applied the fixes in
`INDEXING_TESTING_PLAN.md` Section "Plan vs Reality Mismatches":

1. **Hook types**: Use `post-command`, `post-edit`, `post-task`, `post-search` (NOT `pre-task`)
2. **Queue file**: `.sweet-search/index-maintainer-queue.jsonl` (JSONL format)
3. **Git tests**: Must run in isolated temp repo (not real working tree)
4. **Dimensions**: Stored vectors are 512d (not 1024d)
5. **EMB-005**: SKIP - partial batch retry not implemented

---

## What is Ralph Wiggum?

Ralph Wiggum is an **official Anthropic Claude Code plugin** that creates autonomous development loops using Stop hooks. Named after the Simpsons character, it embodies persistent iteration despite setbacks.

### How It Works

1. You provide a task prompt with a completion criterion
2. Claude works on the task
3. When Claude tries to exit, the Stop hook intercepts
4. If completion criteria NOT met, the same prompt is re-injected
5. Loop continues until success or manual cancellation

### Key Commands

| Command | Purpose |
|---------|---------|
| `/ralph-loop "task" --completion-promise "DONE"` | Start autonomous loop |
| `/cancel-ralph` | Stop the loop immediately |
| `/plugin install ralph-wiggum@claude-plugins-official` | Install the plugin |

---

## Installation (CORRECTED)

```bash
# ✅ CORRECT: From within Claude Code terminal
/plugin install ralph-wiggum@claude-plugins-official

# ❌ WRONG: These do NOT work
# npm install -g ralph-wiggum-claude     # INCORRECT
# npm install -g ralph-wiggum            # INCORRECT

# Verify installation:
/plugin list
# Should show: ralph-wiggum@claude-plugins-official (active)
```

### Troubleshooting Installation

If installation fails:
1. Ensure Claude Code is up to date: `/update`
2. Check plugin registry: `/plugin search ralph-wiggum`
3. Try with explicit version: `/plugin install ralph-wiggum@claude-plugins-official@latest`

---

## Testing Loop Configurations

### Loop 1: Full Indexing Benchmark (with State Persistence)

```bash
/ralph-loop "
Run the full indexing benchmark suite with STATE PERSISTENCE.

IMPORTANT: Save progress to .claude/tests/reports/full-index-state.json after EACH codebase.

1. Load state from .claude/tests/reports/full-index-state.json (if exists)
2. Read .claude/docs/search/INDEXING_TESTING_PLAN.md for test specifications
3. For each un-benchmarked codebase (small, medium):
   a. Clean index state (preserve search databases)
   b. Save state with status='in_progress'
   c. Run benchmark with REAL APIs (budget: $2)
   d. Record timing for all 8 phases
   e. Save state with status='complete'
4. After both codebases benchmarked, generate reports/FULL_INDEX_BENCHMARK_RESULTS.md

SAFETY:
- Maximum runtime: 1 hour
- Budget limit: $2 per codebase
- Save state BEFORE each benchmark

When all codebases benchmarked and summary exists, say BENCHMARK_2_COMPLETE
" --completion-promise "BENCHMARK_2_COMPLETE" --max-time 3600
```

**Expected Duration:** 30-45 minutes
**Stop Condition:** Both codebases (small, medium) benchmarked + summary report
**Note:** No large fixture - use Sloth codebase separately for large-scale test

---

### Loop 2: Fallback Chain Testing (42 scenarios)

```bash
/ralph-loop "
Test ALL 42 fallback chains in the indexing system.

CRITICAL: Save progress to .claude/tests/reports/fallback-state.json after EACH scenario.

1. Load state from .claude/tests/reports/fallback-state.json
2. Read .claude/docs/search/INDEXING_TESTING_PLAN.md Section: Fallback Chain Test Suite
3. Test scenarios NOT already in state file (42 total):

   EMBEDDING (7 testable, 1 skipped):
   - EMB-001: voyage_fail -> mistral
   - EMB-002: all_api_fail -> local
   - EMB-003: rate_limit_429 -> backoff
   - EMB-004: circuit_open -> skip_api
   - EMB-005: SKIP (partial batch retry not implemented - entire batch falls back)
   - EMB-006: degraded_10x_slow -> timeout_switch [REAL API]
   - EMB-007: dimension_mismatch -> normalize_or_reject [REAL API]
   - EMB-008: api_recovery -> switch_back_from_local [REAL API]

   HCGS (6):
   - HCGS-001: cerebras_fail -> ollama
   - HCGS-002: ollama_unavailable -> transformers
   - HCGS-003: all_llm_fail -> static
   - HCGS-004: invalid_json -> static
   - HCGS-005: ollama_model_not_pulled -> transformers [REAL API]
   - HCGS-006: transformers_oom -> static

   RERANKING (5):
   - RNK-001: voyage_rerank_fail -> flashrank
   - RNK-002: wasm_error -> js_fallback
   - RNK-003: all_rerank_fail -> unreranked
   - RNK-004: flashrank_wasm_and_js_fail -> unreranked
   - RNK-005: rerank_timeout_5s -> unreranked

   CONCURRENT (2):
   - CONC-001: concurrent_different_fallbacks -> no_race [REAL API]
   - CONC-002: concurrent_api_failures -> shared_circuit [REAL API]

   INDEX (4):
   - IDX-001 through IDX-004

   CACHE (4):
   - CACHE-001 through CACHE-004

   FILE (2):
   - FILE-001: atomic_write_fail -> retry
   - FILE-002: enospc -> error_logged

4. For each scenario:
   - Save state with status='testing' BEFORE test
   - Setup failure scenario (mock or env var)
   - Trigger fallback
   - Verify expected behavior
   - Record pass/fail
   - Save state with status='complete' or status='failed'

5. After all 42 scenarios, generate reports/FALLBACK_CHAIN_TEST_RESULTS.md

SAFETY:
- Maximum runtime: 4 hours
- If stuck on same scenario >10 minutes, mark TIMEOUT and continue
- Budget for real API tests: $3 total

When all 42 scenarios tested and summary exists, say FALLBACK_42_COMPLETE
" --completion-promise "FALLBACK_42_COMPLETE" --max-time 14400
```

**Expected Duration:** 3-4 hours
**Stop Condition:** All 42 fallback scenarios tested + summary report

---

### Loop 3: Incremental Indexing Validation

```bash
/ralph-loop "
Validate incremental indexing functionality.

IMPORTANT: Save progress to .claude/tests/reports/incremental-state.json after EACH test.

1. Load state from .claude/tests/reports/incremental-state.json
2. Read .claude/docs/search/INDEXING_TESTING_PLAN.md Section: Incremental Indexing Test Suite
3. Test all scenarios NOT already in state (11 total):
   - TC-INC-001: Single file change detection
   - TC-INC-002: New file addition
   - TC-INC-003: File deletion handling
   - TC-INC-004: Batch file changes (10 files)
   - TC-INC-005: Hook queue processing
   - TC-INC-006: Merkle state consistency (crash recovery)
   - TC-INC-007: CPU overhead during idle
   - TC-INC-008: Binary HNSW rebuild threshold
   - TC-INC-009: Git branch switch handling [REQUIRES USER ATTENTION]
   - TC-INC-010: External IDE edit detection [REQUIRES 50s WAIT]
   - TC-INC-011: Hook queue overflow (10k entries)

4. For tests marked [REQUIRES USER ATTENTION]:
   - Ask user if they want to run or skip
   - These modify git state or require long waits

5. Generate reports/INCREMENTAL_TEST_RESULTS.md

SAFETY:
- Maximum runtime: 2 hours
- Git operations should be in fixture directory only
- Restore all modified files after each test

When all 11 tests complete and summary exists, say INCREMENTAL_11_COMPLETE
" --completion-promise "INCREMENTAL_11_COMPLETE" --max-time 7200
```

**Expected Duration:** 90-120 minutes
**Stop Condition:** All 11 incremental tests complete + summary report

---

### Loop 4: SOTA Testing Suite (Property-Based + Chaos)

```bash
/ralph-loop "
Run SOTA testing approaches: property-based and chaos engineering.

IMPORTANT: Save progress to .claude/tests/reports/sota-state.json after EACH test.

1. Load state from .claude/tests/reports/sota-state.json
2. Run property-based tests:
   a. Indexing idempotency (20 runs)
   b. Search result stability (50 runs)
3. Run chaos tests:
   a. SIGKILL recovery during indexing
   b. ENOSPC (disk full) graceful failure
   c. Network partition recovery
4. Run differential tests:
   a. Embedding quality across providers [REAL API, $1]
5. Run performance regression detection:
   a. Load/create baseline
   b. Compare current performance
   c. Statistical significance test

Generate reports/SOTA_TEST_RESULTS.md

SAFETY:
- Maximum runtime: 2 hours
- Chaos tests may create temporary ramdisks - cleanup required
- Budget for real API differential tests: $1

When all SOTA tests complete and summary exists, say SOTA_COMPLETE
" --completion-promise "SOTA_COMPLETE" --max-time 7200
```

**Expected Duration:** 1-2 hours
**Stop Condition:** All SOTA tests complete + summary report

---

### Loop 5: Overhead Profiling

```bash
/ralph-loop "
Profile overhead of all system components.

IMPORTANT: Save progress to .claude/tests/reports/overhead-state.json after EACH measurement.

1. Load state from .claude/tests/reports/overhead-state.json
2. Measure hook execution time:
   - session-preheat hook (100 samples)
   - post-edit proto-sync hook (100 samples)
   - Verify NO blocking >5ms
3. Measure daemon overhead:
   - Start index-maintainer daemon
   - Wait 10s stabilization
   - Sample CPU/memory for 5 minutes (1-second intervals)
   - Verify idle CPU <1%
5. Measure search latency distribution:
   - Lexical searches (100 samples)
   - Semantic cached (100 samples)
   - Structural (100 samples)
6. Run extended memory leak test:
   - 1 hour continuous operation
   - Track memory growth
   - Verify <50MB growth

Generate reports/OVERHEAD_PROFILE_RESULTS.md with percentiles.

SAFETY:
- Maximum runtime: 90 minutes (excluding memory leak test)
- Memory leak test adds 70 minutes

When all measurements collected and summary exists, say OVERHEAD_COMPLETE
" --completion-promise "OVERHEAD_COMPLETE" --max-time 10800
```

**Expected Duration:** 2.5-3 hours (with memory leak test)
**Stop Condition:** All overhead measurements collected + summary report

---

## Running the Test Suite

### Recommended Execution Order

| Order | Loop | Duration | Budget |
|-------|------|----------|--------|
| 1 | Overhead Profiling | 2.5-3 hr | $0 |
| 2 | Full Indexing Benchmark | 30-45 min | $2 |
| 3 | Incremental Indexing | 90-120 min | $0 |
| 4 | Fallback Chain Testing | 3-4 hr | $3 |
| 5 | SOTA Testing | 1-2 hr | $1 |
| **Total** | | **8-12 hours** | **$6** |

### Pre-Flight Checklist

Before starting loops:

- [ ] Install Ralph Wiggum: `/plugin install ralph-wiggum@claude-plugins-official`
- [ ] Verify installation: `/plugin list`
- [ ] Create reports directory: `mkdir -p .claude/tests/reports`
- [ ] Create fixtures (or verify existing): `.claude/tests/indexing-validation/fixtures/`
- [ ] Check API keys:
  - [ ] `VOYAGE_API_KEY` set
  - [ ] `CEREBRAS_API_KEY` set
- [ ] Optional: Install Ollama for HCGS fallback testing
  - [ ] `ollama serve` running
  - [ ] `ollama pull qwen2.5-coder:7b-instruct`
- [ ] Budget confirmation: Ready to spend ~$6 on API calls
- [ ] Time availability: 8-12 hours (can run overnight)

### Monitoring Active Loops

```bash
# In another terminal, watch progress:
watch -n 30 'cat .claude/tests/reports/*-state.json | jq ".status, .completed"'

# Check Claude Code logs:
tail -f ~/.claude/logs/claude-code.log

# Monitor system resources:
htop

# Check API spend:
cat .claude/tests/reports/api-spend.json
```

### Canceling a Loop Safely

If a loop goes off-track:

```bash
# In Claude Code:
/cancel-ralph

# Wait for state save confirmation
# Then review: cat .claude/tests/reports/*-state.json
```

**IMPORTANT**: Ralph Wiggum should save state before stopping, but verify by checking the state files.

---

## State Persistence Format

### State File Structure

```json
// .claude/tests/reports/fallback-state.json
{
  "loopName": "fallback-chain-testing",
  "startedAt": "2026-01-03T10:00:00.000Z",
  "lastUpdated": "2026-01-03T12:30:00.000Z",
  "totalScenarios": 42,
  "completed": [
    { "id": "EMB-001", "status": "pass", "duration": 5200, "timestamp": "..." },
    { "id": "EMB-002", "status": "pass", "duration": 3100, "timestamp": "..." },
    // ...
  ],
  "current": {
    "id": "EMB-005",
    "status": "testing",
    "startedAt": "2026-01-03T12:28:00.000Z"
  },
  "failed": [
    { "id": "HCGS-002", "status": "failed", "error": "Ollama not running", "timestamp": "..." }
  ],
  "skipped": [
    { "id": "TC-INC-009", "reason": "User skipped git tests" }
  ]
}
```

### Resume from Crash

If Claude Code crashes mid-loop:

1. State file should have last checkpoint
2. Re-run the same `/ralph-loop` command
3. Loop will load state and continue from `current`

```bash
# Verify state is valid:
cat .claude/tests/reports/fallback-state.json | jq '.completed | length'
# Should show how many scenarios completed

# Resume:
/ralph-loop "[same prompt]" --completion-promise "FALLBACK_42_COMPLETE"
```

---

## Completion Criteria Best Practices

### Good Completion Promises

```
"BENCHMARK_2_COMPLETE"      # Clear, with count
"FALLBACK_42_COMPLETE"      # Specific count
"INCREMENTAL_11_COMPLETE"   # Quantified target
"SOTA_COMPLETE"             # Unambiguous
"OVERHEAD_COMPLETE"         # Unique phrase
```

### Bad Completion Promises (AVOID)

```
"Done"                      # Too vague
"Success"                   # Could match logs
"Tests passed"              # Might match output
"Complete"                  # Too common
"DONE"                      # Too short
```

### Rules for Robust Completion

1. Use ALL_CAPS unique phrases
2. Include specific counts when applicable
3. Make unique to avoid matching log output
4. Require a summary file to exist (double verification)

---

## Handling Failures

### Loop Gets Stuck

If Claude keeps failing on the same step:

1. `/cancel-ralph` to stop
2. Review state: `cat .claude/tests/reports/*-state.json`
3. Check logs: `tail -50 ~/.claude/logs/claude-code.log`
4. Fix the blocking issue manually
5. Mark scenario as "skipped" in state file if needed
6. Restart with same prompt (will resume from state)

### API Rate Limits

If hitting API limits:

1. Check rate limit headers in logs
2. Add `WAIT: 60s` to prompt before API-heavy scenarios
3. Or run during off-peak hours (2-6 AM local time)
4. Budget tracking prevents runaway costs

### Out of Context

If loop runs out of context:

1. Ralph will auto-restart with fresh context
2. State is preserved in reports/*.json files
3. Loop continues from last recorded progress
4. No manual intervention needed

### Specific Scenario Failures

| Scenario | Likely Cause | Fix |
|----------|--------------|-----|
| EMB-005 partial batch | API timing | Retry with mock |
| HCGS-005 Ollama | Model not pulled | `ollama pull qwen2.5-coder:7b-instruct` |
| TC-INC-009 git | Branch conflicts | Run in clean repo |
| ENOSPC chaos | Ramdisk perms | Run as sudo or skip |

---

## Results Analysis

After loops complete, analyze results:

```bash
# View all reports
ls -la .claude/tests/reports/

# Count passes/failures per loop
for f in .claude/tests/reports/*-state.json; do
  echo "=== $f ==="
  jq '{completed: (.completed | length), failed: (.failed | length)}' "$f"
done

# Check for P0/P1 issues
grep -r "P0\|P1\|CRITICAL" .claude/tests/reports/

# Generate consolidated report
cat .claude/tests/reports/*_RESULTS.md > .claude/tests/reports/CONSOLIDATED_RESULTS.md

# Calculate total API spend
jq -s 'map(.apiSpend) | add' .claude/tests/reports/*-state.json
```

### Issue Documentation

All issues found should be added to:
`.claude/docs/search/INDEXING_ISSUES_FOUND.md`

Use the template from INDEXING_TESTING_PLAN.md Section 12.

---

## Advanced: Custom Stop Hooks

For more complex stopping logic, create custom Stop hooks:

```javascript
// .claude/hooks/testing-stop.mjs
export default function stopHook(context) {
  const { exitCode, output } = context;

  // Check for completion markers
  const completionMarkers = [
    'BENCHMARK_2_COMPLETE',
    'FALLBACK_42_COMPLETE',
    'INCREMENTAL_11_COMPLETE',
    'SOTA_COMPLETE',
    'OVERHEAD_COMPLETE'
  ];

  for (const marker of completionMarkers) {
    if (output.includes(marker)) {
      return { allow: true, reason: `${marker} achieved` };
    }
  }

  // Check for critical errors
  if (output.includes('CRITICAL ERROR') || output.includes('FATAL')) {
    return { allow: true, reason: 'Critical error - stopping' };
  }

  // Check budget limit
  const budgetMatch = output.match(/Budget: \$([0-9.]+)/);
  if (budgetMatch && parseFloat(budgetMatch[1]) > 6.00) {
    return { allow: true, reason: 'Budget limit exceeded' };
  }

  // Check time limit (from environment)
  const startTime = parseInt(process.env.RALPH_START_TIME || Date.now());
  const maxTime = parseInt(process.env.RALPH_MAX_TIME || 14400) * 1000;
  if (Date.now() - startTime > maxTime) {
    return { allow: true, reason: 'Time limit exceeded' };
  }

  // Save state before continuing
  // This ensures state is persisted even on crash
  try {
    const stateFile = '.claude/tests/reports/ralph-state.json';
    // State should be saved by the loop, but verify
  } catch (e) {
    console.error('Warning: Could not verify state');
  }

  // Continue loop
  return { allow: false, reinject: context.originalPrompt };
}
```

---

## Quick Start Commands

```bash
# 1. Install plugin
/plugin install ralph-wiggum@claude-plugins-official

# 2. Create directories
mkdir -p .claude/tests/reports
mkdir -p .claude/tests/indexing-validation/fixtures

# 3. Start with overhead profiling (no API costs)
/ralph-loop "Profile overhead... [see Loop 5]" --completion-promise "OVERHEAD_COMPLETE"

# 4. After overhead complete, run benchmarks
/ralph-loop "Run benchmarks... [see Loop 1]" --completion-promise "BENCHMARK_2_COMPLETE"

# 5. Continue with remaining loops...
```

---

## References

- [Claude Code Plugins Documentation](https://docs.anthropic.com/claude-code/plugins)
- [Ralph Wiggum Official Plugin](https://github.com/anthropics/claude-code/tree/main/plugins/ralph-wiggum)
- [Stop Hooks Guide](https://docs.anthropic.com/claude-code/hooks/stop)
- [INDEXING_TESTING_PLAN.md](./INDEXING_TESTING_PLAN.md) - Full test specifications

---

*End of RALPH_WIGGUM_TESTING_INTEGRATION.md v2.0*
