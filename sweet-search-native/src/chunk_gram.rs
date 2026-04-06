//! Chunk-level sparse gram index — additive artifact alongside file-level.
//!
//! Binary format: `SSCGRIDX` magic + Header + ChunkTable + GramTable + Postings + Weights
//!
//! Unlike the file-level index (sparse_gram.rs) which maps grams → file IDs,
//! this maps grams → chunk IDs where each chunk is a (file, startLine, endLine)
//! range from the AST chunker. This gives sub-file granularity: a gram like
//! "const" that appears in 60% of files might only appear in 30% of chunks.
//!
//! The query interface returns chunk ranges directly, allowing the caller to
//! run native grep only on those line ranges and feed results straight to MaxSim.

use memmap2::Mmap;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::Path;

use crate::native_grep::VerifiedChunk;
use crate::sparse_gram::{
    build_fallback_weights, build_inverse_frequency_weights, collect_normalized_spans,
    extract_covering_grams, extract_sparse_grams, normalize_literal,
    pair_index, MIN_CORPUS_BIGRAMS, WEIGHT_TABLE_LEN,
};

const MAGIC: &[u8; 8] = b"SSCGRIDX";
const VERSION: u32 = 1;

// ============================================================================
// Data structures
// ============================================================================

#[derive(Clone, Debug)]
struct ChunkEntry {
    file_path: String,
    start_line: u32,
    end_line: u32,
}

#[derive(Clone, Debug)]
struct GramDescriptor {
    data_offset: u64,
    data_len: u32,
    postings_count: u32,
}

/// Sorted gram table — binary search replaces HashMap for zero-allocation lookups.
struct SortedGramTable {
    keys: Vec<String>,
    vals: Vec<GramDescriptor>,
}

impl SortedGramTable {
    fn with_capacity(cap: usize) -> Self {
        Self {
            keys: Vec::with_capacity(cap),
            vals: Vec::with_capacity(cap),
        }
    }

    fn push(&mut self, key: String, val: GramDescriptor) {
        debug_assert!(
            self.keys.last().map_or(true, |prev| prev.as_str() <= key.as_str()),
            "SortedGramTable: grams must be pushed in sorted order"
        );
        self.keys.push(key);
        self.vals.push(val);
    }

    #[inline]
    fn get(&self, key: &str) -> Option<&GramDescriptor> {
        self.keys
            .binary_search_by(|k| k.as_str().cmp(key))
            .ok()
            .map(|idx| &self.vals[idx])
    }
}

#[derive(Clone, Debug)]
struct Header {
    version: u32,
    total_chunks: u32,
    gram_count: u32,
    total_postings: u32,
    chunk_table_offset: u64,
    gram_table_offset: u64,
    data_offset: u64,
    weights_offset: u64,
}

// ============================================================================
// NAPI types
// ============================================================================

#[napi(object)]
pub struct ChunkGramBuildResult {
    pub chunks_indexed: u32,
    pub grams: u32,
    pub postings: u32,
}

#[napi(object)]
pub struct ChunkGramBuildInput {
    pub file_path: String,
    pub start_line: u32,
    pub end_line: u32,
}

#[napi(object)]
pub struct ChunkGramQueryHit {
    pub file: String,
    pub start_line: u32,
    pub end_line: u32,
    pub chunk_id: u32,
}

#[napi(object)]
pub struct ChunkGramQueryResult {
    pub eligible: bool,
    pub chunk_ids: Vec<ChunkGramQueryHit>,
    pub grams_used: u32,
    pub total_chunks: u32,
    pub candidate_chunks: u32,
}

#[napi(object)]
pub struct ChunkGramIndexStats {
    pub total_chunks: u32,
    pub grams: u32,
    pub postings: u32,
}

#[napi(object)]
pub struct ChunkGramSearchResult {
    /// Whether the search produced results (false = too broad or no literals).
    pub eligible: bool,
    /// Reason for ineligibility, or "ok".
    pub reason: String,
    /// Chunks that have at least one regex match.
    pub verified: Vec<VerifiedChunk>,
    /// Total chunks in the index.
    pub total_chunks: u32,
    /// Candidate chunks from gram query (before verification).
    pub candidate_chunks: u32,
    /// Number of unique files read for verification.
    pub files_read: u32,
    /// Wall-clock time in microseconds.
    pub elapsed_us: u32,
}

