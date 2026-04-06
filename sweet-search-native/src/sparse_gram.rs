use memmap2::Mmap;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use rayon::prelude::*;
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

use crate::native_grep::{build_regex, read_file_content, NativeGrepFullMatch, NativeGrepMatch};

const MAGIC: &[u8; 8] = b"SSGRMIDX";
const VERSION: u32 = 2;
pub(crate) const ASCII_DIM: usize = 128;
pub(crate) const WEIGHT_TABLE_LEN: usize = ASCII_DIM * ASCII_DIM;
pub(crate) const MIN_SPAN_LEN: usize = 3;
pub(crate) const MAX_GRAM_LEN: usize = 12;
pub(crate) const MIN_CORPUS_BIGRAMS: u64 = 4096;
const FLAG_USED_FALLBACK_WEIGHTS: u32 = 1 << 0;
const FLAG_DENSE_POSTINGS: u8 = 1 << 0;

#[derive(Clone, Debug)]
struct FileEntry {
    path: String,
    symbol_mask: u32,
}

#[derive(Clone, Debug)]
struct GramDescriptor {
    data_offset: u64,
    data_len: u32,
    postings_count: u32,
    flags: u8,
}

#[derive(Clone, Debug)]
struct Header {
    version: u32,
    flags: u32,
    total_files: u32,
    gram_count: u32,
    total_postings: u32,
    dense_words: u32,
    dense_grams: u32,
    sparse_grams: u32,
    file_table_offset: u64,
    gram_table_offset: u64,
    data_offset: u64,
    weights_offset: u64,
}

#[derive(Clone, Debug)]
struct ColumnBuild {
    flags: u8,
    postings_count: u32,
    data: Vec<u8>,
}

enum CandidateSet {
    Dense(Vec<u64>),
    Sparse(Vec<u32>),
}

#[napi(object)]
pub struct SparseGramBuildResult {
    pub files_indexed: u32,
    pub grams: u32,
    pub dense_grams: u32,
    pub sparse_grams: u32,
    pub postings: u32,
    pub used_fallback_weights: bool,
}

#[napi(object)]
pub struct SparseGramQueryResult {
    pub eligible: bool,
    pub files: Vec<String>,
    pub grams_used: u32,
    pub total_files: u32,
    pub candidate_files: u32,
    pub dense_grams_touched: u32,
    pub sparse_grams_touched: u32,
}

#[napi(object)]
pub struct SparseGramIndexStats {
    pub total_files: u32,
    pub grams: u32,
    pub dense_grams: u32,
    pub sparse_grams: u32,
    pub postings: u32,
    pub used_fallback_weights: bool,
}

#[napi]
pub struct NativeSparseGramIndex {
    mmap: Mmap,
    header: Header,
    files: Vec<FileEntry>,
    grams: HashMap<String, GramDescriptor>,
    weights: Vec<f32>,
}

/// Internal query result — file IDs without path string materialization.
struct ResolvedClauses {
    eligible: bool,
    file_ids: Vec<u32>,
    total_files: u32,
    candidate_files: u32,
    grams_used: u32,
    dense_grams_touched: u32,
    sparse_grams_touched: u32,
}

struct QueryFileIdsResult {
    eligible: bool,
    file_ids: Vec<u32>,
    grams_used: u32,
    total_files: u32,
    dense_grams_touched: u32,
    sparse_grams_touched: u32,
}

/// Combined gram query + native grep result (lean: file + line only).
#[napi(object)]
pub struct GramGrepLinesResult {
    /// Whether the gram query produced an eligible (narrow) candidate set.
    pub eligible: bool,
    pub total_files: u32,
    /// Candidate files after code-extension filtering.
    pub candidate_files: u32,
    pub grams_used: u32,
    pub dense_grams_touched: u32,
    pub sparse_grams_touched: u32,
    /// Grep matches (empty when not eligible).
    pub matches: Vec<NativeGrepMatch>,
    /// Number of candidate files scanned by grep.
    pub scanned_files: u32,
    /// Grep wall-clock time in microseconds.
    pub grep_elapsed_us: u32,
}

/// Combined gram query + native grep result (full: file + line + column + matchText + content).
#[napi(object)]
pub struct GramGrepFullResult {
    pub eligible: bool,
    pub total_files: u32,
    pub candidate_files: u32,
    pub grams_used: u32,
    pub dense_grams_touched: u32,
    pub sparse_grams_touched: u32,
    pub matches: Vec<NativeGrepFullMatch>,
    pub scanned_files: u32,
    pub grep_elapsed_us: u32,
}

/// Check if a file path has an extension in the allowed set.
fn has_code_extension(path: &str, extensions: &HashSet<&str>) -> bool {
    match path.rfind('.') {
        Some(dot_pos) if dot_pos + 1 < path.len() => {
            let ext = &path[dot_pos + 1..];
            // Fast path: most extensions are already lowercase ASCII
            if ext.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()) {
                extensions.contains(ext)
            } else {
                let lower = ext.to_ascii_lowercase();
                extensions.contains(lower.as_str())
            }
        }
        _ => false,
    }
}

#[napi]
impl NativeSparseGramIndex {
    #[napi(factory)]
    pub fn load(path: String) -> Result<Self> {
        let file = File::open(&path)
            .map_err(|err| Error::from_reason(format!("Failed to open sparse gram index {path}: {err}")))?;
        let mmap = unsafe { Mmap::map(&file) }
            .map_err(|err| Error::from_reason(format!("Failed to mmap sparse gram index {path}: {err}")))?;

        let header = parse_header(&mmap)?;
        if header.version != VERSION {
            return Err(Error::from_reason(format!(
                "Unsupported sparse gram index version {}",
                header.version
            )));
        }

        let files = parse_file_table(&mmap, &header)?;
        let grams = parse_gram_table(&mmap, &header)?;
        let weights = parse_weights(&mmap, &header)?;

        Ok(Self {
            mmap,
            header,
            files,
            grams,
            weights,
        })
    }

