#!/usr/bin/env python3
"""claude-errors.py -- census of is_error tool results in the claude-code TAB run, by arm, tool and error head.
Runs on the box. Read-only. Also prints the packingTreatment flag census for the three TAB runs."""
import json, os, re, glob, collections
R = "/root/sweet-search-private/eval/task-completion-bench/results"


def jl(f):
    out = []
    for l in open(f, encoding="utf8", errors="replace"):
        l = l.strip()
        if not l or l[0] != "{":
            continue
        try:
            out.append(json.loads(l))
        except Exception:
            pass
    return out


def text_of(c):
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return "\n".join((x.get("text") or "") if isinstance(x, dict) else str(x) for x in c)
    return json.dumps(c) if c is not None else ""


for run in ("fp-codex-tab-20260826", "fp-opencode-tab-20260826", "fp-claudecode-tab-20260826"):
    rows = json.load(open(os.path.join(R, run, "rows.json")))
    print(run, "packingTreatment:", collections.Counter(str(r.get("packingTreatment")) for r in rows),
          "packingInstructionSha256:", collections.Counter(str(r.get("packingInstructionSha256"))[:12] for r in rows))

rows = json.load(open(os.path.join(R, "fp-claudecode-tab-20260826", "rows.json")))
err = collections.Counter()
ex = {}
per_rollout = collections.defaultdict(int)
for r in rows:
    base = os.path.join(R, "fp-claudecode-tab-20260826", "agent-state", "%s-%s" % (r["taskId"], r["arm"]), "claude-home", "projects")
    for f in glob.glob(base + "/*r%d-*/*.jsonl" % r["rep"]):
        uses, seen = {}, set()
        for d in jl(f):
            m = d.get("message") or {}
            content = m.get("content") if isinstance(m.get("content"), list) else []
            for b in content:
                if b.get("type") == "tool_use":
                    uses[b["id"]] = (b.get("name"), b.get("input"))
                elif b.get("type") == "tool_result" and b.get("is_error") and b.get("tool_use_id") not in seen:
                    seen.add(b.get("tool_use_id"))
                    name, inp = uses.get(b.get("tool_use_id"), ("?", {}))
                    t = text_of(b.get("content"))
                    head = re.sub(r"\d+", "N", t.strip().split("\n")[0])[:100]
                    err[(r["arm"], name, head)] += 1
                    per_rollout[(r["arm"], name)] += 1
                    ex.setdefault((r["arm"], name, head), (json.dumps(inp)[:220], t[:400]))
print("\nCLAUDE is_error tool results (count, arm, tool, first line with digits->N) over all 132 main transcripts:")
for k, v in err.most_common(30):
    print(v, k)
print("\nper-arm failed calls by tool (66 rollouts per arm):")
for k, v in sorted(per_rollout.items()):
    print(" ", k, v, "=> %.2f per rollout" % (v / 66))
print("\nexamples:")
for k, v in list(ex.items())[:10]:
    print(k, "\n   input:", v[0], "\n   result:", v[1].replace("\n", " ")[:400])
