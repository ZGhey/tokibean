// In-app one-click "connect Claude account": standard OAuth PKCE flow.
// Browser authorization -> localhost callback receives the code -> exchange for
// access/refresh token -> store into the pet config.
// Tokens stay on this machine the whole time, talking only to
// claude.ai / console.anthropic.com.

use base64::Engine;
use sha2::Digest;
use std::io::Write as _;
use std::process::{Command, Stdio};
use std::sync::Arc;

use crate::state::Shared;

pub const OAUTH_CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CALLBACK_PORT: u16 = 54545;

fn b64url(data: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(data)
}

fn random_urlsafe() -> String {
    let mut buf = [0u8; 32];
    let _ = getrandom::getrandom(&mut buf);
    b64url(&buf)
}

pub fn open_browser(url: &str) {
    // Windows URL-opening pitfall: a bare `cmd start` splits on `&` into separate
    // commands, and rundll32 truncates too. The only reliable fix is to quote the
    // URL passed to `start`; Rust won't auto-quote a space-free argument, so we
    // hand-assemble it with raw_arg.
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut c = Command::new("cmd");
        crate::official::no_window(&mut c);
        let _ = c.raw_arg(format!("/c start \"\" \"{}\"", url)).spawn();
    }
    #[cfg(target_os = "macos")]
    let _ = Command::new("open").arg(url).spawn();
    #[cfg(target_os = "linux")]
    let _ = Command::new("xdg-open").arg(url).spawn();
}