    /// Core gram query — returns file IDs without path string materialization.
    /// Shared by `query_literals` (backward compat) and the `query_and_grep_*`
    /// all-in-one methods.
    fn query_file_ids_core(
        &self,
        literals: &[String],
        max_candidates: Option<u32>,
        symbol_mask: Option<u32>,
    ) -> Result<QueryFileIdsResult> {
        let not_eligible = |grams_used, dense, sparse| QueryFileIdsResult {
            eligible: false,
            file_ids: Vec::new(),
            grams_used,
            total_files: self.header.total_files,
            dense_grams_touched: dense,
            sparse_grams_touched: sparse,
        };

        if literals.is_empty() {
            return Ok(not_eligible(0, 0, 0));
        }

        let mut total_grams_used = 0usize;
        let mut dense_grams_touched = 0u32;
        let mut sparse_grams_touched = 0u32;
        let mut combined: Option<CandidateSet> = None;

        for literal in literals {
            let normalized = match normalize_literal(literal) {
                Some(value) => value,
                None => return Ok(not_eligible(0, 0, 0)),
            };

            let mut grams = extract_covering_grams(&normalized, &self.weights);
            if grams.is_empty() {
                return Ok(not_eligible(0, 0, 0));
            }

            grams.sort_by(|a, b| {
                let a_desc = self.grams.get(a);
                let b_desc = self.grams.get(b);
                let a_count = a_desc.map(|desc| desc.postings_count).unwrap_or(u32::MAX);
                let b_count = b_desc.map(|desc| desc.postings_count).unwrap_or(u32::MAX);
                a_count.cmp(&b_count).then_with(|| a.cmp(b))
            });

            total_grams_used += grams.len();

            let mut literal_candidates: Option<CandidateSet> = None;
            for gram in grams {
                let Some(desc) = self.grams.get(&gram) else {
                    // Gram not in index → zero candidates (eligible, but empty)
                    return Ok(QueryFileIdsResult {
                        eligible: true,
                        file_ids: Vec::new(),
                        grams_used: total_grams_used as u32,
                        total_files: self.header.total_files,
                        dense_grams_touched,
                        sparse_grams_touched,
                    });
                };

                if desc.flags & FLAG_DENSE_POSTINGS != 0 {
                    dense_grams_touched += 1;
                } else {
                    sparse_grams_touched += 1;
                }

                literal_candidates = Some(match literal_candidates {
                    Some(CandidateSet::Dense(mut acc))
                        if desc.flags & FLAG_DENSE_POSTINGS != 0 =>
                    {
                        let data = self.slice(desc.data_offset, desc.data_len as usize)?;
                        bitand_dense_from_le_bytes(&mut acc, data);
                        CandidateSet::Dense(acc)
                    }
                    Some(CandidateSet::Sparse(ids))
                        if desc.flags & FLAG_DENSE_POSTINGS != 0 =>
                    {
                        let data = self.slice(desc.data_offset, desc.data_len as usize)?;
                        CandidateSet::Sparse(filter_sparse_with_dense_bytes(&ids, data))
                    }
                    Some(existing) => {
                        let posting = self.load_posting_set(desc)?;
                        intersect_candidate_sets(existing, posting)
                    }
                    None => self.load_posting_set(desc)?,
                });

                if literal_candidates
                    .as_ref()
                    .is_some_and(|candidates| candidate_set_is_empty(candidates))
                {
                    break;
                }
            }

            let literal_candidates =
                literal_candidates.unwrap_or_else(|| CandidateSet::Sparse(Vec::new()));
            combined = Some(match combined {
                Some(existing) => intersect_candidate_sets(existing, literal_candidates),
                None => literal_candidates,
            });

            if combined
                .as_ref()
                .is_some_and(|candidates| candidate_set_is_empty(candidates))
            {
                break;
            }
        }

        let filtered = if let Some(mask) = symbol_mask.filter(|mask| *mask != 0) {
            combined.map(|set| filter_candidate_set_by_symbol_mask(set, &self.files, mask))
        } else {
            combined
        };

        let mut file_ids =
            collect_candidate_ids(filtered.unwrap_or_else(|| CandidateSet::Sparse(Vec::new())));
        if let Some(limit) = max_candidates.filter(|limit| *limit > 0) {
            file_ids.truncate(limit as usize);
        }

        Ok(QueryFileIdsResult {
            eligible: true,
            file_ids,
            grams_used: total_grams_used as u32,
            total_files: self.header.total_files,
            dense_grams_touched,
            sparse_grams_touched,
        })
    }

    #[napi]
    pub fn query_literals(
        &self,
        literals: Vec<String>,
        max_candidates: Option<u32>,
        symbol_mask: Option<u32>,
    ) -> Result<SparseGramQueryResult> {
        let result = self.query_file_ids_core(&literals, max_candidates, symbol_mask)?;
        if !result.eligible {
            return Ok(SparseGramQueryResult {
                eligible: false,
                files: Vec::new(),
                grams_used: result.grams_used,
                total_files: result.total_files,
                candidate_files: 0,
                dense_grams_touched: result.dense_grams_touched,
                sparse_grams_touched: result.sparse_grams_touched,
            });
        }
        let files = result
            .file_ids
            .iter()
            .filter_map(|id| self.files.get(*id as usize).map(|e| e.path.clone()))
            .collect::<Vec<_>>();
        Ok(SparseGramQueryResult {
            eligible: true,
            grams_used: result.grams_used,
            total_files: result.total_files,
            candidate_files: files.len() as u32,
            files,
            dense_grams_touched: result.dense_grams_touched,
            sparse_grams_touched: result.sparse_grams_touched,
        })
    }

    /// Shared clause-processing: gram query → extension filter → threshold check.
    /// Returns eligible file IDs ready for grep, or Err-like stats for bail-out.
    /// Single-clause fast path avoids HashSet entirely.
    fn resolve_clauses(
        &self,
        clauses: &[Vec<String>],
        max_candidates: Option<u32>,
        symbol_mask: Option<u32>,
        ext_set: &HashSet<&str>,
        max_files: usize,
        max_ratio: f64,
    ) -> Result<ResolvedClauses> {
        let mut total_files = 0u32;
        let mut grams_used = 0u32;
        let mut dense_grams_touched = 0u32;
        let mut sparse_grams_touched = 0u32;

        let stats = |tf, gu, dg, sg, cf| ResolvedClauses {
            eligible: false,
            file_ids: Vec::new(),
            total_files: tf,
            candidate_files: cf,
            grams_used: gu,
            dense_grams_touched: dg,
            sparse_grams_touched: sg,
        };

        // --- Single-clause fast path: no HashSet, no union ---
        if clauses.len() == 1 {
            let clause = &clauses[0];
            if clause.is_empty() {
                return Ok(stats(self.header.total_files, 0, 0, 0, 0));
            }
            let qr = self.query_file_ids_core(clause, max_candidates, symbol_mask)?;
            if !qr.eligible {
                return Ok(stats(qr.total_files, qr.grams_used, qr.dense_grams_touched, qr.sparse_grams_touched, 0));
            }
            // Filter by code extension in-place on the Vec — no HashSet needed
            let mut file_ids: Vec<u32> = qr
                .file_ids
                .into_iter()
                .filter(|id| {
                    self.files
                        .get(*id as usize)
                        .map(|e| has_code_extension(&e.path, ext_set))
                        .unwrap_or(false)
                })
                .collect();
            let tf = qr.total_files;
            let count = file_ids.len();
            if count == 0
                || count > max_files
                || (tf > 0 && (count as f64 / tf as f64) > max_ratio)
            {
                return Ok(ResolvedClauses {
                    eligible: false,
                    file_ids: Vec::new(),
                    total_files: tf,
                    candidate_files: count as u32,
                    grams_used: qr.grams_used,
                    dense_grams_touched: qr.dense_grams_touched,
                    sparse_grams_touched: qr.sparse_grams_touched,
                });
            }
            file_ids.shrink_to_fit();
            return Ok(ResolvedClauses {
                eligible: true,
                file_ids,
                total_files: tf,
                candidate_files: count as u32,
                grams_used: qr.grams_used,
                dense_grams_touched: qr.dense_grams_touched,
                sparse_grams_touched: qr.sparse_grams_touched,
            });
        }

        // --- Multi-clause: OR union with HashSet ---
        let mut combined_ids: HashSet<u32> = HashSet::new();

        for clause in clauses {
            if clause.is_empty() {
                return Ok(stats(self.header.total_files, grams_used, dense_grams_touched, sparse_grams_touched, 0));
            }
            let qr = self.query_file_ids_core(clause, max_candidates, symbol_mask)?;
            total_files = total_files.max(qr.total_files);
            grams_used += qr.grams_used;
            dense_grams_touched += qr.dense_grams_touched;
            sparse_grams_touched += qr.sparse_grams_touched;

            if !qr.eligible {
                return Ok(stats(total_files, grams_used, dense_grams_touched, sparse_grams_touched, 0));
            }

            let clause_ids: Vec<u32> = qr
                .file_ids
                .iter()
                .copied()
                .filter(|id| {
                    self.files
                        .get(*id as usize)
                        .map(|e| has_code_extension(&e.path, ext_set))
                        .unwrap_or(false)
                })
                .collect();

            if clause_ids.is_empty()
                || clause_ids.len() > max_files
                || (total_files > 0 && (clause_ids.len() as f64 / total_files as f64) > max_ratio)
            {
                return Ok(ResolvedClauses {
                    eligible: false,
                    file_ids: Vec::new(),
                    total_files,
                    candidate_files: clause_ids.len() as u32,
                    grams_used,
                    dense_grams_touched,
                    sparse_grams_touched,
                });
            }

            combined_ids.extend(clause_ids);
        }

        let count = combined_ids.len();
        if count == 0
            || count > max_files
            || (total_files > 0 && (count as f64 / total_files as f64) > max_ratio)
        {
            return Ok(ResolvedClauses {
                eligible: false,
                file_ids: Vec::new(),
                total_files,
                candidate_files: count as u32,
                grams_used,
                dense_grams_touched,
                sparse_grams_touched,
            });
        }

        Ok(ResolvedClauses {
            eligible: true,
            file_ids: combined_ids.into_iter().collect(),
            total_files,
            candidate_files: count as u32,
            grams_used,
            dense_grams_touched,
            sparse_grams_touched,
        })
    }

