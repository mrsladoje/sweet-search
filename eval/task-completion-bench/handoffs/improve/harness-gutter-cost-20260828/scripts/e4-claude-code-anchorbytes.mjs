// e4-claude-code-anchorbytes.mjs — print the RAW bytes behind one failed Edit anchor.
// usage: node anchorbytes.mjs <FORM> <task> <rep> [substring-of-anchor]
import fs from 'node:fs';
import * as P from '/tmp/fp-inv/e4-claude-code/parse.mjs';
const [form, task, rep, needle] = process.argv.slice(2);
const runId = form === 'native' ? P.RUNS.TAB : P.RUNS[form];
const arm = form === 'native' ? 'native' : 'sweet';
const ts = P.transcriptsOf(runId, task, arm).filter(t => t.rep === Number(rep));
const vis = s => JSON.stringify(s).replace(/\\t/g, '<TAB>');
for (const t of ts) {
  let all = P.parseTranscript(t.file).calls.slice();
  for (const sf of t.sub) all = all.concat(P.parseTranscript(sf).calls);
  all.forEach((c, i) => {
    const res = String(c.result || '');
    if ((c.name === 'Edit' || c.name === 'MultiEdit') && /String to replace not found/.test(res)) {
      const os = String(c.input.old_string || '');
      if (needle && !os.includes(needle)) return;
      console.log('='.repeat(90));
      console.log(`FAILED EDIT #${i}  file=${c.input.file_path}`);
      console.log('old_string bytes:');
      os.split('\n').slice(0, 8).forEach(l => console.log('   ', vis(l)));
      console.log('result:', vis(res.slice(0, 260)));
      const key = os.split('\n').find(l => l.trim().length > 3)?.trim();
      console.log('\nEVERY prior tool output line whose trimmed text equals the anchor first line:');
      for (let k = 0; k < i; k++) {
        const r = String(all[k].result || '');
        if (!r.includes(key)) continue;
        const cmd = all[k].name === 'Bash' ? all[k].input.command : all[k].name + ' ' + JSON.stringify(all[k].input).slice(0, 120);
        for (const raw of r.split('\n')) {
          if (raw.trim() === key || raw.replace(/^\s*\d+[\t|:]\s?/, '').trim() === key) {
            console.log(`  [call ${k}] ${String(cmd).slice(0, 110)}`);
            console.log(`      raw: ${vis(raw)}`);
          }
        }
      }
    }
  });
}
