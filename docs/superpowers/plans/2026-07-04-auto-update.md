# In-App Auto-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users update Tokibean from inside the app (check → download → install → relaunch) via the official Tauri updater, with packages and manifest served from the project's existing GitHub Releases.

**Architecture:** Backend-driven, matching the project's "Rust owns all state" pattern. A new `updater.rs` module runs the async check/install via `tauri::async_runtime::spawn` so the existing std-thread model is untouched. Update availability and download progress live in `Shared` and ride the existing `PetUpdate` snapshot to the frontend. Manual trigger is a tray menu item; auto-check runs at startup and every 24h; the panel shows a temporary "new version" row when one is pending.

**Tech Stack:** Tauri 2, `tauri-plugin-updater` 2.x, Rust (std threads + `tauri::async_runtime`), vanilla JS frontend (`window.__TAURI__`), GitHub Actions + `tauri-action` for signed release artifacts.

## Global Constraints

- Code, comments, and developer logs in **English**; log prefix is `[claude-pet]` (match existing).
- User-facing strings are **bilingual**: backend `i18n::t("中文", "English")`, frontend `t("key")` from the `I18N` dict in `main.js`.
- Tauri 2; dependency line exactly `tauri-plugin-updater = "2"`.
- Rust: hold locks briefly, clone snapshots out. **Never hold the `shared.update` lock (or `core` lock) across a `state::push_update` call** — `push_update` locks `core`; a held lock deadlocks (documented hazard in CLAUDE.md).
- Async work uses `tauri::async_runtime::spawn`; do not block the hook-server / heartbeat / click-through std threads.
- Update endpoint: `https://github.com/ZGhey/tokibean/releases/latest/download/latest.json`.
- **Do not tag or release during implementation.** Commits land on `main` untagged; the baseline release is cut later as **0.2.0**.
- No automated test harness exists in this repo. Verification = `cargo check` (in `src-tauri/`) plus targeted manual dry-run. Do not scaffold a test framework.

---

### Task 1: Updater plugin plumbing + signing key

**Files:**
- Modify: `src-tauri/Cargo.toml` (dependencies)
- Modify: `src-tauri/src/main.rs:240-243` (plugin registration)
- Modify: `src-tauri/tauri.conf.json` (add `plugins.updater`, `bundle.createUpdaterArtifacts`)
- Local (not committed): a signing keypair

**Interfaces:**
- Produces: the updater plugin registered on the Tauri builder and configured with a real public key, so `app.updater()` is available to later tasks.

- [ ] **Step 1: Generate the signing keypair (one-time, local)**

Run:
```bash
cd /Users/marysuen/workspace/tokibean
npm run tauri signer generate -- -w "$HOME/.tauri/tokibean.key"
```
This prints a **Public key:** (base64) and writes the private key to `~/.tauri/tokibean.key` (and its `.pub`). Copy the public key string for Step 3. Keep the private key file; it goes into GitHub Secrets in Task 7. **Never commit the private key.**

- [ ] **Step 2: Add the dependency**

In `src-tauri/Cargo.toml`, under `[dependencies]` (after the `sys-locale` line), add:
```toml
tauri-plugin-updater = "2"
```

- [ ] **Step 3: Configure the updater and updater artifacts**

In `src-tauri/tauri.conf.json`, add a top-level `"plugins"` block immediately after the closing brace of the `"app"` object, and add `createUpdaterArtifacts` to `"bundle"`. Result:
```jsonc
  "app": {
    // ...unchanged...
  },
  "plugins": {
    "updater": {
      "endpoints": [
        "https://github.com/ZGhey/tokibean/releases/latest/download/latest.json"
      ],
      "pubkey": "<PASTE THE PUBLIC KEY FROM STEP 1>"
    }
  },
  "bundle": {
    "active": true,
    "createUpdaterArtifacts": true,
    "targets": "all",
    "icon": [ /* unchanged */ ]
  }
```
Paste the real public key into `pubkey` (a placeholder key will fail signature verification later).

