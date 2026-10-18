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
 * (a /rename, an earlier prompt, a resumed session) is left alone. No model call: the title is
 * the start of the prompt, cut at a word boundary. Never fails the prompt: any error prints
 * nothing and exits 0.
 */

const MAX_CHARS = 50;

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
  const input = JSON.parse(raw);
  if (typeof input.session_title === 'string' && input.session_title.trim()) return;
  const title = sessionTitleFromPrompt(input.prompt);
  if (!title) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', sessionTitle: title },
  }));
}

// Only as the hook (hook.mjs --session-title); a test imports the function alone.
if (process.argv.includes('--session-title')) {
  try { await main(); } catch { /* never block the prompt */ }
}