impl ChunkGramSearchResult {
    fn ineligible(reason: &str, start: std::time::Instant) -> Self {
        Self {
            eligible: false,
            reason: reason.to_string(),
            verified: Vec::new(),
            total_chunks: 0,
            candidate_chunks: 0,
            files_read: 0,
            elapsed_us: start.elapsed().as_micros() as u32,
        }
    }
}

/// A merged window covering one or more adjacent chunks in a file.
struct MergedWindow {
    start_line: u32,
    end_line: u32,
    original_chunks: Vec<(u32, u32, u32)>, // (startLine, endLine, chunkId)
}

/// Merge overlapping or nearby chunk ranges within a file.
/// Ranges within `gap` lines of each other are merged into one window.
/// Input must be sorted by start_line.
fn merge_ranges(sorted_chunks: &[(u32, u32, u32)], gap: u32) -> Vec<MergedWindow> {
    if sorted_chunks.is_empty() { return Vec::new(); }

    let mut windows: Vec<MergedWindow> = Vec::new();
    let mut current = MergedWindow {
        start_line: sorted_chunks[0].0,
        end_line: sorted_chunks[0].1,
        original_chunks: vec![sorted_chunks[0]],
    };

    for &(s, e, cid) in &sorted_chunks[1..] {
        if s <= current.end_line + gap {
            // Merge: extend the window
            current.end_line = current.end_line.max(e);
            current.original_chunks.push((s, e, cid));
        } else {
            // Gap too large: start new window
            windows.push(current);
            current = MergedWindow {
                start_line: s,
                end_line: e,
                original_chunks: vec![(s, e, cid)],
            };
        }
    }
    windows.push(current);
    windows
}

// ============================================================================
// Build
// ============================================================================