- [ ] **Step 4: Register the plugin**

In `src-tauri/src/main.rs`, in the builder chain (currently lines 240-243), add the updater plugin after the global-shortcut plugin:
```rust
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(shared.clone())
```

- [ ] **Step 5: Verify it compiles**

Run:
```bash
cd /Users/marysuen/workspace/tokibean/src-tauri && cargo check
```
Expected: `Finished`. Only the pre-existing warnings (`wsl_roots`/`wsl_checked` dead_code on macOS, `mut wsl_note`) — no new errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/marysuen/workspace/tokibean
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json src-tauri/src/main.rs
git commit -m "feat(updater): register tauri-plugin-updater and configure endpoint"
```

---

### Task 2: Update state types + snapshot field

**Files:**
- Modify: `src-tauri/src/state.rs` (new types, `Shared` field, `PetUpdate` field, `build_update`)

**Interfaces:**
- Produces:
  - `state::UpdateInfo { version: String, notes: String }` (Serialize, Clone, Default)
  - `state::UpdateState { available: Option<UpdateInfo>, status: String, progress: u8 }` (Serialize, Clone, Default)
  - `Shared.update: Mutex<UpdateState>`
  - `PetUpdate.update: UpdateState`

- [ ] **Step 1: Add the types**

In `src-tauri/src/state.rs`, after the `Base` enum (after line 26), add:
```rust
/// A newer release detected by the updater
#[derive(Serialize, Clone, Default)]
pub struct UpdateInfo {
    pub version: String,
    pub notes: String,
}

/// Update availability + transient download status, surfaced to the panel
#[derive(Serialize, Clone, Default)]
pub struct UpdateState {
    /// Some once a newer release has been detected
    pub available: Option<UpdateInfo>,
    /// Transient status for the panel: "" | "checking" | "uptodate" | "downloading" | "error"
    pub status: String,
    /// Download progress 0-100 while status == "downloading"
    pub progress: u8,
}
```

- [ ] **Step 2: Add the `Shared` field**

In the `Shared` struct (after the `official_last_try` field, around line 85), add:
```rust
    /// In-app updater: availability + download progress, pushed to the panel
    pub update: Mutex<UpdateState>,
```
And in `Shared::new()` (after the `official_last_try: Mutex::new(None),` line, around line 117), add:
```rust
            update: Mutex::new(UpdateState::default()),
```

- [ ] **Step 3: Add the `PetUpdate` field**

In the `PetUpdate` struct (after the `bg_count: usize,` field, around line 142), add:
```rust
    /// In-app updater state (availability + download progress)
    pub update: UpdateState,
```

- [ ] **Step 4: Populate it in `build_update`**

In `build_update`, right after `let snap = shared.snapshot.lock().unwrap().clone();` (line 147), add:
```rust
    let update = shared.update.lock().unwrap().clone();
```
Then in the returned `PetUpdate { ... }` literal (after the `bg_count: ...` line, around line 204), add:
```rust
        update,
```

- [ ] **Step 5: Verify it compiles**

Run:
```bash
cd /Users/marysuen/workspace/tokibean/src-tauri && cargo check
```
Expected: `Finished`, no new errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/marysuen/workspace/tokibean
git add src-tauri/src/state.rs
git commit -m "feat(updater): carry update availability + progress on the pet-update snapshot"
```

---

### Task 3: `updater.rs` — check engine + `check_update` command

**Files:**
- Create: `src-tauri/src/updater.rs`
- Modify: `src-tauri/src/main.rs` (add `mod updater;`, `check_update` command, register in `invoke_handler`)

