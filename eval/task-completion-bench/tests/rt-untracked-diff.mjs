// BENCH_INCLUDE_UNTRACKED=1 — new files the agent never `git add`ed enter the run_tests diff
// and the graded patch; injected harness files, ignored files and build output never do.
// Offline, docker-free, zero spend: real git working trees, the suite runner injected.
// The OFF path is asserted byte-identical to the exact commands each site ran before.
// `node tests/rt-untracked-diff.mjs` — exit 1 on any failure.
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.RUN_ID = `test-rtuntracked-${process.pid}`;
delete process.env.BENCH_INCLUDE_UNTRACKED;

const {
  includeUntrackedFromEnv, HARNESS_UNTRACKED_EXCLUDES, UNTRACKED_LIMITS, selectUntracked,
  benchGitDiff, recordUntrackedBaseline, untrackedBaselineFor,
} = await import('../harness/rt-untracked-diff.mjs');
const { ATTACH_KEY_UNTRACKED_EXCLUDES } = await import('../harness/rt-inflight.mjs');
const { gitDiffPatch } = await import('../harness/agent-runner-shared.mjs');
const { runTestsWithLevers } = await import('../harness/rt-shim-runtime.mjs');
const { writeRunTestsShim } = await import('../harness/codex-task-runner.mjs');

let ok = true;
const assert = (c, name) => { console.log((c ? '  ✓ ' : '  ✗ ') + name); if (!c) ok = false; };
const work = mkdtempSync(path.join(tmpdir(), 'rt-untracked-'));
const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

// The four pre-switch commands, verbatim. OFF must reproduce them byte for byte.
const LEGACY = {
  shim: dir => execFileSync('git', ['-C', dir, 'diff', 'HEAD', '--', '.', ':(exclude).sweet-search'], {
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
  }),
  graded: dir => execSync(
    `git -C ${dir} diff HEAD -- . ':(exclude).sweet-search' ':(exclude)CLAUDE.md' `
    + `':(exclude)AGENTS.md' ':(exclude).claude/rules/sweet-search.md'`,
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  ),
  api: dir => execFileSync('git', ['-C', dir, 'diff', '--', '.', ':(exclude).sweet-search'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }),
};

