// In-app updater: async check / download / install via tauri-plugin-updater.
// Runs on the Tauri async runtime so the std-thread model (hook server / heartbeat) is untouched.
// Availability + progress live in state::Shared and ride the PetUpdate snapshot to the panel.

use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

use crate::i18n;
use crate::state::{self, Shared, UpdateInfo};

/// Spawn an async update check. `manual` = user-triggered: an available update pops the update
/// dialog, an up-to-date result pops the same dialog in its "you're up to date" view, and a
/// failure surfaces an "error" state in the panel. Auto (24h) checks stay silent unless a new
/// version is found.
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
                eprintln!("[tokibean] updater unavailable: {}", e);
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
                // Respect a version the user chose to skip — but only on automatic checks;
                // a manual "Check for Updates" always surfaces it.
                if !manual && shared.cfg.lock().unwrap().skip_version == info.version {
                    {
                        let mut st = shared.update.lock().unwrap();
                        st.status = String::new();
                    }
                    state::push_update(&app, &shared);
                    return;
                }
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
                    println!("[tokibean] update available: {}", info.version);
                }
                state::push_update(&app, &shared);
                // Pop the dedicated update dialog (version + release notes + Update button)
                crate::show_update_window(&app);
            }
            Ok(None) => {
                // Up to date: clear any pending state. Auto checks stay silent; a manual
                // "Check for Updates" pops the update dialog in its "you're up to date" view
                // (update.html already renders that when there's no pending update) so the
                // click gives visible feedback instead of appearing to do nothing.
                {
                    let mut st = shared.update.lock().unwrap();
                    st.available = None;
                    st.status = String::new();
                    st.progress = 0;
                }
                state::push_update(&app, &shared);
                if manual {
                    crate::show_update_window(&app);
                }
            }
            Err(e) => {
                eprintln!("[tokibean] update check failed: {}", e);
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

use std::sync::atomic::{AtomicU64, Ordering};

/// Download and install the pending update, streaming progress into shared.update, then relaunch.
pub fn spawn_install(app: AppHandle, shared: Arc<Shared>) {
    tauri::async_runtime::spawn(async move {
        {
            let mut st = shared.update.lock().unwrap();
            st.status = "downloading".to_string();
            st.progress = 0;
        }
        state::push_update(&app, &shared);

        let updater = match app.updater() {
            Ok(u) => u,
            Err(e) => return fail(&app, &shared, &format!("updater unavailable: {}", e)),
        };
        let update = match updater.check().await {
            Ok(Some(u)) => u,
            Ok(None) => {
                // Nothing to install anymore
                set_status(&shared, "");
                {
                    let mut st = shared.update.lock().unwrap();
                    st.available = None;
                }
                state::push_update(&app, &shared);
                return;
            }
            Err(e) => return fail(&app, &shared, &format!("re-check failed: {}", e)),
        };

        let downloaded = Arc::new(AtomicU64::new(0));
        let app_cb = app.clone();
        let shared_cb = shared.clone();
        let dl = downloaded.clone();
        let res = update
            .download_and_install(
                move |chunk, total| {
                    let got = dl.fetch_add(chunk as u64, Ordering::Relaxed) + chunk as u64;
                    let Some(total) = total else { return };
                    if total == 0 {
                        return;
                    }
                    let pct = ((got.min(total) as f64 / total as f64) * 100.0) as u8;
                    // Push only when the integer percentage advances (<=101 pushes total)
                    let advanced = {
                        let mut st = shared_cb.update.lock().unwrap();
                        if st.progress != pct {
                            st.progress = pct;
                            true
                        } else {
                            false
                        }
                    };
                    if advanced {
                        state::push_update(&app_cb, &shared_cb);
                    }
                },
                || {},
            )
            .await;

        match res {
            Ok(_) => {
                println!("[tokibean] update installed, restarting");
                app.restart();
            }
            Err(e) => fail(&app, &shared, &format!("install failed: {}", e)),
        }
    });
}

fn fail(app: &AppHandle, shared: &Arc<Shared>, msg: &str) {
    eprintln!("[tokibean] {}", msg);
    {
        let mut st = shared.update.lock().unwrap();
        st.status = "error".to_string();
        st.progress = 0;
    }
    state::push_update(app, shared);
}
