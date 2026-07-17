// State machine: the pet's brain
// Multi-session: each Claude Code session (session_id) tracks its own state; aggregated for display:
//   any working > any attention > any done (transient) > limit (quota exhausted) > idle
//   (working first so a session waiting on input can't hide others that are actively working)
// warn (window >80%) is an overlay flag, not a state slot

use chrono::{Datelike, TimeZone};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
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

/// Which agent a session belongs to. The slug is decided at INSTALL time and carried in the hook's
/// URL path (/event/codex), never guessed from the payload — Codex's payload is nearly identical to
/// Claude's, so there is nothing to sniff. Bare /event still means claude, so hooks installed by
/// earlier versions keep working untouched.
pub const AGENT_CLAUDE: &str = "claude";
pub const AGENT_CODEX: &str = "codex";
pub const AGENT_HERMES: &str = "hermes";

/// Every agent the pet knows how to watch.
pub const AGENTS: [&str; 3] = [AGENT_CLAUDE, AGENT_CODEX, AGENT_HERMES];

/// A session is identified by (agent, profile, session_id) — ids cannot collide across agents by
/// construction, rather than by luck. Profile is empty string for agents that have no profile
/// concept (Claude, Codex); for Hermes it carries the Hermes profile name.
#[derive(Clone, PartialEq, Eq, Hash, Debug, PartialOrd, Ord)]
pub struct SessionKey {
    pub agent: String,
    pub profile: String,
    pub id: String,
}

impl SessionKey {
    pub fn new(agent: &str, profile: &str, id: &str) -> Self {
        SessionKey {
            agent: agent.to_string(),
            profile: profile.to_string(),
            id: id.to_string(),
        }
    }
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
    /// Basename of this session's working directory (from the hook event's `cwd`), so the panel
    /// list can label each anonymous session by its project folder.
    pub cwd: Option<String>,
}

pub struct Core {
    pub sessions: HashMap<SessionKey, Session>,
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
    /// Which agents we have ACTUALLY received an event from. This is what makes an agent's install
    /// status "active" an observed fact rather than a claim (ADR-0006): for Codex, writing the hook
    /// config is not enough — Codex refuses to run a hook until the user approves it in `/hooks`, so
    /// "written" and "live" are different states and only an arriving event can tell them apart.
    pub hooks_seen: Mutex<HashSet<String>>,
    /// Alert latches, one pair PER AGENT: one agent hitting its cap must not suppress the other's
    /// warning. Keyed by agent slug; every agent in AGENTS has an entry.
    pub warned: HashMap<String, (AtomicBool, AtomicBool)>, // (80%, limit)
    /// Codex's rollout-log scanner. Its quota is free on disk — no OAuth, no API call.
    pub codex_scanner: Mutex<crate::codex::CodexScanner>,
    /// Which agents are on this machine. Re-detected on the heartbeat and whenever a window opens, so
    /// a user who installs Codex mid-session just sees the pet start reacting — he never learns a
    /// detection happened, which is the point (ADR-0014).
    pub agents: Mutex<Vec<crate::agents::AgentPresence>>,
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
    /// The 80%-warning latch for one agent. Unknown agents get claude's, which can't happen — every
    /// agent in AGENTS has an entry — but degrading beats panicking in a background thread.
    pub fn warned_80(&self, agent: &str) -> &AtomicBool {
        &self.warned.get(agent).unwrap_or_else(|| &self.warned[AGENT_CLAUDE]).0
    }