    /// All-in-one gram query + native grep (lean output: file + line).
    ///
    /// Single NAPI crossing: gram lookup → extension filter → threshold check →
    /// rayon-parallel grep, all in Rust. Single-clause queries (the common case)
    /// skip the HashSet union entirely — Vec<u32> flows straight to grep.
    #[napi]
    pub fn query_and_grep_lines(
        &self,
        clauses: Vec<Vec<String>>,
        regex: String,
        project_root: String,
        max_candidates: Option<u32>,
        symbol_mask: Option<u32>,
        case_insensitive: Option<bool>,
        code_extensions: Vec<String>,
        max_candidate_files: Option<u32>,
        max_candidate_ratio: Option<f64>,
    ) -> Result<GramGrepLinesResult> {
        let ext_set: HashSet<&str> = code_extensions.iter().map(|s| s.as_str()).collect();
        let resolved = self.resolve_clauses(
            &clauses,
            max_candidates,
            symbol_mask,
            &ext_set,
            max_candidate_files.unwrap_or(2048) as usize,
            max_candidate_ratio.unwrap_or(0.30),
        )?;

        if !resolved.eligible {
            return Ok(GramGrepLinesResult {
                eligible: false,
                total_files: resolved.total_files,
                candidate_files: resolved.candidate_files,
                grams_used: resolved.grams_used,
                dense_grams_touched: resolved.dense_grams_touched,
                sparse_grams_touched: resolved.sparse_grams_touched,
                matches: Vec::new(),
                scanned_files: 0,
                grep_elapsed_us: 0,
            });
        }

        let grep_start = std::time::Instant::now();
        let re = build_regex(&regex, case_insensitive.unwrap_or(false))?;
        let root = PathBuf::from(&project_root);
        let scanned = resolved.file_ids.len() as u32;

        let matches: Vec<NativeGrepMatch> = resolved
            .file_ids
            .par_iter()
            .flat_map(|id| {
                let entry = match self.files.get(*id as usize) {
                    Some(e) => e,
                    None => return Vec::new(),
                };
                let path = root.join(&entry.path);
                let content = match read_file_content(&path) {
                    Some(c) => c,
                    None => return Vec::new(),
                };
                let text = content.as_str();
                let mut results = Vec::new();
                for (line_idx, line) in text.lines().enumerate() {
                    if re.is_match(line) {
                        results.push(NativeGrepMatch {
                            file: entry.path.clone(),
                            line: (line_idx + 1) as u32,
                        });
                    }
                }
                results
            })
            .collect();

        Ok(GramGrepLinesResult {
            eligible: true,
            total_files: resolved.total_files,
            candidate_files: resolved.candidate_files,
            grams_used: resolved.grams_used,
            dense_grams_touched: resolved.dense_grams_touched,
            sparse_grams_touched: resolved.sparse_grams_touched,
            matches,
            scanned_files: scanned,
            grep_elapsed_us: grep_start.elapsed().as_micros() as u32,
        })
    }

    /// All-in-one gram query + native grep (full output).
    ///
    /// Same as `query_and_grep_lines` but returns file + line + column +
    /// matchText + content for bareGrep callers.
    #[napi]
    pub fn query_and_grep_full(
        &self,
        clauses: Vec<Vec<String>>,
        regex: String,
        project_root: String,
        max_candidates: Option<u32>,
        symbol_mask: Option<u32>,
        case_insensitive: Option<bool>,
        code_extensions: Vec<String>,
        max_candidate_files: Option<u32>,
        max_candidate_ratio: Option<f64>,
    ) -> Result<GramGrepFullResult> {
        let ext_set: HashSet<&str> = code_extensions.iter().map(|s| s.as_str()).collect();
        let resolved = self.resolve_clauses(
            &clauses,
            max_candidates,
            symbol_mask,
            &ext_set,
            max_candidate_files.unwrap_or(2048) as usize,
            max_candidate_ratio.unwrap_or(0.30),
        )?;

        if !resolved.eligible {
            return Ok(GramGrepFullResult {
                eligible: false,
                total_files: resolved.total_files,
                candidate_files: resolved.candidate_files,
                grams_used: resolved.grams_used,
                dense_grams_touched: resolved.dense_grams_touched,
                sparse_grams_touched: resolved.sparse_grams_touched,
                matches: Vec::new(),
                scanned_files: 0,
                grep_elapsed_us: 0,
            });
        }

        let grep_start = std::time::Instant::now();
        let re = build_regex(&regex, case_insensitive.unwrap_or(false))?;
        let root = PathBuf::from(&project_root);
        let scanned = resolved.file_ids.len() as u32;

        let matches: Vec<NativeGrepFullMatch> = resolved
            .file_ids
            .par_iter()
            .flat_map(|id| {
                let entry = match self.files.get(*id as usize) {
                    Some(e) => e,
                    None => return Vec::new(),
                };
                let path = root.join(&entry.path);
                let content = match read_file_content(&path) {
                    Some(c) => c,
                    None => return Vec::new(),
                };
                let text = content.as_str();
                let mut results = Vec::new();
                for (line_idx, line) in text.lines().enumerate() {
                    if let Some(m) = re.find(line) {
                        results.push(NativeGrepFullMatch {
                            file: entry.path.clone(),
                            line: (line_idx + 1) as u32,
                            column: (m.start() + 1) as u32,
                            match_text: m.as_str().to_string(),
                            content: line.trim_end().to_string(),
                        });
                    }
                }
                results
            })
            .collect();

        Ok(GramGrepFullResult {
            eligible: true,
            total_files: resolved.total_files,
            candidate_files: resolved.candidate_files,
            grams_used: resolved.grams_used,
            dense_grams_touched: resolved.dense_grams_touched,
            sparse_grams_touched: resolved.sparse_grams_touched,
            matches,
            scanned_files: scanned,
            grep_elapsed_us: grep_start.elapsed().as_micros() as u32,
        })
    }

    /// Return all indexed file paths. Used by native grep to get the full
    /// file list without needing a directory walk.
    #[napi]
    pub fn get_all_files(&self) -> Vec<String> {
        self.files.iter().map(|f| f.path.clone()).collect()
    }

    #[napi]
    pub fn get_stats(&self) -> SparseGramIndexStats {
        SparseGramIndexStats {
            total_files: self.header.total_files,
            grams: self.header.gram_count,
            dense_grams: self.header.dense_grams,
            sparse_grams: self.header.sparse_grams,
            postings: self.header.total_postings,
            used_fallback_weights: self.header.flags & FLAG_USED_FALLBACK_WEIGHTS != 0,
        }
    }
}

