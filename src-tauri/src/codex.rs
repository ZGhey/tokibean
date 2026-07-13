// Codex usage: parse the rollout logs Codex writes locally.
//
// Data source: ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl
// Each line is {timestamp, type, payload}. The interesting ones are `event_msg` lines with
// `payload.type == "token_count"`, which carry BOTH the per-turn token usage and — for free — the
// quota window: used_percent / window_minutes / resets_at. No OAuth, no API call, no token refresh.
// This is what official.rs + login.rs cost hundreds of lines to obtain for Claude.
//
// Two traps, both found by reading real bytes rather than the docs:
//
//   1. `used_percent` is on a 0-100 scale (Claude's five_pct is 0-1), and `window_minutes` is NOT
//      five hours — it is 43200 (thirty days) on the free plan. The window length must be rendered
//      from the data; a card that hard-codes "5h" is simply wrong.
//
//   2. Rollout files that Codex's onboarding IMPORTED from Claude Code have `rate_limits` fields
//      that are all null — and their envelope timestamps are NEWER than a genuine turn's, because
//      they were all written to disk during the import. "Newest file wins" and "newest token_count
//      line wins" therefore both pick a quota-less line and blank the card. The correct rule is:
//      the newest token_count line whose rate_limits.primary is non-null.

use chrono::DateTime;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;

use crate::usage::UsageEvent;

/// One of Codex's rate-limit windows, exactly as it describes itself.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct CodexWindow {
    /// 0.0-1.0 (converted from Codex's 0-100 `used_percent`)
    pub pct: f64,
    /// The window's own length. NOT assumed to be 5 hours — free plan reports 43200 (30 days).
    pub window_minutes: u64,
    /// Epoch seconds when the window resets, 0 = unknown
    pub reset_ts: i64,
}

/// What one scan of the rollout logs found.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CodexUsage {
    /// The freshest window whose rate_limits were actually present (see trap 2). None = no quota
    /// data at all, which must render as NO card — never as 0% or "unknown".
    pub primary: Option<CodexWindow>,
    /// Codex's secondary window, when the plan exposes one (free plan reports null).
    pub secondary: Option<CodexWindow>,
    /// The plan name Codex reports ("free", …), for the card's label. Empty = unknown.
    pub plan: String,
}

/// Parse one `token_count` payload's rate_limits into windows. Returns None when the payload carries
/// no usable primary window — which is exactly the case for the imported Claude-Code rollouts.
fn parse_rate_limits(payload: &serde_json::Value) -> Option<(CodexWindow, Option<CodexWindow>, String)> {
    let rl = &payload["rate_limits"];
    let window = |v: &serde_json::Value| -> Option<CodexWindow> {
        // A window is only usable if it actually reports a percentage. Imported rollouts have the
        // whole rate_limits object present but every field null.
        let pct = v["used_percent"].as_f64()?;
        Some(CodexWindow {
            pct: (pct / 100.0).clamp(0.0, 1.0), // Codex reports 0-100; we speak 0-1
            window_minutes: v["window_minutes"].as_u64().unwrap_or(0),
            reset_ts: v["resets_at"].as_i64().unwrap_or(0),
        })
    };
    let primary = window(&rl["primary"])?;
    let secondary = window(&rl["secondary"]);
    let plan = rl["plan_type"].as_str().unwrap_or("").to_string();
    Some((primary, secondary, plan))
}

/// Per-turn token usage from a `token_count` payload.
///
/// Codex hands us `info.last_token_usage` — the per-turn delta, already computed. (An earlier plan
/// assumed we'd have to difference the cumulative `total_token_usage` by hand; the file makes that
/// unnecessary.)
fn parse_tokens(payload: &serde_json::Value, ts: i64, model: &str) -> Option<UsageEvent> {
    let u = &payload["info"]["last_token_usage"];
    if !u.is_object() {
        return None;
    }
    let input = u["input_tokens"].as_u64().unwrap_or(0);
    let cached = u["cached_input_tokens"].as_u64().unwrap_or(0);
    let output = u["output_tokens"].as_u64().unwrap_or(0);
    let ev = UsageEvent {
        ts,
        // Codex reports cached_input_tokens as a SUBSET of input_tokens, so subtract it out rather
        // than counting those tokens twice.
        input: input.saturating_sub(cached),
        output,
        cache_w: 0, // Codex doesn't distinguish cache writes
        cache_r: cached,
        model: model.to_string(),
    };
    if ev.total() > 0 {
        Some(ev)
    } else {
        None
    }
}

