# Auto-Update (in-app updater) — Design

Date: 2026-07-04
Status: Approved (pending spec review)

## Goal

Let users update Tokibean from inside the app instead of manually re-downloading
each release. Industry-standard, boring-on-purpose: the official Tauri updater
plugin, update packages and manifest served from the GitHub Releases the project
already publishes.

## Non-goals

- No custom/self-invented update transport. Official `tauri-plugin-updater` only.
- No Linux updater (Linux is not built in CI; unaffected).
- No forced/silent auto-install. Updates are surfaced, the user chooses to apply.

## Constraints & honest caveats

- **Signing is mandatory.** The updater only installs packages signed with the
  project's private key. A minisign keypair is generated once; the public key
  ships in the app config, the private key lives only in GitHub Secrets.
- **Only protects future versions.** The updater takes effect starting from the
  first release that bundles it. Existing 0.1.10 users must manually download the
  first updater-enabled release (0.1.11) once; from 0.1.11 → 0.1.12+ updates are
  in-app. This is inherent to every auto-update scheme, not specific to this one.
- **Full end-to-end verification needs two updater-enabled releases.** During
  development we verify with `cargo check` and a local manifest; the real
  0.1.11 → 0.1.12 upgrade can only be exercised once both exist.

## UX

Trigger model: **auto-check on startup + every 24h**, plus a **manual** entry.

- **Manual entry:** a "检查更新… / Check for Updates…" item in the existing tray
  menu (`main.rs`, alongside Show/Hide and Quit). This is the standard menu-bar-app
  convention on macOS and works identically on Windows.
- **Passive surfacing when an update is found** (whether from the auto-check or a
  manual check):
  - a system notification (reuse `state::notify`),
  - a one-shot pet bubble ("有新版本啦 🎁 / New version available 🎁"),
  - a temporary row in the usage panel: "发现新版本 vX → 更新 / vX available → Update",
    shown only while an update is pending (no permanent button clutter).
- **Applying:** clicking Update (tray item when available, or the panel row)
  downloads with live progress, installs, and relaunches the app.
- **Manual check, no update:** the tray/panel shows "已是最新 / Up to date" briefly.
- **Network failure / no update on auto-check:** silent, logged only.

All user-facing strings follow the project's bilingual rule (`i18n::t` backend,
`t("key")` frontend).

## Architecture

Backend-driven, matching the project's "Rust owns all state" pattern. The updater
plugin API is async; run it via `tauri::async_runtime::spawn` so the existing
std-thread model (hook server / heartbeat / click-through) is untouched.

### 1. Dependency & registration
- `src-tauri/Cargo.toml`: add `tauri-plugin-updater = "2"`.
- `main.rs` builder: `.plugin(tauri_plugin_updater::Builder::new().build())`.
- `capabilities/default.json`: add `"updater:default"`.

### 2. Config (`tauri.conf.json`)
```jsonc
"plugins": {
  "updater": {
    "endpoints": ["https://github.com/ZGhey/tokibean/releases/latest/download/latest.json"],
    "pubkey": "<minisign public key>"
  }
},
"bundle": {
  "createUpdaterArtifacts": true
}
```
Windows install mode left at the default `passive` (shows a small installer UI).

### 3. Signing key (one-time)
- Generate locally: `npm run tauri signer generate -- -w ~/.tauri/tokibean.key`
  (or `tauri signer generate`). Produces a private key (+ optional password) and
  a public key.
- Public key → `plugins.updater.pubkey` in `tauri.conf.json`.
- Private key → GitHub Secret `TAURI_SIGNING_PRIVATE_KEY`; password → Secret
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Never committed.

### 4. CI (`.github/workflows/build.yml`)
- Inject the two signing secrets as env into the `tauri-apps/tauri-action@v0` step.
  With signing keys present and the updater configured, tauri-action signs each
  bundle (`.sig`), generates `latest.json`, and uploads it to the tagged Release.
- No other CI changes; existing dmg/nsis/msi artifacts are unaffected.

### 5. State
Add to the `PetUpdate` snapshot (`state.rs`) an optional field:
```rust
update: Option<UpdateInfo>   // { version: String, notes: String }
```
Stored in `Shared` (e.g. `Mutex<Option<UpdateInfo>>`) so the heartbeat's periodic
check and the tray/command paths share it. Also a small status enum for the
in-progress/failed/up-to-date states the panel shows during a manual check.

### 6. Commands (`main.rs` / a new small module)
- `check_update()` — run the updater check; on a newer version, store
  `UpdateInfo`, fire notification + bubble, push a `pet-update`. Returns the
  status to the caller (used by the manual tray/panel path).
- `install_update()` — `update.download_and_install(on_chunk, on_finish)`,
  writing download progress into a Shared field carried by the next `pet-update`
  snapshot (consistent with the app's "push a full snapshot" pattern — no second
  event channel), then `app.restart()`.

### 7. Auto-check wiring
- **Startup:** in `setup`, `spawn` a `check_update` after a short delay (let the
  window/threads come up first).
- **Periodic:** the 1s heartbeat already runs; gate a re-check to every 24h with an
  `Instant` stored in `Shared` (same pattern as the existing throttles), spawning
  the async check when due. Debounced so a manual check resets the timer.

### 8. Frontend (`src/main.js`)
- On `pet-update`, if `usage`/snapshot carries `update`, render the panel's
  "new version" row and wire its click to `invoke("install_update")`.
- Show download progress from the Shared progress field on the snapshot; on
  completion the app relaunches (no extra frontend work needed).
- Pet bubble reuses the existing bubble field already rendered by `pet.js`.

## Error handling

- No update / network error on auto-check → silent, `eprintln!` log only.
- Manual check with no update → transient "Up to date" status in panel.
- Download/install failure → transient error status + log; state cleared so a
  later check can retry.
- Signature mismatch → plugin refuses to install (the point of signing); logged.

## Testing / verification

No test harness exists in this repo. Verification steps:
1. `cargo check` in `src-tauri` — compiles with the plugin + commands.
2. Config validation — `tauri.conf.json` schema accepts the updater block.
3. Logic dry-run — temporarily point `endpoints` at a local/test `latest.json`
   describing a higher version to confirm the check/notify/panel path fires.
4. Real end-to-end (deferred): after 0.1.11 ships with the updater, cut 0.1.12 and
   confirm an installed 0.1.11 auto-detects and applies it on macOS and Windows.

## Rollout

- 0.1.11 is the "baseline" updater-enabled release. Its own release notes should
  tell existing users this is the last manual download.
- README (both `README.md` and `README.zh-CN.md`) gets a short "auto-update" note.