#[napi]
pub fn build_chunk_gram_index(
    project_root: String,
    chunks: Vec<ChunkGramBuildInput>,
    output_path: String,
) -> Result<ChunkGramBuildResult> {
    let root = Path::new(&project_root);
    let mut bigram_counts = vec![0u32; WEIGHT_TABLE_LEN];
    let mut total_bigrams = 0u64;

    // Group chunks by file path to read each file only once
    let mut file_chunks: HashMap<String, Vec<(u32, u32, usize)>> = HashMap::new();
    for (idx, input) in chunks.iter().enumerate() {
        file_chunks
            .entry(input.file_path.clone())
            .or_default()
            .push((input.start_line, input.end_line, idx));
    }

    // Read each file once, extract spans for all its chunks
    let mut chunk_data: Vec<(ChunkEntry, Vec<Vec<u8>>)> = Vec::with_capacity(chunks.len());
    // Placeholder slots (to preserve chunk ordering)
    chunk_data.resize_with(chunks.len(), || {
        (ChunkEntry { file_path: String::new(), start_line: 0, end_line: 0 }, Vec::new())
    });
    let mut valid = vec![false; chunks.len()];

    for (file_path, file_chunk_list) in &file_chunks {
        let absolute = root.join(file_path);
        let Ok(file_text) = fs::read_to_string(&absolute) else {
            continue;
        };
        let lines: Vec<&str> = file_text.lines().collect();

        for &(start_line, end_line, chunk_idx) in file_chunk_list {
            let start = start_line.saturating_sub(1) as usize;
            let end = (end_line as usize).min(lines.len());
            if start >= lines.len() || start >= end {
                continue;
            }

            let chunk_text = lines[start..end].join("\n");
            let spans = collect_normalized_spans(&chunk_text);
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

            chunk_data[chunk_idx] = (
                ChunkEntry {
                    file_path: file_path.clone(),
                    start_line,
                    end_line,
                },
                spans,
            );
            valid[chunk_idx] = true;
        }
    }

    // Compact: remove invalid entries (preserve order)
    let chunk_data: Vec<(ChunkEntry, Vec<Vec<u8>>)> = chunk_data
        .into_iter()
        .zip(valid.iter())
        .filter(|(_, v)| **v)
        .map(|(d, _)| d)
        .collect();

    // Build weights
    let used_fallback = total_bigrams < MIN_CORPUS_BIGRAMS;
    let weights = if used_fallback {
        build_fallback_weights()
    } else {
        build_inverse_frequency_weights(&bigram_counts, total_bigrams)
    };

    // Build posting lists: gram → sorted chunk indices
    let mut postings: HashMap<String, Vec<u32>> = HashMap::new();
    let mut chunk_entries: Vec<ChunkEntry> = Vec::with_capacity(chunk_data.len());
    let mut total_postings = 0u32;

    for (chunk_id, (entry, spans)) in chunk_data.into_iter().enumerate() {
        chunk_entries.push(entry);

        let mut grams_for_chunk = HashSet::new();
        for span in spans {
            for gram in extract_sparse_grams(&span, &weights) {
                grams_for_chunk.insert(gram);
            }
        }

        for gram in grams_for_chunk {
            postings.entry(gram).or_default().push(chunk_id as u32);
            total_postings = total_postings.saturating_add(1);
        }
    }

    for posting_list in postings.values_mut() {
        posting_list.sort_unstable();
    }

    // Sort gram names for deterministic ordering
    let mut gram_names: Vec<String> = postings.keys().cloned().collect();
    gram_names.sort_unstable();

    // Encode postings as varint-delta arrays (always sparse — chunk counts
    // are typically larger than file counts so dense bitvecs rarely help)
    let mut encoded_postings: Vec<Vec<u8>> = Vec::with_capacity(gram_names.len());
    for gram in &gram_names {
        let list = postings.get(gram).unwrap();
        encoded_postings.push(encode_varint_delta(list));
    }

    // Compute section sizes and offsets
    let header_size = encoded_header_size();
    let chunk_table_size: usize = chunk_entries
        .iter()
        .map(|e| 4 + 4 + 4 + e.file_path.len()) // path_len(u32) + start(u32) + end(u32) + path bytes
        .sum();
    let gram_table_size: usize = gram_names
        .iter()
        .map(|g| 2 + 4 + 4 + 8 + g.len()) // gram_len(u16) + postings_count(u32) + data_len(u32) + offset(u64) + gram bytes
        .sum();
    let data_size: usize = encoded_postings.iter().map(|p| p.len()).sum();

    let chunk_table_offset = header_size as u64;
    let gram_table_offset = chunk_table_offset + chunk_table_size as u64;
    let data_offset = gram_table_offset + gram_table_size as u64;
    let weights_offset = data_offset + data_size as u64;

    let header = Header {
        version: VERSION,
        total_chunks: chunk_entries.len() as u32,
        gram_count: gram_names.len() as u32,
        total_postings,
        chunk_table_offset,
        gram_table_offset,
        data_offset,
        weights_offset,
    };

    // Write file
    if let Some(parent) = Path::new(&output_path).parent() {
        fs::create_dir_all(parent).map_err(|err| {
            Error::from_reason(format!(
                "Failed to create chunk gram index directory {}: {err}",
                parent.display()
            ))
        })?;
    }

    let file = File::create(&output_path)
        .map_err(|err| Error::from_reason(format!("Failed to create chunk gram index {output_path}: {err}")))?;
    let mut w = BufWriter::new(file);

    // Header
    write_header(&mut w, &header)?;

    // Chunk table
    for entry in &chunk_entries {
        write_u32(&mut w, entry.file_path.len() as u32)?;
        write_u32(&mut w, entry.start_line)?;
        write_u32(&mut w, entry.end_line)?;
        w.write_all(entry.file_path.as_bytes())
            .map_err(|e| Error::from_reason(format!("Failed to write chunk table: {e}")))?;
    }

    // Gram table
    let mut running_offset = data_offset;
    for (gram, encoded) in gram_names.iter().zip(encoded_postings.iter()) {
        let posting_count = postings.get(gram).unwrap().len() as u32;
        write_u16(&mut w, gram.len() as u16)?;
        write_u32(&mut w, posting_count)?;
        write_u32(&mut w, encoded.len() as u32)?;
        write_u64(&mut w, running_offset)?;
        w.write_all(gram.as_bytes())
            .map_err(|e| Error::from_reason(format!("Failed to write gram table: {e}")))?;
        running_offset += encoded.len() as u64;
    }

    // Postings data
    for encoded in &encoded_postings {
        w.write_all(encoded)
            .map_err(|e| Error::from_reason(format!("Failed to write postings: {e}")))?;
    }

    // Weights
    for weight in &weights {
        w.write_all(&weight.to_le_bytes())
            .map_err(|e| Error::from_reason(format!("Failed to write weights: {e}")))?;
    }

    w.flush()
        .map_err(|e| Error::from_reason(format!("Failed to flush chunk gram index: {e}")))?;

    Ok(ChunkGramBuildResult {
        chunks_indexed: chunk_entries.len() as u32,
        grams: gram_names.len() as u32,
        postings: total_postings,
    })
}

