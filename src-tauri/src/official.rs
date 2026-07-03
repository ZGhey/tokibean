// Official usage: query Anthropic's official usage API using the local Claude Code OAuth credentials.
// Credentials are only used in this process's memory and only sent to api.anthropic.com, never written to disk or shared.
// Returns None when no credential is available or the API fails, and the caller falls back to local estimation.

use serde::Serialize;

#[derive(Clone, Serialize, Default)]
pub struct OfficialUsage {
    /// 5-hour window utilization, 0.0-1.0
    pub five_pct: f64,
    /// Window reset time in epoch seconds, 0 = unknown
    pub five_reset_ts: i64,
    /// Weekly quota utilization, 0.0-1.0
    pub week_pct: Option<f64>,
}

use crate::login::OAUTH_CLIENT_ID;
use crate::state::Shared;

/// Suppress the console window on Windows (curl/wsl subprocesses flash a window in a GUI app)
#[cfg(target_os = "windows")]
pub fn no_window(c: &mut std::process::Command) {
    use std::os::windows::process::CommandExt;
    c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
}
#[cfg(not(target_os = "windows"))]
pub fn no_window(_c: &mut std::process::Command) {}

/// Token refresh backoff: after a failure, don't retry for 15 minutes.
/// Both refresh entry points (pet token / credentials.json) share one backoff,
/// ensuring the token endpoint is hit at most once per time window
fn refresh_allowed(shared: &Shared) -> bool {
    shared
        .refresh_backoff
        .lock()
        .unwrap()
        .map(|t| std::time::Instant::now() >= t)
        .unwrap_or(true)
}

fn note_refresh(shared: &Shared, ok: bool) {
    *shared.refresh_backoff.lock().unwrap() = if ok {
        None
    } else {
        eprintln!("[claude-pet] token refresh failed, backing off for 15 minutes");
        Some(std::time::Instant::now() + std::time::Duration::from_secs(900))
    };
}

/// Run the refresh flow to obtain a new token, returns (access, refresh, expires_in_secs)
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

/// Token saved by the panel's "connect Claude account"; auto-renews on expiry and writes back to config
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
    if refresh.is_empty() || !refresh_allowed(shared) {
        return Some(access); // Try the old token and hope for the best; never hit the token endpoint during backoff
    }
    let Some((new_access, new_refresh, expires_in)) = refresh_grant(&refresh) else {
        note_refresh(shared, false);
        return Some(access);
    };
    note_refresh(shared, true);
    {
        let mut cfg = shared.cfg.lock().unwrap();
        cfg.oauth_access = new_access.clone();
        cfg.oauth_refresh = new_refresh;
        cfg.oauth_expires_ms = now_ms + expires_in * 1000;
        let _ = cfg.save();
    }
    eprintln!("[claude-pet] official mode: account token renewed");
    Some(new_access)
}

