// WSL discovery: enumerate the .claude directories across every WSL distro (Windows-only).
// Claude Code running inside WSL reads Linux-side files, reached from Windows via \\wsl$. Both the
// usage scanner and the hook installer need this list, so the distro enumeration + UTF-16 decode
// lives here once instead of being written twice.

use std::path::PathBuf;

/// Every existing ~/.claude directory across all WSL distros (each distro's home users + root).
/// Non-Windows targets have no WSL, so this is empty there.
#[cfg(target_os = "windows")]
pub fn claude_dirs() -> Vec<PathBuf> {
    use std::fs;
    let mut out = Vec::new();
    let mut cmd = std::process::Command::new("wsl.exe");
    crate::official::no_window(&mut cmd);
    let Ok(o) = cmd.args(["-l", "-q"]).output() else {
        return out;
    };
    if !o.status.success() {
        return out;
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
    for distro in text.lines().map(|l| l.trim().trim_start_matches('\u{feff}')) {
        if distro.is_empty() {
            continue;
        }
        let base = PathBuf::from(format!(r"\\wsl$\{}", distro));
        if let Ok(entries) = fs::read_dir(base.join("home")) {
            for e in entries.flatten() {
                let p = e.path().join(".claude");
                if p.is_dir() {
                    out.push(p);
                }
            }
        }
        let rootp = base.join("root").join(".claude");
        if rootp.is_dir() {
            out.push(rootp);
        }
    }
    out
}

#[cfg(not(target_os = "windows"))]
pub fn claude_dirs() -> Vec<PathBuf> {
    Vec::new()
}