// ============================================================================
// Query (NAPI class, mmapped)
// ============================================================================

#[napi]
pub struct NativeChunkGramIndex {
    mmap: Mmap,
    header: Header,
    chunks: Vec<ChunkEntry>,
    grams: SortedGramTable,
    weights: Vec<f32>,
}

#[napi]
impl NativeChunkGramIndex {
    #[napi(factory)]
    pub fn load(path: String) -> Result<Self> {
        let file = File::open(&path)
            .map_err(|e| Error::from_reason(format!("Failed to open chunk gram index {path}: {e}")))?;
        let mmap = unsafe { Mmap::map(&file) }
            .map_err(|e| Error::from_reason(format!("Failed to mmap chunk gram index {path}: {e}")))?;

        let header = parse_header(&mmap)?;
        if header.version != VERSION {
            return Err(Error::from_reason(format!(
                "Unsupported chunk gram index version {}",
                header.version
            )));
        }

        let chunks = parse_chunk_table(&mmap, &header)?;
        let grams = parse_gram_table(&mmap, &header)?;
        let weights = parse_weights(&mmap, &header)?;

        Ok(Self {
            mmap,
            header,
            chunks,
            grams,
            weights,
        })
    }

    /// Query the chunk gram index with literal substrings extracted from a regex.
    ///
    /// Returns chunk ranges that contain ALL given literals (AND semantics within
    /// a clause). The caller intersects across OR-clauses if needed.
    #[napi]
    pub fn query_literals(
        &self,
        literals: Vec<String>,
        max_candidates: Option<u32>,
    ) -> Result<ChunkGramQueryResult> {
        if literals.is_empty() {
            return Ok(ChunkGramQueryResult {
                eligible: false,
                chunk_ids: Vec::new(),
                grams_used: 0,
                total_chunks: self.header.total_chunks,
                candidate_chunks: 0,
            });
        }

        let mut total_grams_used = 0u32;
        let mut combined: Option<Vec<u32>> = None;

        for literal in &literals {
            let normalized = match normalize_literal(literal) {
                Some(v) => v,
                None => {
                    return Ok(ChunkGramQueryResult {
                        eligible: false,
                        chunk_ids: Vec::new(),
                        grams_used: 0,
                        total_chunks: self.header.total_chunks,
                        candidate_chunks: 0,
                    });
                }
            };

            let mut grams = extract_covering_grams(&normalized, &self.weights);
            if grams.is_empty() {
                return Ok(ChunkGramQueryResult {
                    eligible: false,
                    chunk_ids: Vec::new(),
                    grams_used: 0,
                    total_chunks: self.header.total_chunks,
                    candidate_chunks: 0,
                });
            }

            // Sort by posting count (ascending) for early termination
            grams.sort_by(|a, b| {
                let ac = self.grams.get(*a).map(|d| d.postings_count).unwrap_or(u32::MAX);
                let bc = self.grams.get(*b).map(|d| d.postings_count).unwrap_or(u32::MAX);
                ac.cmp(&bc)
            });

            total_grams_used += grams.len() as u32;

            let mut literal_candidates: Option<Vec<u32>> = None;
            for gram in &grams {
                let Some(desc) = self.grams.get(*gram) else {
                    // Gram not in index → no chunks match
                    return Ok(ChunkGramQueryResult {
                        eligible: true,
                        chunk_ids: Vec::new(),
                        grams_used: total_grams_used,
                        total_chunks: self.header.total_chunks,
                        candidate_chunks: 0,
                    });
                };

                let posting = self.load_posting(desc)?;
                literal_candidates = Some(match literal_candidates {
                    Some(existing) => intersect_sorted(&existing, &posting),
                    None => posting,
                });

                if literal_candidates.as_ref().is_some_and(|v| v.is_empty()) {
                    break;
                }
            }

            let literal_candidates = literal_candidates.unwrap_or_default();
            combined = Some(match combined {
                Some(existing) => intersect_sorted(&existing, &literal_candidates),
                None => literal_candidates,
            });

            if combined.as_ref().is_some_and(|v| v.is_empty()) {
                break;
            }
        }

        let mut chunk_ids_raw = combined.unwrap_or_default();
        if let Some(limit) = max_candidates.filter(|l| *l > 0) {
            chunk_ids_raw.truncate(limit as usize);
        }

        let chunk_hits: Vec<ChunkGramQueryHit> = chunk_ids_raw
            .iter()
            .filter_map(|&cid| {
                self.chunks.get(cid as usize).map(|e| ChunkGramQueryHit {
                    file: e.file_path.clone(),
                    start_line: e.start_line,
                    end_line: e.end_line,
                    chunk_id: cid,
                })
            })
            .collect();

        let candidate_count = chunk_hits.len() as u32;

        Ok(ChunkGramQueryResult {
            eligible: true,
            chunk_ids: chunk_hits,
            grams_used: total_grams_used,
            total_chunks: self.header.total_chunks,
            candidate_chunks: candidate_count,
        })
    }

