#!/usr/bin/env python3
"""Assemble 04-resolution-codex.json from the analysis artifacts plus the
hand-adjudicated per-cell failure modes."""
import json, os, collections

OUT = "/Users/admin/Projects/sweet-search-private/eval/task-completion-bench/handoffs/improve/harness-gutter-cost-20260828"
L = os.path.join(OUT, "logs", "e4-codex")


def j(name):
    return json.load(open(os.path.join(L, name)))


sm = j("solve-matrix.json")
th = j("toolhealth3.json")
gm = j("grepmiss2.json")
st = j("stale.json")
ec = j("editcensus.json")
mp = j("misplace.json")
gr = j("goldreach.json")
ig = j("indexgap.json")

# hand adjudication: task -> arm -> rep -> mode
M = {
 "awslabs__aws-embedded-metrics-node-21": {
   "TAB": {"1": "not-localised", "2": "test-harness"}},
 "accenture__sfmc-devtools-1974": {
   "native": {"0": "wrong-fix", "1": "wrong-fix", "2": "wrong-fix"},
   "TAB": {"0": "wrong-fix", "1": "edit-mechanics"},
   "NONE": {"0": "wrong-fix", "2": "edit-mechanics"},
   "PIPE": {"0": "edit-mechanics", "1": "wrong-fix"}},
 "aio-libs__aiohttp-8038": {
   "native": {"0": "not-localised", "1": "wrong-fix", "2": "wrong-fix"},
   "TAB": {"0": "not-localised", "1": "not-localised", "2": "wrong-fix"},
   "NONE": {"1": "not-localised", "2": "wrong-fix"},
   "PIPE": {"1": "wrong-fix", "2": "wrong-fix"}},
 "bfgroup__b2-113": {
   "native": {"1": "not-localised", "2": "wrong-fix"},
   "TAB": {"0": "not-localised", "1": "not-localised", "2": "not-localised"},
   "NONE": {"0": "not-localised", "1": "not-localised", "2": "not-localised"},
   "PIPE": {"0": "not-localised", "1": "not-localised", "2": "not-localised"}},
 "devlooped__moq-1262": {
   "native": {"0": "wrong-fix", "2": "wrong-fix"},
   "TAB": {"0": "wrong-fix", "1": "wrong-fix"},
   "NONE": {"1": "wrong-fix", "2": "wrong-fix"},
   "PIPE": {"0": "wrong-fix", "1": "wrong-fix"}},
 "locationtech__jts-622": {"NONE": {"2": "wrong-fix"}},
 "bfgroup__b2-259": {
   "native": {"0": "not-localised", "1": "not-localised", "2": "not-localised"},
   "TAB": {"0": "not-localised", "1": "not-localised", "2": "wrong-fix"},
   "NONE": {"0": "not-localised", "1": "not-localised", "2": "not-localised"},
   "PIPE": {"0": "not-localised", "1": "not-localised", "2": "not-localised"}},
 "fastify__fastify-cors-285": {a: {r: "wrong-fix" for r in "012"}
                               for a in ("native", "TAB", "NONE", "PIPE")},
 "gitbookio__markup-it-56": {
   "native": {"0": "not-localised", "1": "not-localised", "2": "not-localised"},
   "TAB": {"0": "wrong-fix", "1": "incomplete", "2": "not-localised"},
   "NONE": {"0": "incomplete", "1": "wrong-fix", "2": "not-localised"},
   "PIPE": {"0": "not-localised", "1": "wrong-fix", "2": "wrong-fix"}},
 "hotmeteor__spectator-181": {
   "native": {r: "wrong-fix" for r in "012"},
   "TAB": {"0": "wrong-fix", "1": "not-localised", "2": "wrong-fix"},
   "NONE": {r: "wrong-fix" for r in "012"},
   "PIPE": {r: "wrong-fix" for r in "012"}},
 "protofire__solhint-224": {a: {r: "incomplete" for r in "012"}
                            for a in ("native", "TAB", "NONE", "PIPE")},
}

