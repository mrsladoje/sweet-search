"""Census E0 tables (GREP_PAPER_PLAN.md §6 E0) from census.json, as Markdown on stdout.

All tables are aggregates. Tables marked "dev" use dev repositories only; the others pool dev and
held-out counts, which is allowed for aggregates (no per-call held-out data is read or printed).

Usage: python census_report.py --census census.json --candidates candidates-dev.jsonl
"""

import argparse
import collections
import json

# Flags that ss-grep accepts on branch grep-flag-coverage (85a63c6b), for the coverage estimate.
SS_GREP_AFTER = {"-n", "-r", "-R", "-H", "-i", "-w", "-F", "-E", "-l", "-c", "-o", "-A", "-B", "-C", "-e",
                 "--include", "--exclude-dir", "--line-number", "--recursive", "--ignore-case",
                 "--word-regexp", "--fixed-strings", "--extended-regexp", "--files-with-matches", "--count",
                 "--only-matching", "--after-context", "--before-context", "--context"}


def pct(a, b):
    return f"{100 * a / b:.1f}%" if b else "–"


def num(n):
    return f"{n:,}"


def group(census, idx, split=None):
    out = collections.defaultdict(collections.Counter)
    for key, v in census.items():
        parts = key.split("|")
        if split and parts[3] != split:
            continue
        out[parts[idx] if idx is not None else "all"].update(v)
    return out


def overview(title, g):
    print(f"\n### {title}\n")
    print("| Group | Trajectories | Tool calls / traj. | Shell calls / traj. | Grep calls | Grep / traj. "
          "| Search files | Before first edit | Piped to head |")
    print("|---|---:|---:|---:|---:|---:|---:|---:|---:|")
    tot = collections.Counter()
    for k in sorted(g):
        c = g[k]
        tot.update(c)
        _row(k, c)
    if len(g) > 1:
        _row("**All**", tot)


def _row(k, c):
    t = c["trajectories"]
    print(f"| {k} | {num(t)} | {c['tool_calls'] / t:.1f} | {c['bash_calls'] / t:.1f} | {num(c['grep_calls'])} "
          f"| {c['grep_calls'] / t:.1f} | {pct(c['searches_files'], c['grep_calls'])} "
          f"| {pct(c['pre_edit'], c['grep_calls'])} | {pct(c['piped_head'], c['grep_calls'])} |")


