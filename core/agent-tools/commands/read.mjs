// ss-read: a file, a line range or one definition, read from the agent's own files (search-read.readFile).

import path from 'node:path';
import { existsSync } from 'node:fs';
import { parseBoolFlag, parseLineRange, looksLikeOption } from '../argparse.mjs';
import { lineGutterEnabled } from '../../search/search-read.js';
import { applyReadOmissionDecisions, collectReadShownSpans, renderReadOmission } from '../../search/agent-span-ledger.js';
import {
  REPO_ROOT, recordAgentToolCall, recordForAlreadyShown, readValueFlag, takeCountFlag, cwdPath, resolveShortFile,
  notIndexedNote,
} from './shared.mjs';

// ss-read takes one recovery flag plus positional <file> [start] [end] (or a single
// "start-end" / "start:end" / "start,end" range token). Unlike ss-grep, a stray
// flag here can never silently corrupt the result: the line slots are validated
// as numbers, so a misuse is already a loud error. These hints exist only to
// turn that error into a self-correcting one (the M++ prompt, which we may not
// touch, documents the positional form, not these recovery messages).
const READ_USAGE =
  'Usage: ss-read <file>            # whole file\n' +
  '       ss-read <file> <start>    # ONE line\n' +
  '       ss-read <file> <start> <end>\n' +
  '       ss-read <file> 10-20      # range (also 10:20, 10,20)\n' +
  '       ss-read <file> <symbol>   # one definition, doc comment included (also Owner.name)\n' +
  'Option: --force shows content again after an unchanged-content omission.';
