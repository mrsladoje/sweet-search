use crate::batch_transport::post_json;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashSet;
use std::io::{self, Write};
const MAX_REQUEST_BYTES: usize = 64 * 1024;
const MIN_MAX_CHARS: u32 = 1_024;
const MAX_MAX_CHARS: u32 = 64_000;
const MAX_OPERATION_ID_BYTES: usize = 32;
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct BatchRequest {
    #[serde(default = "default_version")]
    version: u32,
    operations: Vec<BatchOperation>,
    #[serde(default)]
    max_chars: Option<u32>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct BatchOperation {
    id: String,
    tool: BatchTool,
    args: Map<String, Value>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum BatchTool {
    Search,
    Grep,
    Find,
    Read,
    Semantic,
    Trace,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WireRequest<'a> {
    version: u32,
    operations: &'a [BatchOperation],
    #[serde(skip_serializing_if = "Option::is_none")]
    max_chars: Option<u32>,
    project_root: &'a str,
}
fn default_version() -> u32 {
    1
}
fn usage(prog: &str) -> String {
    format!(
        "Usage: {prog} batch '<JSON>'\n\
         \n\
         JSON: {{\"version\":1,\"operations\":[{{\"id\":\"s1\",\"tool\":\"search\",\"args\":{{...}}}}, ...],\"maxChars\":12000}}\n\
         Exactly 2-3 operations are required; version defaults to 1; maxChars is 1024-64000.\n\
         sweet-search-batch-protocol=1"
    )
}
fn parse_invocation(args: &[String]) -> Result<Option<BatchRequest>, String> {
    match args {
        [arg] if arg == "--help" => Ok(None),
        [arg] => parse_request(arg).map(Some),
        _ => Err("expected exactly one JSON argument (or --help)".to_string()),
    }
}
fn parse_request(raw: &str) -> Result<BatchRequest, String> {
    if raw.len() > MAX_REQUEST_BYTES {
        return Err(format!(
            "batch JSON exceeds the {MAX_REQUEST_BYTES}-byte limit"
        ));
    }

    let request: BatchRequest =
        serde_json::from_str(raw).map_err(|error| format!("invalid batch JSON: {error}"))?;
    validate_request(&request)?;
    Ok(request)
}
fn validate_request(request: &BatchRequest) -> Result<(), String> {
    if request.version != 1 {
        return Err("batch version must be 1".to_string());
    }
    if !(2..=3).contains(&request.operations.len()) {
        return Err("batch requires exactly 2-3 operations".to_string());
    }
    if request
        .max_chars
        .is_some_and(|value| !(MIN_MAX_CHARS..=MAX_MAX_CHARS).contains(&value))
    {
        return Err(format!(
            "maxChars must be an integer from {MIN_MAX_CHARS} through {MAX_MAX_CHARS}"
        ));
    }

    let mut ids = HashSet::with_capacity(request.operations.len());
    for operation in &request.operations {
        if !valid_operation_id(&operation.id) {
            return Err("operation id must match ^[A-Za-z][A-Za-z0-9_-]{0,31}$".to_string());
        }
        if !ids.insert(operation.id.as_str()) {
            return Err(format!("duplicate operation id: {}", operation.id));
        }
    }
    for operation in &request.operations {
        validate_args(&Value::Object(operation.args.clone()), &ids)?;
    }
    Ok(())
}
fn valid_operation_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    (1..=MAX_OPERATION_ID_BYTES).contains(&bytes.len())
        && bytes[0].is_ascii_alphabetic()
        && bytes[1..]
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(*byte, b'_' | b'-'))
}
fn validate_args(value: &Value, ids: &HashSet<&str>) -> Result<(), String> {
    match value {
        Value::Object(fields) => {
            for (key, nested) in fields {
                if matches!(
                    key.as_str(),
                    "ref" | "$ref" | "fromOperation" | "from_operation"
                ) {
                    return Err("operation references are not accepted by this client".to_string());
                }
                validate_args(nested, ids)?;
            }
        }
        Value::Array(values) => {
            for nested in values {
                validate_args(nested, ids)?;
            }
        }
        Value::String(text) if contains_reference_token(text, ids) => {
            return Err(
                "operation references or placeholders are not accepted by this client".to_string(),
            );
        }
        _ => {}
    }
    Ok(())
}
fn contains_reference_token(text: &str, ids: &HashSet<&str>) -> bool {
    let delimited = |open: &str, close: &str| {
        text.find(open)
            .is_some_and(|start| text[start + open.len()..].contains(close))
    };
    delimited("${", "}")
        || delimited("{{", "}}")
        || ids.iter().any(|id| {
            let token = format!("${id}");
            text.match_indices(&token).any(|(start, _)| {
                match text[start + token.len()..].chars().next() {
                    None => true,
                    Some(next) => {
                        next.is_ascii_digit() || matches!(next, '.' | '[' | ':' | '{' | '_' | '-')
                    }
                }
            })
        })
}
fn wire_body(request: &BatchRequest, project_root: &str) -> Result<Vec<u8>, String> {
    let body = serde_json::to_vec(&WireRequest {
        version: request.version,
        operations: &request.operations,
        max_chars: request.max_chars,
        project_root,
    })
    .map_err(|error| format!("could not encode batch request: {error}"))?;
    if body.len() > MAX_REQUEST_BYTES {
        return Err(format!(
            "encoded batch request exceeds the {MAX_REQUEST_BYTES}-byte limit"
        ));
    }
    Ok(body)
}

