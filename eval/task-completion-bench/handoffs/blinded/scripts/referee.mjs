// Lock C referee. Deterministic, $0. Prints opaque IDs and scores only.
import fs from 'node:fs';
const OUT = '/root/blinded-work';
const verd = JSON.parse(fs.readFileSync(`${OUT}/contract-verdicts.json`, 'utf8'));

const IMPLICATED = {
  'apple__swift-nio-http2-145': [/^Sources\/NIOHTTP2\/StreamStateMachine\.swift$/, /^Sources\/NIOHTTP2\/ConnectionStateMachine\//],
  'codeception__codeceptjs-367': [/^lib\/(actor|output|recorder|step)\.js$/],
  'dashbitco__nimble_options-43': [/^lib\/nimble_options\.ex$/, /^lib\/nimble_options\//],
  'epiforecasts__scoringutils-229': [/^R\/input-check-helpers\.R$/],
  'pytask-dev__pytask-210': [/^src\/_pytask\/(traceback|debugging)\.py$/],
  'jashkenas__underscore-2757': [/^underscore\.js$/, /^modules\//],
  'redboltz__mqtt_cpp-466': [/^include\/mqtt\//],
  'statamic__cms-9029': [/^src\/Licensing\//],
};
const TESTPATH = /(^|\/)(tests?|spec|__tests__|Tests)(\/|$)|_test\.|\.test\.|test_.*\.py$|Test\.php$|\.spec\./i;

function parse(patch) {
  const files = [];
  let cur = null;
  for (const ln of patch.split('\n')) {
    let m = ln.match(/^diff --git a\/(\S+) b\/(\S+)/);
    if (m) { cur = { file: m[2], added: [], removed: [] }; files.push(cur); continue; }
    m = ln.match(/^\+\+\+ (?:b\/)?(\S+)/);
    if (m && m[1] !== '/dev/null') { if (!cur) { cur = { file: m[1], added: [], removed: [] }; files.push(cur); } else cur.file = m[1]; continue; }
    if (!cur) continue;
    if (ln.startsWith('+++') || ln.startsWith('---')) continue;
    if (ln.startsWith('+')) cur.added.push(ln.slice(1));
    else if (ln.startsWith('-')) cur.removed.push(ln.slice(1));
  }
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const keep = (s) => { const t = norm(s); return t && !/^(#|\/\/|\*|--|;)/.test(t); };
  const added = files.flatMap(f => f.added).filter(keep).map(norm);
  const removed = files.flatMap(f => f.removed).filter(keep).map(norm);
  const paths = [...new Set(files.map(f => f.file))];
  return { paths, added, removed, files };
}

function jac(a, b) {
  const A = new Map(), B = new Map();
  for (const x of a) A.set(x, (A.get(x) || 0) + 1);
  for (const x of b) B.set(x, (B.get(x) || 0) + 1);
  let inter = 0, uni = 0;
  for (const k of new Set([...A.keys(), ...B.keys()])) {
    const x = A.get(k) || 0, y = B.get(k) || 0;
    inter += Math.min(x, y); uni += Math.max(x, y);
  }
  return uni === 0 ? 1 : inter / uni;
}

const report = {};
for (const task of Object.keys(IMPLICATED)) {
  const dir = `${OUT}/pools/${task}`;
  const oids = fs.readdirSync(dir).filter(f => f.endsWith('.patch')).map(f => f.replace('.patch', '')).sort();
  const P = {};
  for (const o of oids) P[o] = parse(fs.readFileSync(`${dir}/${o}.patch`, 'utf8'));

  const admissible = oids.filter(o => (verd[task][o]?.why || '') !== 'patch did not apply' && P[o].added.length + P[o].removed.length > 0);
  const n = admissible.length;

  // diversity at added-line grain
  const pairs = [];
  for (let i = 0; i < admissible.length; i++) for (let j = i + 1; j < admissible.length; j++)
    pairs.push({ a: admissible[i], b: admissible[j], j: jac(P[admissible[i]].added, P[admissible[j]].added) });
  const degenerate = pairs.length > 0 && pairs.every(p => p.j >= 0.95);
  const distinct = new Set(admissible.map(o => JSON.stringify([...P[o].added].sort()))).size;

  // tiering
  const tierA = admissible.filter(o => verd[task][o].verdict === 'ACCEPT');
  const tierB = admissible.filter(o => verd[task][o].verdict === 'UNDECIDED');
  const eliminated = admissible.filter(o => verd[task][o].verdict === 'REJECT');
  const surviving = tierA.length ? tierA : tierB;

  const scored = surviving.map(o => {
    const p = P[o];
    const consensus = n > 1 ? admissible.filter(d => d !== o && jac(p.added, P[d].added) >= 0.60).length / (n - 1) : 0;
    const changed = p.added.length + p.removed.length;
    const inSet = (f) => IMPLICATED[task].some(re => re.test(f));
    let hit = 0, tot = 0;
    for (const f of p.files) { const c = f.added.length + f.removed.length; tot += c; if (inSet(f.file)) hit += c; }
    const locality = tot ? hit / tot : 0;
    const parsimony = 1 / (1 + Math.log10(1 + changed));
    const penalty = p.paths.some(f => TESTPATH.test(f)) ? -1 : 0;
    const score = 2 * consensus + 2 * locality + parsimony + penalty;
    return { oid: o, score: +score.toFixed(4), consensus: +consensus.toFixed(3), locality: +locality.toFixed(3), parsimony: +parsimony.toFixed(3), penalty, changed, files: p.paths.length };
  });
  scored.sort((a, b) => b.score - a.score || a.changed - b.changed || a.oid.localeCompare(b.oid));

  report[task] = {
    pool: oids.length, admissible: n, distinctAddedLineSets: distinct, degenerate,
    medianPairJaccard: pairs.length ? +pairs.map(p => p.j).sort((x, y) => x - y)[Math.floor(pairs.length / 2)].toFixed(3) : null,
    maxPairJaccard: pairs.length ? +Math.max(...pairs.map(p => p.j)).toFixed(3) : null,
    tierA: tierA.length, tierB: tierB.length, eliminated,
    ranking: scored,
  };
}
fs.writeFileSync(`${OUT}/referee-ranking.json`, JSON.stringify(report, null, 1));
for (const [t, r] of Object.entries(report)) {
  console.log(`\n${t}  pool=${r.pool} adm=${r.admissible} distinctAddedSets=${r.distinctAddedLineSets} degenerate=${r.degenerate} medJ=${r.medianPairJaccard} maxJ=${r.maxPairJaccard}`);
  console.log(`  tierA=${r.tierA} tierB=${r.tierB} eliminated=[${r.eliminated.join(',')}]`);
  console.log('  ' + r.ranking.map((s, i) => `${i + 1}.${s.oid}(${s.score})`).join(' '));
}
