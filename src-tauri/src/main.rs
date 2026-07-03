// Tokibean 码豆 —— 桌面状态监视宠物
// 主入口:创建透明置顶窗口、系统托盘,启动 hook 服务器 / 用量扫描 / 心跳线程

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
mod focus;
mod hooks_install;
mod hooks_server;
mod login;
mod official;
mod state;
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
            return Err("未知模式".into());
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
        "block_limit": cfg.block_limit,
        "connected": !cfg.oauth_access.is_empty(),
        "hooks_incomplete": hooks_install::incomplete(cfg.port),
    })
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
fn connect_claude(app: AppHandle) -> Result<String, String> {
    let shared = app.state::<Arc<Shared>>().inner().clone();
    let msg = login::connect(shared.clone())?;
    state::refresh_usage(&shared, true);
    state::push_update(&app, &shared);
    Ok(msg)
}

fn main() {
    let shared = Arc::new(Shared::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .manage(shared.clone())
        .invoke_handler(tauri::generate_handler![
            get_update,
            install_hooks,
            set_mode,
            get_config,
            set_config,
            connect_claude,
            focus_terminal
        ])
        .on_window_event(|window, event| {
            let shared = window.app_handle().state::<Arc<Shared>>();
            match event {
                // 记录程序性调整尺寸的时刻:面板展开/收起会先移位再改尺寸,
                // 这种"移动"不是用户拖拽,不该覆盖记住的位置
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

            // 恢复上次记住的窗口位置
            {
                let cfg = shared.cfg.lock().unwrap();
                if let (Some(x), Some(y)) = (cfg.pos_x, cfg.pos_y) {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
                    }
                }
            }

            // 系统托盘:显示/隐藏 + 退出
            let show = MenuItem::with_id(app, "show", "显示 / 隐藏", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Tokibean 码豆")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        // 退出前把当前位置记下来
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
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            if w.is_visible().unwrap_or(false) {
                                let _ = w.hide();
                            } else {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                    }
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            // 线程 1:hook 事件 HTTP 服务器(Claude Code hooks 会 POST 到这里)
            {
                let h = handle.clone();
                let s = shared.clone();
                std::thread::spawn(move || hooks_server::run(h, s));
            }

            // 线程 3:动态点击穿透。光标悬在透明空白区时,鼠标事件穿透
            // 到下层窗口(否则置顶的透明窗会挡住底下按钮);移到宠物/
            // 气泡所在的画布区或展开的面板上则恢复可交互
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
                        // 面板展开(窗口高于基础态)时整窗可点;
                        // 收起时只有底部画布区(宠物+气泡)可点
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

            // 线程 2:心跳。每秒处理状态过期,每 30 秒重扫 JSONL 用量
            {
                let h = handle.clone();
                let s = shared.clone();
                std::thread::spawn(move || {
                    let mut tick: u64 = 0;
                    // 启动时先扫一遍
                    state::refresh_usage(&s, true);
                    state::push_update(&h, &s);
                    loop {
                        std::thread::sleep(Duration::from_secs(1));
                        tick += 1;
                        let mut changed = state::expire_transients(&s);
                        if tick % 30 == 0 {
                            // JSONL 每 30 秒扫,官方接口每 90 秒问一次(有限流)
                            state::refresh_usage(&s, tick % 90 == 0);
                            state::check_usage_alerts(&h, &s);
                            // 兜底保存窗口位置(拖拽节流可能漏掉最后一段位移)
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
                            changed = true;
                        }
                        if changed {
                            state::push_update(&h, &s);
                        }
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("claude-pet 启动失败");
}
