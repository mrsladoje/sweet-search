// e4-claude-code-toolhealth2.mjs — deeper product-defect passes over the 198 claude-code sweet rollouts.
import fs from 'node:fs';
import * as P from '/tmp/fp-inv/e4-claude-code/parse.mjs';
const BASE = P.ROOT + '/results';
const forms = ['TAB', 'NONE', 'PIPE'];
const rowsOf = id => JSON.parse(fs.readFileSync(`${BASE}/${id}/rows.json`, 'utf8'));

const R = {
  breHint: { total: 0, zeroBoth: 0, recovered: 0, rollouts: new Set(), ex: [] },
  enoent: { total: 0, pathFromSS: 0, pathInvented: 0, ex: [] },
  readBeforeEdit: { edits: 0, nativeReadWithin3: 0, ssReadWithin3: 0 },
  editFail: { calls: 0, fail: 0, notFound: 0, notUnique: 0, noChange: 0, jsonErr: 0, other: 0, rollouts: new Set(), ex: [] },
  perForm: {},
  nativeReadAfterSSRead: { total: 0, sameSpan: 0, ex: [] },
};
for (const form of forms) {
  const runId = P.RUNS[form];
  const rows = rowsOf(runId).filter(r => r.arm === 'sweet');
  const F = R.perForm[form] = { edits: 0, editFail: 0, editFailRollouts: new Set(), nativeRead: 0, nativeReadAfterSSRead: 0, breHint: 0, breZero: 0, enoent: 0 };
  const tasks = [...new Set(rows.map(r => r.taskId))].sort();
  for (const task of tasks) {
    const ts = P.transcriptsOf(runId, task, 'sweet');
    const byRep = new Map(); for (const t of ts) { const c = byRep.get(t.rep); if (!c || t.size > c.size) byRep.set(t.rep, t); }
    for (const [rep, t] of [...byRep.entries()].sort((a, b) => a[0] - b[0])) {
      const rid = `${form}/${task}/r${rep}`;
      let all = P.parseTranscript(t.file).calls.slice();
      for (const sf of t.sub) all = all.concat(P.parseTranscript(sf).calls);
      const ssShownFiles = new Set();
      const ssReadFiles = new Map();
      all.forEach((c, i) => {
        const isBash = c.name === 'Bash';
        const cmd = isBash ? String(c.input.command || '') : '';
        const res = String(c.result || '');
        const hits = isBash ? P.ssToolsIn(cmd) : [];
        if (hits.length) {
          for (const m of res.matchAll(/BRE operators were retried with unescaped Rust operators; ([^\n]*)/g)) {
            R.breHint.total++; F.breHint++; R.breHint.rollouts.add(rid);
            if (/both forms returned 0 mat/.test(m[1])) { R.breHint.zeroBoth++; F.breZero++; }
            else R.breHint.recovered++;
            if (R.breHint.ex.length < 8) R.breHint.ex.push({ rid, cmd: cmd.slice(0, 200), hint: m[0].slice(0, 200) });
          }
          for (const m of res.matchAll(/\[ss-read\] error: stat failed: ENOENT/g)) {
            R.enoent.total++; F.enoent++;
            const paths = [...cmd.matchAll(/ss-read\s+(\S+)/g)].map(x => x[1].replace(/^["']|["']$/g, ''));
            const fromSS = paths.filter(p => [...ssShownFiles].some(f => f === p || f.endsWith('/' + p) || p.endsWith('/' + f)));
            if (fromSS.length) R.enoent.pathFromSS++; else R.enoent.pathInvented++;
            if (R.enoent.ex.length < 10) R.enoent.ex.push({ rid, paths, fromSS });
          }
          for (const m of res.matchAll(/(^|[\s#*`(])([\w./@+-]+\/[\w.@+-]+\.[A-Za-z0-9_]+)(?=[:\s`)\],]|$)/gm)) ssShownFiles.add(m[2]);
          for (const m of res.matchAll(/^# ss-read (\S+) \(lines (\d+)-(\d+)/gm)) { ssShownFiles.add(m[1]); ssReadFiles.set(m[1], [Number(m[2]), Number(m[3])]); }
          for (const m of res.matchAll(/^# ss-read (\S+) \((\d+) lines\)/gm)) { ssShownFiles.add(m[1]); ssReadFiles.set(m[1], [1, Number(m[2])]); }
        }
        if (c.name === 'Read') {
          F.nativeRead++;
          const fp = String(c.input.file_path || '');
          const rel = [...ssReadFiles.keys()].find(f => fp.endsWith('/' + f) || fp.endsWith(f));
          if (rel) {
            F.nativeReadAfterSSRead++; R.nativeReadAfterSSRead.total++;
            const [s, e] = ssReadFiles.get(rel);
            const off = Number(c.input.offset || 0), lim = Number(c.input.limit || 0);
            const overlap = lim > 0 ? !(off + lim < s || off > e) : true;
            if (overlap) { R.nativeReadAfterSSRead.sameSpan++; if (R.nativeReadAfterSSRead.ex.length < 10) R.nativeReadAfterSSRead.ex.push({ rid, file: rel, ssSpan: [s, e], nativeOffsetLimit: [off, lim] }); }
          }
        }
        if (c.name === 'Edit' || c.name === 'MultiEdit') {
          R.editFail.calls++; F.edits++; R.readBeforeEdit.edits++;
          const fp = String(c.input.file_path || '');
          const prev = all.slice(Math.max(0, i - 3), i);
          if (prev.some(p => p.name === 'Read' && String(p.input.file_path || '') === fp)) R.readBeforeEdit.nativeReadWithin3++;
          const base = fp.split('/').slice(-1)[0];
          if (prev.some(p => p.name === 'Bash' && /ss-read/.test(String(p.input.command || '')) && String(p.input.command).includes(base))) R.readBeforeEdit.ssReadWithin3++;
          const bad = c.isError || /String to replace not found|Found \d+ matches of the string|No changes to make|InputValidationError/.test(res);
          if (bad) {
            R.editFail.fail++; F.editFail++; F.editFailRollouts.add(rid); R.editFail.rollouts.add(rid);
            if (/String to replace not found/.test(res)) R.editFail.notFound++;
            else if (/Found \d+ matches of the string/.test(res)) R.editFail.notUnique++;
            else if (/No changes to make/.test(res)) R.editFail.noChange++;
            else if (/InputValidationError/.test(res)) R.editFail.jsonErr++;
            else R.editFail.other++;
            if (R.editFail.ex.length < 60) R.editFail.ex.push({ rid, file: fp, err: res.slice(0, 200), old: String(c.input.old_string || '').slice(0, 200) });
          }
        }
      });
    }
  }
  F.editFailRollouts = F.editFailRollouts.size;
}
R.breHint.rollouts = R.breHint.rollouts.size;
R.editFail.rollouts = R.editFail.rollouts.size;
console.log(JSON.stringify(R, null, 1));
