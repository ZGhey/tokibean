// Tokibean 码豆 —— desktop status-monitor pet
// Main entry: create the transparent always-on-top window and system tray, start the hook server / usage scanner / heartbeat threads

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod codex;
mod codex_install;
mod config;
mod fetch_policy;
mod hooks_install;
mod hooks_server;
mod i18n;
mod login;
mod official;
mod projection;
mod reducer;
mod state;
mod updater;
mod usage;
mod wsl;

use std::sync::Arc;
use std::time::Duration;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, WindowEvent};

use state::Shared;

#[tauri::command]
fn get_update(app: AppHandle) -> state::PetUpdate {
    let shared = app.state::<Arc<Shared>>();
    state::build_update(&shared)
}

#[tauri::command]
fn install_hooks(app: AppHandle) -> Result<String, String> {
    let shared = app.state::<Arc<Shared>>();
    let port = shared.cfg.lock().unwrap().port;
    hooks_install::install(port)
}

#[tauri::command]
fn install_codex_hooks(app: AppHandle) -> Result<String, String> {
    let shared = app.state::<Arc<Shared>>();
    let port = shared.cfg.lock().unwrap().port;
    codex_install::install(port)
}

#[tauri::command]
fn set_mode(app: AppHandle, mode: String) -> Result<(), String> {
    let shared = app.state::<Arc<Shared>>();
    {
        let mut cfg = shared.cfg.lock().unwrap();
        if !["auto", "subscription", "api"].contains(&mode.as_str()) {
            return Err(i18n::t("未知模式", "Unknown mode").into());
        }
        cfg.mode = mode;
        cfg.save().map_err(|e| e.to_string())?;
    }
    state::refresh_usage(&shared, true);
    state::push_update(&app, &shared);
    Ok(())
}

#[tauri::command]
fn get_config(app: AppHandle) -> serde_json::Value {
    let shared = app.state::<Arc<Shared>>();
    let cfg = shared.cfg.lock().unwrap();
    serde_json::json!({
        "notify": cfg.notify,
        "notify_min_secs": cfg.notify_min_secs,
        "sound": cfg.sound,
        "skin": cfg.skin,
        "pet_scale": cfg.scale(), // resolved (never null) — the frontend always gets a valid step
        "boss_key": cfg.boss_key,
        "block_limit": cfg.block_limit,
        "connected": !cfg.oauth_access.is_empty(),
        "hooks_incomplete": hooks_install::incomplete(cfg.port),
        // Which agents exist on this machine, and whether their hooks are written. An agent that
        // isn't installed appears nowhere in the UI (ADR-0007), so a Claude-only user's panel is
        // exactly today's. "written" is NOT "live" — only an arriving event proves that, which is
        // why the third state comes from PetUpdate.agents_seen rather than from here (ADR-0006).
        "agents": {
            "codex": {
                "installed": codex_install::installed(),
                "hooks_incomplete": codex_install::incomplete(cfg.port),
                "enabled": cfg.agent_enabled("codex"),
            }
        },
        "lang": i18n::tag(),
    })
}

#[tauri::command]
fn set_boss_key(app: AppHandle, accel: String) -> Result<String, String> {
    // Register successfully first, then persist config, to avoid saving a key combo that can't be registered
    register_boss_key(&app, &accel)?;
    let shared = app.state::<Arc<Shared>>();
    let mut cfg = shared.cfg.lock().unwrap();
    cfg.boss_key = accel.trim().to_string();
    cfg.save().map_err(|e| e.to_string())?;
    Ok(format!("{} {}", i18n::t("老板键已设为", "Boss key set to"), cfg.boss_key))
}

#[tauri::command]
fn set_config(
    app: AppHandle,
    notify: bool,
    notify_min_secs: u64,
    sound: bool,
    skin: String,
    pet_scale: f64,
) -> Result<(), String> {
    let shared = app.state::<Arc<Shared>>();
    {
        let mut cfg = shared.cfg.lock().unwrap();
        cfg.notify = notify;
        cfg.notify_min_secs = notify_min_secs;
        cfg.sound = sound;
        cfg.skin = if skin.is_empty() { "classic".into() } else { skin };
        cfg.pet_scale = Some(pet_scale);
        cfg.pet_scale = Some(cfg.scale()); // snap to a valid step, else the default
        cfg.save().map_err(|e| e.to_string())?;
    }
    state::push_update(&app, &shared);
    Ok(())
}

#[tauri::command]
fn panel_opened(app: AppHandle) {
    // Opening the panel just shows what we already have — official usage is fetched only on
    // hook activity (a run finishing), never on "click to view". Rescan local JSONL (cheap,
    // updates token counts) and re-render; do NOT raise official_want / hit the usage API.
    let shared = app.state::<Arc<Shared>>();
    state::refresh_usage(&shared, false);
    state::push_update(&app, &shared);
}

#[tauri::command]
fn set_panel_open(app: AppHandle, open: bool) {
    // Frontend tells us the panel expanded/collapsed so the click-through thread can keep the
    // whole window interactive while it's open (so panel hover works at any panel height)
    let shared = app.state::<Arc<Shared>>();
    shared
        .panel_open
        .store(open, std::sync::atomic::Ordering::Relaxed);
}