    /// The limit-reached latch for one agent.
    pub fn warned_limit(&self, agent: &str) -> &AtomicBool {
        &self.warned.get(agent).unwrap_or_else(|| &self.warned[AGENT_CLAUDE]).1
    }

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
            hooks_seen: Mutex::new(HashSet::new()),
            warned: AGENTS
                .iter()
                .map(|a| (a.to_string(), (AtomicBool::new(false), AtomicBool::new(false))))
                .collect(),
            codex_scanner: Mutex::new(crate::codex::CodexScanner::new()),
            agents: Mutex::new(Vec::new()),
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

// PetUpdate / SessionBrief and the pure aggregation live in the projection module (the display seam).
pub use crate::projection::PetUpdate;

/// Snapshot the shared state and project it into a PetUpdate. Locks core → snapshot → update, in
/// that order; the pure projection runs off the collected data.
pub fn build_update(shared: &Shared) -> PetUpdate {
    let core = shared.core.lock().unwrap();
    build_update_from_core(shared, &core)
}

/// Project from a `core` guard the caller already holds. Lets a caller that mutated `core` emit a
/// fresh snapshot without dropping-then-relocking it (the old deadlock trap): it locks snapshot +
/// update in the same core → snapshot → update order as `build_update`, then runs the pure projection.
pub fn build_update_from_core(shared: &Shared, core: &Core) -> PetUpdate {
    let snap = shared.snapshot.lock().unwrap().clone();
    let update = shared.update.lock().unwrap().clone();
    crate::projection::project(
        core,
        snap,
        update,
        Instant::now(),
        shared.hooks_seen.lock().unwrap().clone(),
        shared.agents.lock().unwrap().clone(),
        shared.reconnect_needed.load(Ordering::Relaxed),
    )
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

/// Re-detect which agents are on this machine. Two stat() calls; call it freely — on the heartbeat,
/// and on demand whenever a window opens so the answer is never stale in the moment someone looks.
pub fn refresh_agents(shared: &Shared) {
    let cfg = shared.cfg.lock().unwrap().clone();
    let fresh = crate::agents::presence(&cfg);
    *shared.agents.lock().unwrap() = fresh;
}

pub fn refresh_usage(shared: &Shared, with_official: bool) {
    let cfg = shared.cfg.lock().unwrap().clone();
    // Codex's quota is free on disk — no OAuth, no API call, no token refresh. Scan it first so its
    // tokens join Claude's in the same snapshot (today/week totals span every agent; cost does not,
    // because we don't model other agents' prices — see ADR-0009).
    let codex_usage = if crate::agents::installed(&cfg, AGENT_CODEX) && cfg.agent_enabled(AGENT_CODEX)
    {
        let mut cx = shared.codex_scanner.lock().unwrap();
        Some(cx.scan(&cfg))
    } else {
        None
    };
    let mut snap = {
        let mut scanner = shared.scanner.lock().unwrap();
        scanner.scan(&cfg);
        let mut events = scanner.events.clone();
        if codex_usage.is_some() {
            events.extend(shared.codex_scanner.lock().unwrap().events.iter().cloned());
        }
        build_snapshot(&events, &cfg, chrono::Utc::now().timestamp())
    };

    // Codex's window describes ITSELF — its own length (43200 minutes on the free plan, i.e. thirty
    // days) and its own reset. It is never reconciled against Claude's 5-hour block; they simply sit
    // side by side as separate cards. No usable window (e.g. Codex installed but never run) means no
    // card at all, rather than a card reading 0%.
    if let Some(cx) = &codex_usage {
        if let Some(w) = &cx.primary {
            snap.set_quota(crate::usage::AgentQuota {
                agent: AGENT_CODEX.into(),
                pct: w.pct,
                basis: "official".into(), // it comes from Codex itself
                pct_valid: true,
                window_minutes: w.window_minutes,
                reset_ts: w.reset_ts,
                tokens: 0,       // Codex reports a percentage, not a token budget
                limit_tokens: 0, // …so there's no manual limit to show it against
                week_pct: cx.secondary.as_ref().map(|s| s.pct),
            });
        }
    }

    // Hermes: token count across all profiles (no rate-limit percentage — basis: none)
    if crate::agents::installed(&cfg, AGENT_HERMES) {
        let dbs = crate::hermes_usage::all_state_dbs();
        let today_start = {
            let now = chrono::Local::now();
            chrono::Local
                .with_ymd_and_hms(now.year(), now.month(), now.day(), 0, 0, 0)
                .earliest()
                .map(|d| d.timestamp())
                // Midnight can be nonexistent under a DST jump; fall back to the last 24h
                // rather than epoch 0, which would count all history as "today".
                .unwrap_or_else(|| now.timestamp() - 86_400)
        };
        let tokens = crate::hermes_usage::scan_token_totals(&dbs, today_start);
        let hermes_daily = crate::hermes_usage::scan_daily_tokens(&dbs, today_start);
        // Fold Hermes tokens into the panel's "today" total, so the bottom line counts all agents.
        snap.today_tokens = snap.today_tokens.saturating_add(tokens);
        if snap.daily_tokens.len() >= 7 {
            snap.daily_tokens[6] = snap.daily_tokens[6].saturating_add(tokens);
        }
        if snap.daily_hermes.len() >= 7 {
            for i in 0..7 {
                snap.daily_hermes[i] = snap.daily_hermes[i].saturating_add(hermes_daily[i]);
            }
        }
        if tokens > 0 {
            snap.set_quota(crate::usage::AgentQuota {
                agent: AGENT_HERMES.into(),
                pct: 0.0,
                basis: "none".into(),
                pct_valid: false,
                tokens,
                limit_tokens: 0,
                window_minutes: 0,
                reset_ts: 0,
                week_pct: None,
            });
        }
    }

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
        let now_utc = chrono::Utc::now().timestamp();
        // Consume the event-driven fetch request (raised by a hook / panel open) on every pass
        let want = shared.official_want.swap(false, Ordering::Relaxed);
        let mut cache = shared.official.lock().unwrap();
        // The reset instant recorded in the cache has passed = the window has actually rolled over
        let window_over = |o: &OfficialUsage| o.five_reset_ts != 0 && now_utc >= o.five_reset_ts;
        // Whether to fetch now is a pure decision (debounce / backoff / reset correction)
        let decision = crate::fetch_policy::decide(&crate::fetch_policy::FetchInputs {
            with_official,
            want,
            now,
            now_utc,
            backoff_deadline: *shared.official_backoff.lock().unwrap(),
            last_try: *shared.official_last_try.lock().unwrap(),
            cache: cache.as_ref().map(|(o, at)| crate::fetch_policy::CacheMeta {
                reset_ts: o.five_reset_ts,
                fetched_at: *at,
            }),
        });
        if decision == crate::fetch_policy::Decision::Fetch {
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
                    let suspect = crate::official::is_suspect_spike(prev_raw, fresh.five_pct);
                    if suspect {
                        eprintln!(
                            "[tokibean] Official usage: ignoring a suspected 100% spike (previous tick {:.0}%), waiting for next tick to confirm",
                            prev_raw * 100.0
                        );
                    } else {
                        let changed = cache
                            .as_ref()
                            .map(|(old, _)| (old.five_pct - fresh.five_pct).abs() > 0.005)
                            .unwrap_or(true);
                        if changed {
                            println!(
                                "[tokibean] Official usage: 5h {:.0}%, 7d {}",
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
            let mut q = snap.quota("claude").cloned().unwrap_or_default();
            q.agent = "claude".into();
            q.window_minutes = crate::usage::CLAUDE_WINDOW_MINUTES;
            if window_over(off) {
                // Reset instant has passed but no new-window data yet: zero it out as reset,
                // never hold the previous window's stale 100% and let the pet fake-sleep
                q.pct = 0.0;
                q.reset_ts = 0;
            } else {
                q.pct = off.five_pct;
                q.reset_ts = off.five_reset_ts;
            }
            q.week_pct = off.week_pct;
            q.basis = "official".into();
            snap.set_quota(q);
        }
    }

    *shared.snapshot.lock().unwrap() = snap;
}

/// Force ONE exhausted agent's live sessions to idle, and post a bubble naming it. Returns whether
/// anything was actually interrupted.
///
/// Why only one agent's: at its limit an agent's API is already rejecting requests, so a session
/// still marked working/waiting was in fact interrupted — no Stop event will ever arrive to end it,
/// and the pet would pretend to think forever. That reasoning is about the agent that ran out. A
/// Codex session will get its Stop perfectly well, and ending it because CLAUDE ran out would be
/// inventing an interruption that never happened (ADR-0005).
///
/// Pure apart from the injected `now`, so the rule is testable without an AppHandle.
pub fn force_idle_agent(core: &mut Core, agent: &str, now: Instant) -> bool {
    let mut hit = false;
    for (key, s) in core.sessions.iter_mut() {
        if key.agent == agent && (s.base == Base::Working || s.base == Base::Attention) {
            s.base = Base::Idle;
            s.done_until = None;
            hit = true;
        }
    }
    if hit {
        core.tool_note = None;
        let who = crate::reducer::agent_display(agent);
        core.bubble = Some((
            if i18n::is_zh() {
                format!("{} 额度用完了,任务被打断,先睡会儿…", who)
            } else {
                format!("{}'s quota is used up — tasks interrupted, taking a nap…", who)
            },
            now + Duration::from_secs(120),
        ));
    }
    hit
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
    let notify_on = shared.cfg.lock().unwrap().notify;
    // Same "which basis counts" rule as the display projection, via the shared helper. Both lists
    // are per-agent: an alert is about the agent it happened to, and the force-idle below must only
    // touch that agent's sessions.
    let (mode_sub, flags, exhausted, nearly_out) = {
        let snap = shared.snapshot.lock().unwrap();
        let counted = || {
            snap.quotas
                .iter()
                .filter(|q| crate::projection::quota_counts(q))
        };
        (
            snap.mode == "subscription",
            crate::projection::usage_flags(&snap),
            counted()
                .filter(|q| q.pct >= 1.0)
                .map(|q| q.agent.clone())
                .collect::<Vec<_>>(),
            counted()
                .filter(|q| q.pct >= 0.8 && q.pct < 1.0)
                .map(|q| (q.agent.clone(),))
                .collect::<Vec<_>>(),
        )
    };
    if !mode_sub || !flags.pct_valid {
        return;
    }
    // Force-idle the sessions of EXHAUSTED agents only. At its limit an agent's API is already
    // rejecting requests, so a session still marked working/waiting was actually interrupted — no
    // Stop event will ever arrive to end it, and the pet would pretend to think forever. But that
    // reasoning applies ONLY to the agent that ran out: a Codex session will get its Stop perfectly
    // well, and killing it because Claude ran out would be wrong (ADR-0005).
    for agent in &exhausted {
        let interrupted = {
            let mut core = shared.core.lock().unwrap();
            force_idle_agent(&mut core, agent, Instant::now())
        };
        // One alert latch per agent: one agent running out must not suppress the other's warning
        if !shared.warned_limit(agent).swap(true, Ordering::Relaxed) && notify_on {
            let who = crate::reducer::agent_display(agent);
            let body = if i18n::is_zh() {
                if interrupted {
                    format!("{} 的额度窗口已用完,运行中的任务被打断", who)
                } else {
                    format!("{} 的额度窗口已用完", who)
                }
            } else if interrupted {
                format!("{}'s quota window is used up — running tasks were interrupted", who)
            } else {
                format!("{}'s quota window is used up", who)
            };
            let title = if i18n::is_zh() {
                format!("{} 额度到顶了", who)
            } else {
                format!("{} has hit its quota", who)
            };
            notify(app, &title, &body);
        }
    }

    // Reset the limit latch for agents that recovered
    for agent in crate::state::AGENTS {
        if !exhausted.iter().any(|a| a == agent) {
            shared.warned_limit(agent).store(false, Ordering::Relaxed);
        }
    }

    // The 80% warning is about whichever agent is running dry — it doesn't wait for the others.
    for q in nearly_out {
        if !shared.warned_80(&q.0).swap(true, Ordering::Relaxed) && notify_on {
            let who = crate::reducer::agent_display(&q.0);
            let title = if i18n::is_zh() {
                format!("{} 额度快到了", who)
            } else {
                format!("{} is running low", who)
            };
            let body = if i18n::is_zh() {
                format!("{} 的当前额度窗口已用过 80%", who)
            } else {
                format!("{}'s current quota window is over 80% used", who)
            };
            notify(app, &title, &body);
        }
    }
    for agent in crate::state::AGENTS {
        let dry = {
            let snap = shared.snapshot.lock().unwrap();
            snap.quota(agent)
                .map(|q| crate::projection::quota_counts(q) && q.pct >= 0.8)
                .unwrap_or(false)
        };
        if !dry {
            shared.warned_80(agent).store(false, Ordering::Relaxed);
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn core_with(sessions: &[(&str, &str, Base)]) -> Core {
        let mut c = Core {
            sessions: HashMap::new(),
            bubble: None,
            tool_note: Some(("cmd".into(), Instant::now() + Duration::from_secs(9))),
            celebrate: 0,
            last_event: None,
            stops_today: 0,
            stops_day: String::new(),
            report_day: String::new(),
            idle_since: None,
            oops_until: None,
            bg_tasks: Vec::new(),
            agent_tasks: Vec::new(),
        };
        for (agent, id, base) in sessions {
            c.sessions.insert(
                SessionKey::new(agent, "", id),
                Session {
                    base: *base,
                    since: Instant::now(),
                    done_until: None,
                    last_seen: Instant::now(),
                    in_tool: false,
                    cwd: None,
                },
            );
        }
        c
    }

    fn base_of(core: &Core, agent: &str, id: &str) -> Base {
        core.sessions[&SessionKey::new(agent, "", id)].base
    }

    #[test]
    fn an_exhausted_agents_sessions_are_force_idled() {
        // At the limit, no Stop event will ever arrive — the session was interrupted, and without
        // this the pet pretends to think forever.
        let mut core = core_with(&[("claude", "a", Base::Working), ("claude", "b", Base::Attention)]);
        let hit = force_idle_agent(&mut core, "claude", Instant::now());
        assert!(hit);
        assert_eq!(base_of(&core, "claude", "a"), Base::Idle);
        assert_eq!(base_of(&core, "claude", "b"), Base::Idle);
        assert!(core.bubble.as_ref().unwrap().0.contains("Claude"));
        assert!(core.tool_note.is_none());
    }

    #[test]
    fn another_agents_sessions_are_left_running() {
        // THE point of ADR-0005's narrowing. Claude ran out; Codex did not. A Codex session will get
        // its Stop perfectly well, so ending it here would invent an interruption that never
        // happened — and the pet would look asleep while Codex is visibly editing files.
        let mut core = core_with(&[("claude", "a", Base::Working), ("codex", "x", Base::Working)]);
        force_idle_agent(&mut core, "claude", Instant::now());
        assert_eq!(base_of(&core, "claude", "a"), Base::Idle);
        assert_eq!(
            base_of(&core, "codex", "x"),
            Base::Working,
            "Codex still has quota — its session must keep running"
        );
    }

    #[test]
    fn nothing_to_interrupt_is_not_an_interruption() {
        let mut core = core_with(&[("claude", "a", Base::Idle), ("claude", "b", Base::Done)]);
        assert!(!force_idle_agent(&mut core, "claude", Instant::now()));
        assert!(core.bubble.is_none(), "no bubble when nothing was interrupted");
        assert_eq!(base_of(&core, "claude", "b"), Base::Done, "Done is not interrupted");
    }

    #[test]
    fn the_bubble_names_the_agent_that_ran_out() {
        let mut core = core_with(&[("codex", "x", Base::Working)]);
        force_idle_agent(&mut core, "codex", Instant::now());
        let (text, _) = core.bubble.as_ref().unwrap();
        assert!(text.contains("Codex"), "bubble said: {text}");
        assert!(!text.contains("Claude"));
    }

    #[test]
    fn each_agent_has_its_own_alert_latches() {
        // One agent hitting its cap must not suppress the other's warning
        let shared = Shared::new();
        assert!(!shared.warned_limit("claude").swap(true, Ordering::Relaxed));
        assert!(
            !shared.warned_limit("codex").load(Ordering::Relaxed),
            "Claude's latch must not have armed Codex's"
        );
        assert!(!shared.warned_80("codex").swap(true, Ordering::Relaxed));
        assert!(!shared.warned_80("claude").load(Ordering::Relaxed));
    }
}