**Interfaces:**
- Consumes: `state::{Shared, UpdateInfo, UpdateState, push_update, notify}`; `app.updater()` from Task 1.
- Produces:
  - `updater::spawn_check(app: AppHandle, shared: Arc<Shared>, manual: bool)` — spawns an async check; on a newer version stores `UpdateInfo`, fires a one-shot notification + bubble, pushes an update. `manual=true` surfaces an "up to date" result; auto checks stay silent when nothing is new.
  - `#[tauri::command] check_update(app)` — user/tray entry point calling `spawn_check(.., manual=true)`.

- [ ] **Step 1: Create the module**

Create `src-tauri/src/updater.rs`:
```rust
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
```

- [ ] **Step 2: Wire the module and command into `main.rs`**

In `src-tauri/src/main.rs`, add the module declaration alongside the others (after `mod state;`, around line 13):
```rust
mod updater;
```
Add the command (after the `connect_claude` command, around line 126):
```rust
#[tauri::command]
fn check_update(app: AppHandle) {
    let shared = app.state::<Arc<Shared>>().inner().clone();
    updater::spawn_check(app, shared, true);
}
```
Register it in `invoke_handler` (in the list at lines 244-254, add after `panel_opened`):
```rust
            panel_opened,
            check_update
```

- [ ] **Step 3: Verify it compiles**

Run:
```bash
cd /Users/marysuen/workspace/tokibean/src-tauri && cargo check
```
Expected: `Finished`, no new errors.

- [ ] **Step 4: Dry-run the check path (manual)**

Temporarily create a fake manifest advertising a higher version and point the app at it:
1. Write `/tmp/latest.json`:
```json
{ "version": "9.9.9", "notes": "test", "pub_date": "2030-01-01T00:00:00Z",
  "platforms": { "darwin-universal": { "signature": "x", "url": "https://example.com/none" } } }
```
2. In `tauri.conf.json`, temporarily set the updater `endpoints` to `["http://127.0.0.1:5000/latest.json"]` and serve `/tmp` with `python3 -m http.server 5000 --directory /tmp` (or any static server).
3. `npm run tauri dev`. In the pet's devtools console run:
```js
window.__TAURI__.core.invoke("check_update")
```
4. Expected: a "有新版本啦 🎁" bubble + a system notification; `window.__TAURI__.core.invoke("get_update").then(u => console.log(u.update))` shows `available.version === "9.9.9"`.
5. **Revert** the temporary `endpoints` change (back to the GitHub URL) and stop the static server.

- [ ] **Step 5: Commit**

```bash
cd /Users/marysuen/workspace/tokibean
git add src-tauri/src/updater.rs src-tauri/src/main.rs
git commit -m "feat(updater): async check with notification + bubble on new version"
```

---

### Task 4: Triggers — tray item + startup + 24h auto-check

**Files:**
- Modify: `src-tauri/src/main.rs` (tray menu item + handler; startup check; heartbeat 24h check)

**Interfaces:**
- Consumes: `updater::spawn_check` from Task 3.

- [ ] **Step 1: Add the tray menu item**

In `src-tauri/src/main.rs` setup, where the tray menu is built (lines 319-321), add a "check_update" item between `show` and `quit`:
```rust
            let show = MenuItem::with_id(app, "show", i18n::t("显示 / 隐藏", "Show / Hide"), true, None::<&str>)?;
            let check = MenuItem::with_id(app, "check_update", i18n::t("检查更新…", "Check for Updates…"), true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", i18n::t("退出", "Quit"), true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &check, &quit])?;
```

- [ ] **Step 2: Handle the tray click**

In the tray `on_menu_event` match (lines 325-341), add a `"check_update"` arm before the `_ => {}`:
```rust
                    "check_update" => {
                        let shared = app.state::<Arc<Shared>>().inner().clone();
                        updater::spawn_check(app.clone(), shared, true);
                    }
```

- [ ] **Step 3: Add the startup check**

In setup, after the heartbeat thread block (after the block that ends around line 438, before `Ok(())`), add a delayed startup check:
```rust
            // Check for updates a few seconds after launch (background; silent if up to date)
            {
                let h = handle.clone();
                let s = shared.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(5));
                    updater::spawn_check(h, s, false);
                });
            }
```

