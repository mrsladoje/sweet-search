#!/usr/bin/env node
/**
 * Arm-symmetric Claude Code PreToolUse normalizer for the Read tool.
 *
 * `pages` is meaningful only for PDFs. Some routed backbones emit `pages: ""`
 * for ordinary source reads, which Claude Code rejects before reading the file.
 * Normalize that optional argument at the tool boundary instead of depending on
 * a prompt reminder. All other Read inputs are preserved byte-for-byte.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function normalizeReadInput(toolInput) {
  if (!toolInput || typeof toolInput !== 'object' || Array.isArray(toolInput)) return toolInput;
  const normalized = { ...toolInput };
  if (!Object.prototype.hasOwnProperty.call(normalized, 'pages')) return normalized;

  const filePath = String(normalized.file_path ?? normalized.path ?? '')
    .replace(/[?#].*$/, '');
  const pages = normalized.pages;
  const validPdfPages = /\.pdf$/i.test(filePath)
    && typeof pages === 'string'
    && pages.trim().length > 0;
  if (!validPdfPages) delete normalized.pages;
  return normalized;
}

export function readHookDecision(event) {
  const output = {
    hookEventName: 'PreToolUse',
    permissionDecision: 'allow',
  };
  if (event?.tool_name === 'Read'
      && event.tool_input && typeof event.tool_input === 'object'
      && !Array.isArray(event.tool_input)) {
    output.updatedInput = normalizeReadInput(event.tool_input);
  }
  return { hookSpecificOutput: output };
}

function runHook() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    let event = null;
    try { event = JSON.parse(input); } catch { /* fail open without rewriting */ }
    process.stdout.write(JSON.stringify(readHookDecision(event)));
  });
  process.stdin.on('error', () => {
    process.stdout.write(JSON.stringify(readHookDecision(null)));
  });
}

let invokedDirectly = false;
try {
  invokedDirectly = !!process.argv[1]
    && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
} catch { /* imported module or inaccessible argv path */ }
if (invokedDirectly) runHook();
