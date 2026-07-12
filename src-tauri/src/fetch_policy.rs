// Fetch policy: the pure decision of whether to hit the official usage API right now.
//
// Fetching follows Claude's actions, not a wall clock — the 5-hour-window percentage only moves when
// Claude burns tokens. This module isolates the "should we ask now?" predicate (debounce, rate-limit
// backoff, window-reset correction) from the IO in state::refresh_usage, so the tricky timing rules
// are testable without a network, a curl subprocess, or the shared mutexes.

use std::time::{Duration, Instant};

/// Flag-driven asks share this debounce: a tool-heavy turn caps at ~1 fetch/min.
const DEBOUNCE: Duration = Duration::from_secs(60);
/// After the window's reset instant passes, wait this long before a one-shot correction fetch, so a
/// cache written moments ago isn't immediately re-fetched.
const RESET_SETTLE: Duration = Duration::from_secs(60);

/// What the cached official value tells the policy (not the value itself).
pub struct CacheMeta {
    /// Epoch seconds when the cached window ends (0 = unknown)
    pub reset_ts: i64,
    /// When the cached value was fetched
    pub fetched_at: Instant,
}

pub struct FetchInputs {
    /// Forced ask: startup / mode switch / account connect
    pub with_official: bool,
    /// A hook (PreToolUse / Stop) or panel-open raised the want flag
    pub want: bool,
    pub now: Instant,
    /// Wall-clock UTC epoch seconds, to compare against the cached window's reset instant
    pub now_utc: i64,
    /// Deadline of the usage-endpoint rate-limit backoff, if any
    pub backoff_deadline: Option<Instant>,
    /// Instant of the last fetch attempt, for the debounce
    pub last_try: Option<Instant>,
    pub cache: Option<CacheMeta>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum SkipReason {
    /// Inside the usage-endpoint rate-limit backoff window
    Backoff,
    /// A recent attempt is still within the debounce window
    Debounced,
    /// Nothing asked for a fetch (no force, no want, no reset correction)
    NotRequested,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Decision {
    Fetch,
    Skip(SkipReason),
}

/// The cached window's reset instant has passed = the window actually rolled over.
fn window_over(reset_ts: i64, now_utc: i64) -> bool {
    reset_ts != 0 && now_utc >= reset_ts
}

pub fn decide(i: &FetchInputs) -> Decision {
    let backoff = i.backoff_deadline.map(|t| i.now < t).unwrap_or(false);
    if backoff {
        return Decision::Skip(SkipReason::Backoff);
    }
    // A forced ask overrides the debounce and want/reset gating (but not the backoff above).
    if i.with_official {
        return Decision::Fetch;
    }
    // The window rolled over but the cache still holds the old window's data → one-shot correction.
    let reset_stale = i
        .cache
        .as_ref()
        .map(|c| {
            window_over(c.reset_ts, i.now_utc)
                && i.now.duration_since(c.fetched_at) > RESET_SETTLE
        })
        .unwrap_or(false);
    if !(i.want || reset_stale) {
        return Decision::Skip(SkipReason::NotRequested);
    }
    let tried_recently = i
        .last_try
        .map(|t| i.now.duration_since(t) < DEBOUNCE)
        .unwrap_or(false);
    if tried_recently {
        return Decision::Skip(SkipReason::Debounced);
    }
    Decision::Fetch
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base(now: Instant) -> FetchInputs {
        FetchInputs {
            with_official: false,
            want: false,
            now,
            now_utc: 1_000_000,
            backoff_deadline: None,
            last_try: None,
            cache: None,
        }
    }

    #[test]
    fn idle_with_nothing_pending_skips() {
        let now = Instant::now();
        assert_eq!(decide(&base(now)), Decision::Skip(SkipReason::NotRequested));
    }

    #[test]
    fn with_official_forces_a_fetch() {
        let now = Instant::now();
        let i = FetchInputs { with_official: true, ..base(now) };
        assert_eq!(decide(&i), Decision::Fetch);
    }

    #[test]
    fn backoff_blocks_even_a_forced_fetch() {
        let now = Instant::now();
        let i = FetchInputs {
            with_official: true,
            backoff_deadline: Some(now + Duration::from_secs(30)),
            ..base(now)
        };
        assert_eq!(decide(&i), Decision::Skip(SkipReason::Backoff));
    }

    #[test]
    fn expired_backoff_does_not_block() {
        let now = Instant::now();
        let i = FetchInputs {
            want: true,
            backoff_deadline: Some(now - Duration::from_secs(1)),
            ..base(now)
        };
        assert_eq!(decide(&i), Decision::Fetch);
    }

    #[test]
    fn want_fetches_when_not_recently_tried() {
        let now = Instant::now();
        let i = FetchInputs { want: true, ..base(now) };
        assert_eq!(decide(&i), Decision::Fetch);
    }

    #[test]
    fn want_is_debounced_within_60s() {
        let now = Instant::now();
        let i = FetchInputs {
            want: true,
            last_try: Some(now - Duration::from_secs(30)),
            ..base(now)
        };
        assert_eq!(decide(&i), Decision::Skip(SkipReason::Debounced));
    }

    #[test]
    fn want_fetches_again_after_debounce_passes() {
        let now = Instant::now();
        let i = FetchInputs {
            want: true,
            last_try: Some(now - Duration::from_secs(61)),
            ..base(now)
        };
        assert_eq!(decide(&i), Decision::Fetch);
    }

    #[test]
    fn reset_stale_triggers_a_correction_fetch() {
        let now = Instant::now();
        let i = FetchInputs {
            now_utc: 5_000,
            cache: Some(CacheMeta {
                reset_ts: 4_000, // window already ended (now_utc >= reset_ts)
                fetched_at: now - Duration::from_secs(120), // and cache is old enough to settle
            }),
            ..base(now)
        };
        assert_eq!(decide(&i), Decision::Fetch);
    }

    #[test]
    fn reset_stale_waits_for_the_settle_window() {
        let now = Instant::now();
        let i = FetchInputs {
            now_utc: 5_000,
            cache: Some(CacheMeta {
                reset_ts: 4_000,
                fetched_at: now - Duration::from_secs(10), // fetched too recently to settle
            }),
            ..base(now)
        };
        assert_eq!(decide(&i), Decision::Skip(SkipReason::NotRequested));
    }

    #[test]
    fn window_not_over_yet_is_not_stale() {
        let now = Instant::now();
        let i = FetchInputs {
            now_utc: 3_000,
            cache: Some(CacheMeta {
                reset_ts: 4_000, // window still open (now_utc < reset_ts)
                fetched_at: now - Duration::from_secs(120),
            }),
            ..base(now)
        };
        assert_eq!(decide(&i), Decision::Skip(SkipReason::NotRequested));
    }
}
