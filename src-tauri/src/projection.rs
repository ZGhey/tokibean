// Display projection: pure state -> PetUpdate snapshot.
//
// This is the seam between the pet's mutable state (state::Core, the usage snapshot, the updater
// state) and the frontend payload. `project` is a pure function — it touches no Mutex, so it can
// never re-enter a lock the caller already holds. Callers snapshot their locked state (or pass a
// `&Core` guard they already hold) and hand owned/borrowed plain data in; the priority aggregation,
// limit derivation, and warn overlay all live here and are exercised through this one interface.

use serde::Serialize;
use std::time::Instant;

use crate::state::{Base, Core, UpdateState};
use crate::usage::UsageSnapshot;

/// One session's glanceable status, for the tally chip + panel list.
#[derive(Serialize, Clone)]
pub struct SessionBrief {
    /// "working" | "attention" | "done" | "idle"
    pub state: String,
    /// Seconds spent in the current base state
    pub secs: u64,
    /// Working-directory basename (project folder), for labeling the session
    pub cwd: Option<String>,
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
    /// Per-session brief, sorted by session id so the order is stable across snapshots. Drives the
    /// multi-session status-tally chip on the pet and the per-session list in the usage panel.
    pub sessions: Vec<SessionBrief>,
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

/// Derived usage flags shared by the projection and the alert checker, so the "which basis counts"
/// rule lives in exactly one place. Only official data or a user-set manual limit may put the pet to
/// sleep / raise alerts; the removed auto estimate (vs. historical peak) was display-only and would
/// falsely report 100% when setting a new record.
pub struct UsageFlags {
    /// The block percentage is trustworthy enough to drive sleep / alerts
    pub pct_valid: bool,
    /// Window over 80% but under 100% — an overlay, not a state slot
    pub warn: bool,
    /// Subscription window maxed out — the pet may sleep
    pub at_limit: bool,
}

pub fn usage_flags(snap: &UsageSnapshot) -> UsageFlags {
    let pct_valid = snap.basis == "official" || snap.basis == "manual";
    let sub = snap.mode == "subscription";
    UsageFlags {
        pct_valid,
        warn: sub && pct_valid && snap.block_pct >= 0.8 && snap.block_pct < 1.0,
        at_limit: sub && pct_valid && snap.block_pct >= 1.0,
    }
}

/// Aggregate the per-session states + usage + updater state into the frontend payload.
/// Pure: no locks, no clock reads beyond the injected `now`.
pub fn project(
    core: &Core,
    mut snap: UsageSnapshot,
    update: UpdateState,
    now: Instant,
    hooks_seen: bool,
    reconnect: bool,
) -> PetUpdate {
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

    // Per-session brief for the tally chip + panel list, sorted by session id for a stable order
    let mut sessions: Vec<(&String, SessionBrief)> = core
        .sessions
        .iter()
        .map(|(id, s)| {
            let state = match s.base {
                Base::Attention => "attention",
                Base::Working => "working",
                Base::Done => "done",
                Base::Idle => "idle",
            };
            let brief = SessionBrief {
                state: state.to_string(),
                secs: now.duration_since(s.since).as_secs(),
                cwd: s.cwd.clone(),
            };
            (id, brief)
        })
        .collect();
    sessions.sort_by(|a, b| a.0.cmp(b.0));
    let sessions: Vec<SessionBrief> = sessions.into_iter().map(|(_, b)| b).collect();

    let flags = usage_flags(&snap);
    // Stamp the derived "is the percentage trustworthy" fact so the frontend renders it instead of
    // re-deriving the basis rule on its side of the IPC seam.
    snap.pct_valid = flags.pct_valid;
    // Working outranks attention: with several sessions, one sitting in "waiting for input" must NOT
    // hide the others that are actively working — otherwise the pet looks idle/resting while work is
    // happening. Attention only surfaces once nothing is working anymore.
    let state = if working > 0 {
        "working"
    } else if attention {
        "attention"
    } else if done {
        "done"
    } else if flags.at_limit {
        "limit" // Quota maxed out, go to sleep — can't do any work anyway
    } else {
        "idle"
    };

    PetUpdate {
        state: state.to_string(),
        warn: flags.warn,
        bubble: core.bubble.as_ref().map(|(t, _)| t.clone()),
        last_event: core.last_event.clone(),
        hooks_seen,
        usage: snap,
        working_count: working,
        session_count: core.sessions.len(),
        sessions,
        work_secs,
        attention_secs,
        tool_note: core.tool_note.as_ref().map(|(t, _)| t.clone()),
        celebrate: core.celebrate,
        oops: core.oops_until.map(|u| now < u).unwrap_or(false),
        bg_count: core.bg_tasks.iter().filter(|&&u| now < u).count(),
        agent_count: core.agent_tasks.iter().filter(|&&u| now < u).count(),
        reconnect,
        update,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::Session;
    use std::collections::HashMap;
    use std::time::Duration;

    fn empty_core() -> Core {
        Core {
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
        }
    }

    fn sess(base: Base, since: Instant) -> Session {
        Session {
            base,
            since,
            done_until: None,
            last_seen: since,
            in_tool: false,
            cwd: None,
        }
    }

    fn sub_snap(basis: &str, pct: f64) -> UsageSnapshot {
        UsageSnapshot {
            mode: "subscription".into(),
            basis: basis.into(),
            block_pct: pct,
            ..Default::default()
        }
    }

    fn project_now(core: &Core, snap: UsageSnapshot) -> PetUpdate {
        project(core, snap, UpdateState::default(), Instant::now(), true, false)
    }

    #[test]
    fn empty_is_idle() {
        let out = project_now(&empty_core(), UsageSnapshot::default());
        assert_eq!(out.state, "idle");
        assert_eq!(out.session_count, 0);
    }

    #[test]
    fn working_outranks_attention() {
        let now = Instant::now();
        let mut core = empty_core();
        core.sessions.insert("a".into(), sess(Base::Attention, now));
        core.sessions.insert("b".into(), sess(Base::Working, now));
        let out = project(&core, UsageSnapshot::default(), UpdateState::default(), now, true, false);
        assert_eq!(out.state, "working");
        assert_eq!(out.working_count, 1);
    }

    #[test]
    fn attention_when_nothing_working() {
        let now = Instant::now();
        let mut core = empty_core();
        core.sessions.insert("a".into(), sess(Base::Attention, now));
        core.sessions.insert("b".into(), sess(Base::Done, now));
        let out = project(&core, UsageSnapshot::default(), UpdateState::default(), now, true, false);
        assert_eq!(out.state, "attention");
    }

    #[test]
    fn done_outranks_idle_and_limit() {
        let now = Instant::now();
        let mut core = empty_core();
        core.sessions.insert("a".into(), sess(Base::Done, now));
        // Even at 100% usage, a fresh completion still shows "done", not "limit"
        let out = project(&core, sub_snap("official", 1.0), UpdateState::default(), now, true, false);
        assert_eq!(out.state, "done");
    }

    #[test]
    fn work_secs_takes_the_longest_run() {
        let now = Instant::now();
        let mut core = empty_core();
        core.sessions
            .insert("a".into(), sess(Base::Working, now - Duration::from_secs(30)));
        core.sessions
            .insert("b".into(), sess(Base::Working, now - Duration::from_secs(90)));
        let out = project(&core, UsageSnapshot::default(), UpdateState::default(), now, true, false);
        assert_eq!(out.working_count, 2);
        assert!(out.work_secs >= 90 && out.work_secs < 92);
    }

    #[test]
    fn limit_only_when_official_or_manual() {
        let core = empty_core();
        // official basis at 100% → sleep
        assert_eq!(project_now(&core, sub_snap("official", 1.0)).state, "limit");
        assert_eq!(project_now(&core, sub_snap("manual", 1.0)).state, "limit");
        // basis "none" (no real quota) at 100% must NOT put the pet to sleep
        assert_eq!(project_now(&core, sub_snap("none", 1.0)).state, "idle");
    }

    #[test]
    fn warn_overlay_between_80_and_100() {
        let core = empty_core();
        assert!(project_now(&core, sub_snap("official", 0.85)).warn);
        assert!(!project_now(&core, sub_snap("official", 0.79)).warn);
        // At 100% it's a limit, not a warn
        assert!(!project_now(&core, sub_snap("official", 1.0)).warn);
    }

    #[test]
    fn limit_only_in_subscription_mode() {
        let core = empty_core();
        let mut api = sub_snap("official", 1.0);
        api.mode = "api".into();
        let out = project_now(&core, api);
        assert_eq!(out.state, "idle");
        assert!(!out.warn);
    }
}
