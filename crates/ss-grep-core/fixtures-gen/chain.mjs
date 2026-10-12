// Fixtures for src/chain.rs: chainBoundary / chainBoundaryLine for the six agent tools on a
// sample of the corpus argument lists and on synthetic argument lists.
import path from 'node:path';
import { CORPUS, REPOS, jsPath, readJsonl, writeFixture } from './_common.mjs';

const chain = await import(jsPath('core/agent-tools/chain.js'));
const SUBS = ['agent-search', 'grep', 'find', 'read', 'semantic', 'trace'];

const lists = [];
for (const repo of REPOS) {
  const calls = readJsonl(path.join(CORPUS, `${repo}.calls.jsonl`));
  calls.forEach((c, i) => { if (i % 8 === 0) lists.push(c.args); });
}
const long = 'x'.repeat(45);
const emoji = '😀'.repeat(12);
lists.push(
  [], [''], ['-'], ['--'], ['-k', '5', 'foo'], ['-k', '5'], ['5'], ['-A', '10', '12'], ['--in', 'src/a.rs'], ['--in=src/b.rs', 'x'],
  ['--file', 'lib/c.rb', 'q'], ['--file=d.py'], ['--in='], ['--in=a\nb', 'z'], ['--in'], ['a  b\t\nc'], ['  lead and trail  '],
  [' nbsp x﻿'], [long], [`${long}/`], [`dir/${long}.rs`], [emoji], [`${emoji}abc`], ['src/'], ['src///'], ['///'],
  ['/'], ['a/b/c/'], ['proceed', 'callers'], ['proceed', 'CALLERS'], ['proceed', 'Callees', 'impact'], ['-k', '3', 'sym', 'impact'],
  ['--in', 'f.rs', 'sym', 'callers'], ['--depth', '2', 'sym'], ['--query', 'q', '--hint', 'h', 'sym', 'x', 'impact'],
  ['--budget'], ['sym', 'İMPACT'], ['sym', 'caller'], [`${long}${long}`, 'callers'], [emoji + emoji + emoji + emoji, 'impact'],
  ['-x', '-y', '7', 'name'], ['-9', 'n'], ['é', 'ü'], ['dir/é.rs'], ['tab\there'], ['--in', '  spaced/file name.rs  '],
  ['--in', 'a/b/', 'q'], ['ünïcödé-long-name-that-goes-past-ten'], ['1234567890123'], ['-C', '3', '-A', '2', 'pat'],
);
const cases = [];
for (const args of lists) {
  const row = [args];
  for (const sub of SUBS) row.push(chain.chainBoundaryLine(sub, args));
  row.push(chain.chainBoundary('grep', args, { SWEET_SEARCH_CHAIN_LATER: '1' }));
  row.push(chain.chainBoundary('read', args, { SWEET_SEARCH_CHAIN_LATER: '0' }));
  row.push(chain.chainBoundary('trace', args, {}));
  cases.push(row);
}
writeFixture('chain', 'boundary', { subs: SUBS, cases });
console.log('ok', cases.length);
