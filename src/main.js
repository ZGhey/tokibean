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
    // A quota window's length is rendered FROM the agent's own data — Claude's block is 5 hours,
    // but Codex's free plan reports a 30-day window. Never hard-code "5h".
    win_hours: ["{n} 小时窗口", "{n}-hour window"],
    win_days: ["{n} 天窗口", "{n}-day window"],
    win_week: ["周窗口", "Weekly window"],
    win_mins: ["{n} 分钟窗口", "{n}-minute window"],
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
    limit_nodata: ["还没有足够数据估算限额", "not enough data to estimate the limit"],
    usage_need_connect: ["连接 Claude 账号查看官方用量", "Connect Claude account for official usage"],
    reconnect_needed: ["连接已失效,请重新连接", "Connection expired — reconnect"],
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
    hook_installed: ["已安装 · 等待首个事件", "Installed · waiting for first event"],
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
    sessions_label: ["会话", "Sessions"],
    st_working: ["工作中", "working"],
    st_waiting: ["等你输入", "waiting"],
    st_done: ["完工", "done"],
    st_idle: ["空闲", "idle"],
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
  // Design (unscaled) canvas size — the renderer draws in this fixed 200×184 logical space.
  const CANVAS_W0 = canvas.width, CANVAS_H0 = canvas.height; // 200 × 184 (HTML attrs)
  const dpr = window.devicePixelRatio || 1;
  // Pet size steps (small / normal / large / extra large). Every step keeps the art-pixel size
  // (S=4 × scale × dpr) an integer, so the pixel art stays crisp at any of them.
  // Keep in sync with Config::scale() in src-tauri/src/config.rs.
  const SCALES = [0.5, 0.75, 1, 1.25];
  const DEFAULT_SCALE = 0.75;
  // Pet scale multiplier (from config; user-adjustable). Only the pet canvas scales, not the panel.
  let petScale = DEFAULT_SCALE;
  // Size the canvas for the given pet scale. The CSS box and the renderer's logical space stay at the
  // DESIGN size (200×184), so pet.js and every skin are untouched — they always draw into 200×184 and
  // read canvas.clientWidth === 200. Enlargement is purely visual, via a CSS transform. Sharpness: the
  // backing buffer is rendered at dpr×scale resolution, so its pixel density matches the transformed
  // on-screen size 1:1 (no resampling) — crisp pixel art at any scale, integer or not.
  function applyCanvasScale(scale) {
    petScale = scale;
    canvas.style.width = CANVAS_W0 + "px";
    canvas.style.height = CANVAS_H0 + "px";
    canvas.width = Math.round(CANVAS_W0 * dpr * scale);
    canvas.height = Math.round(CANVAS_H0 * dpr * scale);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr * scale, dpr * scale);
    // Grow upward from the feet so the pet stays planted on the ground as it scales.
    canvas.style.transformOrigin = "bottom center";
    canvas.style.transform = scale === 1 ? "" : "scale(" + scale + ")";
  }
  applyCanvasScale(DEFAULT_SCALE);
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
  let gazeX = null, gazeY = null;          // cursor position over the canvas (logical px), for eyes-follow
  let lastMX = 0, lastMY = 0, tickleUntil = 0; // fast-wiggle (tickle) detection

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
      resetSecs: soonestReset(),
      gazeX,
      gazeY,
      tickle: performance.now() < tickleUntil,
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
  // Short elapsed for the session list: 45s / 3m / 1h2m
  function fmtDur(sec) {
    if (sec < 60) return sec + "s";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return h > 0 ? `${h}h${m}m` : `${m}m`;
  }
  const SESS_ICON = { working: "▶", attention: "‖", done: "✓", idle: "·" };
  const SESS_LABEL = { working: "st_working", attention: "st_waiting", done: "st_done", idle: "st_idle" };

  // Seconds until the pet could work again: the EARLIEST reset among the agents that have a live
  // window. The pet only sleeps once every agent is exhausted (ADR-0005), so the first window to
  // roll over is the one that wakes it.
  function soonestReset() {
    const now = Math.floor(Date.now() / 1000);
    const resets = ((cur.usage && cur.usage.quotas) || [])
      .filter((q) => q.reset_ts > now)
      .map((q) => q.reset_ts - now);
    return resets.length ? Math.min(...resets) : null;
  }

  // ---------- Panel rendering ----------
  const el = (id) => document.getElementById(id);

  // 7-day trend bars
  const trend = el("trend");
  for (let i = 0; i < 7; i++) trend.appendChild(document.createElement("span"));
  trend.lastChild.className = "today";

  const AGENT_NAME = { claude: "Claude", codex: "Codex" };

  // A quota window's own length, spelled out. Read FROM the data — Claude's block is 5h, but Codex's
  // free plan reports 43200 minutes (thirty days). Hard-coding "5h" is wrong for anyone but Claude.
  function windowLabel(mins) {
    if (!mins) return "";
    if (mins % (24 * 60) === 0) {
      const d = mins / (24 * 60);
      return d === 7 ? t("win_week") : t("win_days", { n: d });
    }
    if (mins % 60 === 0) return t("win_hours", { n: mins / 60 });
    return t("win_mins", { n: mins });
  }

  /// One quota card: title, percentage, 10-cell pixel bar, reset line.
  function buildQuotaCard(q) {
    const card = document.createElement("div");
    card.className = "quota-card";

    const head = document.createElement("div");
    head.className = "label-row";
    const title = document.createElement("span");
    const win = windowLabel(q.window_minutes);
    title.textContent = (AGENT_NAME[q.agent] || q.agent) + (win ? " · " + win : "");
    const pct = document.createElement("span");
    pct.className = "num";
    pct.textContent = q.pct_valid ? Math.round(q.pct * 100) + "%" : "--%";
    head.appendChild(title);
    head.appendChild(pct);

    const bar = document.createElement("div");
    bar.className = "pixel-bar";
    bar.setAttribute("aria-label", t("usage_aria"));
    const lit = q.pct_valid ? Math.round(Math.min(q.pct, 1) * 10) : 0;
    for (let i = 0; i < 10; i++) {
      const c = document.createElement("span");
      if (i < lit) {
        c.className = "on";
        if (q.pct >= 1.0) c.classList.add("full");
        else if (q.pct >= 0.8) c.classList.add("warn");
      }
      bar.appendChild(c);
    }

    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = resetLine(q);

    card.appendChild(head);
    card.appendChild(bar);
    card.appendChild(hint);

    // Claude's official mode also exposes a weekly quota
    if (q.week_pct !== null && q.week_pct !== undefined) {
      const week = document.createElement("div");
      week.className = "label-row";
      const wl = document.createElement("span");
      wl.textContent = t("week_quota");
      const wv = document.createElement("span");
      wv.className = "num";
      wv.textContent = Math.round(q.week_pct * 100) + "%";
      week.appendChild(wl);
      week.appendChild(wv);
      card.appendChild(week);
    }
    return card;
  }

  function resetLine(q) {
    if (q.reset_ts > 0) {
      const left = q.reset_ts - Math.floor(Date.now() / 1000);
      const at = new Date(q.reset_ts * 1000);
      const hh = String(at.getHours()).padStart(2, "0");
      const mm = String(at.getMinutes()).padStart(2, "0");
      const note =
        q.basis === "official"
          ? t("official_data")
          : t("limit_manual", { v: fmtTokens(q.limit_tokens) });
      return t("reset_line", { hh, mm, left: fmtCountdown(left), note });
    }
    if (q.basis === "official") return t("no_window_official");
    return q.pct_valid ? t("no_window2") : t("usage_need_connect");
  }

  function renderQuotas(quotas) {
    const box = el("sub-block");
    box.textContent = "";
    for (const q of quotas || []) box.appendChild(buildQuotaCard(q));
  }

  // Per-session list: one row per parallel session — its state icon, what it's running
  // (the tool if mid-call, else the state label), and how long it's been in that state.
  function renderSessions() {
    const list = cur.sessions || [];
    const block = el("sessions-block");
    if ((cur.session_count || 0) <= 1 || !list.length) {
      block.classList.add("hidden");
      return;
    }
    block.classList.remove("hidden");
    el("sessions-count").textContent = "×" + list.length;
    const box = el("session-list");
    box.textContent = "";
    for (const s of list) {
      const row = document.createElement("div");
      row.className = "s-row s-" + s.state;
      const ic = document.createElement("span");
      ic.className = "s-ic";
      ic.textContent = SESS_ICON[s.state] || "·";
      const label = document.createElement("span");
      label.className = "s-label";
      label.textContent = s.cwd || t(SESS_LABEL[s.state] || "st_idle");
      const time = document.createElement("span");
      time.className = "s-time";
      time.textContent = fmtDur(s.secs || 0);
      row.appendChild(ic);
      row.appendChild(label);
      row.appendChild(time);
      box.appendChild(row);
    }
  }

  function renderPanel() {
    renderSessions();
    const u = cur.usage;
    if (!u) return;

    const isSub = u.mode === "subscription";
    el("mode-badge").textContent = isSub ? t("badge_sub") : "API";
    el("sub-block").classList.toggle("hidden", !isSub);
    el("api-block").classList.toggle("hidden", isSub);

    // Whether a percentage is trustworthy is decided by the backend (projection::usage_flags) and
    // stamped onto each quota as pct_valid, so that rule isn't duplicated across the IPC seam.
    const claude = (u.quotas || []).find((q) => q.agent === "claude");
    if (isSub) {
      renderQuotas(u.quotas);
      if (claude && claude.basis === "official") {
        el("acct-status").textContent = t("connected_official");
      }
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
    // A dead refresh token (reconnect) counts as NOT connected — re-surface the connect button/row.
    const official = claude && claude.basis === "official";
    const acctDone = (official || cfgConnected) && !u.reconnect;
    if (u.reconnect) el("acct-status").textContent = t("reconnect_needed");
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
  // The panel is taller than the pet's canvas. Windows and macOS PRE-ALLOCATE the full height while
  // collapsed, so opening the panel never moves or resizes the window — it only reveals the
  // already-there (hidden) panel. A resize is what made the pet jump: growing the window upward moves
  // its top edge by (fullH - collapsedH) while the webview still paints the OLD layout for one frame,
  // so the pet flashes that far up and snaps back (Windows: DWM re-composites the old frame; macOS: the
  // WKWebView surface lags the window). Doing the move+resize atomically does NOT help — the stale
  // frame is the webview's, not the window's. No resize ⇒ no stale frame. (Linux still resizes.)
  const PREALLOC = /Windows|Mac OS X|Macintosh/.test(navigator.userAgent);
  // Windows additionally needs a MANUAL drag (see below); macOS uses the native one.
  const IS_WIN_DRAG = navigator.userAgent.includes("Windows");
  let resizing = false;

  // All window geometry scales with the pet (`petScale`). Only the pet canvas grows — the panel is a
  // fixed-size DOM, so FULL_H adds a fixed panel allowance (412) on top of the scaled canvas rather
  // than scaling wholesale. These are `let` and rebuilt by recomputeGeom() whenever the scale changes.
  // MUST mirror the Rust geometry in src-tauri/src/main.rs (startup sizing + click-through strip).
  //   BASE_H     Linux collapsed window height (bubble headroom scales too)
  //   WIN_W      window width (≥240; a scaled pet wider than 200 widens the window)
  //   CANVAS_H   pet canvas height inside the window;  PAD_B  bottom padding
  //   PET_CANVAS_TOP  empty space above the pet drawing inside the canvas (dome top ≈ 64px down)
  //   FULL_H     pre-allocated collapsed height on Windows/macOS (never resized after startup — that's
  //              what kills the stale-frame jump on open); = scaled canvas + fixed panel room
  let BASE_H, WIN_W, CANVAS_H, PAD_B, PET_CANVAS_TOP, FULL_H, COLLAPSED_H;
  function recomputeGeom(scale) {
    BASE_H = Math.round(340 * scale);
    WIN_W = Math.max(240, Math.round(200 * scale + 40));
    CANVAS_H = Math.round(184 * scale); // visual pet height (canvas is CSS 184, transform-scaled)
    PAD_B = 4;                          // body padding-bottom is a fixed 4px CSS gap, not scaled
    PET_CANVAS_TOP = Math.round(64 * scale);
    FULL_H = Math.round(CANVAS_H + PAD_B + 412);
    COLLAPSED_H = PREALLOC ? FULL_H : BASE_H;
  }
  recomputeGeom(DEFAULT_SCALE);
  // Where the pet's canvas sits inside a window of height H, per layout:
  //   up → pet anchored to the bottom;  below → pet anchored to the top
  const canvasTopIn = (H, below) => (below ? 0 : H - CANVAS_H - PAD_B);
  // Pre-allocated platforms: which layout the full-height window is currently in (false = up-panel, pet
  // at the window bottom; true = below-panel, pet at the window top). Startup is up-layout (main.rs).
  let curBelow = false;
  if (PREALLOC) document.body.classList.add("prealloc");

  // Pre-allocated platforms: persist the pet's on-screen anchor (its canvas-top). Layout-independent,
  // so it survives an up↔below flip and a version upgrade; the backend rebuilds the window position
  // from it on launch (the plain saved window top-left is meaningless once the layout can flip).
  async function savePetAnchor() {
    if (!PREALLOC) return;
    try {
      const win = window.__TAURI__.window.getCurrentWindow();
      const factor = await win.scaleFactor();
      const winPos = (await win.outerPosition()).toLogical(factor);
      const anchorScreenTop = winPos.y + canvas.getBoundingClientRect().top;
      await invoke("set_pet_pos", {
        x: Math.round(winPos.x * factor),
        y: Math.round(anchorScreenTop * factor),
      }).catch(() => {});
    } catch (e) {}
  }

  // Put the pre-allocated full-height window into the given up/below layout with the pet pinned at
  // `anchorScreenTop`. If the layout is unchanged this moves nothing — opening just reveals the panel
  // (jump-free). A flip (rare — only when the pet has crossed the screen-top threshold) is a pure move
  // + flex reflow; hide the pet across it so it can't flash to the wrong offset.
  async function applyPreallocLayout(below, anchorScreenTop, x) {
    if (below === curBelow) {
      invoke("set_pet_at_top", { v: below }).catch(() => {});
      return; // nothing moves or resizes
    }
    const win = window.__TAURI__.window.getCurrentWindow();
    const { LogicalPosition } = window.__TAURI__.dpi;
    const newTop = Math.round(anchorScreenTop - canvasTopIn(FULL_H, below));
    const raf2 = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    canvas.style.visibility = "hidden";
    await raf2(); // paint the hide to the surface before we move + reflow
    document.body.classList.toggle("below", below);
    await win.setPosition(new LogicalPosition(Math.round(x), newTop));
    await raf2(); // let the pet reflow to the new edge before revealing it
    canvas.style.visibility = "";
    curBelow = below;
    invoke("set_pet_at_top", { v: below }).catch(() => {});
    savePetAnchor();
  }

  // Resize/reposition the window to `targetH`, keeping the pet's canvas at a fixed screen Y so the pet
  // never jumps. macOS only — Windows pre-allocates and never resizes. `below` = panel-below-pet.
  // Move + resize MUST be one atomic native call (`set_window_rect`): done as two separate JS awaits,
  // the OS composites the moved-but-not-yet-resized window and the pet flashes (targetH - oldH) px up
  // and back on every panel open.
  async function setWindowLayout(anchorScreenTop, targetH, below) {
    const win = window.__TAURI__.window.getCurrentWindow();
    const { LogicalPosition } = window.__TAURI__.dpi;
    const factor = await win.scaleFactor();
    const x = (await win.outerPosition()).toLogical(factor).x;
    const estTop = Math.round(anchorScreenTop - canvasTopIn(targetH, below));
    await invoke("set_window_rect", { x, y: estTop, w: WIN_W, h: targetH });
    // The native call is dispatched to the UI thread — wait until the new geometry has landed (and the
    // page has reflowed) before measuring, instead of assuming a fixed delay.
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 16));
      const h = (await win.outerSize()).toLogical(factor).height;
      if (Math.abs(h - targetH) <= 1) break;
    }
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
    const canvasTopNow = canvas.getBoundingClientRect().top;
    const anchorScreenTop = winPos.y + canvasTopNow;
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
    if (PREALLOC) {
      // Pre-allocated: don't resize. Just make sure the full-height window is in the right layout,
      // pinning the pet — a no-op reveal if it already is, a flip only if the pet crossed the edge.
      await applyPreallocLayout(below, anchorScreenTop, winPos.x);
      return;
    }
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
      } else if (PREALLOC) {
        // Collapse = just hide the panel. The window stays full-height and in its current up/below
        // layout, so the pet doesn't move and nothing resizes → no jump, no flicker.
        panel.classList.add("hidden");
        invoke("set_panel_open", { open: false }).catch(() => {});
      } else {
        const win = window.__TAURI__.window.getCurrentWindow();
        const factor = await win.scaleFactor();
        const winPos = (await win.outerPosition()).toLogical(factor);
        const anchorScreenTop = winPos.y + canvas.getBoundingClientRect().top;
        panel.classList.add("hidden");
        document.body.classList.remove("below");
        await setWindowLayout(anchorScreenTop, COLLAPSED_H, false);
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
  // macOS uses the OS native drag (startDragging). Windows uses a MANUAL drag (follow the cursor with
  // setPosition) because a native caption-drag there can't push the window top above the screen top
  // (y=0), which would trap the pet ~200px down — the manual drag reaches negative y, so the pet can be
  // placed freely anywhere, including flush to the top. (IS_WIN_DRAG is defined up top.)
  let downPos = null;
  let dragEndTimer = null;
  function armDragEnd() {
    clearTimeout(dragEndTimer);
    dragEndTimer = setTimeout(() => {
      dragging = false;
      if (panel.classList.contains("hidden")) clampToScreen().then(savePetAnchor);
      else savePetAnchor();
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
    const x = Math.max(mp.x, Math.min(pos.x, mp.x + ms.width - size.width));
    let y;
    if (PREALLOC) {
      // The pre-allocated full-height window is mostly transparent, so clamp the PET (not the whole
      // window) to the screen. The pet's canvas offset depends on the layout: top in below, bottom in
      // up. This only stops the pet sliding off an edge — it never pulls it in (no snap).
      const cTop = canvasTopIn(FULL_H, curBelow);
      const yMin = mp.y - (cTop + PET_CANVAS_TOP); // pet's dome flush to the screen top
      const yMax = mp.y + ms.height - (cTop + CANVAS_H); // canvas bottom flush to the screen bottom
      y = Math.min(Math.max(pos.y, yMin), Math.max(yMin, yMax));
    } else {
      // Linux (resizing window): keep the pet's canvas on-screen; allowance tuned for the 340 window.
      const petTop = size.height - CANVAS_H;
      y = Math.max(mp.y - petTop, Math.min(pos.y, mp.y + ms.height - size.height));
    }
    if (Math.round(x) !== Math.round(pos.x) || Math.round(y) !== Math.round(pos.y)) {
      await win.setPosition(new LogicalPosition(Math.round(x), Math.round(y)));
    }
  }
  // Native macOS drag keeps the dragging flag alive via Moved events (the page gets none mid-drag);
  // the manual Windows drag is driven by mouse events, so it doesn't use this.
  window.__TAURI__.window.getCurrentWindow().onMoved(() => {
    if (dragging && !IS_WIN_DRAG) armDragEnd();
  });
  canvas.addEventListener("mousedown", async (e) => {
    if (e.button !== 0) return;
    downPos = { x: e.screenX, y: e.screenY, canvasY: e.offsetY, winX: 0, winY: 0, captured: !IS_WIN_DRAG };
    if (IS_WIN_DRAG) {
      try {
        const win = window.__TAURI__.window.getCurrentWindow();
        const p = (await win.outerPosition()).toLogical(await win.scaleFactor());
        if (downPos) { downPos.winX = p.x; downPos.winY = p.y; downPos.captured = true; }
      } catch (err) {}
    }
  });
  window.addEventListener("mousemove", (e) => {
    if (!downPos) return;
    const moved = Math.abs(e.screenX - downPos.x) + Math.abs(e.screenY - downPos.y);
    if (!dragging && moved > 4) {
      dragging = true;
      if (!IS_WIN_DRAG) {
        downPos = null; // macOS: hand off to the native drag (original behavior)
        window.__TAURI__.window.getCurrentWindow().startDragging();
      }
    }
    // Windows manual drag: move the window with the cursor (screenX/Y and logical position share
    // the same CSS-pixel space at a given scale), allowing a negative y the native drag can't reach.
    // No 350ms timer here — pausing mid-drag must not end it; mouseup ends the drag.
    if (dragging && IS_WIN_DRAG && downPos && downPos.captured) {
      const { LogicalPosition } = window.__TAURI__.dpi;
      const nx = downPos.winX + (e.screenX - downPos.x);
      const ny = downPos.winY + (e.screenY - downPos.y);
      window.__TAURI__.window.getCurrentWindow().setPosition(new LogicalPosition(Math.round(nx), Math.round(ny)));
    }
  });
  window.addEventListener("mouseup", () => {
    if (IS_WIN_DRAG && dragging) {
      // End the manual drag; clamp only keeps the pet from sliding off the edges (no snap), then
      // persist the pet's new anchor so it comes back here next launch.
      dragging = false;
      clearTimeout(dragEndTimer);
      if (panel.classList.contains("hidden")) clampToScreen().then(savePetAnchor);
      else savePetAnchor();
      downPos = null;
      return;
    }
    // A click in place (no drag) toggles the usage panel.
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
    // offsetX/Y stay in the canvas's own 200×184 space (the visual size comes from a CSS transform,
    // which doesn't affect offset coords), so no scale conversion is needed.
    const gx = e.offsetX / 4, gy = e.offsetY / 4; // Grid coordinates (pixel scale factor 4)
    pat = !downPos && gx > 8 && gx < 42 && gy > 12 && gy < 36;
    // Eyes-follow: cursor position over the canvas in logical px (offsetX/Y are CSS px)
    gazeX = e.offsetX;
    gazeY = e.offsetY;
    // Tickle: fast wiggling over the pet body keeps a short-lived tickle alive
    const speed = Math.abs(e.offsetX - lastMX) + Math.abs(e.offsetY - lastMY);
    lastMX = e.offsetX;
    lastMY = e.offsetY;
    if (pat && speed > 6) tickleUntil = performance.now() + 350;
  });
  canvas.addEventListener("mouseleave", () => {
    pat = false;
    gazeX = gazeY = null;
    tickleUntil = 0;
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

  // Apply a pet size change: rescale the canvas + all window geometry, keeping the pet's feet (the
  // canvas bottom) pinned so it grows/shrinks in place. Called on first config load and whenever the
  // Settings window changes the size (config-changed). A no-op if already at that scale — so the
  // default (1.0) never touches the window. Rust pre-sizes the window at startup too, so the initial
  // call just re-anchors at the same geometry.
  async function applyScale(scale) {
    scale = SCALES.includes(scale) ? scale : DEFAULT_SCALE;
    if (scale === petScale || resizing) return;
    resizing = true;
    try {
      const win = window.__TAURI__.window.getCurrentWindow();
      const { LogicalSize, LogicalPosition } = window.__TAURI__.dpi;
      const factor = await win.scaleFactor();
      const winPos = (await win.outerPosition()).toLogical(factor);
      // Pin the pet's feet: remember the canvas bottom's screen Y, restore it after resizing.
      const bottomY = winPos.y + canvas.getBoundingClientRect().bottom;
      // Resize the COLLAPSED window; if the panel is open, collapse it first (it re-fits on next open).
      if (!panel.classList.contains("hidden")) {
        panel.classList.add("hidden");
        document.body.classList.remove("below");
        if (PREALLOC) curBelow = false;
      }
      canvas.style.visibility = "hidden";
      applyCanvasScale(scale);
      recomputeGeom(scale);
      const below = PREALLOC ? curBelow : false;
      const targetH = COLLAPSED_H;
      const newTop = Math.round(bottomY - canvasTopIn(targetH, below) - CANVAS_H);
      // Atomic move+size in native code; the pet is hidden across it anyway (its size changes here).
      await invoke("set_window_rect", { x: Math.round(winPos.x), y: newTop, w: WIN_W, h: targetH }).catch(async () => {
        await win.setPosition(new LogicalPosition(Math.round(winPos.x), newTop));
        await win.setSize(new LogicalSize(WIN_W, targetH));
      });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      invoke("set_panel_open", { open: false }).catch(() => {});
      if (PREALLOC) {
        invoke("set_pet_at_top", { v: curBelow }).catch(() => {});
        savePetAnchor();
      } else {
        clampToScreen();
      }
    } finally {
      // Always un-hide, even if a resize/reposition call threw — otherwise the pet stays invisible.
      canvas.style.visibility = "";
      resizing = false;
    }
  }

  function applyConfig(c) {
    soundOn = c.sound;
    cfgConnected = c.connected;
    hooksIncomplete = !!c.hooks_incomplete;
    currentSkin = c.skin || "classic";
    if (hooksIncomplete) el("install-hooks").textContent = t("update_hooks");
    if (c.connected) el("acct-status").textContent = t("connected");
    applyScale(typeof c.pet_scale === "number" ? c.pet_scale : DEFAULT_SCALE).catch(() => {});
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