#[napi]
pub fn build_sparse_gram_index(
    project_root: String,
    files: Vec<String>,
    file_symbol_masks: Option<Vec<u32>>,
    output_path: String,
) -> Result<SparseGramBuildResult> {
    let mut corpus_files = Vec::with_capacity(files.len());
    let mut bigram_counts = vec![0u32; WEIGHT_TABLE_LEN];
    let mut total_bigrams = 0u64;
    let masks = file_symbol_masks.unwrap_or_default();

    for (index, relative_path) in files.iter().enumerate() {
        let absolute_path = Path::new(&project_root).join(relative_path);
        let Ok(contents) = fs::read_to_string(&absolute_path) else {
            continue;
        };
        let spans = collect_normalized_spans(&contents);
        if spans.is_empty() {
            continue;
        }

        for span in &spans {
            if span.len() < 2 {
                continue;
            }
            for pair in span.windows(2) {
                let idx = pair_index(pair[0], pair[1]);
                bigram_counts[idx] = bigram_counts[idx].saturating_add(1);
                total_bigrams += 1;
            }
        }

        corpus_files.push((
            relative_path.clone(),
            masks.get(index).copied().unwrap_or(0),
            spans,
        ));
    }

    let used_fallback_weights = total_bigrams < MIN_CORPUS_BIGRAMS;
    let weights = if used_fallback_weights {
        build_fallback_weights()
    } else {
        build_inverse_frequency_weights(&bigram_counts, total_bigrams)
    };

    let mut postings: HashMap<String, Vec<u32>> = HashMap::new();
    let mut file_entries = Vec::with_capacity(corpus_files.len());
    let mut total_postings = 0u32;

    for (file_id, (relative_path, symbol_mask, spans)) in corpus_files.into_iter().enumerate() {
        file_entries.push(FileEntry {
            path: relative_path,
            symbol_mask,
        });

        let mut grams_for_file = HashSet::new();
        for span in spans {
            for gram in extract_sparse_grams(&span, &weights) {
                grams_for_file.insert(gram);
            }
        }

        for gram in grams_for_file {
            postings.entry(gram).or_default().push(file_id as u32);
            total_postings = total_postings.saturating_add(1);
        }
    }

    for posting_list in postings.values_mut() {
        posting_list.sort_unstable();
    }

    let dense_words = dense_words(file_entries.len());
    let mut dense_grams = 0u32;
    let mut sparse_grams = 0u32;
    let mut gram_names = postings.keys().cloned().collect::<Vec<_>>();
    gram_names.sort_unstable();

    let mut columns = Vec::with_capacity(gram_names.len());
    for gram in &gram_names {
        let posting_list = postings
            .get(gram)
            .expect("gram name collected from postings map must exist");
        let dense = should_use_dense(posting_list.len(), dense_words);
        let column = if dense {
            dense_grams += 1;
            encode_dense_column(posting_list, dense_words)
        } else {
            sparse_grams += 1;
            encode_sparse_column(posting_list)
        };
        columns.push(column);
    }

    let file_table_size = file_entries
        .iter()
        .map(|entry| 8usize + entry.path.len())
        .sum::<usize>();
    let gram_table_size = gram_names
        .iter()
        .map(|gram| 20usize + gram.len())
        .sum::<usize>();
    let data_size = columns.iter().map(|column| column.data.len()).sum::<usize>();
    let header_size = encoded_header_size();

    let file_table_offset = header_size as u64;
    let gram_table_offset = file_table_offset + file_table_size as u64;
    let data_offset = gram_table_offset + gram_table_size as u64;
    let weights_offset = data_offset + data_size as u64;

    if let Some(parent) = Path::new(&output_path).parent() {
        fs::create_dir_all(parent).map_err(|err| {
            Error::from_reason(format!(
                "Failed to create sparse gram index directory {}: {err}",
                parent.display()
            ))
        })?;
    }

    let header = Header {
        version: VERSION,
        flags: if used_fallback_weights {
            FLAG_USED_FALLBACK_WEIGHTS
        } else {
            0
        },
        total_files: file_entries.len() as u32,
        gram_count: gram_names.len() as u32,
        total_postings,
        dense_words: dense_words as u32,
        dense_grams,
        sparse_grams,
        file_table_offset,
        gram_table_offset,
        data_offset,
        weights_offset,
    };

    let writer = File::create(&output_path)
        .map_err(|err| Error::from_reason(format!("Failed to create sparse gram index {output_path}: {err}")))?;
    let mut writer = BufWriter::new(writer);
    write_header(&mut writer, &header)?;

    for entry in &file_entries {
        write_u32(&mut writer, entry.path.len() as u32)?;
        write_u32(&mut writer, entry.symbol_mask)?;
        writer
            .write_all(entry.path.as_bytes())
            .map_err(|err| Error::from_reason(format!("Failed to write file table: {err}")))?;
    }

    let mut running_data_offset = data_offset;
    for (gram, column) in gram_names.iter().zip(columns.iter()) {
        write_u16(&mut writer, gram.len() as u16)?;
        write_u8(&mut writer, column.flags)?;
        write_u8(&mut writer, 0)?;
        write_u32(&mut writer, column.postings_count)?;
        write_u32(&mut writer, column.data.len() as u32)?;
        write_u64(&mut writer, running_data_offset)?;
        writer
            .write_all(gram.as_bytes())
            .map_err(|err| Error::from_reason(format!("Failed to write gram table: {err}")))?;
        running_data_offset += column.data.len() as u64;
    }

    for column in &columns {
        writer
            .write_all(&column.data)
            .map_err(|err| Error::from_reason(format!("Failed to write postings: {err}")))?;
    }

    for weight in &weights {
        writer
            .write_all(&weight.to_le_bytes())
            .map_err(|err| Error::from_reason(format!("Failed to write weight table: {err}")))?;
    }

    writer
        .flush()
        .map_err(|err| Error::from_reason(format!("Failed to flush sparse gram index {output_path}: {err}")))?;

    Ok(SparseGramBuildResult {
        files_indexed: file_entries.len() as u32,
        grams: gram_names.len() as u32,
        dense_grams,
        sparse_grams,
        postings: total_postings,
        used_fallback_weights,
    })
}

impl NativeSparseGramIndex {
    fn load_posting_set(&self, desc: &GramDescriptor) -> Result<CandidateSet> {
        let data = self.slice(desc.data_offset, desc.data_len as usize)?;
        if desc.flags & FLAG_DENSE_POSTINGS != 0 {
            let mut words = Vec::with_capacity(self.header.dense_words as usize);
            for chunk in data.chunks_exact(8) {
                words.push(u64::from_le_bytes([
                    chunk[0], chunk[1], chunk[2], chunk[3],
                    chunk[4], chunk[5], chunk[6], chunk[7],
                ]));
            }
            Ok(CandidateSet::Dense(words))
        } else {
            Ok(CandidateSet::Sparse(decode_sparse_postings(data)))
        }
    }

    fn slice(&self, offset: u64, len: usize) -> Result<&[u8]> {
        let start = offset as usize;
        let end = start.saturating_add(len);
        self.mmap.get(start..end).ok_or_else(|| {
            Error::from_reason(format!(
                "Sparse gram index slice out of bounds: offset={offset} len={len}"
            ))
        })
    }
}