#[tauri::command]
fn set_pet_at_top(app: AppHandle, v: bool) {
    // Frontend tells us which layout the pre-allocated collapsed window is in (below-panel =>
    // pet at the window top). The click-through thread uses it to pick the solid pet strip.
    let shared = app.state::<Arc<Shared>>();
    shared
        .pet_at_top
        .store(v, std::sync::atomic::Ordering::Relaxed);
}

#[tauri::command]
fn set_pet_pos(app: AppHandle, x: i32, y: i32) {
    // Windows: the frontend persists the pet's on-screen anchor (x = window left, y = pet
    // canvas-top, both physical px). The full-height collapsed window's own top-left is
    // layout-dependent, so we store the layout-independent anchor and rebuild position on launch.
    let shared = app.state::<Arc<Shared>>();
    let mut cfg = shared.cfg.lock().unwrap();
    cfg.pos_x = Some(x);
    cfg.pet_anchor_y = Some(y);
    let _ = cfg.save();
}

/// Set window position AND size atomically (one repaint). Tauri's set_position + set_size are two
/// separate calls, so growing the panel upward flashed the pet hundreds of px up then back. On
/// Windows we hand both to a single SetWindowPos. Args are LOGICAL px; converted to physical here.
#[cfg(target_os = "windows")]
#[tauri::command]
fn set_window_rect(app: AppHandle, x: f64, y: f64, w: f64, h: f64) {
    if let Some(win) = app.get_webview_window("main") {
        let f = win.scale_factor().unwrap_or(1.0);
        if let Ok(hwnd) = win.hwnd() {
            win_rect::set_rect(
                hwnd.0 as isize,
                (x * f).round() as i32,
                (y * f).round() as i32,
                (w * f).round() as i32,
                (h * f).round() as i32,
            );
        }
    }
}

#[cfg(target_os = "windows")]
mod win_rect {
    #[link(name = "user32")]
    unsafe extern "system" {
        fn SetWindowPos(hwnd: isize, after: isize, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> i32;
    }
    pub fn set_rect(hwnd: isize, x: i32, y: i32, w: i32, h: i32) {
        // SWP_NOZORDER (0x0004) | SWP_NOACTIVATE (0x0010)
        unsafe {
            let _ = SetWindowPos(hwnd, 0, x, y, w, h, 0x0004 | 0x0010);
        }
    }
}

/// macOS: same atomicity requirement. Calling set_position then set_size from the webview means two
/// awaits, so the OS composites the moved-but-not-yet-resized window — the pet visibly jumped up by
/// (newH - oldH) and snapped back. Running both inside ONE main-thread turn keeps them in a single
/// AppKit update, so only the final geometry is ever presented. Size first, position last, so the
/// final call fixes the top-left regardless of Cocoa's bottom-left resize anchoring.
#[cfg(target_os = "macos")]
#[tauri::command]
fn set_window_rect(app: AppHandle, x: f64, y: f64, w: f64, h: f64) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = app.clone().run_on_main_thread(move || {
            let _ = win.set_size(tauri::LogicalSize::new(w, h));
            let _ = win.set_position(tauri::LogicalPosition::new(x, y));
        });
    }
}

/// Stub for the remaining platforms so the command can be registered unconditionally.
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
#[tauri::command]
fn set_window_rect(_app: AppHandle, _x: f64, _y: f64, _w: f64, _h: f64) {}

#[tauri::command]
fn connect_claude(app: AppHandle) -> Result<String, String> {
    use std::sync::atomic::Ordering;
    let shared = app.state::<Arc<Shared>>().inner().clone();
    let msg = login::connect(shared.clone())?;
    // Freshly connected — clear any "reconnect needed" state
    shared.reconnect_needed.store(false, Ordering::Relaxed);
    shared.reconnect_notified.store(false, Ordering::Relaxed);
    state::refresh_usage(&shared, true);
    state::push_update(&app, &shared);
    Ok(msg)
}

#[tauri::command]
fn check_update(app: AppHandle) {
    let shared = app.state::<Arc<Shared>>().inner().clone();
    updater::spawn_check(app, shared, true);
}

#[tauri::command]
fn install_update(app: AppHandle) {
    let shared = app.state::<Arc<Shared>>().inner().clone();
    updater::spawn_install(app, shared);
}

#[tauri::command]
fn open_update_window(app: AppHandle) {
    show_update_window(&app);
}

#[tauri::command]
fn skip_update(app: AppHandle, version: String) {
    let shared = app.state::<Arc<Shared>>();
    {
        let mut cfg = shared.cfg.lock().unwrap();
        cfg.skip_version = version;
        let _ = cfg.save();
    }
    {
        let mut st = shared.update.lock().unwrap();
        st.available = None;
        st.status = String::new();
        st.progress = 0;
    }
    state::push_update(&app, &shared);
}

#[tauri::command]
fn open_url(url: String) {
    login::open_browser(&url);
}

