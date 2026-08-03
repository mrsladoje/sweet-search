use std::fs::{self, Metadata};
use std::io::{self, Read, Write};
use std::os::unix::fs::{FileTypeExt, MetadataExt};
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::time::Duration;

const IO_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_RESPONSE_HEADER_BYTES: usize = 64 * 1024;
const MAX_RESPONSE_BODY_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, PartialEq, Eq)]
struct ResponseHead {
    status: u16,
    content_length: Option<usize>,
}

fn invalid_data(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.into())
}

fn validate_socket_metadata(metadata: &Metadata, effective_uid: u32) -> io::Result<()> {
    if !metadata.file_type().is_socket() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "batch socket path is not an actual Unix socket",
        ));
    }
    if metadata.uid() != effective_uid {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "batch socket is not owned by the effective user",
        ));
    }
    Ok(())
}

fn validate_socket_path(socket_path: &str) -> io::Result<()> {
    let metadata = fs::symlink_metadata(Path::new(socket_path))?;
    // SAFETY: geteuid has no preconditions and does not dereference pointers.
    let effective_uid = unsafe { libc::geteuid() };
    validate_socket_metadata(&metadata, effective_uid)
}

fn parse_status_line(line: &str) -> io::Result<u16> {
    if line.contains(['\r', '\n']) {
        return Err(invalid_data("invalid HTTP status line"));
    }
    let mut fields = line.split_ascii_whitespace();
    let version = fields
        .next()
        .ok_or_else(|| invalid_data("missing HTTP version"))?;
    if !matches!(version, "HTTP/1.0" | "HTTP/1.1") {
        return Err(invalid_data("unsupported HTTP version"));
    }
    let code = fields
        .next()
        .ok_or_else(|| invalid_data("missing HTTP status"))?;
    if code.len() != 3 || !code.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(invalid_data("invalid HTTP status"));
    }
    let status: u16 = code
        .parse()
        .map_err(|_| invalid_data("invalid HTTP status"))?;
    if !(100..=599).contains(&status) {
        return Err(invalid_data("HTTP status is outside 100-599"));
    }
    Ok(status)
}

fn parse_content_length(value: &str) -> io::Result<usize> {
    let value = value.trim();
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(invalid_data("invalid Content-Length"));
    }
    let length = value
        .parse::<usize>()
        .map_err(|_| invalid_data("invalid Content-Length"))?;
    if length > MAX_RESPONSE_BODY_BYTES {
        return Err(invalid_data("HTTP response body exceeds 2 MiB limit"));
    }
    Ok(length)
}

fn parse_response_head(headers: &[u8]) -> io::Result<ResponseHead> {
    let text = std::str::from_utf8(headers)
        .map_err(|_| invalid_data("HTTP response headers are not UTF-8"))?;
    let mut lines = text.split("\r\n");
    let status = parse_status_line(
        lines
            .next()
            .ok_or_else(|| invalid_data("missing HTTP status line"))?,
    )?;
    let mut content_length = None;
    for line in lines {
        let (name, value) = line
            .split_once(':')
            .ok_or_else(|| invalid_data("malformed HTTP response header"))?;
        if name.is_empty() || name.trim() != name {
            return Err(invalid_data("malformed HTTP response header name"));
        }
        if name.eq_ignore_ascii_case("content-length") {
            if content_length.is_some() {
                return Err(invalid_data(
                    "multiple or conflicting Content-Length headers",
                ));
            }
            content_length = Some(parse_content_length(value)?);
        } else if name.eq_ignore_ascii_case("transfer-encoding") {
            let identity_only = value.split(',').all(|coding| {
                !coding.trim().is_empty() && coding.trim().eq_ignore_ascii_case("identity")
            });
            if !identity_only {
                return Err(invalid_data(
                    "non-identity Transfer-Encoding is unsupported",
                ));
            }
        }
    }
    Ok(ResponseHead {
        status,
        content_length,
    })
}