    #[napi]
    pub fn get_stats(&self) -> ChunkGramIndexStats {
        ChunkGramIndexStats {
            total_chunks: self.header.total_chunks,
            grams: self.header.gram_count,
            postings: self.header.total_postings,
        }
    }

    /// All-in-one chunk search pipeline: query → group by file → merge
    /// adjacent ranges → mmap + verify regex → return verified chunks.
    ///
    /// Single NAPI crossing. Does everything the JS pipeline did (chunk gram
    /// query, file read, regex verify) but without intermediate serialization.
    ///
    /// Cost model: returns `eligible: false` when candidates are too broad.
    /// Otherwise, merges adjacent chunk ranges per file (within `merge_gap`
    /// lines), reads each file once via mmap, verifies regex only on merged
    /// windows, and maps matches back to original chunk IDs.
    #[napi]
    pub fn search(
        &self,
        pattern: String,
        project_root: String,
        literals: Vec<String>,
        case_insensitive: Option<bool>,
        max_ratio: Option<f64>,
        max_files: Option<u32>,
    ) -> Result<ChunkGramSearchResult> {
        use crate::native_grep::{build_regex, read_file_content};
        use rayon::prelude::*;

        let start = std::time::Instant::now();
        let max_ratio = max_ratio.unwrap_or(0.20) as f32;
        // Cost model: native chunk verifier beats rg when files ≤ ~300.
        // Above that, rg's mmap + SIMD pipeline is faster.
        let max_files = max_files.unwrap_or(300);

        // 1. Query posting lists (same as query_literals but keep chunk IDs)
        if literals.is_empty() {
            return Ok(ChunkGramSearchResult::ineligible("no_literals", start));
        }

        let mut combined: Option<Vec<u32>> = None;
        for literal in &literals {
            let normalized = match normalize_literal(literal) {
                Some(v) => v,
                None => return Ok(ChunkGramSearchResult::ineligible("unnormalizable_literal", start)),
            };
            let grams = extract_covering_grams(&normalized, &self.weights);
            if grams.is_empty() {
                return Ok(ChunkGramSearchResult::ineligible("no_grams", start));
            }
            let mut literal_cands: Option<Vec<u32>> = None;
            for gram in &grams {
                let Some(desc) = self.grams.get(*gram) else {
                    return Ok(ChunkGramSearchResult {
                        eligible: true,
                        reason: String::from("empty"),
                        verified: Vec::new(),
                        total_chunks: self.header.total_chunks,
                        candidate_chunks: 0,
                        files_read: 0,
                        elapsed_us: start.elapsed().as_micros() as u32,
                    });
                };
                let posting = self.load_posting(desc)?;
                literal_cands = Some(match literal_cands {
                    Some(existing) => intersect_sorted(&existing, &posting),
                    None => posting,
                });
                if literal_cands.as_ref().is_some_and(|v| v.is_empty()) { break; }
            }
            let literal_cands = literal_cands.unwrap_or_default();
            combined = Some(match combined {
                Some(existing) => intersect_sorted(&existing, &literal_cands),
                None => literal_cands,
            });
            if combined.as_ref().is_some_and(|v| v.is_empty()) { break; }
        }
        let candidate_ids = combined.unwrap_or_default();
        let candidate_count = candidate_ids.len() as u32;

        // 2. Ratio gate (cheap — no file I/O)
        let ratio = if self.header.total_chunks > 0 {
            candidate_count as f32 / self.header.total_chunks as f32
        } else { 1.0 };
        if ratio > max_ratio {
            return Ok(ChunkGramSearchResult::ineligible("too_broad_ratio", start));
        }

        // Group candidates by file, sort + merge ranges
        let mut file_groups: HashMap<&str, Vec<(u32, u32, u32)>> = HashMap::new();
        for &cid in &candidate_ids {
            if let Some(entry) = self.chunks.get(cid as usize) {
                file_groups.entry(&entry.file_path)
                    .or_default()
                    .push((entry.start_line, entry.end_line, cid));
            }
        }

        if file_groups.len() as u32 > max_files {
            return Ok(ChunkGramSearchResult::ineligible("too_many_files", start));
        }

        // Pre-merge ranges per file and estimate total lines to verify.
        // This is the byte-cost planner: compare merged-line-count against
        // a rough estimate of what rg would scan (all lines in all corpus
        // files). If merged lines exceed 30% of estimated rg work, bail —
        // rg's SIMD pipeline will be faster on the full tree.
        let mut file_merged: Vec<(&str, Vec<MergedWindow>)> = Vec::with_capacity(file_groups.len());
        let mut total_merged_lines = 0u64;
        for (file, mut chunks_in_file) in file_groups {
            chunks_in_file.sort_by_key(|c| c.0);
            let merged = merge_ranges(&chunks_in_file, 3);
            for w in &merged {
                total_merged_lines += (w.end_line.saturating_sub(w.start_line) + 1) as u64;
            }
            file_merged.push((file, merged));
        }

        // Cost model: estimate rg scans ~30 lines/µs on this machine (SIMD).
        // Native chunk verifier scans ~5 lines/µs (no SIMD, per-line regex).
        // Break-even: chunk_lines < rg_lines * (5/30) ≈ rg_lines * 0.17.
        // Rough rg_lines ≈ total_corpus_files * avg_lines_per_file.
        // With 10K files × 200 avg lines = 2M lines, 17% = 340K lines.
        // But we also pay file-open overhead (~50µs per file).
        // Simpler heuristic: bail if merged lines > 100K.
        let max_merged_lines = 100_000u64;
        if total_merged_lines > max_merged_lines {
            return Ok(ChunkGramSearchResult::ineligible("too_many_lines", start));
        }

        // 3. Build regex
        let re = build_regex(&pattern, case_insensitive.unwrap_or(false))?;
        let root = std::path::PathBuf::from(&project_root);

        // 4. Parallel byte-offset verification: read each file via mmap,
        //    build a line-start offset table with a single newline scan,
        //    then verify only the byte windows covered by merged ranges.
        let files_read = file_merged.len() as u32;

        let verified: Vec<VerifiedChunk> = file_merged
            .par_iter()
            .flat_map(|(file, merged_windows)| {
                let path = root.join(file);
                let content = match read_file_content(&path) {
                    Some(c) => c,
                    None => return Vec::new(),
                };
                let text = content.as_str();
                let bytes = text.as_bytes();

                // Build line-start byte offset table: line_offsets[i] is the
                // byte offset where 0-indexed line i begins. Single pass over
                // the file's bytes — O(file_size) but touches each byte once
                // (cache-friendly sequential scan, no allocation per line).
                let mut line_offsets: Vec<usize> = Vec::with_capacity(bytes.len() / 40 + 1);
                line_offsets.push(0);
                for (i, &b) in bytes.iter().enumerate() {
                    if b == b'\n' && i + 1 < bytes.len() {
                        line_offsets.push(i + 1);
                    }
                }
                let total_lines = line_offsets.len();

                let mut results = Vec::new();
                for window in merged_windows {
                    let w_start = (window.start_line.saturating_sub(1)) as usize;
                    let w_end = (window.end_line as usize).min(total_lines);
                    if w_start >= total_lines || w_start >= w_end { continue; }

                    // For each line in the window, get its byte slice and test regex.
                    // No allocation — we index directly into the mmap'd bytes.
                    for line_idx in w_start..w_end {
                        let line_start = line_offsets[line_idx];
                        let line_end = if line_idx + 1 < line_offsets.len() {
                            // Trim trailing \n (and \r\n)
                            let next = line_offsets[line_idx + 1];
                            let mut end = next.saturating_sub(1);
                            if end > line_start && bytes.get(end.wrapping_sub(1)) == Some(&b'\r') {
                                end -= 1;
                            }
                            end
                        } else {
                            bytes.len()
                        };

                        if line_start >= line_end { continue; }
                        let line_str = match std::str::from_utf8(&bytes[line_start..line_end]) {
                            Ok(s) => s,
                            Err(_) => continue,
                        };

                        if !re.is_match(line_str) { continue; }
                        let line_num = (line_idx + 1) as u32;

                        // Attribute match to containing original chunk(s)
                        for &(s, e, cid) in &window.original_chunks {
                            if line_num >= s && line_num <= e {
                                if let Some(existing) = results.iter_mut().find(|r: &&mut VerifiedChunk| r.chunk_id == cid) {
                                    existing.match_count += 1;
                                } else {
                                    results.push(VerifiedChunk {
                                        file: file.to_string(),
                                        start_line: s,
                                        end_line: e,
                                        chunk_id: cid,
                                        match_count: 1,
                                    });
                                }
                            }
                        }
                    }
                }
                results
            })
            .collect();

        Ok(ChunkGramSearchResult {
            eligible: true,
            reason: String::from("ok"),
            verified,
            total_chunks: self.header.total_chunks,
            candidate_chunks: candidate_count,
            files_read,
            elapsed_us: start.elapsed().as_micros() as u32,
        })
    }

