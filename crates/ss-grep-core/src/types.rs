//! Shared data shapes, named and spelled as the JS objects they mirror (serde camelCase, so a
//! JSON dump of the JS object deserializes into them for the parity tests).

use serde::{Deserialize, Serialize};

/// One bareGrep result row (core/search/search-pattern-chunks.js buildBareGrepResults), with
/// the fields ss-grep's line classes stamp on it (core/search/grep-line-classes.js).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrepRow {
    pub file: String,
    pub line: u32,
    #[serde(default)]
    pub column: u32,
    #[serde(default)]
    pub match_text: String,
    #[serde(default)]
    pub content: String,
    /// stampGrepLineClasses: the row's class (0 = declaration ... ), absent = not stamped.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_class: Option<i64>,
    /// stampGrepLineClasses: index of the innermost enclosing symbol of the file, or -1.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_symbol: Option<i64>,
    /// stampDefinitionRows: the row defines the pattern's identifier.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub defines: bool,
}

/// fileSummary.files[i] (applyGrepFileDiversity / selectGrepFilesByWeight).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryFile {
    pub file: String,
    pub total: u64,
    pub kept: u64,
    /// 1, 0.5 or 0.25 under the weighted rule; absent under the legacy walk.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prior: Option<f64>,
}

/// fileSummary.hiddenSample[i].
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HiddenFile {
    pub file: String,
    pub total: u64,
}

/// bareGrep's fileSummary.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSummary {
    pub files: Vec<SummaryFile>,
    pub hidden_file_count: u64,
    pub hidden_match_count: u64,
    pub hidden_sample: Vec<HiddenFile>,
    /// "weight" under the weighted rule.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<String>,
    /// "sat2" when ranked by hits / (hits + 2) x prior.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weight: Option<String>,
}
