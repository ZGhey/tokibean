// 一键安装 Claude Code hooks
// 往 ~/.claude/settings.json 里 merge 各事件的 command hook(用 curl 转发到本地端口)
// - 写入前备份为 settings.json.bak-claude-pet
// - 幂等:命令里已包含本端口地址的事件会跳过
// - 用 curl 而不是 http 类型 hook,是为了兼容更多 Claude Code 版本;
//   curl 在 Win10+/macOS/主流 Linux 都自带
// - Windows 上顺带同步到所有 WSL 发行版:WSL 里的 Claude Code 读的是
//   Linux 侧的 ~/.claude/settings.json,只装 Windows 侧它感知不到

use serde_json::{json, Value};
use std::fs;
use std::path::Path;

const EVENTS: [&str; 7] = [
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "Stop",
    "Notification",
    "SessionStart",
    "SessionEnd",
];

/// 检查已装 hooks 是否缺事件(升级新增的事件 / 新出现的 WSL 发行版),
/// 缺则面板重新亮出安装按钮
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

/// 往一个 settings.json 里 merge hooks,返回新增的事件数
fn merge_into(path: &Path, cmd: &str, port: u16) -> Result<usize, String> {
    let dir = path.parent().ok_or("路径异常")?;
    let mut root: Value = if path.exists() {
        let text = fs::read_to_string(path).map_err(|e| format!("读取 settings.json 失败:{}", e))?;
        // 备份
        let _ = fs::write(dir.join("settings.json.bak-claude-pet"), &text);
        serde_json::from_str(&text).map_err(|e| format!("settings.json 不是合法 JSON:{}", e))?
    } else {
        json!({})
    };

    if !root.is_object() {
        return Err("settings.json 顶层不是对象,不敢动它".into());
    }
    let marker = format!(":{}/event", port);
    let hooks = root
        .as_object_mut()
        .unwrap()
        .entry("hooks")
        .or_insert_with(|| json!({}));
    if !hooks.is_object() {
        return Err("settings.json 里的 hooks 字段不是对象,不敢动它".into());
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
        // 幂等检查:该事件下是否已经有指向本端口的 hook
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
            .map_err(|e| format!("写入 settings.json 失败:{}", e))?;
    }
    Ok(added)
}

pub fn install(port: u16) -> Result<String, String> {
    let home = dirs::home_dir().ok_or("找不到用户主目录")?;
    let dir = home.join(".claude");
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    let local_cmd = format!(
        "curl -s -m 3 -X POST http://127.0.0.1:{}/event -H \"Content-Type: application/json\" --data-binary @-",
        port
    );
    let added = merge_into(&dir.join("settings.json"), &local_cmd, port)?;

    // 同步 WSL:只写已经有 ~/.claude 的用户(在用 Claude Code 的才需要)
    let mut wsl_note = String::new();
    #[cfg(target_os = "windows")]
    {
        let targets = wsl_claude_dirs();
        if !targets.is_empty() {
            let mirrored = wsl_mirrored();
            let cmd = if mirrored {
                // 镜像网络:WSL 与 Windows 共享回环,127.0.0.1 直通
                local_cmd.clone()
            } else {
                // NAT 模式:127.0.0.1 指向 WSL 自身,运行时用默认网关(Windows 主机)代替
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
                wsl_note = format!(",并同步 {} 个 WSL 配置", synced);
                if !mirrored {
                    wsl_note.push_str("(NAT 模式还需在宠物配置把 bind 设为 0.0.0.0 并重启宠物)");
                }
            }
        }
    }

    if added == 0 && wsl_note.is_empty() {
        Ok("hooks 已经装过了,无需重复安装".into())
    } else {
        let head = if added > 0 {
            format!("已安装 {} 个 hook", added)
        } else {
            "Windows 侧已就绪".to_string()
        };
        Ok(format!(
            "{}{}。重启 Claude Code 或在其中执行 /hooks 使其生效",
            head, wsl_note
        ))
    }
}

/// 枚举 WSL 发行版里已存在的 .claude 目录(\\wsl$ 访问,同 usage.rs 的发现逻辑)
#[cfg(target_os = "windows")]
fn wsl_claude_dirs() -> Vec<std::path::PathBuf> {
    use std::path::PathBuf;
    let mut out = Vec::new();
    let mut cmd = std::process::Command::new("wsl.exe");
    crate::official::no_window(&mut cmd);
    let Ok(o) = cmd.args(["-l", "-q"]).output() else { return out };
    if !o.status.success() {
        return out;
    }
    // wsl.exe 输出是 UTF-16LE
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

/// .wslconfig 是否启用了镜像网络(networkingMode=mirrored)
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
