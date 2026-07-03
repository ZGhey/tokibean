// 官方用量:用本机 Claude Code 的 OAuth 凭据查 Anthropic 官方用量接口
// 凭据只在本进程内存里使用,只发给 api.anthropic.com,不落盘不外传。
// 拿不到凭据或接口失败时返回 None,上层回退到本地估算。

use serde::Serialize;

#[derive(Clone, Serialize, Default)]
pub struct OfficialUsage {
    /// 5 小时窗口利用率,0.0-1.0
    pub five_pct: f64,
    /// 窗口重置的 epoch 秒,0 = 未知
    pub five_reset_ts: i64,
    /// 周限额利用率,0.0-1.0
    pub week_pct: Option<f64>,
}

use crate::login::OAUTH_CLIENT_ID;
use crate::state::Shared;

/// Windows 下不弹控制台黑框(GUI 应用里 curl/wsl 子进程会闪窗)
#[cfg(target_os = "windows")]
pub fn no_window(c: &mut std::process::Command) {
    use std::os::windows::process::CommandExt;
    c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
}
#[cfg(not(target_os = "windows"))]
pub fn no_window(_c: &mut std::process::Command) {}

/// 走刷新流程换新令牌,返回 (access, refresh, expires_in_secs)
fn refresh_grant(refresh: &str) -> Option<(String, String, i64)> {
    use std::io::Write as _;
    use std::process::{Command, Stdio};
    let body = serde_json::json!({
        "grant_type": "refresh_token",
        "refresh_token": refresh,
        "client_id": OAUTH_CLIENT_ID,
    });
    let mut cmd = Command::new("curl");
    no_window(&mut cmd);
    let mut child = cmd
        .args([
            "-s", "-m", "10", "-X", "POST",
            "-H", "Content-Type: application/json",
            "--data-binary", "@-",
            "https://console.anthropic.com/v1/oauth/token",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    child.stdin.as_mut()?.write_all(body.to_string().as_bytes()).ok()?;
    let out = child.wait_with_output().ok()?;
    let resp: serde_json::Value = serde_json::from_str(&String::from_utf8_lossy(&out.stdout)).ok()?;
    Some((
        resp["access_token"].as_str()?.to_string(),
        resp["refresh_token"].as_str().unwrap_or(refresh).to_string(),
        resp["expires_in"].as_i64().unwrap_or(3600),
    ))
}

/// 面板"连接 Claude 账号"存的令牌,过期自动续期并写回配置
fn pet_token(shared: &Shared) -> Option<String> {
    let (access, refresh, expires_ms) = {
        let cfg = shared.cfg.lock().unwrap();
        (cfg.oauth_access.clone(), cfg.oauth_refresh.clone(), cfg.oauth_expires_ms)
    };
    if access.is_empty() {
        return None;
    }
    let now_ms = chrono::Utc::now().timestamp_millis();
    if expires_ms == 0 || now_ms < expires_ms - 120_000 {
        return Some(access);
    }
    if refresh.is_empty() {
        return Some(access);
    }
    let (new_access, new_refresh, expires_in) = refresh_grant(&refresh)?;
    {
        let mut cfg = shared.cfg.lock().unwrap();
        cfg.oauth_access = new_access.clone();
        cfg.oauth_refresh = new_refresh;
        cfg.oauth_expires_ms = now_ms + expires_in * 1000;
        let _ = cfg.save();
    }
    eprintln!("[claude-pet] 官方模式:账号令牌已续期");
    Some(new_access)
}

/// 依次尝试:宠物账号令牌 → credentials.json(可续期)→ 各平台凭据存储
/// → 宠物配置/环境变量(setup-token 的长期令牌,部分接口权限不足,兜底)
fn get_token(shared: &Shared, cfg_token: &str) -> Option<String> {
    // 0) 面板一键连接存的令牌
    if let Some(tok) = pet_token(shared) {
        return Some(tok);
    }
    // 1) ~/.claude/.credentials.json,过期则用 refreshToken 续期
    if let Some(tok) = token_from_credentials_file() {
        return Some(tok);
    }
    // 2) Windows 凭据管理器
    #[cfg(target_os = "windows")]
    {
        for name in ["Claude Code-credentials", "Claude Code", "claude"] {
            if let Some(blob) = windows_cred::read(name) {
                if let Some(tok) = token_from_blob(&blob) {
                    return Some(tok);
                }
            }
        }
    }
    // 3) macOS Keychain
    #[cfg(target_os = "macos")]
    {
        if let Ok(out) = std::process::Command::new("security")
            .args(["find-generic-password", "-s", "Claude Code-credentials", "-w"])
            .output()
        {
            if out.status.success() {
                let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if let Some(tok) = token_from_blob(text.as_bytes()) {
                    return Some(tok);
                }
            }
        }
    }
    // 4) 宠物配置 / 环境变量(长期令牌兜底)
    if !cfg_token.trim().is_empty() {
        return Some(cfg_token.trim().to_string());
    }
    if let Ok(tok) = std::env::var("CLAUDE_CODE_OAUTH_TOKEN") {
        if !tok.trim().is_empty() {
            return Some(tok.trim().to_string());
        }
    }
    None
}

/// 读 credentials.json;accessToken 快过期时用 refreshToken 续期并写回,
/// 这样即使用户从不打开 CLI,凭据也一直有效
fn token_from_credentials_file() -> Option<String> {
    let path = dirs::home_dir()?.join(".claude").join(".credentials.json");
    let text = std::fs::read_to_string(&path).ok()?;
    let mut root: serde_json::Value = serde_json::from_str(&text).ok()?;
    let oauth = root.get("claudeAiOauth")?.clone();
    let access = oauth["accessToken"].as_str().unwrap_or("");
    if access.is_empty() {
        return None;
    }
    let expires_at = oauth["expiresAt"].as_i64().unwrap_or(0); // 毫秒
    let now_ms = chrono::Utc::now().timestamp_millis();
    if expires_at == 0 || now_ms < expires_at - 120_000 {
        return Some(access.to_string());
    }
    // 过期(或 2 分钟内将过期):刷新
    let refresh = oauth["refreshToken"].as_str().unwrap_or("");
    if refresh.is_empty() {
        return Some(access.to_string()); // 没法刷,先用旧的碰运气
    }
    let (new_access, new_refresh, expires_in) = refresh_grant(refresh)?;
    // 写回,和 Claude Code 自己的格式保持一致
    let obj = root.get_mut("claudeAiOauth")?.as_object_mut()?;
    obj.insert("accessToken".into(), serde_json::Value::String(new_access.clone()));
    obj.insert("refreshToken".into(), serde_json::Value::String(new_refresh));
    obj.insert(
        "expiresAt".into(),
        serde_json::Value::Number((now_ms + expires_in * 1000).into()),
    );
    let _ = std::fs::write(&path, serde_json::to_string(&root).unwrap_or(text));
    eprintln!("[claude-pet] 官方模式:credentials.json 令牌已续期");
    Some(new_access)
}

/// 凭据 blob 可能是整段 JSON({"claudeAiOauth":{...}}),也可能就是裸 token
fn token_from_blob(blob: &[u8]) -> Option<String> {
    // UTF-8 优先,含 NUL 时按 UTF-16LE 解
    let text = if blob.iter().take(64).any(|&b| b == 0) {
        let units: Vec<u16> = blob
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(blob).to_string()
    };
    let text = text.trim().trim_matches('\0').to_string();
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
        if let Some(tok) = v["claudeAiOauth"]["accessToken"].as_str() {
            return Some(tok.to_string());
        }
        if let Some(tok) = v["accessToken"].as_str() {
            return Some(tok.to_string());
        }
    }
    if text.starts_with("sk-ant-oat") {
        return Some(text);
    }
    None
}

/// 查官方接口。token 通过 stdin 传给 curl(-H @-),避免出现在进程命令行里
pub enum FetchOutcome {
    Ok(OfficialUsage),
    RateLimited,
    Fail,
}

pub fn fetch(shared: &Shared, cfg_token: &str) -> FetchOutcome {
    fetch_inner(shared, cfg_token).unwrap_or(FetchOutcome::Fail)
}

fn fetch_inner(shared: &Shared, cfg_token: &str) -> Option<FetchOutcome> {
    use std::io::Write as _;
    use std::process::{Command, Stdio};

    let Some(token) = get_token(shared, cfg_token) else {
        eprintln!("[claude-pet] 官方模式:未找到 Claude Code 凭据");
        return None;
    };
    let mut cmd = Command::new("curl");
    no_window(&mut cmd);
    let mut child = cmd
        .args([
            "-s",
            "-m",
            "8",
            "-H",
            "@-",
            "-H",
            "anthropic-beta: oauth-2025-04-20",
            "https://api.anthropic.com/api/oauth/usage",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    child
        .stdin
        .as_mut()?
        .write_all(format!("Authorization: Bearer {}", token).as_bytes())
        .ok()?;
    let out = child.wait_with_output().ok()?;
    if !out.status.success() {
        eprintln!("[claude-pet] 官方模式:curl 失败({})", out.status);
        return None;
    }
    let body = String::from_utf8_lossy(&out.stdout);
    if let Some(u) = parse(&body) {
        return Some(FetchOutcome::Ok(u));
    }
    if body.contains("rate_limit") {
        eprintln!("[claude-pet] 官方模式:被限流,退避 5 分钟");
        return Some(FetchOutcome::RateLimited);
    }
    let head: String = body.chars().take(200).collect();
    eprintln!("[claude-pet] 官方模式:响应无法解析:{}", head);
    None
}

fn parse(body: &str) -> Option<OfficialUsage> {
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    // 字段名做几种兼容:five_hour / 5h,utilization 可能是 0-100 或 0-1
    let five = v
        .get("five_hour")
        .or_else(|| v.get("5h"))
        .or_else(|| v.get("session"))?;
    let norm = |x: f64| if x > 1.5 { x / 100.0 } else { x };
    let five_pct = norm(five["utilization"].as_f64()?);
    let five_reset_ts = five["resets_at"]
        .as_str()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.timestamp())
        .unwrap_or(0);
    let week_pct = v
        .get("seven_day")
        .or_else(|| v.get("7d"))
        .and_then(|w| w["utilization"].as_f64())
        .map(norm);
    Some(OfficialUsage {
        five_pct,
        five_reset_ts,
        week_pct,
    })
}

#[cfg(target_os = "windows")]
mod windows_cred {
    // 手写 CredReadW FFI,不引新依赖
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;

    #[repr(C)]
    struct Credential {
        flags: u32,
        cred_type: u32,
        target_name: *mut u16,
        comment: *mut u16,
        last_written: [u32; 2],
        blob_size: u32,
        blob: *mut u8,
        persist: u32,
        attribute_count: u32,
        attributes: *mut c_void,
        target_alias: *mut u16,
        user_name: *mut u16,
    }

    #[link(name = "advapi32")]
    unsafe extern "system" {
        fn CredReadW(
            target: *const u16,
            cred_type: u32,
            flags: u32,
            credential: *mut *mut Credential,
        ) -> i32;
        fn CredFree(buffer: *mut c_void);
    }

    pub fn read(target: &str) -> Option<Vec<u8>> {
        let wide: Vec<u16> = std::ffi::OsStr::new(target)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        unsafe {
            let mut cred: *mut Credential = std::ptr::null_mut();
            // CRED_TYPE_GENERIC = 1
            if CredReadW(wide.as_ptr(), 1, 0, &mut cred) == 0 || cred.is_null() {
                return None;
            }
            let c = &*cred;
            let blob = std::slice::from_raw_parts(c.blob, c.blob_size as usize).to_vec();
            CredFree(cred as *mut c_void);
            Some(blob)
        }
    }
}