/// JS injected into dialog webviews BEFORE their scripts run, so they read the OS UI language
/// synchronously from the backend (`window.__PET_ZH__`) instead of the unreliable navigator.language.
/// WebView2 on Windows doesn't reflect the OS UI language via navigator.language (WKWebView on macOS
/// does), which broke the zh/en split of the dialogs in the Windows release build.
fn lang_init() -> String {
    format!("window.__PET_ZH__ = {};", i18n::is_zh())
}

#[tauri::command]
fn open_about_window(app: AppHandle) {
    show_about_window(&app);
}

#[tauri::command]
fn open_settings_window(app: AppHandle) {
    show_settings_window(&app);
}

/// Open (or focus) the Settings window. Same macOS activation-policy handling as the updater/about.
fn show_settings_window(app: &AppHandle) {
    let app = app.clone();
    let _ = app.clone().run_on_main_thread(move || {
        #[cfg(target_os = "macos")]
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
        if let Some(w) = app.get_webview_window("settings") {
            let _ = w.show();
            let _ = w.set_focus();
            return;
        }
        let _ = tauri::WebviewWindowBuilder::new(
            &app,
            "settings",
            tauri::WebviewUrl::App("settings.html".into()),
        )
        .initialization_script(lang_init())
        .title(i18n::t("码豆 · 设置", "Tokibean · Settings"))
        .inner_size(360.0, 350.0)
        .resizable(false)
        .center()
        .build();
    });
}

/// Open (or focus) the About dialog window. Same macOS activation-policy handling as the updater.
fn show_about_window(app: &AppHandle) {
    let app = app.clone();
    let _ = app.clone().run_on_main_thread(move || {
        #[cfg(target_os = "macos")]
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
        if let Some(w) = app.get_webview_window("about") {
            let _ = w.show();
            let _ = w.set_focus();
            return;
        }
        let _ = tauri::WebviewWindowBuilder::new(
            &app,
            "about",
            tauri::WebviewUrl::App("about.html".into()),
        )
        .initialization_script(lang_init())
        .title(i18n::t("关于 码豆", "About Tokibean"))
        .inner_size(380.0, 430.0)
        .resizable(false)
        .center()
        .build();
    });
}

/// Open (or focus) the dedicated update dialog window (a normal decorated window showing the
/// new version, release notes, and an Update button). On macOS, temporarily switch to a regular
/// (Dock-visible) app so the window can come to the front and take keyboard focus — a menu-bar
/// (Accessory) app's windows otherwise stay behind; reverted to Accessory when the dialog closes.
fn show_update_window(app: &AppHandle) {
    let app = app.clone();
    let _ = app.clone().run_on_main_thread(move || {
        #[cfg(target_os = "macos")]
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
        if let Some(w) = app.get_webview_window("updater") {
            let _ = w.show();
            let _ = w.set_focus();
            return;
        }
        let _ = tauri::WebviewWindowBuilder::new(
            &app,
            "updater",
            tauri::WebviewUrl::App("update.html".into()),
        )
        .initialization_script(lang_init())
        .title(i18n::t("码豆 · 更新", "Tokibean · Update"))
        .inner_size(460.0, 440.0)
        .min_inner_size(380.0, 320.0)
        .resizable(true)
        .center()
        .build();
    });
}

/// Menu-bar template icon: draw the Dundun silhouette (same 26×26 grid geometry as
/// pet.js / gen-icon.js) as pure black + transparent RGBA. macOS treats it as a template
/// image, using only the alpha channel as the shape — rendered black on a light menu bar,
/// white on a dark one, with the eyes cut out as transparent holes.
#[cfg(target_os = "macos")]
fn mac_tray_icon() -> tauri::image::Image<'static> {
    const S: usize = 44; // Canvas side length (physical pixels; the menu bar auto-scales to a suitable height)
    const PAD: f64 = 3.0; // Padding on all sides
    let f = (S as f64 - PAD * 2.0) / 26.0; // Grid -> pixel scale
    let mut rgba = vec![0u8; S * S * 4]; // Fully transparent by default

    // Fill a grid rectangle: solid=true paints black, false carves back to transparent (eye holes)
    let mut fill = |gx: f64, gy: f64, gw: f64, gh: f64, solid: bool| {
        let x0 = (PAD + gx * f).round() as usize;
        let x1 = ((PAD + (gx + gw) * f).round() as usize).min(S);
        let y0 = (PAD + gy * f).round() as usize;
        let y1 = ((PAD + (gy + gh) * f).round() as usize).min(S);
        for y in y0..y1 {
            for x in x0..x1 {
                let i = (y * S + x) * 4;
                rgba[i + 3] = if solid { 255 } else { 0 };
            }
        }
    };

    fill(6.0, 0.0, 14.0, 2.0, true); // Dome, second tier
    fill(2.0, 2.0, 22.0, 2.0, true); // Dome, first tier
    fill(0.0, 4.0, 26.0, 15.0, true); // Body
    for lx in [2.0, 8.0, 16.0, 22.0] {
        fill(lx, 19.0, 2.0, 7.0, true); // Four legs
    }
    fill(4.0, 8.0, 3.0, 3.0, false); // Left eye hole
    fill(15.0, 8.0, 3.0, 3.0, false); // Right eye hole

    tauri::image::Image::new_owned(rgba, S as u32, S as u32)
}

