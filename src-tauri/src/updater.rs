// In-app updater: async check / download / install via tauri-plugin-updater.
// Runs on the Tauri async runtime so the std-thread model (hook server / heartbeat) is untouched.
// Availability + progress live in state::Shared and ride the PetUpdate snapshot to the panel.

use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

use crate::i18n;
use crate::state::{self, Shared, UpdateInfo};

/// Spawn an async update check. `manual` = user-triggered (surface an "up to date" / "error"
/// result in the panel and, for up-to-date, a notification); auto checks stay silent otherwise.
pub fn spawn_check(app: AppHandle, shared: Arc<Shared>, manual: bool) {
    tauri::async_runtime::spawn(async move {
        // Show "checking" while the request is in flight
        {
            let mut st = shared.update.lock().unwrap();
            st.status = "checking".to_string();
        }
        state::push_update(&app, &shared);

        let updater = match app.updater() {
            Ok(u) => u,
            Err(e) => {
                eprintln!("[claude-pet] updater unavailable: {}", e);
                set_status(&shared, if manual { "error" } else { "" });
                state::push_update(&app, &shared);
                return;
            }
        };

        match updater.check().await {
            Ok(Some(update)) => {
                let info = UpdateInfo {
                    version: update.version.clone(),
                    notes: update.body.clone().unwrap_or_default(),
                };
                // Only notify + bubble the first time we see a given version, so the 24h
                // re-check doesn't nag every day
                let is_new = {
                    let mut st = shared.update.lock().unwrap();
                    let is_new = st.available.as_ref().map(|a| a.version != info.version).unwrap_or(true);
                    st.available = Some(info.clone());
                    st.status = String::new();
                    st.progress = 0;
                    is_new
                };
                if is_new {
                    // Bubble (scope the core lock so it's released before push_update)
                    {
                        let mut core = shared.core.lock().unwrap();
                        core.bubble = Some((
                            i18n::t("有新版本啦 🎁", "New version available 🎁").to_string(),
                            Instant::now() + Duration::from_secs(15),
                        ));
                    }
                    let notify_on = shared.cfg.lock().unwrap().notify;
                    if notify_on {
                        // i18n::t only takes &'static str, so build the dynamic body via is_zh()
                        // (same pattern as state.rs's daily report)
                        let body = if i18n::is_zh() {
                            format!("发现新版本 {},打开面板即可一键更新", info.version)
                        } else {
                            format!("Version {} is available — open the panel to update", info.version)
                        };
                        state::notify(&app, i18n::t("有新版本", "Update available"), &body);
                    }
                    println!("[claude-pet] update available: {}", info.version);
                }
                state::push_update(&app, &shared);
            }
            Ok(None) => {
                set_status(&shared, if manual { "uptodate" } else { "" });
                state::push_update(&app, &shared);
                if manual {
                    let notify_on = shared.cfg.lock().unwrap().notify;
                    if notify_on {
                        state::notify(
                            &app,
                            i18n::t("已是最新", "Up to date"),
                            i18n::t("已经是最新版本啦", "You're on the latest version"),
                        );
                    }
                }
            }
            Err(e) => {
                eprintln!("[claude-pet] update check failed: {}", e);
                set_status(&shared, if manual { "error" } else { "" });
                state::push_update(&app, &shared);
            }
        }
    });
}

fn set_status(shared: &Arc<Shared>, status: &str) {
    let mut st = shared.update.lock().unwrap();
    st.status = status.to_string();
}
