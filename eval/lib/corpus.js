/**
 * Corpus preparation: writes code documents as real files for indexing.
 */

import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import path from 'path';

export const LANG_EXTENSIONS = {
  python: '.py',
  javascript: '.js',
  go: '.go',
  java: '.java',
  ruby: '.rb',
  php: '.php',
  typescript: '.ts',
  rust: '.rs',
  cpp: '.cpp',
  'c++': '.cpp',
  c: '.c',
  csharp: '.cs',
  'c#': '.cs',
  sql: '.sql',
  swift: '.swift',
  kotlin: '.kt',
  scala: '.scala',
  r: '.r',
  shell: '.sh',
  bash: '.sh',
  perl: '.pl',
  lua: '.lua',
  haskell: '.hs',
  elixir: '.ex',
  erlang: '.erl',
  dart: '.dart',
  objective_c: '.m',
  'objective-c': '.m',
};

/**
 * Write corpus documents as real files for Sweet Search to index.
 * Creates one file per code function.
 *
 * @param {Array<Object>} corpus - Corpus documents with { doc_id, code, language, func_name, repo }
 * @param {string} corpusDir - Output directory for files
 * @param {Object} [options]
 * @param {boolean} [options.skipClean=false] - If true, preserve existing directory
 * @returns {Map<string, string>} Map of doc_id → file path
 */
export function prepareCorpus(corpus, corpusDir, { skipClean = false } = {}) {
  if (!skipClean) {
    console.log(`  Writing ${corpus.length} files to ${corpusDir}`);
    if (existsSync(corpusDir)) {
      rmSync(corpusDir, { recursive: true, force: true });
    }
  } else {
    console.log(`  Building file mapping for ${corpus.length} documents`);
  }

  let written = 0;
  const docIdToFile = new Map();

  for (const doc of corpus) {
    const ext = LANG_EXTENSIONS[doc.language] || '.txt';
    const safeRepo = (doc.repo || 'unknown').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 50);
    const safeName = (doc.func_name || 'func').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80);
    const dirPath = path.join(corpusDir, doc.language || 'unknown', safeRepo);
    const hash = simpleHash(doc.doc_id).toString(16).slice(0, 6);
    const fileName = `${safeName}_${hash}${ext}`;
    const filePath = path.join(dirPath, fileName);

    if (!skipClean) {
      if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true });
      writeFileSync(filePath, doc.code, 'utf-8');
      written++;
    }

    docIdToFile.set(doc.doc_id, filePath);
  }

  console.log(`  ${skipClean ? 'Mapped' : 'Written'}: ${skipClean ? corpus.length : written} files`);
  return docIdToFile;
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}
