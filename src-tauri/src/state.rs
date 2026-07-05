// State machine: the pet's brain
// Multi-session: each Claude Code session (session_id) tracks its own state; aggregated for display:
//   any attention > any working > any done (transient) > limit (quota exhausted) > idle
// warn (window >80%) is an overlay flag, not a state slot

use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

use crate::config::Config;
use crate::i18n;
use crate::official::OfficialUsage;
use crate::usage::{build_snapshot, Scanner, UsageSnapshot};

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Base {
    Idle,
    Working,
    Attention,
    Done,
}

/// A newer release detected by the updater
#[derive(Serialize, Clone, Default)]
pub struct UpdateInfo {
    pub version: String,
    pub notes: String,
}

/// Update availability + transient download status, surfaced to the panel
#[derive(Serialize, Clone, Default)]
pub struct UpdateState {
    /// Some once a newer release has been detected
    pub available: Option<UpdateInfo>,
    /// Transient status for the panel: "" | "checking" | "uptodate" | "downloading" | "error"
    pub status: String,
    /// Download progress 0-100 while status == "downloading"
    pub progress: u8,
}

pub struct Session {
    pub base: Base,
    /// When the current base was entered (used to compute work time while Working)
    pub since: Instant,
    pub done_until: Option<Instant>,
    pub last_seen: Instant,
    /// Whether a tool call is in progress (PreToolUse arrived, PostToolUse hasn't yet).
    /// A long command (build/test) can go minutes without any hook; use this to tell "stuck" from "tool running slowly"
    pub in_tool: bool,
}

pub struct Core {
    pub sessions: HashMap<String, Session>,
    pub bubble: Option<(String, Instant)>,
    /// Tool currently in use (PreToolUse), shown briefly
    pub tool_note: Option<(String, Instant)>,
    /// Completion celebration level: 0 none / 1 medium job (>=1min) / 2 big job (>=10min)
    pub celebrate: u8,
    pub last_event: Option<String>,
    /// Today's completed rounds (auto-reset on date change) + daily report: pops once after 10 min fully idle
    pub stops_today: u32,
    pub stops_day: String,
    pub report_day: String,
    pub idle_since: Option<Instant>,
    /// The annoyed expression from a tool error lasts until this instant
    pub oops_until: Option<Instant>,
    /// Expiry instants of background tasks (run_in_background).
    /// Hooks have no completion event, so decay over 15 minutes — better early than wrong
    pub bg_tasks: Vec<Instant>,
    /// Safety-expiry instants of in-flight subagents (Task/Agent tools): one entry per
    /// active subagent, pushed on PreToolUse and popped on the matching PostToolUse.
    /// The 30-minute decay is only a fallback for a missed completion event (e.g. Ctrl+C).
    pub agent_tasks: Vec<Instant>,
}