- [ ] **Step 4: Add the 24h re-check in the heartbeat**

In the heartbeat loop (inside the `loop { ... }` around lines 410-436), after the `tick % 30` position-save block, add:
```rust
                        // Re-check for updates once a day (silent unless a new version appears)
                        if tick % 86_400 == 0 {
                            updater::spawn_check(h.clone(), s.clone(), false);
                        }
```

- [ ] **Step 5: Verify it compiles**

Run:
```bash
cd /Users/marysuen/workspace/tokibean/src-tauri && cargo check
```
Expected: `Finished`, no new errors.

- [ ] **Step 6: Verify the tray trigger (manual)**

`npm run tauri dev`, then click the menu-bar/tray icon → "检查更新… / Check for Updates…". With no newer release published you should see the "已是最新 / Up to date" notification (manual check). Confirm no crash and the app keeps running.

- [ ] **Step 7: Commit**

```bash
cd /Users/marysuen/workspace/tokibean
git add src-tauri/src/main.rs
git commit -m "feat(updater): tray Check-for-Updates item + startup and 24h auto-check"
```

---

### Task 5: Install — `spawn_install` + `install_update` command + progress

**Files:**
- Modify: `src-tauri/src/updater.rs` (add `spawn_install`)
- Modify: `src-tauri/src/main.rs` (add `install_update` command + register)

**Interfaces:**
- Consumes: `state::Shared`, `app.updater()`.
- Produces:
  - `updater::spawn_install(app: AppHandle, shared: Arc<Shared>)` — re-checks, downloads with progress into `shared.update.progress`, installs, then relaunches.
  - `#[tauri::command] install_update(app)`.

- [ ] **Step 1: Add `spawn_install` to `updater.rs`**

Append to `src-tauri/src/updater.rs`:
```rust
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
                println!("[claude-pet] update installed, restarting");
                app.restart();
            }
            Err(e) => fail(&app, &shared, &format!("install failed: {}", e)),
        }
    });
}

fn fail(app: &AppHandle, shared: &Arc<Shared>, msg: &str) {
    eprintln!("[claude-pet] {}", msg);
    {
        let mut st = shared.update.lock().unwrap();
        st.status = "error".to_string();
        st.progress = 0;
    }
    state::push_update(app, shared);
}
```

- [ ] **Step 2: Add the `install_update` command**

In `src-tauri/src/main.rs`, after the `check_update` command:
```rust
#[tauri::command]
fn install_update(app: AppHandle) {
    let shared = app.state::<Arc<Shared>>().inner().clone();
    updater::spawn_install(app, shared);
}
```
Register it in `invoke_handler` (after `check_update`):
```rust
            check_update,
            install_update
```

- [ ] **Step 3: Verify it compiles**

Run:
```bash
cd /Users/marysuen/workspace/tokibean/src-tauri && cargo check
```
Expected: `Finished`, no new errors.

> Note: a real download+install can only be exercised against a signed release (deferred to the 0.2.0 → 0.2.1 verification). In dev, `install_update` will error at the download step — that error path (status → "error") is what's observable here.

- [ ] **Step 4: Commit**

```bash
cd /Users/marysuen/workspace/tokibean
git add src-tauri/src/updater.rs src-tauri/src/main.rs
git commit -m "feat(updater): download-and-install with progress, then relaunch"
```

---

### Task 6: Frontend — update row (markup, i18n, render, click, style)

**Files:**
- Modify: `src/index.html` (add `#update-row` button)
- Modify: `src/main.js` (i18n keys, `cur.update` default, render logic, click handler)
- Modify: `src/style.css` (append `#update-row` rule)

**Interfaces:**
- Consumes: `cur.update = { available: {version, notes} | null, status, progress }` from the snapshot (Task 2); commands `install_update` (Task 5), `check_update` (Task 3).

- [ ] **Step 1: Add the markup**

