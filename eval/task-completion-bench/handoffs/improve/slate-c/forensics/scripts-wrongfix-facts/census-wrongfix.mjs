#!/usr/bin/env node
// census-wrongfix.mjs — classify every recorded patch for the ten tasks into the
// wrong-fix classes named in wrongfix-facts.md, from cells.json (extract-cells.mjs output).
// Rules are surface patterns over the agent's own patch text (never gold). Prints per-task counts.
//
//   node census-wrongfix.mjs <cells.json>
import fs from 'node:fs';
const j = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

// Canonical opencode sweet rows: the repair pass replaced 11 tasks' sweet rows (FRESH-POOL-RESULTS §"repair").
const REPAIRED = new Set(['accenture__sfmc-devtools-1974','aio-libs__aiohttp-8038','awslabs__aws-embedded-metrics-node-21','devlooped__moq-1262','protofire__solhint-224']);
const cells = j.cells.filter(c => !(c.harness === 'opencode' && c.arm === 'sweet' && REPAIRED.has(c.taskId) && c.run.startsWith('fp-')));

const classify = {
  'fastify__fastify-cors-285': c => {
    const p = c.patch || '';
    if (/options\('\*'/.test(p)) return 'wildcard-only literal (reference shape)';
    if (/options\('\/'/.test(p) || /options\('\/:path\*'/.test(p)) return 'kept /* and ADDED a second route';
    return 'other';
  },
  'hotmeteor__spectator-181': c => {
    const p = c.patch || '';
    const files = c.patchFilesList || [];
    if (files.length === 1 && files[0].endsWith('ResponseValidator.php')) return 'rewrote validator exception message only';
    if (/assertStatus\(/.test(p)) return 'delegated to framework assertStatus';
    return 'hand-rolled own status message in Assertions.php' + (files.length > 1 ? ' + validator message' : '');
  },
  'gitbookio__markup-it-56': c => {
    const files = (c.patchFilesList || []).join(',');
    const p = c.patch || '';
    if (/state\.shift\(\)|node\.shift\(\)\.write\(node\.data/.test(p) && /inlines\/html/.test(files)) return 'inline-html serializer text only (no merge)';
    if (/inlines\/html/.test(files)) return 'inline-html deserializer tag split (no merge)';
    if (/re\/inline/.test(files)) return 'inline html regex change';
    if (/blocks\//.test(files)) return 'block-level HTML rule added';
    if (/deserializeHtml/.test(files)) return 'html-input parser (wrong syntax)';
    return 'other';
  },
  'bfgroup__b2-259': c => {
    const p = c.patch || ''; const files = (c.patchFilesList || []).join(',');
    if (/build-feature\.jam/.test(files)) return 'made the feature incidental (feature declaration)';
    if (/rule check \(/.test(p) && /<build>no in \$\(properties\)/.test(p)) return 'guard inside worker check() on its argument';
    if (/targets\.jam/.test(files)) return 'guard in targets.jam on build-request/requirements';
    if (/property\.jam/.test(files)) return 'edited property.jam relevance rule (adjacent, wrong rule)';
    if (/configure\.jam/.test(files)) return 'guard elsewhere in configure.jam (builds/find-builds/relevance)';
    return 'other';
  },
  'protofire__solhint-224': c => {
    const p = c.patch || '';
    const rid = (p.match(/(?:ruleId|RULE_ID|layoutRuleId|orderingRuleId)\s*=\s*'([^']+)'/) || p.match(/super\(reporter,\s*'([^']+)'/) || [])[1] || '?';
    const su = /SourceUnit\(/.test(p);
    const fn = /(external|public|internal|private).*(order|Order)/.test(p) && /FunctionDefinition/.test(p) && /visibility/i.test(p);
    return `ruleId=${rid}; contract-level order only${su ? ' + source-unit pragma/import order' : ''}${fn ? ' + function visibility' : ''}`;
  },
  'devlooped__moq-1262': c => {
    const files = (c.patchFilesList || []).join(','); const p = c.patch || '';
    if (c.resolved) return 'SOLVED: ' + (/HasNonConstantMatchers/.test(p) ? 'skip override-marking for non-constant matchers' : 'MethodExpectation equality: distinct matcher instances unequal');
    if (/Match\.cs/.test(files) || /ExpressionComparer\.cs/.test(files)) return 'changed Match.Equals / ExpressionComparer (not on override path for It.Is)';
    if (/MethodExpectation\.cs/.test(files) || /InterceptionAspects/.test(files) || /SetupCollection/.test(files)) return 'changed setup selection/specificity, not the capture evaluation';
    if (/MatcherFactory/.test(files)) return 'MatcherFactory expression swap';
    return 'other';
  },
  'accenture__sfmc-devtools-1974': c => {
    const p = c.patch || '';
    if (c.resolved) return 'SOLVED';
    if (/@@ -1593,/.test(p)) return 'hunk landed in the wrong method (duplicate anchor, line 1593)';
    if (/length/.test(p) && /selectedTypes/.test(p)) return 'blanket guard also rejects EMPTY selection (breaks sibling caller)';
    return 'other';
  },
  'awslabs__aws-embedded-metrics-node-21': c => {
    const files = (c.patchFilesList || []).join(','); const p = c.patch || '';
    if (c.resolved) return 'SOLVED (context-layer dedupe)';
    if (/LogSerializer/.test(files)) return 'dedupe at serializer layer (invisible to state-level tests)';
    if (/throw new Error/.test(p)) return 'context layer but THROWS on duplicate';
    if (c.f2pFrac === 1) return 'context layer, F2P pass, P2P timestamp flake';
    return 'other';
  },
  'aio-libs__aiohttp-8038': c => {
    const p = c.patch || ''; const files = (c.patchFilesList || []).join(',');
    if (c.resolved) return 'SOLVED: retry not conditioned on header (' + (/IDEMPOTENT/.test(p) ? 'idempotent methods' : 'connection reused') + ')';
    if (/keep.?alive/i.test(p) && /(continue|retry)/.test(p)) return 'retry CONDITIONED on keep-alive header';
    if (/is_connected\(\)|eof_received/.test(p) && !/continue/.test(p)) return 'no retry: close-detection tweak at release/eof';
    if (/client_reqrep/.test(files) && !/client\.py/.test(files)) return 'response-layer header check, no retry';
    if (!p) return 'no patch';
    return 'other';
  },
  'celestiaorg__nmt-192': c => c.resolved ? 'SOLVED' : (c.patch ? 'other' : 'no patch (stopped after analysis)'),
};

for (const [task, fn] of Object.entries(classify)) {
  const cs = cells.filter(c => c.taskId === task);
  const counts = {};
  for (const c of cs) { const k = fn(c); counts[k] = counts[k] || { n: 0, cells: [] }; counts[k].n++; counts[k].cells.push(`${c.harness[0]}${c.harness === 'claude-code' ? 'c' : ''}:${c.arm[0]}${c.rep}`); }
  const solved = cs.filter(c => c.resolved).length;
  console.log(`\n== ${task}  cells=${cs.length} solved=${solved}`);
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1].n - a[1].n)) console.log(`  ${String(v.n).padStart(2)}  ${k}   [${v.cells.join(' ')}]`);
}
