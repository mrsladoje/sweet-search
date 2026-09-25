#!/usr/bin/env python3
"""Build the sweet-arm trimmed opencode 1.18.4 prompts (OC_HARNESS_TRIM) from the captured
originals. Source text = the model-family prompt exactly as opencode sent it in the OFF
capture (system message up to "You are powered by the model named", minus the join newline).
Every edit must match exactly once, or the build fails.

  python3 build_oc_trim_prompts.py            # writes harness/trim/opencode-1.18.4-prompt-*.txt
                                              # (OC_HARNESS_TRIM=1) and *-max.txt (=max)
  python3 build_oc_trim_prompts.py --check    # fails if a written file differs from a rebuild

Rules (handoff): (a) delete what contradicts the ss-* rules (search/read/delegation
steering); (b) delete what a headless benchmark task never uses; (c) keep everything that
governs correct coding-agent behaviour. Delete, do not paraphrase; a minimal in-sentence edit
only where one sentence mixes a contradiction with a keeper. Tags below: A / B / A+B.

Max trim (OC_HARNESS_TRIM=max) = the round-1 list + the family's *_MAX list, built into
*-max.txt. It also covers TodoWrite (disabled in the max trim), the "ask the user"
instructions (a question ends a headless run), the user-facing sections, and the explore
subagent's own prompt. repl UNTIL(marker) deletes up to the marker; TO_END to the end.
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
CAPTURES = os.path.join(HERE, '..', 'captures')
TRIM = os.path.normpath(os.path.join(HERE, '../../../../harness/trim'))

HELP_CTRLP = ("If the user asks for help or wants to give feedback inform them of the following:\n"
              "- ctrl+p to list available actions\n- To give feedback, users should report the issue at\n"
              "  https://github.com/anomalyco/opencode\n")
ASKS_ABOUT = ('When the user directly asks about OpenCode (eg. "can OpenCode do...", "does OpenCode have..."), '
              'or asks in second person (eg. "are you able...", "can you do..."), or asks how to use a specific '
              'OpenCode feature (eg. implement a hook, write a slash command, or install an MCP server), use the '
              'WebFetch tool to gather information to answer the question from OpenCode docs. The list of available '
              'docs is available at https://opencode.ai/docs\n')
TASK_EXPLORE = ('- VERY IMPORTANT: When exploring the codebase to gather context or to answer a question that is not '
                'a needle query for a specific file/class/function, it is CRITICAL that you use the Task tool instead '
                'of running search commands directly.\n<example>\nuser: Where are errors from the client handled?\n'
                'assistant: [Uses the Task tool to find the files that handle client errors instead of using Glob or '
                'Grep directly]\n</example>\n<example>\nuser: What is the codebase structure?\nassistant: [Uses the '
                'Task tool]\n</example>\n')
SPECIALIZED = ('- Use specialized tools instead of bash commands when possible, as this provides a better user '
               'experience. For file operations, use dedicated tools: Read for reading files instead of cat/head/tail, '
               'Edit for editing instead of sed/awk, and Write for creating files instead of cat with heredoc or echo '
               'redirection. Reserve bash tools exclusively for actual system commands and terminal operations that '
               'require shell execution. NEVER use bash echo')
SPECIALIZED_KEEP = ('- For file operations, use dedicated tools: Edit for editing instead of sed/awk, and Write for '
                    'creating files instead of cat with heredoc or echo redirection. NEVER use bash echo')
FILE_SEARCH_TASK = '- When doing file search, prefer to use the Task tool in order to reduce context usage.\n'
PROACTIVE_TASK = "- You should proactively use the Task tool with specialized agents when the task at hand matches the agent's description.\n"
WEBFETCH_REDIRECT = ('- When WebFetch returns a message about a redirect to a different host, you should immediately '
                     'make a new WebFetch request with the redirect URL provided in the response.\n')
USER_PARALLEL = ('- If the user specifies that they want you to run tools "in parallel", you MUST send a single message '
                 'with multiple tool use content blocks. For example, if you need to launch multiple agents in '
                 'parallel, send a single message with multiple Task tool calls.\n')
EMOJI_BULLET = '- Only use emojis if the user explicitly requests it. Avoid using emojis in all communication unless asked.\n'
CLI_OUTPUT = ('- Your output will be displayed on a command line interface. Your responses should be short and concise. '
              'You can use GitHub-flavored markdown for formatting, and will be rendered in a monospace font using the '
              'CommonMark specification.\n')
CLI_OUTPUT_KEEP = '- Your responses should be short and concise.\n'
OBJECTIVITY_HEAD = '# Professional objectivity\n'
OBJECTIVITY_BODY = ("Prioritize technical accuracy and truthfulness over validating the user's beliefs. Focus on facts "
                    "and problem-solving, providing direct, objective technical info without any unnecessary superlatives, "
                    "praise, or emotional validation. It is best for the user if OpenCode honestly applies the same rigorous "
                    "standards to all ideas and disagrees when necessary, even if it may not be what the user wants to hear. "
                    "Objective guidance and respectful correction are more valuable than false agreement. Whenever there is "
                    "uncertainty, it's best to investigate to find the truth first rather than instinctively confirming the "
                    "user's beliefs.\n")

TO_END = ('TO_END',)
def UNTIL(marker): return ('UNTIL', marker)

# Claude-family prompt (Na) and Muse Spark prompt (Za) share their body; Claude has blank
# lines between blocks, Muse does not.
def claude_like(blank):
    n = '\n' if blank else ''
    return [
        ('B', HELP_CTRLP + n, ''),
        ('B', ASKS_ABOUT + n, ''),
        ('B', EMOJI_BULLET, ''),
        ('B', CLI_OUTPUT, CLI_OUTPUT_KEEP),
        ('B', OBJECTIVITY_HEAD + OBJECTIVITY_BODY + n, ''),
        ('A', FILE_SEARCH_TASK, ''),
        ('A', PROACTIVE_TASK, ''),
        ('B', WEBFETCH_REDIRECT, ''),
        ('B', USER_PARALLEL, ''),
        ('A', SPECIALIZED, SPECIALIZED_KEEP),
        ('A', TASK_EXPLORE, ''),
    ]

# Claude has an empty line after the proactive-Task bullet; delete it with the bullet.
CLAUDE = claude_like(True)
CLAUDE[6] = ('A', PROACTIVE_TASK + '\n', '')

DEFAULT = [  # opencode's fallback prompt (Ta): x-ai/grok-4.5 and any id no rule matches
    ('B', "If the user asks for help or wants to give feedback inform them of the following:\n- /help: Get help with "
          "using opencode\n- To give feedback, users should report the issue at https://github.com/anomalyco/opencode/issues\n\n", ''),
    ('B', "When the user directly asks about opencode (eg 'can opencode do...', 'does opencode have...') or asks in "
          "second person (eg 'are you able...', 'can you do...'), first use the WebFetch tool to gather information to "
          "answer the question from opencode docs at https://opencode.ai\n\n", ''),
    ('B', " When you run a non-trivial bash command, you should explain what the command does and why you are running "
          "it, to make sure the user understands what you are doing (this is especially important when you are running "
          "a command that will make changes to the user's system).", ''),
    ('B', "Remember that your output will be displayed on a command line interface. Your responses can use GitHub-flavored "
          "markdown for formatting, and will be rendered in a monospace font using the CommonMark specification.\n", ''),
    ('B', "If you cannot or will not help the user with something, please do not say why or what it could lead to, since "
          "this comes across as preachy and annoying. Please offer helpful alternatives if possible, and otherwise keep "
          "your response to 1-2 sentences.\n", ''),
    ('B', "Only use emojis if the user explicitly requests it. Avoid using emojis in all communication unless asked.\n", ''),
    # The verbosity examples are chat Q&A; the last one steers search to grep/glob tools.
    ('A+B', ' Here are some examples to demonstrate appropriate verbosity:\n<example>\nuser: what is 2+2?\nassistant: 4\n'
            '</example>\n\n<example>\nuser: is 11 a prime number?\nassistant: Yes\n</example>\n\n<example>\nuser: what '
            'command should I run to list files in the current directory?\nassistant: ls\n</example>\n\n<example>\nuser: '
            'what command should I run to watch files in the current directory?\nassistant: [use the ls tool to list the '
            'files in the current directory, then read docs/commands in the relevant file to find out how to watch files]\n'
            'npm run dev\n</example>\n\n<example>\nuser: what files are in the directory src/?\nassistant: [runs ls and sees '
            'foo.c, bar.c, baz.c]\nuser: which file contains the implementation of foo?\nassistant: src/foo.c\n</example>\n\n'
            '<example>\nuser: write tests for new feature\nassistant: [uses grep and glob search tools to find where similar '
            'tests are defined, uses concurrent read file tool use blocks in one tool call to read relevant files at the same '
            'time, uses edit file tool to write new tests]\n</example>\n', '\n'),
    ('B', " If you are unable to find the correct command, ask the user for the command to run and if they supply it, "
          "proactively suggest writing it to AGENTS.md so that you will know to run it next time.", ''),
    ('A', FILE_SEARCH_TASK, ''),
]

GPT = [  # GPT prompt (Ka): ids containing "gpt" but not "gpt-4" or "codex"
    ('A', '- When searching for text or files, prefer using Glob and Grep tools (they are powered by `rg`)\n', ''),
    ('B', 'If the user makes a simple request (such as asking for the time) which you can fulfill by running a terminal '
          'command (such as `date`), you should do so.\n\n', ''),
    ('B', '\n\nIf the user asks for a "review", default to a code review mindset: prioritise identifying bugs, risks, '
          'behavioural regressions, and missing tests. Findings must be the primary focus of the response - keep summaries '
          'or overviews brief and only after enumerating the issues. Present findings first (ordered by severity with '
          'file/line references), follow with open questions or assumptions, and offer a change-summary only as a secondary '
          'detail. If no findings are discovered, state that explicitly and mention any residual risks or testing gaps.', ''),
    ('B', '## Frontend tasks\n\nWhen doing frontend design tasks, avoid collapsing into "AI slop" or safe, average-looking '
          'layouts.\n- Ensure the page loads properly on both desktop and mobile\n- For React code, prefer modern patterns '
          'including useEffectEvent, startTransition, and useDeferredValue when appropriate if used by the team. Do not add '
          "useMemo/useCallback by default unless already used; follow the repo's React Compiler guidance.\n- Overall: Avoid "
          'boilerplate layouts and interchangeable UI patterns. Vary themes, type families, and visual languages across '
          'outputs.\n\nException: If working within an existing website or design system, preserve the established '
          'patterns, structure, and visual language.\n\n', ''),
    ('B', '## General\n\nDo not begin responses with conversational interjections or meta commentary. Avoid openers such '
          'as acknowledgements ("Done —", "Got it", "Great question, ") or framing phrases.\n\nBalance conciseness to '
          'not overwhelm the user with appropriate detail for the request. Do not narrate abstractly; explain what you are '
          'doing and why.\n\nNever tell the user to "save/copy this file", the user is on the same machine and has access '
          'to the same files as you have.\n\n\n', ''),
    ('B', '## Formatting rules\n\n', None),  # whole section, up to the next heading (see below)
]

TODO_MAX = [  # claude / muse: todowrite is disabled in the max trim
    ('B', '# Task Management\n', UNTIL('# Doing tasks\n')),
    ('B', '- Use the TodoWrite tool to plan the task if required\n', ''),
    ('B', 'IMPORTANT: Always use the TodoWrite tool to plan and track tasks throughout the conversation.\n', ''),
    ('B', '# Code References', TO_END),  # user-facing navigation hint
]
DEFAULT_MAX = [
    # "search extensively" v the rules' one probe; the frame names run_tests and says the
    # shell has no dependencies, so README hunting and lint/typecheck runs are wasted calls
    ('A', "- Use the available search tools to understand the codebase and the user's query. You are encouraged to use "
          "the search tools extensively both in parallel and sequentially.\n", ''),
    ('A', ' NEVER assume specific test framework or test script. Check the README or search codebase to determine the '
          'testing approach.', ''),
    ('A', '- VERY IMPORTANT: When you have completed a task, you MUST run the lint and typecheck commands (e.g. npm run '
          'lint, npm run typecheck, ruff, etc.) with Bash if they were provided to you to ensure your code is correct.\n', ''),
    ('B', 'NEVER commit changes unless the user explicitly asks you to. It is VERY IMPORTANT to only commit when explicitly '
          'asked, otherwise the user will feel that you are being too proactive.\n', ''),
    ('B', ' For example, if you need to run "git status" and "git diff", send a single message with two tool calls to run '
          'the calls in parallel.', ''),
    ('B', '\nYou MUST answer concisely with fewer than 4 lines of text (not including tool use or code generation), unless '
          'user asks for detail.\n', ''),  # second copy
    ('B', '# Code References', TO_END),
]
GPT_MAX = [
    # a question ends a headless run. The dirty-worktree, amend and "stop and ask the user"
    # bullets repeat the Autonomy paragraph (that copy stays).
    ('A+B', '; if unclear, ask one short question instead of guessing.', '.'),
    ('A+B', '- You may be in a dirty git worktree.\n', UNTIL('- **NEVER** use destructive commands')),
    # commentary/final channels: user-facing progress updates nobody reads headless; each
    # "send an update before X" adds output tokens (the Codex trim removed the same rules)
    ('B', '# Working with the user\n', TO_END),
]
# opencode's explore subagent prompt (`ae`, every model): its Glob/Grep lines name tools the
# trim disables.
EXPLORE = [
    ('A', '- Use Glob for broad file pattern matching\n- Use Grep for searching file contents with regex\n', ''),
]

FAMILIES = {'claude': CLAUDE, 'muse': claude_like(False), 'default': DEFAULT, 'gpt': GPT}
MAX = {'claude': CLAUDE + TODO_MAX, 'muse': claude_like(False) + TODO_MAX, 'default': DEFAULT + DEFAULT_MAX,
       'gpt': GPT + GPT_MAX, 'explore': EXPLORE}
ORIGINALS = {'explore': 'opencode-1.18.4-request-sweet-trim-off-explore-subagent.json'}


def original(family):
    name = ORIGINALS.get(family, f'opencode-1.18.4-request-sweet-trim-off-{family}.json')
    body = json.load(open(os.path.join(CAPTURES, name)))
    content = body['messages'][0]['content']
    text = content if isinstance(content, str) else ''.join(p['text'] for p in content)
    return text[:text.index('You are powered by the model named')][:-1]  # drop the join newline


def build(family, lists=FAMILIES):
    text = original(family)
    for tag, find, repl in lists[family]:
        if repl is None:  # delete from `find` up to (not including) the next "## " heading
            start = text.index(find)
            end = text.index('\n## ', start + len(find)) + 1
            find, repl = text[start:end], ''
        elif isinstance(repl, tuple):  # UNTIL(marker) / TO_END
            start = text.index(find)
            end = text.index(repl[1], start) if repl[0] == 'UNTIL' else len(text)
            find, repl = text[start:end], ''
        count = text.count(find)
        if count != 1:
            raise SystemExit(f'{family}: edit [{tag}] matched {count}x: {find[:70]!r}')
        text = text.replace(find, repl)
    return text


if __name__ == '__main__':
    check = '--check' in sys.argv
    for family, lists, suffix in ([(f, FAMILIES, '') for f in FAMILIES] + [(f, MAX, '-max') for f in MAX]):
        out = os.path.join(TRIM, f'opencode-1.18.4-prompt-{family}{suffix}.txt')
        text = build(family, lists)
        if check:
            if open(out).read() != text:
                raise SystemExit(f'{out} differs from a rebuild')
        else:
            open(out, 'w').write(text)
        print(f'{family}{suffix}: {len(original(family))} -> {len(text)} chars')
