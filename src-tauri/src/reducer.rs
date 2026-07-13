// Event reduction: raw hook event -> state mutation + effects.
//
// The mirror image of the projection module. `projection::project` is the pure seam on the way OUT
// (state -> frontend payload); `reducer::apply_event` is the pure seam on the way IN (hook event ->
// state mutation). Neither touches a Mutex, an AppHandle, or the clock — the caller locks, snapshots,
// injects `now`, and carries out whatever `Effects` asks for afterwards.
//
// Keeping this pure is what makes the state machine testable at all: the IO shell around it
// (hooks_server) can then stay thin enough to eyeball.

use std::time::{Duration, Instant};

use serde_json::Value;

use crate::i18n;
use crate::state::{Base, Core, Session, SessionKey, AGENT_CODEX};

/// What the IO shell must do after a reduction. The reducer itself performs no IO.
#[derive(Default, PartialEq, Debug)]
pub struct Effects {
    /// A system notification to fire: (title, body). Already denoised — if this is Some, send it.
    pub notify: Option<(String, String)>,
    /// Ask the official usage API soon (Claude just burned tokens).
    pub want_official: bool,
}

/// Notification settings the reducer needs. Passed in so the reducer never locks the config.
#[derive(Clone, Copy)]
pub struct NotifyCfg {
    pub enabled: bool,
    /// Don't notify on completion for jobs shorter than this many seconds.
    pub min_secs: u64,
}

/// Normalize an agent's event name into Tokibean's vocabulary (Claude's names are the canonical set).
///
/// Verified against real Codex payloads, not the docs: Codex's event names are already Claude's,
/// with two differences. It has no `Notification` — its "the agent needs you" signal is
/// `PermissionRequest`. And it has no `SessionEnd`.
fn normalize_event(agent: &str, name: &str) -> &'static str {
    if agent == AGENT_CODEX && name == "PermissionRequest" {
        return "Notification";
    }
    // Everything else already speaks the canonical names. Leak the borrow into a 'static by matching
    // the known set; an unrecognized name falls through to "" and is ignored downstream.
    match name {
        "SessionStart" => "SessionStart",
        "SessionEnd" => "SessionEnd",
        "UserPromptSubmit" => "UserPromptSubmit",
        "PreToolUse" => "PreToolUse",
        "PostToolUse" => "PostToolUse",
        "Stop" => "Stop",
        "SubagentStop" => "SubagentStop",
        "Notification" => "Notification",
        _ => "",
    }
}

/// Whether this agent's PostToolUse can tell us a tool FAILED.
///
/// Claude says so outright (`tool_response.is_error` / `.error` / `.success`). **Codex cannot.**
/// Verified with real bytes: the same Bash tool running `true` (exit 0), `false` (exit 1) and
/// `sh -c 'exit 3'` produces byte-identical payloads — `tool_response` is `""` in all three — and the
/// payload has no exit_code / is_error / success field at all (OpenAI's own schema confirms this).
///
/// So the pet simply doesn't do its annoyed "oops" face on Codex. **Do not add a heuristic here.**
/// This is not a fragility problem to work around: `false` returns an empty string, so there is
/// nothing to inspect. Guessing from output text ("error", "No such file") would misfire on any
/// command that happens to print those words — a lying animation is worse than no animation.
fn reports_tool_errors(agent: &str) -> bool {
    agent != AGENT_CODEX
}