let repoCount = 0;
/** A committed repo with the shape of a real rollout at the end of the agent's run. */
function rolloutRepo() {
  const dir = path.join(work, `repo-${++repoCount}`);
  mkdirSync(path.join(dir, 'src'), { recursive: true });
  git(work, ['init', '-q', dir]);
  writeFileSync(path.join(dir, 'src', 'app.js'), "const x = require('./util');\nmodule.exports = x;\n");
  writeFileSync(path.join(dir, '.gitignore'), 'dist/\n');
  git(dir, ['add', '.']);
  git(dir, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base']);
  writeFileSync(path.join(dir, '.git', 'info', 'exclude'), '.sweet-search/\nnode_modules/\n');
  // Harness-owned, injected before the agent starts.
  writeFileSync(path.join(dir, 'CLAUDE.md'), 'frame\n');
  writeFileSync(path.join(dir, 'AGENTS.md'), 'frame\n');
  mkdirSync(path.join(dir, '.claude', 'rules'), { recursive: true });
  mkdirSync(path.join(dir, '.claude', 'agents'), { recursive: true });
  writeFileSync(path.join(dir, '.claude', 'rules', 'sweet-search.md'), 'policy\n');
  writeFileSync(path.join(dir, '.claude', 'agents', 'sweet-search.md'), 'lean\n');
  writeFileSync(path.join(dir, '.claude', 'settings.json'), '{}\n');
  writeFileSync(path.join(dir, '.claude', 'sweet-search-harness.json'), '{}\n');
  writeFileSync(path.join(dir, '.c3-handoff.md'), 'handoff\n');
  mkdirSync(path.join(dir, '.sweet-search'), { recursive: true });
  writeFileSync(path.join(dir, '.sweet-search', 'index.db'), 'idx\n');
  // Ignored trees (gitignore and info/exclude, where dep-materialise puts dependencies).
  mkdirSync(path.join(dir, 'dist'), { recursive: true });
  writeFileSync(path.join(dir, 'dist', 'bundle.js'), 'built\n');
  mkdirSync(path.join(dir, 'node_modules', 'dep'), { recursive: true });
  writeFileSync(path.join(dir, 'node_modules', 'dep', 'index.js'), 'dep\n');
  // The agent's work: one tracked edit and one NEW file it never `git add`ed.
  writeFileSync(path.join(dir, 'src', 'app.js'), "const x = require('./util');\nmodule.exports = { x };\n");
  writeFileSync(path.join(dir, 'src', 'util.js'), 'module.exports = 42;\n');
  return dir;
}
const indexBytes = dir => readFileSync(path.join(dir, '.git', 'index'));
const sectionsOf = diff => diff.split(/^(?=diff --git )/m).filter(Boolean);
const withoutNewFiles = diff => sectionsOf(diff).filter(s => !/^new file mode /m.test(s)).join('');

// ---------- the switch ----------
console.log('switch');
assert(includeUntrackedFromEnv({}) === false, 'unset → off');
assert(includeUntrackedFromEnv({ BENCH_INCLUDE_UNTRACKED: '0' }) === false, '"0" → off');
assert(includeUntrackedFromEnv({ BENCH_INCLUDE_UNTRACKED: 'true' }) === false, 'only the exact value "1" turns it on');
assert(includeUntrackedFromEnv({ BENCH_INCLUDE_UNTRACKED: '1' }) === true, '"1" → on');
assert(JSON.stringify(HARNESS_UNTRACKED_EXCLUDES) === JSON.stringify(ATTACH_KEY_UNTRACKED_EXCLUDES),
  'the attach key (inlined in the shim) ignores exactly the harness paths the patch excludes');

// ---------- OFF: byte-identical to the pre-switch commands ----------
console.log('\nswitch OFF — byte-identical to today');
{
  const dir = rolloutRepo();
  const legacyGraded = LEGACY.graded(dir);
  const off = gitDiffPatch(dir);                      // env unset → off
  assert(off.finalPatch === legacyGraded, 'gitDiffPatch (default) === the legacy graded-patch command');
  assert(gitDiffPatch(dir, { includeUntracked: false }).finalPatch === legacyGraded, 'gitDiffPatch(includeUntracked:false) === legacy');
  assert(!off.finalPatch.includes('util.js'), 'OFF still misses the new file (the defect being switched)');
  assert(benchGitDiff(dir, { pathspecs: ['.', ':(exclude).sweet-search'] }).diff === LEGACY.shim(dir),
    'benchGitDiff off === the legacy run_tests diff');
  assert(benchGitDiff(dir, { pathspecs: ['.', ':(exclude).sweet-search'], base: null }).diff === LEGACY.api(dir),
    'benchGitDiff off, base=null === the legacy API-runner diff');
  assert(benchGitDiff(dir, { pathspecs: ['.'] }).untracked === null, 'OFF reports no untracked selection at all');

  let seen = null;
  const cfg = { rundir: dir, testScript: 't', rtAuthority: false, rtDedup: false };
  runTestsWithLevers(cfg, { runSuiteFn: (_c, diffText) => { seen = diffText; return { out: '1 passed', exitCode: 0 }; } });
  assert(seen === LEGACY.shim(dir), 'runTestsWithLevers with no switch in cfg hands the suite the legacy diff');

  const binDir = path.join(work, 'bin-off');
  writeRunTestsShim(binDir, { image: 'img', workdir: '/w', testScript: 't', rundir: dir, rtAuthority: false, rtDedup: false, label: 'off' });
  const written = JSON.parse(readFileSync(path.join(binDir, '_run_tests_cfg.json'), 'utf8'));
  assert(!('includeUntracked' in written) && !('untrackedBaseline' in written), 'OFF writes no new keys into the shim cfg');
  assert(untrackedBaselineFor(dir) === null, 'OFF records no baseline');
}

// ---------- ON: the new file is in, everything harness-owned or ignored is out ----------
console.log('\nswitch ON — the agent\'s new file enters the patch');
{
  const dir = rolloutRepo();
  const before = indexBytes(dir);
  const statusBefore = git(dir, ['status', '--porcelain']);
  const legacyGraded = LEGACY.graded(dir);
  const on = gitDiffPatch(dir, { includeUntracked: true });
  assert(/^diff --git a\/src\/util\.js b\/src\/util\.js\nnew file mode 100644/m.test(on.finalPatch), 'the new file is a `new file mode` section');
  assert(on.finalPatch.includes('+module.exports = 42;'), 'with its content');
  assert(withoutNewFiles(on.finalPatch) === legacyGraded, 'the tracked part is byte-identical to the legacy patch');
  assert(on.patchFiles === 2 && on.patchHunks === 2, `patchFiles/patchHunks count it (files=${on.patchFiles} hunks=${on.patchHunks})`);
  for (const p of ['CLAUDE.md', 'AGENTS.md', '.claude/', '.c3-handoff.md', '.sweet-search', 'dist/bundle.js', 'node_modules/']) {
    assert(!on.finalPatch.includes(`b/${p}`), `never in the patch: ${p}`);
  }
  assert(indexBytes(dir).equals(before), 'the real index is byte-identical afterwards (temporary index only)');
  assert(git(dir, ['status', '--porcelain']) === statusBefore, 'the agent\'s `git status` is unchanged');
  assert(git(dir, ['diff', '--cached']) === '', 'nothing was staged');

  // Apply exactly as the run_tests container does, onto a clean copy of HEAD.
  const clone = path.join(work, `clone-${repoCount}`);
  git(work, ['clone', '-q', dir, clone]);
  const patchFile = path.join(work, `p-${repoCount}.diff`);
  writeFileSync(patchFile, on.finalPatch);
  execSync(`cd ${clone} && git apply --3way --recount --ignore-space-change --whitespace=nowarn ${patchFile}`, { stdio: 'ignore' });
  assert(existsSync(path.join(clone, 'src', 'util.js'))
    && readFileSync(path.join(clone, 'src', 'util.js'), 'utf8') === 'module.exports = 42;\n',
  'the patch applies with the container\'s own `git apply` flags and creates the file');

  let seen = null;
  const cfg = { rundir: dir, testScript: 't', rtAuthority: false, rtDedup: false, includeUntracked: true };
  runTestsWithLevers(cfg, { runSuiteFn: (_c, diffText) => { seen = diffText; return { out: '1 passed', exitCode: 0 }; } });
  assert(seen.includes('b/src/util.js') && withoutNewFiles(seen) === LEGACY.shim(dir),
    'run_tests hands the suite the tracked diff plus the new file');
  assert(indexBytes(dir).equals(before), 'run_tests leaves the real index untouched too');
}

// ---------- guards ----------
console.log('\nguards — binary, size, count, symlink');
{
  const dir = rolloutRepo();
  writeFileSync(path.join(dir, 'src', 'blob.bin'), Buffer.from([0x50, 0x4b, 0x00, 0x01, 0x02]));
  writeFileSync(path.join(dir, 'src', 'big.txt'), 'x'.repeat(UNTRACKED_LIMITS.maxFileBytes + 1));
  execFileSync('ln', ['-s', 'app.js', path.join(dir, 'src', 'link.js')]);
  const sel = selectUntracked(dir);
  const reason = p => sel.skipped.find(s => s.path === p)?.reason;
  assert(JSON.stringify(sel.files) === JSON.stringify(['src/util.js']), `only the source file is selected (${JSON.stringify(sel.files)})`);
  assert(reason('src/blob.bin') === 'binary', 'a binary file is skipped (it would make `git apply` reject the whole patch)');
  assert(reason('src/big.txt') === 'file-too-large', 'an oversized file is skipped');
  assert(reason('src/link.js') === 'not-regular', 'a symlink is skipped');
  const on = gitDiffPatch(dir, { includeUntracked: true }).finalPatch;
  assert(!/Binary files/.test(on) && !on.includes('blob.bin'), 'no `Binary files differ` stanza reaches the patch');

  const tight = { ...UNTRACKED_LIMITS, maxTotalBytes: 30 };
  writeFileSync(path.join(dir, 'src', 'aaa.js'), 'module.exports = "0123456789abcdef";\n');   // 37 bytes
  const capped = selectUntracked(dir, { limits: tight });
  assert(capped.skipped.some(s => s.path === 'src/aaa.js' && s.reason === 'total-size-cap')
    && capped.files.includes('src/util.js'), 'a file that would pass the total-byte cap is skipped; files that fit are kept');

  const flood = rolloutRepo();
  mkdirSync(path.join(flood, 'build-out'), { recursive: true });
  for (let i = 0; i < 12; i++) writeFileSync(path.join(flood, 'build-out', `f${i}.js`), `${i}\n`);
  const few = { ...UNTRACKED_LIMITS, maxFiles: 10 };
  const floodSel = selectUntracked(flood, { limits: few });
  assert(floodSel.files.length === 0 && /too many untracked files \(13 > 10\)/.test(floodSel.aborted || ''),
    'over the count cap NO untracked file is included (un-ignored build output)');
  const floodDiff = benchGitDiff(flood, { pathspecs: ['.', ':(exclude).sweet-search'], includeUntracked: true, limits: few });
  assert(floodDiff.diff === LEGACY.shim(flood), 'and the diff falls back to exactly the tracked-only diff');
}

// ---------- the pre-agent baseline ----------
console.log('\nbaseline — untracked files that existed before the agent never enter the patch');
{
  const dir = rolloutRepo();
  writeFileSync(path.join(dir, 'injected-by-a-future-runner.txt'), 'harness\n');
  // The new file under test did not exist yet when the shim was written.
  const agentFile = path.join(dir, 'src', 'util.js');
  const content = readFileSync(agentFile);
  execFileSync('rm', [agentFile]);
  const binDir = path.join(work, 'bin-on');
  writeRunTestsShim(binDir, { image: 'img', workdir: '/w', testScript: 't', rundir: dir, rtAuthority: false, rtDedup: false, label: 'on', includeUntracked: true });
  writeFileSync(agentFile, content);                    // the agent creates its file
  const written = JSON.parse(readFileSync(path.join(binDir, '_run_tests_cfg.json'), 'utf8'));
  assert(written.includeUntracked === true, 'ON writes includeUntracked into the shim cfg');
  assert(JSON.stringify(written.untrackedBaseline) === JSON.stringify(['injected-by-a-future-runner.txt']),
    `the cfg baseline is the pre-agent untracked set, harness paths already excluded (${JSON.stringify(written.untrackedBaseline)})`);
  assert(JSON.stringify(untrackedBaselineFor(dir)) === JSON.stringify(written.untrackedBaseline), 'the in-process copy matches the cfg');
  const on = gitDiffPatch(dir, { includeUntracked: true }).finalPatch;
  assert(on.includes('b/src/util.js') && !on.includes('injected-by-a-future-runner.txt'),
    'the graded patch keeps the agent\'s file and drops the pre-existing one');
  let seen = null;
  runTestsWithLevers(written, { runSuiteFn: (_c, diffText) => { seen = diffText; return { out: '1 passed', exitCode: 0 }; } });
  assert(seen.includes('b/src/util.js') && !seen.includes('injected-by-a-future-runner.txt'), 'so does the run_tests diff (baseline read from cfg)');
  assert(recordUntrackedBaseline(path.join(work, 'not-a-repo')) === null, 'an unlistable rundir records a null baseline (static excludes still apply)');
}

// ---------- failure fallback ----------
console.log('\nfailure — a broken temp-index path falls back to the tracked-only diff');
{
  const dir = rolloutRepo();
  execFileSync('mv', [path.join(dir, '.git', 'index'), path.join(dir, '.git', 'index.away')]);
  const r = benchGitDiff(dir, { pathspecs: ['.', ':(exclude).sweet-search'], includeUntracked: true });
  execFileSync('mv', [path.join(dir, '.git', 'index.away'), path.join(dir, '.git', 'index')]);
  assert(/temp-index diff failed/.test(r.untracked?.error || ''), 'the failure is reported');
  assert(!r.diff.includes('util.js') && r.diff.includes('b/src/app.js'), 'and the tracked edit is still delivered');
}

console.log(ok ? '\nALL PASS' : '\nFAILURES');
process.exit(ok ? 0 : 1);
