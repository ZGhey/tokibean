// App config: ~/.config/claude-pet/config.json (%APPDATA%\claude-pet on Windows)

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

/// Pet geometry. Mirrors recomputeGeom()/DEFAULT_SCALE in src/main.js — keep both in sync.
/// The collapsed window is BASE_H_AT_1X · scale tall, with the pet canvas (184 · scale, plus a
/// fixed 4px body padding) sitting at its bottom edge.
pub const DEFAULT_SCALE: f64 = 0.75;
pub const BASE_H_AT_1X: f64 = 340.0;
pub const CANVAS_H_AT_1X: f64 = 184.0;
pub const CANVAS_W_AT_1X: f64 = 200.0;
pub const PAD_B: f64 = 4.0;
pub const MIN_WIN_W: f64 = 240.0;
/// Window height reserved for the usage panel, above the pet canvas.
///
/// The panel overlaps the canvas by 60px (its negative margin-bottom), so this is
/// `PANEL_MAX_H - 60` — and PANEL_MAX_H lives twice on the frontend, in src/main.js and as the
/// `body.prealloc #panel` max-height in style.css. All three are one fact; keep them in step.
///
/// Sized for the worst panel a user actually sees, MEASURED: two quota cards, the update banner, the
/// setup line and a five-session list came to 399px, and PANEL_MAX_H (500) leaves headroom for a
/// longer session list. Setup moved to the Settings window (ADR-0014), which is why this can now be
/// small AND safe — the panel no longer carries the one-time UI that used to overflow it.
pub const PANEL_ALLOWANCE: f64 = 440.0;
/// Collapsed window height used by every build before the pet-size setting existed (0.4.4).
/// A config with `pet_scale: None` had its position saved against a window this tall.
pub const LEGACY_BASE_H: f64 = 340.0;

/// Window width in logical px for a given pet scale (never narrower than the usage panel).
pub fn win_w(scale: f64) -> f64 {
    MIN_WIN_W.max((CANVAS_W_AT_1X * scale + 40.0).round())
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct Prices {
    pub opus_in: f64,
    pub opus_out: f64,
    pub sonnet_in: f64,
    pub sonnet_out: f64,
    pub haiku_in: f64,
    pub haiku_out: f64,
    /// Cache-write multiplier relative to the input price
    pub cache_write_mult: f64,
    /// Cache-read multiplier relative to the input price
    pub cache_read_mult: f64,
}

impl Default for Prices {
    fn default() -> Self {
        // Unit: USD per million tokens. Prices change; can be edited in config.json
        Prices {
            opus_in: 15.0,
            opus_out: 75.0,
            sonnet_in: 3.0,
            sonnet_out: 15.0,
            haiku_in: 0.8,
            haiku_out: 4.0,
            cache_write_mult: 1.25,
            cache_read_mult: 0.1,
        }
    }
}

/// One agent's override. Agents are DETECTED (by their config dir), not configured — this exists
/// only so a user can turn a detected agent off.
#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct AgentCfg {
    pub enabled: bool,
    /// Where this agent's config directory actually is, when it isn't where we'd look. Set by hand in
    /// Settings (the agent's tab → Add) — the escape hatch for CLAUDE_CONFIG_DIR / CODEX_HOME users
    /// and anything else we failed to imagine. None = detect it. See agents.rs.
    pub dir: Option<String>,
}

