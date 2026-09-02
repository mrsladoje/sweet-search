// e4-claude-code-jamcheck.mjs — did ANY ss-* surface ever return a .jam path on the two b2 tasks?
import * as P from '/tmp/fp-inv/e4-claude-code/parse.mjs';
const tasks = ['bfgroup__b2-113', 'bfgroup__b2-259'];
const CELLS = [['native', P.RUNS.TAB, 'native'], ['TAB', P.RUNS.TAB, 'sweet'], ['NONE', P.RUNS.NONE, 'sweet'], ['PIPE', P.RUNS.PIPE, 'sweet']];
for (const task of tasks) {
  console.log('###', task);
  for (const [form, runId, arm] of CELLS) {
    let ssJam = 0, ssCalls = 0, bashJam = 0, bashCalls = 0; const ssJamEx = [], ssPaths = new Set();
    for (const rep of [0, 1, 2]) {
      const ts = P.transcriptsOf(runId, task, arm).filter(t => t.rep === rep);
      for (const t of ts) {
        let all = P.parseTranscript(t.file).calls.slice();
        for (const sf of t.sub) all = all.concat(P.parseTranscript(sf).calls);
        for (const c of all) {
          const isBash = c.name === 'Bash';
          const cmd = isBash ? String(c.input.command || '') : '';
          const res = String(c.result || '');
          const hits = isBash ? P.ssToolsIn(cmd) : [];
          const jam = [...res.matchAll(/([\w./-]+\.jam)/g)].map(m => m[1]);
          if (hits.length) {
            ssCalls++;
            if (jam.length) { ssJam++; jam.slice(0, 3).forEach(j => ssPaths.add(j)); if (ssJamEx.length < 3) ssJamEx.push({ rep, cmd: cmd.slice(0, 120), jam: [...new Set(jam)].slice(0, 5) }); }
          } else if (isBash) { bashCalls++; if (jam.length) bashJam++; }
        }
      }
    }
    console.log(`  ${form.padEnd(7)} ss-calls=${String(ssCalls).padStart(3)} with-.jam-in-output=${ssJam}   bash-calls=${String(bashCalls).padStart(3)} with-.jam=${bashJam}`);
    if (ssJamEx.length) for (const e of ssJamEx) console.log(`      e.g. r${e.rep} "${e.cmd}" -> ${JSON.stringify(e.jam)}`);
  }
}
