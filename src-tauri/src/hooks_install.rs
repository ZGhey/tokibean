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
pub fn incomplete(port: u16) -> bool {
    let Some(home) = dirs::home_dir() else { return true };
    if file_incomplete(&home.join(".claude").join("settings.json"), port) {
        return true;
    }
    #[cfg(target_os = "windows")]
    for dir in wsl_claude_dirs() {
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

pub fn install(port: u16) -> Result<String, String> {
    let home = dirs::home_dir().ok_or_else(|| crate::i18n::t("找不到用户主目录", "Cannot find the user home directory"))?;
    let dir = home.join(".claude");
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    let local_cmd = format!(
        "curl -s -m 3 -X POST http://127.0.0.1:{}/event -H \"Content-Type: application/json\" --data-binary @-",
        port
    );
    let added = merge_into(&dir.join("settings.json"), &local_cmd, port)?;

    // Sync WSL: only write for users that already have ~/.claude (only those
    // actually using Claude Code need it).
    let mut wsl_note = String::new();
    #[cfg(target_os = "windows")]
    {
        let targets = wsl_claude_dirs();
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
                    "curl -s -m 3 -X POST http://$(ip route show default | awk '{{print $3}}'):{}/event -H \"Content-Type: application/json\" --data-binary @-",
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

/// Enumerates existing .claude directories inside WSL distros (accessed via
/// \\wsl$, same discovery logic as usage.rs).
#[cfg(target_os = "windows")]
pub fn wsl_claude_dirs() -> Vec<std::path::PathBuf> {
    use std::path::PathBuf;
    let mut out = Vec::new();
    let mut cmd = std::process::Command::new("wsl.exe");
    crate::official::no_window(&mut cmd);
    let Ok(o) = cmd.args(["-l", "-q"]).output() else { return out };
    if !o.status.success() {
        return out;
    }
    // wsl.exe outputs UTF-16LE.
    let text = if o.stdout.iter().take(8).any(|&b| b == 0) {
        let units: Vec<u16> = o
            .stdout
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(&o.stdout).to_string()
    };
    for distro in text.lines().map(|l| l.trim().trim_start_matches('\u{feff}')) {
        if distro.is_empty() {
            continue;
        }
        let base = PathBuf::from(format!(r"\\wsl$\{}", distro));
        if let Ok(entries) = fs::read_dir(base.join("home")) {
            for e in entries.flatten() {
                let p = e.path().join(".claude");
                if p.is_dir() {
                    out.push(p);
                }
            }
        }
        let rootp = base.join("root").join(".claude");
        if rootp.is_dir() {
            out.push(rootp);
        }
    }
    out
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
