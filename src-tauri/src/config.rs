// 应用配置:~/.config/claude-pet/config.json(Windows 为 %APPDATA%\claude-pet)

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct Prices {
    pub opus_in: f64,
    pub opus_out: f64,
    pub sonnet_in: f64,
    pub sonnet_out: f64,
    pub haiku_in: f64,
    pub haiku_out: f64,
    /// 缓存写入按输入价的倍率
    pub cache_write_mult: f64,
    /// 缓存读取按输入价的倍率
    pub cache_read_mult: f64,
}

impl Default for Prices {
    fn default() -> Self {
        // 单位:美元 / 每百万 token。价格会变,可在 config.json 里改
        Prices {
            opus_in: 15.0,
            opus_out: 75.0,
            sonnet_in: 3.0,
            sonnet_out: 15.0,
            haiku_in: 0.8,
            haiku_out: 4.0,
            cache_write_mult: 1.25,
            cache_read_mult: 0.1,
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct Config {
    /// auto | subscription | api
    pub mode: String,
    /// hook 服务器监听端口
    pub port: u16,
    /// hook 服务器监听地址。默认只收本机;WSL NAT 模式需要改成 "0.0.0.0"
    /// (注意 0.0.0.0 会暴露到局域网,防火墙会弹一次确认)
    pub bind: String,
    /// 订阅模式 5 小时窗口 token 限额。0 = 自动(取历史最高窗口)
    pub block_limit: u64,
    /// 是否发系统通知
    pub notify: bool,
    /// 完工通知降噪:工作不足这个秒数的小活不发通知
    pub notify_min_secs: u64,
    /// 提示音(完工"叮"/等输入轻响),默认关
    pub sound: bool,
    /// 皮肤:classic(默认) / skins/ 目录下的文件名
    pub skin: String,
    /// 记住的窗口位置(物理像素),None = 系统默认
    pub pos_x: Option<i32>,
    pub pos_y: Option<i32>,
    /// Claude Code OAuth 令牌(sk-ant-oat…,`claude setup-token` 生成),
    /// 官方用量模式用。留空则尝试从 Claude Code 的凭据存储自动读取
    pub oauth_token: String,
    /// 面板"连接 Claude 账号"存下的完整权限令牌(自动续期)
    pub oauth_access: String,
    pub oauth_refresh: String,
    pub oauth_expires_ms: i64,
    pub prices: Prices,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            mode: "auto".into(),
            port: 8737,
            bind: "127.0.0.1".into(),
            block_limit: 0,
            notify: true,
            notify_min_secs: 30,
            sound: false,
            skin: "classic".into(),
            pos_x: None,
            pos_y: None,
            oauth_token: String::new(),
            oauth_access: String::new(),
            oauth_refresh: String::new(),
            oauth_expires_ms: 0,
            prices: Prices::default(),
        }
    }
}

impl Config {
    pub fn path() -> PathBuf {
        dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("claude-pet")
            .join("config.json")
    }

    pub fn load() -> Config {
        let p = Self::path();
        if let Ok(text) = fs::read_to_string(&p) {
            if let Ok(cfg) = serde_json::from_str::<Config>(&text) {
                return cfg;
            }
        }
        let cfg = Config::default();
        let _ = cfg.save();
        cfg
    }

    pub fn save(&self) -> std::io::Result<()> {
        let p = Self::path();
        if let Some(dir) = p.parent() {
            fs::create_dir_all(dir)?;
        }
        fs::write(&p, serde_json::to_string_pretty(self).unwrap())
    }

    /// 解析出实际计费模式:订阅还是 API
    /// auto 的判定是启发式:环境里有 ANTHROPIC_API_KEY 视为 API 计费,
    /// 否则视为订阅(OAuth 登录)。判断不准时在面板里手动切换。
    pub fn resolved_mode(&self) -> &'static str {
        match self.mode.as_str() {
            "subscription" => "subscription",
            "api" => "api",
            _ => {
                if std::env::var("ANTHROPIC_API_KEY").map(|v| !v.is_empty()).unwrap_or(false) {
                    "api"
                } else {
                    "subscription"
                }
            }
        }
    }
}