fn parse_header(bytes: &[u8]) -> Result<Header> {
    let mut cursor = 0usize;
    let magic = read_bytes(bytes, &mut cursor, MAGIC.len())?;
    if magic != MAGIC {
        return Err(Error::from_reason("Invalid sparse gram index magic header"));
    }

    Ok(Header {
        version: read_u32(bytes, &mut cursor)?,
        flags: read_u32(bytes, &mut cursor)?,
        total_files: read_u32(bytes, &mut cursor)?,
        gram_count: read_u32(bytes, &mut cursor)?,
        total_postings: read_u32(bytes, &mut cursor)?,
        dense_words: read_u32(bytes, &mut cursor)?,
        dense_grams: read_u32(bytes, &mut cursor)?,
        sparse_grams: read_u32(bytes, &mut cursor)?,
        file_table_offset: read_u64(bytes, &mut cursor)?,
        gram_table_offset: read_u64(bytes, &mut cursor)?,
        data_offset: read_u64(bytes, &mut cursor)?,
        weights_offset: read_u64(bytes, &mut cursor)?,
    })
}

fn parse_file_table(bytes: &[u8], header: &Header) -> Result<Vec<FileEntry>> {
    let mut cursor = header.file_table_offset as usize;
    let gram_table_offset = header.gram_table_offset as usize;
    let mut files = Vec::with_capacity(header.total_files as usize);

    for _ in 0..header.total_files {
        let path_len = read_u32(bytes, &mut cursor)? as usize;
        let symbol_mask = read_u32(bytes, &mut cursor)?;
        let path_bytes = read_bytes(bytes, &mut cursor, path_len)?;
        let path = String::from_utf8(path_bytes.to_vec())
            .map_err(|err| Error::from_reason(format!("Invalid UTF-8 in sparse gram file path: {err}")))?;
        files.push(FileEntry { path, symbol_mask });
    }

    if cursor != gram_table_offset {
        return Err(Error::from_reason(format!(
            "Sparse gram file table size mismatch: cursor={cursor} expected={gram_table_offset}"
        )));
    }

    Ok(files)
}

fn parse_gram_table(bytes: &[u8], header: &Header) -> Result<HashMap<String, GramDescriptor>> {
    let mut cursor = header.gram_table_offset as usize;
    let data_offset = header.data_offset as usize;
    let mut grams = HashMap::with_capacity(header.gram_count as usize);

    for _ in 0..header.gram_count {
        let gram_len = read_u16(bytes, &mut cursor)? as usize;
        let flags = read_u8(bytes, &mut cursor)?;
        let _reserved = read_u8(bytes, &mut cursor)?;
        let postings_count = read_u32(bytes, &mut cursor)?;
        let data_len = read_u32(bytes, &mut cursor)?;
        let data_offset_entry = read_u64(bytes, &mut cursor)?;
        let gram = String::from_utf8(read_bytes(bytes, &mut cursor, gram_len)?.to_vec())
            .map_err(|err| Error::from_reason(format!("Invalid UTF-8 in sparse gram key: {err}")))?;
        grams.insert(
            gram,
            GramDescriptor {
                data_offset: data_offset_entry,
                data_len,
                postings_count,
                flags,
            },
        );
    }

    if cursor != data_offset {
        return Err(Error::from_reason(format!(
            "Sparse gram table size mismatch: cursor={cursor} expected={data_offset}"
        )));
    }

    Ok(grams)
}

fn parse_weights(bytes: &[u8], header: &Header) -> Result<Vec<f32>> {
    let start = header.weights_offset as usize;
    let end = start + (WEIGHT_TABLE_LEN * 4);
    let weight_bytes = bytes.get(start..end).ok_or_else(|| {
        Error::from_reason("Sparse gram weight table out of bounds")
    })?;

    let mut weights = Vec::with_capacity(WEIGHT_TABLE_LEN);
    for chunk in weight_bytes.chunks_exact(4) {
        weights.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
    }
    Ok(weights)
}

fn encoded_header_size() -> usize {
    MAGIC.len() + (8 * 4) + (4 * 8)
}

fn write_header(writer: &mut BufWriter<File>, header: &Header) -> Result<()> {
    writer
        .write_all(MAGIC)
        .map_err(|err| Error::from_reason(format!("Failed to write sparse gram header: {err}")))?;
    write_u32(writer, header.version)?;
    write_u32(writer, header.flags)?;
    write_u32(writer, header.total_files)?;
    write_u32(writer, header.gram_count)?;
    write_u32(writer, header.total_postings)?;
    write_u32(writer, header.dense_words)?;
    write_u32(writer, header.dense_grams)?;
    write_u32(writer, header.sparse_grams)?;
    write_u64(writer, header.file_table_offset)?;
    write_u64(writer, header.gram_table_offset)?;
    write_u64(writer, header.data_offset)?;
    write_u64(writer, header.weights_offset)?;
    Ok(())
}

fn write_u8(writer: &mut BufWriter<File>, value: u8) -> Result<()> {
    writer
        .write_all(&[value])
        .map_err(|err| Error::from_reason(format!("Failed to write sparse gram index: {err}")))
}

fn write_u16(writer: &mut BufWriter<File>, value: u16) -> Result<()> {
    writer
        .write_all(&value.to_le_bytes())
        .map_err(|err| Error::from_reason(format!("Failed to write sparse gram index: {err}")))
}

fn write_u32(writer: &mut BufWriter<File>, value: u32) -> Result<()> {
    writer
        .write_all(&value.to_le_bytes())
        .map_err(|err| Error::from_reason(format!("Failed to write sparse gram index: {err}")))
}

fn write_u64(writer: &mut BufWriter<File>, value: u64) -> Result<()> {
    writer
        .write_all(&value.to_le_bytes())
        .map_err(|err| Error::from_reason(format!("Failed to write sparse gram index: {err}")))
}

fn read_bytes<'a>(bytes: &'a [u8], cursor: &mut usize, len: usize) -> Result<&'a [u8]> {
    let start = *cursor;
    let end = start.saturating_add(len);
    let slice = bytes.get(start..end).ok_or_else(|| {
        Error::from_reason(format!("Sparse gram index truncated at byte range {start}..{end}"))
    })?;
    *cursor = end;
    Ok(slice)
}

fn read_u8(bytes: &[u8], cursor: &mut usize) -> Result<u8> {
    Ok(read_bytes(bytes, cursor, 1)?[0])
}

fn read_u16(bytes: &[u8], cursor: &mut usize) -> Result<u16> {
    let buf = read_bytes(bytes, cursor, 2)?;
    Ok(u16::from_le_bytes([buf[0], buf[1]]))
}

fn read_u32(bytes: &[u8], cursor: &mut usize) -> Result<u32> {
    let buf = read_bytes(bytes, cursor, 4)?;
    Ok(u32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]))
}

fn read_u64(bytes: &[u8], cursor: &mut usize) -> Result<u64> {
    let buf = read_bytes(bytes, cursor, 8)?;
    Ok(u64::from_le_bytes([
        buf[0], buf[1], buf[2], buf[3], buf[4], buf[5], buf[6], buf[7],
    ]))
}

fn dense_words(file_count: usize) -> usize {
    usize::max(1, file_count.div_ceil(64))
}

fn should_use_dense(posting_count: usize, dense_words: usize) -> bool {
    posting_count.saturating_mul(4) >= dense_words.saturating_mul(8)
}

fn encode_dense_column(postings: &[u32], dense_words: usize) -> ColumnBuild {
    let mut words = vec![0u64; dense_words];
    for &file_id in postings {
        let index = file_id as usize / 64;
        let bit = file_id as usize % 64;
        words[index] |= 1u64 << bit;
    }

    let mut data = Vec::with_capacity(words.len() * 8);
    for word in words {
        data.extend_from_slice(&word.to_le_bytes());
    }

    ColumnBuild {
        flags: FLAG_DENSE_POSTINGS,
        postings_count: postings.len() as u32,
        data,
    }
}

