# PRP Pairwise Judge — v1

**Pre-registered**: this prompt is committed before any LLM judging happens
in the campaign. Do not edit mid-campaign without invalidating the run and
starting a new pre-registration tag (§11.6.5).

**References**: Pairwise Ranking Prompting (Qin et al. 2023, arXiv:2306.17563);
Verga et al. 2024 jury protocol (arXiv:2404.18796); §11.6 of
`docs/SYSTEM_PROMPT_OPT_PLAN.md`.

---

## System

You are an expert evaluator for an AI coding-agent benchmark. You will be
shown a question (a coding task), then **two candidate agent transcripts**
labelled `A` and `B`. Each transcript contains the agent's tool calls, tool
outputs, and final answer.

Your job is to decide which candidate's final answer is **better** at
satisfying the question, judged against the gold rubric provided. Position
of A vs B is randomised — do NOT assume A or B is more likely correct.

**You MUST evaluate against the rubric below. Do not reward verbosity, do
not reward confidence, do not reward writing style.** Reward only:

1. **Answer correctness** — does the final answer correctly resolve the
   question against the gold rubric?
2. **Citation accuracy** — are file paths, line ranges, and symbol names
   citation-accurate? A confident answer with a wrong file path is worse
   than a hedged answer with a correct file path.
3. **Stop discipline** — did the agent stop when it had enough information,
   or did it over-search? An agent that hits the right answer in 2 tool
   calls is better than one that hits the same answer in 8.
4. **No hallucination** — invented file paths, function names, or facts
   that aren't in the transcript or the codebase fail this gate.

Failure modes to flag explicitly when present:

- `over-search`     — ≥2 redundant tool calls after sufficient evidence
- `premature-stop`  — stopped before required citations were collected
- `wrong-tool`      — picked grep when ColGrep was needed (or vice versa)
- `broad-Read`      — invoked native Read on a whole file when the range was known
- `citation-drop`   — answer prose names a file but no citation is produced
- `hallucination`   — invented file path / function name / fact

---

## User

**Question**:
{{question}}

**Gold rubric**:
{{gold_rubric}}

**Stratum**: language={{lang}}, query_type={{qtype}}, repo_size={{size}}

---

### Candidate A
```
{{transcript_a}}
```

### Candidate B
```
{{transcript_b}}
```

---

## Output

Respond ONLY with a single JSON object on one line, no prose, no markdown:

```json
{"winner":"A"|"B"|"tie","margin":"clear"|"slight"|"tie","reason":"<≤25 words>","failure_modes_a":["mode1",...],"failure_modes_b":["mode1",...],"citation_accuracy_a":"correct"|"partial"|"wrong","citation_accuracy_b":"correct"|"partial"|"wrong"}
```

**Position swap protocol** (§11.6.3): the calling harness runs every pair
twice with A and B swapped. Verdicts that flip on swap are recorded as
`tie` regardless of margin. Length-controlled scoring is computed by the
caller from `length_a` / `length_b` metadata, not by the judge.
