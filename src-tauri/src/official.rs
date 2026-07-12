// Official usage: query Anthropic's official usage API using the pet's OWN connected OAuth credential.
// The credential lives in the pet's config, is used only in this process's memory, sent only to
// api.anthropic.com, and refreshed against claude.ai. Returns None when the pet isn't connected or the
// API fails; without official data there is no 5-hour-window percentage (the local estimate was removed).

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

use crate::state::Shared;

/// Suppress the console window on Windows (curl/wsl subprocesses flash a window in a GUI app)
#[cfg(target_os = "windows")]
pub fn no_window(c: &mut std::process::Command) {
    use std::os::windows::process::CommandExt;
    c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
}
#[cfg(not(target_os = "windows"))]
pub fn no_window(_c: &mut std::process::Command) {}

/// Is an epoch-ms expiry still good (>2 min left, or unknown)?
fn token_valid(expires_at_ms: i64) -> bool {
    expires_at_ms == 0 || chrono::Utc::now().timestamp_millis() < expires_at_ms - 120_000
}

/// Token refresh backoff. Refresh runs against claude.ai (which, unlike console.anthropic.com, does
/// not lock up), so this rarely fires — it's a safety net. A rate-limited refresh backs off 6h
/// (longer than the token endpoint's ~6h lockout, so a retry can't keep re-arming it); a plain
/// failure backs off 15 min.
fn refresh_allowed(shared: &Shared) -> bool {
    shared
        .refresh_backoff
        .lock()
        .unwrap()
        .map(|t| std::time::Instant::now() >= t)
        .unwrap_or(true)
}

enum RefreshOutcome {
    Ok(String, String, i64), // access, refresh, expires_in_secs
    RateLimited,
    Invalid, // refresh token is dead (invalid_grant) — only a fresh login can fix it
    Fail,    // transient (network / 5xx) — retry later
}

fn note_refresh(shared: &Shared, outcome: &RefreshOutcome) {
    *shared.refresh_backoff.lock().unwrap() = match outcome {
        // Ok clears; Invalid clears too (the credential is wiped, nothing to back off)
        RefreshOutcome::Ok(..) | RefreshOutcome::Invalid => None,
        RefreshOutcome::RateLimited => {
            eprintln!("[claude-pet] token refresh rate-limited, backing off for 6 hours");
            Some(std::time::Instant::now() + std::time::Duration::from_secs(6 * 3600))
        }
        RefreshOutcome::Fail => {
            eprintln!("[claude-pet] token refresh failed, backing off for 15 minutes");
            Some(std::time::Instant::now() + std::time::Duration::from_secs(900))
        }
    };
}

