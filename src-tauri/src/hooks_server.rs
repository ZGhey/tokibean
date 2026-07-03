// Hook event receiver
// Claude Code's hooks POST event JSON to http://127.0.0.1:<port>/event
// The event JSON carries hook_event_name and session_id; state is tracked per session

use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::AppHandle;
use tiny_http::{Method, Response, Server};

use crate::i18n;
use crate::state::{self, Base, Session, Shared};

pub fn run(app: AppHandle, shared: Arc<Shared>) {
    let (bind, port) = {
        let cfg = shared.cfg.lock().unwrap();
        (cfg.bind.clone(), cfg.port)
    };
    let server = match Server::http((bind.as_str(), port)) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[claude-pet] hook server failed to start (port {} in use?): {}", port, e);
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

fn snippet(s: &str, max_chars: usize) -> String {
    let cleaned: String = s.chars().map(|c| if c == '\n' { ' ' } else { c }).collect();
    let mut out: String = cleaned.chars().take(max_chars).collect();
    if cleaned.chars().count() > max_chars {
        out.push('…');
    }
    out
}

/// Tool name -> a stable, language-neutral key.
/// This is NOT localized: the pet renderers both match on these keys to pick the tool
/// animation AND draw them as terminal-style status tags ("cmd"/"reading"/…), so they
/// must stay in English regardless of the UI language.
fn friendly_tool(t: &str) -> String {
    let known = match t {
        "Bash" | "PowerShell" => "cmd",
        "Edit" | "Write" | "NotebookEdit" => "coding",
        "Read" => "reading",
        "Grep" | "Glob" => "searching",
        "WebFetch" | "WebSearch" => "browsing",
        "Task" | "Agent" => "agents",
        "TodoWrite" | "TaskCreate" | "TaskUpdate" => "planning",
        _ => "",
    };
    if !known.is_empty() {
        return known.to_string();
    }
    // mcp__server__tool -> keep only the last segment
    let short = t.rsplit("__").next().unwrap_or(t);
    snippet(short, 12)
}

fn handle_event(app: &AppHandle, shared: &Shared, body: &str) {
    let v: serde_json::Value = match serde_json::from_str(body) {
        Ok(v) => v,
        Err(_) => return,
    };
    let name = v["hook_event_name"].as_str().unwrap_or("");
    if name.is_empty() {
        return;
    }
    shared.hooks_seen.store(true, Ordering::Relaxed);
    let (notify_on, notify_min) = {
        let cfg = shared.cfg.lock().unwrap();
        (cfg.notify, cfg.notify_min_secs)
    };
    let sid = v["session_id"].as_str().unwrap_or("default").to_string();

    // worked: how many seconds this turn worked before Stop, used for notification denoising and celebration level
    let mut worked: u64 = 0;

    {
        let mut core = shared.core.lock().unwrap();
        core.last_event = Some(name.to_string());
        let now = Instant::now();

        if name == "SessionEnd" {
            core.sessions.remove(&sid);
            // Note: push_update locks core again, so it must be released first
            drop(core);
            state::push_update(app, shared);
            return;
        }

        let sess = core.sessions.entry(sid).or_insert(Session {
            base: Base::Idle,
            since: Instant::now(),
            done_until: None,
            last_seen: Instant::now(),
            in_tool: false,
        });
        sess.last_seen = now;

        match name {
            "UserPromptSubmit" => {
                if sess.base != Base::Working {
                    sess.since = now;
                }
                sess.base = Base::Working;
                sess.done_until = None;
                sess.in_tool = false;
                core.bubble = None;
                core.tool_note = None;
            }
            "PostToolUse" => {
                // Tool finished, exit the "in tool call" state
                sess.in_tool = false;
                // Tool error -> a brief annoyed animation
                let r = &v["tool_response"];
                let is_err = r["is_error"].as_bool().unwrap_or(false)
                    || !r["error"].is_null()
                    || r["success"].as_bool().map(|s| !s).unwrap_or(false);
                if is_err {
                    core.oops_until = Some(now + Duration::from_secs(4));
                }
            }
            "PreToolUse" => {
                // Fallback: still detect work even if UserPromptSubmit was missed
                if sess.base != Base::Working {
                    sess.base = Base::Working;
                    sess.since = now;
                }
                sess.in_tool = true;
                if let Some(tool) = v["tool_name"].as_str() {
                    core.tool_note = Some((friendly_tool(tool), now + Duration::from_secs(10)));
                }
                // Background task launched: a little satellite enters orbit
                if v["tool_input"]["run_in_background"].as_bool().unwrap_or(false) {
                    core.bg_tasks.push(now + Duration::from_secs(15 * 60));
                }
            }
            "Stop" => {
                if sess.base == Base::Working {
                    worked = now.duration_since(sess.since).as_secs();
                }
                let level = if worked >= 600 { 2 } else if worked >= 60 { 1 } else { 0 };
                let dwell = if level == 2 { 20 } else { 12 };
                // Finish all writes to sess before touching core's other fields (borrow checker)
                sess.base = Base::Done;
                sess.since = now;
                sess.done_until = Some(now + Duration::from_secs(dwell));
                sess.in_tool = false;
                core.celebrate = core.celebrate.max(level);
                let msg = v["last_assistant_message"].as_str().unwrap_or("");
                let head = if worked >= 60 {
                    if i18n::is_zh() {
                        format!("完工·{}分钟", worked / 60)
                    } else {
                        format!("Done · {} min", worked / 60)
                    }
                } else {
                    i18n::t("完工", "Done").to_string()
                };
                let text = if msg.is_empty() {
                    format!("{}!", head)
                } else if i18n::is_zh() {
                    format!("{}:{}", head, snippet(msg, 40))
                } else {
                    format!("{}: {}", head, snippet(msg, 40))
                };
                core.bubble = Some((text, now + Duration::from_secs(dwell)));
                core.tool_note = None;
                // Just burned a batch of tokens; request an official usage refresh soon (event-driven)
                shared.official_want.store(true, Ordering::Relaxed);
                // Today's completion count (reset across days)
                let today = chrono::Local::now().format("%Y-%m-%d").to_string();
                if core.stops_day != today {
                    core.stops_day = today;
                    core.stops_today = 0;
                }
                core.stops_today += 1;
            }
            "Notification" => {
                if sess.base != Base::Attention {
                    sess.since = now; // Start timing the anxiety escalation
                }
                sess.base = Base::Attention;
                sess.done_until = None;
                sess.in_tool = false;
                core.tool_note = None;
                let msg = v["message"].as_str().unwrap_or("");
                let text = if msg.is_empty() {
                    i18n::t("在等你输入!", "Waiting for you!").to_string()
                } else {
                    snippet(msg, 40)
                };
                core.bubble = Some((text, now + Duration::from_secs(120)));
            }
            "SessionStart" => {
                let anyone_busy = core
                    .sessions
                    .values()
                    .any(|s| s.base == Base::Working || s.base == Base::Attention);
                if !anyone_busy {
                    core.bubble =
                        Some((i18n::t("开工!", "Let's go!").to_string(), now + Duration::from_secs(6)));
                }
            }
            _ => {} // Ignore SubagentStop and others for now
        }
    }

    // System notifications: only fire for two high-value events.
    // Stop notification denoising: don't interrupt for small tasks under notify_min_secs
    if notify_on {
        match name {
            "Stop" if worked >= notify_min => {
                let msg = v["last_assistant_message"].as_str().unwrap_or("");
                let body_text = if msg.is_empty() {
                    i18n::t("本轮任务已完成", "This turn is done").to_string()
                } else {
                    snippet(msg, 80)
                };
                state::notify(app, i18n::t("Claude 完工了", "Claude is done"), &body_text);
            }
            "Notification" => {
                let msg = v["message"]
                    .as_str()
                    .unwrap_or(i18n::t("Claude 在等你输入或授权", "Claude is waiting for input or approval"));
                state::notify(app, i18n::t("Claude 在等你", "Claude needs you"), &snippet(msg, 80));
            }
            _ => {}
        }
    }

    state::push_update(app, shared);
}