pub struct Shared {
    pub core: Mutex<Core>,
    pub scanner: Mutex<Scanner>,
    pub snapshot: Mutex<UsageSnapshot>,
    pub cfg: Mutex<Config>,
    pub hooks_seen: AtomicBool,
    pub warned_80: AtomicBool,
    pub warned_limit: AtomicBool,
    /// Whether the usage panel is currently expanded (set by the frontend). While open, the
    /// whole window is made interactive so panel hover works regardless of its pixel height.
    pub panel_open: AtomicBool,
    /// Windows only: whether the pet currently sits at the TOP of its (pre-allocated, full-height)
    /// window — i.e. the below-panel layout. Set by the frontend so the click-through thread knows
    /// which strip of the collapsed window is the solid pet region (top vs. bottom).
    pub pet_at_top: AtomicBool,
    /// Throttling for window-position persistence: last save instant / instant of the last programmatic window resize
    pub last_pos_save: Mutex<Instant>,
    pub last_resize: Mutex<Instant>,
    /// Official usage cache (value, fetch instant). On fetch failure, keep the old value (up to 6 hours);
    /// never fall back to local estimation — which falsely reports 100% — just because of one network hiccup
    pub official: Mutex<Option<(OfficialUsage, Instant)>>,
    /// The raw 5h utilization from the last official response (whether or not it was accepted).
    /// Used to detect a "momentary fake 100% at the window-reset boundary": a real cap climbs through 85~99% first,
    /// whereas after a reset the API's occasional one-shot 100% was 0~2% the tick before — use that to reject the fake 100%
    pub official_last_raw: Mutex<Option<f64>>,
    /// Backoff deadline after the usage endpoint rate-limits
    pub official_backoff: Mutex<Option<Instant>>,
    /// Backoff deadline after a token-refresh failure (safety net; refresh runs against claude.ai)
    pub refresh_backoff: Mutex<Option<Instant>>,
    /// Set when the stored credential's refresh token turned out dead (invalid_grant): the pet wiped
    /// it and needs the user to reconnect. The panel surfaces this and a one-time notification fires.
    pub reconnect_needed: AtomicBool,
    pub reconnect_notified: AtomicBool,
    /// After a rate-limited "connect account", refuse to hit the console token endpoint again until
    /// this deadline — every attempt resets the endpoint's ~6h lockout, so retrying only prolongs it.
    pub connect_cooldown: Mutex<Option<Instant>>,
    /// Event-driven fetch request: raise the flag on Stop completion / panel open to query official usage ASAP
    pub official_want: AtomicBool,
    /// Instant of the last official-API attempt (regardless of success), for the 60-second debounce
    pub official_last_try: Mutex<Option<Instant>>,
    /// In-app updater: availability + download progress, pushed to the panel
    pub update: Mutex<UpdateState>,
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
                agent_tasks: Vec::new(),
            }),
            scanner: Mutex::new(Scanner::new()),
            snapshot: Mutex::new(UsageSnapshot::default()),
            cfg: Mutex::new(Config::load()),
            hooks_seen: AtomicBool::new(false),
            warned_80: AtomicBool::new(false),
            warned_limit: AtomicBool::new(false),
            panel_open: AtomicBool::new(false),
            pet_at_top: AtomicBool::new(false),
            last_pos_save: Mutex::new(Instant::now()),
            last_resize: Mutex::new(Instant::now()),
            official: Mutex::new(None),
            official_last_raw: Mutex::new(None),
            official_backoff: Mutex::new(None),
            refresh_backoff: Mutex::new(None),
            reconnect_needed: AtomicBool::new(false),
            reconnect_notified: AtomicBool::new(false),
            connect_cooldown: Mutex::new(None),
            official_want: AtomicBool::new(false),
            official_last_try: Mutex::new(None),
            update: Mutex::new(UpdateState::default()),
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
    /// Number of sessions currently working (frontend draws a ×N badge when >1)
    pub working_count: usize,
    pub session_count: usize,
    /// Seconds the longest current work run has lasted
    pub work_secs: u64,
    /// Seconds spent waiting for your input (the longest run); frontend escalates the "anxious" look
    pub attention_secs: u64,
    pub tool_note: Option<String>,
    pub celebrate: u8,
    /// A tool just errored (currently annoyed)
    pub oops: bool,
    /// Number of in-flight background tasks
    pub bg_count: usize,
    /// Number of in-flight subagents (Task/Agent), for the mini-clone overlay
    pub agent_count: usize,
    /// The stored credential's refresh token died — the panel should prompt the user to reconnect
    pub reconnect: bool,
    /// In-app updater state (availability + download progress)
    pub update: UpdateState,
}

pub fn build_update(shared: &Shared) -> PetUpdate {
    let core = shared.core.lock().unwrap();
    let snap = shared.snapshot.lock().unwrap().clone();
    let update = shared.update.lock().unwrap().clone();
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

    // Only official data or a user-set manual limit may put the pet to sleep / raise alerts;
    // the auto estimate (vs. historical peak) is display-only — it falsely reports 100% when setting a new record
    let pct_valid = snap.basis == "official" || snap.basis == "manual";
    let state = if attention {
        "attention"
    } else if working > 0 {
        "working"
    } else if done {
        "done"
    } else if snap.mode == "subscription" && pct_valid && snap.block_pct >= 1.0 {
        "limit" // Quota maxed out, go to sleep — can't do any work anyway
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
        agent_count: core.agent_tasks.iter().filter(|&&u| now < u).count(),
        reconnect: shared.reconnect_needed.load(Ordering::Relaxed),
        update,
    }
}

pub fn push_update(app: &AppHandle, shared: &Shared) {
    let payload = build_update(shared);
    let _ = app.emit("pet-update", payload);
}