fn read_http_response<R: Read>(input: &mut R) -> io::Result<(u16, Vec<u8>)> {
    let mut buffer = [0u8; super::BUFFER_SIZE];
    let mut headers = Vec::new();
    let (head, initial_body) = loop {
        let read = input.read(&mut buffer)?;
        if read == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "response ended before HTTP headers",
            ));
        }
        headers.extend_from_slice(&buffer[..read]);
        if let Some(end) = super::find_header_end(&headers) {
            if end > MAX_RESPONSE_HEADER_BYTES {
                return Err(invalid_data("HTTP response headers exceed 64 KiB limit"));
            }
            let head = parse_response_head(&headers[..end])?;
            break (head, headers[end + 4..].to_vec());
        }
        if headers.len() > MAX_RESPONSE_HEADER_BYTES {
            return Err(invalid_data("HTTP response headers exceed 64 KiB limit"));
        }
    };

    let body = match head.content_length {
        Some(expected) => read_content_length_body(input, initial_body, expected)?,
        None => read_close_delimited_body(input, initial_body)?,
    };
    Ok((head.status, body))
}

fn read_content_length_body<R: Read>(
    input: &mut R,
    initial: Vec<u8>,
    expected: usize,
) -> io::Result<Vec<u8>> {
    let mut body = Vec::with_capacity(expected);
    body.extend_from_slice(&initial[..initial.len().min(expected)]);
    let mut buffer = [0u8; super::BUFFER_SIZE];
    while body.len() < expected {
        let remaining = expected - body.len();
        let limit = remaining.min(buffer.len());
        let read = input.read(&mut buffer[..limit])?;
        if read == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "response ended before Content-Length bytes arrived",
            ));
        }
        body.extend_from_slice(&buffer[..read]);
    }
    Ok(body)
}

fn read_close_delimited_body<R: Read>(input: &mut R, initial: Vec<u8>) -> io::Result<Vec<u8>> {
    if initial.len() > MAX_RESPONSE_BODY_BYTES {
        return Err(invalid_data("HTTP response body exceeds 2 MiB limit"));
    }
    let mut body = initial;
    let mut buffer = [0u8; super::BUFFER_SIZE];
    loop {
        let read = input.read(&mut buffer)?;
        if read == 0 {
            return Ok(body);
        }
        if body.len().saturating_add(read) > MAX_RESPONSE_BODY_BYTES {
            return Err(invalid_data("HTTP response body exceeds 2 MiB limit"));
        }
        body.extend_from_slice(&buffer[..read]);
    }
}

