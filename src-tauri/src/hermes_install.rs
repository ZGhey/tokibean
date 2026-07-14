// Hermes Agent hook installer.
//
// Hermes uses shell hooks declared in ~/.hermes/config.yaml (and per-profile
// ~/.hermes/profiles/<name>/config.yaml). Tokibean installs a Python bridge
// script that receives Hermes hook JSON on stdin and curl-POSTs it to
// localhost:<port>/event/hermes?profile=<name>.
//
// - Backs up to config.yaml.bak-tokibean before writing.
// - Idempotent: events whose command already carries the tokibean-bridge marker
//   are skipped.
// - Sets hooks_auto_accept: true so hooks run without per-event consent prompts.
// - Writes the bridge script to ~/.hermes/agent-hooks/tokibean-bridge.py.

use std::fs;
use std::path::{Path, PathBuf};

use serde_yaml::{Mapping, Value};

use crate::state::AGENT_HERMES;

const BRIDGE_SCRIPT: &str = include_str!("bridge_hermes.py");

/// The events we register hooks for. Must match the set that the bridge script handles.
pub const HERMES_HOOK_EVENTS: [&str; 8] = [
    "pre_tool_call",
    "post_tool_call",
    "pre_llm_call",
    "post_llm_call",
    "pre_approval_request",
    "on_session_start",
    "on_session_end",
    "subagent_stop",
];

/// The substring we look for in a hook's command to decide it's already ours.
pub const BRIDGE_MARKER: &str = "tokibean-bridge.py";

/// All Hermes profile config directories on this machine, if Hermes is installed.
/// Returns (profile_name, config_path) pairs. The default profile has name "default".
pub fn profile_configs() -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return out,
    };
    let hermes_home = match std::env::var("HERMES_HOME") {
        Ok(p) if !p.is_empty() => PathBuf::from(p),
        _ => home.join(".hermes"),
    };

    let default_cfg = hermes_home.join("config.yaml");
    if default_cfg.exists() {
        out.push(("default".into(), default_cfg));
    }

    let profiles_dir = hermes_home.join("profiles");
    if let Ok(entries) = fs::read_dir(&profiles_dir) {
        for entry in entries.flatten() {
            let cfg = entry.path().join("config.yaml");
            if cfg.exists() {
                let name = entry
                    .file_name()
                    .to_string_lossy()
                    .to_string();
                out.push((name, cfg));
            }
        }
    }
    out
}

/// Check whether the installed Hermes hooks are missing any event (newly added events
/// after an upgrade, or a new profile). If so, the Settings window re-surfaces the
/// install button.
pub fn incomplete(cfg: &crate::config::Config) -> bool {
    if !crate::agents::installed(cfg, AGENT_HERMES) {
        return false;
    }
    let port = cfg.port;
    for (_profile, path) in profile_configs() {
        if hooks_incomplete_at(&path, port) {
            return true;
        }
    }
    false
}

/// Whether the hooks in a single config.yaml are missing any of our events.
pub fn hooks_incomplete_at(config_path: &Path, _port: u16) -> bool {
    let Ok(raw) = fs::read_to_string(config_path) else {
        return true; // can't read → may need install
    };
    let doc: Value = match serde_yaml::from_str(&raw) {
        Ok(d) => d,
        Err(_) => return true,
    };
    let hooks = match doc.get("hooks") {
        Some(Value::Mapping(m)) => m,
        _ => return true, // no hooks block at all → definitely need install
    };
    for event in &HERMES_HOOK_EVENTS {
        let key = Value::String(event.to_string());
        let entries = match hooks.get(&key) {
            Some(Value::Sequence(s)) => s,
            _ => return true, // event missing entirely
        };
        let found = entries.iter().any(|e| {
            e.get("command")
                .and_then(|c| c.as_str())
                .map(|c| c.contains(BRIDGE_MARKER))
                .unwrap_or(false)
        });
        if !found {
            return true;
        }
    }
    false
}

/// Pure planner. Given a parsed config YAML and install parameters, return the
/// modified YAML with our hooks added. Does not touch the filesystem.
pub fn plan(
    config: Value,
    _port: u16,
    _profile: &str,
    bridge_path: &str,
) -> Value {
    let mut mapping = match config {
        Value::Mapping(m) => m,
        _ => Mapping::new(),
    };

    // Ensure hooks block exists
    let hooks = mapping
        .entry(Value::String("hooks".into()))
        .or_insert(Value::Mapping(Mapping::new()));
    let hooks_map = hooks.as_mapping_mut().expect("hooks must be mapping");

    for event in &HERMES_HOOK_EVENTS {
        let key = Value::String(event.to_string());
        let entries = hooks_map
            .entry(key.clone())
            .or_insert(Value::Sequence(Vec::new()));
        let seq = entries.as_sequence_mut().expect("hook entries must be sequence");

        let has_bridge = seq.iter().any(|e| {
            e.get("command")
                .and_then(|c| c.as_str())
                .map(|c| c.contains(BRIDGE_MARKER))
                .unwrap_or(false)
        });

        if !has_bridge {
            let mut entry = Mapping::new();
            entry.insert(
                Value::String("command".into()),
                Value::String(bridge_path.to_string()),
            );
            entry.insert(
                Value::String("timeout".into()),
                Value::Number(10.into()),
            );
            seq.push(Value::Mapping(entry));
        }
    }

    // Always set hooks_auto_accept so the user isn't prompted per-event
    if !mapping.contains_key(&Value::String("hooks_auto_accept".into())) {
        mapping.insert(
            Value::String("hooks_auto_accept".into()),
            Value::Bool(true),
        );
    }

    Value::Mapping(mapping)
}

