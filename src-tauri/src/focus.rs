// Click the bubble to focus the terminal: bring the topmost Claude / terminal / IDE window to the front
// Note: hook events carry no window info, so a precise "session -> window" mapping is impossible.
// We pick the candidate window highest in Z-order -- exactly what a single-terminal user wants,
// and for multiple terminals it hits the most recently used one

#[cfg(target_os = "windows")]
pub fn focus_terminal() -> Result<String, String> {
    windows_impl::focus()
}

#[cfg(target_os = "macos")]
pub fn focus_terminal() -> Result<String, String> {
    // Try activating common terminals in order
    for app in ["Claude", "iTerm2", "Terminal", "Visual Studio Code"] {
        let ok = std::process::Command::new("osascript")
            .args(["-e", &format!("tell application \"{}\" to activate", app)])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if ok {
            return Ok(app.to_string());
        }
    }
    Err(crate::i18n::t("没找到可聚焦的终端", "No terminal found to focus").into())
}

#[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
pub fn focus_terminal() -> Result<String, String> {
    Err(crate::i18n::t("此平台暂不支持", "Not supported on this platform").into())
}

#[cfg(target_os = "windows")]
mod windows_impl {
    use std::ffi::c_void;

    type HWND = *mut c_void;

    #[link(name = "user32")]
    unsafe extern "system" {
        fn EnumWindows(
            cb: unsafe extern "system" fn(HWND, isize) -> i32,
            lparam: isize,
        ) -> i32;
        fn IsWindowVisible(hwnd: HWND) -> i32;
        fn GetWindowThreadProcessId(hwnd: HWND, pid: *mut u32) -> u32;
        fn IsIconic(hwnd: HWND) -> i32;
        fn ShowWindow(hwnd: HWND, cmd: i32) -> i32;
        fn SetForegroundWindow(hwnd: HWND) -> i32;
        fn GetWindowTextLengthW(hwnd: HWND) -> i32;
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut c_void;
        fn QueryFullProcessImageNameW(
            h: *mut c_void,
            flags: u32,
            name: *mut u16,
            size: *mut u32,
        ) -> i32;
        fn CloseHandle(h: *mut c_void) -> i32;
    }

    /// Target process names (lowercase, without .exe), selected by this list's priority order
    const TARGETS: [&str; 10] = [
        "claude",
        "windowsterminal",
        "code",
        "cursor",
        "wezterm-gui",
        "alacritty",
        "conemu64",
        "mintty",
        "powershell",
        "cmd",
    ];

    struct Hit {
        hwnd: HWND,
        rank: usize,
        z: usize, // smaller means further to the front
    }

    unsafe extern "system" fn enum_cb(hwnd: HWND, lparam: isize) -> i32 {
        unsafe {
            let hits = &mut *(lparam as *mut (Vec<Hit>, usize));
            hits.1 += 1;
            let z = hits.1;
            if IsWindowVisible(hwnd) == 0 || GetWindowTextLengthW(hwnd) == 0 {
                return 1;
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, &mut pid);
            if pid == 0 {
                return 1;
            }
            // PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
            let h = OpenProcess(0x1000, 0, pid);
            if h.is_null() {
                return 1;
            }
            let mut buf = [0u16; 512];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(h, 0, buf.as_mut_ptr(), &mut len);
            CloseHandle(h);
            if ok == 0 {
                return 1;
            }
            let path = String::from_utf16_lossy(&buf[..len as usize]).to_lowercase();
            let name = path
                .rsplit(['\\', '/'])
                .next()
                .unwrap_or("")
                .trim_end_matches(".exe")
                .to_string();
            // Exclude the pet itself
            if name == "claude-pet" {
                return 1;
            }
            if let Some(rank) = TARGETS.iter().position(|t| *t == name) {
                hits.0.push(Hit { hwnd, rank, z });
            }
            1
        }
    }

    pub fn focus() -> Result<String, String> {
        let mut state: (Vec<Hit>, usize) = (Vec::new(), 0);
        unsafe {
            EnumWindows(enum_cb, &mut state as *mut _ as isize);
        }
        // Sort by process priority first; within the same rank, take the frontmost Z-order
        let best = state
            .0
            .into_iter()
            .min_by_key(|h| (h.rank, h.z))
            .ok_or_else(|| crate::i18n::t("没找到 Claude 或终端窗口", "No Claude or terminal window found"))?;
        unsafe {
            if IsIconic(best.hwnd) != 0 {
                ShowWindow(best.hwnd, 9); // SW_RESTORE
            }
            SetForegroundWindow(best.hwnd);
        }
        Ok(target_name(best.rank).to_string())
    }

    pub fn target_name(rank: usize) -> &'static str {
        TARGETS
            .get(rank)
            .copied()
            .unwrap_or_else(|| crate::i18n::t("窗口", "window"))
    }
}
