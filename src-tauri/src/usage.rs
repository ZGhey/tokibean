// 用量聚合:解析 Claude Code 写在本地的 JSONL 会话记录
// 数据源:~/.claude/projects/<项目>/<会话>.jsonl
// 每条 assistant 消息里带 message.usage(input/output/cache token 数)和 message.model

use chrono::{DateTime, Local, TimeZone, Utc};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;

use crate::config::Config;

#[derive(Clone)]
pub struct UsageEvent {
    pub ts: i64, // epoch 秒
    pub input: u64,
    pub output: u64,
    pub cache_w: u64,
    pub cache_r: u64,
    pub model: String,
}

impl UsageEvent {
    pub fn total(&self) -> u64 {
        self.input + self.output + self.cache_w + self.cache_r
    }
}

/// 增量扫描器:记住每个文件读到的偏移量,只解析新增部分
pub struct Scanner {
    offsets: HashMap<PathBuf, u64>,
    seen: HashSet<String>,
    pub events: Vec<UsageEvent>,
    /// WSL 发行版里的 projects 目录(Windows 侧经 \\wsl$ 访问),定期刷新
    wsl_roots: Vec<PathBuf>,
    wsl_checked: Option<std::time::Instant>,
}

impl Scanner {
    pub fn new() -> Self {
        Scanner {
            offsets: HashMap::new(),
            seen: HashSet::new(),
            events: Vec::new(),
            wsl_roots: Vec::new(),
            wsl_checked: None,
        }
    }

    /// 枚举 WSL 发行版里所有用户的 ~/.claude/projects,10 分钟刷新一次
    #[cfg(target_os = "windows")]
    fn wsl_projects_dirs(&mut self) -> Vec<PathBuf> {
        let now = std::time::Instant::now();
        let stale = self
            .wsl_checked
            .map(|t| now.duration_since(t).as_secs() > 600)
            .unwrap_or(true);
        if stale {
            self.wsl_checked = Some(now);
            self.wsl_roots.clear();
            let mut cmd = std::process::Command::new("wsl.exe");
            crate::official::no_window(&mut cmd);
            if let Ok(out) = cmd.args(["-l", "-q"]).output() {
                if out.status.success() {
                    // wsl.exe 输出是 UTF-16LE
                    let text = if out.stdout.iter().take(8).any(|&b| b == 0) {
                        let units: Vec<u16> = out
                            .stdout
                            .chunks_exact(2)
                            .map(|c| u16::from_le_bytes([c[0], c[1]]))
                            .collect();
                        String::from_utf16_lossy(&units)
                    } else {
                        String::from_utf8_lossy(&out.stdout).to_string()
                    };
                    for distro in text.lines().map(|l| l.trim().trim_start_matches('\u{feff}')) {
                        if distro.is_empty() {
                            continue;
                        }
                        let base = PathBuf::from(format!(r"\\wsl$\{}", distro));
                        if let Ok(entries) = fs::read_dir(base.join("home")) {
                            for e in entries.flatten() {
                                let p = e.path().join(".claude").join("projects");
                                if p.is_dir() {
                                    self.wsl_roots.push(p);
                                }
                            }
                        }
                        let rootp = base.join("root").join(".claude").join("projects");
                        if rootp.is_dir() {
                            self.wsl_roots.push(rootp);
                        }
                    }
                    if !self.wsl_roots.is_empty() {
                        println!("[claude-pet] WSL 用量目录:{} 个", self.wsl_roots.len());
                    }
                }
            }
        }
        self.wsl_roots.clone()
    }

    #[cfg(not(target_os = "windows"))]
    fn wsl_projects_dirs(&mut self) -> Vec<PathBuf> {
        Vec::new()
    }

    fn projects_dir() -> Option<PathBuf> {
        let p = dirs::home_dir()?.join(".claude").join("projects");
        if p.is_dir() {
            Some(p)
        } else {
            None
        }
    }

    pub fn scan(&mut self) {
        let mut files: Vec<PathBuf> = Vec::new();
        if let Some(root) = Self::projects_dir() {
            collect_jsonl(&root, &mut files, 0);
        }
        for root in self.wsl_projects_dirs() {
            collect_jsonl(&root, &mut files, 0);
        }
        for f in files {
            self.scan_file(&f);
        }
        // 只保留最近 8 天,防止内存无限涨
        let cutoff = Utc::now().timestamp() - 8 * 24 * 3600;
        self.events.retain(|e| e.ts >= cutoff);
    }

