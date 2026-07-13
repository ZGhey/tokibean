// One-click install of Claude Code hooks.
// Merges a command hook for each event into ~/.claude/settings.json (using curl
// to forward to the local port).
// - Backs up to settings.json.bak-claude-pet before writing.
// - Idempotent: events whose command already contains this port are skipped.
// - Uses curl rather than an http-type hook for compatibility with more Claude
//   Code versions; curl ships by default on Win10+/macOS/mainstream Linux.
// - On Windows it also syncs to every WSL distro: Claude Code inside WSL reads
//   the Linux-side ~/.claude/settings.json, so a Windows-only install is
//   invisible to it.

use serde_json::{json, Value};
use std::fs;
use std::path::Path;

const EVENTS: [&str; 8] = [
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "Stop",
    "Notification",
    "SessionStart",
    "SessionEnd",
    // Fires when a subagent finishes — the only reliable "subagent done" signal. Background subagents
    // (default since CC v2.1.198) return from the Agent tool immediately, so PostToolUse can't be used.
    "SubagentStop",
];

/// Checks whether the installed hooks are missing any event (newly added events
/// after an upgrade / newly appeared WSL distros); if so, the panel re-surfaces
/// the install button.
pub fn incomplete(cfg: &crate::config::Config) -> bool {
    let port = cfg.port;
    // An agent that isn't here has nothing to install. Saying "incomplete" about a directory that
    // doesn't exist is what showed an "Install Claude Code hooks" button to people who had never
    // touched Claude Code — and clicking it created the directory for them (ADR-0014).
    //
    // `installed()` is the right question to ask, NOT "does the Windows-side directory exist": on
    // Windows, Claude Code is often only inside WSL, and that user's Windows-side ~/.claude is absent
    // while his WSL one is not. Checking the local path alone would hide the install button from the
    // very user the WSL sync below was built for.
    if !crate::agents::installed(cfg, crate::state::AGENT_CLAUDE) {
        return false;
    }
    let Some(dir) = crate::agents::dir(cfg, crate::state::AGENT_CLAUDE) else { return false };
    // Only judge the local settings.json if the local install is actually there — a WSL-only user has
    // no Windows-side file to be incomplete, and his WSL ones are checked below.
    if dir.is_dir() && file_incomplete(&dir.join("settings.json"), port) {
        return true;
    }
    #[cfg(target_os = "windows")]
    for dir in crate::wsl::claude_dirs() {
        if file_incomplete(&dir.join("settings.json"), port) {
            return true;
        }
    }
    false
}

fn file_incomplete(path: &Path, port: u16) -> bool {
    let Ok(text) = fs::read_to_string(path) else { return true };
    let Ok(root) = serde_json::from_str::<Value>(&text) else { return true };
    let marker = format!(":{}/event", port);
    EVENTS.iter().any(|ev| {
        root["hooks"][ev]
            .as_array()
            .map(|arr| !serde_json::to_string(arr).unwrap_or_default().contains(&marker))
            .unwrap_or(true)
    })
}

/// Merges hooks into one settings.json; returns the number of events added.
fn merge_into(path: &Path, cmd: &str, port: u16) -> Result<usize, String> {
    let dir = path.parent().ok_or_else(|| crate::i18n::t("路径异常", "Invalid path"))?;
    let mut root: Value = if path.exists() {
        let text = fs::read_to_string(path)
            .map_err(|e| format!("{}: {}", crate::i18n::t("读取 settings.json 失败", "Failed to read settings.json"), e))?;
        // Back up.
        let _ = fs::write(dir.join("settings.json.bak-claude-pet"), &text);
        serde_json::from_str(&text)
            .map_err(|e| format!("{}: {}", crate::i18n::t("settings.json 不是合法 JSON", "settings.json is not valid JSON"), e))?
    } else {
        json!({})
    };

    if !root.is_object() {
        return Err(crate::i18n::t("settings.json 顶层不是对象,不敢动它", "The top level of settings.json is not an object; refusing to touch it").into());
    }
    let marker = format!(":{}/event", port);
    let hooks = root
        .as_object_mut()
        .unwrap()
        .entry("hooks")
        .or_insert_with(|| json!({}));
    if !hooks.is_object() {
        return Err(crate::i18n::t("settings.json 里的 hooks 字段不是对象,不敢动它", "The `hooks` field in settings.json is not an object; refusing to touch it").into());
    }

    let mut added = 0usize;
    for event in EVENTS {
        let arr = hooks
            .as_object_mut()
            .unwrap()
            .entry(event)
            .or_insert_with(|| json!([]));
        if !arr.is_array() {
            continue;
        }
        // Idempotency check: does this event already have a hook pointing at this port?
        if serde_json::to_string(&arr).unwrap_or_default().contains(&marker) {
            continue;
        }
        arr.as_array_mut().unwrap().push(json!({
            "hooks": [{
                "type": "command",
                "command": cmd,
                "timeout": 5
            }]
        }));
        added += 1;
    }

    if added > 0 {
        fs::write(path, serde_json::to_string_pretty(&root).unwrap())
            .map_err(|e| format!("{}: {}", crate::i18n::t("写入 settings.json 失败", "Failed to write settings.json"), e))?;
    }
    Ok(added)
}

