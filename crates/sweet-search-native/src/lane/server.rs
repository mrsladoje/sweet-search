//! The lane's Unix socket: one call per connection, answered on the lane thread.

use super::{run_call, Lane, Outcome};
use std::io::{Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// Requests above this are declined unread (the JS route allows 1 MiB as well).
const MAX_REQUEST: usize = 1024 * 1024;

pub(crate) struct Handle {
    pub lane: Arc<Lane>,
    stop: Arc<AtomicBool>,
    path: String,
}

impl Handle {
    pub fn stop(self) {
        self.stop.store(true, Ordering::SeqCst);
        // Wake the accept loop so it sees the flag.
        let _ = UnixStream::connect(&self.path);
        let _ = std::fs::remove_file(&self.path);
    }
}

pub(crate) fn start(path: &str, lane: Arc<Lane>) -> std::io::Result<Handle> {
    let _ = std::fs::remove_file(path);
    let listener = UnixListener::bind(path)?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))?;
    let stop = Arc::new(AtomicBool::new(false));
    let (stop_t, lane_t) = (stop.clone(), lane.clone());
    std::thread::Builder::new()
        .name("sweet-grep-lane".into())
        .spawn(move || {
            for conn in listener.incoming() {
                if stop_t.load(Ordering::SeqCst) {
                    break;
                }
                if let Ok(stream) = conn {
                    serve(&lane_t, stream);
                }
            }
        })?;
    Ok(Handle { lane, stop, path: path.to_string() })
}

fn serve(lane: &Lane, mut s: UnixStream) {
    // The lane answers one connection at a time: a client that stalls must not hold it.
    let _ = s.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = s.set_write_timeout(Some(Duration::from_secs(5)));
    let mut len = [0u8; 4];
    if s.read_exact(&mut len).is_err() {
        return;
    }
    let n = u32::from_be_bytes(len) as usize;
    let outcome = if n > MAX_REQUEST {
        Outcome::Decline("request too large")
    } else {
        let mut buf = vec![0u8; n];
        if s.read_exact(&mut buf).is_err() {
            return;
        }
        run_call(lane, &buf)
    };
    match outcome {
        Outcome::Answer { code, stdout, receipt } => {
            // The receipt is queued before the answer leaves, so no later call can get ahead of it.
            if let Some(r) = receipt {
                super::push_receipt(r);
            }
            if let Ok(mut c) = lane.counters.lock() {
                c.handled += 1;
            }
            let mut out = Vec::with_capacity(9 + stdout.len());
            out.push(b'H');
            out.extend_from_slice(&code.to_be_bytes());
            out.extend_from_slice(&(stdout.len() as u32).to_be_bytes());
            out.extend_from_slice(stdout.as_bytes());
            let _ = s.write_all(&out);
        }
        Outcome::Decline(_) => {
            if let Ok(mut c) = lane.counters.lock() {
                c.declined += 1;
            }
            let _ = s.write_all(b"D");
        }
    }
}
