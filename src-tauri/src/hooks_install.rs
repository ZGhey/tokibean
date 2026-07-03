// 一键安装 Claude Code hooks
// 往 ~/.claude/settings.json 里 merge 五个事件的 command hook(用 curl 转发到本地端口)
// - 写入前备份为 settings.json.bak-claude-pet
// - 幂等:命令里已包含本端口地址的事件会跳过
// - 用 curl 而不是 http 类型 hook,是为了兼容更多 Claude Code 版本;
//   curl 在 Win10+/macOS/主流 Linux 都自带

use serde_json::{json, Value};
use std::fs;

const EVENTS: [&str; 7] = [
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "Stop",
    "Notification",
    "SessionStart",
    "SessionEnd",
];

/// 检查已装 hooks 是否缺事件(比如升级后新增的事件),缺则面板重新亮出安装按钮
pub fn incomplete(port: u16) -> bool {
    let Some(home) = dirs::home_dir() else { return true };
    let Ok(text) = fs::read_to_string(home.join(".claude").join("settings.json")) else {
        return true;
    };
    let Ok(root) = serde_json::from_str::<Value>(&text) else { return true };
    let marker = format!("127.0.0.1:{}/event", port);
    EVENTS.iter().any(|ev| {
        root["hooks"][ev]
            .as_array()
            .map(|arr| !serde_json::to_string(arr).unwrap_or_default().contains(&marker))
            .unwrap_or(true)
    })
}

pub fn install(port: u16) -> Result<String, String> {
    let home = dirs::home_dir().ok_or("找不到用户主目录")?;
    let dir = home.join(".claude");
    let path = dir.join("settings.json");

    let mut root: Value = if path.exists() {
        let text = fs::read_to_string(&path).map_err(|e| format!("读取 settings.json 失败:{}", e))?;
        // 备份
        let _ = fs::write(dir.join("settings.json.bak-claude-pet"), &text);
        serde_json::from_str(&text).map_err(|e| format!("settings.json 不是合法 JSON:{}", e))?
    } else {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        json!({})
    };

    if !root.is_object() {
        return Err("settings.json 顶层不是对象,不敢动它".into());
    }

    let marker = format!("127.0.0.1:{}/event", port);
    let cmd = format!(
        "curl -s -m 3 -X POST http://127.0.0.1:{}/event -H \"Content-Type: application/json\" --data-binary @-",
        port
    );

    let hooks = root
        .as_object_mut()
        .unwrap()
        .entry("hooks")
        .or_insert_with(|| json!({}));
    if !hooks.is_object() {
        return Err("settings.json 里的 hooks 字段不是对象,不敢动它".into());
    }

    let mut added: Vec<&str> = Vec::new();
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
        let already = serde_json::to_string(&arr).unwrap_or_default().contains(&marker);
        if already {
            continue;
        }
        arr.as_array_mut().unwrap().push(json!({
            "hooks": [{
                "type": "command",
                "command": cmd,
                "timeout": 5
            }]
        }));
        added.push(event);
    }

    fs::write(&path, serde_json::to_string_pretty(&root).unwrap())
        .map_err(|e| format!("写入 settings.json 失败:{}", e))?;

    if added.is_empty() {
        Ok("hooks 已经装过了,无需重复安装".into())
    } else {
        Ok(format!(
            "已安装 {} 个 hook({})。重启 Claude Code 或在其中执行 /hooks 使其生效",
            added.len(),
            added.join(", ")
        ))
    }
}