/// A `token_count` line, parsed. Kept with its timestamp so the freshest *valid* one can win.
struct QuotaLine {
    ts: i64,
    primary: CodexWindow,
    secondary: Option<CodexWindow>,
    plan: String,
}

/// Incremental scanner over ~/.codex/sessions. Mirrors usage::Scanner's discipline: remember a byte
/// offset per file, only parse newly appended and newline-complete data.
pub struct CodexScanner {
    offsets: HashMap<PathBuf, u64>,
    pub events: Vec<UsageEvent>,
    /// The freshest valid quota line seen so far, across all files.
    best: Option<QuotaLine>,
}

impl CodexScanner {
    pub fn new() -> Self {
        CodexScanner {
            offsets: HashMap::new(),
            events: Vec::new(),
            best: None,
        }
    }

    /// Whether Codex is installed at all. An agent that isn't on the machine must never appear in
    /// the UI, so this is what gates every bit of Codex surface.
    pub fn installed() -> bool {
        dirs::home_dir()
            .map(|h| h.join(".codex").is_dir())
            .unwrap_or(false)
    }

    fn sessions_dir() -> Option<PathBuf> {
        let p = dirs::home_dir()?.join(".codex").join("sessions");
        if p.is_dir() {
            Some(p)
        } else {
            None
        }
    }

    pub fn scan(&mut self) -> CodexUsage {
        let mut files: Vec<PathBuf> = Vec::new();
        if let Some(root) = Self::sessions_dir() {
            collect_rollouts(&root, &mut files, 0);
        }
        for f in &files {
            self.scan_file(f);
        }
        // Drop offsets for files that no longer exist, so the map doesn't accumulate dead paths
        let live: std::collections::HashSet<&PathBuf> = files.iter().collect();
        self.offsets.retain(|p, _| live.contains(&p));
        // Keep 8 days, matching usage::Scanner
        let cutoff = chrono::Utc::now().timestamp() - 8 * 24 * 3600;
        self.events.retain(|e| e.ts >= cutoff);

        match &self.best {
            Some(q) => CodexUsage {
                primary: Some(q.primary.clone()),
                secondary: q.secondary.clone(),
                plan: q.plan.clone(),
            },
            None => CodexUsage::default(),
        }
    }