/// Token retrieval principle: if a valid credential is already at hand, never hit the token endpoint for a new one.
/// Three-pass scan: (1) ready, unexpired credentials, including macOS Keychain (zero network); (2) refresh only when all expired (with backoff);
/// (3) Windows Credential Manager and long-lived token fallback
fn get_token(shared: &Shared, cfg_token: &str) -> Option<String> {
    // -- Pass 1: ready and unexpired, zero network requests --
    // Token saved by the panel's one-click connect
    if let Some(tok) = pet_token_peek(shared) {
        return Some(tok);
    }
    // Local ~/.claude/.credentials.json
    if let Some(tok) = local_credentials_peek() {
        return Some(tok);
    }
    // macOS Keychain: on macOS the CLI actively maintains credentials in the Keychain,
    // while ~/.claude/.credentials.json may be a stale vestigial file left by an old version that no one refreshes
    // (once its refreshToken is rotated out, continuing to pass 2 only pointlessly hits the token endpoint).
    // Read-only, no refresh, zero network requests, same peak cost as the local file above
    #[cfg(target_os = "macos")]
    if let Some(tok) = macos_keychain_peek() {
        return Some(tok);
    }
    // credentials.json in WSL distros: the CLI uses it daily, so the token is always fresh.
    // Read-only, no refresh -- the refresh token is rotated, and refreshing on its behalf would kick the WSL CLI offline;
    // for that reason only unexpired tokens are accepted
    #[cfg(target_os = "windows")]
    if let Some(tok) = token_from_wsl_credentials() {
        return Some(tok);
    }

    // -- Pass 2: only refresh when everything has expired (shared 15-minute backoff) --
    if let Some(tok) = pet_token(shared) {
        return Some(tok);
    }
    // macOS safeguard: the credential source of truth is the Keychain; ~/.claude/.credentials.json is
    // often a stale file left by an old version (accessToken expired, refreshToken rotated out and dead).
    // As long as this entry still exists in the Keychain (even if expired -- the CLI refreshes it on next use),
    // never force-refresh with this dead file's invalid refreshToken: that would only rate-limit
    // console.anthropic.com and get the panel's "connect Claude account" rejected too. Only Macs whose
    // Keychain is genuinely empty keep the file-refresh fallback
    #[cfg(target_os = "macos")]
    let skip_file_refresh = macos_keychain_present();
    #[cfg(not(target_os = "macos"))]
    let skip_file_refresh = false;
    if !skip_file_refresh {
        if let Some(tok) = token_from_credentials_file(shared) {
            return Some(tok);
        }
    }

    // -- Pass 3: fallback --
    // Windows Credential Manager
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
    // Pet config / environment variable (setup-token's long-lived token)
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

/// Pet token: returned only if unexpired, triggers no renewal
fn pet_token_peek(shared: &Shared) -> Option<String> {
    let cfg = shared.cfg.lock().unwrap();
    if cfg.oauth_access.is_empty() {
        return None;
    }
    let now_ms = chrono::Utc::now().timestamp_millis();
    if cfg.oauth_expires_ms == 0 || now_ms < cfg.oauth_expires_ms - 120_000 {
        Some(cfg.oauth_access.clone())
    } else {
        None
    }
}

/// Local credentials.json: returned only if unexpired, triggers no renewal
fn local_credentials_peek() -> Option<String> {
    let path = dirs::home_dir()?.join(".claude").join(".credentials.json");
    let text = std::fs::read_to_string(&path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    let oauth = &v["claudeAiOauth"];
    let access = oauth["accessToken"].as_str().unwrap_or("");
    if access.is_empty() {
        return None;
    }
    let expires_at = oauth["expiresAt"].as_i64().unwrap_or(0);
    let now_ms = chrono::Utc::now().timestamp_millis();
    if expires_at == 0 || now_ms < expires_at - 120_000 {
        Some(access.to_string())
    } else {
        None
    }
}

/// Credentials in the macOS Keychain: returned only if unexpired, triggers no renewal
#[cfg(target_os = "macos")]
fn macos_keychain_peek() -> Option<String> {
    let out = std::process::Command::new("security")
        .args(["find-generic-password", "-s", "Claude Code-credentials", "-w"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    token_from_blob(text.as_bytes())
}

/// Whether a Claude Code credential entry exists in the macOS Keychain (only checks presence, doesn't read the secret or check expiry).
/// Used to determine "whether the Keychain is this machine's credential source of truth" -- no -w, reads metadata only
#[cfg(target_os = "macos")]
fn macos_keychain_present() -> bool {
    std::process::Command::new("security")
        .args(["find-generic-password", "-s", "Claude Code-credentials"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Read each WSL distro's credentials.json, accepting only tokens with more than 2 minutes of validity left
#[cfg(target_os = "windows")]
fn token_from_wsl_credentials() -> Option<String> {
    let now_ms = chrono::Utc::now().timestamp_millis();
    for dir in crate::hooks_install::wsl_claude_dirs() {
        let Ok(text) = std::fs::read_to_string(dir.join(".credentials.json")) else {
            continue;
        };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else { continue };
        let oauth = &v["claudeAiOauth"];
        let access = oauth["accessToken"].as_str().unwrap_or("");
        if access.is_empty() {
            continue;
        }
        let expires_at = oauth["expiresAt"].as_i64().unwrap_or(0);
        if expires_at == 0 || now_ms < expires_at - 120_000 {
            return Some(access.to_string());
        }
    }
    None
}

/// Read credentials.json; when the accessToken is near expiry, renew via refreshToken and write back,
/// so the credential stays valid even if the user never opens the CLI
fn token_from_credentials_file(shared: &Shared) -> Option<String> {
    let path = dirs::home_dir()?.join(".claude").join(".credentials.json");
    let text = std::fs::read_to_string(&path).ok()?;
    let mut root: serde_json::Value = serde_json::from_str(&text).ok()?;
    let oauth = root.get("claudeAiOauth")?.clone();
    let access = oauth["accessToken"].as_str().unwrap_or("");
    if access.is_empty() {
        return None;
    }
    let expires_at = oauth["expiresAt"].as_i64().unwrap_or(0); // milliseconds
    let now_ms = chrono::Utc::now().timestamp_millis();
    if expires_at == 0 || now_ms < expires_at - 120_000 {
        return Some(access.to_string());
    }
    // Expired (or expiring within 2 minutes): refresh
    let refresh = oauth["refreshToken"].as_str().unwrap_or("");
    if refresh.is_empty() || !refresh_allowed(shared) {
        return Some(access.to_string()); // Can't refresh / in backoff, use the old one and hope for the best
    }
    let Some((new_access, new_refresh, expires_in)) = refresh_grant(refresh) else {
        note_refresh(shared, false);
        return Some(access.to_string());
    };
    note_refresh(shared, true);
    // Write back, keeping Claude Code's own format
    let obj = root.get_mut("claudeAiOauth")?.as_object_mut()?;
    obj.insert("accessToken".into(), serde_json::Value::String(new_access.clone()));
    obj.insert("refreshToken".into(), serde_json::Value::String(new_refresh));
    obj.insert(
        "expiresAt".into(),
        serde_json::Value::Number((now_ms + expires_in * 1000).into()),
    );
    let _ = std::fs::write(&path, serde_json::to_string(&root).unwrap_or(text));
    eprintln!("[claude-pet] official mode: credentials.json token renewed");
    Some(new_access)
}

/// A credential blob may be a full JSON ({"claudeAiOauth":{...}}) or just a bare token
fn token_from_blob(blob: &[u8]) -> Option<String> {
    // Prefer UTF-8; decode as UTF-16LE when NUL bytes are present
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
        // The credential store may also hold expired goods (mac Keychain / Win Credential Manager):
        // validate if expiresAt is present, reject expired ones -- they can't be refreshed and would just eat a 401
        let now_ms = chrono::Utc::now().timestamp_millis();
        let usable = |oauth: &serde_json::Value| -> Option<String> {
            let tok = oauth["accessToken"].as_str()?;
            let exp = oauth["expiresAt"].as_i64().unwrap_or(0);
            if exp == 0 || now_ms < exp - 120_000 {
                Some(tok.to_string())
            } else {
                None
            }
        };
        if v["claudeAiOauth"].is_object() {
            return usable(&v["claudeAiOauth"]);
        }
        if v["accessToken"].is_string() {
            return usable(&v);
        }
    }
    if text.starts_with("sk-ant-oat") {
        return Some(text);
    }
    None
}

/// Query the official API. The token is passed to curl over stdin (-H @-) to keep it off the process command line
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
        eprintln!("[claude-pet] official mode: no Claude Code credential found");
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
        eprintln!("[claude-pet] official mode: curl failed ({})", out.status);
        return None;
    }
    let body = String::from_utf8_lossy(&out.stdout);
    if let Some(u) = parse(&body) {
        return Some(FetchOutcome::Ok(u));
    }
    if body.contains("rate_limit") {
        eprintln!("[claude-pet] official mode: rate limited, backing off for 5 minutes");
        return Some(FetchOutcome::RateLimited);
    }
    let head: String = body.chars().take(200).collect();
    eprintln!("[claude-pet] official mode: could not parse response: {}", head);
    None
}

fn parse(body: &str) -> Option<OfficialUsage> {
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    // Handle several field-name variants: five_hour / 5h; utilization may be 0-100 or 0-1
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
    // Hand-written CredReadW FFI, no new dependency
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
