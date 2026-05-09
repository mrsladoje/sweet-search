// Post-hoc transcript audit. Each mode declares forbidden tools / Bash
// commands in policies.js; this scans the parsed tool-call trace and flags
// violations. The --allowed-tools CLI flag enforces some of this at the
// model layer, but model creativity (compound commands, subshells) can
// defeat narrow patterns — audit is the source of truth for "did the policy
// hold".
//
// Returned shape per run:
//   { violationCount, violations: [{ toolIndex, kind, detail, command }] }

import { TOOL_RULES } from './policies.js';

// `modeOrRules` accepts either a registered mode-name (string lookup in
// TOOL_RULES) or a rules object directly. Object form lets parallel callers
// (track-b.mjs sweep) avoid mutating the global TOOL_RULES map per tuple,
// which is racy under concurrency.
export function auditRun(modeOrRules, run) {
  const rules = typeof modeOrRules === 'string' ? TOOL_RULES[modeOrRules] : modeOrRules;
  if (!rules) throw new Error(`unknown mode for audit: ${modeOrRules}`);

  const violations = [];
  for (const tc of run.toolCalls) {
    if (tc.name === 'Bash') {
      const cmd = (tc.input?.command || '').trim();
      // Walk every shell-segmented sub-command — handles ;, &&, ||, |, $(),
      // backticks, parenthesised groups. We look at the leading token (the
      // actual command being executed) of EACH sub-command. This stops
      // tricks like `cat file | ss-grep ...` from sneaking a native read
      // past the audit (cat is the leading token of the first sub-command).
      const subCommands = splitShellCompound(cmd);
      for (const sc of subCommands) {
        const lead = sc.trim().split(/\s+/)[0] || '';
        // Strip path so /usr/local/bin/grep → grep.
        const realLead = lead.replace(/^.*\//, '');
        // Skip empty (can happen for redirection-only segments).
        if (!realLead) continue;

        // Allowlist mode: any leading command not in the allowlist is a violation.
        if (Array.isArray(rules.allowedBashLeading) && rules.allowedBashLeading.length > 0) {
          if (!rules.allowedBashLeading.includes(realLead)) {
            violations.push({ toolIndex: tc.tIndex, kind: 'not-in-allowlist', detail: realLead, command: sc.slice(0, 200) });
          }
          continue; // allowlist supersedes denylist
        }

        // Denylist mode (native baseline): only flag explicitly forbidden commands.
        if (rules.forbiddenBashLeading.includes(realLead)) {
          violations.push({ toolIndex: tc.tIndex, kind: 'forbidden-leading', detail: realLead, command: sc.slice(0, 200) });
        }
        for (const sub of rules.forbiddenBashSubstrings) {
          if (realLead === sub || realLead.endsWith('/' + sub)) {
            violations.push({ toolIndex: tc.tIndex, kind: 'forbidden-command', detail: sub, command: sc.slice(0, 200) });
          }
        }
      }
    } else if (tc.name === 'Read') {
      if (rules.readToolForbidden) {
        violations.push({ toolIndex: tc.tIndex, kind: 'forbidden-read-tool', detail: 'native Read tool used', command: JSON.stringify(tc.input).slice(0, 200) });
      }
    } else {
      const allowed = new Set(rules.allowedTools);
      const disallowed = new Set(rules.disallowedTools || []);
      if (disallowed.has(tc.name)) {
        violations.push({ toolIndex: tc.tIndex, kind: 'disallowed-tool', detail: tc.name, command: JSON.stringify(tc.input).slice(0, 200) });
      } else if (allowed.size > 0 && !allowed.has(tc.name)) {
        violations.push({ toolIndex: tc.tIndex, kind: 'unlisted-tool', detail: tc.name, command: JSON.stringify(tc.input).slice(0, 200) });
      }
    }
  }
  return { violationCount: violations.length, violations };
}

/**
 * Best-effort split of a shell command into its top-level sub-commands so we
 * can audit each leading executable. Recognises:
 *   ; && || |  (sequence/pipe)
 *   $( ... )   (subshell)
 *   ` ... `    (backtick subshell)
 *   ( ... )    (group)
 * Quoted strings (single, double, escaped) are passed through. Heredocs are
 * NOT parsed — the leading exec is still picked up correctly because the
 * heredoc body trails after the command word.
 */
export function splitShellCompound(cmd) {
  const out = [];
  let buf = '';
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  while (i < cmd.length) {
    const c = cmd[i];
    if (!inSingle && !inDouble && c === '\\' && i + 1 < cmd.length) {
      // escaped char — treat as literal, skip 2
      buf += c + cmd[i + 1];
      i += 2;
      continue;
    }
    if (!inDouble && c === "'") { inSingle = !inSingle; buf += c; i++; continue; }
    if (!inSingle && c === '"') { inDouble = !inDouble; buf += c; i++; continue; }
    if (inSingle || inDouble) { buf += c; i++; continue; }

    // top-level operators
    if (c === ';') {
      if (buf.trim()) out.push(buf);
      buf = ''; i++; continue;
    }
    if (c === '|') {
      if (cmd[i + 1] === '|') {
        if (buf.trim()) out.push(buf);
        buf = ''; i += 2; continue;
      }
      // single | (pipe)
      if (buf.trim()) out.push(buf);
      buf = ''; i++; continue;
    }
    if (c === '&' && cmd[i + 1] === '&') {
      if (buf.trim()) out.push(buf);
      buf = ''; i += 2; continue;
    }
    if (c === '$' && cmd[i + 1] === '(') {
      // capture inner subshell contents as a separate command stream
      let depth = 1, j = i + 2;
      while (j < cmd.length && depth > 0) {
        if (cmd[j] === '(') depth++;
        else if (cmd[j] === ')') depth--;
        if (depth > 0) j++;
      }
      const inner = cmd.slice(i + 2, j);
      // recurse — its sub-commands count as their own audit targets
      for (const s of splitShellCompound(inner)) out.push(s);
      i = j + 1; continue;
    }
    if (c === '`') {
      let j = i + 1;
      while (j < cmd.length && cmd[j] !== '`') j++;
      const inner = cmd.slice(i + 1, j);
      for (const s of splitShellCompound(inner)) out.push(s);
      i = j + 1; continue;
    }
    if (c === '(' && (i === 0 || /[\s;&|]/.test(cmd[i - 1]))) {
      let depth = 1, j = i + 1;
      while (j < cmd.length && depth > 0) {
        if (cmd[j] === '(') depth++;
        else if (cmd[j] === ')') depth--;
        if (depth > 0) j++;
      }
      const inner = cmd.slice(i + 1, j);
      for (const s of splitShellCompound(inner)) out.push(s);
      i = j + 1; continue;
    }
    buf += c; i++;
  }
  if (buf.trim()) out.push(buf);
  return out;
}