/// Apply one hook event to the state. Pure: no locks, no IO, no clock reads beyond the injected `now`.
///
/// `session_key` is (agent, session_id) — the caller owns the keying policy, so the reducer never
/// has to know how an agent was identified. The agent's own event/tool vocabulary is normalized into
/// Tokibean's here, so there is exactly ONE state machine rather than one per agent.
pub fn apply_event(
    core: &mut Core,
    session_key: SessionKey,
    v: &Value,
    now: Instant,
    ncfg: NotifyCfg,
) -> Effects {
    let mut fx = Effects::default();
    let agent = session_key.agent.clone();
    let name = normalize_event(&agent, v["hook_event_name"].as_str().unwrap_or(""));
    if name.is_empty() {
        return fx;
    }
    core.last_event = Some(name.to_string());

    if name == "SessionEnd" {
        core.sessions.remove(&session_key);
        return fx;
    }

    let sess = core.sessions.entry(session_key).or_insert(Session {
        base: Base::Idle,
        since: now,
        done_until: None,
        last_seen: now,
        in_tool: false,
        cwd: None,
    });
    sess.last_seen = now;
    // Remember this session's PROJECT (nearest ancestor with a project marker), so the panel shows a
    // stable name even as the session cd's between subdirectories (e.g. proj/cli → still "proj").
    if let Some(c) = v["cwd"].as_str() {
        if let Some(p) = project_name(c) {
            sess.cwd = Some(p);
        }
    }

    // How many seconds this turn worked before Stop — drives notification denoising and celebration level
    let mut worked: u64 = 0;

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
            // Tool finished, exit the "in tool call" state.
            // NOTE: do NOT drop a mini-clone here. Subagents run in the background by default
            // (CC v2.1.198+), so the Agent tool call returns — and fires PostToolUse — immediately
            // on launch, long before the subagent finishes. The real "subagent done" signal is the
            // SubagentStop event (handled below); popping here would kill the clone at launch.
            sess.in_tool = false;
            // Tool error -> a brief annoyed animation. Only for agents whose PostToolUse can
            // actually say a tool failed — Codex's cannot (see reports_tool_errors).
            if reports_tool_errors(&agent) {
                let r = &v["tool_response"];
                let is_err = r["is_error"].as_bool().unwrap_or(false)
                    || !r["error"].is_null()
                    || r["success"].as_bool().map(|s| !s).unwrap_or(false);
                if is_err {
                    core.oops_until = Some(now + Duration::from_secs(4));
                }
            }
        }
        "PreToolUse" => {
            // Fallback: still detect work even if UserPromptSubmit was missed
            if sess.base != Base::Working {
                sess.base = Base::Working;
                sess.since = now;
            }
            sess.in_tool = true;
            let tool = v["tool_name"].as_str().unwrap_or("");
            if tool == "Task" || tool == "Agent" {
                // A subagent was launched: track it as its own counted, persistent indicator (a
                // mini-clone per active subagent) that coexists with the main tool animation instead
                // of occupying the single tool_note slot. Popped on the matching SubagentStop; the
                // 30-minute expiry is only a fallback for a missed completion event (e.g. Ctrl+C).
                core.agent_tasks.push(now + Duration::from_secs(30 * 60));
            } else {
                if !tool.is_empty() {
                    core.tool_note = Some((
                        friendly_tool_cmd(tool, &v["tool_input"]),
                        now + Duration::from_secs(10),
                    ));
                }
                // Background shell launched (run_in_background): a little satellite enters orbit
                if v["tool_input"]["run_in_background"].as_bool().unwrap_or(false) {
                    core.bg_tasks.push(now + Duration::from_secs(15 * 60));
                }
            }
        }
        "Stop" => {
            if sess.base == Base::Working {
                worked = now.duration_since(sess.since).as_secs();
            }
            let level = if worked >= 600 {
                2
            } else if worked >= 60 {
                1
            } else {
                0
            };
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
            // Just burned a batch of tokens; ask for an official usage refresh soon (event-driven)
            fx.want_official = true;
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
            let proj = sess.cwd.clone(); // capture before touching core (borrow checker)
            core.tool_note = None;
            // Name the project that needs you, so with several sessions you can tell which one is
            // waiting; fall back to the raw notification message, then a generic prompt.
            let text = match &proj {
                Some(p) if i18n::is_zh() => format!("「{}」在等你", p),
                Some(p) => format!("{} needs you", p),
                None => {
                    let msg = v["message"].as_str().unwrap_or("");
                    if msg.is_empty() {
                        i18n::t("在等你输入!", "Waiting for you!").to_string()
                    } else {
                        snippet(msg, 40)
                    }
                }
            };
            core.bubble = Some((text, now + Duration::from_secs(30)));
        }
        "SessionStart" => {
            let anyone_busy = core
                .sessions
                .values()
                .any(|s| s.base == Base::Working || s.base == Base::Attention);
            if !anyone_busy {
                core.bubble = Some((
                    i18n::t("开工!", "Let's go!").to_string(),
                    now + Duration::from_secs(6),
                ));
            }
        }
        "SubagentStop" => {
            // A subagent finished — the reliable "subagent done" signal (see the PostToolUse note).
            // Drop one mini-clone; the 30-min decay on push is only a fallback for a missed Stop.
            core.agent_tasks.pop();
        }
        _ => {} // Ignore other events for now
    }

    // System notifications: only two events are worth interrupting for.
    // Stop denoising: don't interrupt for small tasks under min_secs.
    if ncfg.enabled {
        let who = agent_display(&agent);
        match name {
            "Stop" if worked >= ncfg.min_secs => {
                let msg = v["last_assistant_message"].as_str().unwrap_or("");
                let body = if msg.is_empty() {
                    i18n::t("本轮任务已完成", "This turn is done").to_string()
                } else {
                    snippet(msg, 80)
                };
                let title = if i18n::is_zh() {
                    format!("{} 完工了", who)
                } else {
                    format!("{} is done", who)
                };
                fx.notify = Some((title, body));
            }
            "Notification" => {
                let msg = v["message"].as_str().unwrap_or("");
                let body = if msg.is_empty() {
                    if i18n::is_zh() {
                        format!("{} 在等你输入或授权", who)
                    } else {
                        format!("{} is waiting for input or approval", who)
                    }
                } else {
                    snippet(msg, 80)
                };
                let title = if i18n::is_zh() {
                    format!("{} 在等你", who)
                } else {
                    format!("{} needs you", who)
                };
                fx.notify = Some((title, body));
            }
            _ => {}
        }
    }

    fx
}

