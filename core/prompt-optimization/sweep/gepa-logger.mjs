import { appendFileSync } from 'node:fs';

/** Verbose human-readable run logger. Durable audit remains the fsynced JSONL. */
export function makeLogger({ logPath, stream = process.stdout, now = () => Date.now(), enabled = true } = {}) {
  const ts = () => new Date(now()).toISOString().slice(11, 19);
  return (line) => {
    if (!enabled) return;
    const out = `[${ts()}] gepa: ${line}\n`;
    try { stream.write(out); } catch { /* */ }
    if (logPath) { try { appendFileSync(logPath, out); } catch { /* */ } }
  };
}