    fn load_posting(&self, desc: &GramDescriptor) -> Result<Vec<u32>> {
        let data = self.slice(desc.data_offset, desc.data_len as usize)?;
        Ok(decode_varint_delta(data))
    }

    fn slice(&self, offset: u64, len: usize) -> Result<&[u8]> {
        let start = offset as usize;
        let end = start.saturating_add(len);
        self.mmap.get(start..end).ok_or_else(|| {
            Error::from_reason(format!(
                "Chunk gram index slice out of bounds: offset={offset} len={len}"
            ))
        })
    }
}

// ============================================================================
// Binary format I/O
// ============================================================================

fn encoded_header_size() -> usize {
    // MAGIC(8) + version(4) + total_chunks(4) + gram_count(4) + total_postings(4)
    // + chunk_table_offset(8) + gram_table_offset(8) + data_offset(8) + weights_offset(8)
    8 + (4 * 4) + (4 * 8)
}

fn write_header(w: &mut BufWriter<File>, h: &Header) -> Result<()> {
    w.write_all(MAGIC).map_err(|e| Error::from_reason(format!("header write: {e}")))?;
    write_u32(w, h.version)?;
    write_u32(w, h.total_chunks)?;
    write_u32(w, h.gram_count)?;
    write_u32(w, h.total_postings)?;
    write_u64(w, h.chunk_table_offset)?;
    write_u64(w, h.gram_table_offset)?;
    write_u64(w, h.data_offset)?;
    write_u64(w, h.weights_offset)?;
    Ok(())
}

