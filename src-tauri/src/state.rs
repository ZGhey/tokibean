// 状态机:宠物的大脑
// 多会话:每个 Claude Code 会话(session_id)独立记录状态,展示时聚合:
//   任一会话 attention > 任一 working > 任一 done(短暂) > limit(额度耗尽) > idle
// warn(窗口 >80%)是叠加标记,不占状态位

use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

use crate::config::Config;
use crate::official::OfficialUsage;
use crate::usage::{build_snapshot, Scanner, UsageSnapshot};

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Base {
    Idle,
    Working,
    Attention,
    Done,
}

pub struct Session {
    pub base: Base,
    /// 进入当前 base 的时刻(Working 时用来算工时)
    pub since: Instant,
    pub done_until: Option<Instant>,
    pub last_seen: Instant,
}

pub struct Core {
    pub sessions: HashMap<String, Session>,
    pub bubble: Option<(String, Instant)>,
    /// 正在使用的工具(PreToolUse),短暂展示
    pub tool_note: Option<(String, Instant)>,
    /// 完工庆祝等级:0 无 / 1 中活(>=1min) / 2 大活(>=10min)
    pub celebrate: u8,
    pub last_event: Option<String>,
    /// 今日完工轮数(日期变更自动清零)+ 战报:全闲 10 分钟后弹一次
    pub stops_today: u32,
    pub stops_day: String,
    pub report_day: String,
    pub idle_since: Option<Instant>,
    /// 工具报错的恼火表情持续到
    pub oops_until: Option<Instant>,
    /// 后台任务(run_in_background)的到期时刻列表。
    /// hooks 没有完成事件,按 15 分钟衰减,宁早勿错
    pub bg_tasks: Vec<Instant>,
}

pub struct Shared {
    pub core: Mutex<Core>,
    pub scanner: Mutex<Scanner>,
    pub snapshot: Mutex<UsageSnapshot>,
    pub cfg: Mutex<Config>,
    pub hooks_seen: AtomicBool,
    pub warned_80: AtomicBool,
    pub warned_limit: AtomicBool,
    /// 窗口位置持久化的节流:上次保存时刻 / 最近一次程序性改窗口尺寸的时刻
    pub last_pos_save: Mutex<Instant>,
    pub last_resize: Mutex<Instant>,
    /// 官方用量缓存(值, 获取时刻)。接口失败时沿用旧值(最长 6 小时),
    /// 绝不因为一次网络抖动就回退到会瞎报 100% 的本地估算
    pub official: Mutex<Option<(OfficialUsage, Instant)>>,
    /// 被限流后的退避截止时刻
    pub official_backoff: Mutex<Option<Instant>>,
}

impl Shared {
    pub fn new() -> Self {
        Shared {
            core: Mutex::new(Core {
                sessions: HashMap::new(),
                bubble: None,
                tool_note: None,
                celebrate: 0,
                last_event: None,
                stops_today: 0,
                stops_day: String::new(),
                report_day: String::new(),
                idle_since: None,
                oops_until: None,
                bg_tasks: Vec::new(),
            }),
            scanner: Mutex::new(Scanner::new()),
            snapshot: Mutex::new(UsageSnapshot::default()),
            cfg: Mutex::new(Config::load()),
            hooks_seen: AtomicBool::new(false),
            warned_80: AtomicBool::new(false),
            warned_limit: AtomicBool::new(false),
            last_pos_save: Mutex::new(Instant::now()),
            last_resize: Mutex::new(Instant::now()),
            official: Mutex::new(None),
            official_backoff: Mutex::new(None),
        }
    }
}

#[derive(Serialize, Clone)]
pub struct PetUpdate {
    pub state: String, // idle | working | attention | done | limit
    pub warn: bool,
    pub bubble: Option<String>,
    pub last_event: Option<String>,
    pub hooks_seen: bool,
    pub usage: UsageSnapshot,
    /// 正在干活的会话数(>1 时前端画 ×N 徽章)
    pub working_count: usize,
    pub session_count: usize,
    /// 当前最长的一路工作已持续秒数
    pub work_secs: u64,
    /// 等你输入已持续秒数(最久的一路),前端做焦急升级
    pub attention_secs: u64,
    pub tool_note: Option<String>,
    pub celebrate: u8,
    /// 工具刚报错(恼火中)
    pub oops: bool,
    /// 在轨的后台任务数
    pub bg_count: usize,
}