/// Show/hide the pet: hide it if visible, otherwise show and focus it. Shared by the tray menu and the boss key.
fn toggle_pet_visibility(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
}

/// Register the boss key: clear the old one first, then register the new one (there's only ever this one
/// global shortcut, so unregister_all is the simplest). accel takes a Tauri accelerator string, e.g. "CommandOrControl+Shift+B".
fn register_boss_key(app: &AppHandle, accel: &str) -> Result<(), String> {
    use std::str::FromStr;
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
    let sc = Shortcut::from_str(accel.trim())
        .map_err(|e| format!("{}: {}", i18n::t("快捷键无法识别", "Unrecognized shortcut"), e))?;
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    gs.on_shortcut(sc, |app, _sc, event| {
        // Toggle only on key-press; ignore the release event so one keypress fires once.
        if event.state() == ShortcutState::Pressed {
            toggle_pet_visibility(app);
        }
    })
    .map_err(|e| {
        format!(
            "{}: {}",
            i18n::t("注册失败(可能被别的程序占用)", "Failed to register (may be taken by another app)"),
            e
        )
    })
}

/// macOS: turn the pet window into a floating panel that "can hover above another app's full screen
/// and stays present across all Spaces". The full recipe is all-or-nothing (also needs
/// set_activation_policy(Accessory) in main()):
///   1. Swap the NSWindow's class in place to NSPanel + non-activating panel style — a normal window
///      can't enter another app's native full-screen space, only a non-activating panel can; clicking it
///      also doesn't steal focus or bring the pet to the front.
///   2. Collection behavior CanJoinAllSpaces (1<<0) + FullScreenAuxiliary (1<<8) — stay present on every Space.
///   3. Raise the level to NSScreenSaverWindowLevel (1000) — tao's alwaysOnTop only goes up to the floating
///      level (3), which can't beat full screen, so we raise it to the screen-saver level (Electron's
///      'screen-saver' is this same level).
/// tao exposes none of these, so we send messages directly to NSWindow/NSPanel to fill the gap; doing it once at startup is enough.
#[cfg(target_os = "macos")]
fn macos_float_panel(window: &tauri::WebviewWindow) {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};
    extern "C" {
        fn object_setClass(obj: *mut AnyObject, cls: *const AnyClass) -> *const AnyClass;
    }
    let Ok(ptr) = window.ns_window() else { return };
    if ptr.is_null() {
        return;
    }
    unsafe {
        // 1. Swap class NSWindow -> NSPanel, and add the "non-activating panel" style bit
        let panel_cls: &AnyClass = objc2::class!(NSPanel);
        object_setClass(ptr as *mut AnyObject, panel_cls as *const AnyClass);
        let ns_window = &*(ptr as *const AnyObject);
        let mask: usize = msg_send![ns_window, styleMask];
        let _: () = msg_send![ns_window, setStyleMask: mask | (1usize << 7)]; // NonactivatingPanel
        // 2. Collection behavior: stay present on all Spaces + allow accompanying full screen
        let _: () = msg_send![ns_window, setCollectionBehavior: (1usize << 0) | (1usize << 8)];
        // 3. Raise the level to the screen-saver level, above full-screen apps
        let _: () = msg_send![ns_window, setLevel: 1000isize];
    }
}

