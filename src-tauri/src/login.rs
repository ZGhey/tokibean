// 应用内一键连接 Claude 账号:标准 OAuth PKCE 流程
// 浏览器授权 → localhost 回调收 code → 换取 access/refresh token → 存宠物配置
// 全程令牌只在本机,只与 claude.ai / console.anthropic.com 通信

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

fn open_browser(url: &str) {
    // Windows 打 URL 的坑:裸 cmd start 会把 & 拆成命令,rundll32 也会截断。
    // 唯一稳的是给 start 的 URL 加引号,而 Rust 对无空格参数不会自动加,
    // 所以用 raw_arg 手工拼
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

/// 阻塞执行完整登录流程,成功后把令牌写进配置。返回给面板显示的结果文案。
pub fn connect(shared: Arc<Shared>) -> Result<String, String> {
    let verifier = random_urlsafe();
    let challenge = b64url(&sha2::Sha256::digest(verifier.as_bytes()));
    let state = random_urlsafe();

    // 先占住回调端口,再开浏览器
    let server = tiny_http::Server::http(("127.0.0.1", CALLBACK_PORT))
        .map_err(|e| format!("回调端口 {} 被占用:{}", CALLBACK_PORT, e))?;

    let url = format!(
        "https://claude.ai/oauth/authorize?code=true&client_id={}&response_type=code\
         &redirect_uri=http%3A%2F%2Flocalhost%3A{}%2Fcallback\
         &scope=org%3Acreate_api_key%20user%3Aprofile%20user%3Ainference\
         &code_challenge={}&code_challenge_method=S256&state={}",
        OAUTH_CLIENT_ID, CALLBACK_PORT, challenge, state
    );
    open_browser(&url);

    // 等回调(3 分钟超时)
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(180);
    let (code, got_state) = loop {
        let remain = deadline
            .checked_duration_since(std::time::Instant::now())
            .ok_or("授权超时,请重试")?;
        let Some(req) = server.recv_timeout(remain).map_err(|e| e.to_string())? else {
            return Err("授权超时,请重试".into());
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
        let ok_page = tiny_http::Response::from_data(
            "<meta charset=utf-8><body style='font-family:sans-serif;text-align:center;padding-top:20vh'>\
             ✅ 已连接,可以关掉这个页面回到宠物了</body>".as_bytes().to_vec(),
        )
        .with_header("Content-Type: text/html; charset=utf-8".parse::<tiny_http::Header>().unwrap());
        let code = get("code");
        let _ = req.respond(ok_page);
        match code {
            Some(c) => break (c, get("state").unwrap_or_default()),
            None => return Err("授权被取消或回调缺少 code".into()),
        }
    };
    if got_state != state {
        return Err("state 校验失败,已中止".into());
    }

    // 换令牌
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
    let mut child = cmd
        .args([
            "-s", "-m", "15", "-X", "POST",
            "-H", "Content-Type: application/json",
            "--data-binary", "@-",
            "https://console.anthropic.com/v1/oauth/token",
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
        serde_json::from_str(&String::from_utf8_lossy(&out.stdout)).map_err(|_| "令牌响应异常")?;
    let access = resp["access_token"].as_str().ok_or_else(|| {
        format!("换取令牌失败:{}", {
            let s = resp.to_string();
            s.chars().take(120).collect::<String>()
        })
    })?;

    // 写进配置
    {
        let mut cfg = shared.cfg.lock().unwrap();
        cfg.oauth_access = access.to_string();
        cfg.oauth_refresh = resp["refresh_token"].as_str().unwrap_or("").to_string();
        cfg.oauth_expires_ms = chrono::Utc::now().timestamp_millis()
            + resp["expires_in"].as_i64().unwrap_or(3600) * 1000;
        cfg.save().map_err(|e| e.to_string())?;
    }
    Ok("已连接 Claude 账号,官方用量已启用".into())
}