    fn scan_file(&mut self, path: &PathBuf) {
        let Ok(meta) = fs::metadata(path) else { return };
        let len = meta.len();
        let offset = *self.offsets.get(path).unwrap_or(&0);
        let start = if len < offset { 0 } else { offset }; // 文件被截断/重写则从头读
        if len == start {
            return;
        }
        let Ok(mut file) = fs::File::open(path) else { return };
        if file.seek(SeekFrom::Start(start)).is_err() {
            return;
        }
        let mut buf = Vec::with_capacity((len - start) as usize);
        if file.read_to_end(&mut buf).is_err() {
            return;
        }
        // 最后一行可能还没写完(没有换行符),留到下次
        let complete_len = match buf.iter().rposition(|&b| b == b'\n') {
            Some(pos) => pos + 1,
            None => {
                return; // 一整行都没写完
            }
        };
        let text = String::from_utf8_lossy(&buf[..complete_len]);
        for line in text.lines() {
            self.parse_line(line);
        }
        self.offsets.insert(path.clone(), start + complete_len as u64);
    }

    fn parse_line(&mut self, line: &str) {
        let line = line.trim();
        if line.is_empty() {
            return;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { return };
        let usage = &v["message"]["usage"];
        if !usage.is_object() {
            return;
        }
        // 去重:会话 resume 时同一条消息可能出现在多个文件里
        let msg_id = v["message"]["id"].as_str().unwrap_or("");
        let req_id = v["requestId"].as_str().unwrap_or("");
        if !msg_id.is_empty() || !req_id.is_empty() {
            let key = format!("{}:{}", msg_id, req_id);
            if !self.seen.insert(key) {
                return;
            }
        }
        let ts_str = v["timestamp"].as_str().unwrap_or("");
        let Ok(dt) = DateTime::parse_from_rfc3339(ts_str) else { return };
        let ev = UsageEvent {
            ts: dt.timestamp(),
            input: usage["input_tokens"].as_u64().unwrap_or(0),
            output: usage["output_tokens"].as_u64().unwrap_or(0),
            cache_w: usage["cache_creation_input_tokens"].as_u64().unwrap_or(0),
            cache_r: usage["cache_read_input_tokens"].as_u64().unwrap_or(0),
            model: v["message"]["model"].as_str().unwrap_or("unknown").to_string(),
        };
        if ev.total() > 0 {
            self.events.push(ev);
        }
    }
}

fn collect_jsonl(dir: &PathBuf, out: &mut Vec<PathBuf>, depth: u32) {
    if depth > 4 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() {
            collect_jsonl(&p, out, depth + 1);
        } else if p.extension().map(|e| e == "jsonl").unwrap_or(false) {
            out.push(p);
        }
    }
}

#[derive(Serialize, Clone, Default)]
pub struct ModelUsage {
    pub model: String,
    pub tokens: u64,
}

#[derive(Serialize, Clone, Default)]
pub struct UsageSnapshot {
    pub mode: String, // subscription | api
    /// 当前 5 小时窗口
    pub block_tokens: u64,
    pub block_limit: u64, // 0 = 未知
    pub block_pct: f64,
    /// 百分比口径:manual = tokens/手动限额;auto = 加权成本/历史峰值窗口加权成本
    pub basis: String,
    pub block_reset_ts: i64, // 窗口结束的 epoch 秒,0 = 当前无活动窗口
    pub max_block_tokens: u64,
    /// 今天(本地时区)
    pub today_tokens: u64,
    pub today_cost: f64,
    /// 近 7 天(滚动,近似周限额口径,官方口径未公开)
    pub week_tokens: u64,
    pub week_cost: f64,
    /// 周限额官方利用率(仅 basis=official 时有值),0.0-1.0
    pub week_pct: Option<f64>,
    pub models: Vec<ModelUsage>,
    pub has_data: bool,
    /// 近 7 天逐日 token(最旧→今天),画趋势图用
    pub daily_tokens: Vec<u64>,
}

fn cost_of(e: &UsageEvent, cfg: &Config) -> f64 {
    let p = &cfg.prices;
    let m = e.model.to_lowercase();
    let (i, o) = if m.contains("opus") || m.contains("fable") || m.contains("mythos") {
        (p.opus_in, p.opus_out) // fable/mythos 单价未公开,先按 opus 档估
    } else if m.contains("haiku") {
        (p.haiku_in, p.haiku_out)
    } else {
        (p.sonnet_in, p.sonnet_out) // sonnet 及未知模型按 sonnet 价
    };
    (e.input as f64 * i
        + e.output as f64 * o
        + e.cache_w as f64 * i * p.cache_write_mult
        + e.cache_r as f64 * i * p.cache_read_mult)
        / 1_000_000.0
}

