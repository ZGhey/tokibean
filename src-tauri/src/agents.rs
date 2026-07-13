// Where each agent lives on this machine, and whether it's here at all.
//
// Everything used to hard-code `~/.claude` and `~/.codex`. But Claude Code honours CLAUDE_CONFIG_DIR
// and Codex honours CODEX_HOME, so anyone who set either was invisible to Tokibean: no usage, no
// quota, no events, no explanation. That bug predates multi-agent support entirely — it just had
// never been reported, because the people it breaks see nothing at all rather than something wrong.
//
// Resolution order, most explicit first:
//   1. The user's own override in config.json (Settings → the agent's tab → Add). This is the only
//      one that always works, which is why the UI offers it.
//   2. The agent's env var, IF we happen to have it. We do NOT lean on this: a GUI app does not
//      inherit your shell's environment — launched from the Dock, this process has never seen your
//      .zshrc — so the env var is missing in exactly the case that needs it. It's a free hint when
//      Tokibean was started from a terminal, and nothing more.
//   3. The default: ~/.claude, ~/.codex.
//
// "Installed" means that directory exists. Same rule for both agents (ADR-0014) — Claude used to have
// no detection at all, so a user who had never touched Claude Code was shown an install button, and
// clicking it created the directory for him.

use serde::Serialize;
use std::path::PathBuf;

use crate::config::Config;
use crate::state::{AGENT_CLAUDE, AGENT_CODEX};

/// One place an agent is installed: one config directory, one settings.json, one set of hooks.
///
/// "Which Claude Code do you use?" has three answers on Windows — the desktop app, the terminal CLI,
/// and the one inside WSL — but only **two** of them are separate installs. The desktop app and the
/// Windows CLI share `%USERPROFILE%\.claude`, so one hook install covers both; a WSL distro has its
/// own `~/.claude` and needs its own. A site is therefore a config directory, not an entrypoint —
/// and the entrypoints are reported *within* a site so the UI can name what the user actually runs
/// ("Windows — desktop app and terminal") instead of a bare path he has to interpret.
#[derive(Serialize, Clone, PartialEq, Debug, Default)]
pub struct Site {
    /// "windows" | "wsl" | "local" — how to label it (the frontend localizes; distro goes in `name`)
    pub kind: String,
    /// The WSL distro name, when kind == "wsl". Empty otherwise.
    pub name: String,
    pub dir: String,
    /// Hooks here are missing or incomplete
    pub hooks_incomplete: bool,
    /// Newest transcript in this site, epoch seconds — "when did you last actually use this one"
    pub last_used: Option<i64>,
    /// Entrypoints seen in this site's recent transcripts: "desktop" | "cli"
    pub entrypoints: Vec<String>,
}

/// One agent's presence on this machine, as the frontend sees it.
#[derive(Serialize, Clone, PartialEq, Debug, Default)]
pub struct AgentPresence {
    /// "claude" | "codex"
    pub agent: String,
    /// Its config directory exists — the one and only meaning of "installed" here
    pub installed: bool,
    /// Where we looked (or were told to look), for the Settings UI to show
    pub dir: String,
    /// Whether the user pointed us here by hand, rather than us finding it
    pub manual: bool,
    /// Its hooks are missing or incomplete — something to install. Meaningless when !installed.
    /// True when ANY site is incomplete: one un-hooked WSL is still a Claude Code we're blind to.
    pub hooks_incomplete: bool,
    /// Every place this agent is installed. `hooks_incomplete` above is the OR over these.
    pub sites: Vec<Site>,
    /// Codex only: what Codex's own records say about approving our hooks — "never" | "stale" |
    /// "recorded". Empty for agents with no trust gate. NOT a claim that hooks are live: that word
    /// still belongs to an arriving event (ADR-0006). It exists so the panel stops telling a user to
    /// approve hooks he has already approved, and starts telling him when an upgrade re-armed the
    /// gate under him.
    pub approval: String,
}

/// The environment variable each agent uses to relocate its config directory.
fn env_var(agent: &str) -> &'static str {
    match agent {
        AGENT_CODEX => "CODEX_HOME",
        _ => "CLAUDE_CONFIG_DIR",
    }
}

fn default_dir_name(agent: &str) -> &'static str {
    match agent {
        AGENT_CODEX => ".codex",
        _ => ".claude",
    }
}

/// This agent's config directory, resolved. Returns None only if we can't even find a home directory.
pub fn dir(cfg: &Config, agent: &str) -> Option<PathBuf> {
    if let Some(p) = cfg.agents.get(agent).and_then(|a| a.dir.clone()) {
        if !p.trim().is_empty() {
            return Some(PathBuf::from(p));
        }
    }
    if let Ok(p) = std::env::var(env_var(agent)) {
        if !p.trim().is_empty() {
            return Some(PathBuf::from(p));
        }
    }
    Some(dirs::home_dir()?.join(default_dir_name(agent)))
}

