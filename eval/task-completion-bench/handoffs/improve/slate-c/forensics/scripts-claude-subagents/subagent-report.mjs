#!/usr/bin/env node
// subagent-report.mjs — turn census JSON (from subagent-census.mjs) into the numbers used in the report.
//   node subagent-report.mjs data/census-fp-claudecode-tab-20260826.json [more census files...]
// Dedupe rule for reps with two main transcripts (a relaunched rollout leaves both on disk):
// keep the transcript whose main+subagent call count equals the row's `calls`; else the one whose
// ideal cost equals the row's; else the one with subagents; never "the longest".
import fs from 'node:fs';
const files = process.argv.slice(2);
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : 'n/a';
const f6 = x => x == null ? 'null' : (+x).toFixed(6);
const f0 = x => x == null ? 'null' : Math.round(x).toLocaleString('en-US');

function dedupe(cells) {
  const by = new Map();
  for (const c of cells) { const k = `${c.task}|${c.arm}|${c.rep}`; (by.get(k) || by.set(k, []).get(k)).push(c); }
  const keep = []; const dropped = [];
  for (const [k, v] of by) {
    if (v.length === 1) { keep.push(v[0]); continue; }
    const total = c => c.calls + c.subagents.reduce((a, s) => a + s.calls, 0);
    let pick = v.find(c => c.row && total(c) === c.row.calls)
      || v.find(c => c.row && c.row.idealCostUsd != null && Math.abs(c.idealCostUsd - c.row.idealCostUsd) < 1e-6)
      || v.find(c => c.subagents.length) || v[0];
    keep.push(pick); for (const c of v) if (c !== pick) dropped.push(`${k}:${c.sessionId.slice(0, 8)}`);
  }
  return { keep, dropped };
}