fn floor_to_hour(ts: i64) -> i64 {
    ts - ts.rem_euclid(3600)
}

/// 把事件按 5 小时窗口切块:窗口从首次活动所在的 UTC 整点开始,持续 5 小时;
/// 超出窗口末尾的下一条事件开启新窗口。与 ccusage 的 blocks 口径一致。
pub fn build_snapshot(events: &[UsageEvent], cfg: &Config) -> UsageSnapshot {
    let mut evs: Vec<&UsageEvent> = events.iter().collect();
    evs.sort_by_key(|e| e.ts);

    let now = Utc::now().timestamp();
    let mut blocks: Vec<(i64, i64, u64, f64)> = Vec::new(); // (start, end, tokens, 加权成本)
    for e in &evs {
        let fits = blocks.last().map(|b| e.ts < b.1).unwrap_or(false);
        if fits {
            let last = blocks.last_mut().unwrap();
            last.2 += e.total();
            last.3 += cost_of(e, cfg);
        } else {
            let start = floor_to_hour(e.ts);
            blocks.push((start, start + 5 * 3600, e.total(), cost_of(e, cfg)));
        }
    }

    let max_block = blocks.iter().map(|b| b.2).max().unwrap_or(0);
    let max_block_cost = blocks.iter().map(|b| b.3).fold(0.0_f64, f64::max);
    let (block_tokens, block_cost, block_reset) = match blocks.last() {
        Some(b) if now < b.1 => (b.2, b.3, b.1),
        _ => (0, 0.0, 0),
    };

    // 官方额度按模型单价加权(缓存读远便宜于普通输入),
    // 用原始 token 数当口径会被海量缓存读撑大分母、严重低估占比。
    // 手动设了 block_limit 就按 token 数算,否则按加权成本对比历史峰值窗口
    let (pct, limit, basis) = if cfg.block_limit > 0 {
        (
            block_tokens as f64 / cfg.block_limit as f64,
            cfg.block_limit,
            "manual",
        )
    } else {
        let p = if max_block_cost > 0.0 { block_cost / max_block_cost } else { 0.0 };
        (p, max_block, "auto")
    };

    // 今天:本地时区零点起
    let local_midnight = Local::now()
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .map(|nd| Local.from_local_datetime(&nd).earliest())
        .flatten()
        .map(|dt| dt.timestamp())
        .unwrap_or(now - 24 * 3600);
    let week_cutoff = now - 7 * 24 * 3600;

    let mut today_tokens = 0u64;
    let mut today_cost = 0.0f64;
    let mut week_tokens = 0u64;
    let mut week_cost = 0.0f64;
    let mut per_model: HashMap<String, u64> = HashMap::new();
    let mut daily_tokens = vec![0u64; 7];

    for e in &evs {
        if e.ts >= week_cutoff {
            week_tokens += e.total();
            week_cost += cost_of(e, cfg);
            *per_model.entry(short_model(&e.model)).or_insert(0) += e.total();
        }
        if e.ts >= local_midnight {
            today_tokens += e.total();
            today_cost += cost_of(e, cfg);
            daily_tokens[6] += e.total();
        } else {
            // 昨天=5,前天=4……
            let days_back = (local_midnight - e.ts - 1).div_euclid(86400);
            let idx = 5 - days_back;
            if (0..=5).contains(&idx) {
                daily_tokens[idx as usize] += e.total();
            }
        }
    }

    let mut models: Vec<ModelUsage> = per_model
        .into_iter()
        .map(|(model, tokens)| ModelUsage { model, tokens })
        .collect();
    models.sort_by(|a, b| b.tokens.cmp(&a.tokens));
    models.truncate(3);

    UsageSnapshot {
        mode: cfg.resolved_mode().to_string(),
        block_tokens,
        block_limit: limit,
        block_pct: pct,
        basis: basis.to_string(),
        block_reset_ts: block_reset,
        max_block_tokens: max_block,
        today_tokens,
        today_cost,
        week_tokens,
        week_cost,
        week_pct: None, // 官方模式下由 state::refresh_usage 填充
        models,
        has_data: !evs.is_empty(),
        daily_tokens,
    }
}

fn short_model(m: &str) -> String {
    let m = m.to_lowercase();
    for name in ["fable", "mythos", "opus", "sonnet", "haiku"] {
        if m.contains(name) {
            return name.to_string();
        }
    }
    "other".to_string()
}