fn encode_sparse_column(postings: &[u32]) -> ColumnBuild {
    let mut data = Vec::with_capacity(postings.len() * 2);
    let mut previous = 0u32;
    for (index, &value) in postings.iter().enumerate() {
        let delta = if index == 0 { value } else { value - previous };
        encode_varint(delta, &mut data);
        previous = value;
    }
    ColumnBuild {
        flags: 0,
        postings_count: postings.len() as u32,
        data,
    }
}

fn encode_varint(mut value: u32, out: &mut Vec<u8>) {
    loop {
        let mut byte = (value & 0x7F) as u8;
        value >>= 7;
        if value != 0 {
            byte |= 0x80;
        }
        out.push(byte);
        if value == 0 {
            break;
        }
    }
}

fn decode_sparse_postings(bytes: &[u8]) -> Vec<u32> {
    let mut postings = Vec::new();
    let mut index = 0usize;
    let mut previous = 0u32;

    while index < bytes.len() {
        let mut shift = 0u32;
        let mut value = 0u32;
        loop {
            if index >= bytes.len() {
                return postings; // Truncated varint; return what we have
            }
            let byte = bytes[index];
            index += 1;
            value |= ((byte & 0x7F) as u32) << shift;
            if byte & 0x80 == 0 {
                break;
            }
            shift += 7;
            if shift >= 35 {
                return postings; // Malformed varint; bail
            }
        }
        let current = if postings.is_empty() { value } else { previous + value };
        postings.push(current);
        previous = current;
    }

    postings
}

fn intersect_candidate_sets(left: CandidateSet, right: CandidateSet) -> CandidateSet {
    match (left, right) {
        (CandidateSet::Dense(mut left_words), CandidateSet::Dense(right_words)) => {
            bitand_dense_in_place(&mut left_words, &right_words);
            CandidateSet::Dense(left_words)
        }
        (CandidateSet::Dense(left_words), CandidateSet::Sparse(right_ids)) => {
            CandidateSet::Sparse(filter_sparse_with_dense(&right_ids, &left_words))
        }
        (CandidateSet::Sparse(left_ids), CandidateSet::Dense(right_words)) => {
            CandidateSet::Sparse(filter_sparse_with_dense(&left_ids, &right_words))
        }
        (CandidateSet::Sparse(left_ids), CandidateSet::Sparse(right_ids)) => {
            CandidateSet::Sparse(intersect_sorted(&left_ids, &right_ids))
        }
    }
}

fn candidate_set_is_empty(set: &CandidateSet) -> bool {
    match set {
        CandidateSet::Dense(words) => words.iter().all(|word| *word == 0),
        CandidateSet::Sparse(ids) => ids.is_empty(),
    }
}

fn filter_candidate_set_by_symbol_mask(
    set: CandidateSet,
    files: &[FileEntry],
    symbol_mask: u32,
) -> CandidateSet {
    let filtered = match set {
        CandidateSet::Dense(words) => collect_dense_ids(words.as_slice())
            .into_iter()
            .filter(|file_id| {
                files.get(*file_id as usize)
                    .is_some_and(|entry| entry.symbol_mask & symbol_mask != 0)
            })
            .collect::<Vec<_>>(),
        CandidateSet::Sparse(ids) => ids
            .into_iter()
            .filter(|file_id| {
                files.get(*file_id as usize)
                    .is_some_and(|entry| entry.symbol_mask & symbol_mask != 0)
            })
            .collect::<Vec<_>>(),
    };
    CandidateSet::Sparse(filtered)
}

fn collect_candidate_ids(set: CandidateSet) -> Vec<u32> {
    match set {
        CandidateSet::Dense(words) => collect_dense_ids(words.as_slice()),
        CandidateSet::Sparse(ids) => ids,
    }
}

fn collect_dense_ids(words: &[u64]) -> Vec<u32> {
    let mut ids = Vec::new();
    for (word_index, word) in words.iter().enumerate() {
        let mut bits = *word;
        while bits != 0 {
            let tz = bits.trailing_zeros() as usize;
            ids.push((word_index * 64 + tz) as u32);
            bits &= bits - 1;
        }
    }
    ids
}

fn filter_sparse_with_dense(ids: &[u32], dense_words: &[u64]) -> Vec<u32> {
    ids.iter()
        .copied()
        .filter(|file_id| {
            let word_index = *file_id as usize / 64;
            let bit = *file_id as usize % 64;
            dense_words
                .get(word_index)
                .is_some_and(|word| ((*word >> bit) & 1) == 1)
        })
        .collect()
}

/// Like `filter_sparse_with_dense`, but reads the dense bitmap directly from
/// little-endian bytes in the mmap rather than a decoded `Vec<u64>`.
fn filter_sparse_with_dense_bytes(ids: &[u32], dense_bytes: &[u8]) -> Vec<u32> {
    ids.iter()
        .copied()
        .filter(|file_id| {
            let byte_offset = (*file_id as usize / 64) * 8;
            let bit = *file_id as usize % 64;
            dense_bytes
                .get(byte_offset..byte_offset + 8)
                .is_some_and(|chunk| {
                    (u64::from_le_bytes(chunk.try_into().unwrap()) >> bit) & 1 == 1
                })
        })
        .collect()
}