def funnel(g):
    print("\n| Step | " + " | ".join(sorted(g)) + " | All |")
    print("|---|" + "---:|" * (len(g) + 1))
    tot = collections.Counter()
    for c in g.values():
        tot.update(c)
    steps = [("Trajectories", "trajectories"), ("Grep-family calls", "grep_calls"),
             ("Search files (not a stdin filter)", "searches_files"), ("… and before the first edit", "sf_pre_edit"),
             ("… and several files (`-r`, `xargs`, 2+ paths)", "sf_pre_multi"),
             ("… and the only grep of the command (eligible)", "eligible"),
             ("Eligible, visible output cut", "eligible_cut"), ("… cut by the agent's head", "eligible_cut_by_head"),
             ("… cut by a harness limit", "eligible_cut_by_harness"),
             ("Trajectories with at least one eligible cut call", "traj_with_eligible_cut")]
    for label, key in steps:
        print(f"| {label} | " + " | ".join(num(g[k][key]) for k in sorted(g)) + f" | **{num(tot[key])}** |")
    print("| Eligible cut calls per trajectory | " + " | ".join(
        f"{g[k]['eligible_cut'] / g[k]['trajectories']:.3f}" for k in sorted(g))
        + f" | {tot['eligible_cut'] / tot['trajectories']:.3f} |")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--census", required=True)
    ap.add_argument("--candidates", required=True)
    a = ap.parse_args()
    census = json.load(open(a.census))

    print("## 1. Calls by harness, model and task source (all repositories, aggregates)")
    overview("By harness", group(census, 0))
    overview("By model", group(census, 1))
    overview("By task source", group(census, 2))

    print("\n## 2. Eligibility funnel by task source (all repositories, aggregates)")
    funnel(group(census, 2))
    print("\n### Same funnel, by harness (all repositories)")
    funnel(group(census, 0))

    allc = group(census, None)["all"]
    print("\n## 3. Truncation policy and head limits (all repositories)\n")
    cut = allc["eligible_cut"]
    print(f"- Eligible cut calls: {num(cut)}. The agent's `head` cut {num(allc['eligible_cut_by_head'])} "
          f"({pct(allc['eligible_cut_by_head'], cut)}); a harness limit cut {num(allc['eligible_cut_by_harness'])} "
          f"({pct(allc['eligible_cut_by_harness'], cut)}).")
    print(f"- On eligible cut calls, a gold-patch file is visible (trace text, file level, rough) in "
          f"{num(allc['eligible_cut_gold_shown'])} ({pct(allc['eligible_cut_gold_shown'], cut)}).")
    heads = collections.Counter({int(k.split(':')[1]): v for k, v in allc.items() if k.startswith("head_n:")})
    cut_heads = collections.Counter({k.split(':')[1]: v for k, v in allc.items()
                                     if k.startswith("eligible_cut_head_n:")})
    print(f"- Grep calls piped to `head`/`tail`: {num(allc['piped_head'])} of {num(allc['grep_calls'])} "
          f"({pct(allc['piped_head'], allc['grep_calls'])}).\n")
    print("| Limit N | Grep calls with head -N | Share | Eligible cut calls with this N |")
    print("|---:|---:|---:|---:|")
    for n, v in heads.most_common(12):
        print(f"| {n} | {num(v)} | {pct(v, allc['piped_head'])} | {num(cut_heads.get(str(n), 0))} |")

    for split in (None, "dev"):
        g = group(census, None, split)["all"]
        sf = g["searches_files"]
        name = "all repositories" if split is None else "dev repositories only"
        print(f"\n## 4{'a' if split is None else 'b'}. Flags and pattern forms on file-searching calls ({name})\n")
        print(f"Base: {num(sf)} file-searching grep-family calls. A flag counts once per call; clusters such as "
              f"`-rn` count as `-r` and `-n`.\n")
        print("| Form | Calls | Share |")
        print("|---|---:|---:|")
        rows = [(k[5:], v) for k, v in g.items() if k.startswith("flag:")]
        rows += [("basic-regex `\\|` alternation (grep without -E/-F/-P)", g["form:bre_alternation"]),
                 ("bare `|` in the pattern", g["form:bare_bar"])]
        for k, v in sorted(rows, key=lambda x: -x[1]):
            if v / sf >= 0.001:
                print(f"| `{k}` | {num(v)} | {pct(v, sf)} |" if not k.startswith(("basic", "bare")) else
                      f"| {k} | {num(v)} | {pct(v, sf)} |")
        sets = {k[8:]: v for k, v in g.items() if k.startswith("flagset:")}
        covered = sum(v for k, v in sets.items() if set(k.split()) <= SS_GREP_AFTER)
        print(f"\n**Coverage estimate (flags only):** {num(covered)} of {num(sf)} file-searching calls "
              f"({pct(covered, sf)}) use only flags that ss-grep accepts on branch `grep-flag-coverage`. "
              f"This counts flags, not patterns, paths or pipelines, and it includes `rg` and `git grep` calls "
              f"under their own flag letters.")

    # Unique tasks and repositories of eligible dev calls
    tasks, repos, trajs = collections.defaultdict(set), collections.defaultdict(set), collections.defaultdict(set)
    calls = collections.Counter()
    for line in open(a.candidates):
        c = json.loads(line)
        for key in ((c["source"], "all"), (c["source"], "cut" if c["cut"] else "uncut")):
            tasks[key].add(c["instance_id"])
            repos[key].add(c["repo"])
            trajs[key].add(c["trajectory_id"])
            calls[key] += 1
    print("\n## 5. Eligible dev calls: independent units (dev repositories only)\n")
    print("| Source | Kind | Calls | Trajectories | Tasks | Repositories |")
    print("|---|---|---:|---:|---:|---:|")
    for key in sorted(calls):
        print(f"| {key[0]} | {key[1]} | {num(calls[key])} | {num(len(trajs[key]))} | {num(len(tasks[key]))} "
              f"| {num(len(repos[key]))} |")


if __name__ == "__main__":
    main()