fn render_success_body(body: &[u8]) -> Result<Vec<u8>, String> {
    let value: Value = serde_json::from_slice(body)
        .map_err(|error| format!("success response is not valid JSON: {error}"))?;
    let cli_output = value
        .as_object()
        .and_then(|object| object.get("cliOutput"))
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty())
        .ok_or_else(|| "success response is missing nonempty cliOutput".to_string())?;
    let had_trailing_newline = cli_output.ends_with(['\r', '\n']);
    let normalized = cli_output.trim_end_matches(['\r', '\n']);
    let mut output = normalized.as_bytes().to_vec();
    if had_trailing_newline {
        output.push(b'\n');
    }
    Ok(output)
}

fn response_output(status: u16, body: Vec<u8>) -> Result<Vec<u8>, String> {
    if status >= 400 {
        Ok(body)
    } else {
        render_success_body(&body)
    }
}

pub(super) fn run(prog: &str, args: &[String]) -> i32 {
    let request = match parse_invocation(args) {
        Ok(Some(request)) => request,
        Ok(None) => {
            println!("{}", usage(prog));
            return 0;
        }
        Err(error) => {
            eprintln!("Error: {error}\n\n{}", usage(prog));
            return 2;
        }
    };

    let project_root = super::resolve_project_root().to_string_lossy().into_owned();
    let body = match wire_body(&request, &project_root) {
        Ok(body) => body,
        Err(error) => {
            eprintln!("Error: {error}");
            return 2;
        }
    };
    let socket_path = match super::find_socket().or_else(super::auto_start_server) {
        Some(path) => path,
        None => return 1,
    };

    let (status, response_body) = match post_json(&socket_path, &body) {
        Ok(response) => response,
        Err(error) => {
            eprintln!("Batch request failed: {error}");
            return 1;
        }
    };
    let output_bytes = match response_output(status, response_body) {
        Ok(output) => output,
        Err(error) => {
            eprintln!("Batch response failed validation: {error}");
            return 1;
        }
    };
    let stdout = io::stdout();
    let mut output = stdout.lock();
    if let Err(error) = output.write_all(&output_bytes).and_then(|_| output.flush()) {
        eprintln!("Batch response write failed: {error}");
        return 1;
    }
    if status >= 400 {
        eprintln!("Batch request failed with HTTP {status}");
        1
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request_with(operations: &str) -> String {
        format!(r#"{{"operations":{operations}}}"#)
    }
    fn valid_operations() -> &'static str {
        r#"[{"id":"Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","tool":"search","args":{"query":"needle"}},{"id":"b_2-x","tool":"read","args":{"path":"src/lib.rs"}}]"#
    }

    #[test]
    fn invocation_requires_one_argument_and_supports_help() {
        assert!(parse_invocation(&["--help".into()]).unwrap().is_none());
        assert!(parse_invocation(&[]).is_err());
        assert!(parse_invocation(&["{}".into(), "extra".into()]).is_err());
        assert!(parse_request(&" ".repeat(MAX_REQUEST_BYTES + 1)).is_err());
        assert!(usage("sweet-search")
            .lines()
            .any(|line| line == "sweet-search-batch-protocol=1"));
    }
    #[test]
    fn accepts_default_version_bounds_and_allowlisted_tools() {
        let two = parse_request(&request_with(valid_operations())).unwrap();
        assert_eq!(two.version, 1);
        let three = request_with(
            r#"[{"id":"a","tool":"grep","args":{}},{"id":"b","tool":"find","args":{}},{"id":"c","tool":"semantic","args":{"custom":true}}]"#,
        );
        assert!(parse_request(&three).is_ok());
        let trace = request_with(
            r#"[{"id":"A","tool":"trace","args":{}},{"id":"b_2-x","tool":"search","args":{}}]"#,
        );
        assert!(parse_request(&trace).is_ok());
        for max_chars in [MIN_MAX_CHARS, MAX_MAX_CHARS] {
            let raw = format!(
                r#"{{"operations":{},"maxChars":{max_chars}}}"#,
                valid_operations()
            );
            assert!(parse_request(&raw).is_ok());
        }
    }
    #[test]
    fn rejects_version_operation_bounds_and_unknown_tool() {
        let wrong_version = format!(r#"{{"version":2,"operations":{}}}"#, valid_operations());
        assert!(parse_request(&wrong_version).is_err());
        assert!(parse_request(&request_with(r#"[{"id":"a","tool":"search","args":{}}]"#)).is_err());
        let four = request_with(
            r#"[{"id":"a","tool":"search","args":{}},{"id":"b","tool":"read","args":{}},{"id":"c","tool":"grep","args":{}},{"id":"d","tool":"find","args":{}}]"#,
        );
        assert!(parse_request(&four).is_err());
        let unknown = request_with(
            r#"[{"id":"a","tool":"shell","args":{}},{"id":"b","tool":"read","args":{}}]"#,
        );
        assert!(parse_request(&unknown).is_err());
    }

    #[test]
    fn rejects_unknown_fields_and_invalid_types() {
        let root_unknown = format!(
            r#"{{"operations":{},"projectRoot":"/tmp"}}"#,
            valid_operations()
        );
        assert!(parse_request(&root_unknown).is_err());
        let operation_unknown = request_with(
            r#"[{"id":"a","tool":"search","args":{},"extra":1},{"id":"b","tool":"read","args":{}}]"#,
        );
        assert!(parse_request(&operation_unknown).is_err());
        let args_array = request_with(
            r#"[{"id":"a","tool":"search","args":[]},{"id":"b","tool":"read","args":{}}]"#,
        );
        assert!(parse_request(&args_array).is_err());
        for max_chars in ["0", "1023", "64001", "1.5", "\"10\""] {
            let raw = format!(
                r#"{{"operations":{},"maxChars":{max_chars}}}"#,
                valid_operations()
            );
            assert!(parse_request(&raw).is_err());
        }
    }

    #[test]
    fn rejects_bad_ids_references_and_placeholders() {
        for first_id in ["", "1bad", "_bad", "bad.id", "bad id", "bad\\n"] {
            let raw = request_with(&format!(
                r#"[{{"id":"{first_id}","tool":"search","args":{{}}}},{{"id":"b","tool":"read","args":{{}}}}]"#
            ));
            assert!(parse_request(&raw).is_err());
        }
        let duplicate = request_with(
            r#"[{"id":"a","tool":"search","args":{}},{"id":"a","tool":"read","args":{}}]"#,
        );
        assert!(parse_request(&duplicate).is_err());
        let long_id = "x".repeat(MAX_OPERATION_ID_BYTES + 1);
        let long = request_with(&format!(
            r#"[{{"id":"{long_id}","tool":"search","args":{{}}}},{{"id":"b","tool":"read","args":{{}}}}]"#
        ));
        assert!(parse_request(&long).is_err());
        for args in [
            r#"{"nested":{"ref":"a"}}"#,
            r#"{"$ref":"a"}"#,
            r#"{"fromOperation":"a"}"#,
            r#"{"from_operation":"a"}"#,
            r#"{"path":"prefix ${a.output} suffix"}"#,
            r#"{"nested":[{"path":"prefix {{a}} suffix"}]}"#,
        ] {
            let raw = request_with(&format!(
                r#"[{{"id":"a","tool":"search","args":{args}}},{{"id":"b","tool":"read","args":{{}}}}]"#
            ));
            assert!(parse_request(&raw).is_err());
        }
        for suffix in ["", ".path", "[0]", ":x", "{x}", "_x", "-x", "2"] {
            let args = format!(r#"{{"path":"$b{suffix}"}}"#);
            let raw = request_with(&format!(
                r#"[{{"id":"a","tool":"search","args":{args}}},{{"id":"b","tool":"read","args":{{}}}}]"#
            ));
            assert!(parse_request(&raw).is_err());
        }
        let ordinary_dollars = request_with(
            r#"[{"id":"a","tool":"search","args":{"query":"^foo$ $open ${ {{"}},{"id":"b","tool":"read","args":{}}]"#,
        );
        assert!(parse_request(&ordinary_dollars).is_ok());
    }

    #[test]
    fn injects_project_root_and_emits_canonical_field_names() {
        let raw = format!(
            r#"{{"operations":{},"maxChars":12000}}"#,
            valid_operations()
        );
        let request = parse_request(&raw).unwrap();
        let body: Value =
            serde_json::from_slice(&wire_body(&request, "/project").unwrap()).unwrap();
        assert_eq!(body["version"], 1);
        assert_eq!(body["maxChars"], 12000);
        assert_eq!(body["projectRoot"], "/project");
        assert_eq!(body["operations"].as_array().unwrap().len(), 2);
        assert!(wire_body(&request, &"x".repeat(MAX_REQUEST_BYTES)).is_err());
    }

    #[test]
    fn renders_decoded_cli_output_with_at_most_one_trailing_newline() {
        let body = br#"{"cliOutput":"[one] status=ok\ncode();\n\n"}"#;
        assert_eq!(
            render_success_body(body).unwrap(),
            b"[one] status=ok\ncode();\n"
        );
        let no_newline = br#"{"cliOutput":"plain"}"#;
        assert_eq!(render_success_body(no_newline).unwrap(), b"plain");
    }

    #[test]
    fn rejects_malformed_success_json_but_preserves_http_error_bytes() {
        for body in [
            b"not json".as_slice(),
            br#"{}"#,
            br#"{"cliOutput":""}"#,
            br#"{"cliOutput":7}"#,
        ] {
            assert!(render_success_body(body).is_err());
        }
        let raw = b"{not-json}\0".to_vec();
        assert_eq!(response_output(422, raw.clone()).unwrap(), raw);
    }
}