fn bitand_dense_in_place(left: &mut [u64], right: &[u64]) {
    let min_len = left.len().min(right.len());
    let left = &mut left[..min_len];
    let right = &right[..min_len];

    #[cfg(target_arch = "x86_64")]
    {
        if std::arch::is_x86_feature_detected!("avx2") {
            unsafe {
                bitand_dense_in_place_avx2(left, right);
            }
            return;
        }
    }

    #[cfg(target_arch = "aarch64")]
    {
        unsafe {
            bitand_dense_in_place_neon(left, right);
        }
        return;
    }

    for (lhs, rhs) in left.iter_mut().zip(right.iter()) {
        *lhs &= *rhs;
    }
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2")]
unsafe fn bitand_dense_in_place_avx2(left: &mut [u64], right: &[u64]) {
    use std::arch::x86_64::{_mm256_and_si256, _mm256_loadu_si256, _mm256_storeu_si256, __m256i};

    let chunks = left.len() / 4;
    for index in 0..chunks {
        let offset = index * 4;
        let left_ptr = left.as_mut_ptr().add(offset) as *mut __m256i;
        let right_ptr = right.as_ptr().add(offset) as *const __m256i;
        let lhs = _mm256_loadu_si256(left_ptr);
        let rhs = _mm256_loadu_si256(right_ptr);
        _mm256_storeu_si256(left_ptr, _mm256_and_si256(lhs, rhs));
    }

    for index in (chunks * 4)..left.len() {
        left[index] &= right[index];
    }
}

#[cfg(target_arch = "aarch64")]
unsafe fn bitand_dense_in_place_neon(left: &mut [u64], right: &[u64]) {
    use std::arch::aarch64::{uint64x2_t, vandq_u64, vld1q_u64, vst1q_u64};

    let chunks = left.len() / 2;
    for index in 0..chunks {
        let offset = index * 2;
        let left_ptr = left.as_mut_ptr().add(offset);
        let right_ptr = right.as_ptr().add(offset);
        let lhs: uint64x2_t = vld1q_u64(left_ptr);
        let rhs: uint64x2_t = vld1q_u64(right_ptr);
        vst1q_u64(left_ptr, vandq_u64(lhs, rhs));
    }

    for index in (chunks * 2)..left.len() {
        left[index] &= right[index];
    }
}

/// Bitwise AND dense posting bytes (little-endian packed u64s from the mmap)
/// directly into an accumulator, avoiding a `Vec<u64>` allocation for the
/// right-hand side.
fn bitand_dense_from_le_bytes(acc: &mut [u64], bytes: &[u8]) {
    for (i, chunk) in bytes.chunks_exact(8).enumerate() {
        if i >= acc.len() {
            break;
        }
        acc[i] &= u64::from_le_bytes(chunk.try_into().unwrap());
    }
    let right_words = bytes.len() / 8;
    for word in acc.get_mut(right_words..).into_iter().flatten() {
        *word = 0;
    }
}

pub(crate) fn normalize_literal(literal: &str) -> Option<Vec<u8>> {
    let mut bytes = Vec::with_capacity(literal.len());
    for byte in literal.bytes() {
        let normalized = normalize_ascii_byte(byte);
        if !is_span_byte(normalized) {
            return None;
        }
        bytes.push(normalized);
    }
    if bytes.len() < MIN_SPAN_LEN {
        return None;
    }
    Some(bytes)
}

pub(crate) fn collect_normalized_spans(text: &str) -> Vec<Vec<u8>> {
    let mut spans = Vec::new();
    let mut current = Vec::new();

    for byte in text.bytes() {
        let normalized = normalize_ascii_byte(byte);
        if is_span_byte(normalized) {
            current.push(normalized);
        } else if current.len() >= MIN_SPAN_LEN {
            spans.push(std::mem::take(&mut current));
        } else {
            current.clear();
        }
    }

    if current.len() >= MIN_SPAN_LEN {
        spans.push(current);
    }

    spans
}

/// Extract the minimal covering set of sparse grams from a span (query time).
///
/// Unlike `extract_sparse_grams` which finds ALL valid grams at every position
/// (needed at index time to ensure completeness), this function partitions the
/// span by recursively splitting at the highest-weight interior bigram. Each
/// resulting piece is either a valid gram (boundaries dominate interior) or a
/// base-case trigram. The covering set is a subset of what `extract_sparse_grams`
/// produces — sufficient for posting list intersection, but with fewer grams to
/// look up.
///
/// Algorithm: iterative stack-based version of the recursive split from
/// GitHub Blackbird / Cursor's sparse n-gram approach.
pub(crate) fn extract_covering_grams(span: &[u8], weights: &[f32]) -> Vec<String> {
    if span.len() < MIN_SPAN_LEN {
        return Vec::new();
    }

    let pair_weights = span
        .windows(2)
        .map(|pair| weights[pair_index(pair[0], pair[1])])
        .collect::<Vec<_>>();

    let mut grams = Vec::new();
    let mut seen = HashSet::new();

    // Stack of (start, end) byte ranges to process.
    let mut stack: Vec<(usize, usize)> = vec![(0, span.len())];

    while let Some((start, end)) = stack.pop() {
        let len = end - start;

        if len < MIN_SPAN_LEN {
            continue;
        }

        // Base case: trigram — always emit.
        if len == MIN_SPAN_LEN {
            let gram = match std::str::from_utf8(&span[start..end]) {
                Ok(s) => s.to_string(),
                Err(_) => continue,
            };
            if seen.insert(gram.clone()) {
                grams.push(gram);
            }
            continue;
        }

        // If within max gram length, check if boundaries dominate interior.
        if len <= MAX_GRAM_LEN {
            let first = pair_weights[start];
            let last = pair_weights[end - 2];
            let interior_max = pair_weights[(start + 1)..(end - 2)]
                .iter()
                .copied()
                .fold(f32::NEG_INFINITY, f32::max);

            if first.min(last) > interior_max {
                // Whole range is one valid gram — emit without splitting further.
                let gram = match std::str::from_utf8(&span[start..end]) {
                Ok(s) => s.to_string(),
                Err(_) => continue,
            };
                if seen.insert(gram.clone()) {
                    grams.push(gram);
                }
                continue;
            }
        }

        // Find the interior bigram with maximum weight to split at.
        let search_start = start + 1;
        let search_end = end - 1;
        let mut max_w = f32::NEG_INFINITY;
        let mut max_pos = search_start;
        for i in search_start..search_end {
            if pair_weights[i] > max_w {
                max_w = pair_weights[i];
                max_pos = i;
            }
        }

        // Split: left = [start, max_pos+1), right = [max_pos, end).
        // One byte overlap at max_pos ensures no coverage gap.
        let left_end = max_pos + 1;
        let right_start = max_pos;

        // Push right first (LIFO) so left is processed first.
        if end - right_start >= MIN_SPAN_LEN {
            stack.push((right_start, end));
        }
        if left_end - start >= MIN_SPAN_LEN {
            stack.push((start, left_end));
        }
    }

    // Fallback: if no covering grams found, use sliding trigrams.
    if grams.is_empty() {
        for window in span.windows(MIN_SPAN_LEN) {
            if let Ok(gram) = std::str::from_utf8(window) {
                let gram = gram.to_string();
                if seen.insert(gram.clone()) {
                    grams.push(gram);
                }
            }
        }
    }

    grams
}

/// Extract ALL sparse grams from a span (index build time).
///
/// Enumerates every valid (start, end) window where boundary bigram weights
/// exceed all interior bigram weights. This is the exhaustive extraction needed
/// at index time so that any covering query can find its grams in the postings.
pub(crate) fn extract_sparse_grams(span: &[u8], weights: &[f32]) -> Vec<String> {
    if span.len() < MIN_SPAN_LEN {
        return Vec::new();
    }

    let pair_weights = span
        .windows(2)
        .map(|pair| weights[pair_index(pair[0], pair[1])])
        .collect::<Vec<_>>();

    let mut grams = Vec::new();
    let mut seen = HashSet::new();

    for start in 0..=span.len() - MIN_SPAN_LEN {
        let max_end = usize::min(span.len(), start + MAX_GRAM_LEN);
        for end in (start + MIN_SPAN_LEN)..=max_end {
            let first = pair_weights[start];
            let last = pair_weights[end - 2];
            let interior_max = if end - start <= 3 {
                f32::NEG_INFINITY
            } else {
                pair_weights[(start + 1)..(end - 2)]
                    .iter()
                    .copied()
                    .fold(f32::NEG_INFINITY, f32::max)
            };

            if first.min(last) > interior_max {
                let gram = match std::str::from_utf8(&span[start..end]) {
                Ok(s) => s.to_string(),
                Err(_) => continue,
            };
                if seen.insert(gram.clone()) {
                    grams.push(gram);
                }
            }
        }
    }

    if grams.is_empty() {
        for window in span.windows(3) {
            if let Ok(gram) = std::str::from_utf8(window) {
                let gram = gram.to_string();
                if seen.insert(gram.clone()) {
                    grams.push(gram);
                }
            }
        }
    }

    grams
}

fn intersect_sorted(left: &[u32], right: &[u32]) -> Vec<u32> {
    let mut output = Vec::with_capacity(left.len().min(right.len()));
    let mut li = 0usize;
    let mut ri = 0usize;

    while li < left.len() && ri < right.len() {
        match left[li].cmp(&right[ri]) {
            std::cmp::Ordering::Less => li += 1,
            std::cmp::Ordering::Greater => ri += 1,
            std::cmp::Ordering::Equal => {
                output.push(left[li]);
                li += 1;
                ri += 1;
            }
        }
    }

    output
}

pub(crate) fn build_inverse_frequency_weights(counts: &[u32], total_bigrams: u64) -> Vec<f32> {
    let denominator = (total_bigrams + WEIGHT_TABLE_LEN as u64) as f32;
    counts
        .iter()
        .map(|count| (denominator / (*count as f32 + 1.0)).ln())
        .collect()
}

pub(crate) fn build_fallback_weights() -> Vec<f32> {
    let mut counts = vec![1u32; WEIGHT_TABLE_LEN];
    for (pair, count) in common_code_bigrams() {
        let bytes = pair.as_bytes();
        counts[pair_index(bytes[0], bytes[1])] = count;
    }

    let total = counts.iter().map(|count| *count as u64).sum();
    build_inverse_frequency_weights(&counts, total)
}

pub(crate) fn common_code_bigrams() -> Vec<(&'static str, u32)> {
    vec![
        ("th", 5000), ("he", 4800), ("in", 4700), ("er", 4500), ("re", 4300),
        ("fo", 4200), ("or", 4200), ("fu", 4100), ("un", 4000), ("ct", 3900),
        ("cl", 3800), ("ss", 3700), ("co", 3600), ("de", 3500), ("nt", 3400),
        ("io", 3300), ("on", 3200), ("st", 3100), ("te", 3000), ("ra", 2900),
        ("ri", 2800), ("al", 2700), ("se", 2600), ("it", 2500), ("at", 2400),
        ("es", 2300), ("is", 2200), ("le", 2100), ("ar", 2000), ("ha", 1900),
        ("ng", 1800), ("js", 1700), ("ts", 1600), ("py", 1500), ("rs", 1400),
        ("::", 1300), ("->", 1200), ("=>", 1100), ("__", 1000), ("./", 900),
    ]
}

fn is_span_byte(byte: u8) -> bool {
    matches!(
        byte,
        b'a'..=b'z' | b'0'..=b'9' | b'_' | b'.' | b'/' | b':' | b'-'
    )
}

fn normalize_ascii_byte(byte: u8) -> u8 {
    if byte.is_ascii_uppercase() {
        byte.to_ascii_lowercase()
    } else {
        byte
    }
}

pub(crate) fn pair_index(left: u8, right: u8) -> usize {
    ((left as usize) << 7) | right as usize
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_weights() -> Vec<f32> {
        build_fallback_weights()
    }

    #[test]
    fn covering_grams_are_subset_of_all_grams() {
        let weights = test_weights();
        let cases: Vec<&[u8]> = vec![
            b"authenticationservice",
            b"formatstring",
            b"getconfig",
            b"interface",
            b"variable",
            b"function_handler",
            b"hello_world",
            b"zqx",
        ];
        for span in cases {
            let all = extract_sparse_grams(span, &weights);
            let covering = extract_covering_grams(span, &weights);
            let all_set: HashSet<_> = all.iter().collect();
            for gram in &covering {
                assert!(
                    all_set.contains(gram),
                    "Covering gram {:?} from span {:?} not found in all grams {:?}",
                    gram,
                    String::from_utf8_lossy(span),
                    all,
                );
            }
        }
    }

    #[test]
    fn covering_grams_fewer_or_equal_to_all_grams() {
        let weights = test_weights();
        // Longer spans should produce fewer covering grams than all grams.
        let span = b"authenticationservicefactory";
        let all = extract_sparse_grams(span, &weights);
        let covering = extract_covering_grams(span, &weights);
        assert!(
            covering.len() <= all.len(),
            "Covering ({}) should be <= all ({}) for {:?}",
            covering.len(),
            all.len(),
            String::from_utf8_lossy(span),
        );
    }

    #[test]
    fn covering_grams_nonempty_for_valid_spans() {
        let weights = test_weights();
        let cases: Vec<&[u8]> = vec![
            b"abc",       // minimum trigram
            b"abcdef",    // medium span
            b"authentication_service_factory_impl", // long span
        ];
        for span in cases {
            let covering = extract_covering_grams(span, &weights);
            assert!(
                !covering.is_empty(),
                "Covering grams should not be empty for span {:?}",
                String::from_utf8_lossy(span),
            );
        }
    }

    #[test]
    fn covering_grams_short_span_equals_all_grams() {
        let weights = test_weights();
        // For a trigram, both should produce the same result.
        let span = b"abc";
        let all = extract_sparse_grams(span, &weights);
        let covering = extract_covering_grams(span, &weights);
        assert_eq!(all, covering, "Trigram should produce identical results");
    }

    #[test]
    fn covering_grams_respects_max_gram_len() {
        let weights = test_weights();
        let span = b"abcdefghijklmnopqrstuvwxyz";
        let covering = extract_covering_grams(span, &weights);
        for gram in &covering {
            assert!(
                gram.len() <= MAX_GRAM_LEN,
                "Covering gram {:?} exceeds MAX_GRAM_LEN {}",
                gram,
                MAX_GRAM_LEN,
            );
            assert!(
                gram.len() >= MIN_SPAN_LEN,
                "Covering gram {:?} is shorter than MIN_SPAN_LEN {}",
                gram,
                MIN_SPAN_LEN,
            );
        }
    }

    #[test]
    fn extract_sparse_grams_empty_for_short_spans() {
        let weights = test_weights();
        assert!(extract_sparse_grams(b"ab", &weights).is_empty());
        assert!(extract_sparse_grams(b"a", &weights).is_empty());
        assert!(extract_sparse_grams(b"", &weights).is_empty());
        assert!(extract_covering_grams(b"ab", &weights).is_empty());
        assert!(extract_covering_grams(b"a", &weights).is_empty());
        assert!(extract_covering_grams(b"", &weights).is_empty());
    }

    #[test]
    fn bitand_dense_from_le_bytes_basic() {
        let mut acc = vec![0xFF_FF_FF_FF_FF_FF_FF_FFu64, 0x00_00_00_00_00_00_00_FFu64];
        let right_0: u64 = 0x00_00_00_00_00_00_FF_00;
        let right_1: u64 = 0xFF_FF_FF_FF_FF_FF_FF_FF;
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&right_0.to_le_bytes());
        bytes.extend_from_slice(&right_1.to_le_bytes());

        bitand_dense_from_le_bytes(&mut acc, &bytes);

        assert_eq!(acc[0], 0x00_00_00_00_00_00_FF_00);
        assert_eq!(acc[1], 0x00_00_00_00_00_00_00_FF);
    }

    #[test]
    fn bitand_dense_from_le_bytes_shorter_right() {
        let mut acc = vec![0xFFu64; 4];
        let right: u64 = 0xAB;
        let bytes = right.to_le_bytes().to_vec();

        bitand_dense_from_le_bytes(&mut acc, &bytes);

        assert_eq!(acc[0], 0xAB);
        assert_eq!(acc[1], 0);
        assert_eq!(acc[2], 0);
        assert_eq!(acc[3], 0);
    }

    #[test]
    fn filter_sparse_with_dense_bytes_basic() {
        let word: u64 = 0b101; // bits 0 and 2 set
        let bytes = word.to_le_bytes().to_vec();

        let ids = vec![0, 1, 2, 3];
        let filtered = filter_sparse_with_dense_bytes(&ids, &bytes);
        assert_eq!(filtered, vec![0, 2]);
    }

    #[test]
    fn bitand_dense_from_le_bytes_matches_materialized() {
        let left: Vec<u64> = vec![
            0xDEAD_BEEF_CAFE_BABE,
            0x1234_5678_9ABC_DEF0,
            0xFFFF_0000_FFFF_0000,
        ];
        let right: Vec<u64> = vec![
            0xFFFF_FFFF_0000_0000,
            0x0000_FFFF_0000_FFFF,
            0x0F0F_0F0F_0F0F_0F0F,
        ];

        // Materialized path (existing)
        let mut via_alloc = left.clone();
        bitand_dense_in_place(&mut via_alloc, &right);

        // Zero-copy path (new)
        let mut bytes = Vec::new();
        for w in &right {
            bytes.extend_from_slice(&w.to_le_bytes());
        }
        let mut via_bytes = left.clone();
        bitand_dense_from_le_bytes(&mut via_bytes, &bytes);

        assert_eq!(via_alloc, via_bytes, "Zero-copy path must match materialized path");
    }
}