export async function cmdRead(ctx, rawArgs) {
  const args = [...rawArgs];
  const force = parseBoolFlag(args, ['--force']);
  // `-k N` has no meaning for a read (lines are positional): accepted, ignored.
  takeCountFlag(args, READ_USAGE);
  // --in <file> names the file, as it does for ss-grep / ss-trace: `ss-read --in <file> 10 20`.
  const inFile = readValueFlag(args, ['--in', '--file'], null, READ_USAGE);
  if (inFile != null) args.unshift(inFile);
  let file = cwdPath(ctx, args[0]);
  if (!file) {
    process.stderr.write(READ_USAGE + '\n');
    process.exit(2);
  }
  if (looksLikeOption(file)) {
    process.stderr.write(`[ss-read] "${file}" looks like a flag, but ss-read takes a file path first.\n${READ_USAGE}\n`);
    process.exit(2);
  }
  // A short path naming one indexed file reads that file; its full path prints first.
  const short = await resolveShortFile(ctx, args[0], file, 'ss-read');
  file = short.file;
  const resolvedLine = short.resolved ? `# ${file}\n` : '';
  // If start is provided and end is omitted, read EXACTLY that one line —
  // no open-ended start-to-EOF (which a previous version did and which
  // caused accidental over-reading on large files).
  let start = null, end = null;
  // True when the numbers typed are not the range served as typed (start+count form).
  let reinterpreted = false;
  // `ss-read <file> <symbol>`: a second argument that is no number and no range names a
  // definition in the file (resolved below, once the file is known to be readable).
  let symbolSpec = null;
  if (args[1] != null && args[2] == null && !parseLineRange(args[1]) && !/^\d+$/.test(String(args[1]))
    && /^[A-Za-z_$][\w$]*(?:(?:\.|::|#)[A-Za-z_$][\w$!?=]*)*[!?=]?(?:\(\))?$/.test(String(args[1]))
    && !existsSync(path.resolve(ctx.fileRoot, cwdPath(ctx, args[1]) || ''))) {
    symbolSpec = String(args[1]);
  }
  if (args[1] != null && !symbolSpec) {
    // Accept a single-token range (10-20 / 10:20 / 10,20) before the plain
    // numeric path, so "lines 10-20" muscle memory works without a wasted call.
    const range = parseLineRange(args[1]);
    if (range && args[2] == null) {
      start = range.start;
      end = range.end;
    } else {
      start = +args[1];
      if (!Number.isFinite(start) || start < 1) {
        process.stderr.write(`[ss-read] invalid start line: "${args[1]}" (expected a line number, e.g. 10, or a range like 10-20)\n${READ_USAGE}\n`);
        process.exit(2);
      }
      if (args[2] != null) {
        end = +args[2];
        // Agents habitually pass (start, COUNT) offset/limit-style; a small second
        // arg below start is unambiguous (a real end would be ≥ start), so honor
        // the intent instead of burning one of the agent's turns on an error
        // (raml rep1 lost 6 calls to this under a 44-turn cap — TURNFIX §14.3).
        if (Number.isFinite(end) && end >= 1 && end < start) {
          const count = end;
          end = start + count - 1;
          // The header line shows the range served (`lines 84-93 of 293`); no separate note.
          reinterpreted = true;
        } else if (!Number.isFinite(end) || end < start) {
          process.stderr.write(`[ss-read] invalid end line: "${args[2]}" (expected END line ≥ start ${start}; usage: ss-read <file> <start> <end>, e.g. ss-read src/a.js 40 90)\n`);
          process.exit(2);
        }
      } else {
        end = start;     // single-line read
      }
    }
  }
  // L4a (2026-07-09) — default read window. An unbounded whole-file read (no range
  // given) delivers the ENTIRE file, which then sits RESIDENT in the agent's context
  // and is re-sent every subsequent turn. P1 measured this read-mass resident tax at
  // ~$11/200 (whole-file/large reads are the tail: p90=180, max=900 lines). So when
  // the agent gives NO range, cap the default to READ_WINDOW lines and let the
  // existing "what remains" trailer advertise the exact continue command — the agent
  // widens on demand instead of paying for the whole file up front. Only the no-range
  // case is capped: an EXPLICIT range is the agent's deliberate choice and capping it
  // would cause widen-thrash (the RETUNE hazard). GCSN-neutral by construction (reads
  // are never ranked). Gated for the standing ON-vs-OFF A/B: SS_NO_READ_WINDOW=1 → OFF
  // (legacy whole-file); SS_READ_WINDOW=<n> retunes the tier. Prod/human ss-read is a
  // separate wrapper and is untouched (byte-identical).
  // PARKED default-OFF (2026-07-09 smoke): the mechanism works (−39% delivered read
  // tokens vs off) and is accuracy-safe (no resolved→unresolved flips), but the ~$11/200
  // pool is too small to show a net idealCost win at n=2 and one read-thrash instance
  // appeared at window=150. Opt-in via SS_READ_WINDOW=<n> pending a larger-n confirmation.
  const READ_WINDOW = Number(process.env.SS_READ_WINDOW) || 0;
  const askedStart = start;
  const askedEnd = end;
  const cappedDefault = (start === null && end === null && READ_WINDOW > 0);
  if (cappedDefault) { start = 1; end = READ_WINDOW; }

  // A file the INDEXER refused by content is refused here too, BEFORE any body is read.
  // `ss-read dist/index.js` used to hand back 13,396 tokens of minified JavaScript in one
  // call — resident for the rest of the rollout and re-sent every turn. The refusal names
  // the native read, so the agent that genuinely wants the bytes can still get them; it
  // just does not get them by accident from a search tool.
  //
  // ONLY 'excluded' refuses. A file this index has not seen yet ('stale') is ordinary
  // source — often the agent's own new file — and reading it is exactly right.
  {
    const note = await notIndexedNote(ctx, file);
    if (note && note.kind === 'excluded' && !note.isDir) {
      process.stderr.write(`[ss-read] ${note.text}\n`);
      process.stderr.write(`[ss-read] ss-read will not return its contents. If you truly need the bytes, read ${file} with your own file-reading tool.\n`);
      process.exit(1);
    }
  }

  const { readFile, renderUnreadBelow, renderUnreadAbove, renderEnclosingStart, renderInterfaceImpls, renderConfigKeyRefs, fenceBody, numberCodeLines, resolveSymbolRead, definitionNamesInFile } = await import(path.join(REPO_ROOT, 'core/search/search-read.js'));
  let symbolNote = '';
  if (symbolSpec) {
    const sym = await resolveSymbolRead(ctx.fileRoot, file, symbolSpec);
    if (!sym) {
      const names = definitionNamesInFile(ctx.fileRoot, file);
      process.stderr.write(`[ss-read] no definition named "${symbolSpec}" in ${file}`
        + (names.length ? `; it defines: ${names.join(', ')}` : '') + '\n');
      process.exit(1);
    }
    start = sym.startLine;
    end = sym.endLine;
    reinterpreted = true; // the range is not typed: print it
    if (sym.others.length) {
      const list = sym.others.slice(0, 3).map(o => `${o.startLine}-${o.endLine}`).join(', ');
      symbolNote = `also named ${sym.span.name}: ${list}${sym.others.length > 3 ? ` (+${sym.others.length - 3})` : ''}`;
    }
  }
  // Agent-facing ss-read: span gate on, same as the CLI and the daemon route.
  const r = await readFile({
    path: file, projectRoot: ctx.fileRoot,
    startLine: start ?? undefined, endLine: end ?? undefined,
    spanExpand: true, format: 'agent',
  });
  if (!r.ok) {
    // A wrong or invented path is the common cause (e.g. src/b2/build/x for
    // src/build/x). Point back at the index instead of a bare ENOENT: an
    // excluded path says so, otherwise suggest locating it by name/behaviour.
    if (/ENOENT|not a regular file|no such file/i.test(String(r.error))) {
      const note = await notIndexedNote(ctx, file);
      if (note) {
        process.stderr.write(`[ss-read] error: ${r.error}\n[ss-read] ${note.text}\n`);
      } else {
        const base = path.basename(String(file));
        const what = /ENOENT|no such file/i.test(String(r.error)) ? 'no such file' : String(r.error);
        process.stderr.write(`[ss-read] ${what}; find it: ss-grep "${base}" or ss-search "<what it does>"\n`);
      }
    } else {
      process.stderr.write(`[ss-read] error: ${r.error}\n`);
    }
    process.exit(1);
  }
  // A start past the last line selects nothing: say how long the file is.
  if (r.range && r.range.startLine > r.totalLines) {
    process.stderr.write(`[ss-read] the file has ${r.totalLines} lines; line ${r.range.startLine} is past the end\n`);
    process.exit(1);
  }
  const readBatch = { files: [r], totalMs: r.timings?.totalMs ?? 0 };
  const shownSpans = ctx.exactRereadOmission
    ? collectReadShownSpans(readBatch, { projectRoot: ctx.fileRoot }) : [];
  const receiptResponse = await recordAgentToolCall(ctx, {
    operation: 'read',
    spans: shownSpans,
    force,
  });
  if (receiptResponse?.ok && Array.isArray(receiptResponse.decisions)) {
    applyReadOmissionDecisions(readBatch, receiptResponse.decisions);
  }
  // SS_FIX_ALREADY_SHOWN (A3): ss-read prints exactly what it always printed. It only RECORDS
  // the lines it printed in the separate A3 ledger namespace (never in the original one, whose
  // reply above is the only input to this output), so a later ss-search / ss-find can tell
  // they were already shown. The reply is ignored.
  await recordForAlreadyShown(ctx, shownSpans, receiptResponse?.decisions,
    readBatch.files.reduce((n, f) => n + (typeof f.text === 'string' ? f.text.length : 0), 0));
  // If the window happened to cover the whole file (file ≤ READ_WINDOW, clamped by
  // readFile), present it EXACTLY like an uncapped whole-file read — no synthetic
  // range, no continue trailer.
  const coveredWholeFile = (start === null && end === null) || (cappedDefault && r.range && r.range.endLine >= r.totalLines);
  const omitted = renderReadOmission(r, { surface: 'ss-read' });
  if (omitted) {
    process.stdout.write(`${resolvedLine}${omitted}\n`);
    process.exit(0);
  }
  // WHAT THE OUTPUT SAYS BESIDES THE CODE (token diet 2026-10-04). No header echoes the
  // path and range: the harness shows the command, and a later call of a chained command
  // opens with the boundary line (`# ss-read timed_queue.rb`). The range is printed only
  // when the lines served are NOT the lines typed — clamped at the end of the file, the
  // start+count form, the default window — because without a gutter (Claude Code, Codex:
  // gutter-form.js) the agent counts line numbers from the start it typed.
  const served = r.range && !coveredWholeFile ? r.range : null;
  const rangeMoved = served && (reinterpreted || askedStart == null
    || served.startLine !== askedStart || served.endLine !== (askedEnd ?? askedStart));
  // "What remains" trailer on a range read that stops before EOF (last line, for recency).
  const remainder = coveredWholeFile ? '' : renderUnreadBelow(r, {
    command: 'ss-read',
    queryEvidence: receiptResponse?.queryEvidence,
  });
  // Above the fence only the served range, when it moved: the agent counts line numbers from
  // it. Everything else follows the code (owner review 2026-10-04: the code the agent asked
  // for comes first), no `#`: the function the window starts inside and the state declared
  // above that the window reads (squashql-295) on one line, then the below line.
  const head = rangeMoved ? `lines ${served.startLine}-${served.endLine} of ${r.totalLines}\n` : '';
  const aboveLine = [
    coveredWholeFile ? '' : renderEnclosingStart(r),
    coveredWholeFile ? '' : renderUnreadAbove(r, { command: 'ss-read', queryEvidence: receiptResponse?.queryEvidence }),
  ].filter(Boolean).join('; ');
  // The interface-call line sits first after the code: the call it names is in view.
  const implLine = renderInterfaceImpls(r);
  const configLine = renderConfigKeyRefs(r);
  const tail = [implLine, configLine, symbolNote, aboveLine, remainder].filter(Boolean).map((l) => `${l}\n`).join('');
  if (!r.text) {
    process.stdout.write(`${resolvedLine}${head}# empty file\n${tail}`);
    process.exit(0);
  }
  // Line-number gutter: the per-harness form (gutter-form.js: `N:` on opencode, none on
  // Claude Code and Codex), skipped under 15 lines. Rendering goes through the SHARED
  // numberCodeLines so the CLI and the daemon/library renderers cannot drift apart.
  let bodyText = r.text;
  if (lineGutterEnabled() && fenceBody(r.text).split('\n').length >= 15) {
    const startAt = (r.range && !coveredWholeFile) ? r.range.startLine : 1;
    bodyText = numberCodeLines(r.text, startAt);
  }
  // A plain fence: the language tag (```ruby, 1-2 tokens) repeats the extension of the
  // path in the command just above.
  process.stdout.write(`${resolvedLine}${head}\`\`\`\n${fenceBody(bodyText)}\n\`\`\`\n${tail}`);
  process.exit(0);
}