SS = {
 "awslabs__aws-embedded-metrics-node-21": "none-negative: the deciding file was inside an ss-read window the losing rep issued",
 "accenture__sfmc-devtools-1974": "none-negative: gold files named 3/6 and shown 6/6 in every arm; ss-read reread-suppression fired and cost one --force call",
 "aio-libs__aiohttp-8038": "none-negative: aiohttp/client.py named+shown in 2-3 of 3 in every arm",
 "bfgroup__b2-113": "DECISIVE NEGATIVE: .jam files are not in FILE_PATTERNS.include and src/build/** is removed by '**/build/**'; stage.jam never named or shown in 9/9 sweet rollouts; native found it in 3/3",
 "devlooped__moq-1262": "friction only: 20 ss-read --force re-reads, 1 ENOENT on a guessed path; no effect on outcome",
 "locationtech__jts-622": "none-negative: the winner used ss-grep --in on the same file the loser skipped",
 "bfgroup__b2-259": "negative but not decisive: same index gap; sweet still reached property.jam by path more often than native",
 "fastify__fastify-cors-285": "none: single file, found by every arm; the answer is router semantics, not repo text",
 "gitbookio__markup-it-56": "positive: sweet patched the gold file 2/2/1 of 3 against native 0 of 3, and still failed on completeness",
 "hotmeteor__spectator-181": "none: single small file found by every arm",
 "protofire__solhint-224": "friction only: one stale-index ss-grep zero on the agent's own insert",
}

tasks = sm["tasks"]
per_task = []
for t in tasks:
    solved = sm["solved"][t]
    cls = sm["classes"][t]
    modes = M.get(t, {})
    per_task.append({
        "task": t,
        "solvedReps": solved,
        "class": cls,
        "sweetFormsWithMajority": sum(1 for a in ("TAB", "NONE", "PIPE") if solved[a] >= 2),
        "nativeMajority": 1 if solved["native"] >= 2 else 0,
        "failureModes": modes,
        "ssContribution": SS.get(t, "n/a - solved in every cell"),
        "goldFileReach": gr.get(t),
        "gutterCouldMatter": False,
        "gutterNote": "no failed hunk in any arm contained gutter residue; codex seek_sequence trims both sides",
    })

modecount = collections.Counter()
for t, arms in M.items():
    for a, reps in arms.items():
        for r, m in reps.items():
            modecount[m] += 1

