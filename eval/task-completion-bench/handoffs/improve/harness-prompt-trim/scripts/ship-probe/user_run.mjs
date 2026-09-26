// User-shape $0 run: a project set up by the product installers (rules + lean harness),
// Claude Code started plainly (no bench flags), fake model on PORT.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const W = new URL('../../../../../../../', import.meta.url).pathname.replace(/\/$/, '');  // repo root
const { installClaudeLeanHarness } = await import(W + '/scripts/install-claude-lean-harness.js');
const { writeClaudeRules } = await import(W + '/scripts/write-claude-rules.js');
const [port, perm] = [process.argv[2], process.argv[3] || 'default'];
const work = mkdtempSync(join(tmpdir(), 'lean-user-'));
const repo = join(work, 'repo'), home = join(work, 'home');
mkdirSync(repo); mkdirSync(home);
writeFileSync(join(repo, 'main.py'), 'def add(a, b):\n    return a + b\n');
execFileSync('git', ['init', '-q'], { cwd: repo });
writeClaudeRules({ projectRoot: repo });
console.log(JSON.stringify(installClaudeLeanHarness({ projectRoot: repo })));
const r = spawnSync('/Users/admin/.local/share/claude/versions/2.1.281',
  ['-p', 'Make add accept an optional third argument c.', '--output-format', 'stream-json', '--verbose', '--permission-mode', perm],
  { cwd: repo, encoding: 'utf8', timeout: 90000, env: {
    HOME: home, PATH: '/usr/bin:/bin', CLAUDE_CONFIG_DIR: join(home, '.claude'),
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`, CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-capture-dummy',
    ENABLE_TOOL_SEARCH: 'true', DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', IS_SANDBOX: '1' } });
console.log('exit', r.status, String(r.stderr).slice(0, 300));
const tools = String(r.stdout).split('\n').filter(l => l.includes('"tool_use"')).map(l => l.slice(0, 200));
console.log(tools.join('\n'));
