// One-click install of Codex hooks into ~/.codex/hooks.json.
//
// Two things make this different from the Claude installer.
//
// 1. WRITTEN IS NOT LIVE. Codex hashes each hook definition and refuses to run it until the user
//    approves it via `/hooks` in its TUI; any edit re-arms that review. So this module can only ever
//    report "pending" — the panel flips to "active" when an event actually ARRIVES (ADR-0006).
//
// 2. IMPORTED POLLUTION. Codex's onboarding offers to import a user's Claude Code setup, and that
//    import copies TOKIBEAN'S OWN HOOKS verbatim into hooks.json — curl commands pointing at the
//    BARE /event path, which means claude. Once the user clears the trust gate, their Codex events
//    get counted as Claude sessions: inflated ×N badge, mislabeled projects, a polluted state
//    machine. This is a live bug today, with no action from us. The planner strips those copies.
//
// We never write ~/.codex/config.toml (ADR-0013): `hooks` is stable and on by default in current
// Codex, and the real file already carries a [features] table and an occupied `notify` array —
// nothing we should be touching.

use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

/// The events Codex actually sends that we act on. Verified against a real install — Codex has no
/// `Notification` (PermissionRequest is its equivalent) and no `SessionEnd`.
const EVENTS: [&str; 7] = [
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PermissionRequest",
    "Stop",
    "SubagentStop",
];

pub fn hooks_path(cfg: &crate::config::Config) -> Option<PathBuf> {
    Some(crate::agents::dir(cfg, crate::state::AGENT_CODEX)?.join("hooks.json"))
}

/// The hook command Codex should run. `|| echo '{}'` because every agent requires the hook process
/// to emit valid JSON on stdout — curl prints our `{}` reply, but an offline pet means no reply at
/// all, so we have to supply one. `--max-time` stays under Codex's own hook timeout.
fn command(port: u16) -> String {
    format!(
        "curl -s -m 3 -X POST http://127.0.0.1:{}/event/codex -H \"Content-Type: application/json\" --data-binary @- || echo '{{}}'",
        port
    )
}

/// Our own hooks, wherever they point.
fn is_tokibean_hook(cmd: &str, port: u16) -> bool {
    cmd.contains(&format!(":{}/event", port))
}

/// Imported pollution: OUR hook, in CODEX's config, pointing at the BARE /event path — which means
/// claude. The user never wrote this; Codex's importer copied it out of ~/.claude/settings.json.
/// Left in place (and approved), it makes every Codex event masquerade as a Claude session.
fn is_imported_pollution(cmd: &str, port: u16) -> bool {
    is_tokibean_hook(cmd, port) && !cmd.contains(&format!(":{}/event/", port))
}

/// What one plan() run changed, so the panel can say something true.
#[derive(Debug, Default, PartialEq)]
pub struct Plan {
    /// Events that gained a hook
    pub added: usize,
    /// Imported-pollution hooks stripped (the bug fix)
    pub stripped: usize,
}

impl Plan {
    pub fn touched(&self) -> bool {
        self.added > 0 || self.stripped > 0
    }
}