fn parse_header(bytes: &[u8]) -> Result<Header> {
    let mut c = 0usize;
    let magic = read_bytes(bytes, &mut c, 8)?;
    if magic != MAGIC {
        return Err(Error::from_reason("Invalid chunk gram index magic header"));
    }
    Ok(Header {
        version: read_u32(bytes, &mut c)?,
        total_chunks: read_u32(bytes, &mut c)?,
        gram_count: read_u32(bytes, &mut c)?,
        total_postings: read_u32(bytes, &mut c)?,
        chunk_table_offset: read_u64(bytes, &mut c)?,
        gram_table_offset: read_u64(bytes, &mut c)?,
        data_offset: read_u64(bytes, &mut c)?,
        weights_offset: read_u64(bytes, &mut c)?,
    })
}

fn parse_chunk_table(bytes: &[u8], header: &Header) -> Result<Vec<ChunkEntry>> {
    let mut c = header.chunk_table_offset as usize;
    let mut chunks = Vec::with_capacity(header.total_chunks as usize);

    for _ in 0..header.total_chunks {
        let path_len = read_u32(bytes, &mut c)? as usize;
        let start_line = read_u32(bytes, &mut c)?;
        let end_line = read_u32(bytes, &mut c)?;
        let path_bytes = read_bytes(bytes, &mut c, path_len)?;
        let file_path = String::from_utf8(path_bytes.to_vec())
            .map_err(|e| Error::from_reason(format!("Invalid UTF-8 in chunk gram path: {e}")))?;
        chunks.push(ChunkEntry {
            file_path,
            start_line,
            end_line,
        });
    }

    Ok(chunks)
}

fn parse_gram_table(bytes: &[u8], header: &Header) -> Result<SortedGramTable> {
    let mut c = header.gram_table_offset as usize;
    let mut grams = SortedGramTable::with_capacity(header.gram_count as usize);

    for _ in 0..header.gram_count {
        let gram_len = read_u16(bytes, &mut c)? as usize;
        let postings_count = read_u32(bytes, &mut c)?;
        let data_len = read_u32(bytes, &mut c)?;
        let data_offset = read_u64(bytes, &mut c)?;
        let gram_bytes = read_bytes(bytes, &mut c, gram_len)?;
        let gram = String::from_utf8(gram_bytes.to_vec())
            .map_err(|e| Error::from_reason(format!("Invalid UTF-8 in chunk gram key: {e}")))?;
        grams.push(
            gram,
            GramDescriptor {
                data_offset,
                data_len,
                postings_count,
            },
        );
    }

    Ok(grams)
}

