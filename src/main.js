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
    // The panel's one line about setup. Says ONE thing — the next step that unblocks you — and links
    // to the Settings tab where you can do it. Gone for good once there's nothing to do.
    setup_no_agent: [
      "没检测到 Claude Code 或 Codex,宠物暂时无事可做",
      "No Claude Code or Codex found — nothing for the pet to watch yet",
    ],
    setup_hooks: ["{a} 的 hooks 还没装,去装一下", "{a}'s hooks aren't installed yet"],
    // Which install, not just which agent: on Windows a user can have Claude Code in three places
    // (desktop app, terminal, WSL) and only the WSL one be un-hooked. "Claude Code 的 hooks 还没装"
    // then reads as a lie to someone whose desktop app is plainly being watched.
    setup_hooks_site: [
      "{s} 里的 Claude Code hooks 还没装,去装一下",
      "Claude Code's hooks aren't installed in {s}",
    ],
    site_windows: ["Windows", "Windows"],
    site_local: ["本机", "this machine"],
    site_wsl: ["WSL · {d}", "WSL · {d}"],
    setup_codex_approve: [
      "Codex 的 hooks 还没生效 —— 需要你在 Codex 里批准",
      "Codex's hooks aren't live yet — Codex needs you to approve them",
    ],
    // The upgrade trap: we rewrote the hooks, so Codex re-armed its review and silently stopped
    // running them. Codex says nothing, and the pet would just look broken.
    setup_codex_reapprove: [
      "Codex 的 hooks 变了 —— 要在 Codex 里重新批准一次",
      "Codex's hooks changed — approve them again in Codex",
    ],
    first_run_bubble: ["点我看用量!", "Click me for usage!"],
    no_window: ["暂无活动窗口", "No active window"],
    // Cost is Claude-only: we model Anthropic's prices and nobody else's. The label says so,
    // so a two-agent token count next to a one-agent dollar figure can't read as a total.
    cost_today: ["今日成本(Claude)", "Today's cost (Claude)"],
    cost_7d: ["近 7 天成本", "Cost, last 7 days"],
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
    about: ["关于", "About"],
    // Weekly cap is the harsher limit — running out locks you out for the WEEK, not five hours.
    week_quota: ["周额度", "Weekly"],
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
  const CANVAS_W0 = canvas.width, CANVAS_H0 = canvas.height; // 288 × 184 (HTML attrs)
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
    // The canvas keeps its 200×184 CSS box at every scale (so pet.js and every skin still draw into a
    // fixed 200×184 space), which means an enlarged pet spills OUT of that box — upward, since it
    // grows from its feet. In the up-layout that spill lands in the panel's empty area and nobody
    // notices. In the BELOW layout the canvas is flush with the window's top edge, so the spill goes
    // straight past it and the window clips the pet's head off (46px of it at the largest size).
    // Publish the overflow so the below-layout can reserve exactly that much room above the box.
    document.body.style.setProperty("--pet-overflow", CANVAS_H0 * (scale - 1) + "px");
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
  // Size of the pet's own labels (bubble, "❯ cmd…", tool tag). The pet's ART is sized separately by
  // pet_scale — this is only the type, for anyone who can read the pet fine but not the words on it.
  // MUST be declared above loop(): `let` has no hoisted initialisation, so a declaration further down
  // the file puts every frame in its temporal dead zone — the first draw throws and the pet vanishes.
  // Keep DEFAULT_TEXT_SCALE in sync with config.rs.
  const DEFAULT_TEXT_SCALE = 1.2;
  let textScale = DEFAULT_TEXT_SCALE;

  // Skins that bring their own draw() never see `extra`, so hand PetKit the value directly too.
  function applyTextScale(v) {
    textScale = Number(v) > 0 ? Number(v) : DEFAULT_TEXT_SCALE;
    if (window.PetKit && window.PetKit.setTextScale) window.PetKit.setTextScale(textScale);
  }

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
      textScale,
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
  for (let i = 0; i < 7; i++) {
    const hit = document.createElement("span");
    hit.className = "bar-hit";
    const inner = document.createElement("span");
    inner.className = "bar-inner";
    hit.appendChild(inner);
    trend.appendChild(hit);
  }
  const bars = trend.querySelectorAll(".bar-inner");
  bars[6].classList.add("today");
  bars[6].classList.add("hot");

  // Hover: highlight the bar and swap the label/token to that day,
  // showing a per-agent breakdown underneath. The whole #trend box is the
  // hit area, including the gaps between bars.
  let hotIdx = 6;
  const tokLabel = el("tok-label");
  const savedLabel = tokLabel.textContent;
  const breakdown = el("tok-breakdown");

  function dayLabel(i) {
    const d = new Date(Date.now() - (6 - i) * 86400000);
    return (d.getMonth() + 1) + "/" + d.getDate();
  }
  function fmtBreakdown(i) {
    const total = bars[i]._total || 0;
    const codex = bars[i]._codex || 0;
    const hermes = bars[i]._hermes || 0;
    const claude = total > codex + hermes ? total - codex - hermes : 0;
    const parts = [];
    if (claude > 0) parts.push('<span class="agent-claude">Claude ' + fmtTokens(claude) + "</span>");
    if (codex > 0) parts.push('<span class="agent-codex">Codex ' + fmtTokens(codex) + "</span>");
    if (hermes > 0) parts.push('<span class="agent-hermes">Hermes ' + fmtTokens(hermes) + "</span>");
    return parts.join(" · ");
  }
  function updateBreakdown(i) {
    breakdown.innerHTML = fmtBreakdown(i);
  }
  function setHot(i) {
    if (hotIdx === i) return;
    bars[hotIdx].classList.remove("hot");
    hotIdx = i;
    bars[i].classList.add("hot");
    tokLabel.textContent = dayLabel(i);
    el("tok-today").textContent = fmtTokens(bars[i]._total || 0);
    updateBreakdown(i);
  }
  function clearHot() {
    bars[hotIdx].classList.remove("hot");
    hotIdx = 6;
    bars[6].classList.add("hot");
    tokLabel.textContent = savedLabel;
    el("tok-today").textContent = fmtTokens(cur.usage ? cur.usage.today_tokens : 0);
    updateBreakdown(6);
  }

  trend.addEventListener("mousemove", (e) => {
    const rect = trend.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const colW = rect.width / 7;
    if (colW <= 0) return;
    const i = Math.min(6, Math.max(0, Math.floor(x / colW)));
    setHot(i);
  });
  trend.addEventListener("mouseleave", clearHot);

  const AGENT_NAME = { claude: "Claude", codex: "Codex", hermes: "Hermes" };

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

  /// One quota card: title, percentage, the 10-cell pixel bar, the reset line — and, for Claude, the
  /// weekly rail underneath.
  function buildQuotaCard(q) {
    const card = document.createElement("div");
    card.className = "quota-card";

    const head = document.createElement("div");
    head.className = "label-row";
    const title = document.createElement("span");
    const win = q.basis === "none" ? null : windowLabel(q.window_minutes);
    title.textContent = (AGENT_NAME[q.agent] || q.agent) + (win ? " · " + win : "");
    const pct = document.createElement("span");
    pct.className = "num";
    // For agents without a rate-limit basis, show token count instead of a meaningless "--%"
    pct.textContent = q.basis === "none" ? fmtTokens(q.tokens) : (q.pct_valid ? Math.round(q.pct * 100) + "%" : "--%");
    head.appendChild(title);
    head.appendChild(pct);

    // Agents without a rate-limit percentage (e.g. Hermes) get a token-only card — no bar,
    // no weekly rail. Just the headline number and a one-liner that says what it means.
    if (q.basis === "none") {
      const line = document.createElement("div");
      line.className = "hint";
      line.textContent = fmtTokens(q.tokens || 0) + " tokens today";
      card.appendChild(head);
      card.appendChild(line);
      return card;
    }

    // The 5-hour window: DISCRETE blocks. Ten of them, chunky, gapped — time you spend a block at a
    // time, in the pet's own pixel language.
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

    // The WEEKLY quota (Claude, official mode). Deliberately a different SHAPE, not just a different
    // colour: a thin CONTINUOUS rail, not ten discrete blocks.
    //
    // They are different quantities with different consequences — running out of the 5-hour window
    // costs you five hours; running out of the weekly one locks you out for the rest of the week. Drawn
    // identically, the eye reads them as the same measure and compares them. Drawn as blocks-vs-rail,
    // it reads them as "how much of today" vs "how much of the week", which is what they are.
    //
    // (Colour alone can't carry this: a colourblind user, or anyone glancing, sees only the geometry.)
    if (q.week_pct !== null && q.week_pct !== undefined) {
      const wk = document.createElement("div");
      wk.className = "week";
      const wrow = document.createElement("div");
      wrow.className = "week-row";
      const wl = document.createElement("span");
      wl.textContent = t("week_quota");
      const wv = document.createElement("span");
      wv.className = "num week-num";
      wv.textContent = Math.round(q.week_pct * 100) + "%";
      wrow.appendChild(wl);
      wrow.appendChild(wv);

      const rail = document.createElement("div");
      rail.className = "week-rail";
      const fill = document.createElement("i");
      fill.style.width = Math.min(q.week_pct, 1) * 100 + "%";
      // The weekly cap is the harsher one — escalate earlier and say so in text, not just in colour.
      if (q.week_pct >= 1.0) wk.classList.add("full");
      else if (q.week_pct >= 0.8) wk.classList.add("warn");
      rail.appendChild(fill);

      wk.appendChild(wrow);
      wk.appendChild(rail);
      card.appendChild(wk);
    }
    return card;
  }

  /// The line under a quota bar: when it resets, and what the percentage is based on.
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
    if (q.basis === "none") return fmtTokens(q.tokens || 0) + " tokens today";
    if (q.basis === "official") return t("no_window_official");
    return q.pct_valid ? t("no_window2") : t("usage_need_connect");
  }

  function renderQuotas(quotas) {
    const box = el("sub-block");
    box.textContent = "";
    // Include cards with a valid percentage (Claude/Codex), plus Hermes token-only cards (basis "none" but has tokens)
    const real = (quotas || []).filter((q) => q.pct_valid || q.agent === "hermes");
    real.forEach((q, i) => {
      // A divider between agents, so Claude's block and Codex's read as separate things rather than
      // one continuous list of bars.
      if (i > 0) {
        const d = document.createElement("div");
        d.className = "divider";
        box.appendChild(d);
      }
      box.appendChild(buildQuotaCard(q));
    });
    box.classList.toggle("hidden", !real.length);
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
    const multiAgent = new Set(list.map((s) => s.agent)).size > 1;
    for (const s of list) {
      const row = document.createElement("div");
      row.className = "s-row s-" + s.state;
      const ic = document.createElement("span");
      ic.className = "s-ic";
      ic.textContent = SESS_ICON[s.state] || "·";
      const label = document.createElement("span");
      label.className = "s-label";
      const what = s.cwd || t(SESS_LABEL[s.state] || "st_idle");
      // Name the agent too — with several agents running, "which one needs me?" must be answerable
      // in one glance. Only worth the space once more than one agent is actually in the list.
      label.textContent = multiAgent ? (AGENT_NAME[s.agent] || s.agent) + " · " + what : what;
      const time = document.createElement("span");
      time.className = "s-time";
      time.textContent = fmtDur(s.secs || 0);
      row.appendChild(ic);
      row.appendChild(label);
      row.appendChild(time);
      box.appendChild(row);
    }
  }

  // The one line the panel keeps about setup. It is an INVITATION, not a form: it appears only while
  // something genuinely needs doing, names the single most useful next step, and takes you to Settings
  // where you can actually do it. Once done, it's gone for good. (ADR-0014: setup is not something you
  // should have to look at every day on the surface you open to check your quota.)
  //
  // Priority matters — say ONE thing, the thing that unblocks them:
  //   1. No agent at all → there is nothing this pet can do; say so plainly.
  //   2. An agent is here but its hooks aren't → that's why the pet never moves.
  //   3. Codex's hooks are written but it hasn't run them → the trust gate; this is the step people
  //      get stuck on, and they'd never guess it.
  function siteLabel(s) {
    if (s.kind === "wsl") return t("site_wsl", { d: s.name || "WSL" });
    return t(s.kind === "windows" ? "site_windows" : "site_local");
  }

  function renderSetupLine() {
    const agents = cur.agents || [];
    const seen = cur.agents_seen || [];
    const here = agents.filter((a) => a.installed);
    const line = el("setup-line");

    let text = null, tab = "general";
    if (!here.length) {
      text = t("setup_no_agent");
    } else {
      const needsHooks = here.find((a) => a.hooks_incomplete);
      const codex = here.find((a) => a.agent === "codex");
      if (needsHooks) {
        // Name the place when there is more than one, so the line can't be read as "your Claude
        // Code isn't hooked up" by someone whose other install is working fine.
        const sites = needsHooks.sites || [];
        const gaps = sites.filter((s) => s.hooks_incomplete);
        text = sites.length > 1 && gaps.length === 1
          ? t("setup_hooks_site", { s: siteLabel(gaps[0]) })
          : t("setup_hooks", { a: AGENT_NAME[needsHooks.agent] || needsHooks.agent });
        tab = needsHooks.agent;
      } else if (codex && codex.approval === "stale") {
        // We rewrote the hooks (an upgrade, or a pollution cleanup), which re-arms Codex's review.
        // It will keep printing `hook: … Completed` while running nothing. Say so even if events
        // arrived earlier today — those were the OLD, approved hooks.
        text = t("setup_codex_reapprove");
        tab = "codex";
      } else if (codex && !seen.includes("codex") && codex.approval !== "recorded") {
        // Written, but never approved, and Codex won't run a hook until it is. Nothing else tells
        // them. Once Codex has an approval on record we go quiet — nagging a user to do a thing he
        // has already done is how a panel teaches people to ignore it. (Approved-but-no-event-yet is
        // not an error state; it resolves itself the moment he runs anything.)
        text = t("setup_codex_approve");
        tab = "codex";
      }
    }
    line.classList.toggle("hidden", !text);
    if (text) {
      el("setup-text").textContent = text;
      line.dataset.tab = tab;
    }
  }

  function renderPanel() {
    renderSessions();
    const u = cur.usage;
    if (!u) return;

    const isSub = u.mode === "subscription";
    el("api-block").classList.toggle("hidden", isSub);

    // Whether a percentage is trustworthy is decided by the backend (projection::usage_flags) and
    // stamped onto each quota as pct_valid, so that rule isn't duplicated across the IPC seam.
    if (isSub) {
      renderQuotas(u.quotas);
    } else {
      el("cost-today").textContent = fmtCost(u.today_cost);
      el("cost-week").textContent = fmtCost(u.week_cost);
    }

    // Normalize trend bar heights against the 7-day maximum. Each bar stacks the Codex share on top
    // of Claude's, so a day spent in Codex is visible as Codex's rather than blended into one bar.
    if (u.daily_tokens && u.daily_tokens.length === 7) {
      const max = Math.max(...u.daily_tokens, 1);
      const codexDaily = u.daily_codex || [];
      const hermesDaily = u.daily_hermes || [];
      for (let i = 0; i < 7; i++) {
        const cell = bars[i];
        const total = u.daily_tokens[i];
        const cx = codexDaily[i] || 0;
        const hx = hermesDaily[i] || 0;
        const h = Math.max(1, Math.round((total / max) * 24));
        cell.style.height = h + "px";
        cell._total = total;
        cell._codex = cx;
        cell._hermes = hx;
        // The Codex slice, as a fraction of this bar, drawn from the top down
        const cxFrac = total > 0 ? cx / total : 0;
        cell.style.setProperty("--codex", Math.round(cxFrac * 100) + "%");
        cell.classList.toggle("mixed", cx > 0 && cx < total);
        cell.classList.toggle("all-codex", cx > 0 && cx === total);
      }
    }
    // Respect an in-progress hover: the panel re-renders every push (~1s while open), and blindly
    // writing today's numbers here yanks the display away from the day the cursor is on.
    el("tok-today").textContent =
      hotIdx === 6 ? fmtTokens(u.today_tokens) : fmtTokens(bars[hotIdx]._total || 0);
    updateBreakdown(hotIdx);
    renderSetupLine();

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
  // How much window height the panel gets. The panel overlaps the canvas by PANEL_OVERLAP (its
  // negative margin-bottom), so a panel of height H needs (H - PANEL_OVERLAP) px above the canvas.
  //
  // THESE THREE NUMBERS ARE ONE FACT, in three places — keep them in sync or the panel gets clipped:
  //   · PANEL_MAX_H here
  //   · `body.prealloc #panel { max-height }` in style.css   (must equal PANEL_MAX_H)
  //   · the panel allowance in src-tauri/src/main.rs's setup  (must equal PANEL_MAX_H - PANEL_OVERLAP)
  //
  // Sized for the WORST panel a real user actually has. Note "real": an earlier attempt measured a
  // SYNTHETIC panel (two quota cards, banner, setup line, five sessions) at 399px and set the cap to
  // 500 — and a real one promptly overflowed it, because the mock had left out the weekly-quota row,
  // the three-model breakdown, and reset lines that wrap to two lines. A real connected account with
  // both agents runs to ~580px. Measure the thing, not a model of the thing.
  //
  // Past this the panel scrolls internally rather than being cut off — the backstop for a long
  // session list. But scrolling is a LAST RESORT, not the plan: whatever scrolls out of sight is, by
  // definition, the top of the panel, and the top is where the headline numbers are.
  const PANEL_MAX_H = 640;
  const PANEL_OVERLAP = 60; // #panel's negative margin-bottom in style.css

  let BASE_H, WIN_W, CANVAS_H, PAD_B, PET_CANVAS_TOP, FULL_H, COLLAPSED_H;
  function recomputeGeom(scale) {
    BASE_H = Math.round(340 * scale);
    WIN_W = Math.max(240, Math.round(CANVAS_W0 * scale + 40)); // CANVAS_W0 = the canvas's own width
    CANVAS_H = Math.round(184 * scale); // visual pet height (canvas is CSS 184, transform-scaled)
    PAD_B = 4;                          // body padding-bottom is a fixed 4px CSS gap, not scaled
    PET_CANVAS_TOP = Math.round(64 * scale);
    FULL_H = Math.round(CANVAS_H + PAD_B + (PANEL_MAX_H - PANEL_OVERLAP));
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

  // A skin switch reloads the page (location.reload), which resets this module's state while the
  // full-height window stays wherever the below-layout left it. The backend's pet_at_top flag
  // survives the reload, so restore the layout from it before anything measures the canvas or
  // saves the pet anchor — otherwise the pet re-renders at the wrong end of the window and the
  // click-through strip (still at the old end) makes it unclickable. The panel_open flag survives
  // the reload the same way (the reload lands with the panel hidden), so reset it too.
  invoke("set_panel_open", { open: false }).catch(() => {});
  const layoutRestored = !PREALLOC
    ? Promise.resolve()
    : invoke("get_pet_at_top")
        .then((atTop) => {
          if (atTop) {
            curBelow = true;
            document.body.classList.add("below");
          }
        })
        .catch(() => {});

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
        panel.scrollTop = 0; // if it ever does scroll, never open it scrolled past the headline numbers
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
      // Always restore opacity, even if fitPanel() threw. Opening sets it to 0 to measure and place
      // the panel before revealing it; without this, one failure anywhere in there leaves the panel
      // expanded but fully transparent — the user clicks, nothing appears, and clicking again just
      // closes the panel they never saw.
      panel.style.opacity = "";
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

  // Settings, About, and GitHub — bottom-row items after the divider. Settings opens its own window;
  // About reuses the tray's about dialog; GitHub opens the project repo in the system browser.
  el("open-settings").addEventListener("click", (e) => {
    e.stopPropagation();
    document.activeElement?.blur();
    invoke("open_settings_window_on", { tab: "general" }).catch(() => {});
  });
  el("open-about").addEventListener("click", (e) => {
    e.stopPropagation();
    document.activeElement?.blur();
    invoke("open_about_window").catch(() => {});
  });
  el("open-github").addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    invoke("open_url", { url: "https://github.com/ZGhey/tokibean" }).catch(() => {});
  });
  el("setup-line").addEventListener("click", (e) => {
    e.stopPropagation();
    document.activeElement?.blur();
    invoke("open_settings_window_on", { tab: el("setup-line").dataset.tab || "general" }).catch(() => {});
  });

  // ---------- Config (settings now live in the tray Settings window) ----------
  let soundOn = false;
  let currentSkin = "classic"; // the skin actually rendered (manual pick, or rotation's pick)
  let rotationTimer = null;

  // ---------- Skin rotation (frontend-owned; the backend only stores the two config fields) ----
  // Calendar-aligned and stateless: the displayed skin is derived from the local clock, so a
  // restart lands on the same skin and nothing about "last switch time" is ever persisted.
  // `shifted` moves the epoch to local time so the period boundaries fall on the local top of the
  // hour / local midnight (incl. half-hour timezones). A DST switch shifts the offset by an hour,
  // so that night the cycle skips or repeats one step — cosmetic, twice a year, self-corrects.
  function rotationPeriod(mode) {
    const shifted = Date.now() - new Date().getTimezoneOffset() * 60000;
    const span = mode === "daily" ? 86400e3 : 3600e3;
    return { index: Math.floor(shifted / span), msToNext: span - (shifted % span) };
  }

  // The skins taking part in rotation, in skins.json order (so the cycle order is stable no
  // matter how the config list happens to be ordered). Unknown/removed ids drop out silently;
  // empty result (or rotation off) means rotation is inert.
  async function rotationList(c) {
    if (c.skin_rotation !== "hourly" && c.skin_rotation !== "daily") return [];
    const chosen = Array.isArray(c.rotation_skins) ? c.rotation_skins : [];
    if (!chosen.length) return [];
    try {
      const all = await (await fetch("skins.json")).json();
      return all.map((s) => s.id).filter((id) => chosen.includes(id));
    } catch (e) {
      return [];
    }
  }

  // What should be on screen right now: rotation's pick when active, else the manual choice.
  async function effectiveSkin(c) {
    const list = await rotationList(c);
    if (!list.length) return c.skin || "classic";
    return list[rotationPeriod(c.skin_rotation).index % list.length];
  }

  // Arm a timer for the next boundary. Switching = the plain skin-change path (location.reload);
  // if the boundary lands on the same skin (single-skin list, wrap-around), just re-arm.
  function scheduleRotation(c) {
    clearTimeout(rotationTimer);
    rotationTimer = null;
    if (c.skin_rotation !== "hourly" && c.skin_rotation !== "daily") return;
    // +1s so a timer that fires a hair early still lands past the boundary.
    rotationTimer = setTimeout(async () => {
      const cfg = await invoke("get_config").catch(() => null);
      if (!cfg) return scheduleRotation(c); // transient failure: keep the loop alive
      if ((await effectiveSkin(cfg)) !== currentSkin) return location.reload();
      scheduleRotation(cfg);
    }, rotationPeriod(c.skin_rotation).msToNext + 1000);
  }

  /// Where the pet's feet must land for the whole pet — dome to toes, at the NEW scale — to fit on
  /// screen. Takes the desired feet Y, returns it nudged inside the monitor (unchanged if it already
  /// fits, and unchanged if we can't read the monitor: never move the pet on a guess).
  ///
  /// Call recomputeGeom(newScale) first — this reads the new CANVAS_H / PET_CANVAS_TOP.
  async function clampFeet(feetY) {
    let mon;
    try {
      mon = await window.__TAURI__.window.currentMonitor();
    } catch (e) {}
    if (!mon) return feetY;
    const mp = mon.position.toLogical(mon.scaleFactor);
    const ms = mon.size.toLogical(mon.scaleFactor);
    // The canvas reserves PET_CANVAS_TOP of empty space above the drawing (bubble headroom), so the
    // pet's visible top is that far below the canvas top.
    const domeY = feetY - CANVAS_H + PET_CANVAS_TOP;
    if (domeY < mp.y) feetY += mp.y - domeY; // head poking off the top → push it down
    const floor = mp.y + ms.height;
    if (feetY > floor) feetY = floor; // feet through the bottom → lift them back onto it
    return feetY;
  }

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
      let bottomY = winPos.y + canvas.getBoundingClientRect().bottom;
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
      // Growing pins the pet's FEET, so it gets taller by pushing its head UP — and a pet sitting near
      // the top of the screen grows its head straight off it. (Shrinking near the bottom is the mirror
      // image.) Nudge the target so the whole pet lands on-screen. This has to happen HERE, folded into
      // the geometry we're about to apply: clamping afterwards means a second window move — and on
      // macOS set_window_rect is dispatched to the main thread, so a follow-up read of the window
      // position races it and clamps against stale coordinates. One atomic move, correct the first time.
      bottomY = await clampFeet(bottomY);
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
    applyTextScale(typeof c.text_scale === "number" ? c.text_scale : DEFAULT_TEXT_SCALE);
    applyScale(typeof c.pet_scale === "number" ? c.pet_scale : DEFAULT_SCALE).catch(() => {});
  }

  invoke("get_config").then(async (c) => {
    // applyScale reads curBelow and pins the pet to its current on-screen spot — both are wrong
    // until the post-reload layout restore has landed.
    await layoutRestored;
    applyConfig(c);
    currentSkin = await effectiveSkin(c);
    scheduleRotation(c);
    // Non-default skin: dynamically load it to override PetRenderer
    if (currentSkin !== "classic") {
      const s = document.createElement("script");
      s.src = "skins/" + encodeURIComponent(currentSkin) + ".js";
      document.body.appendChild(s);
    }
    // First run: the pet introduces itself by SPEAKING — the backend gives it a "Hi! Click me for
    // usage~" bubble (see main.rs). That's the whole onboarding, and it's deliberate.
    //
    // No modal: a desktop pet's entire proposition is that it doesn't interrupt you — transparent,
    // click-through, ignorable — and a dialog stealing focus mid-keystroke is the exact thing the
    // click-through thread and the boss key exist to prevent.
    //
    // We also tried auto-expanding the panel once, to demonstrate rather than explain. It expands in
    // the DOM but does not render, and we could not explain why. Shipping a behaviour we don't
    // understand is worse than shipping one less nicety, so it's out: the bubble says the same thing,
    // and every route in (the gear, the setup line) is one click behind it.
    if (!c.onboarded) invoke("mark_onboarded").catch(() => {});
  });
  // The Settings window persists changes and emits "config-changed" — re-sync here. Reload when
  // the EFFECTIVE skin changed (manual pick, or a rotation setting whose derived pick differs).
  listen("config-changed", async () => {
    const c = await invoke("get_config").catch(() => null);
    if (!c) return;
    if ((await effectiveSkin(c)) !== currentSkin) return location.reload();
    applyConfig(c);
    scheduleRotation(c);
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
