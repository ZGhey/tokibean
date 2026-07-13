// Usage aggregation: parse the JSONL session logs Claude Code writes locally
// Data source: ~/.claude/projects/<project>/<session>.jsonl
// Each assistant message carries message.usage (input/output/cache token counts) and message.model

use chrono::{DateTime, Local, TimeZone, Utc};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;

use crate::config::Config;

#[derive(Clone)]
pub struct UsageEvent {
    pub ts: i64, // epoch seconds
    pub input: u64,
    pub output: u64,
    pub cache_w: u64,
    pub cache_r: u64,
    pub model: String,
    /// Which agent burned these tokens. Token totals span every agent; Claude's 5-hour billing block
    /// and the USD cost do NOT — we don't model other agents' prices, and Codex's tokens have
    /// nothing to do with Claude's billing window.
    pub agent: String,
}

impl UsageEvent {
    pub fn total(&self) -> u64 {
        self.input + self.output + self.cache_w + self.cache_r
    }
}

/// Incremental scanner: remembers the read offset per file and only parses appended data
pub struct Scanner {
    offsets: HashMap<PathBuf, u64>,
    /// Dedup keys (message.id:requestId) mapped to the event timestamp, so stale keys can be
    /// pruned alongside events instead of accumulating for the lifetime of the process
    seen: HashMap<String, i64>,
    pub events: Vec<UsageEvent>,
    /// projects directories inside WSL distros (accessed from Windows via \\wsl$), refreshed periodically
    #[cfg(target_os = "windows")]
    wsl_roots: Vec<PathBuf>,
    #[cfg(target_os = "windows")]
    wsl_checked: Option<std::time::Instant>,
}

impl Scanner {
    pub fn new() -> Self {
        Scanner {
            offsets: HashMap::new(),
            seen: HashMap::new(),
            events: Vec::new(),
            #[cfg(target_os = "windows")]
            wsl_roots: Vec::new(),
            #[cfg(target_os = "windows")]
            wsl_checked: None,
        }
    }

    /// Enumerate ~/.claude/projects for all users across WSL distros, refreshed every 10 minutes.
    /// The distro discovery itself lives in crate::wsl; this only maps each .claude to its projects
    /// dir and caches the result so the scan (every 30s) doesn't spawn wsl.exe each time.
    #[cfg(target_os = "windows")]
    fn wsl_projects_dirs(&mut self) -> Vec<PathBuf> {
        let now = std::time::Instant::now();
        let stale = self
            .wsl_checked
            .map(|t| now.duration_since(t).as_secs() > 600)
            .unwrap_or(true);
        if stale {
            self.wsl_checked = Some(now);
            self.wsl_roots = crate::wsl::claude_dirs()
                .into_iter()
                .map(|d| d.join("projects"))
                .filter(|p| p.is_dir())
                .collect();
            if !self.wsl_roots.is_empty() {
                println!("[claude-pet] WSL usage directories: {}", self.wsl_roots.len());
            }
        }
        self.wsl_roots.clone()
    }

    #[cfg(not(target_os = "windows"))]
    fn wsl_projects_dirs(&mut self) -> Vec<PathBuf> {
        // No WSL off Windows; crate::wsl::claude_dirs() is empty here, keeping the seam uniform.
        crate::wsl::claude_dirs()
            .into_iter()
            .map(|d| d.join("projects"))
            .collect()
    }

    fn projects_dir(cfg: &Config) -> Option<PathBuf> {
        let p = crate::agents::dir(cfg, crate::state::AGENT_CLAUDE)?.join("projects");
        if p.is_dir() {
            Some(p)
        } else {
            None
        }
    }

    pub fn scan(&mut self, cfg: &Config) {
        let mut files: Vec<PathBuf> = Vec::new();
        if let Some(root) = Self::projects_dir(cfg) {
            collect_jsonl(&root, &mut files, 0);
        }
        for root in self.wsl_projects_dirs() {
            collect_jsonl(&root, &mut files, 0);
        }
        for f in &files {
            self.scan_file(f);
        }
        // Drop read offsets for files that no longer exist (Claude Code prunes old transcripts),
        // so the map doesn't accumulate dead paths for the lifetime of the process
        let live: HashSet<&PathBuf> = files.iter().collect();
        self.offsets.retain(|p, _| live.contains(&p));
        // Keep only the last 8 days to prevent unbounded memory growth; prune dedup keys on the
        // same cutoff (session-resume duplicates only span nearby files, so 8 days is ample)
        let cutoff = Utc::now().timestamp() - 8 * 24 * 3600;
        self.events.retain(|e| e.ts >= cutoff);
        self.seen.retain(|_, ts| *ts >= cutoff);
    }