/// Pure: existing hooks.json -> new hooks.json. The riskiest thing this feature does is write
/// someone else's config file, so it happens here, where it can be tested without a filesystem.
///
/// Invariants (CONTEXT.md #8): only hooks bearing OUR marker are ever added, rewritten, or removed.
/// A hook the user wrote is never touched. Re-running is idempotent — and must stay so, because
/// Codex can re-import at any time and re-pollute the file.
pub fn plan(root: &mut Value, port: u16) -> Result<Plan, String> {
    if root.is_null() {
        *root = json!({});
    }
    if !root.is_object() {
        return Err(crate::i18n::t(
            "hooks.json 顶层不是对象,不敢动它",
            "The top level of hooks.json is not an object; refusing to touch it",
        )
        .into());
    }
    let hooks = root
        .as_object_mut()
        .unwrap()
        .entry("hooks")
        .or_insert_with(|| json!({}));
    if !hooks.is_object() {
        return Err(crate::i18n::t(
            "hooks.json 里的 hooks 字段不是对象,不敢动它",
            "The `hooks` field in hooks.json is not an object; refusing to touch it",
        )
        .into());
    }
    let hooks = hooks.as_object_mut().unwrap();
    let cmd = command(port);
    let mut out = Plan::default();

    // Pass 1: strip imported pollution from EVERY event — including events we don't install into,
    // since the importer copies whatever Claude had (it brought over SessionEnd-less sets, but a
    // future import could bring anything).
    for (_event, groups) in hooks.iter_mut() {
        let Some(arr) = groups.as_array_mut() else { continue };
        let before = arr.len();
        arr.retain(|group| {
            // A group is ours-and-polluted only if EVERY hook in it is. A group mixing our hook with
            // the user's would mean rewriting their group — don't; leave it entirely alone.
            let inner = group["hooks"].as_array();
            match inner {
                Some(hs) if !hs.is_empty() => !hs.iter().all(|h| {
                    h["command"]
                        .as_str()
                        .map(|c| is_imported_pollution(c, port))
                        .unwrap_or(false)
                }),
                _ => true,
            }
        });
        out.stripped += before - arr.len();
    }

    // Pass 2: install ours. Idempotent — an event that already has a hook pointing at /event/codex
    // is left alone.
    for event in EVENTS {
        let arr = hooks.entry(event).or_insert_with(|| json!([]));
        let Some(arr) = arr.as_array_mut() else { continue };
        let already = arr.iter().any(|group| {
            group["hooks"]
                .as_array()
                .map(|hs| {
                    hs.iter()
                        .any(|h| h["command"].as_str() == Some(cmd.as_str()))
                })
                .unwrap_or(false)
        });
        if already {
            continue;
        }
        arr.push(json!({
            "hooks": [{
                "type": "command",
                "command": cmd,
                // Seconds (Codex's unit), comfortably over curl's --max-time 3
                "timeout": 5
            }]
        }));
        out.added += 1;
    }

    // Drop any event key we emptied out entirely, so a stripped file doesn't keep dead keys around
    hooks.retain(|_, v| !matches!(v.as_array(), Some(a) if a.is_empty()));
    Ok(out)
}

/// Whether Codex's hooks are missing anything (a new event after an upgrade, or fresh pollution
/// after a re-import), so the panel can re-surface the install button.
pub fn incomplete(cfg: &crate::config::Config) -> bool {
    let port = cfg.port;
    if !crate::agents::installed(cfg, crate::state::AGENT_CODEX) {
        return false; // No Codex → nothing to install → nothing missing
    }
    let Some(path) = hooks_path(cfg) else { return false };
    let Ok(text) = fs::read_to_string(&path) else { return true };
    let Ok(mut root) = serde_json::from_str::<Value>(&text) else { return true };
    // "Would a fresh plan change anything?" is exactly the question, and plan() is pure — so ask it.
    matches!(plan(&mut root, port), Ok(p) if p.touched())
}

pub fn install(cfg: &crate::config::Config) -> Result<String, String> {
    let port = cfg.port;
    let path = hooks_path(cfg).ok_or_else(|| {
        crate::i18n::t("找不到用户主目录", "Cannot find the user home directory").to_string()
    })?;
    let dir = path.parent().unwrap().to_path_buf();
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }

    let mut root: Value = if path.exists() {
        let text = fs::read_to_string(&path).map_err(|e| {
            format!(
                "{}: {}",
                crate::i18n::t("读取 hooks.json 失败", "Failed to read hooks.json"),
                e
            )
        })?;
        // Back up before touching someone else's config, same as the Claude installer does
        let _ = fs::write(dir.join("hooks.json.bak-tokibean"), &text);
        serde_json::from_str(&text).map_err(|e| {
            format!(
                "{}: {}",
                crate::i18n::t(
                    "hooks.json 不是合法 JSON",
                    "hooks.json is not valid JSON"
                ),
                e
            )
        })?
    } else {
        json!({})
    };

    let p = plan(&mut root, port)?;
    if p.touched() {
        fs::write(&path, serde_json::to_string_pretty(&root).unwrap()).map_err(|e| {
            format!(
                "{}: {}",
                crate::i18n::t("写入 hooks.json 失败", "Failed to write hooks.json"),
                e
            )
        })?;
    }
    Ok(message(&p))
}

