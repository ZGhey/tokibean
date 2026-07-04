// Tokibean 码豆 —— desktop status-monitor pet
// Main entry: create the transparent always-on-top window and system tray, start the hook server / usage scanner / heartbeat threads

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
mod focus;
mod hooks_install;
mod hooks_server;
mod i18n;
mod login;
mod official;
mod state;
mod updater;
mod usage;

use std::sync::Arc;
use std::time::Duration;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, WindowEvent};

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
        "boss_key": cfg.boss_key,
        "block_limit": cfg.block_limit,
        "connected": !cfg.oauth_access.is_empty(),
        "hooks_incomplete": hooks_install::incomplete(cfg.port),
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
) -> Result<(), String> {
    let shared = app.state::<Arc<Shared>>();
    {
        let mut cfg = shared.cfg.lock().unwrap();
        cfg.notify = notify;
        cfg.notify_min_secs = notify_min_secs;
        cfg.sound = sound;
        cfg.skin = if skin.is_empty() { "classic".into() } else { skin };
        cfg.save().map_err(|e| e.to_string())?;
    }
    state::push_update(&app, &shared);
    Ok(())
}

#[tauri::command]
fn focus_terminal() -> Result<String, String> {
    focus::focus_terminal()
}

#[tauri::command]
fn panel_opened(app: AppHandle) {
    // User is looking at the data: raise the flag to request a refresh (refresh_usage has an internal 60s debounce)
    let shared = app.state::<Arc<Shared>>();
    shared
        .official_want
        .store(true, std::sync::atomic::Ordering::Relaxed);
    state::refresh_usage(&shared, false);
    state::push_update(&app, &shared);
}

#[tauri::command]
fn connect_claude(app: AppHandle) -> Result<String, String> {
    let shared = app.state::<Arc<Shared>>().inner().clone();
    let msg = login::connect(shared.clone())?;
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

#[tauri::command]
fn open_about_window(app: AppHandle) {
    show_about_window(&app);
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
        .manage(shared.clone())
        .invoke_handler(tauri::generate_handler![
            get_update,
            install_hooks,
            set_mode,
            get_config,
            set_config,
            set_boss_key,
            connect_claude,
            focus_terminal,
            panel_opened,
            check_update,
            install_update,
            open_update_window,
            skip_update,
            open_url,
            open_about_window
        ])
        .on_window_event(|window, event| {
            // Updater / About dialog closed: on macOS drop the temporary Dock icon (back to Accessory),
            // but only once no other such window remains open
            #[cfg(target_os = "macos")]
            if matches!(window.label(), "updater" | "about") && matches!(event, WindowEvent::Destroyed) {
                let app = window.app_handle();
                let others_open = ["updater", "about"]
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

            // Restore the last remembered window position
            {
                let cfg = shared.cfg.lock().unwrap();
                if let (Some(x), Some(y)) = (cfg.pos_x, cfg.pos_y) {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
                    }
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
            let check = MenuItem::with_id(app, "check_update", i18n::t("检查更新…", "Check for Updates…"), true, None::<&str>)?;
            let about = MenuItem::with_id(app, "about", i18n::t("关于", "About"), true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", i18n::t("退出", "Quit"), true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &check, &about, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Tokibean")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        // Record the current position before quitting
                        if let Some(w) = app.get_webview_window("main") {
                            if let Ok(pos) = w.outer_position() {
                                let shared = app.state::<Arc<Shared>>();
                                let mut cfg = shared.cfg.lock().unwrap();
                                cfg.pos_x = Some(pos.x);
                                cfg.pos_y = Some(pos.y);
                                let _ = cfg.save();
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
                std::thread::spawn(move || {
                    let mut ignoring = false;
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
                        let rel_y = (cur.y - wpos.y as f64) / factor;
                        // When the panel is expanded (window taller than its base state) the whole window is clickable;
                        // when collapsed, only the bottom canvas strip (pet + bubble) is clickable
                        let solid = if h_logical > 345.0 {
                            true
                        } else {
                            rel_y >= h_logical - 192.0
                        };
                        let want = inside && !solid;
                        if want != ignoring {
                            let _ = w.set_ignore_cursor_events(want);
                            ignoring = want;
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
                            // Fallback save of the window position (drag throttling may miss the last bit of movement)
                            if let Some(w) = h.get_webview_window("main") {
                                if let Ok(pos) = w.outer_position() {
                                    let mut cfg = s.cfg.lock().unwrap();
                                    if cfg.pos_x != Some(pos.x) || cfg.pos_y != Some(pos.y) {
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