pub(super) fn post_json(socket_path: &str, body: &[u8]) -> io::Result<(u16, Vec<u8>)> {
    validate_socket_path(socket_path)?;
    let mut stream = UnixStream::connect(socket_path)?;
    stream.set_read_timeout(Some(IO_TIMEOUT))?;
    stream.set_write_timeout(Some(IO_TIMEOUT))?;
    let headers = format!(
        "POST /batch HTTP/1.0\r\n\
         Host: l\r\n\
         Content-Type: application/json\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(headers.as_bytes())?;
    stream.write_all(body)?;
    read_http_response(&mut stream)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Cursor;
    use std::os::unix::fs::symlink;
    use std::os::unix::net::UnixListener;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::thread;
    use std::time::{SystemTime, UNIX_EPOCH};

    static PATH_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temp_path(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let count = PATH_COUNTER.fetch_add(1, Ordering::Relaxed);
        PathBuf::from("/tmp").join(format!(
            "ss-batch-{label}-{}-{nonce}-{count}",
            std::process::id()
        ))
    }

    #[test]
    fn validates_socket_type_symlink_and_effective_uid() {
        let socket_path = temp_path("socket");
        let regular_path = temp_path("regular");
        let symlink_path = temp_path("symlink");
        let listener = UnixListener::bind(&socket_path).unwrap();
        File::create(&regular_path).unwrap();
        symlink(&socket_path, &symlink_path).unwrap();

        assert!(validate_socket_path(socket_path.to_str().unwrap()).is_ok());
        assert!(validate_socket_path(regular_path.to_str().unwrap()).is_err());
        assert!(validate_socket_path(symlink_path.to_str().unwrap()).is_err());
        let metadata = fs::symlink_metadata(&socket_path).unwrap();
        assert!(validate_socket_metadata(&metadata, metadata.uid().wrapping_add(1)).is_err());

        drop(listener);
        fs::remove_file(&symlink_path).unwrap();
        fs::remove_file(&regular_path).unwrap();
        fs::remove_file(&socket_path).unwrap();
    }

    fn response(bytes: Vec<u8>) -> io::Result<(u16, Vec<u8>)> {
        read_http_response(&mut Cursor::new(bytes))
    }

    #[test]
    fn rejects_malformed_http_versions_and_statuses() {
        for status in [
            "NOPE 200 OK",
            "HTTP/2 200 OK",
            "HTTP/1.1 0 Bad",
            "HTTP/1.1 000 Bad",
            "HTTP/1.1 600 Bad",
        ] {
            let bytes = format!("{status}\r\n\r\n").into_bytes();
            assert_eq!(
                response(bytes).unwrap_err().kind(),
                io::ErrorKind::InvalidData
            );
        }
    }

    #[test]
    fn honors_content_length_and_stops_before_extra_bytes() {
        let bytes = b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\nabcEXTRA".to_vec();
        assert_eq!(response(bytes).unwrap(), (200, b"abc".to_vec()));
    }

    #[test]
    fn rejects_short_conflicting_invalid_and_oversize_lengths() {
        let short = b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nabc".to_vec();
        assert_eq!(
            response(short).unwrap_err().kind(),
            io::ErrorKind::UnexpectedEof
        );
        for headers in [
            "Content-Length: 3\r\nContent-Length: 4",
            "Content-Length: nope",
            "Content-Length: 3, 3",
        ] {
            let bytes = format!("HTTP/1.1 200 OK\r\n{headers}\r\n\r\n").into_bytes();
            assert_eq!(
                response(bytes).unwrap_err().kind(),
                io::ErrorKind::InvalidData
            );
        }
        let bytes = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n",
            MAX_RESPONSE_BODY_BYTES + 1
        )
        .into_bytes();
        assert_eq!(
            response(bytes).unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
    }

    #[test]
    fn rejects_chunked_and_bounds_close_delimited_bodies() {
        let chunked =
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n0\r\n\r\n".to_vec();
        assert_eq!(
            response(chunked).unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
        let mut oversize = b"HTTP/1.0 200 OK\r\n\r\n".to_vec();
        oversize.resize(oversize.len() + MAX_RESPONSE_BODY_BYTES + 1, b'x');
        assert_eq!(
            response(oversize).unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
        let identity = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: identity\r\n\r\nabc".to_vec();
        assert_eq!(response(identity).unwrap(), (200, b"abc".to_vec()));
    }

    fn serve_once(response: Vec<u8>) -> (PathBuf, thread::JoinHandle<Vec<u8>>) {
        let path = temp_path("server");
        let listener = UnixListener::bind(&path).unwrap();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            let mut buffer = [0u8; 128];
            let header_end = loop {
                let read = stream.read(&mut buffer).unwrap();
                assert!(read > 0);
                request.extend_from_slice(&buffer[..read]);
                if let Some(end) = super::super::find_header_end(&request) {
                    break end;
                }
            };
            let headers = std::str::from_utf8(&request[..header_end]).unwrap();
            let content_length: usize = headers
                .lines()
                .find_map(|line| line.strip_prefix("Content-Length: "))
                .unwrap()
                .parse()
                .unwrap();
            let target = header_end + 4 + content_length;
            while request.len() < target {
                let read = stream.read(&mut buffer).unwrap();
                assert!(read > 0);
                request.extend_from_slice(&buffer[..read]);
            }
            stream.write_all(&response).unwrap();
            request
        });
        (path, handle)
    }

    #[test]
    fn posts_exact_json_framing_and_returns_success_body() {
        let response =
            b"HTTP/1.0 207 Multi-Status\r\nContent-Length: 9\r\n\r\n\0raw\nbody".to_vec();
        let (path, server) = serve_once(response);
        let request_body = br#"{"version":1}"#;
        let (status, body) = post_json(path.to_str().unwrap(), request_body).unwrap();
        let request = server.join().unwrap();
        fs::remove_file(&path).unwrap();

        let header_end = super::super::find_header_end(&request).unwrap();
        let headers = std::str::from_utf8(&request[..header_end]).unwrap();
        assert!(headers.starts_with("POST /batch HTTP/1.0\r\n"));
        assert!(headers.contains("\r\nContent-Type: application/json\r\n"));
        assert!(headers.contains(&format!("\r\nContent-Length: {}\r\n", request_body.len())));
        assert_eq!(&request[header_end + 4..], request_body);
        assert_eq!((status, body), (207, b"\0raw\nbody".to_vec()));
    }

    #[test]
    fn preserves_valid_http_error_body() {
        let response =
            b"HTTP/1.0 422 Unprocessable Entity\r\nContent-Length: 7\r\n\r\nproblem".to_vec();
        let (path, server) = serve_once(response);
        let result = post_json(path.to_str().unwrap(), b"{}").unwrap();
        server.join().unwrap();
        fs::remove_file(&path).unwrap();
        assert_eq!(result, (422, b"problem".to_vec()));
    }
}
