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
use crate::state::{self, Shared, SessionKey, AGENTS, AGENT_CLAUDE};

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
        let agent = agent_from_path(request.url());
        // Every supported agent requires the hook process to emit valid JSON on stdout (Copilot can
        // deadlock without it). The hooks are curl commands, and curl prints the response body to
        // stdout — so replying with JSON is all it takes.
        let _ = request.respond(
            Response::from_string("{}").with_header(
                tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..])
                    .unwrap(),
            ),
        );
        if !ok {
            continue;
        }
        handle_event(&app, &shared, &agent, &body);
    }
}

/// Which agent sent this event, from the URL the installer baked into that agent's hook config.
/// Never sniffed from the payload: Codex's payload is nearly identical to Claude's, so there is
/// nothing to sniff — and the identity is a fact we chose at install time, not one to re-derive.
///
/// Bare `/event` means claude, so every hook installed by an earlier version keeps working with no
/// reinstall. An unknown agent slug is treated as claude rather than dropped, so a future typo in a
/// hook config degrades instead of silently swallowing events.
fn agent_from_path(url: &str) -> String {
    let path = url.split('?').next().unwrap_or("");
    let slug = path.trim_start_matches("/event").trim_matches('/');
    match AGENTS.iter().find(|a| **a == slug) {
        Some(a) => a.to_string(),
        None => AGENT_CLAUDE.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_bare_event_path_still_means_claude() {
        // Every hook installed by an earlier version posts here. If this ever stops meaning claude,
        // every existing user's pet goes silent until they reinstall their hooks.
        assert_eq!(agent_from_path("/event"), "claude");
        assert_eq!(agent_from_path("/event/"), "claude");
    }

    #[test]
    fn the_path_names_the_agent() {
        assert_eq!(agent_from_path("/event/codex"), "codex");
        assert_eq!(agent_from_path("/event/claude"), "claude");
    }

    #[test]
    fn a_query_string_does_not_confuse_the_slug() {
        assert_eq!(agent_from_path("/event/codex?x=1"), "codex");
    }

    #[test]
    fn an_unknown_agent_degrades_to_claude_rather_than_vanishing() {
        // A typo in someone's hook config should cost them the agent label, not every event.
        assert_eq!(agent_from_path("/event/gemini"), "claude");
        assert_eq!(agent_from_path("/event/../etc"), "claude");
    }
}

fn handle_event(app: &AppHandle, shared: &Shared, agent: &str, body: &str) {
    let v: serde_json::Value = match serde_json::from_str(body) {
        Ok(v) => v,
        Err(_) => return,
    };
    if v["hook_event_name"].as_str().unwrap_or("").is_empty() {
        return;
    }
    // An event ACTUALLY arrived from this agent — the only proof its hooks are live. For Codex,
    // writing the hook config isn't enough (it won't run a hook until approved in `/hooks`), so this
    // is what flips the panel from "pending" to "active" (ADR-0006).
    shared
        .hooks_seen
        .lock()
        .unwrap()
        .insert(agent.to_string());

    let ncfg = {
        let cfg = shared.cfg.lock().unwrap();
        NotifyCfg {
            enabled: cfg.notify,
            min_secs: cfg.notify_min_secs,
        }
    };
    let session_key = SessionKey::new(agent, v["session_id"].as_str().unwrap_or("default"));

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
