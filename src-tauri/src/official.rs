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

/// Token source: the pet's OWN connected credential only.
/// As a standalone app it never borrows another client's token (local `~/.claude/.credentials.json`,
/// WSL distros, macOS Keychain, Windows Credential Manager) — those rotate/expire/rate-limit outside
/// our control and drag the pet down with them. The user connects once via the panel ("Connect Claude
/// account", `login.rs`), we store the credential in our own config and refresh it independently with
/// backoff. A manually configured long-lived token / env var is the only other, explicitly-opt-in source.
fn get_token(shared: &Shared, cfg_token: &str) -> Option<String> {
    // The pet's own connected credential: valid → use as-is; expired → refresh with its own
    // refreshToken (shared 15-min backoff), writing the rotated token back to our config.
    if let Some(tok) = pet_token(shared) {
        return Some(tok);
    }
    // Explicit power-user override: a deliberately configured long-lived token / env var.
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
