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
    boss_key: ["老板键", "Boss key"],
    boss_key_title: ["点一下再按下想设的快捷键;叫出/藏起宠物", "Click, then press a shortcut; shows/hides the pet"],
    skin: ["皮肤", "Skin"],
    skin_classic: ["墩墩(默认)", "Dundun (default)"],
    skin_bean: ["豆豆", "Bean"],
    skin_tabby: ["橘猫·摸鱼", "Tabby"],
    skin_tribute: ["私藏款(需本地文件)", "Tribute (local file)"],
    hook_events: ["hook 事件", "Hook events"],
    not_received: ["还没收到", "Nothing yet"],
    install_hooks: ["安装 Claude Code hooks", "Install Claude Code hooks"],
    listen_hint: ["监听 127.0.0.1:8737 · 点宠物收起面板", "Listening on 127.0.0.1:8737 · click pet to collapse"],
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
    update_hooks: ["更新 Claude Code hooks(有新事件)", "Update Claude Code hooks (new events)"],
    connect_fail: ["连接失败:{e}", "Connect failed: {e}"],
    installing: ["安装中…", "Installing…"],
    fail: ["失败:{e}", "Failed: {e}"],
    boss_updated: ["老板键已更新:{k}", "Boss key updated: {k}"],
    boss_fail: ["老板键设置失败:{e}", "Failed to set boss key: {e}"],
    press_shortcut: ["按下快捷键…", "Press a shortcut…"],
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
    el("models").textContent = u.models.length
      ? u.models.map((m) => `${m.model} ${fmtTokens(m.tokens)}`).join(" · ")
      : u.has_data
      ? "--"
      : t("no_claude_data");

    const sess = cur.session_count > 1 ? t("sessions_n", { n: cur.session_count }) : "";
    el("hook-status").textContent = cur.hooks_seen
      ? t("hook_ok", { ev: cur.last_event || "--" }) + sess
      : t("go_install");
    // No button needed when things already work; but re-surface it when new events are missing
    el("install-hooks").classList.toggle("hidden", cur.hooks_seen && !hooksIncomplete);
    el("connect-claude").classList.toggle("hidden", u.basis === "official" || cfgConnected);
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

  // Resize the window to the target height while keeping the bottom edge (under the pet) fixed.
  // Measure from the current actual height rather than assuming BASE_H, to avoid state drift
  async function setWindowHeight(targetH) {
    const win = window.__TAURI__.window.getCurrentWindow();
    const { LogicalSize, LogicalPosition } = window.__TAURI__.dpi;
    const factor = await win.scaleFactor();
    const size = (await win.outerSize()).toLogical(factor);
    if (Math.abs(size.height - targetH) < 1) return;
    const pos = (await win.outerPosition()).toLogical(factor);
    await win.setPosition(new LogicalPosition(pos.x, pos.y + (size.height - targetH)));
    await win.setSize(new LogicalSize(WIN_W, targetH));
  }

  async function togglePanel() {
    if (resizing) return;
    resizing = true;
    try {
      if (panel.classList.contains("hidden")) {
        panel.classList.remove("hidden");
        // The user wants to see data: ask the backend to refresh official usage once (it's debounced)
        invoke("panel_opened").catch(() => {});
        // Actual layout height from panel top to canvas bottom (auto-includes the negative-margin overlap)
        const need = Math.ceil(
          canvas.getBoundingClientRect().bottom - panel.getBoundingClientRect().top
        ) + 12;
        await setWindowHeight(Math.max(need, BASE_H));
        armAutoHide(); // If the mouse never enters after opening, still collapse on schedule
      } else {
        await setWindowHeight(BASE_H);
        panel.classList.add("hidden");
      }
    } finally {
      resizing = false;
    }
  }

  // Panel auto fade-out: 1 second after the mouse leaves the panel, fade and collapse without another click
  let hideTimer = null;
  function armAutoHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (panel.classList.contains("hidden")) return;
      if (panel.matches(":hover")) {
        armAutoHide();
        return;
      }
      // Don't interrupt while a dropdown/input is in use
      if (panel.contains(document.activeElement) && document.activeElement !== document.body) {
        armAutoHide();
        return;
      }
      panel.style.opacity = "0";
      setTimeout(() => {
        panel.style.opacity = "";
        if (!panel.classList.contains("hidden")) togglePanel();
      }, 360);
    }, 1000);
  }
  panel.addEventListener("mouseenter", () => {
    clearTimeout(hideTimer);
    panel.style.opacity = "";
  });
  panel.addEventListener("mouseleave", armAutoHide);

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
    }, 350);
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
    if (downPos) {
      // With a bubble, clicking the top half (where the bubble is) focuses the terminal; clicking the pet toggles the panel
      if (cur.bubble && downPos.canvasY !== undefined && downPos.canvasY < 108) {
        invoke("focus_terminal").catch((err) => {
          el("install-result").textContent = String(err);
        });
      } else {
        togglePanel();
      }
    }
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
      el("install-result").textContent = String(err);
    });
  });

  // ---------- Settings ----------
  let cfgConnected = false;
  let soundOn = false;
  let hooksIncomplete = false;
  let bossKeyAccel = "CommandOrControl+Shift+B";
  invoke("get_config").then((c) => {
    el("cfg-notify").checked = c.notify;
    el("cfg-minsecs").value = c.notify_min_secs;
    el("cfg-sound").checked = c.sound;
    soundOn = c.sound;
    cfgConnected = c.connected;
    hooksIncomplete = !!c.hooks_incomplete;
    if (c.boss_key) {
      bossKeyAccel = c.boss_key;
      el("cfg-bosskey").value = prettyAccel(c.boss_key);
    }
    el("cfg-skin").value = c.skin || "classic";
    // Non-default skin: dynamically load it to override PetRenderer
    if (c.skin && c.skin !== "classic") {
      const s = document.createElement("script");
      s.src = "skins/" + encodeURIComponent(c.skin) + ".js";
      document.body.appendChild(s);
    }
    if (hooksIncomplete) el("install-hooks").textContent = t("update_hooks");
    if (c.connected) el("acct-status").textContent = t("connected");
  });
  function saveCfg() {
    soundOn = el("cfg-sound").checked;
    return invoke("set_config", {
      notify: el("cfg-notify").checked,
      notifyMinSecs: Math.max(0, parseInt(el("cfg-minsecs").value, 10) || 0),
      sound: soundOn,
      skin: el("cfg-skin").value,
    }).catch((err) => (el("install-result").textContent = String(err)));
  }
  el("cfg-notify").addEventListener("change", saveCfg);
  el("cfg-minsecs").addEventListener("change", saveCfg);
  el("cfg-sound").addEventListener("change", saveCfg);
  el("cfg-skin").addEventListener("change", () => {
    // Reload the page after switching skins so the new one takes effect
    Promise.resolve(saveCfg()).then(() => location.reload());
  });

  // ---------- Boss key recording ----------
  const IS_MAC = navigator.userAgent.includes("Mac");
  // Render an accelerator string nicely: symbols on mac (⌘⇧B), text elsewhere (Ctrl+Shift+B)
  function prettyAccel(a) {
    const parts = a.split("+").map((t) => {
      const u = t.trim().toLowerCase();
      if (["commandorcontrol", "cmdorctrl"].includes(u)) return IS_MAC ? "⌘" : "Ctrl";
      if (["super", "meta", "cmd", "command"].includes(u)) return IS_MAC ? "⌘" : "Win";
      if (["control", "ctrl"].includes(u)) return IS_MAC ? "⌃" : "Ctrl";
      if (["alt", "option"].includes(u)) return IS_MAC ? "⌥" : "Alt";
      if (u === "shift") return IS_MAC ? "⇧" : "Shift";
      return t.trim().toUpperCase();
    });
    return IS_MAC ? parts.join("") : parts.join("+");
  }
  // Build an accelerator string from a keyboard event (needs at least one modifier + one main key)
  function accelFromEvent(e) {
    const mods = [];
    if (e.metaKey) mods.push("Super"); // Cmd on mac
    if (e.ctrlKey) mods.push("Control");
    if (e.altKey) mods.push("Alt");
    if (e.shiftKey) mods.push("Shift");
    let key = null;
    if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
    else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5);
    else if (/^F[0-9]{1,2}$/.test(e.code)) key = e.code;
    else if (e.code === "Space") key = "Space";
    if (!key || mods.length === 0) return null;
    return mods.concat(key).join("+");
  }

  const bossInput = el("cfg-bosskey");
  let recording = false;
  bossInput.addEventListener("focus", () => {
    recording = true;
    bossInput.classList.add("recording");
    bossInput.value = t("press_shortcut");
  });
  bossInput.addEventListener("blur", () => {
    if (recording) {
      recording = false;
      bossInput.classList.remove("recording");
      bossInput.value = prettyAccel(bossKeyAccel);
    }
  });
  bossInput.addEventListener("keydown", (e) => {
    if (!recording) return;
    e.preventDefault();
    if (e.key === "Escape") {
      bossInput.blur();
      return;
    }
    const accel = accelFromEvent(e);
    if (!accel) return; // Only modifiers pressed, keep waiting for the main key
    invoke("set_boss_key", { accel })
      .then(() => {
        bossKeyAccel = accel;
        el("install-result").textContent = t("boss_updated", { k: prettyAccel(accel) });
      })
      .catch((err) => {
        el("install-result").textContent = t("boss_fail", { e: err });
      })
      .finally(() => {
        recording = false;
        bossInput.classList.remove("recording");
        bossInput.value = prettyAccel(bossKeyAccel);
        bossInput.blur();
      });
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
})();
