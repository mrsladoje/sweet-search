// Usage: node capture-agent.mjs <repo-name> <outdir>   (run via run-capture.sh)
// Replays real dev ss-* calls through the daemon route in-process and dumps every
// native MaxSim kernel call (query + candidate pool + our scores).
import fs from 'node:fs';
import path from 'node:path';
const REPO_SRC = path.resolve(new URL('.', import.meta.url).pathname, '../..');
const [repo, outRoot] = process.argv.slice(2);
const root = path.join(REPO_SRC, 'eval/repos', `r3-${repo}`);
process.chdir(root);
process.env.SWEET_SEARCH_PROJECT_ROOT = root;
const calls = JSON.parse(fs.readFileSync(path.join(outRoot, 'calls.json')))[repo];

const { default: SweetSearch } = await import(`${REPO_SRC}/core/search/sweet-search.js`);
const { buildAgentToolDaemonResponse } = await import(`${REPO_SRC}/core/agent-tools/daemon-route.js`);
const searcher = new SweetSearch({ verbose: false });
await searcher.init();
const sub = { 'ss-search': 'agent-search', 'ss-semantic': 'semantic', 'ss-find': 'find' };
const t0 = Date.now(); let fails = 0; const codes = {};
for (let i = 0; i < calls.length; i++) {

  const c = calls[i];
  const env = { ...process.env, SWEET_SEARCH_PROJECT_ROOT: root };
  const res = await buildAgentToolDaemonResponse({ v: 1, tool: sub[c.tool], args: c.args, cwd: root, env, pid: process.pid },
    { isUnixSocket: true, searcher, isReady: () => true });

  const b = typeof res.body === 'string' ? JSON.parse(res.body) : (res.body ?? res);
  const k = `${c.tool}:${b.code}`; codes[k] = (codes[k] || 0) + 1;
  if (b.code === 1 && fails++ < 3) console.error('FAIL', c.tool, String(b.stderr).slice(0, 200));
}
console.log(JSON.stringify({ repo, calls: calls.length, codes, fails, sec: (Date.now() - t0) / 1000 }));
process.exit(0);
