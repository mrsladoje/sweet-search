/**
 * Claude Code UserPromptSubmit hook: give the session a title made from the first prompt.
 *
 * Claude Code titles the terminal tab with, in order: a /rename title, an AI title, the main
 * agent's name, the Haiku title it makes from the first prompt, "Claude Code". It also skips
 * the Haiku title when a main agent is set. With the lean harness (settings `agent`) every tab
 * is therefore called "sweet-search" (Claude Code 2.1.302, read from the bundle). A hook's
 * `sessionTitle` is stored like a /rename title and wins over the agent name.
 *
 * The hook input carries the current `session_title`, so a session that already has a title
 * (a /rename, an earlier prompt, a resumed session) is left alone. One exception: /clear starts
 * a new session that inherits the old title. The hook records which sessions got each title it
 * made (a file per title in the temp directory); a title of ours that reaches a session it was
 * not made for came over a /clear (or a --fork-session), and the next prompt replaces it. A
 * /rename title is never ours, so it stays, as in stock Claude Code.
 *
 * No model call: the title is the start of the prompt, cut at a word boundary. Never fails the
 * prompt: any error prints nothing and exits 0.
 */

import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MAX_CHARS = 50;
const RECORD_DIR = join(tmpdir(), 'sweet-search-session-titles');
const recordPath = (title, dir) => join(dir, createHash('sha256').update(title).digest('hex').slice(0, 32));

/** The sessions that got `title` from this hook ([] when none, or the title is not ours). */
export function sessionsWithTitle(title, dir = RECORD_DIR) {
  try { return readFileSync(recordPath(title, dir), 'utf8').split('\n').filter(Boolean); } catch { return []; }
}

export function recordTitle(title, sessionId, dir = RECORD_DIR) {
  mkdirSync(dir, { recursive: true });
  appendFileSync(recordPath(title, dir), `${sessionId}\n`);
}

/**
 * The title to set for this hook input, or null to leave the session's title alone.
 * `dir`: where the records live (tests pass their own).
 */
export function titleForInput(input, dir = RECORD_DIR) {
  const current = typeof input?.session_title === 'string' ? input.session_title.trim() : '';
  const sessionId = typeof input?.session_id === 'string' ? input.session_id : '';
  if (current) {
    const owners = sessionsWithTitle(current, dir);
    // Not ours (a /rename), or ours and made for this session (a later prompt, a resume).
    if (!owners.length || !sessionId || owners.includes(sessionId)) return null;
  }
  const title = sessionTitleFromPrompt(input?.prompt);
  if (title && sessionId) recordTitle(title, sessionId, dir);
  return title;
}

/** The title for a prompt, or null when the prompt gives none (empty, a slash command). */
export function sessionTitleFromPrompt(prompt) {
  if (typeof prompt !== 'string') return null;
  const text = prompt
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // Leading markdown markers (heading, quote, list) say nothing about the topic.
    .replace(/^(?:[#>*-]+\s*)+/, '');
  if (!text || text.startsWith('/')) return null;
  const chars = [...text];
  if (chars.length <= MAX_CHARS) return text;
  const cut = chars.slice(0, MAX_CHARS).join('');
  const space = cut.lastIndexOf(' ');
  // Cut at the last word boundary, unless that throws away most of the text.
  const head = space >= MAX_CHARS / 2 ? cut.slice(0, space) : cut;
  return `${head.replace(/[\s,.;:!?-]+$/, '')}…`;
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const title = titleForInput(JSON.parse(raw));
  if (!title) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', sessionTitle: title },
  }));
}

// Only as the hook (hook.mjs --session-title); a test imports the function alone.
if (process.argv.includes('--session-title')) {
  try { await main(); } catch { /* never block the prompt */ }
}
