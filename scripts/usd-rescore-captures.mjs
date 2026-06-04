#!/usr/bin/env node
/**
 * Re-score USD from persisted captures WITHOUT re-running the agent — applies the
 * per-tool-output cap (mirrors buildArmResponse's MAX_TOOL_OUTPUT_CHARS) to the stored
 * rawResponse, re-runs the USD judge panel, and updates the matching row in place.
 *
 * Why: the codex captures stored the FULL untruncated `aggregated_output` (over-broad rg
 * dumps ~1MB), which (1) overstated native tokens / cratered purity_ratio and (2) blew the
 * judge context → silent content=0. Capping each \n\n-block (grep dumps are single blocks)
 * to 64KB reproduces what a real agent consumes and keeps the judge in-context.
 *
 *   DIRS=cdx-low-mpp-s1,cdx-low-native-s1,... node scripts/usd-rescore-captures.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreUsdInline } from '../core/prompt-optimization/sweep/usd-capture.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RESULTS = path.join(REPO, 'core/prompt-optimization/data/results');
const CAP = Number(process.env.CAP || 65536);
const CONC = Number(process.env.CONC || 4);
const DIRS = (process.env.DIRS || '').split(',').map((s) => s.trim()).filter(Boolean);
if (!DIRS.length) { console.error('DIRS env required (comma-separated RUN dir names under results/)'); process.exit(2); }

const vault = JSON.parse(fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/frozen/p7-vault-probes-v60.json'), 'utf8'));
const probes = Array.isArray(vault) ? vault : (vault.probes || []);
const byId = new Map(probes.map((p) => [p.id, p]));

// Cap each \n\n-delimited block (a tool-output block in buildArmResponse's join) to CAP chars.
const capBlocks = (raw) => String(raw || '').split('\n\n').map((b) => (b.length > CAP ? `${b.slice(0, CAP)}\n…[output truncated to ${CAP} chars]` : b)).join('\n\n');

async function pool(items, n, fn) { let i = 0; const w = Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const idx = i++; await fn(items[idx]); } }); await Promise.all(w); }

(async () => {
  let total = 0, changed = 0, errs = 0;
  for (const dir of DIRS) {
    const base = path.join(RESULTS, dir);
    const rowsPath = path.join(base, 'rows.json');
    const capDir = path.join(base, 'captures');
    if (!fs.existsSync(rowsPath) || !fs.existsSync(capDir)) { console.error(`skip ${dir} (missing rows.json or captures/)`); continue; }
    const rows = JSON.parse(fs.readFileSync(rowsPath, 'utf8'));
    const capFiles = fs.readdirSync(capDir).filter((f) => f.endsWith('.json'));
    await pool(capFiles, CONC, async (cf) => {
      const cap = JSON.parse(fs.readFileSync(path.join(capDir, cf), 'utf8'));
      const probe = byId.get(cap.probeId);
      if (!probe) return;
      const mode = cap.arm === 'ss' ? 'mpp' : 'native';
      const row = rows.find((r) => r.id === cap.probeId && r.mode === mode && (cap.rep == null || r.rep === cap.rep));
      if (!row) return;
      const beforeTok = row.usdTokens;
      const capped = capBlocks(cap.rawResponse);
      const usd = await scoreUsdInline(probe, capped, cap.arm);
      total++;
      if (usd.usdError) { row.usdError = usd.usdError; errs++; }
      else {
        delete row.usdError;
        Object.assign(row, usd);
        row.rawLen = capped.length;
        if (beforeTok !== usd.usdTokens) changed++;
      }
      process.stderr.write(`  ${dir}/${cf.padEnd(24)} tok ${String(beforeTok).padStart(7)}→${String(usd.usdTokens ?? 'ERR').padStart(7)} content=${usd.content != null ? usd.content.toFixed(2) : (usd.usdError ? 'ERR' : '?')} USDnoC=${usd.USD_noC != null ? usd.USD_noC.toFixed(3) : '-'}\n`);
    });
    fs.writeFileSync(rowsPath, JSON.stringify(rows, null, 2));
    console.error(`✓ ${dir}: rewrote ${rows.length} rows`);
  }
  console.error(`\nDONE: rescored ${total} captures, ${changed} token-counts changed, ${errs} usdError.`);
})();
