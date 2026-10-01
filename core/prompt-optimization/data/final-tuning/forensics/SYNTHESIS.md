# Forensic synthesis — ss-* tools in real coding tasks (2026-10-01)

**Conclusion.** The agents understand the ss-* tools (misuse is rare), but most of what the tools
print is never used: 74–86% of ss-search / ss-find / ss-read output characters were judged unneeded
by readers who looked at what the agent did next. Because tool output stays in context and is re-read
on every later turn, this is the largest lever on task cost. A no-information-loss cleanup removes
16–34% of ss-search, 27%+ of ss-find, ~33% of ss-trace and ~7% of ss-read output; behaviour-level
changes (read windows, ss-find routing, summary caps) can remove more but need a task A/B.

Sources: `STATS.md` (deterministic, 10,442 ss-* calls, 1,141 task rollouts) + 9 Sonnet readers,
640+ calls read by eye (`swarm/*.md`, `swarm/*.labels.jsonl`). Data: Claude Code + Opus (tonight's
guard runs), Claude Code / Codex / opencode + gpt-5.6-luna (09-25..30 hill-climb). 13 tasks only —
every share below is a sample estimate (±10–13 points at n≈50–75).

## Per tool — what the readers saw

| Tool | Useful (yes / partly / no) | Output not needed | What is used | Never / rarely used |
|---|---|---|---|---|
| ss-search (CC Opus+Luna, n=67) | 49% / 28% / 22% | 16–19% removable with no loss; ~41% incl. unused tails | rank-1 code, rank-2 code | confidence, `sufficient=` (Opus read more files after `sufficient=YES` in 94%), `score=`, budget header, trailers, gutter; rank 3 in 0/27 Opus calls |
| ss-search (Codex Luna, n=53) | 32% / 28% / 40% | 80% | rank-1 code, rank 2–3 previews, summary paths | score/confidence/sufficient/route/shown-full: 0 of 902 agent messages mention them |
| ss-search (opencode Luna, n=56) | 21% / 39% / 39% | 74% | rank-1 code (24), rank 2–3 (15), summaries as pointers (13) | score, trailers, gutter, imports, continuation |
| first ss-search (n=87) | ≈44% / 31% / 26% | 66% | fix file at rank 1 in 61%, with code in 73% | — |
| ss-find (n=74) | 15% / 45% / 36% (+4% harmful) | 84–86% | rank-1 code (26/59), summaries as pointers | all metadata; 41% of its code chars were already shown earlier |
| ss-trace (n=56) | 11% / 13% / 77% | 86% | callers mode with `--in` on the real definition | callees / impact (0 yes in 20); cue lines + JSON line = 40–47% of output |
| ss-semantic (n=24) | 38% / 17% / 46% | 64% | fetching a known function in a big file | long multi-concept queries (wrong span 5/13) |
| ss-read (n=77) | 36% / 35% / 29% | 81% (script: 3.6% of code chars strictly used) | the edited region | gutter (0/52), `unread below … continue` trailer (3/41) |
| ss-grep (n=72) | 31% / 45% / 24% (weighted) | ≈65% | the right file | matched fragment instead of the line (forces reads); test files = 33% of hit lines |
| native fallback in sweet arm (n=111) | 56% / 26% / 16% | 33–48% | whole-file `cat` (rules say ss-read is for "a narrow range"), `grep -A` (ss-grep cannot show a body) | — ; harmful: `grep -rn` from root floods on `.sweet-search/` |

Amplification (STATS): share of all amplified tool-output tokens (tokens × later re-reads) —
Opus: ss-read 20.1%, ss-grep 8.3%, ss-search 2.8%; Luna harnesses: ss-read 43–48%, ss-search 16–21%.

## Ranked fix list

Expected saving = share of that tool's output chars (measured on the recorded outputs where stated),
× its amplified share. Risk = risk to accuracy / task resolution.

### Bundle A — no information the agents used is removed (low risk; one switch)