fn main() {
    let shared = Arc::new(Shared::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Launch at login: writes HKCU\...\Run on Windows, a LaunchAgent on macOS, a .desktop on
        // Linux. State lives in the OS (registry/agent), not our config, so there's no second copy
        // to drift; the Settings window reads/writes it via the plugin's is_enabled/enable/disable.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(shared.clone())
        .invoke_handler(tauri::generate_handler![
            get_update,
            install_hooks,
            install_codex_hooks,
            set_mode,
            get_config,
            set_config,
            set_boss_key,
            connect_claude,
            panel_opened,
            set_panel_open,
            set_pet_at_top,
            set_pet_pos,
            check_update,
            install_update,
            open_update_window,
            skip_update,
            open_url,
            open_about_window,
            open_settings_window,
            set_window_rect
        ])
        .on_window_event(|window, event| {
            // Updater / About dialog closed: on macOS drop the temporary Dock icon (back to Accessory),
            // but only once no other such window remains open
            #[cfg(target_os = "macos")]
            if matches!(window.label(), "updater" | "about" | "settings") && matches!(event, WindowEvent::Destroyed) {
                let app = window.app_handle();
                let others_open = ["updater", "about", "settings"]
                    .iter()
                    .filter(|&&l| l != window.label())
                    .any(|&l| app.get_webview_window(l).is_some());
                if !others_open {
                    let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                }
            }
            // Position persistence applies only to the pet window, never the updater dialog
            if window.label() != "main" {
                return;
            }
            let shared = window.app_handle().state::<Arc<Shared>>();
            match event {
                // Record the moment of a programmatic resize: expanding/collapsing the panel moves then resizes,
                // and that "move" isn't a user drag, so it shouldn't overwrite the remembered position
                WindowEvent::Resized(_) => {
                    *shared.last_resize.lock().unwrap() = std::time::Instant::now();
                }
                WindowEvent::Moved(pos) => {
                    // Never persist a hidden/parked window: Windows parks hidden windows at (-32000,
                    // -32000), and saving that would relaunch the pet off-screen (it can't be dragged
                    // back because it isn't visible). Real monitors never sit that far negative.
                    if pos.x <= -30000 || pos.y <= -30000 {
                        return;
                    }
                    let now = std::time::Instant::now();
                    if now.duration_since(*shared.last_resize.lock().unwrap()).as_millis() < 1200 {
                        return;
                    }
                    let mut last = shared.last_pos_save.lock().unwrap();
                    if now.duration_since(*last).as_millis() < 2000 {
                        return;
                    }
                    *last = now;
                    let mut cfg = shared.cfg.lock().unwrap();
                    cfg.pos_x = Some(pos.x);
                    cfg.pos_y = Some(pos.y);
                    // Pre-allocated platforms restore from the pet's anchor (its canvas-top on screen),
                    // not the window top-left — derive it here too, so a move persisted by this backstop
                    // can't disagree with the frontend's savePetAnchor.
                    #[cfg(any(target_os = "windows", target_os = "macos"))]
                    if let Ok(sz) = window.outer_size() {
                        let f = window.scale_factor().unwrap_or(1.0);
                        let strip = ((config::CANVAS_H_AT_1X * cfg.scale() + config::PAD_B) * f).round() as i32;
                        let at_top = shared.pet_at_top.load(std::sync::atomic::Ordering::Relaxed);
                        cfg.pet_anchor_y = Some(if at_top { pos.y } else { pos.y + sz.height as i32 - strip });
                    }
                    let _ = cfg.save();
                }
                _ => {}
            }
        })
        .setup(move |app| {
            let handle = app.handle().clone();

            // macOS: switch to an Accessory (agent) app — no Dock icon, like a menu-bar tool.
            // Key effect: a normal app's floating window gets swept away by the system when "another app is
            // full screen"; only an accessory app's CanJoinAllSpaces window can truly hover above someone
            // else's full screen (together with macos_float_all_spaces's collection behavior + level). The pet
            // is operated via the tray anyway, so it doesn't need a Dock icon.
            #[cfg(target_os = "macos")]
            let _ = app.handle().set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Restore the last remembered window position (pos_x/pos_y ARE the window top-left).
            // Windows and macOS pre-allocate the full height and restore from the pet anchor instead
            // (below), so this plain path is Linux-only.
            #[cfg(target_os = "linux")]
            if let Some(w) = app.get_webview_window("main") {
                let mut cfg = shared.cfg.lock().unwrap();
                let scale = cfg.scale();
                let win_w = config::win_w(scale);
                let base_h = cfg.base_h();
                let f = w.scale_factor().unwrap_or(1.0);

                // Size the collapsed window for the configured pet scale before showing it, so it can't
                // launch at one size and pop to another.
                let _ = w.set_size(tauri::LogicalSize::new(win_w, base_h));

                // One-time migration for a config written before the pet-size setting existed: pos_y is
                // the window TOP-LEFT, but the pet is drawn at the window BOTTOM, so shrinking the
                // collapsed window (LEGACY_BASE_H -> base_h) would lift the pet off its saved spot.
                // Push the top edge down by the height delta to keep the pet's feet where the user left them.
                if cfg.pet_scale.is_none() {
                    if let Some(y) = cfg.pos_y {
                        let delta = ((config::LEGACY_BASE_H - base_h) * f).round() as i32;
                        cfg.pos_y = Some(y + delta);
                    }
                    cfg.pet_scale = Some(scale);
                    let _ = cfg.save();
                }

                // Restore the position, clamped so the pet actually lands on a real monitor. Without this
                // a stale/edge position (or a monitor that has since been unplugged) leaves the pet drawn
                // off-screen — an invisible pet, with no way to get it back but the tray. Windows has had
                // this clamp; macOS was missing it.
                if let (Some(x), Some(y)) = (cfg.pos_x, cfg.pos_y) {
                    let (mut wx, mut wy) = (x, y);
                    let win_w_px = (win_w * f).round() as i32;
                    let full_h_px = (base_h * f).round() as i32;
                    let pet_h_px = ((config::CANVAS_H_AT_1X * scale + config::PAD_B) * f).round() as i32;
                    // Pick the monitor the PET sits on (its centre), not the window's top-left — the
                    // window has transparent headroom above the pet. Fall back to the primary monitor.
                    let (pet_cx, pet_cy) = (wx + win_w_px / 2, wy + full_h_px - pet_h_px / 2);
                    let mon = w
                        .available_monitors()
                        .unwrap_or_default()
                        .into_iter()
                        .find(|m| {
                            let (p, s) = (m.position(), m.size());
                            pet_cx >= p.x
                                && pet_cx < p.x + s.width as i32
                                && pet_cy >= p.y
                                && pet_cy < p.y + s.height as i32
                        })
                        .or_else(|| w.primary_monitor().ok().flatten());
                    if let Some(mon) = mon {
                        let (mp, ms) = (mon.position(), mon.size());
                        wx = wx.clamp(mp.x, (mp.x + ms.width as i32 - win_w_px).max(mp.x));
                        // pet flush to the monitor top ≤ window top ≤ pet flush to the monitor bottom
                        let y_min = mp.y - (full_h_px - pet_h_px);
                        let y_max = mp.y + ms.height as i32 - full_h_px;
                        wy = wy.clamp(y_min, y_max.max(y_min));
                    }
                    let _ = w.set_position(tauri::PhysicalPosition::new(wx, wy));
                    // Persist the clamped spot, so the config reflects where the pet actually is
                    // instead of an unreachable position we'd have to re-clamp on every launch.
                    if (wx, wy) != (x, y) {
                        cfg.pos_x = Some(wx);
                        cfg.pos_y = Some(wy);
                        let _ = cfg.save();
                    }
                }
            }

            // Windows + macOS: pre-allocate the FULL panel height when collapsed so opening the panel
            // never resizes the window. Resizing is what made the pet jump: the window's top edge moves
            // up by (fullH - collapsedH) while the webview still paints its OLD layout for one frame, so
            // the pet flashes that far up and snaps back. (On Windows it's DWM re-compositing the old
            // frame; on macOS the WKWebView surface lags the window by a frame — same visible bug, and no
            // amount of atomicity in the move+resize call fixes it.) With the space already allocated,
            // opening only reveals the (hidden) panel — nothing moves, nothing resizes.
            // The pet is placed in the default up-panel layout (at the window BOTTOM); the frontend
            // lazily flips to below-layout on open if the pet sits too near the screen top.
            // (tauri.conf.json's 340 height is only the pre-show default; both platforms resize here.)
            #[cfg(any(target_os = "windows", target_os = "macos"))]
            if let Some(w) = app.get_webview_window("main") {
                let mut cfg = shared.cfg.lock().unwrap();
                // Geometry mirrors recomputeGeom() in src/main.js — keep both in sync. Only the pet
                // canvas scales; the panel allowance is fixed, so FULL_H grows by the canvas delta.
                let scale = cfg.scale();
                let canvas_h = config::CANVAS_H_AT_1X * scale;
                let pad_b = config::PAD_B; // body padding-bottom is a fixed 4px CSS gap, not scaled
                let full_h_l = (canvas_h + pad_b + config::PANEL_ALLOWANCE).round();
                let win_w_l = config::win_w(scale);
                let f = w.scale_factor().unwrap_or(1.0);
                let _ = w.set_size(tauri::LogicalSize::new(win_w_l, full_h_l));
                // Migrate once to the layout-independent pet anchor (the pet's canvas-top on screen).
                // Windows' old collapsed window was canvas-height with the pet at offset 0, so its saved
                // pos_y already IS the anchor. macOS' old collapsed window was base_h tall with the pet
                // at the bottom, so the anchor sits (base_h - canvas_h - pad_b) below the saved top-left
                // — and a config predating the pet-size setting was always LEGACY_BASE_H at scale 1.
                if cfg.pet_anchor_y.is_none() {
                    if let Some(y) = cfg.pos_y {
                        #[cfg(target_os = "windows")]
                        let anchor = y;
                        #[cfg(target_os = "macos")]
                        let anchor = {
                            let legacy = cfg.pet_scale.is_none();
                            let old_base_h = if legacy { config::LEGACY_BASE_H } else { cfg.base_h() };
                            let old_canvas_h = if legacy { config::CANVAS_H_AT_1X } else { canvas_h };
                            y + ((old_base_h - old_canvas_h - pad_b) * f).round() as i32
                        };
                        cfg.pet_anchor_y = Some(anchor);
                        if cfg.pet_scale.is_none() {
                            cfg.pet_scale = Some(scale);
                        }
                        let _ = cfg.save();
                    }
                }
                if let (Some(x), Some(anchor)) = (cfg.pos_x, cfg.pet_anchor_y) {
                    // Up-layout: pet canvas top sits at (window top + full_h - canvas_h - pad_b).
                    let off_up = ((full_h_l - canvas_h - pad_b) * f).round() as i32;
                    let (mut wx, mut wy) = (x, anchor - off_up);
                    // Recover an off-screen saved position (e.g. a config left at Windows' hidden-window
                    // park of -32000, or a monitor that has since been unplugged): clamp so the pet's
                    // solid strip (the bottom CANVAS_H+PAD_B of the window) lands on a real monitor.
                    // Prefer the monitor that contains the saved spot; fall back to the primary.
                    let mon = w
                        .available_monitors()
                        .unwrap_or_default()
                        .into_iter()
                        .find(|m| {
                            let (p, s) = (m.position(), m.size());
                            wx >= p.x
                                && wx < p.x + s.width as i32
                                && wy >= p.y
                                && wy < p.y + s.height as i32
                        })
                        .or_else(|| w.primary_monitor().ok().flatten());
                    if let Some(mon) = mon {
                        let (mp, ms) = (mon.position(), mon.size());
                        let win_w = (win_w_l * f).round() as i32;
                        let full_h = (full_h_l * f).round() as i32;
                        let pet_h = ((canvas_h + pad_b) * f).round() as i32; // solid pet strip
                        wx = wx.clamp(mp.x, (mp.x + ms.width as i32 - win_w).max(mp.x));
                        // pet flush to monitor top ≤ window top ≤ pet strip flush to monitor bottom
                        let y_min = mp.y - (full_h - pet_h);
                        let y_max = mp.y + ms.height as i32 - full_h;
                        wy = wy.clamp(y_min, y_max.max(y_min));
                    }
                    let _ = w.set_position(tauri::PhysicalPosition::new(wx, wy));
                }
            }

            // macOS: turn the pet into a floating panel that can hover above another app's full screen and stays present on all Spaces
            #[cfg(target_os = "macos")]
            if let Some(w) = app.get_webview_window("main") {
                macos_float_panel(&w);
            }

            // Boss key: a global shortcut to show/hide the pet with one press (works even when the pet has no
            // focus); the key combo is configurable in the panel. Combined with right-clicking the pet to hide
            // it, once hidden you bring it back via this key or the tray menu.
            {
                let accel = shared.cfg.lock().unwrap().boss_key.clone();
                if let Err(e) = register_boss_key(&handle, &accel) {
                    eprintln!("[claude-pet] Failed to register boss key: {}", e);
                }
            }

            // System tray: show/hide + quit
            let show = MenuItem::with_id(app, "show", i18n::t("显示 / 隐藏", "Show / Hide"), true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", i18n::t("设置…", "Settings…"), true, None::<&str>)?;
            let check = MenuItem::with_id(app, "check_update", i18n::t("检查更新…", "Check for Updates…"), true, None::<&str>)?;
            let about = MenuItem::with_id(app, "about", i18n::t("关于", "About"), true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", i18n::t("退出", "Quit"), true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &settings, &check, &about, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Tokibean")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        // Record the current position before quitting (skip a hidden/parked window
                        // at -32000 so we don't relaunch the pet off-screen)
                        if let Some(w) = app.get_webview_window("main") {
                            if let Ok(pos) = w.outer_position() {
                                if pos.x > -30000 && pos.y > -30000 {
                                    let shared = app.state::<Arc<Shared>>();
                                    let mut cfg = shared.cfg.lock().unwrap();
                                    cfg.pos_x = Some(pos.x);
                                    cfg.pos_y = Some(pos.y);
                                    let _ = cfg.save();
                                }
                            }
                        }
                        app.exit(0)
                    }
                    "show" => toggle_pet_visibility(app),
                    "check_update" => {
                        let shared = app.state::<Arc<Shared>>().inner().clone();
                        updater::spawn_check(app.clone(), shared, true);
                    }
                    "about" => show_about_window(app),
                    "settings" => show_settings_window(app),
                    _ => {}
                });
            // The macOS menu bar uses a monochrome template icon (black silhouette + transparent holes); the
            // system auto-inverts it for light/dark menu bars, matching the look of other native app icons.
            // Other platforms still use the color app icon.
            #[cfg(target_os = "macos")]
            {
                tray = tray.icon(mac_tray_icon()).icon_as_template(true);
            }
            #[cfg(not(target_os = "macos"))]
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            // Thread 1: hook-event HTTP server (Claude Code hooks POST here)
            {
                let h = handle.clone();
                let s = shared.clone();
                std::thread::spawn(move || hooks_server::run(h, s));
            }

            // Thread 3: dynamic click-through. When the cursor hovers over the transparent empty area, mouse
            // events pass through to the window beneath (otherwise the always-on-top transparent window would
            // block buttons underneath); moving onto the pet/bubble canvas region or the expanded panel restores interactivity.
            {
                let h = handle.clone();
                let s = shared.clone();
                std::thread::spawn(move || {
                    use std::sync::atomic::Ordering;
                    let mut ignoring = false;
                    let mut left_at: Option<std::time::Instant> = None;
                    loop {
                        std::thread::sleep(Duration::from_millis(50));
                        let Some(w) = h.get_webview_window("main") else { continue };
                        let Ok(cur) = h.cursor_position() else { continue };
                        let Ok(wpos) = w.outer_position() else { continue };
                        let Ok(wsize) = w.outer_size() else { continue };
                        let factor = w.scale_factor().unwrap_or(1.0);
                        let inside = cur.x >= wpos.x as f64
                            && cur.x < (wpos.x + wsize.width as i32) as f64
                            && cur.y >= wpos.y as f64
                            && cur.y < (wpos.y + wsize.height as i32) as f64;
                        let h_logical = wsize.height as f64 / factor;
                        let w_logical = wsize.width as f64 / factor;
                        let rel_y = (cur.y - wpos.y as f64) / factor;
                        let rel_x = (cur.x - wpos.x as f64) / factor;
                        // Solid (mouse captured) only where the pet/panel actually is; the rest of the
                        // transparent window passes clicks through. When the panel is open the whole window
                        // is solid. When collapsed, only the ~192px canvas strip holding the pet is solid —
                        // its position depends on the layout: on Windows and macOS the collapsed window is
                        // pre-allocated to the full panel height, so the pet sits at the TOP (below-panel
                        // layout, pet_at_top) or the BOTTOM (up-panel layout). Linux still resizes, so it
                        // keeps the height-based rule.
                        // The solid pet strip and the Linux "panel is open" height threshold both scale
                        // with the pet (mirrors recomputeGeom() in src/main.js: strip 192·scale,
                        // collapsed height 340·scale +5 slack). The strip is also bounded to the pet's
                        // actual width (the canvas is 200·scale wide, centred in a ≥240 window), so at
                        // the smaller sizes the empty margins beside the pet still pass clicks through.
                        let scale = s.cfg.lock().unwrap().scale();
                        let strip = 192.0 * scale;
                        let half_pet_w = 200.0 * scale / 2.0 + 4.0; // +4: a hair of slack around the art
                        let in_pet_x = (rel_x - w_logical / 2.0).abs() <= half_pet_w;
                        let solid = if s.panel_open.load(Ordering::Relaxed) {
                            true
                        } else if cfg!(any(target_os = "windows", target_os = "macos")) {
                            in_pet_x
                                && if s.pet_at_top.load(Ordering::Relaxed) {
                                    rel_y < strip
                                } else {
                                    rel_y >= h_logical - strip
                                }
                        } else {
                            h_logical > 340.0 * scale + 5.0 || (in_pet_x && rel_y >= h_logical - strip)
                        };
                        let want = inside && !solid;
                        if want != ignoring {
                            let _ = w.set_ignore_cursor_events(want);
                            ignoring = want;
                        }
                        // Auto-collapse: while the panel is open, keep it open as long as the cursor is
                        // within the window (over the panel or the pet); collapse once it has left for a
                        // moment. Uses the OS cursor position — reliable for this transparent overlay,
                        // unlike webview :hover/mouseleave events.
                        if s.panel_open.load(Ordering::Relaxed) {
                            if inside {
                                left_at = None;
                            } else {
                                let now = std::time::Instant::now();
                                let since = *left_at.get_or_insert(now);
                                if now.duration_since(since) > Duration::from_millis(450) {
                                    s.panel_open.store(false, Ordering::Relaxed);
                                    let _ = h.emit("collapse-panel", ());
                                    left_at = None;
                                }
                            }
                        } else {
                            left_at = None;
                        }
                    }
                });
            }

            // Thread 2: heartbeat. Handle state expiry every second, rescan JSONL usage every 30 seconds.
            // Official API fetches are event-driven (Stop / panel open / cache expired while working / reset
            // point passed); whether it's worth asking is decided inside refresh_usage — when fully idle it never asks.
            {
                let h = handle.clone();
                let s = shared.clone();
                std::thread::spawn(move || {
                    use std::sync::atomic::Ordering;
                    let mut tick: u64 = 0;
                    // Do an initial scan at startup
                    state::refresh_usage(&s, true);
                    state::push_update(&h, &s);
                    loop {
                        std::thread::sleep(Duration::from_secs(1));
                        tick += 1;
                        let mut changed = state::expire_transients(&s);
                        // If a Stop event raised the flag, don't wait for the 30s beat — respond as soon as possible
                        if tick % 30 == 0 || s.official_want.load(Ordering::Relaxed) {
                            state::refresh_usage(&s, false);
                            state::check_usage_alerts(&h, &s);
                            changed = true;
                        }
                        if tick % 30 == 0 {
                            // Fallback save of the window position (drag throttling may miss the last bit of movement).
                            // Skip a hidden/parked window at -32000 so the pet can't relaunch off-screen.
                            if let Some(w) = h.get_webview_window("main") {
                                if let Ok(pos) = w.outer_position() {
                                    let mut cfg = s.cfg.lock().unwrap();
                                    if pos.x > -30000
                                        && pos.y > -30000
                                        && (cfg.pos_x != Some(pos.x) || cfg.pos_y != Some(pos.y))
                                    {
                                        cfg.pos_x = Some(pos.x);
                                        cfg.pos_y = Some(pos.y);
                                        let _ = cfg.save();
                                    }
                                }
                            }
                        }
                        // Re-check for updates once a day (silent unless a new version appears)
                        if tick % 86_400 == 0 {
                            updater::spawn_check(h.clone(), s.clone(), false);
                        }
                        if changed {
                            state::push_update(&h, &s);
                        }
                    }
                });
            }

            // Check for updates a few seconds after launch (background; silent if up to date)
            {
                let h = handle.clone();
                let s = shared.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(5));
                    updater::spawn_check(h, s, false);
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("claude-pet 启动失败");
}