fn message(p: &Plan) -> String {
    if !p.touched() {
        return crate::i18n::t(
            "Codex hooks 已经装过了,无需重复安装",
            "Codex hooks are already installed; no need to reinstall.",
        )
        .into();
    }
    let mut msg = if crate::i18n::is_zh() {
        format!("已安装 {} 个 Codex hook", p.added)
    } else {
        format!("Installed {} Codex hook(s)", p.added)
    };
    if p.stripped > 0 {
        // Worth saying out loud: this is a bug fix, not housekeeping. Their Codex work was being
        // counted as Claude's.
        msg.push_str(&if crate::i18n::is_zh() {
            format!(
                ",并清理了 {} 个从 Claude Code 导入的旧 hook(它们会把 Codex 的活动算到 Claude 头上)",
                p.stripped
            )
        } else {
            format!(
                ", and cleaned up {} hook(s) imported from Claude Code (they were counting your Codex activity as Claude's)",
                p.stripped
            )
        });
    }
    // The trust gate: written is not live, and the user must be told exactly what to do next.
    msg.push_str(crate::i18n::t(
        "。还需在 Codex 里执行 /hooks 批准这些 hook,它们才会真正生效",
        ". You still need to run /hooks inside Codex and approve them before they do anything.",
    ));
    msg
}