/// Whether the user pinned this path themselves (so the Settings UI can say so, and offer to clear it)
pub fn is_manual(cfg: &Config, agent: &str) -> bool {
    cfg.agents
        .get(agent)
        .and_then(|a| a.dir.as_ref())
        .map(|p| !p.trim().is_empty())
        .unwrap_or(false)
}

/// Is this agent on this machine? Its config directory existing is the whole test — **except on
/// Windows, where Claude Code is very often installed only inside WSL.**
///
/// That user's Windows-side `%USERPROFILE%\.claude` does not exist: Claude Code lives on the Linux
/// side and reads the Linux-side settings.json. Testing only the Windows path would tell him he
/// hasn't got Claude Code, hide the install button, and leave him with no way to install hooks at
/// all — while `hooks_install` sits right there with a WSL sync path built for exactly him.
pub fn installed(cfg: &Config, agent: &str) -> bool {
    if dir(cfg, agent).map(|p| p.is_dir()).unwrap_or(false) {
        return true;
    }
    // Windows-only, and Claude-only: Codex has no WSL story (crate::wsl is empty off Windows, so this
    // is a no-op elsewhere and the seam stays uniform).
    //
    // Only distros that are already running are looked at (see wsl.rs) — probing a stopped one would
    // boot it. So a WSL-only user with his distro down reads as "no Claude Code" until he starts it,
    // at which point the 30-second heartbeat re-detects him. That is the right trade: Claude Code
    // isn't running in there either, and the pet must not start a Linux VM to find that out.
    if agent == AGENT_CLAUDE {
        return !crate::wsl::claude_dirs().is_empty();
    }
    false
}

/// Every agent's presence, freshly re-checked. Cheap enough to call on every panel open and every
/// 30-second heartbeat: it's a couple of stat() calls.
///
/// The background check is the one that matters. It's for the user who doesn't know he's supposed to
/// do anything — someone who has run Tokibean happily for months installs Codex, and the pet just
/// starts reacting. He never learns a detection happened, which is exactly the point.
pub fn presence(cfg: &Config) -> Vec<AgentPresence> {
    crate::state::AGENTS
        .iter()
        .map(|&agent| {
            let d = dir(cfg, agent);
            let installed = d.as_ref().map(|p| p.is_dir()).unwrap_or(false);
            AgentPresence {
                agent: agent.to_string(),
                installed,
                dir: d
                    .as_ref()
                    .map(|p| p.display().to_string())
                    .unwrap_or_default(),
                manual: is_manual(cfg, agent),
                // Only ask "are its hooks complete?" of an agent that's actually here. Asking about an
                // absent agent is what produced the "install Claude Code" button on a Codex-only
                // machine: the file can't be read, so it looked like a hook that needed installing.
                hooks_incomplete: installed
                    && match agent {
                        AGENT_CODEX => crate::codex_install::incomplete(cfg),
                        _ => crate::hooks_install::incomplete(cfg),
                    },
                sites: if installed { sites(cfg, agent) } else { Vec::new() },
                approval: if installed && agent == AGENT_CODEX {
                    match crate::codex_install::approval(cfg) {
                        crate::codex_install::Approval::Never => "never",
                        crate::codex_install::Approval::Stale => "stale",
                        crate::codex_install::Approval::Recorded => "recorded",
                    }
                    .to_string()
                } else {
                    String::new()
                },
            }
        })
        .collect()
}

/// Every config directory this agent is installed in: the local one, plus — for Claude on Windows —
/// each running WSL distro's. One entry per settings.json, because that is the unit hooks install into.
pub fn sites(cfg: &Config, agent: &str) -> Vec<Site> {
    let mut out = Vec::new();
    if let Some(d) = dir(cfg, agent) {
        if d.is_dir() {
            let (last_used, entrypoints) = last_use(&d);
            out.push(Site {
                kind: if cfg!(target_os = "windows") { "windows" } else { "local" }.to_string(),
                name: String::new(),
                dir: d.display().to_string(),
                hooks_incomplete: match agent {
                    AGENT_CODEX => crate::codex_install::incomplete(cfg),
                    _ => crate::hooks_install::file_incomplete_at(&d, cfg.port),
                },
                last_used,
                entrypoints,
            });
        }
    }
    // Codex has no WSL story; wsl::claude_sites() is empty off Windows, so this stays uniform.
    if agent == AGENT_CLAUDE {
        for (distro, d) in crate::wsl::claude_sites() {
            let (last_used, entrypoints) = last_use(&d);
            out.push(Site {
                kind: "wsl".to_string(),
                name: distro,
                dir: d.display().to_string(),
                hooks_incomplete: crate::hooks_install::file_incomplete_at(&d, cfg.port),
                last_used,
                entrypoints,
            });
        }
    }
    out
}