/// Expire done / bubble / tool notes and clean up zombie sessions. Returns whether an update should be pushed.
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
        // Stuck-session safety net: when Claude Code is killed by Ctrl+C it sends no Stop / SessionEnd,
        // so the session stays Working forever (pretending to think). Add a "no hook activity" timeout to Working:
        //   · not in a tool call (model thinking/generating), silent for over 5 min → treat as interrupted
        //   · in a tool call (possibly a long command running) → relax to 25 min
        // A live session refreshes last_seen via a hook every few seconds to minutes, so this won't misfire
        if s.base == Base::Working {
            let limit = if s.in_tool {
                Duration::from_secs(25 * 60)
            } else {
                Duration::from_secs(5 * 60)
            };
            if now.duration_since(s.last_seen) > limit {
                s.base = Base::Idle;
                s.done_until = None;
                s.in_tool = false;
                changed = true;
            }
        }
    }
    // Zombie sessions: no events for over 6 hours (e.g. Claude Code was killed without sending SessionEnd)
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
    let agent_before = core.agent_tasks.len();
    core.agent_tasks.retain(|&u| now < u);
    changed |= core.agent_tasks.len() != agent_before;
    if core.celebrate > 0 && !core.sessions.values().any(|s| s.base == Base::Done) {
        core.celebrate = 0;
        changed = true;
    }
    // Daily report: pops once per day after everyone has been idle for a full 10 minutes
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
            let report = if i18n::is_zh() {
                format!("今日战报:完成 {} 轮,烧了 {} tokens", core.stops_today, fmt)
            } else {
                format!("Today: {} runs, {} tokens burned", core.stops_today, fmt)
            };
            core.bubble = Some((report, now + Duration::from_secs(20)));
            changed = true;
        }
    } else {
        core.idle_since = None;
    }
    // While any session is working or waiting for input, push every second so the frontend's timers keep ticking
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

    // Subscription mode: prefer the API's real percentage, but fetching follows Claude's actions,
    // not a wall clock — the percentage only moves when Claude burns tokens, so we ask on hook
    // events, never on a timer and never when idle:
    //   · with_official (startup / mode switch / account connect) → ask directly
    //   · official_want flag raised by a hook (PreToolUse activity / Stop completion) or panel open → ask
    //   · reset point passed but data is still the old window's → one-shot correction
    // All flag-driven asks share a 60s debounce, so a tool-heavy turn caps at ~1 fetch/min.
    // On failure (rate limit / network), keep the old value up to 6 hours; only then fall back to local estimation
    if snap.mode == "subscription" {
        let now = Instant::now();
        let backoff = shared
            .official_backoff
            .lock()
            .unwrap()
            .map(|t| now < t)
            .unwrap_or(false);
        let asap = shared.official_want.swap(false, Ordering::Relaxed);
        let mut cache = shared.official.lock().unwrap();
        // The reset instant recorded in the cache has passed = the window has actually rolled over
        let window_over = |o: &OfficialUsage| {
            o.five_reset_ts != 0 && chrono::Utc::now().timestamp() >= o.five_reset_ts
        };
        let reset_stale = cache
            .as_ref()
            .map(|(o, at)| window_over(o) && now.duration_since(*at) > Duration::from_secs(60))
            .unwrap_or(false);
        let tried_recently = shared
            .official_last_try
            .lock()
            .unwrap()
            .map(|t| now.duration_since(t) < Duration::from_secs(60))
            .unwrap_or(false);
        let should = !backoff
            && (with_official || ((asap || reset_stale) && !tried_recently));
        if should {
            *shared.official_last_try.lock().unwrap() = Some(now);
            use crate::official::FetchOutcome;
            match crate::official::fetch(shared, &cfg.oauth_token) {
                FetchOutcome::Ok(fresh) => {
                    // Fake-100% debounce: a real cap climbs through 85~99% first, whereas at the window-reset
                    // boundary the API's occasional one-shot 100% was 0~2% the tick before. If it jumps to ≥100%
                    // but the previous raw reading was still low (<85%), treat it as a suspicious glitch and
                    // discard this reading (requiring the next tick to confirm); record the raw reading — two
                    // consecutive high values get accepted, so a real limit is never held out at the door forever
                    let prev_raw = shared.official_last_raw.lock().unwrap().unwrap_or(0.0);
                    *shared.official_last_raw.lock().unwrap() = Some(fresh.five_pct);
                    let suspect = fresh.five_pct >= 1.0 && prev_raw < 0.85;
                    if suspect {
                        eprintln!(
                            "[claude-pet] Official usage: ignoring a suspected 100% spike (previous tick {:.0}%), waiting for next tick to confirm",
                            prev_raw * 100.0
                        );
                    } else {
                        let changed = cache
                            .as_ref()
                            .map(|(old, _)| (old.five_pct - fresh.five_pct).abs() > 0.005)
                            .unwrap_or(true);
                        if changed {
                            println!(
                                "[claude-pet] Official usage: 5h {:.0}%, 7d {}",
                                fresh.five_pct * 100.0,
                                fresh
                                    .week_pct
                                    .map(|p| format!("{:.0}%", p * 100.0))
                                    .unwrap_or_else(|| "--".into())
                            );
                        }
                        *cache = Some((fresh, now));
                    }
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
            if window_over(off) {
                // Reset instant has passed but no new-window data yet: zero it out as reset,
                // never hold the previous window's stale 100% and let the pet fake-sleep
                snap.block_pct = 0.0;
                snap.block_reset_ts = 0;
            } else {
                snap.block_pct = off.five_pct;
                snap.block_reset_ts = off.five_reset_ts;
            }
            snap.week_pct = off.week_pct;
            snap.basis = "official".into();
        }
    }

    *shared.snapshot.lock().unwrap() = snap;
}

/// Usage threshold notifications (80% / 100%): notify only once, reset after it drops back
pub fn check_usage_alerts(app: &AppHandle, shared: &Shared) {
    // Refresh token died → fire a one-time "please reconnect" notification
    if shared.reconnect_needed.load(Ordering::Relaxed)
        && !shared.reconnect_notified.swap(true, Ordering::Relaxed)
    {
        let cfg_notify = shared.cfg.lock().unwrap().notify;
        if cfg_notify {
            notify(
                app,
                &crate::i18n::t("Claude 账号连接已失效", "Claude account disconnected"),
                &crate::i18n::t(
                    "请在宠物面板点「连接 Claude 账号」重新登录",
                    "Click \"Connect Claude account\" in the pet panel to sign in again",
                ),
            );
        }
    }
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
        // Quota exhausted: the API is already rejecting requests, so any session still marked
        // "working / waiting for input" was actually interrupted (no Stop event arrives at limit).
        // Don't let the pet pretend to think forever — move all to idle, let the sleep state take over, and add an explanatory bubble
        let interrupted = {
            let mut core = shared.core.lock().unwrap();
            let mut hit = false;
            for s in core.sessions.values_mut() {
                if s.base == Base::Working || s.base == Base::Attention {
                    s.base = Base::Idle;
                    s.done_until = None;
                    hit = true;
                }
            }
            if hit {
                core.tool_note = None;
                core.bubble = Some((
                    i18n::t(
                        "额度用完了,任务被打断,先睡会儿…",
                        "Quota's used up — tasks interrupted, taking a nap…",
                    )
                    .to_string(),
                    Instant::now() + Duration::from_secs(120),
                ));
            }
            hit
        };
        if !shared.warned_limit.swap(true, Ordering::Relaxed) && notify_on {
            let body = if interrupted {
                i18n::t(
                    "5 小时窗口额度已用完,运行中的任务被打断,宠物先睡了",
                    "5-hour window quota is used up — running tasks were interrupted, the pet is napping",
                )
            } else {
                i18n::t(
                    "5 小时窗口额度已用完,宠物先睡了",
                    "5-hour window quota is used up — the pet is napping",
                )
            };
            notify(app, i18n::t("额度到顶了", "Quota reached"), body);
        }
    } else if pct >= 0.8 {
        shared.warned_limit.store(false, Ordering::Relaxed);
        if !shared.warned_80.swap(true, Ordering::Relaxed) && notify_on {
            notify(
                app,
                i18n::t("额度快到了", "Quota almost reached"),
                i18n::t("当前 5 小时窗口用量已超过 80%", "Current 5-hour window usage is over 80%"),
            );
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