    fn scan_file(&mut self, path: &PathBuf) {
        let Ok(meta) = fs::metadata(path) else { return };
        let len = meta.len();
        let offset = *self.offsets.get(path).unwrap_or(&0);
        let start = if len < offset { 0 } else { offset }; // if the file was truncated/rewritten, read from the start
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
        // The last line may not be fully written yet (no newline); leave it for next time
        let complete_len = match buf.iter().rposition(|&b| b == b'\n') {
            Some(pos) => pos + 1,
            None => {
                return; // not even one full line written
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
        let ts_str = v["timestamp"].as_str().unwrap_or("");
        let Ok(dt) = DateTime::parse_from_rfc3339(ts_str) else { return };
        let ts = dt.timestamp();
        // Dedup: on session resume the same message can appear in multiple files
        let msg_id = v["message"]["id"].as_str().unwrap_or("");
        let req_id = v["requestId"].as_str().unwrap_or("");
        if !msg_id.is_empty() || !req_id.is_empty() {
            let key = format!("{}:{}", msg_id, req_id);
            if self.seen.insert(key, ts).is_some() {
                return;
            }
        }
        let ev = UsageEvent {
            ts,
            input: usage["input_tokens"].as_u64().unwrap_or(0),
            output: usage["output_tokens"].as_u64().unwrap_or(0),
            cache_w: usage["cache_creation_input_tokens"].as_u64().unwrap_or(0),
            cache_r: usage["cache_read_input_tokens"].as_u64().unwrap_or(0),
            model: v["message"]["model"].as_str().unwrap_or("unknown").to_string(),
            agent: crate::state::AGENT_CLAUDE.to_string(),
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

/// One agent's quota window, self-describing.
///
/// Deliberately NOT normalized against any other agent's: Claude's 5-hour billing block and Codex's
/// window (43200 minutes — thirty days — on the free plan) are different quantities. They are shown
/// side by side, one card each, and are never averaged, summed, or compared. An agent with no quota
/// data has no entry here at all — never an entry reading 0% or "unknown".
#[derive(Serialize, Clone, Default, PartialEq, Debug)]
pub struct AgentQuota {
    /// Stable agent slug: "claude" | "codex"
    pub agent: String,
    /// Window utilization, 0.0-1.0
    pub pct: f64,
    /// Percentage basis: official (from the agent itself) | manual (tokens vs. a configured limit) | none
    pub basis: String,
    /// Whether `pct` is trustworthy enough to display / drive warn + sleep (basis official || manual)
    pub pct_valid: bool,
    /// The window's own length in minutes. Claude's block is 300; Codex reports its own. The label is
    /// rendered FROM this — hard-coding "5h" is wrong for any agent but Claude.
    pub window_minutes: u64,
    /// Epoch seconds when the window resets, 0 = no active window
    pub reset_ts: i64,
    /// Tokens counted in the current window (Claude's manual basis shows this against `limit_tokens`)
    pub tokens: u64,
    /// The configured manual token limit, 0 = not applicable
    pub limit_tokens: u64,
    /// Official weekly-limit utilization, 0.0-1.0. Claude only (Codex's second window, when its plan
    /// has one, is its own entry in `secondary_pct`-free terms — see codex.rs).
    pub week_pct: Option<f64>,
}

/// Claude's billing block is five hours.
pub const CLAUDE_WINDOW_MINUTES: u64 = 300;

#[derive(Serialize, Clone, Default)]
pub struct UsageSnapshot {
    pub mode: String, // subscription | api
    /// One entry per agent that has quota data. Empty = no percentage anywhere (show no card).
    pub quotas: Vec<AgentQuota>,
    /// Tokens in Claude's current 5-hour window (kept for the manual-limit readout)
    pub block_tokens: u64,
    pub max_block_tokens: u64,
    /// Today (local timezone), across ALL agents
    pub today_tokens: u64,
    /// Claude-only. The panel labels it as such — we don't model other agents' prices, so this must
    /// never pretend to be a total (see ADR-0009).
    pub today_cost: f64,
    /// Last 7 days (rolling), across ALL agents
    pub week_tokens: u64,
    /// Claude-only, same caveat as today_cost
    pub week_cost: f64,
    pub models: Vec<ModelUsage>,
    pub has_data: bool,
    /// Per-day tokens over the last 7 days (oldest → today), for the trend chart. ALL agents.
    pub daily_tokens: Vec<u64>,
    /// The Codex share of each of those days, so the chart can show which agent burned what rather
    /// than blending two agents' work into one indistinguishable bar.
    pub daily_codex: Vec<u64>,
}

impl UsageSnapshot {
    /// The quota entry for one agent, if it has one.
    pub fn quota(&self, agent: &str) -> Option<&AgentQuota> {
        self.quotas.iter().find(|q| q.agent == agent)
    }

    /// Insert or replace an agent's quota entry, keeping the list stable-ordered by agent slug so
    /// the panel's cards don't reshuffle between snapshots.
    pub fn set_quota(&mut self, q: AgentQuota) {
        match self.quotas.iter_mut().find(|e| e.agent == q.agent) {
            Some(slot) => *slot = q,
            None => {
                self.quotas.push(q);
                self.quotas.sort_by(|a, b| a.agent.cmp(&b.agent));
            }
        }
    }
}

/// USD cost of one event. **Claude only.** We model Anthropic's prices and nobody else's, so another
/// agent's tokens cost zero here rather than being silently priced as if they were Sonnet's — which
/// is exactly what would happen if this fell through to the default arm (ADR-0009). The panel labels
/// the cost as Claude's so the figure never pretends to be a total.
fn cost_of(e: &UsageEvent, cfg: &Config) -> f64 {
    if e.agent != crate::state::AGENT_CLAUDE {
        return 0.0;
    }
    let p = &cfg.prices;
    let m = e.model.to_lowercase();
    let (i, o) = if m.contains("opus") || m.contains("fable") || m.contains("mythos") {
        (p.opus_in, p.opus_out) // fable/mythos pricing undisclosed; estimate at the opus tier for now
    } else if m.contains("haiku") {
        (p.haiku_in, p.haiku_out)
    } else {
        (p.sonnet_in, p.sonnet_out) // sonnet and unknown models use the sonnet price
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

/// Split events into 5-hour window blocks: a window starts at the UTC hour of first activity and lasts 5 hours;
/// the next event past the window's end starts a new window. Matches ccusage's blocks semantics.
/// `now_ts` (epoch seconds, UTC) is injected so the block/today/week math is deterministic and testable.
pub fn build_snapshot(events: &[UsageEvent], cfg: &Config, now_ts: i64) -> UsageSnapshot {
    let mut evs: Vec<&UsageEvent> = events.iter().collect();
    evs.sort_by_key(|e| e.ts);

    // The 5-hour billing block is ANTHROPIC's. Only Claude's tokens belong in it — Codex's have
    // nothing to do with Claude's billing window, and folding them in would inflate the manual-limit
    // percentage with work Anthropic never billed for.
    let claude_evs: Vec<&&UsageEvent> = evs
        .iter()
        .filter(|e| e.agent == crate::state::AGENT_CLAUDE)
        .collect();

    let mut blocks: Vec<(i64, i64, u64, f64)> = Vec::new(); // (start, end, tokens, weighted cost)
    for e in &claude_evs {
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
    let (block_tokens, block_reset) = match blocks.last() {
        Some(b) if now_ts < b.1 => (b.2, b.1),
        _ => (0, 0),
    };

    // 5-hour window percentage. Only two trustworthy bases: a manually configured token limit,
    // or the official API (filled in later by state::refresh_usage). The old "auto" estimate
    // (weighted cost vs. the historical peak window) was too inaccurate to show, so it's gone —
    // without a manual limit or official data we report no percentage at all (basis "none").
    let (pct, limit, basis) = if cfg.block_limit > 0 {
        (
            block_tokens as f64 / cfg.block_limit as f64,
            cfg.block_limit,
            "manual",
        )
    } else {
        (0.0, 0u64, "none")
    };

    // Today: from local-timezone midnight of now_ts's local calendar day
    let local_now = Local
        .timestamp_opt(now_ts, 0)
        .single()
        .unwrap_or_else(Local::now);
    let local_midnight = local_now
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .and_then(|nd| Local.from_local_datetime(&nd).earliest())
        .map(|dt| dt.timestamp())
        .unwrap_or(now_ts - 24 * 3600);
    let week_cutoff = now_ts - 7 * 24 * 3600;

    let mut today_tokens = 0u64;
    let mut today_cost = 0.0f64;
    let mut week_tokens = 0u64;
    let mut week_cost = 0.0f64;
    let mut per_model: HashMap<String, u64> = HashMap::new();
    let mut daily_tokens = vec![0u64; 7];
    let mut daily_codex = vec![0u64; 7];

    // Tokens and the trend span EVERY agent — "today's work" means all of it. Cost does not: we
    // model Anthropic's prices and nobody else's, so cost_of() returns zero for another agent's
    // tokens and the panel labels the figure as Claude's (ADR-0009). A dollar number that silently
    // omitted an agent while the token count beside it included one would be a lie by juxtaposition.
    for e in &evs {
        if e.ts >= week_cutoff {
            week_tokens += e.total();
            week_cost += cost_of(e, cfg);
            // Another agent's tokens are listed under the agent, not squeezed into Anthropic's model
            // names — Codex's model is not a Sonnet, and calling it "other" would hide it.
            let label = if e.agent == crate::state::AGENT_CLAUDE {
                short_model(&e.model)
            } else {
                e.agent.clone()
            };
            *per_model.entry(label).or_insert(0) += e.total();
        }
        if e.ts >= local_midnight {
            today_tokens += e.total();
            today_cost += cost_of(e, cfg);
            daily_tokens[6] += e.total();
            if e.agent != crate::state::AGENT_CLAUDE {
                daily_codex[6] += e.total();
            }
        } else {
            // yesterday=5, day before=4…
            let days_back = (local_midnight - e.ts - 1).div_euclid(86400);
            let idx = 5 - days_back;
            if (0..=5).contains(&idx) {
                daily_tokens[idx as usize] += e.total();
                if e.agent != crate::state::AGENT_CLAUDE {
                    daily_codex[idx as usize] += e.total();
                }
            }
        }
    }

    let mut models: Vec<ModelUsage> = per_model
        .into_iter()
        .map(|(model, tokens)| ModelUsage { model, tokens })
        .collect();
    models.sort_by(|a, b| b.tokens.cmp(&a.tokens));
    models.truncate(3);

    // Claude's quota entry. `official` data (from the usage API) overwrites this in
    // state::refresh_usage when it's available; a basis of "none" means we have no percentage at all
    // and the panel shows no bar — never a guess.
    let claude = AgentQuota {
        agent: "claude".into(),
        pct,
        basis: basis.to_string(),
        // Final value is stamped by the projection; build_snapshot sets the local-data baseline
        pct_valid: basis == "manual",
        window_minutes: CLAUDE_WINDOW_MINUTES,
        reset_ts: block_reset,
        tokens: block_tokens,
        limit_tokens: limit,
        week_pct: None, // filled by state::refresh_usage in official mode
    };

    UsageSnapshot {
        mode: cfg.resolved_mode().to_string(),
        quotas: vec![claude],
        block_tokens,
        max_block_tokens: max_block,
        today_tokens,
        today_cost,
        week_tokens,
        week_cost,
        models,
        has_data: !evs.is_empty(),
        daily_tokens,
        daily_codex,
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

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(ts: i64, tokens: u64) -> UsageEvent {
        UsageEvent {
            ts,
            input: tokens,
            output: 0,
            cache_w: 0,
            cache_r: 0,
            model: "sonnet".into(),
            agent: "claude".into(),
        }
    }

    fn codex_ev(ts: i64, tokens: u64) -> UsageEvent {
        UsageEvent {
            ts,
            input: tokens,
            output: 0,
            cache_w: 0,
            cache_r: 0,
            model: "codex".into(),
            agent: "codex".into(),
        }
    }

    // An hour-aligned epoch so floor_to_hour is a no-op on the block start
    const H: i64 = 1_699_999_200; // 1_699_999_200 % 3600 == 0

    #[test]
    fn events_within_5h_share_one_block() {
        let evs = vec![ev(H + 60, 100), ev(H + 3600, 50)];
        let snap = build_snapshot(&evs, &Config::default(), H + 7200);
        assert_eq!(snap.block_tokens, 150);
        // window starts at the floored hour of first activity and lasts 5 hours
        assert_eq!(snap.quota("claude").unwrap().reset_ts, H + 5 * 3600);
    }

    #[test]
    fn event_past_window_opens_a_new_block() {
        // second event is 6h after the first → past the 5h window → new block
        let evs = vec![ev(H + 60, 100), ev(H + 6 * 3600, 40)];
        let now = H + 6 * 3600 + 60;
        let snap = build_snapshot(&evs, &Config::default(), now);
        // only the latest (still-open) block counts toward block_tokens
        assert_eq!(snap.block_tokens, 40);
        assert_eq!(snap.max_block_tokens, 100); // the earlier, larger block
    }

    #[test]
    fn expired_window_reports_no_active_block() {
        let evs = vec![ev(H + 60, 100)];
        // now is well past the window end (H + 5h)
        let snap = build_snapshot(&evs, &Config::default(), H + 10 * 3600);
        assert_eq!(snap.block_tokens, 0);
        assert_eq!(snap.quota("claude").unwrap().reset_ts, 0);
    }

    #[test]
    fn manual_limit_gives_manual_basis() {
        let mut cfg = Config::default();
        cfg.block_limit = 1000;
        let snap = build_snapshot(&[ev(H + 60, 250)], &cfg, H + 3600);
        let q = snap.quota("claude").unwrap();
        assert_eq!(q.basis, "manual");
        assert!((q.pct - 0.25).abs() < 1e-9);
        assert_eq!(q.limit_tokens, 1000);
        assert_eq!(q.window_minutes, CLAUDE_WINDOW_MINUTES);
    }

    #[test]
    fn no_limit_gives_none_basis_and_no_pct() {
        let snap = build_snapshot(&[ev(H + 60, 250)], &Config::default(), H + 3600);
        let q = snap.quota("claude").unwrap();
        assert_eq!(q.basis, "none");
        assert_eq!(q.pct, 0.0);
        assert!(!q.pct_valid, "no basis → no percentage may drive anything");
    }

    #[test]
    fn todays_event_lands_in_today_and_last_daily_bucket() {
        let now = H + 7200;
        let snap = build_snapshot(&[ev(now, 500)], &Config::default(), now);
        assert_eq!(snap.today_tokens, 500);
        assert_eq!(snap.daily_tokens.len(), 7);
        assert_eq!(snap.daily_tokens[6], 500); // today is the last bucket
    }

    #[test]
    fn empty_events_has_no_data() {
        let snap = build_snapshot(&[], &Config::default(), H);
        assert!(!snap.has_data);
        assert_eq!(snap.block_tokens, 0);
    }

    // --- Cross-agent token accounting (ticket 09 / ADR-0009) ---

    #[test]
    fn todays_tokens_span_every_agent() {
        // "Today's work" means all of it — the daily battle-report bubble would undercount a day
        // spent in Codex otherwise.
        let now = H + 7200;
        let snap = build_snapshot(&[ev(now, 300), codex_ev(now, 200)], &Config::default(), now);
        assert_eq!(snap.today_tokens, 500);
        assert_eq!(snap.week_tokens, 500);
        assert_eq!(*snap.daily_tokens.last().unwrap(), 500);
    }

    #[test]
    fn codex_tokens_cost_nothing_rather_than_being_priced_as_sonnet() {
        // The trap this test exists for: cost_of() matches on the model NAME, and its fallback arm is
        // Sonnet's price. Without the agent check, every Codex token would be silently billed at
        // Anthropic's Sonnet rate and quietly inflate the dollar figure.
        let now = H + 7200;
        let claude_only = build_snapshot(&[ev(now, 1_000_000)], &Config::default(), now);
        let with_codex = build_snapshot(
            &[ev(now, 1_000_000), codex_ev(now, 5_000_000)],
            &Config::default(),
            now,
        );
        assert_eq!(
            with_codex.today_cost, claude_only.today_cost,
            "5M Codex tokens must not add a cent to the cost"
        );
        assert!(with_codex.today_cost > 0.0, "Claude's own cost is still counted");
        assert_eq!(with_codex.today_tokens, 6_000_000, "…but the tokens are all there");
    }

    #[test]
    fn codex_tokens_stay_out_of_claudes_billing_block() {
        // The 5-hour block is Anthropic's. Codex's tokens have nothing to do with it, and folding
        // them in would inflate the manual-limit percentage with work Anthropic never billed for.
        let mut cfg = Config::default();
        cfg.block_limit = 1000;
        let snap = build_snapshot(&[ev(H + 60, 250), codex_ev(H + 60, 900)], &cfg, H + 3600);
        assert_eq!(snap.block_tokens, 250, "only Claude's tokens are in Claude's block");
        let q = snap.quota("claude").unwrap();
        assert!((q.pct - 0.25).abs() < 1e-9, "Codex must not push Claude's block to 115%");
    }

    #[test]
    fn codex_is_listed_under_its_own_name_not_squeezed_into_a_model() {
        // short_model() would file "codex" under "other", hiding it. It isn't a Sonnet; say so.
        let now = H + 7200;
        let snap = build_snapshot(&[ev(now, 100), codex_ev(now, 400)], &Config::default(), now);
        let codex = snap.models.iter().find(|m| m.model == "codex").expect("a codex row");
        assert_eq!(codex.tokens, 400);
        assert!(snap.models.iter().any(|m| m.model == "sonnet"));
    }
}