pub fn install(cfg: &crate::config::Config) -> Result<String, String> {
    let port = cfg.port;
    let dir = crate::agents::dir(cfg, crate::state::AGENT_CLAUDE)
        .ok_or_else(|| crate::i18n::t("找不到用户主目录", "Cannot find the user home directory").to_string())?;
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    // `|| exit 0`: the POST is fire-and-forget, so when the pet isn't running curl exits non-zero
    // (connection refused / timeout) and Claude Code prints a "hook error" on every event. Swallow
    // the failure so a closed pet is silent; a successful POST (pet up) still exits 0 unchanged.
    let local_cmd = format!(
        "curl -s -m 3 -X POST http://127.0.0.1:{}/event -H \"Content-Type: application/json\" --data-binary @- || exit 0",
        port
    );
    let added = merge_into(&dir.join("settings.json"), &local_cmd, port)?;

    // Sync WSL: only write for users that already have ~/.claude (only those
    // actually using Claude Code need it).
    // Only mutated inside the Windows-only WSL-sync block below
    #[cfg_attr(not(target_os = "windows"), allow(unused_mut))]
    let mut wsl_note = String::new();
    #[cfg(target_os = "windows")]
    {
        let targets = crate::wsl::claude_dirs();
        if !targets.is_empty() {
            let mirrored = wsl_mirrored();
            let cmd = if mirrored {
                // Mirrored networking: WSL and Windows share the loopback, so
                // 127.0.0.1 passes straight through.
                local_cmd.clone()
            } else {
                // NAT mode: 127.0.0.1 points at WSL itself, so at runtime we
                // substitute the default gateway (the Windows host).
                format!(
                    "curl -s -m 3 -X POST http://$(ip route show default | awk '{{print $3}}'):{}/event -H \"Content-Type: application/json\" --data-binary @- || exit 0",
                    port
                )
            };
            let mut synced = 0usize;
            for d in &targets {
                if matches!(merge_into(&d.join("settings.json"), &cmd, port), Ok(n) if n > 0) {
                    synced += 1;
                }
            }
            if synced > 0 {
                wsl_note = if crate::i18n::is_zh() {
                    format!(",并同步 {} 个 WSL 配置", synced)
                } else {
                    format!(", and synced {} WSL config(s)", synced)
                };
                if !mirrored {
                    wsl_note.push_str(crate::i18n::t(
                        "(NAT 模式还需在宠物配置把 bind 设为 0.0.0.0 并重启宠物)",
                        " (NAT mode also requires setting bind to 0.0.0.0 in the pet config and restarting the pet)",
                    ));
                }
            }
        }
    }

    if added == 0 && wsl_note.is_empty() {
        Ok(crate::i18n::t("hooks 已经装过了,无需重复安装", "Hooks are already installed; no need to reinstall.").into())
    } else {
        let head = if added > 0 {
            if crate::i18n::is_zh() {
                format!("已安装 {} 个 hook", added)
            } else {
                format!("Installed {} hook(s)", added)
            }
        } else {
            crate::i18n::t("Windows 侧已就绪", "The Windows side is ready").to_string()
        };
        Ok(if crate::i18n::is_zh() {
            format!("{}{}。重启 Claude Code 或在其中执行 /hooks 使其生效", head, wsl_note)
        } else {
            format!("{}{}. Restart Claude Code or run /hooks inside it to take effect.", head, wsl_note)
        })
    }
}

/// Whether .wslconfig has mirrored networking enabled (networkingMode=mirrored).
#[cfg(target_os = "windows")]
fn wsl_mirrored() -> bool {
    dirs::home_dir()
        .and_then(|h| fs::read_to_string(h.join(".wslconfig")).ok())
        .map(|t| {
            t.to_lowercase()
                .replace([' ', '\t'], "")
                .contains("networkingmode=mirrored")
        })
        .unwrap_or(false)
}
