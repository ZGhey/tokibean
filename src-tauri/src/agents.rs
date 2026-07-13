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
    pub hooks_incomplete: bool,
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
            }
        })
        .collect()
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