| # | Fix | Tool | Saving (of that tool's output) | Evidence |
|---|---|---|---|---|
| A1 | Drop `score=`, presentation/kind tag, budget/subMode header, confidence + `sufficient` line, `route=` and `shown-full:` trailers | ss-search, ss-find | ~8–14% | unused in every reader's sample (0/902 Codex messages) |
| A2 | Summary entries: one line `path:line symbol (kind)` (the 2nd line restates the header); drop entries whose span/symbol is already listed (= V3 dedupe) | ss-search, ss-find | 9.5–11.5% | 99.9% of summary 2nd lines restate the header |
| A3 | Omit code already shown earlier in the same thread (ss-read does this on Codex only today) → one line "already shown above (lines a–b)" | ss-search, ss-find, ss-read | ss-find up to 27%, ss-search 3–4%, ss-read ~7% | 10.4% of ss-* code chars re-shown; ss-find 31.5% |
| A4 | ss-trace: print only the requested section, one row per caller, drop cue lines and the JSON meta line, filter external callees | ss-trace | ~33% of trace tokens | 40–47% is cue/JSON lines, never quoted |
| A5 | Robustness: ss-grep regex parse error → retry as literal (no stack trace); zero hits → case-insensitive retry; ss-trace ambiguous name → non-test definition, wrong `--in` → fall back | ss-grep, ss-trace | fewer wasted calls (14% zero-hit greps; 44 trace calls on test mocks) | readers' counts |
| A6 | Rules text bugs: `ss-trace <symbol> [callers\|callees\|impact]` → `ss-trace <symbol> callers` form without brackets (agents typed the brackets; zsh rejected 6 calls); state that `ss-find --regex` matches file CONTENT | rules | — | readers |

### Bundle B — behaviour changes (need a task A/B)

| # | Fix | Saving | Risk |
|---|---|---|---|
| B1 | Cap the summary tail at 3–5 entries and make `-k` a real cap | +10–12% of ss-search | low–medium (rank 6+ touched in ≤ 10.6% of Codex calls) |
| B2 | One ss-search entry per file (other hits in that file as a name list) | frees code slots; fixes "fix file only as summary" (10%) | low (display only) |
| B3 | ss-read: soft cap ~120 lines + rules "start near the search hit"; small ranges without fence/trailer | ~12% of ss-read (largest amplified tool) | low–medium (widen-thrash) |
| B4 | ss-read gutter off where the harness does not need it | ~7.8% of ss-read | medium (edit anchors) — A/B |
| B5 | Rules: exact tokens → ss-grep + narrow ss-read (not ss-find); "file or range" instead of "narrow range" (whole-file reads went to `cat`) | up to 16% of ss-find; fewer native reads | low |
| B6 | Fold ss-find into `ss-search --regex` (or drop it from the rules' exact-token path) | prefix + ss-find waste | medium — V2 (removing 3 tools) cost Codex 1.9 pt on retrieval |
| B7 | ss-grep: source hits before test hits, collapse test hits, flood guard for ≥ 50 hits | ~23% of ss-grep | low–medium |
| B8 | ss-grep `-A/-B/-C`; multi-range ss-read | fewer locate→read chains | low |

### Not proposed (evidence against)

- Removing ss-trace / ss-semantic outright: each has one job it does well (callers with `--in`;
  function fetch in a big file), and V2 cost Codex accuracy.
- Changing the confidence/sufficiency logic: agents ignore it — remove the line (A1), do not tune it.

## Owner decision (2026-10-01)

ss-read is NOT changed (B3, B4 and A3-for-ss-read dropped): its wide reads match native reading behaviour that the models are trained for.

## Caveats

- 13 tasks; two tasks hold half of the trace calls and 30/35 Opus ss-search calls are one task — the
  new long-task batch (20 tasks × 3 harnesses) is needed to confirm per-harness rates.
- Luna (gpt-5.6-luna) dominates the non-Opus data; current target models are Sol / DeepSeek / Opus /
  Sonnet.
- The bench prints through `eval/agent-read-workflows/bin/_ss-helpers.mjs`; the shipped CLI must get
  the same changes (check which code path the product's ss-* commands use before shipping).