In `src/index.html`, immediately after the `.row.head` div (after line 18, before `<div id="sub-block">`), add:
```html
    <button id="update-row" class="hidden update-row"></button>
```

- [ ] **Step 2: Add the i18n keys**

In `src/main.js`, inside the `I18N` object (after the `press_shortcut` entry, around line 64), add:
```js
    update_found: ["发现新版本 {v} → 更新", "v{v} available → Update"],
    update_downloading: ["下载中 {p}%", "Downloading {p}%"],
    update_uptodate: ["已是最新版本", "You're up to date"],
    update_checking: ["检查更新中…", "Checking for updates…"],
    update_error: ["检查更新失败,点重试", "Update check failed — retry"],
```

- [ ] **Step 3: Add `update` to the `cur` default**

In `src/main.js`, in the `cur` initializer (lines 96-108), add after `celebrate: 0,`:
```js
    update: { available: null, status: "", progress: 0 },
```

- [ ] **Step 4: Render the update row**

In `src/main.js`, at the end of `renderPanel` (after the `el("connect-claude").classList.toggle(...)` line, around line 244, still inside the function before its closing `}`), add:
```js
    // In-app updater row: only visible when an update is pending / downloading / just-checked
    const up = cur.update || { available: null, status: "", progress: 0 };
    const urow = el("update-row");
    if (up.status === "downloading") {
      urow.textContent = t("update_downloading", { p: up.progress || 0 });
      urow.classList.remove("hidden");
      urow.disabled = true;
    } else if (up.available) {
      urow.textContent = t("update_found", { v: up.available.version });
      urow.classList.remove("hidden");
      urow.disabled = false;
    } else if (up.status === "checking") {
      urow.textContent = t("update_checking");
      urow.classList.remove("hidden");
      urow.disabled = true;
    } else if (up.status === "uptodate") {
      urow.textContent = t("update_uptodate");
      urow.classList.remove("hidden");
      urow.disabled = true;
    } else if (up.status === "error") {
      urow.textContent = t("update_error");
      urow.classList.remove("hidden");
      urow.disabled = false;
    } else {
      urow.classList.add("hidden");
    }
```

- [ ] **Step 5: Wire the click handler**

In `src/main.js`, near the other button handlers at the end of the IIFE (after the `install-hooks` handler, before the closing `})();`), add:
```js
  el("update-row").addEventListener("click", () => {
    const up = cur.update || {};
    if (up.status === "error") {
      // Retry a check
      invoke("check_update").catch(() => {});
      return;
    }
    if (!up.available) return;
    invoke("install_update").catch(() => {});
  });
```

- [ ] **Step 6: Style the row**

Append to `src/style.css`:
```css
#update-row.update-row {
  width: 100%;
  margin: 6px 0 2px;
  padding: 6px 8px;
  border: 1px solid #3a7d44;
  border-radius: 4px;
  background: #2e6b39;
  color: #fff;
  font-size: 12px;
  cursor: pointer;
}
#update-row.update-row:disabled {
  opacity: 0.7;
  cursor: default;
}
```

- [ ] **Step 7: Verify (manual)**

Reuse the Task 3 dry-run (fake `/tmp/latest.json` at version `9.9.9`, endpoint pointed at the local server). `npm run tauri dev`, open the panel (click the pet), trigger a check (tray item or devtools `invoke("check_update")`). Expected: the green "发现新版本 9.9.9 → 更新 / v9.9.9 available → Update" row appears at the top of the panel. Clicking it invokes `install_update` (which errors in dev at download — expected; the row shows the error state). **Revert** the temporary endpoint change afterward.

- [ ] **Step 8: Commit**

```bash
cd /Users/marysuen/workspace/tokibean
git add src/index.html src/main.js src/style.css
git commit -m "feat(updater): panel update row with progress and one-click install"
```

---

### Task 7: CI signing secrets + README note

