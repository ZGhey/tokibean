// Frontend main logic: subscribe to the pet-update pushed by Rust, driving the pet animation and panel

(function () {
  const { listen } = window.__TAURI__.event;
  const { invoke } = window.__TAURI__.core;

  // ---------- i18n ----------
  // System language decides the UI language: Chinese for zh*, English otherwise.
  const LANG = (navigator.language || "en").toLowerCase().startsWith("zh") ? "zh" : "en";
  const I18N = {
    mode_auto: ["自动检测", "Auto-detect"],
    mode_sub: ["订阅(Pro/Max)", "Subscription (Pro/Max)"],
    mode_api: ["API 计费", "API billing"],
    billing_mode: ["计费模式", "Billing mode"],
    badge_sub: ["订阅", "Sub"],
    win5h: ["5 小时窗口", "5-hour window"],
    usage_aria: ["窗口用量", "Window usage"],
    no_window: ["暂无活动窗口", "No active window"],
    week_quota: ["周额度", "Weekly quota"],
    cost_today: ["今日成本", "Today's cost"],
    last7: ["近 7 天", "Last 7 days"],
    trend_title: ["近 7 天逐日用量", "Daily usage, last 7 days"],
    tok_today: ["今日 tokens", "Today's tokens"],
    models: ["模型", "Models"],
    official_usage: ["官方用量", "Official usage"],
    not_connected: ["未连接", "Not connected"],
    connect_claude: ["连接 Claude 账号", "Connect Claude account"],
    notify: ["系统通知", "Notifications"],
    min_secs: ["不足此秒数不提醒", "Skip notify under N sec"],
    sound: ["提示音", "Sound"],
    boss_key: ["快捷键", "Hotkey"],
    boss_key_title: ["点一下再按下想设的快捷键;叫出/藏起宠物", "Click, then press a shortcut; shows/hides the pet"],
    skin: ["皮肤", "Skin"],
    skin_classic: ["墩墩(默认)", "Dundun (default)"],
    skin_bean: ["豆豆", "Bean"],
    skin_tabby: ["橘猫·摸鱼", "Tabby"],
    hook_events: ["hook 事件", "Hook events"],
    not_received: ["还没收到", "Nothing yet"],
    install_hooks: ["安装 Claude Code hooks", "Install Claude Code hooks"],
    pet_title: ["点我看用量", "Click me for usage"],
    reset_done: ["已重置", "reset"],
    official_data: ["官方数据", "official data"],
    limit_manual: ["限额 {v}(手动设置)", "limit {v} (manual)"],
    limit_auto: ["按加权用量·历史峰值窗口估算", "estimated vs. weighted peak window"],
    limit_nodata: ["还没有足够数据估算限额", "not enough data to estimate the limit"],
    reset_line: ["{hh}:{mm} 重置(剩 {left})· {note}", "resets {hh}:{mm} ({left} left) · {note}"],
    no_window_official: ["当前无活动窗口 · 官方数据", "No active window · official data"],
    no_window2: ["当前无活动窗口", "No active window"],
    connected_official: ["已连接·官方数据", "Connected · official data"],
    connected: ["已连接", "Connected"],
    authorizing: ["浏览器授权中…", "Authorizing in browser…"],
    no_claude_data: ["没找到 ~/.claude 数据", "No ~/.claude data found"],
    hook_ok: ["已连通(最近:{ev})", "Connected (last: {ev})"],
    sessions_n: [" · {n} 会话", " · {n} sessions"],
    go_install: ["还没收到,去装 hooks →", "Nothing yet — install hooks →"],
    hook_installed: ["已安装 · 重启 Claude Code 后生效", "Installed · restart Claude Code to take effect"],
    update_hooks: ["更新 Claude Code hooks(有新事件)", "Update Claude Code hooks (new events)"],
    connect_fail: ["连接失败:{e}", "Connect failed: {e}"],
    installing: ["安装中…", "Installing…"],
    fail: ["失败:{e}", "Failed: {e}"],
    boss_updated: ["快捷键已更新:{k}", "Hotkey updated: {k}"],
    boss_fail: ["快捷键设置失败:{e}", "Failed to set hotkey: {e}"],
    press_shortcut: ["按下快捷键…", "Press a shortcut…"],
    update_found: ["发现新版本 {v} → 更新", "v{v} available → Update"],
    update_downloading: ["下载中 {p}%", "Downloading {p}%"],
    update_uptodate: ["已是最新版本", "You're up to date"],
    update_checking: ["检查更新中…", "Checking for updates…"],
    update_error: ["检查更新失败,点重试", "Update check failed — retry"],
    settings: ["设置", "Settings"],
  };
  function t(key, vars) {
    let s = (I18N[key] ? I18N[key][LANG === "zh" ? 0 : 1] : key) || key;
    if (vars) for (const k in vars) s = s.split("{" + k + "}").join(vars[k]);
    return s;
  }
  // Fill static markup marked with data-i18n / data-i18n-title / data-i18n-aria.
  function applyStaticI18n() {
    document.documentElement.lang = LANG === "zh" ? "zh-CN" : "en";
    document.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
    document.querySelectorAll("[data-i18n-title]").forEach((el) => (el.title = t(el.dataset.i18nTitle)));
    document
      .querySelectorAll("[data-i18n-aria]")
      .forEach((el) => el.setAttribute("aria-label", t(el.dataset.i18nAria)));
  }
  applyStaticI18n();

  const canvas = document.getElementById("pet");
  const ctx = canvas.getContext("2d");
  // High DPI: render the backing buffer at physical pixel resolution so text and pixel edges stay sharp
  {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width, h = canvas.height;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.scale(dpr, dpr);
  }
  const panel = document.getElementById("panel");

  let cur = {
    state: "idle",
    warn: false,
    bubble: null,
    last_event: null,
    hooks_seen: false,
    usage: null,
    working_count: 0,
    session_count: 0,
    work_secs: 0,
    tool_note: null,
    celebrate: 0,
    bg_count: 0,
    agent_count: 0,
    update: { available: null, status: "", progress: 0 },
  };
  let frame = 0;
  let dragging = false;
  let pat = false;

  // ---------- Animation loop ----------
  function loop() {
    frame++;
    window.PetRenderer.draw(ctx, canvas, cur.state, cur.warn, cur.bubble, frame, {
      sessions: cur.working_count,
      workSecs: cur.work_secs,
      attnSecs: cur.attention_secs,
      toolNote: cur.tool_note,
      celebrate: cur.celebrate,
      oops: cur.oops,
      bgCount: cur.bg_count,
      agentCount: cur.agent_count,
      dragging,
      pat,
    });
    requestAnimationFrame(loop);
  }
  loop();

  // ---------- Number formatting ----------
  function fmtTokens(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return String(n);
  }
  function fmtCost(x) {
    return "$" + x.toFixed(2);
  }
  function fmtCountdown(sec) {
    if (sec <= 0) return t("reset_done");
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  // ---------- Panel rendering ----------
  const el = (id) => document.getElementById(id);

  // Pixel progress bar: 10 cells
  const bar = el("pixel-bar");
  for (let i = 0; i < 10; i++) bar.appendChild(document.createElement("span"));
  // 7-day trend bars
  const trend = el("trend");
  for (let i = 0; i < 7; i++) trend.appendChild(document.createElement("span"));
  trend.lastChild.className = "today";

  function renderPanel() {
    const u = cur.usage;
    if (!u) return;

    const isSub = u.mode === "subscription";
    el("mode-badge").textContent = isSub ? t("badge_sub") : "API";
    el("sub-block").classList.toggle("hidden", !isSub);
    el("api-block").classList.toggle("hidden", isSub);

    if (isSub) {
      const pct = Math.min(u.block_pct, 1.5);
      // Prefix estimates with ≈ to signal they're approximate, so "100%" isn't alarming
      const approx = u.basis === "official" || u.basis === "manual" ? "" : "≈";
      el("block-pct").textContent =
        u.block_limit > 0 || u.basis === "official"
          ? approx + Math.round(u.block_pct * 100) + "%"
          : "--%";
      const cells = bar.children;
      const lit = Math.round(Math.min(pct, 1) * 10);
      for (let i = 0; i < 10; i++) {
        const c = cells[i];
        c.className = "";
        if (i < lit) {
          c.classList.add("on");
          if (u.block_pct >= 1.0) c.classList.add("full");
          else if (u.block_pct >= 0.8) c.classList.add("warn");
        }
      }
      if (u.block_reset_ts > 0) {
        const left = u.block_reset_ts - Math.floor(Date.now() / 1000);
        const resetAt = new Date(u.block_reset_ts * 1000);
        const hh = String(resetAt.getHours()).padStart(2, "0");
        const mm = String(resetAt.getMinutes()).padStart(2, "0");
        const limitNote =
          u.basis === "official"
            ? t("official_data")
            : u.block_limit > 0
            ? u.basis === "manual"
              ? t("limit_manual", { v: fmtTokens(u.block_limit) })
              : t("limit_auto")
            : t("limit_nodata");
        el("block-reset").textContent = t("reset_line", {
          hh,
          mm,
          left: fmtCountdown(left),
          note: limitNote,
        });
      } else {
        el("block-reset").textContent =
          u.basis === "official" ? t("no_window_official") : t("no_window2");
      }
      if (u.basis === "official") el("acct-status").textContent = t("connected_official");
      // Weekly quota (only available in official mode)
      const hasWeek =
        u.basis === "official" && u.week_pct !== null && u.week_pct !== undefined;
      el("week-row").classList.toggle("hidden", !hasWeek);
      if (hasWeek) el("week-pct").textContent = Math.round(u.week_pct * 100) + "%";
    } else {
      el("cost-today").textContent = fmtCost(u.today_cost);
      el("cost-week").textContent = fmtCost(u.week_cost);
    }

    // Normalize trend bar heights against the 7-day maximum
    if (u.daily_tokens && u.daily_tokens.length === 7) {
      const max = Math.max(...u.daily_tokens, 1);
      for (let i = 0; i < 7; i++) {
        const cell = trend.children[i];
        cell.style.height = Math.max(2, Math.round((u.daily_tokens[i] / max) * 24)) + "px";
        cell.title = fmtTokens(u.daily_tokens[i]);
      }
    }
    el("tok-today").textContent = fmtTokens(u.today_tokens);
    el("tok-week").textContent = fmtTokens(u.week_tokens);
    const mbox = el("models");
    mbox.textContent = "";
    if (u.models.length) {
      u.models.forEach((m) => {
        const line = document.createElement("div");
        const name = document.createElement("span");
        name.className = "m-name";
        name.textContent = "· " + m.model;
        const val = document.createElement("span");
        val.textContent = fmtTokens(m.tokens);
        line.appendChild(name);
        line.appendChild(val);
        mbox.appendChild(line);
      });
    } else {
      mbox.textContent = u.has_data ? "--" : t("no_claude_data");
    }

    const sess = cur.session_count > 1 ? t("sessions_n", { n: cur.session_count }) : "";
    // hooksIncomplete = a port marker is missing from settings.json (something to install).
    // hooks_seen = at least one event has actually reached us (end-to-end proven).
    const hooksInstalled = !hooksIncomplete;
    el("hook-status").textContent = cur.hooks_seen
      ? t("hook_ok", { ev: cur.last_event || "--" }) + sess
      : hooksInstalled
      ? t("hook_installed") // installed but no event yet — likely needs a Claude Code restart
      : t("go_install");
    const acctDone = u.basis === "official" || cfgConnected;
    // Install button only when something is genuinely missing — not merely because no event
    // has arrived yet (installed + waiting for a restart shouldn't nag to reinstall)
    el("install-hooks").classList.toggle("hidden", hooksInstalled);
    el("connect-claude").classList.toggle("hidden", acctDone);
    // Once connected / working, drop the redundant status rows — show them only when action is needed
    el("acct-row").classList.toggle("hidden", acctDone);
    el("hook-row").classList.toggle("hidden", cur.hooks_seen);
    // The install-result text belongs to the button — hide it once there's nothing to install
    el("install-result").classList.toggle("hidden", hooksInstalled);
    // Nothing below the divider when both sections are fully done
    el("conn-divider").classList.toggle("hidden", acctDone && cur.hooks_seen);

    // In-app updater row: only visible when an update is actually pending / downloading.
    // "Up to date" / "checking" are NOT shown here — a manual check reports those via the dialog.
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
    } else {
      urow.classList.add("hidden");
    }
  }

  // Refresh the countdown every second
  setInterval(renderPanel, 1000);

  // ---------- Event subscription ----------
  listen("pet-update", (e) => {
    cur = e.payload;
    onStateChange(cur.state);
    renderPanel();
  });
  invoke("get_update").then((u) => {
    cur = u;
    renderPanel();
  });

  // ---------- Interaction ----------
  // The panel is taller than the base window: expand the window upward when open and restore on close,
  // so the panel's top isn't clipped by the window edge
  const BASE_H = 340;
  const WIN_W = 240;
  let resizing = false;

  // Where the pet's canvas sits inside a window of height H, per layout:
  //   up / collapsed → pet anchored to the bottom;  below → pet anchored to the top
  const CANVAS_H = 184, PAD_B = 4;
  const canvasTopIn = (H, below) => (below ? 0 : H - CANVAS_H - PAD_B);

  // Resize/reposition the window to `targetH`, keeping the pet's canvas at a fixed screen Y so the
  // pet never jumps. `below` = panel-below-pet layout (window grows downward instead of upward).
  async function setWindowLayout(anchorScreenTop, targetH, below) {
    const win = window.__TAURI__.window.getCurrentWindow();
    const { LogicalSize, LogicalPosition } = window.__TAURI__.dpi;
    const factor = await win.scaleFactor();
    const x = (await win.outerPosition()).toLogical(factor).x;
    // Position using the estimated canvas offset first (approximately right — minimal flicker)…
    const estTop = Math.round(anchorScreenTop - canvasTopIn(targetH, below));
    await win.setPosition(new LogicalPosition(x, estTop));
    await win.setSize(new LogicalSize(WIN_W, targetH));
    // …then correct against the canvas's real position so it lands exactly on the anchor (no drift)
    await new Promise((r) => setTimeout(r, 32));
    const corrected = Math.round(anchorScreenTop - canvas.getBoundingClientRect().top);
    if (Math.abs(corrected - estTop) > 1) {
      await win.setPosition(new LogicalPosition(x, corrected));
    }
  }

  // Lay out the (already-visible) panel: expand upward if there's room above the pet, otherwise
  // downward (panel below the pet) so it never clips off the top of the screen.
  async function fitPanel() {
    const win = window.__TAURI__.window.getCurrentWindow();
    const factor = await win.scaleFactor();
    const winPos = (await win.outerPosition()).toLogical(factor);
    const anchorScreenTop = winPos.y + canvas.getBoundingClientRect().top;
    // The panel's own height is the same in either layout — measure it once so we can pick
    // up-vs-down WITHOUT first laying it out above the pet (which caused a visible flash/jump)
    const panelH = panel.getBoundingClientRect().height;
    // Top edge of the screen the pet is on. currentMonitor() reports the monitor the pet sits on
    // (correct on a stacked multi-monitor layout, where the screen ABOVE must not count as "room");
    // fall back to the monitor whose bounds contain the pet.
    let monTop = 0;
    try {
      const cm = await window.__TAURI__.window.currentMonitor();
      if (cm) {
        monTop = cm.position.toLogical(cm.scaleFactor).y;
      } else {
        const mons = await window.__TAURI__.window.availableMonitors();
        for (const m of mons) {
          const p = m.position.toLogical(m.scaleFactor), s = m.size.toLogical(m.scaleFactor);
          if (anchorScreenTop >= p.y && anchorScreenTop < p.y + s.height) {
            monTop = p.y;
            break;
          }
        }
      }
    } catch (e) {}
    // Up layout overlaps the top 60px of the canvas; down overlaps the bottom 14px
    const targetUp = Math.max(Math.round(panelH + CANVAS_H - 60 + 12), BASE_H);
    // If expanding upward would push the window top above this screen's top (+ menu bar), go down
    const below = anchorScreenTop - canvasTopIn(targetUp, false) < monTop + 30;
    document.body.classList.toggle("below", below);
    const targetH = below ? Math.max(Math.round(panelH + CANVAS_H - 14 + 12), BASE_H) : targetUp;
    await setWindowLayout(anchorScreenTop, targetH, below);
  }

  async function togglePanel() {
    if (resizing) return;
    resizing = true;
    try {
      if (panel.classList.contains("hidden")) {
        // Keep the panel invisible while we measure and choose up-vs-down + reposition the window,
        // so it never flashes above then jumps below; then fade it in at the final spot.
        panel.style.opacity = "0";
        panel.classList.remove("hidden");
        // The user wants to see data: ask the backend to refresh official usage once (it's debounced)
        invoke("panel_opened").catch(() => {});
        // Keep the whole window interactive while open so panel hover is reliable at any height
        invoke("set_panel_open", { open: true }).catch(() => {});
        await fitPanel();
        panel.style.opacity = "";
      } else {
        const win = window.__TAURI__.window.getCurrentWindow();
        const factor = await win.scaleFactor();
        const winPos = (await win.outerPosition()).toLogical(factor);
        const anchorScreenTop = winPos.y + canvas.getBoundingClientRect().top;
        panel.classList.add("hidden");
        document.body.classList.remove("below");
        await setWindowLayout(anchorScreenTop, BASE_H, false);
        invoke("set_panel_open", { open: false }).catch(() => {});
      }
    } finally {
      resizing = false;
    }
  }

  // Panel visibility: click the pet to open. It stays open while the OS cursor is anywhere over
  // the window (pet or panel) and collapses once the cursor has left for a moment. The decision is
  // made in Rust from the authoritative cursor position (reliable for this transparent, click-through
  // overlay, where webview :hover/mouseleave events are not) — the backend emits "collapse-panel".
  function collapsePanel() {
    if (panel.classList.contains("hidden")) return;
    // Don't collapse mid-edit (e.g. typing the boss key / a number); keep tracking and retry
    if (panel.contains(document.activeElement) && document.activeElement !== document.body) {
      invoke("set_panel_open", { open: true }).catch(() => {});
      return;
    }
    panel.style.opacity = "0";
    setTimeout(() => {
      panel.style.opacity = "";
      if (!panel.classList.contains("hidden")) togglePanel();
    }, 220);
  }
  listen("collapse-panel", collapsePanel);

  // Hold the pet to drag the window; releasing in place counts as a click (toggle panel).
  // Once movement passes the threshold, hand off to the OS native drag, after which mouseup won't return to the page.
  // During native dragging the page receives no mouse events, so the window Moved event keeps the dragging flag alive;
  // treat it as released 350ms after movement stops
  let downPos = null;
  let dragEndTimer = null;
  function armDragEnd() {
    clearTimeout(dragEndTimer);
    dragEndTimer = setTimeout(() => {
      dragging = false;
      if (panel.classList.contains("hidden")) clampToScreen();
    }, 350);
  }
  // Keep the window fully on its current screen so the panel can't be clipped at the left/right
  // edge (and the pet stays visible top/bottom). Left/right multi-monitor still works — this
  // clamps to whichever monitor the pet was dragged onto; it never limits panel up/down expansion.
  async function clampToScreen() {
    const win = window.__TAURI__.window.getCurrentWindow();
    const { LogicalPosition } = window.__TAURI__.dpi;
    const factor = await win.scaleFactor();
    const pos = (await win.outerPosition()).toLogical(factor);
    const size = (await win.outerSize()).toLogical(factor);
    let mon;
    try {
      mon = await window.__TAURI__.window.currentMonitor();
    } catch (e) {}
    if (!mon) return;
    const mp = mon.position.toLogical(mon.scaleFactor);
    const ms = mon.size.toLogical(mon.scaleFactor);
    const petTop = size.height - CANVAS_H; // empty (bubble) space above the pet within the window
    const x = Math.max(mp.x, Math.min(pos.x, mp.x + ms.width - size.width));
    const y = Math.max(mp.y - petTop, Math.min(pos.y, mp.y + ms.height - size.height));
    if (Math.round(x) !== Math.round(pos.x) || Math.round(y) !== Math.round(pos.y)) {
      await win.setPosition(new LogicalPosition(Math.round(x), Math.round(y)));
    }
  }
  window.__TAURI__.window.getCurrentWindow().onMoved(() => {
    if (dragging) armDragEnd();
  });
  canvas.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    downPos = { x: e.screenX, y: e.screenY, canvasY: e.offsetY };
  });
  window.addEventListener("mousemove", (e) => {
    if (!downPos) return;
    if (Math.abs(e.screenX - downPos.x) + Math.abs(e.screenY - downPos.y) > 4) {
      downPos = null;
      dragging = true;
      armDragEnd();
      window.__TAURI__.window.getCurrentWindow().startDragging();
    }
  });
  window.addEventListener("mouseup", () => {
    // Clicking the pet always just toggles the usage panel
    if (downPos) togglePanel();
    downPos = null;
  });

  // Right-click the pet to hide it (bring it back with the boss key Cmd/Ctrl+Shift+B or the tray menu).
  // Also disable the webview's default context menu so no ugly system menu pops up over the transparent pet
  document.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("contextmenu", () => {
    window.__TAURI__.window.getCurrentWindow().hide();
  });

  // Head pat: mouse hovering over the pet (when not held down)
  canvas.addEventListener("mousemove", (e) => {
    const gx = e.offsetX / 4, gy = e.offsetY / 4; // Grid coordinates (pixel scale factor 4)
    pat = !downPos && gx > 8 && gx < 42 && gy > 12 && gy < 36;
  });
  canvas.addEventListener("mouseleave", () => {
    pat = false;
  });

  el("mode-select").addEventListener("change", (e) => {
    invoke("set_mode", { mode: e.target.value }).catch((err) => {
      el("acct-result").textContent = String(err);
    });
  });

  // ---------- Config (settings now live in the tray Settings window) ----------
  let cfgConnected = false;
  let soundOn = false;
  let hooksIncomplete = false;
  let currentSkin = "classic";
  function applyConfig(c) {
    soundOn = c.sound;
    cfgConnected = c.connected;
    hooksIncomplete = !!c.hooks_incomplete;
    currentSkin = c.skin || "classic";
    if (hooksIncomplete) el("install-hooks").textContent = t("update_hooks");
    if (c.connected) el("acct-status").textContent = t("connected");
  }
  invoke("get_config").then((c) => {
    applyConfig(c);
    // Non-default skin: dynamically load it to override PetRenderer
    if (currentSkin !== "classic") {
      const s = document.createElement("script");
      s.src = "skins/" + encodeURIComponent(currentSkin) + ".js";
      document.body.appendChild(s);
    }
  });
  // The Settings window persists changes and emits "config-changed" — re-sync here (reload on skin change)
  listen("config-changed", (e) => {
    const newSkin = e && e.payload && e.payload.skin;
    if (newSkin && newSkin !== currentSkin) return location.reload();
    invoke("get_config").then(applyConfig).catch(() => {});
  });

  // ---------- 8-bit sound effects (WebAudio, no audio files) ----------
  let audioCtx = null;
  function beep(seq) {
    if (!soundOn) return;
    try {
      audioCtx = audioCtx || new AudioContext();
      let at = audioCtx.currentTime;
      for (const [freq, dur] of seq) {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "square";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.035, at);
        gain.gain.exponentialRampToValueAtTime(0.001, at + dur);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(at);
        osc.stop(at + dur);
        at += dur;
      }
    } catch (_) {}
  }
  let prevState = "idle";
  let prevOops = false;
  function onStateChange(s) {
    if (cur.oops && !prevOops) beep([[196, 0.1], [147, 0.16]]); // Error: low thud
    prevOops = !!cur.oops;
    if (s === prevState) return;
    if (s === "done") beep([[660, 0.09], [880, 0.14]]);       // Done: ding-dong
    else if (s === "attention") beep([[520, 0.07], [520, 0.07]]); // Waiting for you: tap-tap
    prevState = s;
  }

  el("connect-claude").addEventListener("click", () => {
    el("acct-status").textContent = t("authorizing");
    el("acct-result").textContent = "";
    invoke("connect_claude")
      .then((msg) => {
        el("acct-status").textContent = t("connected");
        el("acct-result").textContent = msg;
      })
      .catch((err) => {
        // Keep connect errors in the account area — don't leak into the hook area below.
        el("acct-status").textContent = t("not_connected");
        el("acct-result").textContent = t("connect_fail", { e: err });
      });
  });

  el("install-hooks").addEventListener("click", () => {
    el("install-result").textContent = t("installing");
    invoke("install_hooks")
      .then((msg) => {
        el("install-result").textContent = msg;
        hooksIncomplete = false;
      })
      .catch((err) => (el("install-result").textContent = t("fail", { e: err })));
  });

  el("update-row").addEventListener("click", () => {
    const up = cur.update || {};
    if (up.status === "error") {
      invoke("check_update").catch(() => {}); // retry a check
      return;
    }
    if (!up.available) return;
    invoke("open_update_window").catch(() => {});
  });
})();