/// When this site was last used, and by which entrypoint — read straight from the transcripts it
/// writes. `entrypoint` ("claude-desktop" / "cli") is how we can tell the desktop app from the
/// terminal, which share one config directory and are otherwise indistinguishable.
///
/// Only the newest transcript is opened, and only its tail: this runs on the heartbeat, and one of
/// these directories can live across a \\wsl$ share.
fn last_use(dir: &std::path::Path) -> (Option<i64>, Vec<String>) {
    use std::io::{Read, Seek, SeekFrom};

    let projects = dir.join("projects");
    let mut newest: Option<(std::time::SystemTime, PathBuf)> = None;
    let Ok(entries) = std::fs::read_dir(&projects) else {
        return (None, Vec::new());
    };
    for proj in entries.flatten() {
        let Ok(files) = std::fs::read_dir(proj.path()) else { continue };
        for f in files.flatten() {
            if f.path().extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let Ok(m) = f.metadata().and_then(|m| m.modified()) else { continue };
            if newest.as_ref().map(|(t, _)| m > *t).unwrap_or(true) {
                newest = Some((m, f.path()));
            }
        }
    }
    let Some((mtime, path)) = newest else { return (None, Vec::new()) };
    let secs = mtime
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .ok();

    // Tail only — a long session's transcript runs to megabytes.
    const TAIL: u64 = 256 * 1024;
    let mut eps = Vec::new();
    if let Ok(mut f) = std::fs::File::open(&path) {
        let len = f.metadata().map(|m| m.len()).unwrap_or(0);
        let from = len.saturating_sub(TAIL);
        if f.seek(SeekFrom::Start(from)).is_ok() {
            let mut buf = String::new();
            let _ = f.take(TAIL).read_to_string(&mut buf);
            if buf.contains(r#""entrypoint":"claude-desktop""#) {
                eps.push("desktop".to_string());
            }
            if buf.contains(r#""entrypoint":"cli""#) {
                eps.push("cli".to_string());
            }
        }
    }
    (secs, eps)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::AgentCfg;

    fn cfg_with(agent: &str, dir: Option<&str>) -> Config {
        let mut c = Config::default();
        if let Some(d) = dir {
            c.agents.insert(
                agent.to_string(),
                AgentCfg {
                    enabled: true,
                    dir: Some(d.to_string()),
                },
            );
        }
        c
    }

    #[test]
    fn the_default_is_the_home_directory() {
        let cfg = Config::default();
        let d = dir(&cfg, AGENT_CLAUDE).unwrap();
        assert!(d.ends_with(".claude"), "got {d:?}");
        let d = dir(&cfg, AGENT_CODEX).unwrap();
        assert!(d.ends_with(".codex"), "got {d:?}");
    }

    #[test]
    fn a_manual_path_wins() {
        // The escape hatch for CLAUDE_CONFIG_DIR users, enterprise layouts, and anything else we
        // failed to imagine. It doesn't guess — it asks.
        let cfg = cfg_with(AGENT_CLAUDE, Some("/opt/claude-config"));
        assert_eq!(
            dir(&cfg, AGENT_CLAUDE).unwrap(),
            PathBuf::from("/opt/claude-config")
        );
        assert!(is_manual(&cfg, AGENT_CLAUDE));
        // …and only for the agent it was set on
        assert!(dir(&cfg, AGENT_CODEX).unwrap().ends_with(".codex"));
        assert!(!is_manual(&cfg, AGENT_CODEX));
    }

    #[test]
    fn an_empty_manual_path_is_not_a_path() {
        // Clearing the field in Settings must fall back to detection, not point us at "".
        let cfg = cfg_with(AGENT_CLAUDE, Some("   "));
        assert!(dir(&cfg, AGENT_CLAUDE).unwrap().ends_with(".claude"));
        assert!(!is_manual(&cfg, AGENT_CLAUDE));
    }

    #[test]
    fn a_missing_directory_means_not_installed() {
        let cfg = cfg_with(AGENT_CODEX, Some("/definitely/not/here/xyz"));
        assert!(!installed(&cfg, AGENT_CODEX));
    }

    #[test]
    fn an_absent_agent_never_reports_incomplete_hooks() {
        // THE bug this file exists to kill: hooks_install::incomplete() can't read a settings.json
        // that isn't there and says "incomplete", which the panel rendered as "install me". A user who
        // has never touched Claude Code was being told to install Claude Code hooks — and clicking it
        // created ~/.claude for him.
        let cfg = cfg_with(AGENT_CLAUDE, Some("/definitely/not/here/xyz"));
        let p = presence(&cfg);
        let claude = p.iter().find(|a| a.agent == AGENT_CLAUDE).unwrap();
        assert!(!claude.installed);
        assert!(
            !claude.hooks_incomplete,
            "an agent that isn't here has no hooks to install"
        );
    }

    #[test]
    fn presence_covers_every_agent_in_a_stable_order() {
        let p = presence(&Config::default());
        assert_eq!(p.len(), crate::state::AGENTS.len());
        assert_eq!(p[0].agent, AGENT_CLAUDE);
        assert_eq!(p[1].agent, AGENT_CODEX);
        // Each one reports where we looked, so Settings can show it
        assert!(p.iter().all(|a| !a.dir.is_empty()));
    }
}