impl Default for AgentCfg {
    fn default() -> Self {
        // A detected agent is watched unless the user says otherwise — the discovery moment ("oh,
        // it watches Codex too") IS the feature; hiding it behind a checkbox would waste it.
        AgentCfg { enabled: true, dir: None }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct Config {
    /// auto | subscription | api
    pub mode: String,
    /// Hook server listen port
    pub port: u16,
    /// Hook server listen address. Defaults to localhost only; WSL NAT mode needs "0.0.0.0"
    /// (note: 0.0.0.0 exposes it to the LAN, and the firewall will prompt once)
    pub bind: String,
    /// Subscription-mode 5-hour window token limit. 0 = auto (use the historical peak window)
    pub block_limit: u64,
    /// Whether to send system notifications
    pub notify: bool,
    /// Completion-notification denoising: don't notify for jobs shorter than this many seconds
    pub notify_min_secs: u64,
    /// Sound (completion "ding" / soft chime when waiting for input), off by default
    pub sound: bool,
    /// Skin: classic (default) / a filename under the skins/ directory
    pub skin: String,
    /// Pet display scale multiplier. Only the pet canvas scales (not the panel); the window
    /// grows around a fixed bottom-center anchor. Valid steps: 0.5 / 0.75 / 1.0 / 1.25.
    /// Every step keeps the art-pixel size (4·scale·dpr) an integer, so pixel edges stay crisp.
    /// `None` means the setting predates this feature (a pre-0.4.4 config, whose collapsed window
    /// was always LEGACY_BASE_H tall) — that's the signal for the one-time position migration in
    /// main.rs, so keep it an Option rather than defaulting it away.
    pub pet_scale: Option<f64>,
    /// Boss key (global shortcut) accelerator string, e.g. "CommandOrControl+Shift+B".
    /// Summons/hides the pet in one press; same format as a Tauri accelerator (Cmd/Ctrl/Alt/Shift + key)
    pub boss_key: String,
    /// A release version the user chose to skip; automatic update checks won't re-prompt for it
    pub skip_version: String,
    /// Remembered window position (physical pixels), None = system default
    pub pos_x: Option<i32>,
    pub pos_y: Option<i32>,
    /// Windows only: the pet's on-screen anchor = its canvas-top Y (physical pixels). The collapsed
    /// window is pre-allocated to the full panel height, so the window's own top-left is
    /// layout-dependent (pet at window bottom in up-layout, top in below-layout) and can't be
    /// restored directly — this layout-independent anchor is what we persist and restore instead.
    /// Migrated once from the old `pos_y` (the old collapsed window top equaled the pet canvas top).
    pub pet_anchor_y: Option<i32>,
    /// Per-agent overrides, keyed by agent slug ("codex"). Purely ADDITIVE — agents are DETECTED by
    /// their config directory, and this only exists so a user can opt OUT of one that was detected.
    /// Claude's own settings (mode / block_limit / oauth_*) deliberately stay at the top level: they
    /// hold a refresh token that rotates on every use, and a migration bug there would log the user
    /// out of an account they connected through a browser OAuth flow. Additive means no migration
    /// code, and no migration code means that can't happen (ADR-0007).
    pub agents: HashMap<String, AgentCfg>,
    /// Whether the panel has ever been shown. False on a fresh install AND on an upgrade from a
    /// version that predates this field — both of which is intended: the panel opens itself once, to
    /// demonstrate that it exists (a pet you never think to click is a pet that does nothing), and the
    /// panel changed enough this release that returning users should see it too.
    pub onboarded: bool,
    /// Claude Code OAuth token (sk-ant-oat…, generated by `claude setup-token`),
    /// used by official usage mode. If empty, try to read it automatically from Claude Code's credential store
    pub oauth_token: String,
    /// Full-scope token saved by the panel's "connect Claude account" (auto-renewed)
    pub oauth_access: String,
    pub oauth_refresh: String,
    pub oauth_expires_ms: i64,
    pub prices: Prices,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            mode: "auto".into(),
            port: 8737,
            bind: "127.0.0.1".into(),
            block_limit: 0,
            notify: true,
            notify_min_secs: 30,
            sound: false,
            skin: "classic".into(),
            pet_scale: None,
            boss_key: "CommandOrControl+Shift+B".into(),
            skip_version: String::new(),
            pos_x: None,
            pos_y: None,
            pet_anchor_y: None,
            agents: HashMap::new(),
            onboarded: false,
            oauth_token: String::new(),
            oauth_access: String::new(),
            oauth_refresh: String::new(),
            oauth_expires_ms: 0,
            prices: Prices::default(),
        }
    }
}

impl Config {
    pub fn path() -> PathBuf {
        dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("claude-pet")
            .join("config.json")
    }

    pub fn load() -> Config {
        let p = Self::path();
        if let Ok(text) = fs::read_to_string(&p) {
            if let Ok(cfg) = serde_json::from_str::<Config>(&text) {
                return cfg;
            }
        }
        let cfg = Config::default();
        let _ = cfg.save();
        cfg
    }

    pub fn save(&self) -> std::io::Result<()> {
        let p = Self::path();
        if let Some(dir) = p.parent() {
            fs::create_dir_all(dir)?;
        }
        fs::write(&p, serde_json::to_string_pretty(self).unwrap())
    }

    /// Pet display scale, snapped to a valid step. Config is hand-editable, so an out-of-range or
    /// garbage value falls back to DEFAULT_SCALE. Shared by the frontend geometry and the
    /// click-through thread. Keep the steps in sync with DEFAULT_SCALE/SCALES in src/main.js.
    pub fn scale(&self) -> f64 {
        match self.pet_scale.unwrap_or(DEFAULT_SCALE) {
            s if (s - 0.5).abs() < 0.01 => 0.5,
            s if (s - 1.0).abs() < 0.01 => 1.0,
            s if (s - 1.25).abs() < 0.01 => 1.25,
            _ => DEFAULT_SCALE,
        }
    }

    /// Collapsed (pet-only) window height in logical px, for the current scale.
    pub fn base_h(&self) -> f64 {
        (BASE_H_AT_1X * self.scale()).round()
    }

    /// Whether an agent should be watched. Detected agents are on by default; the config only ever
    /// turns one OFF.
    pub fn agent_enabled(&self, agent: &str) -> bool {
        self.agents.get(agent).map(|a| a.enabled).unwrap_or(true)
    }

