# How to start the overnight loop

1. In the repo root, start a fresh session without permission prompts:

   ```
   claude --dangerously-skip-permissions --model claude-opus-5-5
   ```

2. Paste this command (dynamic `/loop`, the session paces itself):

   ```
   /loop You are running the autonomous FINAL TUNING hill-climb for sweet-search. On every wake-up: read core/prompt-optimization/data/final-tuning/HANDOFF.md (fully on the first wake-up, then as needed) and core/prompt-optimization/data/final-tuning/STATE.md, check any runs in flight, do the next step of the current phase, update STATE.md, commit and push branch final-tuning, then schedule the next wake-up. The owner is asleep and has authorized autonomous runs within the limits in HANDOFF.md §2 — do not stop to ask for permission. Never publish, tag, release, edit README.md, push to main, or touch HO2 or any held-out split per-query. Stop the loop when HANDOFF.md §7 says to end, after writing MORNING-REPORT.md.
   ```

3. In the morning, read `core/prompt-optimization/data/final-tuning/MORNING-REPORT.md`.
