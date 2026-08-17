#!/usr/bin/env node
// SLATE-B W0 gate — P4 falsifier 2: the cited-reference corpus.
//
// P4's second half proposes harvesting the RFC / specification / URL citations that live in
// repository comments into a labelled `refs` corpus, so a task that names a standard can be
// answered from normative text. Its pre-registered retention bar: at least TWO task
// contracts must be materially derivable from cited documents. Apple and pytask are the
// pre-registered probes.
//
// "Materially derivable" is the whole question, and it is not the same as "a citation
// exists". A file can cite RFC 7540 on the very line that implements the disputed rule and
// still leave the rule undecided — which is what the repository says about itself here. So
// the harvest reports two separate numbers: how many citations exist, and how many sit on
// the code the task actually changes. Only the second can support the claim.
//
// $0: greps checked-out source. No network — nothing is fetched, so no document is read
// here and no derivability is asserted from one.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const BENCH = process.env.BENCH || '/root/sweet-search-private/eval/task-completion-bench';
const GOLDEN = process.env.GOLDEN || '/root/.ss-eval/golden';
const tasks = JSON.parse(readFileSync(path.join(BENCH, 'select/.cache/tasks_full_luna_rotate20.json'), 'utf8'));

const EXT = new Set(['.swift', '.rs', '.ts', '.js', '.java', '.kt', '.go', '.py', '.cs', '.rb', '.ex', '.exs', '.dart', '.php', '.scala', '.c', '.cpp', '.h', '.hpp', '.lua', '.R', '.r', '.md', '.txt']);
const SKIP = new Set(['.git', 'node_modules', 'vendor', 'target', 'build', 'dist', '.build', 'Pods', '__pycache__', 'deps', '_build', 'third_party']);

// A citation is a pointer to a document outside the repository that carries normative
// weight: a numbered standard, or a link to one. Bare links to issue trackers, badges and
// package registries are excluded — they are provenance, not normative text.
const NORMATIVE = /\b(RFC\s?\d{3,5}|ISO[/ ]?IEC\s?\d+|IEEE\s?\d+|ECMA-\d+|PEP\s?\d{1,4}|W3C\b|WHATWG\b|Unicode\s+(?:Standard|Annex)|POSIX\b|JSR-?\d+|OWASP\b|semver\.org|tools\.ietf\.org|datatracker\.ietf\.org|www\.rfc-editor\.org|spec\.whatwg\.org|w3\.org\/TR)/gi;
const SECTION = /§\s?\d[\d.]*|[Ss]ection\s+\d[\d.]*/;

function* walk(dir, d = 0) {
  if (d > 10) return;
  let es; try { es = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of es) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { yield* walk(p, d + 1); continue; }
    if (e.isFile() && EXT.has(path.extname(e.name))) yield p;
  }
}

const rows = [];
for (const t of tasks) {
  const repoDir = path.join(GOLDEN, `${t.repo.replace('/', '__')}@${t.base_commit}`);
  if (!existsSync(repoDir)) { rows.push({ task: t.instance_id, missing: true }); continue; }

  // Files the reference solution touches. Read from the diff header only — the file list,
  // never the added or removed lines, so this stays a question about WHERE citations sit.
  const touched = new Set([...String(t.patch || '').matchAll(/^diff --git a\/(\S+)/gm)].map(m => m[1]));

  let cites = 0, withSection = 0, onTouched = 0, onTouchedSection = 0;
  const docs = new Map();
  const samples = [];
  for (const f of walk(repoDir)) {
    let st; try { st = statSync(f); } catch { continue; }
    if (st.size > 2 * 1024 * 1024) continue;
    let text; try { text = readFileSync(f, 'utf8'); } catch { continue; }
    NORMATIVE.lastIndex = 0;
    const hits = text.match(NORMATIVE);
    if (!hits) continue;
    const rel = path.relative(repoDir, f);
    const isTouched = touched.has(rel);
    for (const h of hits) {
      const key = h.replace(/\s+/g, ' ').toUpperCase();
      docs.set(key, (docs.get(key) || 0) + 1);
      cites++;
      if (isTouched) onTouched++;
    }
    for (const line of text.split('\n')) {
      NORMATIVE.lastIndex = 0;
      if (!NORMATIVE.test(line)) continue;
      if (SECTION.test(line)) { withSection++; if (isTouched) { onTouchedSection++; samples.push(`${rel}: ${line.trim().slice(0, 130)}`); } }
    }
  }
  rows.push({
    task: t.instance_id, lang: t.language, cites, withSection, onTouched, onTouchedSection,
    touchedFiles: touched.size,
    topDocs: [...docs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}×${v}`),
    samples: samples.slice(0, 4),
  });
}

const w = (s, n) => String(s).padEnd(n);
console.log(w('task', 40) + w('cites', 8) + w('w/ §', 7) + w('on changed files', 18) + w('§ there', 9) + 'top cited');
for (const r of rows) {
  if (r.missing) { console.log(w(r.task, 40) + 'golden checkout absent'); continue; }
  console.log(w(r.task, 40) + w(r.cites, 8) + w(r.withSection, 7) + w(r.onTouched, 18) + w(r.onTouchedSection, 9) + r.topDocs.join(' '));
}

const live = rows.filter(r => !r.missing);
console.log(`\nrepositories harvested                         ${live.length}`);
console.log(`  with any normative citation                  ${live.filter(r => r.cites > 0).length}`);
console.log(`  citing a numbered section anywhere           ${live.filter(r => r.withSection > 0).length}`);
console.log(`  citing on a file the reference fix changes   ${live.filter(r => r.onTouched > 0).length}`);
console.log(`  ... with a numbered section on that file     ${live.filter(r => r.onTouchedSection > 0).length}`);

console.log('\n--- the pre-registered probes, in the repositories\' own words');
for (const id of ['apple__swift-nio-http2-145', 'pytask-dev__pytask-210']) {
  const r = live.find(x => x.task === id);
  console.log(`\n${id}: ${r ? `${r.cites} citations, ${r.onTouchedSection} sectioned on changed files` : 'not harvested'}`);
  for (const s of (r?.samples || [])) console.log('   ' + s);
}
