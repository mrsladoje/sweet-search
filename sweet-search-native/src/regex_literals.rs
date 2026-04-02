use napi::bindgen_prelude::*;
use napi_derive::napi;
use regex_syntax::hir::{Hir, HirKind};
use regex_syntax::ParserBuilder;

#[napi(object)]
pub struct RegexLiteralExtractionResult {
    pub clauses: Vec<Vec<String>>,
}

#[napi]
pub fn extract_regex_literals(regex: String) -> Result<RegexLiteralExtractionResult> {
    let hir = ParserBuilder::new()
        .build()
        .parse(&regex)
        .map_err(|err| Error::from_reason(format!("Failed to parse regex: {err}")))?;

    let clauses = extract_dnf(&hir)
        .map(normalize_clauses)
        .unwrap_or_default();

    Ok(RegexLiteralExtractionResult { clauses })
}

fn extract_dnf(hir: &Hir) -> Option<Vec<Vec<String>>> {
    match hir.kind() {
        HirKind::Empty | HirKind::Class(_) | HirKind::Look(_) => None,
        HirKind::Literal(literal) => literal_to_clause(literal.0.as_ref()),
        HirKind::Capture(capture) => extract_dnf(&capture.sub),
        HirKind::Repetition(_) => None,
        HirKind::Concat(parts) => {
            let mut clauses = vec![Vec::<String>::new()];
            let mut saw_constraint = false;

            for part in parts {
                let Some(part_clauses) = extract_dnf(part) else {
                    continue;
                };
                if part_clauses.is_empty() {
                    continue;
                }
                saw_constraint = true;
                clauses = and_product(&clauses, &part_clauses);
            }

            if saw_constraint { Some(clauses) } else { None }
        }
        HirKind::Alternation(parts) => {
            let mut out = Vec::new();
            for part in parts {
                let Some(part_clauses) = extract_dnf(part) else {
                    return None;
                };
                if part_clauses.is_empty() {
                    return None;
                }
                out.extend(part_clauses);
            }
            if out.is_empty() { None } else { Some(out) }
        }
    }
}

fn literal_to_clause(bytes: &[u8]) -> Option<Vec<Vec<String>>> {
    let literal = String::from_utf8_lossy(bytes).to_string();
    if literal.trim().is_empty() {
        return None;
    }
    Some(vec![vec![literal]])
}

fn and_product(left: &[Vec<String>], right: &[Vec<String>]) -> Vec<Vec<String>> {
    let mut out = Vec::new();
    for left_clause in left {
        for right_clause in right {
            let mut combined = Vec::with_capacity(left_clause.len() + right_clause.len());
            combined.extend(left_clause.iter().cloned());
            combined.extend(right_clause.iter().cloned());
            out.push(combined);
        }
    }
    out
}

fn normalize_clauses(clauses: Vec<Vec<String>>) -> Vec<Vec<String>> {
    let mut normalized = Vec::new();

    for clause in clauses {
        let mut deduped = Vec::new();
        for literal in clause {
            let trimmed = literal.trim();
            if trimmed.len() < 3 {
                continue;
            }
            if deduped.iter().any(|existing: &String| existing == trimmed) {
                continue;
            }
            deduped.push(trimmed.to_string());
        }
        if deduped.is_empty() {
            continue;
        }
        if normalized.iter().any(|existing| existing == &deduped) {
            continue;
        }
        normalized.push(deduped);
    }

    normalized
}