doc = {
  "task": "E4 resolution forensics, harness=codex",
  "runs": ["fp-codex-tab-20260826", "fp-codex-none-20260826", "fp-codex-pipe-20260826"],
  "rollouts": 264, "nullResolved": len(sm["nullResolved"]),
  "solveTotals": sm["totals"],
  "fisherVsNative": {"TAB": 0.859, "NONE": 1.000, "PIPE": 1.000},
  "costPerRolloutIdealUsd": {"native": 0.012218, "TAB": 0.012258, "NONE": 0.012248, "PIPE": 0.012681},
  "taskClasses": {k: sum(1 for t in tasks if sm["classes"][t] == k)
                  for k in set(sm["classes"].values())},
  "perTask": per_task,
  "failureModeTotals": dict(modecount),
  "toolHealth": {
     "callsByTool": {p: sum(th["calls"][a].get(p, 0) for a in ("TAB", "NONE", "PIPE"))
                     for p in ("ss-read", "ss-grep", "ss-search", "ss-find", "ss-semantic", "ss-trace")},
     "ssEditCalls": 0, "ssFilesCalls": 0,
     "zeroResult": {"ss-grep": sum(th["zero"][a].get("ss-grep", 0) for a in ("TAB", "NONE", "PIPE")),
                    "ss-search": 0, "ss-find": 0, "ss-semantic": 0},
     "events": th["events"],
     "rolloutsWithCounts": {a: {k: len(v) for k, v in th["rolloutsWith"][a].items()}
                            for a in th["rolloutsWith"]},
  },
  "defects": [
   {"id": "D1", "title": "index excludes any build/dist/out/target dir and every .jam file",
    "evidence": {"scopedContradictions": gm["counts"]["contradicted"],
                 "byTask": collections.Counter(f["task"] for f in gm["findings"]),
                 "goldenIndex": {"repo": "bfgroup/b2", "indexedFiles": 330, "jamOnDisk": 321,
                                 "jamEntities": 0, "underBuildEntities": 0,
                                 "stageJamEntities": 0, "srcBuildTargetsPyEntities": 0}},
    "source": "core/infrastructure/config/search.js FILE_PATTERNS.exclude '**/build/**' etc; include has no **/*.jam",
    "costsRollouts": "bfgroup__b2-113: sweet 0/9 vs native 1/3"},
   {"id": "D2", "title": "ss-* crashes with a Node stack trace on a non-regex pattern",
    "evidence": {"crashes": 18, "rollouts": 17, "byArm": {"TAB": 8, "NONE": 5, "PIPE": 5},
                 "quote": "[ss-*] crash: Error: ripgrep failed (code 2): rg: regex parse error: (?:GetApi(ctx) ^ error: unclosed group"},
    "costsRollouts": "none observed"},
   {"id": "D3", "title": "ss-grep reads a stale index and cannot see the agent's own edits",
    "evidence": {"flaggedRollouts": len({f["rollout"] for f in st["findings"]}), "cleanRollouts": 4,
                 "quote": "ss-grep \"OrderingChecker\" -k 10 && ss-read lib/rules/order/index.js 1 30 -> 0 matches then the class on screen"},
    "costsRollouts": "none observed"},
   {"id": "D4", "title": "codex truncates ss output at ~2500 tokens",
    "evidence": {"envelopes": 312, "rolloutsWith": {"TAB": 39, "NONE": 34, "PIPE": 34}},
    "costsRollouts": "none observed; mechanism already tested and near-dead (0 of 6 never-shown anchors in a truncated span)"},
   {"id": "D5", "title": "unchanged-reread suppression costs a --force retry call",
    "evidence": {"omissions": 129, "forceRetries": 19}},
   {"id": "D6", "title": "ss-read ENOENT with no recovery hint", "evidence": {"calls": 27, "rollouts": 15}},
   {"id": "D7", "title": "loader and warm-up diagnostics printed into agent context",
    "evidence": {"envelopes": 18, "rollouts": 17, "bytes": 13304}},
   {"id": "D8", "title": "envelope exits non-zero after an ss-* call, which can break an && chain",
    "evidence": {"calls": 66, "rollouts": 42,
                 "byTool": {"ss-read": 29, "ss-grep": 20, "ss-trace": 8, "ss-search": 4, "ss-find": 1, "ss-semantic": 1}}},
   {"id": "D9", "title": "ss-semantic degrades silently on an unindexed file", "evidence": {"calls": 1}},
   {"id": "D10", "title": "ss-search/ss-find/ss-semantic never return a not-found signal",
    "evidence": {"zeroResultCalls": 0, "totalCalls": 605}},
  ],
  "editMechanics": {
    "applyPatchCalls": {a: ec["events"][a]["edit_calls"] for a in ec["events"]},
    "failedCalls": {a: ec["events"][a].get("edit_failed", 0) for a in ec["events"]},
    "rolloutsWithFailedEdit": {a: len(ec["rolloutsWith"][a].get("edit_failed", []))
                               for a in ec["rolloutsWith"]},
    "hunksBareAtAt": {a: ec["events"][a].get("hunk_bare_@@", 0) for a in ec["events"]},
    "hunksLocatedAtAt": {a: ec["events"][a].get("hunk_located_@@", 0) for a in ec["events"]},
    "postEditRealGitDiffRollouts": {"native": 54, "TAB": 48, "NONE": 46, "PIPE": 44},
    "silentMisplacement": mp["stats"],
    "gutterResidueInFailedHunks": 0,
  },
  "levers": [
   {"id": "L1", "title": "anchor the build-output exclude globs and add .jam to FILE_PATTERNS.include",
    "tasks": ["bfgroup__b2-113", "bfgroup__b2-259", "aws-actions__configure-aws-credentials-42", "apigee__registry-961"],
    "mechanism": "unanchored '**/build/**' deletes src/build/** from the index; no **/*.jam glob at all; verified on the deployed golden index",
    "zeroCostFalsifier": "re-index the 3 b2 goldens with the globs anchored and .jam added; replay the 50 recorded zero-match ss-grep queries; kill if under half return the line ss-read printed",
    "discardCheck": "absent from SLATE-A s9 and SLATE-B s8; contradicts project_taskbench_extension_coverage_audit which tested extensions only",
    "newEvidence": True,
    "expectedResolutionGain": "at most +1 to +2 rollouts of 66, below the bar of 6",
    "status": "ship as a correctness fix, not a resolution claim"},
   {"id": "L2", "title": "ss-grep must not crash on a pattern that is not a valid regex",
    "tasks": ["apigee__registry-961", "aws-actions__configure-aws-credentials-42", "devlooped__moq-1262",
              "gitbookio__markup-it-56", "bfgroup__b2-113", "hotmeteor__spectator-181",
              "fastify__fastify-cors-285", "accenture__sfmc-devtools-1974"],
    "mechanism": "the wrapper hands the pattern to ripgrep unchanged; a parse error escapes as an unhandled rejection; writeRegexDialectHint only runs on success",
    "zeroCostFalsifier": "replay the 18 recorded patterns with a -F fallback on regex-parse error; kill if under half return matches",
    "discardCheck": "absent from both logs; the BRE \\| half is a known open bug (2026-07-14 forensics review)",
    "newEvidence": True, "status": "product-quality fix, cost benefit only"},
   {"id": "L3", "title": "make ss-grep see the working tree or say it cannot",
    "tasks": ["protofire__solhint-224", "aio-libs__aiohttp-8038", "callstack__react-native-paper-972"],
    "mechanism": "ss-grep is index-backed; nothing re-indexes during a rollout; the tool contract says ss-* tracks the working tree",
    "zeroCostFalsifier": "count ss-grep calls after the first successful edit; kill if under 5% of ss-grep calls",
    "discardCheck": "absent from both logs", "newEvidence": True, "status": "contract fix, no measured resolution effect"},
   {"id": "L4", "title": "keep rendered ss-read under codex's ~2500-token cap",
    "status": "DEAD - already falsified in GUTTER-MECHANISM R6 (0 of 6 never-shown anchors in a truncated span); this run adds population, no mechanism"},
   {"id": "L5", "title": "price the unchanged-reread suppression",
    "status": "LOW VALUE - same family as SLATE-B s8 'return the same slice more compactly'; report the 129/19 number only"},
   {"id": "L6", "title": "ambiguous-anchor silent misplacement",
    "status": "DROP - 1 in 293 cited claims; the obvious remedy fails its own population test (post-edit git diff: 113/192 solved vs 50/72 without, p=0.12, wrong direction); prompt form dead by project_clause_candidate_dead"},
   {"id": "L7", "title": "gutter delimiter",
    "status": "NO LEVER - 952 hunks, 26 failed edits, 0 with gutter residue; codex seek_sequence trims both sides"},
  ],
  "indexGapPerPoolRepo": ig,
  "caveats": [
   "10.1% of ss-* calls (288 of 2856) could not be matched to a banner in their envelope output - 25% inside codex-truncated envelopes - so zero-result and error counts are lower bounds",
   "the 131 zero-match ss-grep calls yield 80 unscoped contradictions but only 26 scoped ones; 26 is the number quoted",
   "rollout-to-rep mapping uses rows.json rolloutFile, so the extra-transcript trap cannot apply",
   "cost figures use idealCostUsd; the published table used costRealizedUsd; they agree to 0.6% and rank the arms identically",
  ],
}
with open(os.path.join(OUT, "04-resolution-codex.json"), "w") as f:
    json.dump(doc, f, indent=1, default=lambda o: dict(o) if isinstance(o, collections.Counter) else str(o))
print("wrote 04-resolution-codex.json; failure modes:", dict(modecount), "sum", sum(modecount.values()))