/// Install the bridge script and hooks for all detected Hermes profiles.
pub fn install(cfg: &crate::config::Config) -> Result<(), String> {
    let port = cfg.port;
    let profiles = profile_configs();
    if profiles.is_empty() {
        return Err("No Hermes config found".into());
    }

    // Write the bridge script once
    let hermes_home = dirs::home_dir()
        .ok_or("No home directory")?
        .join(".hermes");
    let hooks_dir = hermes_home.join("agent-hooks");
    fs::create_dir_all(&hooks_dir).map_err(|e| format!("Cannot create agent-hooks dir: {e}"))?;

    let bridge_path = hooks_dir.join("tokibean-bridge.py");
    // Bake port and default profile into the script (profile is set per-profile in the config)
    let script = BRIDGE_SCRIPT
        .replace("TOKIBEAN_PORT = \"8737\"", &format!("TOKIBEAN_PORT = \"{port}\""));

    fs::write(&bridge_path, script.as_bytes())
        .map_err(|e| format!("Cannot write bridge script: {e}"))?;

    // Make it executable on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&bridge_path, std::fs::Permissions::from_mode(0o755));
    }

    for (profile, config_path) in &profiles {
        // Bake profile into the command
        let command = if cfg!(target_os = "windows") {
            format!(
                "python \"{}\"",
                bridge_path.display()
            )
        } else {
            bridge_path.display().to_string()
        };

        let raw = fs::read_to_string(config_path)
            .map_err(|e| format!("Cannot read {}: {e}", config_path.display()))?;
        let doc: Value = serde_yaml::from_str(&raw)
            .map_err(|e| format!("Cannot parse {}: {e}", config_path.display()))?;

        // Bake the profile name into the planned config
        let doc = plan(doc, port, profile, &command);

        // Backup
        let bak = config_path.with_extension("yaml.bak-tokibean");
        let _ = fs::copy(config_path, &bak);

        let out = serde_yaml::to_string(&doc)
            .map_err(|e| format!("Cannot serialize config: {e}"))?;
        fs::write(config_path, &out)
            .map_err(|e| format!("Cannot write {}: {e}", config_path.display()))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_yaml::Value;

    #[test]
    fn plan_adds_hooks_to_empty_config() {
        let config = Value::Mapping(Mapping::new());
        let result = plan(config, 8737, "default", "python ~/.hermes/agent-hooks/tokibean-bridge.py");

        let hooks = result.get("hooks").unwrap().as_mapping().unwrap();
        assert!(hooks.contains_key(&Value::String("pre_tool_call".into())));
        assert!(hooks.contains_key(&Value::String("post_llm_call".into())));

        // hooks_auto_accept is set
        assert_eq!(result.get("hooks_auto_accept").unwrap().as_bool().unwrap(), true);
    }

    #[test]
    fn plan_is_idempotent() {
        let config = Value::Mapping(Mapping::new());
        let first = plan(config, 8737, "default", "python ~/.hermes/agent-hooks/tokibean-bridge.py");
        // Running plan a second time should not add duplicate entries
        let second = plan(first, 8737, "default", "python ~/.hermes/agent-hooks/tokibean-bridge.py");

        let hooks = second.get("hooks").unwrap().as_mapping().unwrap();
        let count = hooks.get(&Value::String("pre_tool_call".into()))
            .unwrap().as_sequence().unwrap().len();
        assert_eq!(count, 1, "second plan should not duplicate entries");
    }

    #[test]
    fn plan_preserves_existing_config() {
        let mut mapping = Mapping::new();
        mapping.insert(Value::String("model".into()), Value::String("claude-sonnet".into()));
        mapping.insert(Value::String("hooks_auto_accept".into()), Value::Bool(true));
        let config = Value::Mapping(mapping);

        let result = plan(config, 8737, "default", "python ~/.hermes/agent-hooks/tokibean-bridge.py");
        assert_eq!(result.get("model").unwrap().as_str().unwrap(), "claude-sonnet");
    }
}
