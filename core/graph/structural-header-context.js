export function extractHeaderContext(readFileRange, filePath, maxLines = 100) {
  if (!filePath || !readFileRange) return '';
  const text = readFileRange(filePath, 1, maxLines) || '';
  const out = [];
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (/^\s*(import|from|use|pub use|package)\b/.test(line) ||
        /^\s*(const|let|var)\s+\w+\s*=\s*require\s*\(/.test(line) ||
        /^\s*require\s*\(/.test(line)) {
      out.push(line);
    }
    if (out.length >= 16) break;
  }
  const joined = out.join('\n');
  return joined.length > 900 ? `${joined.slice(0, 897)}...` : joined;
}

export default extractHeaderContext;
