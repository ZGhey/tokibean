// Hook event receiver — the IO shell around the pure reducer.
//
// Claude Code's hooks POST event JSON to http://127.0.0.1:<port>/event. This module does only the
// things a pure function can't: read the socket, lock the state, fire notifications, emit to the
// frontend. Every decision about what an event MEANS lives in `reducer::apply_event`.

use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Instant;

use tauri::{AppHandle, Emitter};
use tiny_http::{Method, Response, Server};

use crate::reducer::{self, NotifyCfg};
use crate::state::{self, Shared};

pub fn run(app: AppHandle, shared: Arc<Shared>) {
    let (bind, port) = {
        let cfg = shared.cfg.lock().unwrap();
        (cfg.bind.clone(), cfg.port)
    };
    let server = match Server::http((bind.as_str(), port)) {
        Ok(s) => s,
        Err(e) => {
            eprintln!(
                "[claude-pet] hook server failed to start (port {} in use?): {}",
                port, e
            );
            return;
        }
    };
    println!("[claude-pet] hook server listening on {}:{}", bind, port);

    for mut request in server.incoming_requests() {
        let mut body = String::new();
        let _ = request.as_reader().read_to_string(&mut body);
        let ok = *request.method() == Method::Post;
        let _ = request.respond(Response::from_string("ok"));
        if !ok {
            continue;
        }
        handle_event(&app, &shared, &body);
    }
}

fn handle_event(app: &AppHandle, shared: &Shared, body: &str) {
    let v: serde_json::Value = match serde_json::from_str(body) {
        Ok(v) => v,
        Err(_) => return,
    };
    if v["hook_event_name"].as_str().unwrap_or("").is_empty() {
        return;
    }
    shared.hooks_seen.store(true, Ordering::Relaxed);

    let ncfg = {
        let cfg = shared.cfg.lock().unwrap();
        NotifyCfg {
            enabled: cfg.notify,
            min_secs: cfg.notify_min_secs,
        }
    };
    let session_key = v["session_id"].as_str().unwrap_or("default").to_string();

    // Reduce, then project while still holding the `core` guard — no drop-then-relock, so this path
    // can't re-enter the core lock (the old deadlock trap).
    let (fx, payload) = {
        let mut core = shared.core.lock().unwrap();
        let fx = reducer::apply_event(&mut core, session_key, &v, Instant::now(), ncfg);
        let payload = state::build_update_from_core(shared, &core);
        (fx, payload)
    };

    if fx.want_official {
        shared.official_want.store(true, Ordering::Relaxed);
    }
    if let Some((title, body)) = &fx.notify {
        state::notify(app, title, body);
    }
    let _ = app.emit("pet-update", payload);
}