/// How an agent is named to the user. Notifications must say WHICH agent needs you — with several
/// running, "Claude is done" for a Codex turn is just wrong.
pub fn agent_display(agent: &str) -> &str {
    match agent {
        AGENT_CODEX => "Codex",
        _ => "Claude",
    }
}

pub fn snippet(s: &str, max_chars: usize) -> String {
    let cleaned: String = s.chars().map(|c| if c == '\n' { ' ' } else { c }).collect();
    let mut out: String = cleaned.chars().take(max_chars).collect();
    if cleaned.chars().count() > max_chars {
        out.push('…');
    }
    out
}

/// Tool name -> a stable, language-neutral key.
///
/// This is NOT localized: the pet renderers both match on these keys to pick the tool
/// animation AND draw them as terminal-style status tags ("cmd"/"reading"/…), so they
/// must stay in English regardless of the UI language.
///
/// The key set is CLOSED. Every skin in src/skins/ matches on it, so adding a key means auditing
/// them all — treat it as a breaking change. A new agent maps its tool names ONTO this set.
///
/// Codex needs almost nothing here: verified against real payloads, its shell tool is literally
/// named `Bash` (not `shell`, as the research notes claimed) with the same `tool_input.command`, so
/// the command sniffing below works unchanged. Its one distinct name is `apply_patch`, its file
/// editor. Codex has no Read or Grep tool at all — it reads with `Bash` + `sed` and searches with
/// `Bash` + `grep` — so `reading`/`searching` rarely surface on Codex. That is Codex's information
/// boundary, not a bug: do NOT try to recover them by guessing at command text, since `cat` in a
/// pipeline or `grep` filtering command output would both be misread.
pub fn friendly_tool(t: &str) -> String {
    let known = match t {
        "Bash" | "PowerShell" => "cmd",
        "Edit" | "Write" | "NotebookEdit" | "apply_patch" => "coding",
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

/// Like friendly_tool, but for shell tools it peeks at the command to pick a more specific animation
/// (git / testing / deps) so a plain "cmd" isn't the only shell state.
pub fn friendly_tool_cmd(tool: &str, input: &Value) -> String {
    if tool == "Bash" || tool == "PowerShell" {
        let c = input["command"].as_str().unwrap_or("").to_lowercase();
        if c.split_whitespace().any(|w| w == "git") {
            return "git".to_string();
        }
        if is_test_cmd(&c) {
            return "testing".to_string();
        }
        if is_install_cmd(&c) {
            return "deps".to_string();
        }
        return "cmd".to_string();
    }
    friendly_tool(tool)
}

fn is_test_cmd(c: &str) -> bool {
    c.contains("pytest")
        || c.contains("jest")
        || c.contains("vitest")
        || c.contains("mocha")
        || c.contains("cargo test")
        || c.contains("go test")
        || c.contains("rspec")
        || c.contains("phpunit")
        || (c.contains(" test")
            && (c.contains("npm") || c.contains("yarn") || c.contains("pnpm") || c.contains("make")))
}

fn is_install_cmd(c: &str) -> bool {
    c.contains("npm install")
        || c.contains("npm i ")
        || c.contains("npm ci")
        || c.contains("yarn add")
        || c.contains("yarn install")
        || c.contains("pnpm add")
        || c.contains("pnpm install")
        || c.contains("pip install")
        || c.contains("pip3 install")
        || c.contains("cargo add")
        || c.contains("go get")
        || c.contains("bundle install")
        || c.contains("gem install")
        || c.contains("brew install")
        || c.contains("apt install")
        || c.contains("apt-get install")
}

/// A stable, human-friendly project name for a working directory: the basename of the nearest ancestor
/// that looks like a project root (has .git / package.json / Cargo.toml / pyproject.toml / go.mod), so it
/// stays put as a session cd's between subdirectories. Falls back to the cwd's own basename.
fn project_name(cwd: &str) -> Option<String> {
    use std::path::Path;
    let base = |d: &Path| d.file_name().and_then(|n| n.to_str()).map(str::to_string);
    // Prefer the git repo root — the most stable, recognizable project identity across subdirs.
    let mut dir = Path::new(cwd);
    loop {
        if dir.join(".git").exists() {
            return base(dir);
        }
        match dir.parent() {
            Some(p) if p != dir => dir = p,
            _ => break,
        }
    }
    // Not a git repo: fall back to the nearest package/manifest root.
    let mut dir = Path::new(cwd);
    loop {
        if dir.join("package.json").exists()
            || dir.join("Cargo.toml").exists()
            || dir.join("pyproject.toml").exists()
            || dir.join("go.mod").exists()
        {
            return base(dir);
        }
        match dir.parent() {
            Some(p) if p != dir => dir = p,
            _ => break,
        }
    }
    // Last resort: the cwd's own basename.
    cwd.rsplit(|ch| ch == '/' || ch == '\\')
        .find(|s| !s.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashMap;

    fn empty_core() -> Core {
        Core {
            sessions: HashMap::new(),
            bubble: None,
            tool_note: None,
            celebrate: 0,
            last_event: None,
            stops_today: 0,
            stops_day: String::new(),
            report_day: String::new(),
            idle_since: None,
            oops_until: None,
            bg_tasks: Vec::new(),
            agent_tasks: Vec::new(),
        }
    }

    const QUIET: NotifyCfg = NotifyCfg {
        enabled: false,
        min_secs: 30,
    };
    const LOUD: NotifyCfg = NotifyCfg {
        enabled: true,
        min_secs: 30,
    };

    fn key(id: &str) -> SessionKey {
        SessionKey::new("claude", id)
    }

    /// Apply an event at `now` and return the effects.
    fn ev(core: &mut Core, v: Value, now: Instant) -> Effects {
        apply_event(core, key("s1"), &v, now, QUIET)
    }

    fn base_of(core: &Core, id: &str) -> Base {
        core.sessions.get(&key(id)).unwrap().base
    }

    #[test]
    fn unknown_event_is_ignored() {
        let mut core = empty_core();
        let fx = ev(&mut core, json!({}), Instant::now());
        assert_eq!(fx, Effects::default());
        assert!(core.sessions.is_empty());
        assert!(core.last_event.is_none());
    }

    #[test]
    fn user_prompt_submit_starts_working_and_clears_transients() {
        let now = Instant::now();
        let mut core = empty_core();
        core.bubble = Some(("stale".into(), now + Duration::from_secs(9)));
        core.tool_note = Some(("cmd".into(), now + Duration::from_secs(9)));

        ev(&mut core, json!({"hook_event_name": "UserPromptSubmit"}), now);

        assert_eq!(base_of(&core, "s1"), Base::Working);
        assert!(core.bubble.is_none());
        assert!(core.tool_note.is_none());
        assert_eq!(core.last_event.as_deref(), Some("UserPromptSubmit"));
    }

    #[test]
    fn pre_tool_use_works_even_without_a_prompt_event() {
        let now = Instant::now();
        let mut core = empty_core();
        ev(
            &mut core,
            json!({"hook_event_name": "PreToolUse", "tool_name": "Read"}),
            now,
        );
        assert_eq!(base_of(&core, "s1"), Base::Working);
        assert!(core.sessions[&key("s1")].in_tool);
        assert_eq!(core.tool_note.as_ref().unwrap().0, "reading");
    }

    #[test]
    fn shell_commands_get_a_specific_tool_key() {
        let now = Instant::now();
        for (cmd, want) in [
            ("git status", "git"),
            ("cargo test --all", "testing"),
            ("npm install lodash", "deps"),
            ("ls -la", "cmd"),
        ] {
            let mut core = empty_core();
            ev(
                &mut core,
                json!({"hook_event_name": "PreToolUse", "tool_name": "Bash",
                       "tool_input": {"command": cmd}}),
                now,
            );
            assert_eq!(core.tool_note.as_ref().unwrap().0, want, "cmd was {cmd}");
        }
    }

    #[test]
    fn background_shell_pushes_a_satellite() {
        let now = Instant::now();
        let mut core = empty_core();
        ev(
            &mut core,
            json!({"hook_event_name": "PreToolUse", "tool_name": "Bash",
                   "tool_input": {"command": "sleep 60", "run_in_background": true}}),
            now,
        );
        assert_eq!(core.bg_tasks.len(), 1);
    }

    #[test]
    fn subagent_launch_pushes_a_clone_and_takes_no_tool_note() {
        let now = Instant::now();
        let mut core = empty_core();
        ev(
            &mut core,
            json!({"hook_event_name": "PreToolUse", "tool_name": "Task"}),
            now,
        );
        assert_eq!(core.agent_tasks.len(), 1);
        // The Agent tool must NOT occupy the single tool_note slot — the mini-clone is its indicator
        assert!(core.tool_note.is_none());
    }

    #[test]
    fn post_tool_use_does_not_drop_a_clone_but_subagent_stop_does() {
        let now = Instant::now();
        let mut core = empty_core();
        ev(
            &mut core,
            json!({"hook_event_name": "PreToolUse", "tool_name": "Task"}),
            now,
        );
        // Subagents run in the background: PostToolUse fires at LAUNCH, not at completion
        ev(
            &mut core,
            json!({"hook_event_name": "PostToolUse", "tool_name": "Task"}),
            now,
        );
        assert_eq!(core.agent_tasks.len(), 1, "clone must survive PostToolUse");

        ev(&mut core, json!({"hook_event_name": "SubagentStop"}), now);
        assert_eq!(core.agent_tasks.len(), 0, "SubagentStop is the real signal");
    }

    #[test]
    fn tool_error_triggers_oops() {
        let now = Instant::now();
        // Claude signals a tool failure in any of three shapes
        for resp in [
            json!({"is_error": true}),
            json!({"error": "boom"}),
            json!({"success": false}),
        ] {
            let mut core = empty_core();
            ev(
                &mut core,
                json!({"hook_event_name": "PostToolUse", "tool_response": resp}),
                now,
            );
            assert!(core.oops_until.is_some(), "should have oops'd");
        }
        // A clean response must not
        let mut core = empty_core();
        ev(
            &mut core,
            json!({"hook_event_name": "PostToolUse", "tool_response": {"ok": true}}),
            now,
        );
        assert!(core.oops_until.is_none());
    }

    #[test]
    fn post_tool_use_leaves_the_tool_call() {
        let now = Instant::now();
        let mut core = empty_core();
        ev(
            &mut core,
            json!({"hook_event_name": "PreToolUse", "tool_name": "Bash"}),
            now,
        );
        assert!(core.sessions[&key("s1")].in_tool);
        ev(&mut core, json!({"hook_event_name": "PostToolUse"}), now);
        assert!(!core.sessions[&key("s1")].in_tool);
    }

    #[test]
    fn stop_finishes_the_session_and_asks_for_official_usage() {
        let now = Instant::now();
        let mut core = empty_core();
        ev(&mut core, json!({"hook_event_name": "UserPromptSubmit"}), now);

        let fx = ev(
            &mut core,
            json!({"hook_event_name": "Stop", "last_assistant_message": "all done"}),
            now + Duration::from_secs(5),
        );

        assert_eq!(base_of(&core, "s1"), Base::Done);
        assert!(core.sessions[&key("s1")].done_until.is_some());
        assert!(core.tool_note.is_none());
        assert!(fx.want_official, "Stop just burned tokens — refresh usage");
        assert_eq!(core.stops_today, 1);
        assert!(core.bubble.as_ref().unwrap().0.contains("all done"));
    }

    #[test]
    fn celebration_level_scales_with_the_work_done() {
        for (secs, want) in [(5u64, 0u8), (90, 1), (700, 2)] {
            let now = Instant::now();
            let mut core = empty_core();
            ev(&mut core, json!({"hook_event_name": "UserPromptSubmit"}), now);
            ev(
                &mut core,
                json!({"hook_event_name": "Stop"}),
                now + Duration::from_secs(secs),
            );
            assert_eq!(core.celebrate, want, "worked {secs}s");
        }
    }

    #[test]
    fn stop_notification_is_denoised_for_short_jobs() {
        let now = Instant::now();

        // Under min_secs: no notification
        let mut core = empty_core();
        apply_event(
            &mut core,
            key("s1"),
            &json!({"hook_event_name": "UserPromptSubmit"}),
            now,
            LOUD,
        );
        let fx = apply_event(
            &mut core,
            key("s1"),
            &json!({"hook_event_name": "Stop"}),
            now + Duration::from_secs(5),
            LOUD,
        );
        assert!(fx.notify.is_none(), "5s job must not interrupt");

        // Over min_secs: notify
        let mut core = empty_core();
        apply_event(
            &mut core,
            key("s1"),
            &json!({"hook_event_name": "UserPromptSubmit"}),
            now,
            LOUD,
        );
        let fx = apply_event(
            &mut core,
            key("s1"),
            &json!({"hook_event_name": "Stop", "last_assistant_message": "shipped"}),
            now + Duration::from_secs(60),
            LOUD,
        );
        let (_, body) = fx.notify.expect("60s job should notify");
        assert!(body.contains("shipped"));
    }

    #[test]
    fn notifications_are_silent_when_disabled() {
        let now = Instant::now();
        let mut core = empty_core();
        let fx = ev(&mut core, json!({"hook_event_name": "Notification"}), now);
        assert!(fx.notify.is_none());
    }

    #[test]
    fn notification_event_waits_for_you() {
        let now = Instant::now();
        let mut core = empty_core();
        let fx = apply_event(
            &mut core,
            key("s1"),
            &json!({"hook_event_name": "Notification", "message": "needs approval"}),
            now,
            LOUD,
        );
        assert_eq!(base_of(&core, "s1"), Base::Attention);
        assert!(core.tool_note.is_none());
        assert!(core.bubble.is_some());
        assert!(fx.notify.is_some(), "waiting for input always notifies");
    }

    #[test]
    fn session_start_greets_only_when_nobody_is_busy() {
        let now = Instant::now();

        let mut core = empty_core();
        ev(&mut core, json!({"hook_event_name": "SessionStart"}), now);
        assert!(core.bubble.is_some(), "quiet desk → greet");

        // Another session already working: don't interrupt its bubble
        let mut core = empty_core();
        apply_event(
            &mut core,
            key("busy"),
            &json!({"hook_event_name": "UserPromptSubmit"}),
            now,
            QUIET,
        );
        core.bubble = None;
        apply_event(
            &mut core,
            key("s2"),
            &json!({"hook_event_name": "SessionStart"}),
            now,
            QUIET,
        );
        assert!(core.bubble.is_none(), "someone is working → stay quiet");
    }

    #[test]
    fn session_end_drops_the_session() {
        let now = Instant::now();
        let mut core = empty_core();
        ev(&mut core, json!({"hook_event_name": "UserPromptSubmit"}), now);
        assert_eq!(core.sessions.len(), 1);
        ev(&mut core, json!({"hook_event_name": "SessionEnd"}), now);
        assert!(core.sessions.is_empty());
    }

    #[test]
    fn sessions_are_tracked_independently() {
        let now = Instant::now();
        let mut core = empty_core();
        apply_event(
            &mut core,
            key("a"),
            &json!({"hook_event_name": "UserPromptSubmit"}),
            now,
            QUIET,
        );
        apply_event(
            &mut core,
            key("b"),
            &json!({"hook_event_name": "Notification"}),
            now,
            QUIET,
        );
        assert_eq!(base_of(&core, "a"), Base::Working);
        assert_eq!(base_of(&core, "b"), Base::Attention);
    }

    #[test]
    fn the_same_session_id_under_two_agents_is_two_sessions() {
        // Agents mint their own session ids and know nothing of each other. Keying by id alone would
        // let a Codex session silently overwrite a Claude one — the key is (agent, id) precisely so
        // that collision is impossible by construction rather than by luck.
        let now = Instant::now();
        let mut core = empty_core();
        apply_event(
            &mut core,
            SessionKey::new("claude", "same-id"),
            &json!({"hook_event_name": "UserPromptSubmit"}),
            now,
            QUIET,
        );
        apply_event(
            &mut core,
            SessionKey::new("codex", "same-id"),
            &json!({"hook_event_name": "Notification"}),
            now,
            QUIET,
        );
        assert_eq!(core.sessions.len(), 2, "one session per agent");
        assert_eq!(
            core.sessions[&SessionKey::new("claude", "same-id")].base,
            Base::Working
        );
        assert_eq!(
            core.sessions[&SessionKey::new("codex", "same-id")].base,
            Base::Attention
        );
    }

    #[test]
    fn ending_one_agents_session_leaves_the_others_alone() {
        let now = Instant::now();
        let mut core = empty_core();
        for agent in ["claude", "codex"] {
            apply_event(
                &mut core,
                SessionKey::new(agent, "same-id"),
                &json!({"hook_event_name": "UserPromptSubmit"}),
                now,
                QUIET,
            );
        }
        apply_event(
            &mut core,
            SessionKey::new("claude", "same-id"),
            &json!({"hook_event_name": "SessionEnd"}),
            now,
            QUIET,
        );
        assert_eq!(core.sessions.len(), 1);
        assert!(core.sessions.contains_key(&SessionKey::new("codex", "same-id")));
    }

    // --- Codex adapter (ticket 04). Every payload below is shaped from a REAL captured Codex hook
    // event (.scratch/multi-agent/fixtures/codex-hook-payloads*.jsonl), not from the docs — the
    // research notes turned out to be wrong on three points.

    fn codex(core: &mut Core, v: Value, now: Instant) -> Effects {
        apply_event(core, SessionKey::new("codex", "cx"), &v, now, QUIET)
    }

    fn codex_base(core: &Core) -> Base {
        core.sessions[&SessionKey::new("codex", "cx")].base
    }

    #[test]
    fn codex_permission_request_means_it_needs_you() {
        // Codex has no `Notification` event. PermissionRequest is its "I need you" signal, and it's
        // the only source of the Attention state on Codex.
        let now = Instant::now();
        let mut core = empty_core();
        codex(
            &mut core,
            json!({"hook_event_name": "PermissionRequest", "tool_name": "Bash",
                   "tool_input": {"command": "rm -rf /", "description": "dangerous"}}),
            now,
        );
        assert_eq!(codex_base(&core), Base::Attention);
        assert!(core.bubble.is_some());
    }

    #[test]
    fn codex_shell_tool_is_literally_named_bash() {
        // The research notes said Codex's shell tool is `shell`. It isn't — it's `Bash`, with the
        // same tool_input.command, so the existing command sniffing works untouched.
        let now = Instant::now();
        for (cmd, want) in [
            ("git status", "git"),
            ("cargo test", "testing"),
            ("ls -la", "cmd"),
        ] {
            let mut core = empty_core();
            codex(
                &mut core,
                json!({"hook_event_name": "PreToolUse", "tool_name": "Bash",
                       "tool_input": {"command": cmd}}),
                now,
            );
            assert_eq!(core.tool_note.as_ref().unwrap().0, want);
        }
    }

    #[test]
    fn codex_apply_patch_is_the_coding_animation() {
        let now = Instant::now();
        let mut core = empty_core();
        codex(
            &mut core,
            json!({"hook_event_name": "PreToolUse", "tool_name": "apply_patch",
                   "tool_input": {"command": "*** Begin Patch"}}),
            now,
        );
        assert_eq!(core.tool_note.as_ref().unwrap().0, "coding");
        assert_eq!(codex_base(&core), Base::Working);
    }

    #[test]
    fn codex_introduces_no_new_tool_keys() {
        // The tool keys are a skin contract — every skin in src/skins/ matches on them, so adding one
        // is a breaking change. Codex's tools must land INSIDE the existing set.
        const CLOSED_SET: [&str; 10] = [
            "cmd", "coding", "reading", "searching", "browsing", "agents", "planning", "git",
            "testing", "deps",
        ];
        for tool in ["Bash", "apply_patch"] {
            let key = friendly_tool_cmd(tool, &json!({"command": "ls"}));
            assert!(CLOSED_SET.contains(&key.as_str()), "{tool} produced a new key: {key}");
        }
    }

    #[test]
    fn codex_cannot_report_a_tool_failure_so_the_pet_does_not_sulk() {
        // THE finding that fixtures alone would have missed. Real bytes: the same Bash tool running
        // `true` (exit 0), `false` (exit 1) and `sh -c 'exit 3'` gives byte-identical payloads —
        // tool_response is "" in all three. Success and failure are indistinguishable, so there is
        // no oops animation on Codex, and NO heuristic may be added: `false` returns an empty
        // string, so there is literally nothing to inspect.
        let now = Instant::now();
        for resp in ["", "cat: /nope: No such file or directory\n", "zsh:1: command not found: x\n"] {
            let mut core = empty_core();
            codex(
                &mut core,
                json!({"hook_event_name": "PostToolUse", "tool_name": "Bash",
                       "tool_input": {"command": "false"}, "tool_response": resp}),
                now,
            );
            assert!(
                core.oops_until.is_none(),
                "Codex must never oops — it cannot know the tool failed (resp was {resp:?})"
            );
        }
        // Claude, which CAN say so, still does
        let mut core = empty_core();
        ev(
            &mut core,
            json!({"hook_event_name": "PostToolUse", "tool_response": {"is_error": true}}),
            now,
        );
        assert!(core.oops_until.is_some(), "Claude still oopses");
    }

    #[test]
    fn a_codex_turn_runs_the_whole_state_machine() {
        // End to end, in the shape a real captured turn arrived in
        let now = Instant::now();
        let mut core = empty_core();
        codex(&mut core, json!({"hook_event_name": "SessionStart", "cwd": "/tmp"}), now);
        codex(
            &mut core,
            json!({"hook_event_name": "UserPromptSubmit", "prompt": "run ls"}),
            now,
        );
        assert_eq!(codex_base(&core), Base::Working);

        codex(
            &mut core,
            json!({"hook_event_name": "PreToolUse", "tool_name": "Bash",
                   "tool_input": {"command": "ls"}}),
            now + Duration::from_secs(1),
        );
        assert_eq!(core.tool_note.as_ref().unwrap().0, "cmd");

        codex(
            &mut core,
            json!({"hook_event_name": "PostToolUse", "tool_name": "Bash",
                   "tool_response": "AGENTS.md\nREADME.md\n"}),
            now + Duration::from_secs(2),
        );

        let fx = apply_event(
            &mut core,
            SessionKey::new("codex", "cx"),
            &json!({"hook_event_name": "Stop", "last_assistant_message": "done",
                    "stop_hook_active": false}),
            now + Duration::from_secs(90),
            LOUD,
        );
        assert_eq!(codex_base(&core), Base::Done);
        assert_eq!(core.celebrate, 1, "90s of work is a medium celebration");
        assert!(core.bubble.as_ref().unwrap().0.contains("done"));

        // The notification must name CODEX, not Claude
        let (title, _) = fx.notify.expect("a 90s job notifies");
        assert!(title.contains("Codex"), "notification said: {title}");
    }

    #[test]
    fn claudes_notifications_still_say_claude() {
        let now = Instant::now();
        let mut core = empty_core();
        let fx = apply_event(
            &mut core,
            key("s1"),
            &json!({"hook_event_name": "Notification"}),
            now,
            LOUD,
        );
        let (title, _) = fx.notify.unwrap();
        assert!(title.contains("Claude"));
    }

    #[test]
    fn an_event_name_we_do_not_know_is_ignored() {
        let now = Instant::now();
        let mut core = empty_core();
        // Codex sends these; we have no use for them and must not let them create a session
        for name in ["PreCompact", "PostCompact", "SubagentStart"] {
            codex(&mut core, json!({"hook_event_name": name}), now);
        }
        assert!(core.sessions.is_empty());
    }

    #[test]
    fn mcp_tool_names_keep_only_the_last_segment() {
        assert_eq!(friendly_tool("mcp__github__create_issue"), "create_issue");
        assert_eq!(friendly_tool("Bash"), "cmd");
        assert_eq!(friendly_tool("Read"), "reading");
    }

    #[test]
    fn snippet_truncates_on_chars_not_bytes() {
        // Multi-byte input must not panic or split a character
        assert_eq!(snippet("你好世界", 2), "你好…");
        assert_eq!(snippet("hi", 5), "hi");
        assert_eq!(snippet("a\nb", 5), "a b", "newlines flatten");
    }
}
