/**
 * Rust files in the ss-grep lane name the JS code they copy in `// Mirrors: <file>:<function>`
 * comments. The text is the contract between the two languages: when a JS file or function is
 * renamed or moved, the marker must follow, or a later reader changes only one side.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../..');
const RUST_DIRS = ['crates/ss-grep-core/src', 'crates/sweet-search-native/src/lane'];

function rustFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...rustFiles(rel));
    else if (entry.name.endsWith('.rs')) out.push(rel);
  }
  return out;
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function declaresName(source, name) {
  const n = escapeRegex(name);
  return [
    new RegExp(`\\bfunction\\*?\\s+${n}\\b`),
    new RegExp(`\\b(?:const|let|var|class)\\s+${n}\\b`),
    new RegExp(`^\\s*(?:static\\s+)?(?:async\\s+)?\\*?${n}\\s*\\([^)]*\\)\\s*\\{`, 'm'),
  ].some((re) => re.test(source));
}

// A marker may also name a third-party package (minimatch, brace-expansion, node lib):
// only a path that starts in a folder of this repository is checked.
const inRepo = (file) => fs.existsSync(path.join(ROOT, file.split('/')[0]));

const singleLine = [];
const blockFiles = [];
for (const rel of RUST_DIRS.flatMap(rustFiles)) {
  const lines = fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
  lines.forEach((line, i) => {
    const one = /\/\/ Mirrors: (\S+?\.m?js):(.*)$/.exec(line);
    if (one && inRepo(one[1])) singleLine.push({ rel, line: i + 1, file: one[1], rest: one[2] });
    if (/^\s*\/\/! Mirrors:\s*$/.test(line)) {
      for (let j = i + 1; j < lines.length && /^\/\/!\s+(?:- |  )/.test(lines[j]); j++) {
        const item = /^\/\/!\s+- (\S+\.m?js)\b/.exec(lines[j]);
        if (item && inRepo(item[1])) blockFiles.push({ rel, line: j + 1, file: item[1] });
      }
    }
  });
}

function namesIn(rest) {
  const names = [];
  const first = /^([A-Za-z_$][\w$]*)/.exec(rest);
  if (first) names.push(first[1]);
  for (const m of rest.matchAll(/\+\s*([A-Za-z_$][\w$]*)/g)) names.push(m[1]);
  return names;
}

describe('Rust lane mirror markers', () => {
  it('finds markers to check', () => {
    expect(singleLine.length).toBeGreaterThan(50);
    expect(blockFiles.length).toBeGreaterThan(0);
  });

  it('every marker names an existing JS file', () => {
    const missing = [...singleLine, ...blockFiles]
      .filter((m) => !fs.existsSync(path.join(ROOT, m.file)))
      .map((m) => `${m.rel}:${m.line} -> ${m.file}`);
    expect(missing).toEqual([]);
  });

  it('every marker names a function that its JS file declares', () => {
    const cache = new Map();
    const orphaned = [];
    for (const m of singleLine) {
      const abs = path.join(ROOT, m.file);
      if (!fs.existsSync(abs)) continue;
      if (!cache.has(abs)) cache.set(abs, fs.readFileSync(abs, 'utf8'));
      for (const name of namesIn(m.rest)) {
        if (!declaresName(cache.get(abs), name)) orphaned.push(`${m.rel}:${m.line} -> ${m.file}:${name}`);
      }
    }
    expect(orphaned).toEqual([]);
  });
});