    /// Resolve the actual billing mode: subscription or API.
    /// The auto decision is heuristic: ANTHROPIC_API_KEY present in the environment → API billing,
    /// otherwise treated as subscription (OAuth login). Switch manually in the panel if the guess is wrong.
    pub fn resolved_mode(&self) -> &'static str {
        match self.mode.as_str() {
            "subscription" => "subscription",
            "api" => "api",
            _ => {
                if std::env::var("ANTHROPIC_API_KEY").map(|v| !v.is_empty()).unwrap_or(false) {
                    "api"
                } else {
                    "subscription"
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A config.json written by an older Tokibean, including a live OAuth credential.
    const LEGACY: &str = r#"{
      "mode": "subscription",
      "port": 8737,
      "bind": "127.0.0.1",
      "block_limit": 0,
      "notify": true,
      "notify_min_secs": 30,
      "sound": false,
      "skin": "classic",
      "pet_scale": 0.75,
      "boss_key": "CommandOrControl+Shift+B",
      "pos_x": 1200,
      "pet_anchor_y": 640,
      "oauth_access": "live-access-token",
      "oauth_refresh": "live-refresh-token",
      "oauth_expires_ms": 1786513525000
    }"#;

    #[test]
    fn an_existing_config_loads_unchanged_and_keeps_its_credentials() {
        // The whole reason `agents` is additive rather than a restructure (ADR-0007): Anthropic's
        // refresh token rotates on every use, so losing it means logging the user out of an account
        // they connected through a browser OAuth flow. There is no migration code, so there is no
        // migration bug.
        let cfg: Config = serde_json::from_str(LEGACY).expect("a legacy config must still parse");
        assert_eq!(cfg.oauth_access, "live-access-token");
        assert_eq!(cfg.oauth_refresh, "live-refresh-token");
        assert_eq!(cfg.oauth_expires_ms, 1786513525000);
        assert_eq!(cfg.mode, "subscription");
        assert_eq!(cfg.pos_x, Some(1200));
        assert_eq!(cfg.pet_anchor_y, Some(640));
        assert_eq!(cfg.scale(), 0.75);
        // And the new field simply defaults
        assert!(cfg.agents.is_empty());
    }

    #[test]
    fn a_detected_agent_is_watched_unless_turned_off() {
        let mut cfg = Config::default();
        assert!(cfg.agent_enabled("codex"), "detection is the default");

        cfg.agents
            .insert("codex".into(), AgentCfg { enabled: false, dir: None });
        assert!(!cfg.agent_enabled("codex"), "the config may only opt OUT");
    }

    #[test]
    fn upgrading_an_existing_user_changes_nothing_they_rely_on() {
        // The whole "painless upgrade" question, pinned. A user who has been running Tokibean for
        // months has: a connected account, hooks installed, a pet position, a size, a skin. None of
        // that may move. The new fields simply default.
        let cfg: Config = serde_json::from_str(LEGACY).expect("a legacy config must still parse");

        // The credential survives — this is the one that would actually hurt. Anthropic's refresh
        // token rotates on every use, so losing it logs them out of a browser OAuth flow.
        assert_eq!(cfg.oauth_access, "live-access-token");
        assert_eq!(cfg.oauth_refresh, "live-refresh-token");

        // Their pet stays where they put it, at the size they chose, in the skin they picked
        assert_eq!(cfg.pos_x, Some(1200));
        assert_eq!(cfg.pet_anchor_y, Some(640));
        assert_eq!(cfg.scale(), 0.75);
        assert_eq!(cfg.skin, "classic");
        assert_eq!(cfg.boss_key, "CommandOrControl+Shift+B");

        // Their hooks keep working: same port, so the marker in their settings.json still matches,
        // and bare /event still means claude (ADR-0008). No reinstall prompt.
        assert_eq!(cfg.port, 8737);

        // Agent directories resolve to exactly where they always were
        let claude = crate::agents::dir(&cfg, "claude").unwrap();
        assert!(claude.ends_with(".claude"), "{claude:?}");
        assert!(!crate::agents::is_manual(&cfg, "claude"));

        // The two new fields default, and `onboarded: false` is DELIBERATE for upgraders: the panel
        // opens itself once, because it changed enough this release that they should see it.
        assert!(cfg.agents.is_empty());
        assert!(!cfg.onboarded);
    }

    #[test]
    fn a_saved_config_round_trips_through_the_new_field() {
        let mut cfg: Config = serde_json::from_str(LEGACY).unwrap();
        cfg.agents
            .insert("codex".into(), AgentCfg { enabled: false, dir: None });
        let text = serde_json::to_string(&cfg).unwrap();
        let back: Config = serde_json::from_str(&text).unwrap();
        assert!(!back.agent_enabled("codex"));
        assert_eq!(back.oauth_refresh, "live-refresh-token");
    }
}
