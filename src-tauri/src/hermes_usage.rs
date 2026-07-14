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
            if let Ok(tokens) = conn.query_row(sql, [since], |row| row.get::<_, i64>(0)) {
                if tokens > 0 {
                    total = total.saturating_add(tokens as u64);
                }
            }
        }
    }
    total
}

/// All state.db paths for detected Hermes profiles.
pub fn all_state_dbs() -> Vec<PathBuf> {
    let mut out = Vec::new();
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return out,
    };
    let hermes_home = std::env::var("HERMES_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| home.join(".hermes"));

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
}