pub fn build_update(shared: &Shared) -> PetUpdate {
    let core = shared.core.lock().unwrap();
    let snap = shared.snapshot.lock().unwrap().clone();
    let now = Instant::now();

    let mut working = 0usize;
    let mut attention = false;
    let mut done = false;
    let mut work_secs = 0u64;
    let mut attention_secs = 0u64;
    for s in core.sessions.values() {
        match s.base {
            Base::Working => {
                working += 1;
                work_secs = work_secs.max(now.duration_since(s.since).as_secs());
            }
            Base::Attention => {
                attention = true;
                attention_secs = attention_secs.max(now.duration_since(s.since).as_secs());
            }
            Base::Done => done = true,
            Base::Idle => {}
        }
    }

    // 只有官方数据或用户手动设的限额才有资格让宠物睡觉/报警;
    // 自动估算(对比历史峰值)只做展示——它在刷新纪录时会假报 100%
    let pct_valid = snap.basis == "official" || snap.basis == "manual";
    let state = if attention {
        "attention"
    } else if working > 0 {
        "working"
    } else if done {
        "done"
    } else if snap.mode == "subscription" && pct_valid && snap.block_pct >= 1.0 {
        "limit" // 额度到顶,睡觉——反正也干不了活
    } else {
        "idle"
    };

    let warn = snap.mode == "subscription"
        && pct_valid
        && snap.block_pct >= 0.8
        && snap.block_pct < 1.0;

    PetUpdate {
        state: state.to_string(),
        warn,
        bubble: core.bubble.as_ref().map(|(t, _)| t.clone()),
        last_event: core.last_event.clone(),
        hooks_seen: shared.hooks_seen.load(Ordering::Relaxed),
        usage: snap,
        working_count: working,
        session_count: core.sessions.len(),
        work_secs,
        attention_secs,
        tool_note: core.tool_note.as_ref().map(|(t, _)| t.clone()),
        celebrate: core.celebrate,
        oops: core.oops_until.map(|u| now < u).unwrap_or(false),
        bg_count: core.bg_tasks.iter().filter(|&&u| now < u).count(),
    }
}

pub fn push_update(app: &AppHandle, shared: &Shared) {
    let payload = build_update(shared);
    let _ = app.emit("pet-update", payload);
}

/// 处理 done / 气泡 / 工具提示的到期,清理僵尸会话。返回是否需要推送更新。
pub fn expire_transients(shared: &Shared) -> bool {
    let mut core = shared.core.lock().unwrap();
    let now = Instant::now();
    let mut changed = false;

    for s in core.sessions.values_mut() {
        if s.base == Base::Done && s.done_until.map(|t| now >= t).unwrap_or(true) {
            s.base = Base::Idle;
            s.done_until = None;
            changed = true;
        }
    }
    // 僵尸会话:超过 6 小时没有任何事件(比如 Claude Code 直接被杀,没发 SessionEnd)
    let before = core.sessions.len();
    core.sessions
        .retain(|_, s| now.duration_since(s.last_seen) < Duration::from_secs(6 * 3600));
    changed |= core.sessions.len() != before;

    if let Some((_, until)) = &core.bubble {
        if now >= *until {
            core.bubble = None;
            changed = true;
        }
    }
    if let Some((_, until)) = &core.tool_note {
        if now >= *until {
            core.tool_note = None;
            changed = true;
        }
    }
    if let Some(u) = core.oops_until {
        if now >= u {
            core.oops_until = None;
            changed = true;
        }
    }
    let bg_before = core.bg_tasks.len();
    core.bg_tasks.retain(|&u| now < u);
    changed |= core.bg_tasks.len() != bg_before;
    if core.celebrate > 0 && !core.sessions.values().any(|s| s.base == Base::Done) {
        core.celebrate = 0;
        changed = true;
    }
    // 今日战报:全员空闲满 10 分钟,当天弹一次
    let all_idle = core
        .sessions
        .values()
        .all(|s| s.base == Base::Idle || s.base == Base::Done);
    if all_idle {
        let idle_since = *core.idle_since.get_or_insert(now);
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        if core.report_day != today
            && core.stops_day == today
            && core.stops_today > 0
            && now.duration_since(idle_since).as_secs() >= 600
        {
            core.report_day = today;
            let tokens = shared.snapshot.lock().unwrap().today_tokens;
            let fmt = if tokens >= 1_000_000 {
                format!("{:.1}M", tokens as f64 / 1e6)
            } else {
                format!("{:.0}K", tokens as f64 / 1e3)
            };
            core.bubble = Some((
                format!("今日战报:完成 {} 轮,烧了 {} tokens", core.stops_today, fmt),
                now + Duration::from_secs(20),
            ));
            changed = true;
        }
    } else {
        core.idle_since = None;
    }
    // 有会话在干活或等输入时每秒都推,让前端的计时走起来
    changed |= core
        .sessions
        .values()
        .any(|s| s.base == Base::Working || s.base == Base::Attention);
    changed
}

