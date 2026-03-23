---
name: benchmark_preferences
description: User preferences for running GenCodeSearchNet benchmarks - no memory cap, newline progress, background execution
type: feedback
---

When running benchmarks:
- Do NOT use `--max-old-space-size` — machine has 128GB RAM, no need for memory caps
- Progress output (50/6000 etc.) must print on NEW LINES, not stack on same row
- Run benchmarks in background so user can see results as they come
- Use concurrency=12 (M3 Max)
- Ensure models are warmed up before timing queries

**Why:** User has 128GB M3 Max and wants to see progress clearly. Stacking progress on same row makes it unreadable.

**How to apply:** Every `eval/run_benchmark.js` invocation — drop `--max-old-space-size`, ensure `--concurrency=12`, run in background.
