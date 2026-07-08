export function formatStructuralContext(result) {
  if (!result.target) return `No indexed symbol found for "${result.symbol}".`;
  const t = result.target;
  const lines = [];
  lines.push(`# trace ${t.name} [${t.type}] ${t.filePath}:${t.startLine}-${t.endLine}`);
  lines.push(`fan-in=${t.fanIn} fan-out=${t.fanOut} budget=${result.tokensUsed}/${result.tokenBudget} (${result.budgetTier}:${result.budgetReason}) latency=${result.stats.latencyMs}ms`);
  if (t.fanIn === 0 && t.fanOut === 0 && !result.sections.callers.total && !result.sections.callees.total) {
    lines.push(`no stored call edges for this symbol — map its sites with one broad ss-grep of the symbol stem instead.`);
  } else if (t.fanIn === 0 && result.sections.callers.total > 0) {
    lines.push(`note: callers below come from a same-file source scan (no stored cross-file edges).`);
  }
  if (result.disambiguation.length) {
    lines.push(`ambiguous: using first match; alternatives: ${result.disambiguation.slice(0, 5).map(a => `${a.name} ${a.file}:${a.startLine}`).join(', ')}`);
  }
  if (result.answerCues?.targetTerms?.length) {
    if (result.answerCues.keySymbols?.length) lines.push(`answer checklist: key symbols=${result.answerCues.keySymbols.join(', ')}`);
    if (result.answerCues.branchTerms?.length) lines.push(`answer checklist: branch terms to preserve=${result.answerCues.branchTerms.join(', ')}`);
    if (result.answerCues.branchSnippets?.length) lines.push(`answer checklist: branch code=${result.answerCues.branchSnippets.join(' | ')}`);
    if (result.answerCues.relatedDefinitions?.length) lines.push(`answer checklist: related definitions=${result.answerCues.relatedDefinitions.join(' | ')}`);
    lines.push(`answer cues: target terms=${result.answerCues.targetTerms.join(', ')}`);
    if (result.answerCues.topCallers.length) lines.push(`answer cues: top callers=${result.answerCues.topCallers.join(' | ')}`);
    if (result.answerCues.topCallees.length) lines.push(`answer cues: top callees=${result.answerCues.topCallees.join(' | ')}`);
    if (result.answerCues.criticalPaths.length) lines.push(`answer cues: critical paths=${result.answerCues.criticalPaths.join(' | ')}`);
  }
  if (t.headerContext) lines.push('\n## target imports\n```', t.headerContext, '```');
  if (t.code) lines.push('\n## target\n```', t.code, '```');
  if (t.callsiteHints?.length) lines.push(`target callsite hints: ${t.callsiteHints.join(', ')}`);
  for (const [title, section] of [['callers', result.sections.callers], ['callees', result.sections.callees]]) {
    lines.push(`\n## ${title} (${section.total})`);
    for (const item of section.items) {
      lines.push(`\n### ${item.name} [${item.type}] importance=${item.importance}`);
      lines.push(item.summary);
      if (item.code) lines.push('```', item.code, '```');
    }
    if (!section.items.length) lines.push('(none)');
  }
  lines.push(`\n## impact paths (${result.sections.impact.total}, depth <= ${result.maxDepth})`);
  if (!result.sections.impact.paths.length) lines.push('(none)');
  result.sections.impact.paths.forEach((p, i) => {
    lines.push(`${i + 1}. ${p.direction} importance=${p.importance} ${p.path}`);
  });
  return lines.join('\n');
}

export default formatStructuralContext;