    fn scan_file(&mut self, path: &PathBuf) {
        let Ok(meta) = fs::metadata(path) else { return };
        let len = meta.len();
        let offset = *self.offsets.get(path).unwrap_or(&0);
        let start = if len < offset { 0 } else { offset }; // truncated/rewritten → read from the start
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
        // The last line may still be mid-write; leave it for next time
        let complete_len = match buf.iter().rposition(|&b| b == b'\n') {
            Some(pos) => pos + 1,
            None => return,
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
        let payload = &v["payload"];
        if payload["type"].as_str() != Some("token_count") {
            return;
        }
        let Ok(dt) = DateTime::parse_from_rfc3339(v["timestamp"].as_str().unwrap_or("")) else {
            return;
        };
        let ts = dt.timestamp();

        if let Some(ev) = parse_tokens(payload, ts, "codex") {
            self.events.push(ev);
        }

        // Trap 2: only a line that actually carries rate_limits may update the quota, and then only
        // if it is fresher than the best one so far. An imported rollout has a newer timestamp but
        // null rate_limits — parse_rate_limits returns None for it, so it can never win.
        if let Some((primary, secondary, plan)) = parse_rate_limits(payload) {
            let fresher = self.best.as_ref().map(|b| ts >= b.ts).unwrap_or(true);
            if fresher {
                self.best = Some(QuotaLine {
                    ts,
                    primary,
                    secondary,
                    plan,
                });
            }
        }
    }
}

fn collect_rollouts(dir: &PathBuf, out: &mut Vec<PathBuf>, depth: u32) {
    if depth > 4 {
        return; // sessions/YYYY/MM/DD/file — 3 levels is enough, 4 for slack
    }
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() {
            collect_rollouts(&p, out, depth + 1);
        } else if p.extension().map(|e| e == "jsonl").unwrap_or(false) {
            out.push(p);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Feed lines to a scanner without touching the filesystem.
    fn scan_lines(lines: &[serde_json::Value]) -> (CodexUsage, Vec<UsageEvent>) {
        let mut s = CodexScanner::new();
        for l in lines {
            s.parse_line(&l.to_string());
        }
        let usage = match &s.best {
            Some(q) => CodexUsage {
                primary: Some(q.primary.clone()),
                secondary: q.secondary.clone(),
                plan: q.plan.clone(),
            },
            None => CodexUsage::default(),
        };
        (usage, s.events)
    }

    /// A real token_count line, shape copied verbatim from a captured rollout file.
    fn real_line(ts: &str, used_percent: f64, window_minutes: u64, resets_at: i64) -> serde_json::Value {
        json!({
            "timestamp": ts,
            "type": "event_msg",
            "payload": {
                "type": "token_count",
                "info": {
                    "total_token_usage": {"input_tokens": 14911, "cached_input_tokens": 10496,
                                          "output_tokens": 5, "reasoning_output_tokens": 0,
                                          "total_tokens": 14916},
                    "last_token_usage": {"input_tokens": 14911, "cached_input_tokens": 10496,
                                         "output_tokens": 5, "reasoning_output_tokens": 0,
                                         "total_tokens": 14916},
                    "model_context_window": 258400
                },
                "rate_limits": {
                    "limit_id": "codex",
                    "limit_name": null,
                    "primary": {"used_percent": used_percent, "window_minutes": window_minutes,
                                "resets_at": resets_at},
                    "secondary": null,
                    "credits": {"has_credits": false, "unlimited": false, "balance": null},
                    "individual_limit": null,
                    "plan_type": "free",
                    "rate_limit_reached_type": null
                }
            }
        })
    }

    /// An IMPORTED rollout's token_count line: rate_limits present but every field null.
    /// Copied verbatim from a real file Codex's onboarding wrote while importing Claude Code.
    fn imported_line(ts: &str) -> serde_json::Value {
        json!({
            "timestamp": ts,
            "type": "event_msg",
            "payload": {
                "type": "token_count",
                "info": {
                    "total_token_usage": {"input_tokens": 240000, "cached_input_tokens": 0,
                                          "output_tokens": 457, "total_tokens": 240457},
                    "last_token_usage": {"input_tokens": 240000, "cached_input_tokens": 0,
                                         "output_tokens": 457, "total_tokens": 240457}
                },
                "rate_limits": {
                    "limit_id": null, "limit_name": null,
                    "primary": null, "secondary": null,
                    "plan_type": null
                }
            }
        })
    }

    #[test]
    fn used_percent_is_rescaled_from_0_100_to_0_1() {
        // Codex reports 5.0 meaning five percent. Claude's five_pct speaks 0.0-1.0.
        let (u, _) = scan_lines(&[real_line("2026-07-13T05:45:26.573Z", 5.0, 43200, 1786513525)]);
        let p = u.primary.expect("a real line has a window");
        assert!((p.pct - 0.05).abs() < 1e-9, "5.0 must become 0.05, got {}", p.pct);
    }

    #[test]
    fn the_window_is_not_five_hours() {
        // The free plan's window is 43200 minutes = 30 days. Anything that hard-codes 5h is wrong.
        let (u, _) = scan_lines(&[real_line("2026-07-13T05:45:26.573Z", 5.0, 43200, 1786513525)]);
        let p = u.primary.unwrap();
        assert_eq!(p.window_minutes, 43200);
        assert_eq!(p.reset_ts, 1786513525);
        assert_eq!(u.plan, "free");
    }

    #[test]
    fn an_imported_line_with_a_newer_timestamp_does_not_win() {
        // THE trap. The imported line is 17 seconds NEWER than the genuine turn, because Codex wrote
        // every imported rollout to disk at import time. Taking "the newest line" blanks the card.
        let (u, _) = scan_lines(&[
            real_line("2026-07-13T05:45:26.573Z", 5.0, 43200, 1786513525),
            imported_line("2026-07-13T05:45:43.023Z"), // newer!
        ]);
        let p = u.primary.expect("the real line's quota must survive the newer null one");
        assert!((p.pct - 0.05).abs() < 1e-9);
    }

    #[test]
    fn order_of_lines_does_not_matter() {
        // Same as above but fed in the other order — file iteration order is not guaranteed
        let (u, _) = scan_lines(&[
            imported_line("2026-07-13T05:45:43.023Z"),
            real_line("2026-07-13T05:45:26.573Z", 5.0, 43200, 1786513525),
        ]);
        assert!(u.primary.is_some());
    }

    #[test]
    fn the_freshest_valid_line_wins() {
        let (u, _) = scan_lines(&[
            real_line("2026-07-13T01:00:00.000Z", 5.0, 43200, 1),
            real_line("2026-07-13T03:00:00.000Z", 42.0, 43200, 2),
            real_line("2026-07-13T02:00:00.000Z", 20.0, 43200, 3),
        ]);
        let p = u.primary.unwrap();
        assert!((p.pct - 0.42).abs() < 1e-9, "the 03:00 line is the freshest");
    }

    #[test]
    fn no_valid_line_means_no_card_at_all() {
        // A user who installed Codex but never ran a turn: imported rollouts only.
        // This must render as NO quota card — never as 0%, never as "unknown".
        let (u, _) = scan_lines(&[imported_line("2026-07-13T05:45:43.023Z")]);
        assert_eq!(u.primary, None);
        assert_eq!(u, CodexUsage::default());
    }

    #[test]
    fn secondary_window_is_parsed_when_the_plan_has_one() {
        let mut line = real_line("2026-07-13T05:45:26.573Z", 5.0, 300, 1786513525);
        line["payload"]["rate_limits"]["secondary"] =
            json!({"used_percent": 12.5, "window_minutes": 10080, "resets_at": 1786600000});
        let (u, _) = scan_lines(&[line]);
        let s = u.secondary.expect("a plan with a weekly window");
        assert!((s.pct - 0.125).abs() < 1e-9);
        assert_eq!(s.window_minutes, 10080);
    }

    #[test]
    fn tokens_come_from_the_per_turn_delta() {
        let (_, events) = scan_lines(&[real_line("2026-07-13T05:45:26.573Z", 5.0, 43200, 1)]);
        assert_eq!(events.len(), 1);
        let e = &events[0];
        // cached_input_tokens is a SUBSET of input_tokens — don't count those twice
        assert_eq!(e.input, 14911 - 10496);
        assert_eq!(e.cache_r, 10496);
        assert_eq!(e.output, 5);
        assert_eq!(e.total(), 14916, "must match Codex's own total_tokens");
    }

    #[test]
    fn imported_lines_still_contribute_their_tokens() {
        // No quota, but the tokens are real work the user did — they belong in today's total
        let (u, events) = scan_lines(&[imported_line("2026-07-13T05:45:43.023Z")]);
        assert_eq!(u.primary, None);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].total(), 240457);
    }

    #[test]
    fn non_token_count_lines_are_ignored() {
        let (u, events) = scan_lines(&[
            json!({"timestamp": "2026-07-13T05:45:41.587Z", "type": "session_meta",
                   "payload": {"id": "abc", "cwd": "/x", "originator": "Codex Desktop"}}),
            json!({"timestamp": "2026-07-13T05:45:42.000Z", "type": "response_item",
                   "payload": {"type": "message"}}),
        ]);
        assert_eq!(u, CodexUsage::default());
        assert!(events.is_empty());
    }

    #[test]
    fn garbage_lines_do_not_panic() {
        let mut s = CodexScanner::new();
        for junk in ["", "   ", "not json", "{", "null", "[]", "{\"payload\": 3}"] {
            s.parse_line(junk);
        }
        assert!(s.best.is_none());
        assert!(s.events.is_empty());
    }

    #[test]
    fn a_percentage_over_100_is_clamped() {
        let (u, _) = scan_lines(&[real_line("2026-07-13T05:45:26.573Z", 140.0, 43200, 1)]);
        assert_eq!(u.primary.unwrap().pct, 1.0);
    }
}