for (const file of files) {
  const J = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { keep: cells, dropped } = dedupe(J.cells);
  console.log(`\n\n# ${J.runId}  (price in=${J.price.in} cache=${J.price.cache} out=${J.price.out} per M)`);
  console.log(`main transcripts kept ${cells.length} (dropped relaunch duplicates: ${dropped.length ? dropped.join(', ') : 'none'})`);
  for (const arm of ['native', 'sweet']) {
    const A = cells.filter(c => c.arm === arm);
    if (!A.length) continue;
    const deleg = A.filter(c => c.subagents.length);
    const tasks = new Set(A.map(c => c.task)), dtasks = new Set(deleg.map(c => c.task));
    const subs = A.flatMap(c => c.subagents.map(s => ({ ...s, task: c.task, rep: c.rep, resolved: c.row?.resolved })));
    console.log(`\n## ${arm}: rollouts=${A.length} delegating rollouts=${deleg.length} (${pct(deleg.length, A.length)}) tasks=${tasks.size} delegating tasks=${dtasks.size}; subagent transcripts=${subs.length}`);
    // agent types
    const types = {}; for (const s of subs) { const k = `${s.agentType || '?'}|iso=${s.isolation || '-'}|bg=${s.background}|model=${s.requestedModel || 'inherit'}`; types[k] = (types[k] || 0) + 1; }
    console.log('subagent types:', JSON.stringify(types));
    console.log(`in worktree: ${subs.filter(s => s.inWorktree).length}/${subs.length}; prompt mentions ss-*: ${subs.filter(s => s.promptMentionsSS).length}/${subs.length}`);
    // requests + usage completeness
    const req = subs.reduce((a, s) => a + s.requests, 0), ureq = subs.reduce((a, s) => a + s.usageRequests, 0);
    console.log(`subagent requests=${req}, with usage=${ureq}, zero-usage=${req - ureq}; ledger-complete transcripts=${subs.filter(s => s.ledgerComplete).length}/${subs.length}`);
    // first request sizes
    const byType = {};
    for (const s of subs) if (s.firstRequestIn != null) (byType[s.agentType || '?'] ??= []).push(s.firstRequestIn);
    for (const [t, v] of Object.entries(byType)) console.log(`first-request context (${t}): n=${v.length} median=${f0(med(v))} min=${f0(Math.min(...v))} max=${f0(Math.max(...v))} (first request carries usage in ${subs.filter(s => (s.agentType || '?') === t && s.firstRequestIsFirst).length}/${v.length})`);
    const mainFirst = A.map(c => c.firstRequestIn).filter(x => x != null);
    console.log(`main-thread first-request context: n=${mainFirst.length} median=${f0(med(mainFirst))} min=${f0(Math.min(...mainFirst))} max=${f0(Math.max(...mainFirst))}`);
    // cost
    const rec = subs.reduce((a, s) => a + s.idealCostUsd, 0), imp = subs.reduce((a, s) => a + s.imputedIdealCostUsd, 0), recReal = subs.reduce((a, s) => a + s.realFromTurnsUsd, 0), impReal = subs.reduce((a, s) => a + s.imputedRealUsd, 0);
    const mainIdealDeleg = deleg.reduce((a, c) => a + c.idealCostUsd, 0), mainIdealAll = A.reduce((a, c) => a + c.idealCostUsd, 0);
    console.log(`subagent ideal cost: recorded $${f6(rec)} (real $${f6(recReal)}), imputed-for-zero-usage $${f6(imp)} (real $${f6(impReal)}); main ideal cost of delegating rollouts $${f6(mainIdealDeleg)}; main ideal cost all rollouts $${f6(mainIdealAll)}`);
    console.log(`=> sidechain share of the arm (imputed ideal): ${pct(imp, imp + mainIdealAll)}; per-rollout arm cost: main-only $${f6(mainIdealAll / A.length)}, inclusive $${f6((mainIdealAll + imp) / A.length)}`);
    const pt = subs.filter(s => s.parentTotalTokens != null);
    console.log(`parent-side totalTokens present for ${pt.length}/${subs.length}; sum=${f0(pt.reduce((a, s) => a + s.parentTotalTokens, 0))} vs transcript totalIn+out for same=${f0(pt.reduce((a, s) => a + s.totalIn + s.totalOut, 0))} vs transcript maxIn+lastOut? (see per-agent)`);
    // tool mix in subagents
    const T = { ss: 0, 'ss-help': 0, 'ss-hunt': 0, 'raw-shell': 0, git: 0, test: 0, other: 0 }; const N = {}; let abs = 0, bare = 0, pagesErr = 0, ssErr = 0, noIdx = 0, cnf = 0;
    for (const s of subs) { for (const k of Object.keys(T)) T[k] += s.tools.bash[k] || 0; for (const [k, v] of Object.entries(s.tools.byName)) N[k] = (N[k] || 0) + v; abs += s.tools.ssAbsPath; bare += s.tools.ssBare; pagesErr += s.tools.pagesErr; ssErr += s.tools.ssErr; noIdx += s.tools.ssNoIndex; cnf += s.tools.cmdNotFound; }
    console.log(`subagent tool names: ${JSON.stringify(N)}`);
    console.log(`subagent Bash buckets: ${JSON.stringify(T)}; ss-* invoked bare=${bare} abs-path=${abs}; ss nonzero-exit=${ssErr}; no-index=${noIdx}; 'command not found'=${cnf}; Read pages errors=${pagesErr}`);
    const withSS = subs.filter(s => s.tools.bash.ss > 0);
    console.log(`subagents that used any ss-*: ${withSS.length}/${subs.length}; that used Read/Grep/Glob: ${subs.filter(s => (s.tools.byName.Read || 0) + (s.tools.byName.Grep || 0) + (s.tools.byName.Glob || 0) > 0).length}/${subs.length}; raw shell search: ${subs.filter(s => s.tools.bash['raw-shell'] > 0).length}/${subs.length}`);
    // guide visibility
    const g = {}; for (const s of subs) for (const [k, v] of Object.entries(s.guide.hits)) g[k] = (g[k] || 0) + 1;
    console.log(`guide markers visible in subagent context (transcripts with ≥1 hit): ${JSON.stringify(g)}; where: ${JSON.stringify([...new Set(subs.flatMap(s => Object.values(s.guide.where).flat()))])}`);
    // dilution (sweet)
    if (arm === 'sweet') {
      console.log('\n### sweet subagents, one line each');
      for (const s of subs) console.log(`- ${s.task} r${s.rep} ${s.agentId} type=${s.agentType} iso=${s.isolation} bg=${s.background} req=${s.requests}(usage ${s.usageRequests}) firstIn=${f0(s.firstRequestIn)} calls=${s.calls} ss=${s.tools.bash.ss}(bare ${s.tools.ssBare}/abs ${s.tools.ssAbsPath}) hunt=${s.tools.bash['ss-hunt']} help=${s.tools.bash['ss-help']} raw=${s.tools.bash['raw-shell']} Read=${s.tools.byName.Read || 0} Grep=${s.tools.byName.Grep || 0} Glob=${s.tools.byName.Glob || 0} preSSreq=${s.preSSRequests} preSS$=${f6(s.preSSIdealCostUsd)} ideal$=${f6(s.imputedIdealCostUsd)} parentTok=${f0(s.parentTotalTokens)} guide=${JSON.stringify(s.guide.hits)} promptSS=${s.promptMentionsSS} resolved=${s.resolved}\n    prompt: ${JSON.stringify(s.promptPrefix.slice(0, 160))}\n    seq: ${s.tools.seq.slice(0, 14).join(' ')}${s.tools.seq.length > 14 ? ' …' : ''}`);
    } else {
      console.log('\n### native subagents, one line each');
      for (const s of subs) console.log(`- ${s.task} r${s.rep} ${s.agentId} type=${s.agentType} iso=${s.isolation} bg=${s.background} req=${s.requests}(usage ${s.usageRequests}) firstIn=${f0(s.firstRequestIn)} calls=${s.calls} Read=${s.tools.byName.Read || 0} Grep=${s.tools.byName.Grep || 0} Glob=${s.tools.byName.Glob || 0} rawBash=${s.tools.bash['raw-shell']} otherBash=${s.tools.bash.other + s.tools.bash.git + s.tools.bash.test} ideal$=${f6(s.imputedIdealCostUsd)} parentTok=${f0(s.parentTotalTokens)} resolved=${s.resolved}\n    prompt: ${JSON.stringify(s.promptPrefix.slice(0, 160))}`);
    }
    // delegation timing
    const idx = deleg.map(c => c.firstAgentIdx).filter(i => i >= 0);
    console.log(`\nfirst Agent call index in delegating rollouts: median ${med(idx)} min ${Math.min(...idx)} max ${Math.max(...idx)}; total calls in those rollouts median ${med(deleg.map(c => c.calls))}`);
    for (const c of deleg) console.log(`  ${c.task} r${c.rep}: Agent at call #${c.firstAgentIdx + 1} of ${c.calls}; before it: ${(c.callsBeforeFirstAgent || []).join(' ')}`);
  }
  // first-five comparison on tasks where native delegated
  const nat = cells.filter(c => c.arm === 'native'), sw = cells.filter(c => c.arm === 'sweet');
  const dTasks = [...new Set(nat.filter(c => c.subagents.length).map(c => c.task))].sort();
  if (dTasks.length) {
    console.log(`\n## first ${5} calls, tasks where native delegated (${dTasks.length} tasks)`);
    for (const t of dTasks) {
      console.log(`\n### ${t}`);
      for (const c of nat.filter(c => c.task === t)) console.log(`  native r${c.rep} ${c.subagents.length ? 'DELEGATED' : 'no-deleg'} res=${c.row?.resolved} calls=${c.calls} req=${c.requests}: ${c.firstCalls.slice(0, 5).map(x => `[${x.i + 1}] ${x.name}${x.name === 'Bash' ? ' ' + x.brief.slice(0, 60) : x.name === 'Agent' ? ' ' + x.brief.slice(0, 70) : ' ' + x.brief.slice(0, 40)}`).join(' | ')}`);
      for (const c of sw.filter(c => c.task === t)) console.log(`  sweet  r${c.rep} ${c.subagents.length ? 'DELEGATED' : 'no-deleg'} res=${c.row?.resolved} calls=${c.calls} req=${c.requests}: ${c.firstCalls.slice(0, 5).map(x => `[${x.i + 1}] ${x.name}${x.name === 'Bash' ? ' ' + x.brief.slice(0, 60) : x.name === 'Agent' ? ' ' + x.brief.slice(0, 70) : ' ' + x.brief.slice(0, 40)}`).join(' | ')}`);
    }
    // position-1/2/3 histogram
    const hist = arm => { const h = [{}, {}, {}]; for (const c of cells.filter(c => c.arm === arm && dTasks.includes(c.task))) c.firstCalls.slice(0, 3).forEach((x, i) => { const k = x.name === 'Bash' ? 'Bash:' + (x.brief.match(/^(ss-[a-z]+|run_tests|grep|rg|find|cat|ls|git|sed|head|tail|pwd)/) || ['other'])[0] : x.name; h[i][k] = (h[i][k] || 0) + 1; }); return h; };
    console.log(`\nnative first three call slots on those tasks: ${JSON.stringify(hist('native'))}`);
    console.log(`sweet  first three call slots on those tasks: ${JSON.stringify(hist('sweet'))}`);
  }
}
