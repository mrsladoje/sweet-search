# NOTICE — Codex harness trim (sweet arm only)

`codex-0.146.1-instructions-sweet.md` (gpt-5.5) and
`codex-0.146.1-instructions-sweet-gpt-5.6-luna.md` (gpt-5.6-luna) are **modified copies** of
third-party text. The base prompt differs by model, so each model has its own edit.

- **Source:** the base instructions that `codex-cli` **0.146.1** sends for each model (the model
  catalog bundled in the release; project https://github.com/openai/codex). Captured at $0
  through a local proxy, in `handoffs/improve/harness-prompt-trim/captures/`:
  - gpt-5.5: the `instructions` field of `codex-0.146.1-request-sweet.json`
    (21,335 chars, sha256 `c2a980bc28af132eb89e0b4c68ae884043faae83a1afd3fd4889f7e8a1ada7b0`).
  - gpt-5.6-luna: the first developer message of `codex-0.146.1-request-luna-base.json`
    (17,730 chars, sha256 `cbefa6b0bede0e332d957fca70ccacf9f12f4c0ecdf81b819e5cbe1a3b16e265`).
    Luna runs in "code mode": no `instructions` field, and its tools are nested inside one
    `exec` JavaScript tool. `model_instructions_file` replaces that developer message.
- **License:** Apache License 2.0 (`LICENSE-Apache-2.0.txt` in this directory). The package
  `@openai/codex@0.146.1` declares `"license": "Apache-2.0"`.
- **Modified by:** the sweet-search project, 2026-09-25, for the task-completion benchmark.
- **Build:** `node harness/trim/build-codex-instructions.mjs` rebuilds the file from the capture;
  `--check` fails if the file differs. The build refuses any other source text (sha256 check).
- **Delivery:** `harness/codex-task-runner.mjs` strips the `<!-- … -->` header and passes the rest
  with `-c model_instructions_file=…` when `CODEX_HARNESS_TRIM=1` on the sweet arm. The model gets
  7,214 chars on gpt-5.5 and 8,062 on luna (Codex drops the final line break). The native arm
  always gets the unmodified prompt. Any other model is refused until its prompt is captured.

## Rules for the edit

1. Remove every line that steers search or read behaviour against the sweet-search rules.
2. Remove sections that a headless, non-interactive benchmark coding task does not use.
3. Keep everything that governs correct coding-agent behaviour. When unsure, keep.
4. Delete; do not paraphrase. Add nothing. The one exception is a sentence that mixed a
   contradiction with a keeper: it was shortened, not rewritten.

## Changes, gpt-5.5 (line numbers are source lines)

| # | Source lines | ≈ chars | What | Why |
|---|---|---|---|---|
| 1 | 3–21 | 1,600 | `# Personality` with `## Values`, `## Interaction Style`, `## Escalation` ("You are a deeply pragmatic, effective software engineer…") | Tone and conversation style; no effect on the fix. |
| 2 | 25 | 200 | "When you search for text or files, you reach first for `rg` or `rg --files`; they are much faster than alternatives like `grep`. …" | **Contradicts** the sweet-search rules (use `ss-*` for code search). |
| 3 | 26 (edit) | 80 | "You parallelize tool calls whenever you can~~, especially file reads such as `cat`, `rg`, `sed`, `ls`, `git show`, `nl`, and `wc`~~. You use `multi_tool_use.parallel` …" | The removed clause **contradicts** the rules (read with `ss-read`). Tool-neutral parallelism and the rest of the line are kept verbatim. |
| 4 | 38–71 | 7,100 | `## Frontend guidance` with `### Build with empathy`, `### Design instructions` (hero pages, lucide icons, Three.js, palettes) and the dev-server paragraph | Building new web apps and sites; a repository issue fix never needs it. |
| 5 | 87–91 | 700 | `## Special user requests` (answer "the time via `date`"; the code-review stance) | Interactive requests the benchmark never makes. |
| 6 | 109–127 | 2,300 | `## Formatting rules` (Markdown rendering, headers, clickable file links, no emojis) | Rendering of the answer in an interactive client; the benchmark does not read the answer. |
| 7 | 132–133 | 470 | "You suggest follow ups if useful …"; "When you talk about your work, you use plain, idiomatic engineering prose …" | Answer tone and interactive follow-ups. |
| 8 | 139–140 | 230 | "Tone of your final answer must match your personality."; "Never talk about goblins, gremlins, raccoons, …" | Tone; refers to the removed personality section. |
| 9 | 144–152, 154–155 | 1,500 | All `## Intermediary updates` bullets except the checklist one ("Intermediary updates go to the `commentary` channel", "You provide user updates frequently, every 30s", "When exploring, such as searching or reading files, you provide user updates as you go", …) | Progress messages to a user who watches in a client. In a headless run they are output tokens nobody reads. The heading and the checklist bullet (it governs `update_plan`) are kept. |

Kept verbatim (gpt-5.5): the identity line; `# General` (senior-engineer judgment, "read the codebase first");
`## Engineering judgment`; `## Editing constraints` (ASCII, comments, `apply_patch`, no Python file
I/O, dirty-worktree and do-not-revert rules, destructive-git caution, non-interactive git);
`## Autonomy and persistence`; `# Working with the user` (the `commentary`/`final` channels, newest
request wins, compaction); `## Final answer instructions` except rows 7–8; the checklist bullet.

## Changes, gpt-5.6-luna (line numbers are source lines)

| # | Source lines | ≈ chars | What | Why |
|---|---|---|---|---|
| 1 | 3–22 | 2,100 | `# Personality` with `## Writing style`, `## Technical communication` ("an excellent communicator with a curious, rich personality…") | Tone and answer style. |
| 2 | 35–38 | 600 | `## Intermediate commentary`: "As you work, you send messages to the `commentary` channel…"; "start with a message in the `commentary` channel … should not be left without a commentary update for more than 60 seconds" | Progress messages for a watching user; output tokens nobody reads. |
| 3 | 41–42 | 210 | "Never praise your plan by contrasting it with an implied worse alternative…" | Tone. |
| 4 | 47–75 | 1,900 | `### Formatting rules` (clickable file links) and `### Visualizations` | Rendering in an interactive client. |
| 5 | 78 | 200 | "When you search for text or files, you reach first for `rg` or `rg --files`…" | **Contradicts** the sweet-search rules. |
| 6 | 133–167 | 4,800 | `# Using skills` (discovery, trigger rules, how to read `SKILL.md`, commentary about skills) | The skills list is removed by `skills.include_instructions=false`; the how-to is then dead text. |

Kept verbatim (luna): the identity line; `# Working with the user` (channels, new-message rule,
compaction); the `## Intermediate commentary` rule that a final answer never goes in the
commentary channel; `## Final answer` first paragraph; `# Rules for getting work done` except the
`rg` line (tool-neutral parallelism, no `echo "===="` chaining, escaping caution, no long sleeps,
never repurpose `$HOME`); `## File editing constraints`; `## Autonomy and persistence`;
`# Destructive Actions`. The luna prompt has no "file reads such as `cat`…" clause, so no line
was edited.

One kept line (both models) still names `cat`: "Do not create or edit files with `cat` or other shell write
tricks." It is about **writing** files, not searching or reading, so it does not contradict the
sweet-search rules.

## Tool and skills keys sent with the trim (verified by capture, 0.146.1)

| `-c` key | Removes |
|---|---|
| `web_search="disabled"` | `web_search` |
| `features.goals=false` | `get_goal`, `create_goal`, `update_goal` |
| `tools.experimental_request_user_input.enabled=false` | `request_user_input` |
| `skills.include_instructions=false` | the `<skills_instructions>` block in the developer message (~6,900 chars gpt-5.5, ~3,500 luna) |
| `include_permissions_instructions=false` | the `<permissions instructions>` developer message ("Network access is enabled" contradicts the frame's OFFLINE block) |
| `include_environment_context=false` | `<environment_context>` (cwd, shell, date, timezone; the AGENTS.md header still names the cwd) |
| `tools.update_plan.enabled=false` | `update_plan` (in code mode each call is a separate turn) |

On luna, `web_search` is not sent at all, so that key does nothing there; the goal tools and `request_user_input` disappear from the nested `exec` tool and the
`additional_tools` item (verified by capture).

Kept: `exec_command`, `write_stdin`, `apply_patch`, and `tool_search` with the
deferred sub-agent tools behind it: delegation is a real capability, and the Claude Code trim keeps
its Agent tool too (`features.multi_agent=false` would remove `tool_search`; it is deliberately
not sent). `view_image` also stays: no
0.146.1 config key removes it (it follows the model's image-input capability). Keys that were
tried and do **not** remove a tool: `tools.web_search=false`, `tools.view_image=false`,
`features.image_generation=false`, `features.tool_suggest=false`, `features.apps=false`,
`features.plugins=false`, `features.default_mode_request_user_input=false`.
`skills.bundled.enabled=false` also removes the skills block; `include_instructions` was chosen
because it also covers skills that a repository could bring.

Re-verify with a capture on every Codex version bump: the base prompt, the model catalog and the
config keys change between releases.

## Second pass (independent audit, 2026-09-25)

Further whole-line deletions (see `build-codex-instructions.mjs` for the exact line ranges and
reasons): gpt-5.5 — "You let test coverage scale with risk…" (the frame forbids test edits),
mid-turn user-message and post-resume rules, relay-output / save-this-file answer rules, the
"## Intermediary updates" heading and checklist bullet (update_plan is removed). luna — mid-turn
user messages, "Avoid blocking sleep or wait calls longer than 60 seconds" (the frame asks for a
300 s run_tests wait), a verbatim duplicate `$HOME` line, the Answer/Diagnose/Monitor request
types, the babysit terminal-condition line, and the clarifying-questions line. Sizes as sent:
gpt-5.5 7,214 → 5,663 chars; luna 8,062 → 6,034.

## v3 (luna only, `CODEX_HARNESS_TRIM=v3`, 2026-09-26)

`codex-0.146.1-instructions-sweet-gpt-5.6-luna-v3.md`: built from the same capture and sha256 as
the luna edit. It starts from the FIRST edition (commit a84b079) and changes it in two ways.

| # | Source lines | What | Why |
|---|---|---|---|
| 1 | 35–38 | `## Intermediate commentary` cadence paragraphs | **Restored** (the first edition deleted them). After a FAIL `run_tests` verdict, as-now wrote commentary next 50% of the time and finished 4%; the second pass (without these lines) 27% and 14%. |
| 2 | 29–30 | "The user may send a new message while you are still working…" | Deleted: no user writes during a headless run. |
| 3 | 82 | "Avoid performing blocking sleep or wait calls longer than 60 seconds…" | Deleted: contradicts the frame's `yield_time_ms=300000` rule for `run_tests`. |
| 4 | 83 | "Never repurpose `$HOME`…" | Deleted: verbatim duplicate of line 124, which stays. |

Kept (unlike mode 1): all of `## Autonomy and persistence` (request types, "exhaust safe
in-scope checks and alternatives", the clarifying-questions line), the `<permissions instructions>`
message, `<environment_context>` and `update_plan`. Config keys: the first four only
(`web_search`, `features.goals`, `tools.experimental_request_user_input`,
`skills.include_instructions`). As sent: 7,789 chars (first edition 8,062; mode 1 6,034).
