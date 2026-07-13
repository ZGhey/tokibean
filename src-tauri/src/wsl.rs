// WSL discovery: enumerate the .claude directories across WSL distros (Windows-only).
// Claude Code running inside WSL reads Linux-side files, reached from Windows via \\wsl$. Both the
// usage scanner and the hook installer need this list, so the distro enumeration + UTF-16 decode
// lives here once instead of being written twice.
//
// Touching \\wsl$\<distro>\... BOOTS that distro: Windows starts a stopped VM on demand to serve the
// 9p share. A desktop pet has no business starting someone's Linux VM — nor paying the multi-second
// stall while it comes up. So the passive scans (usage, agent detection, "are the hooks complete?")
// only ever look at distros that are ALREADY running; a stopped one is simply skipped and picked up
// on a later rescan once the user starts it themselves. Only the installer — an explicit click —
// reaches into every distro, boot included, because that is what the user asked for.

use std::path::PathBuf;

/// `~/.claude` across the distros that are already running. Never starts one.
#[cfg(target_os = "windows")]
pub fn claude_dirs() -> Vec<PathBuf> {
    claude_sites().into_iter().map(|(_, p)| p).collect()
}

/// Same, but each directory paired with the distro it lives in — so the UI can say *which* WSL
/// needs hooks rather than "WSL" as if there were only ever one.
#[cfg(target_os = "windows")]
pub fn claude_sites() -> Vec<(String, PathBuf)> {
    sites_in(&distros(true))
}

/// `~/.claude` across every distro, starting stopped ones if needed. Installer-only.
#[cfg(target_os = "windows")]
pub fn claude_dirs_all() -> Vec<PathBuf> {
    sites_in(&distros(false))
        .into_iter()
        .map(|(_, p)| p)
        .collect()
}

/// Distro names. `running_only` maps to `wsl -l --running`, which reports the live ones without
/// starting anything (listing is metadata; it never touches the 9p share).
#[cfg(target_os = "windows")]
fn distros(running_only: bool) -> Vec<String> {
    let mut cmd = std::process::Command::new("wsl.exe");
    crate::official::no_window(&mut cmd);
    cmd.arg("-l").arg("-q");
    if running_only {
        cmd.arg("--running");
    }
    let Ok(o) = cmd.output() else {
        return Vec::new();
    };
    // Exit code 1 with no distros running is normal, not a failure.
    if !o.status.success() && !running_only {
        return Vec::new();
    }
    // wsl.exe outputs UTF-16LE.
    let text = if o.stdout.iter().take(8).any(|&b| b == 0) {
        let units: Vec<u16> = o
            .stdout
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(&o.stdout).to_string()
    };
    text.lines()
        .map(|l| l.trim().trim_start_matches('\u{feff}').to_string())
        .filter(|l| !l.is_empty())
        .collect()
}

#[cfg(target_os = "windows")]
fn sites_in(distros: &[String]) -> Vec<(String, PathBuf)> {
    use std::fs;
    let mut out = Vec::new();
    for distro in distros {
        let base = PathBuf::from(format!(r"\\wsl$\{}", distro));
        if let Ok(entries) = fs::read_dir(base.join("home")) {
            for e in entries.flatten() {
                let p = e.path().join(".claude");
                if p.is_dir() {
                    out.push((distro.clone(), p));
                }
            }
        }
        let rootp = base.join("root").join(".claude");
        if rootp.is_dir() {
            out.push((distro.clone(), rootp));
        }
    }
    out
}

#[cfg(not(target_os = "windows"))]
pub fn claude_dirs() -> Vec<PathBuf> {
    Vec::new()
}

#[cfg(not(target_os = "windows"))]
pub fn claude_sites() -> Vec<(String, PathBuf)> {
    Vec::new()
}

#[cfg(not(target_os = "windows"))]
pub fn claude_dirs_all() -> Vec<PathBuf> {
    Vec::new()
}
