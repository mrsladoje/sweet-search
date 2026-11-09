// Reads the SWEET_SEARCH_* tuning variables that the file-kind and demotion rules use.

// Boost magnitudes are env-tunable so we can ablate without re-deploying.
// Defaults softened (2026-05-05) from (1.25, 0.85, 1.20, 1.05) to
// (1.10, 0.90, 1.10, 1.03) after a 16-query 3-config ablation showed
// 15 of 16 top-1 results unchanged at the lower magnitudes — less
// leverage = less interaction risk with name-precision and other
// signals, with no observed quality loss. The stronger old values
// remain reachable via env vars if a future probe shows they help.
export function envFloat(name, dflt) {
  const v = process.env[name];
  if (v == null || v === '') return dflt;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

export function envFloatRange(name, dflt) {
  const v = process.env[name];
  if (v == null || v === '') return dflt;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : dflt;
}

export function envOff() {
  return process.env.SWEET_SEARCH_FILE_KIND_RANKING === '0'
      || process.env.SWEET_SEARCH_FILE_KIND_RANKING === 'false';
}

export function envFactor(name, fallback) {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : fallback;
}

export function envWindow(name, fallback) {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