fn parse_weights(bytes: &[u8], header: &Header) -> Result<Vec<f32>> {
    let start = header.weights_offset as usize;
    let end = start + (WEIGHT_TABLE_LEN * 4);
    let weight_bytes = bytes
        .get(start..end)
        .ok_or_else(|| Error::from_reason("Chunk gram weight table out of bounds"))?;
    let mut weights = Vec::with_capacity(WEIGHT_TABLE_LEN);
    for chunk in weight_bytes.chunks_exact(4) {
        weights.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
    }
    Ok(weights)
}

// ============================================================================
// Varint delta encoding (same scheme as sparse_gram.rs sparse postings)
// ============================================================================

fn encode_varint_delta(sorted_ids: &[u32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(sorted_ids.len() * 2);
    let mut prev = 0u32;
    for (i, &val) in sorted_ids.iter().enumerate() {
        let delta = if i == 0 { val } else { val - prev };
        encode_varint(delta, &mut out);
        prev = val;
    }
    out
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

fn decode_varint_delta(bytes: &[u8]) -> Vec<u32> {
    let mut ids = Vec::new();
    let mut i = 0usize;
    let mut prev = 0u32;
    while i < bytes.len() {
        let mut shift = 0u32;
        let mut value = 0u32;
        loop {
            if i >= bytes.len() {
                return ids;
            }
            let byte = bytes[i];
            i += 1;
            value |= ((byte & 0x7F) as u32) << shift;
            if byte & 0x80 == 0 {
                break;
            }
            shift += 7;
            if shift >= 35 {
                return ids;
            }
        }
        let current = if ids.is_empty() { value } else { prev + value };
        ids.push(current);
        prev = current;
    }
    ids
}

// ============================================================================
// Helpers
// ============================================================================

fn intersect_sorted(a: &[u32], b: &[u32]) -> Vec<u32> {
    let mut out = Vec::with_capacity(a.len().min(b.len()));
    let (mut ai, mut bi) = (0, 0);
    while ai < a.len() && bi < b.len() {
        match a[ai].cmp(&b[bi]) {
            std::cmp::Ordering::Less => ai += 1,
            std::cmp::Ordering::Greater => bi += 1,
            std::cmp::Ordering::Equal => {
                out.push(a[ai]);
                ai += 1;
                bi += 1;
            }
        }
    }
    out
}

fn write_u16(w: &mut BufWriter<File>, v: u16) -> Result<()> {
    w.write_all(&v.to_le_bytes())
        .map_err(|e| Error::from_reason(format!("chunk gram write: {e}")))
}

fn write_u32(w: &mut BufWriter<File>, v: u32) -> Result<()> {
    w.write_all(&v.to_le_bytes())
        .map_err(|e| Error::from_reason(format!("chunk gram write: {e}")))
}

fn write_u64(w: &mut BufWriter<File>, v: u64) -> Result<()> {
    w.write_all(&v.to_le_bytes())
        .map_err(|e| Error::from_reason(format!("chunk gram write: {e}")))
}

fn read_bytes<'a>(bytes: &'a [u8], cursor: &mut usize, len: usize) -> Result<&'a [u8]> {
    let start = *cursor;
    let end = start.saturating_add(len);
    let slice = bytes.get(start..end).ok_or_else(|| {
        Error::from_reason(format!("Chunk gram index truncated at {start}..{end}"))
    })?;
    *cursor = end;
    Ok(slice)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn varint_roundtrip() {
        let ids = vec![0, 1, 5, 100, 1000, 65535];
        let encoded = encode_varint_delta(&ids);
        let decoded = decode_varint_delta(&encoded);
        assert_eq!(ids, decoded);
    }

    #[test]
    fn intersect_sorted_basic() {
        assert_eq!(intersect_sorted(&[1, 3, 5, 7], &[2, 3, 5, 8]), vec![3, 5]);
        assert_eq!(intersect_sorted(&[1, 2, 3], &[4, 5, 6]), Vec::<u32>::new());
        assert_eq!(intersect_sorted(&[], &[1, 2]), Vec::<u32>::new());
    }
}