/// Runs the full login flow synchronously; on success writes the tokens into the
/// config. Returns the result text shown on the panel.
pub fn connect(shared: Arc<Shared>) -> Result<String, String> {
    // Still cooling down from a previous rate-limit? Don't even open the browser or touch the console
    // token endpoint — another hit just re-arms its ~6h lockout. Tell the user to keep waiting.
    if let Some(until) = *shared.connect_cooldown.lock().unwrap() {
        if std::time::Instant::now() < until {
            let mins = until
                .saturating_duration_since(std::time::Instant::now())
                .as_secs()
                / 60;
            return Err(if crate::i18n::is_zh() {
                format!("登录接口仍在冷却,约还需 {} 分钟。这期间点连接只会重置冷却,请耐心等待", mins)
            } else {
                format!("Login endpoint still cooling down (~{} min left). Connecting now only resets it — please wait.", mins)
            });
        }
    }

    let verifier = random_urlsafe();
    let challenge = b64url(&sha2::Sha256::digest(verifier.as_bytes()));
    let state = random_urlsafe();

    // Claim the callback port first, then open the browser.
    let server = tiny_http::Server::http(("127.0.0.1", CALLBACK_PORT)).map_err(|e| {
        if crate::i18n::is_zh() {
            format!("回调端口 {} 被占用:{}", CALLBACK_PORT, e)
        } else {
            format!("Callback port {} is in use: {}", CALLBACK_PORT, e)
        }
    })?;

    let url = format!(
        "https://claude.ai/oauth/authorize?code=true&client_id={}&response_type=code\
         &redirect_uri=http%3A%2F%2Flocalhost%3A{}%2Fcallback\
         &scope=org%3Acreate_api_key%20user%3Aprofile%20user%3Ainference\
         &code_challenge={}&code_challenge_method=S256&state={}",
        OAUTH_CLIENT_ID, CALLBACK_PORT, challenge, state
    );
    open_browser(&url);

    // Wait for the callback (3-minute timeout).
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(180);
    let (code, got_state) = loop {
        let remain = deadline
            .checked_duration_since(std::time::Instant::now())
            .ok_or_else(|| crate::i18n::t("授权超时,请重试", "Authorization timed out, please retry"))?;
        let Some(req) = server.recv_timeout(remain).map_err(|e| e.to_string())? else {
            return Err(crate::i18n::t("授权超时,请重试", "Authorization timed out, please retry").into());
        };
        let url = req.url().to_string();
        if !url.starts_with("/callback") {
            let _ = req.respond(tiny_http::Response::from_string("claude-pet"));
            continue;
        }
        let get = |k: &str| {
            url.split(['?', '&'])
                .find_map(|p| p.strip_prefix(&format!("{}=", k)))
                .map(|s| s.to_string())
        };
        // The token exchange still has to run after this (and can fail, e.g. rate-limited),
        // so don't claim success here — tell the user to check the pet for the real result.
        let ok_body = format!(
            "<meta charset=utf-8><body style='font-family:sans-serif;text-align:center;padding-top:20vh'>\
             {}</body>",
            crate::i18n::t(
                "授权已收到,正在完成连接…请回到宠物查看结果",
                "Authorization received — finishing up… check the pet for the result."
            )
        );
        let ok_page = tiny_http::Response::from_data(ok_body.into_bytes())
            .with_header("Content-Type: text/html; charset=utf-8".parse::<tiny_http::Header>().unwrap());
        let code = get("code");
        let _ = req.respond(ok_page);
        match code {
            Some(c) => break (c, get("state").unwrap_or_default()),
            None => return Err(crate::i18n::t("授权被取消或回调缺少 code", "Authorization was cancelled or the callback is missing the code").into()),
        }
    };
    if got_state != state {
        return Err(crate::i18n::t("state 校验失败,已中止", "state validation failed, aborted").into());
    }

    // Exchange the code for tokens.
    let body = serde_json::json!({
        "grant_type": "authorization_code",
        "code": code,
        "state": got_state,
        "client_id": OAUTH_CLIENT_ID,
        "redirect_uri": format!("http://localhost:{}/callback", CALLBACK_PORT),
        "code_verifier": verifier,
    });
    let mut cmd = Command::new("curl");
    crate::official::no_window(&mut cmd);
    // platform.claude.com is the live token endpoint (console.anthropic.com now 404s). Critically,
    // Anthropic rate-limits token requests whose User-Agent looks like Claude Code's; a neutral UA
    // (axios) is NOT throttled — this is what actually fixed the "接口限流" wall.
    let mut child = cmd
        .args([
            "-s", "-m", "15", "-X", "POST",
            "-H", "Content-Type: application/json",
            "-H", "User-Agent: axios/1.7.9",
            "--data-binary", "@-",
            "https://platform.claude.com/v1/oauth/token",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    child
        .stdin
        .as_mut()
        .ok_or("curl stdin")?
        .write_all(body.to_string().as_bytes())
        .map_err(|e| e.to_string())?;
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    let resp: serde_json::Value =
        serde_json::from_str(&String::from_utf8_lossy(&out.stdout))
            .map_err(|_| crate::i18n::t("令牌响应异常", "Malformed token response"))?;
    let access = match resp["access_token"].as_str() {
        Some(a) => a,
        None => {
            let s = resp.to_string();
            // Diagnostic (no token content): which failure mode the exchange hit
            eprintln!(
                "[claude-pet] connect: token exchange failed ({})",
                if s.contains("rate_limit") { "rate_limited" } else { "other" }
            );
            // Rate-limiting is the most common failure; give an actionable hint
            // instead of dumping raw JSON.
            if s.contains("rate_limit") {
                // Arm the cooldown so further clicks don't keep re-hitting console and resetting its lockout.
                *shared.connect_cooldown.lock().unwrap() =
                    Some(std::time::Instant::now() + std::time::Duration::from_secs(6 * 3600));
            }
            return Err(if s.contains("rate_limit") {
                crate::i18n::t(
                    "登录接口被限流:每次重试都会重置约 6 小时的冷却。请先别再点,静置约 6 小时后再连一次(hooks/用量不受影响)",
                    "Login endpoint rate-limited: every retry resets the ~6h cooldown. Stop clicking and wait ~6h, then connect once (hooks/usage are unaffected).",
                )
                .into()
            } else if crate::i18n::is_zh() {
                format!("换取令牌失败:{}", s.chars().take(120).collect::<String>())
            } else {
                format!("Token exchange failed: {}", s.chars().take(120).collect::<String>())
            });
        }
    };

    // Write into the config.
    {
        let mut cfg = shared.cfg.lock().unwrap();
        cfg.oauth_access = access.to_string();
        cfg.oauth_refresh = resp["refresh_token"].as_str().unwrap_or("").to_string();
        cfg.oauth_expires_ms = chrono::Utc::now().timestamp_millis()
            + resp["expires_in"].as_i64().unwrap_or(3600) * 1000;
        cfg.save().map_err(|e| e.to_string())?;
        // Diagnostic (no token content): confirm both tokens landed
        eprintln!(
            "[claude-pet] connect: stored access({} chars) + refresh({} chars), expires in {}s",
            cfg.oauth_access.len(),
            cfg.oauth_refresh.len(),
            resp["expires_in"].as_i64().unwrap_or(3600)
        );
    }
    Ok(crate::i18n::t(
        "已连接 Claude 账号,官方用量已启用",
        "Claude account connected. Official usage is now enabled.",
    )
    .into())
}