pub fn refresh_usage(shared: &Shared, with_official: bool) {
    let cfg = shared.cfg.lock().unwrap().clone();
    let mut snap = {
        let mut scanner = shared.scanner.lock().unwrap();
        scanner.scan();
        build_snapshot(&scanner.events, &cfg)
    };

    // 订阅模式:优先用官方接口的真实百分比。轮询失败(限流/网络)时
    // 沿用最长 6 小时的旧值,再不行才回退本地加权估算(basis 保持 auto/manual)
    if snap.mode == "subscription" {
        let now = Instant::now();
        let backoff = shared
            .official_backoff
            .lock()
            .unwrap()
            .map(|t| now < t)
            .unwrap_or(false);
        let mut cache = shared.official.lock().unwrap();
        if with_official && !backoff {
            use crate::official::FetchOutcome;
            match crate::official::fetch(shared, &cfg.oauth_token) {
                FetchOutcome::Ok(fresh) => {
                    let changed = cache
                        .as_ref()
                        .map(|(old, _)| (old.five_pct - fresh.five_pct).abs() > 0.005)
                        .unwrap_or(true);
                    if changed {
                        println!(
                            "[claude-pet] 官方用量:5h {:.0}%,7d {}",
                            fresh.five_pct * 100.0,
                            fresh
                                .week_pct
                                .map(|p| format!("{:.0}%", p * 100.0))
                                .unwrap_or_else(|| "--".into())
                        );
                    }
                    *cache = Some((fresh, now));
                }
                FetchOutcome::RateLimited => {
                    *shared.official_backoff.lock().unwrap() =
                        Some(now + Duration::from_secs(300));
                }
                FetchOutcome::Fail => {}
            }
        }
        if let Some((_, at)) = cache.as_ref() {
            if now.duration_since(*at) > Duration::from_secs(6 * 3600) {
                *cache = None;
            }
        }
        if let Some((off, _)) = cache.as_ref() {
            snap.block_pct = off.five_pct;
            snap.block_reset_ts = off.five_reset_ts;
            snap.week_pct = off.week_pct;
            snap.basis = "official".into();
        }
    }

    *shared.snapshot.lock().unwrap() = snap;
}

/// 用量越线通知(80% / 100%),只提醒一次,回落后重置
pub fn check_usage_alerts(app: &AppHandle, shared: &Shared) {
    let (notify_on, mode, pct, limit, basis) = {
        let cfg = shared.cfg.lock().unwrap();
        let snap = shared.snapshot.lock().unwrap();
        (
            cfg.notify,
            snap.mode.clone(),
            snap.block_pct,
            snap.block_limit,
            snap.basis.clone(),
        )
    };
    let _ = limit;
    if mode != "subscription" || (basis != "official" && basis != "manual") {
        return;
    }
    if pct >= 1.0 {
        if !shared.warned_limit.swap(true, Ordering::Relaxed) && notify_on {
            notify(app, "额度到顶了", "当前 5 小时窗口的估算额度已用完,宠物先睡了");
        }
    } else if pct >= 0.8 {
        shared.warned_limit.store(false, Ordering::Relaxed);
        if !shared.warned_80.swap(true, Ordering::Relaxed) && notify_on {
            notify(app, "额度快到了", "当前 5 小时窗口用量已超过 80%");
        }
    } else {
        shared.warned_80.store(false, Ordering::Relaxed);
        shared.warned_limit.store(false, Ordering::Relaxed);
    }
}

pub fn notify(app: &AppHandle, title: &str, body: &str) {
    let _ = app
        .notification()
        .builder()
        .title(title)
        .body(body)
        .show();
}