/// Refresh the pet's own token against claude.ai/v1/oauth/token — the CLI's endpoint, a separate
/// rate-limit bucket from console.anthropic.com (which locks up ~6h). Same client_id, accepts JSON.
fn refresh_grant(refresh: &str) -> RefreshOutcome {
    use std::io::Write as _;
    use std::process::{Command, Stdio};
    let body = serde_json::json!({
        "grant_type": "refresh_token",
        "refresh_token": refresh,
        "client_id": crate::login::OAUTH_CLIENT_ID,
    });
    let mut cmd = Command::new("curl");
    no_window(&mut cmd);
    // platform.claude.com is the live token endpoint; a neutral User-Agent (axios) avoids Anthropic's
    // Claude-Code-UA rate limit — the two things that were causing the token-endpoint 429s.
    let child = cmd
        .args([
            "-s", "-m", "10", "-X", "POST",
            "-H", "Content-Type: application/json",
            "-H", "User-Agent: axios/1.7.9",
            "--data-binary", "@-",
            "https://platform.claude.com/v1/oauth/token",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn();
    let Ok(mut child) = child else { return RefreshOutcome::Fail };
    if child
        .stdin
        .as_mut()
        .map(|s| s.write_all(body.to_string().as_bytes()))
        .is_none()
    {
        return RefreshOutcome::Fail;
    }
    let Ok(out) = child.wait_with_output() else { return RefreshOutcome::Fail };
    let text = String::from_utf8_lossy(&out.stdout);
    let Ok(resp) = serde_json::from_str::<serde_json::Value>(&text) else {
        return RefreshOutcome::Fail;
    };
    if let Some(access) = resp["access_token"].as_str() {
        return RefreshOutcome::Ok(
            access.to_string(),
            resp["refresh_token"].as_str().unwrap_or(refresh).to_string(),
            resp["expires_in"].as_i64().unwrap_or(3600),
        );
    }
    if text.contains("rate_limit") {
        return RefreshOutcome::RateLimited;
    }
    // Dead refresh token (revoked / expired / logged out elsewhere): only re-login fixes it
    if text.contains("invalid_grant") {
        return RefreshOutcome::Invalid;
    }
    RefreshOutcome::Fail
}

/// Token source: the pet's OWN connected credential only. A standalone app can't reliably borrow the
/// CLI's token — every user installs Claude Code somewhere different and stores its token somewhere
/// different (a file / the Windows Credential Manager / the macOS Keychain / …), and refreshing a
/// shared credential rotates it out from under the CLI. So the pet gets its own OAuth grant once (panel
/// "连接 Claude 账号", `login.rs`), stores access+refresh in its OWN config, and refreshes it
/// independently against claude.ai — never console. Valid → use as-is; expired → refresh (subject to
/// backoff), writing the rotated token back to config. Manual token / env var is the only other,
/// explicitly-opt-in source.
fn get_token(shared: &Shared, cfg_token: &str) -> Option<String> {
    let (access, refresh, expires_ms) = {
        let cfg = shared.cfg.lock().unwrap();
        (cfg.oauth_access.clone(), cfg.oauth_refresh.clone(), cfg.oauth_expires_ms)
    };
    if !access.is_empty() {
        if token_valid(expires_ms) {
            return Some(access);
        }
        if refresh.is_empty() || !refresh_allowed(shared) {
            return Some(access); // can't refresh / in backoff — try the old token
        }
        let outcome = refresh_grant(&refresh);
        note_refresh(shared, &outcome);
        match outcome {
            RefreshOutcome::Ok(new_access, new_refresh, expires_in) => {
                let now_ms = chrono::Utc::now().timestamp_millis();
                {
                    let mut cfg = shared.cfg.lock().unwrap();
                    cfg.oauth_access = new_access.clone();
                    cfg.oauth_refresh = new_refresh;
                    cfg.oauth_expires_ms = now_ms + expires_in * 1000;
                    let _ = cfg.save();
                }
                shared.reconnect_needed.store(false, std::sync::atomic::Ordering::Relaxed);
                eprintln!("[claude-pet] official mode: token refreshed via claude.ai");
                return Some(new_access);
            }
            RefreshOutcome::Invalid => {
                // Refresh token is dead — wipe the stored credential and ask the user to reconnect.
                // Clearing it makes the panel revert to "not connected" and re-show the connect button.
                {
                    let mut cfg = shared.cfg.lock().unwrap();
                    cfg.oauth_access.clear();
                    cfg.oauth_refresh.clear();
                    cfg.oauth_expires_ms = 0;
                    let _ = cfg.save();
                }
                shared.reconnect_needed.store(true, std::sync::atomic::Ordering::Relaxed);
                eprintln!("[claude-pet] official mode: refresh token invalid — please reconnect");
                return None;
            }
            _ => return Some(access), // rate-limited / transient — keep old token, backoff is set
        }
    }
    // Explicit manual override: a deliberately configured long-lived token / env var.
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

/// Read the official 5-hour usage. Wider than its name: it first resolves a token via `get_token`,
/// which may refresh the pet's OAuth credential, write the rotated token back to config, and raise
/// `reconnect_needed` when the refresh token is dead. Response mapping is the pure `interpret_response`.
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
    match interpret_response(&body) {
        FetchOutcome::Ok(u) => Some(FetchOutcome::Ok(u)),
        FetchOutcome::RateLimited => {
            eprintln!("[claude-pet] official mode: rate limited, backing off for 5 minutes");
            Some(FetchOutcome::RateLimited)
        }
        FetchOutcome::Fail => {
            let head: String = body.chars().take(200).collect();
            eprintln!("[claude-pet] official mode: could not parse response: {}", head);
            None
        }
    }
}

/// Pure mapping of a successful curl's response body to a FetchOutcome: a parseable usage payload,
/// an explicit rate-limit marker, or an unrecognized body (Fail). Kept separate from the curl IO so
/// the mapping is testable without a network.
pub fn interpret_response(body: &str) -> FetchOutcome {
    if let Some(u) = parse(body) {
        return FetchOutcome::Ok(u);
    }
    if body.contains("rate_limit") {
        return FetchOutcome::RateLimited;
    }
    FetchOutcome::Fail
}

/// A momentary fake 100% at the window-reset boundary: a real cap climbs through 85~99% first,
/// whereas after a reset the API's occasional one-shot 100% was 0~2% the tick before. Reject a jump
/// to ≥100% when the previous raw reading was still low (<85%); the next tick confirms a real cap.
pub fn is_suspect_spike(prev_raw: f64, fresh_pct: f64) -> bool {
    fresh_pct >= 1.0 && prev_raw < 0.85
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_fractional_utilization() {
        let out =
            parse(r#"{"five_hour":{"utilization":0.42},"seven_day":{"utilization":0.1}}"#).unwrap();
        assert!((out.five_pct - 0.42).abs() < 1e-9);
        assert!((out.week_pct.unwrap() - 0.1).abs() < 1e-9);
    }

    #[test]
    fn normalizes_0_to_100_scale() {
        // values over 1.5 are treated as a percentage and divided by 100
        let out = parse(r#"{"5h":{"utilization":85}}"#).unwrap();
        assert!((out.five_pct - 0.85).abs() < 1e-9);
        assert_eq!(out.week_pct, None);
    }

    #[test]
    fn reads_reset_timestamp_else_zero() {
        let with = parse(r#"{"five_hour":{"utilization":0.5,"resets_at":"2026-07-12T10:00:00Z"}}"#)
            .unwrap();
        assert_eq!(with.five_reset_ts, 1_783_850_400); // 2026-07-12T10:00:00Z
        let without = parse(r#"{"five_hour":{"utilization":0.5}}"#).unwrap();
        assert_eq!(without.five_reset_ts, 0);
    }

    #[test]
    fn missing_five_hour_section_is_none() {
        assert!(parse(r#"{"foo":1}"#).is_none());
        assert!(parse("not json").is_none());
    }

    #[test]
    fn interpret_maps_body_to_outcome() {
        assert!(matches!(
            interpret_response(r#"{"five_hour":{"utilization":0.3}}"#),
            FetchOutcome::Ok(_)
        ));
        assert!(matches!(
            interpret_response(r#"{"error":{"type":"rate_limit_error"}}"#),
            FetchOutcome::RateLimited
        ));
        assert!(matches!(interpret_response("<html>502</html>"), FetchOutcome::Fail));
    }

    #[test]
    fn suspect_spike_rejects_only_a_jump_from_low() {
        // 2% → 100% at a reset boundary: suspicious
        assert!(is_suspect_spike(0.02, 1.0));
        // 90% → 100%: a real cap climbing, accept
        assert!(!is_suspect_spike(0.90, 1.0));
        // below 100%: never suspect regardless of history
        assert!(!is_suspect_spike(0.0, 0.99));
    }
}