**Files:**
- Modify: `.github/workflows/build.yml` (inject signing env into the tauri-action step)
- Modify: `README.md` and `README.zh-CN.md` (short auto-update note)
- Local/manual: add two GitHub repository secrets

**Interfaces:**
- Consumes: the private key + password from Task 1.

- [ ] **Step 1: Inject the signing secrets in CI**

In `.github/workflows/build.yml`, in the `Build bundles` step's `env:` block (currently just `GITHUB_TOKEN`), add the two signing variables:
```yaml
      - name: Build bundles
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          tagName: ${{ github.ref_type == 'tag' && github.ref_name || '' }}
          releaseName: ${{ github.ref_type == 'tag' && 'Tokibean 码豆 __VERSION__' || '' }}
          args: ${{ matrix.args }}
```
With signing keys present and the updater configured, `tauri-action` signs each bundle (`.sig`), generates `latest.json`, and uploads it to the tagged Release.

- [ ] **Step 2: Add the GitHub secrets (manual, one-time)**

Run (or add via the GitHub web UI → Settings → Secrets → Actions):
```bash
cd /Users/marysuen/workspace/tokibean
gh secret set TAURI_SIGNING_PRIVATE_KEY < "$HOME/.tauri/tokibean.key"
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD   # paste the password (empty if none)
```
> This uploads the private key to the repo's Actions secrets. It is sensitive; confirm before running. The key never enters git.

- [ ] **Step 3: README note (both languages)**

In `README.md`, add a short line to the features/usage area:
```markdown
- **Auto-update**: from 0.2.0 on, the app checks for new releases on launch and lets you update in one click (tray → *Check for Updates…*, or the panel banner). No more manual re-downloads.
```
In `README.zh-CN.md`, the mirrored line:
```markdown
- **自动更新**:从 0.2.0 起,启动时自动检查新版本,一键更新(托盘 →「检查更新…」,或面板顶部的提示条),不用再手动重新下载。
```

- [ ] **Step 4: Verify the workflow YAML is well-formed**

Run:
```bash
cd /Users/marysuen/workspace/tokibean && python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/build.yml')); print('yaml ok')"
```
Expected: `yaml ok`.

- [ ] **Step 5: Commit**

```bash
cd /Users/marysuen/workspace/tokibean
git add .github/workflows/build.yml README.md README.zh-CN.md
git commit -m "ci(updater): sign bundles + publish latest.json; document auto-update"
```

---

## Post-implementation (not part of the untagged merge)

- The whole feature lands on `main` untagged. It ships when **0.2.0** is cut (bump `package.json` / `tauri.conf.json` / `Cargo.toml` / `Cargo.lock`, tag `v0.2.0`). Its release notes should tell existing 0.1.x users this is the last manual download.
- **Real end-to-end verification is only possible after two updater-enabled releases exist**: once 0.2.0 is out, cut 0.2.1 and confirm an installed 0.2.0 auto-detects and applies it on macOS and Windows.

## Self-review notes

- Spec coverage: dependency/registration/config (T1) · signing key + CI (T1, T7) · state on snapshot (T2) · check + notify + bubble (T3) · tray manual entry + startup + 24h auto-check (T4) · install + progress + relaunch (T5) · panel row + bilingual strings (T6) · README (T7). All spec sections mapped.
- Deviation from spec §Architecture #1: the `updater:default` capability is **not** added. Our webview calls only our own `#[tauri::command]`s (`check_update`/`install_update`), never the updater plugin's JS API directly, so no updater capability is required. If `app.updater()` ever returns a permission error at runtime, add `"updater:default"` to `src-tauri/capabilities/default.json`.
- Type consistency: `UpdateState` fields `{available, status, progress}` and `UpdateInfo` fields `{version, notes}` are used identically across Rust (`state.rs`, `updater.rs`) and JS (`cur.update.*`).
- Lock safety: every `shared.update` / `core` lock is scoped and dropped before the following `state::push_update` call.