/// Restore a Path import that only the tests use on some platforms.
#[allow(dead_code)]
fn _unused(_: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;

    const PORT: u16 = 8737;

    fn cmd_for(port: u16) -> String {
        command(port)
    }

    /// hooks.json exactly as Codex's importer writes it: OUR Claude hooks, copied verbatim, pointing
    /// at the BARE /event path. Taken from a real machine.
    fn imported_pollution() -> Value {
        let claude_cmd = "curl -s -m 3 -X POST http://127.0.0.1:8737/event -H \"Content-Type: application/json\" --data-binary @- || exit 0";
        let group = json!([{"hooks": [{"type": "command", "command": claude_cmd, "timeout": 5}]}]);
        json!({"hooks": {
            "PreToolUse": group, "PostToolUse": group, "SessionStart": group,
            "UserPromptSubmit": group, "SubagentStop": group, "Stop": group,
        }})
    }

    fn commands_in(root: &Value) -> Vec<String> {
        let mut out = vec![];
        if let Some(h) = root["hooks"].as_object() {
            for (_, groups) in h {
                for g in groups.as_array().unwrap_or(&vec![]) {
                    for hook in g["hooks"].as_array().unwrap_or(&vec![]) {
                        if let Some(c) = hook["command"].as_str() {
                            out.push(c.to_string());
                        }
                    }
                }
            }
        }
        out
    }

    #[test]
    fn a_fresh_install_adds_every_event() {
        let mut root = json!({});
        let p = plan(&mut root, PORT).unwrap();
        assert_eq!(p.added, EVENTS.len());
        assert_eq!(p.stripped, 0);
        for ev in EVENTS {
            assert!(root["hooks"][ev].is_array(), "{ev} missing");
        }
        // Every command must target /event/codex — never the bare path
        for c in commands_in(&root) {
            assert!(c.contains("/event/codex"), "wrong target: {c}");
        }
    }

    #[test]
    fn imported_pollution_is_stripped() {
        // THE bug fix. Codex's onboarding copied our Claude hooks in, pointing at the bare /event
        // path — which means claude. Approved, they'd count every Codex event as a Claude session.
        let mut root = imported_pollution();
        let p = plan(&mut root, PORT).unwrap();
        assert_eq!(p.stripped, 6, "all six imported hooks must go");
        for c in commands_in(&root) {
            assert!(
                c.contains("/event/codex"),
                "a bare-/event hook survived in Codex's config: {c}"
            );
        }
    }

    #[test]
    fn the_users_own_hooks_are_never_touched() {
        let mine = "echo hello";
        let other = "my-own-linter --check";
        let mut root = json!({"hooks": {
            "PreToolUse": [{"hooks": [{"type": "command", "command": mine}]}],
            "Stop": [{"hooks": [{"type": "command", "command": other, "timeout": 30}]}],
        }});
        plan(&mut root, PORT).unwrap();
        let cmds = commands_in(&root);
        assert!(cmds.contains(&mine.to_string()), "user's PreToolUse hook vanished");
        assert!(cmds.contains(&other.to_string()), "user's Stop hook vanished");
    }

    #[test]
    fn a_group_mixing_our_hook_with_the_users_is_left_alone() {
        // If someone hand-merged our hook into a group with theirs, rewriting the group would mean
        // touching their hook. Don't. Leave the whole group; we just add ours separately.
        let polluted = "curl -s -X POST http://127.0.0.1:8737/event --data-binary @-";
        let mut root = json!({"hooks": {
            "Stop": [{"hooks": [
                {"type": "command", "command": polluted},
                {"type": "command", "command": "their-thing"},
            ]}],
        }});
        let p = plan(&mut root, PORT).unwrap();
        assert_eq!(p.stripped, 0, "a mixed group must not be rewritten");
        assert!(commands_in(&root).contains(&"their-thing".to_string()));
    }

    #[test]
    fn installing_twice_changes_nothing_the_second_time() {
        let mut root = json!({});
        plan(&mut root, PORT).unwrap();
        let after_first = root.clone();
        let p = plan(&mut root, PORT).unwrap();
        assert_eq!(p, Plan::default(), "second run must be a no-op");
        assert_eq!(root, after_first);
    }

    #[test]
    fn a_re_import_is_cleaned_up_again() {
        // Codex can re-import at any time, re-polluting a file we already fixed. Re-running the
        // install must fix it again — the cleanup is not a one-shot.
        let mut root = json!({});
        plan(&mut root, PORT).unwrap();
        // Codex re-imports: a bare-/event hook reappears next to ours
        root["hooks"]["Stop"].as_array_mut().unwrap().push(json!({
            "hooks": [{"type": "command",
                       "command": "curl -s -X POST http://127.0.0.1:8737/event --data-binary @-"}]
        }));
        let p = plan(&mut root, PORT).unwrap();
        assert_eq!(p.stripped, 1);
        assert_eq!(p.added, 0, "ours was still there");
        for c in commands_in(&root) {
            assert!(c.contains("/event/codex"));
        }
    }

    #[test]
    fn an_upgrade_that_adds_an_event_is_detected_and_filled_in() {
        let mut root = json!({});
        plan(&mut root, PORT).unwrap();
        // Simulate an older install that never had PermissionRequest
        root["hooks"].as_object_mut().unwrap().remove("PermissionRequest");
        let p = plan(&mut root, PORT).unwrap();
        assert_eq!(p.added, 1);
        assert!(root["hooks"]["PermissionRequest"].is_array());
    }

    #[test]
    fn the_hook_command_always_emits_valid_json_on_stdout() {
        // Codex (and every other agent) logs an error if the hook process writes nothing or garbage.
        // curl prints our `{}` reply — but an offline pet means no reply at all, hence the fallback.
        let c = cmd_for(PORT);
        assert!(c.contains("|| echo '{}'"), "no JSON fallback when the pet is down: {c}");
        assert!(c.contains("-m 3"), "curl must be bounded under Codex's hook timeout");
    }

    #[test]
    fn a_hostile_hooks_json_is_refused_not_mangled() {
        let mut arr = json!([1, 2, 3]);
        assert!(plan(&mut arr, PORT).is_err());
        let mut bad_hooks = json!({"hooks": "not an object"});
        assert!(plan(&mut bad_hooks, PORT).is_err());
    }

    #[test]
    fn a_different_port_is_not_confused_with_ours() {
        // Someone else's curl to another port on the same box is not our hook to strip.
        let theirs = "curl -s -X POST http://127.0.0.1:9999/event --data-binary @-";
        let mut root = json!({"hooks": {"Stop": [{"hooks": [{"command": theirs}]}]}});
        let p = plan(&mut root, PORT).unwrap();
        assert_eq!(p.stripped, 0);
        assert!(commands_in(&root).contains(&theirs.to_string()));
    }
}
