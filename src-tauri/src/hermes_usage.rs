// Hermes token scanner: reads token usage from Hermes state.db (SQLite) across
// all profiles. Pure seam: scan_token_totals(dbs, since) → u64, injectable with
// a timestamp. Scanned on the 30s heartbeat cycle.

use std::path::PathBuf;

/// Total tokens used today across all Hermes profiles. `since` is a Unix timestamp
/// (seconds) for today's start. Runs a simple SELECT against one or more state.db
/// files, summing input_tokens + output_tokens for CLI/TUI sessions since that time.
pub fn scan_token_totals(db_paths: &[PathBuf], since: i64) -> u64 {
    let mut total: u64 = 0;
    for db_path in db_paths {
        if let Ok(conn) = rusqlite::Connection::open(db_path) {
            let sql = "SELECT COALESCE(SUM(input_tokens + output_tokens), 0)
                        FROM sessions
                        WHERE source IN ('tui', 'cli')
                          AND started_at >= ?1";
            if let Ok(tokens) = conn.query_row(sql, (since,), |row| row.get::<_, i64>(0)) {
                if tokens > 0 {
                    total = total.saturating_add(tokens as u64);
                }
            }
        }
    }
    total
}

/// Per-day tokens over the last 7 days (oldest → today). `local_midnight` is the
/// Unix timestamp for today 00:00 in local time, matching the bucketing used by
/// the main usage scanner.
pub fn scan_daily_tokens(db_paths: &[PathBuf], local_midnight: i64) -> Vec<u64> {
    let mut daily = vec![0u64; 7];
    for db_path in db_paths {
        let Ok(conn) = rusqlite::Connection::open(db_path) else {
            continue;
        };
        for i in 0usize..7 {
            let days_back = (6 - i) as i64;
            let day_start = local_midnight - days_back * 86400;
            let day_end = day_start + 86400;
            let sql = "SELECT COALESCE(SUM(input_tokens + output_tokens), 0)
                        FROM sessions
                        WHERE source IN ('tui', 'cli')
                          AND started_at >= ?1 AND started_at < ?2";
            if let Ok(tokens) = conn.query_row(sql, (day_start, day_end), |row| row.get::<_, i64>(0)) {
                if tokens > 0 {
                    daily[i] = daily[i].saturating_add(tokens as u64);
                }
            }
        }
    }
    daily
}

/// All state.db paths for detected Hermes profiles.
pub fn all_state_dbs() -> Vec<PathBuf> {
    let mut out = Vec::new();
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return out,
    };
    let hermes_home = {
        let raw = std::env::var("HERMES_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| home.join(".hermes"));
        // If HERMES_HOME points into a profile subdir, go up two levels
        if raw.parent().map(|pp| pp.file_name() == Some(std::ffi::OsStr::new("profiles"))).unwrap_or(false) {
            raw.parent().and_then(|p| p.parent()).map(|p| p.to_path_buf()).unwrap_or(raw)
        } else {
            raw
        }
    };

    let default_db = hermes_home.join("state.db");
    if default_db.exists() {
        out.push(default_db);
    }

    let profiles_dir = hermes_home.join("profiles");
    if let Ok(entries) = std::fs::read_dir(&profiles_dir) {
        for entry in entries.flatten() {
            let db = entry.path().join("state.db");
            if db.exists() {
                out.push(db);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Datelike, TimeZone};

    #[test]
    fn empty_paths_give_zero() {
        assert_eq!(scan_token_totals(&[], 0), 0);
    }

    #[test]
    fn nonexistent_db_gives_zero() {
        assert_eq!(
            scan_token_totals(&[PathBuf::from("/nonexistent/hermes_state.db")], 0),
            0
        );
    }

    #[test]
    fn real_state_db_scans_without_error() {
        // Environmental smoke test: only runs where a real Hermes state.db exists. Scans ALL
        // history (since 0), not "today" — a machine whose Hermes was last used yesterday is
        // not a parser bug, and asserting on today's usage made this test fail every morning.
        let home = dirs::home_dir().unwrap();
        let db = home.join(".hermes").join("state.db");
        if !db.exists() {
            return;
        }
        let tokens = scan_token_totals(&[db], 0);
        assert!(tokens > 0, "a present state.db should have historical tokens, got 0");
    }
}
