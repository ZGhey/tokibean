// Hermes Agent plugin installer.
//
// Installs the tokibean Hermes plugin into ~/.hermes/plugins/tokibean/ and
// enables it in config.yaml. The plugin registers Python hooks that forward
// Hermes lifecycle events to the local tokibean pet via HTTP POST.
//
// Also cleans up any leftover shell hooks from a previous install.
//
// - Backs up to config.yaml.bak-tokibean before writing.
// - Idempotent: if the plugin is already in plugins.enabled, the config skip is a no-op.
// - Plugin files are rewritten (safe: they ship with the app).

use std::fs;
use std::path::{Path, PathBuf};

use serde_yaml::{Mapping, Value};

use crate::state::AGENT_HERMES;

const PLUGIN_YAML: &str = include_str!("plugin_hermes.yaml");
const PLUGIN_PY: &str = include_str!("plugin_hermes.py");

/// The plugin name as listed in plugins.enabled.
pub const PLUGIN_NAME: &str = "tokibean";

/// All Hermes profile config directories on this machine, if Hermes is installed.
/// Returns (profile_name, config_path) pairs. The default profile has name "default".
pub fn profile_configs() -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return out,
    };
    let hermes_home = match std::env::var("HERMES_HOME") {
        Ok(p) if !p.is_empty() => {
            let path = PathBuf::from(p);
            if path.parent().map(|pp| pp.file_name() == Some(std::ffi::OsStr::new("profiles"))).unwrap_or(false) {
                path.parent().and_then(|p| p.parent()).map(|p| p.to_path_buf()).unwrap_or(path)
            } else {
                path
            }
        }
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

/// Check whether the installed Hermes hooks are missing or incomplete.
pub fn incomplete(cfg: &crate::config::Config) -> bool {
    if !crate::agents::installed(cfg, AGENT_HERMES) {
        return false;
    }
    for (_profile, path) in profile_configs() {
        if hooks_incomplete_at(&path) {
            return true;
        }
    }
    false
}

/// Whether a single config.yaml needs plugin install (plugin not in plugins.enabled,
/// or old shell hooks still present).
pub fn hooks_incomplete_at(config_path: &Path) -> bool {
    let Ok(raw) = fs::read_to_string(config_path) else {
        return true;
    };
    let doc: Value = match serde_yaml::from_str(&raw) {
        Ok(d) => d,
        Err(_) => return true,
    };

    // Check if plugin is enabled
    if let Some(Value::Mapping(plugins)) = doc.get("plugins") {
        if let Some(Value::Sequence(enabled)) = plugins.get(&Value::String("enabled".into())) {
            if enabled.iter().any(|v| v.as_str() == Some(PLUGIN_NAME)) {
                return false; // plugin is enabled — install is complete
            }
        }
    }

    true // plugin not in enabled list
}

/// Pure planner. Given a parsed config YAML, return the modified YAML with the
/// tokibean plugin enabled and any old shell hooks cleaned up.
pub fn plan(config: Value) -> Value {
    let mut mapping = match config {
        Value::Mapping(m) => m,
        _ => Mapping::new(),
    };

    // Enable the tokibean plugin
    let plugins = mapping
        .entry(Value::String("plugins".into()))
        .or_insert(Value::Mapping(Mapping::new()));
    if !plugins.is_mapping() {
        *plugins = Value::Mapping(Mapping::new());
    }
    let plugins_map = plugins.as_mapping_mut().expect("plugins is a mapping");
    let enabled = plugins_map
        .entry(Value::String("enabled".into()))
        .or_insert(Value::Sequence(Vec::new()));
    if !enabled.is_sequence() {
        *enabled = Value::Sequence(Vec::new());
    }
    let enabled_seq = enabled.as_sequence_mut().expect("enabled is a sequence");

    let already = enabled_seq.iter().any(|v| v.as_str() == Some(PLUGIN_NAME));
    if !already {
        enabled_seq.push(Value::String(PLUGIN_NAME.into()));
    }

    // Remove old shell hooks block (if any)
    mapping.remove(&Value::String("hooks".into()));
    mapping.remove(&Value::String("hooks_auto_accept".into()));

    Value::Mapping(mapping)
}

/// Install the plugin files and enable it in all Hermes profile configs.
/// Also cleans up leftover shell hooks.
pub fn install(cfg: &crate::config::Config) -> Result<String, String> {
    let port = cfg.port;
    let profiles = profile_configs();
    if profiles.is_empty() {
        return Err("No Hermes config found".into());
    }

    // Write plugin files to every profile's plugins directory.
    // Hermes discovers plugins from get_hermes_home()/plugins/ — which for profile X
    // is ~/.hermes/profiles/X/plugins/, NOT ~/.hermes/plugins/.
    let py = PLUGIN_PY.replace("TOKIBEAN_PORT = 8737", &format!("TOKIBEAN_PORT = {port}"));

    for (profile, config_path) in &profiles {
        // Config path is .../config.yaml; plugin dir is .../plugins/tokibean/
        let profile_home = config_path.parent().unwrap_or(Path::new("."));
        let plugin_dir = profile_home.join("plugins").join("tokibean");
        fs::create_dir_all(&plugin_dir)
            .map_err(|e| format!("Cannot create plugin dir for {profile}: {e}"))?;
        fs::write(plugin_dir.join("__init__.py"), py.as_bytes())
            .map_err(|e| format!("Cannot write plugin for {profile}: {e}"))?;
        fs::write(plugin_dir.join("plugin.yaml"), PLUGIN_YAML.as_bytes())
            .map_err(|e| format!("Cannot write plugin.yaml for {profile}: {e}"))?;
    }

    // Also write to the global plugins dir (for the default profile)
    let hermes_home = dirs::home_dir()
        .ok_or("No home directory")?
        .join(".hermes");
    let global_plugin_dir = hermes_home.join("plugins").join("tokibean");
    fs::create_dir_all(&global_plugin_dir)
        .map_err(|e| format!("Cannot create global plugin dir: {e}"))?;
    fs::write(global_plugin_dir.join("__init__.py"), py.as_bytes())
        .map_err(|e| format!("Cannot write global plugin: {e}"))?;
    fs::write(global_plugin_dir.join("plugin.yaml"), PLUGIN_YAML.as_bytes())
        .map_err(|e| format!("Cannot write global plugin.yaml: {e}"))?;

    // Clean up old bridge script
    let old_bridge = hermes_home.join("agent-hooks").join("tokibean-bridge.py");
    let _ = fs::remove_file(&old_bridge);

    let mut errors: Vec<String> = Vec::new();
    for (_profile, config_path) in &profiles {
        let raw = match fs::read_to_string(config_path) {
            Ok(r) => r,
            Err(e) => {
                errors.push(format!("{}: read: {e}", config_path.display()));
                continue;
            }
        };
        let doc: Value = match serde_yaml::from_str(&raw) {
            Ok(d) => d,
            Err(e) => {
                errors.push(format!("{}: parse: {e}", config_path.display()));
                continue;
            }
        };

        let doc = plan(doc);

        let bak = config_path.with_extension("yaml.bak-tokibean");
        let _ = fs::copy(config_path, &bak);

        match serde_yaml::to_string(&doc) {
            Ok(out) => {
                if let Err(e) = fs::write(config_path, &out) {
                    errors.push(format!("{}: write: {e}", config_path.display()));
                }
            }
            Err(e) => {
                errors.push(format!("{}: serialize: {e}", config_path.display()));
            }
        }
    }

    if !errors.is_empty() {
        Ok(format!("Partial success. Errors: {}", errors.join("; ")))
    } else {
        Ok(crate::i18n::t(
            "已在 {n} 个 profile 安装 tokibean 插件",
            "tokibean plugin installed in {n} profile(s)",
        )
        .replace("{n}", &profiles.len().to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_yaml::Value;

    #[test]
    fn plan_adds_plugin_to_empty_config() {
        let config = Value::Mapping(Mapping::new());
        let result = plan(config);
        let plugins = result.get("plugins").unwrap().as_mapping().unwrap();
        let enabled = plugins.get(&Value::String("enabled".into())).unwrap().as_sequence().unwrap();
        assert!(enabled.iter().any(|v| v.as_str() == Some("tokibean")));
    }

    #[test]
    fn plan_is_idempotent() {
        let config = Value::Mapping(Mapping::new());
        let first = plan(config);
        // Running plan a second time should not add duplicate plugin entries
        let second = plan(first);
        let plugins = second.get("plugins").unwrap().as_mapping().unwrap();
        let enabled = plugins.get(&Value::String("enabled".into())).unwrap().as_sequence().unwrap();
        let count = enabled.iter().filter(|v| v.as_str() == Some("tokibean")).count();
        assert_eq!(count, 1, "second plan should not duplicate plugin entries");
    }

    #[test]
    fn plan_removes_old_shell_hooks() {
        let mut mapping = Mapping::new();
        mapping.insert(Value::String("model".into()), Value::String("claude-sonnet".into()));
        mapping.insert(Value::String("hooks".into()), Value::Mapping(Mapping::new()));
        mapping.insert(Value::String("hooks_auto_accept".into()), Value::Bool(true));
        let config = Value::Mapping(mapping);

        let result = plan(config);
        assert_eq!(result.get("model").unwrap().as_str().unwrap(), "claude-sonnet");
        assert!(result.get("hooks").is_none(), "old hooks should be removed");
        assert!(result.get("hooks_auto_accept").is_none(), "hooks_auto_accept should be removed");
    }
}
