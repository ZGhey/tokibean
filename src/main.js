// 前端主逻辑:订阅 Rust 推送的 pet-update,驱动宠物动画和面板

(function () {
  const { listen } = window.__TAURI__.event;
  const { invoke } = window.__TAURI__.core;

  const canvas = document.getElementById("pet");
  const ctx = canvas.getContext("2d");
  // 高 DPI:后备缓冲按物理像素分辨率渲染,文字和像素边缘都更锐利
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
  };
  let t = 0;
  let dragging = false;
  let pat = false;

  // ---------- 动画循环 ----------
  function loop() {
    t++;
    window.PetRenderer.draw(ctx, canvas, cur.state, cur.warn, cur.bubble, t, {
      sessions: cur.working_count,
      workSecs: cur.work_secs,
      attnSecs: cur.attention_secs,
      toolNote: cur.tool_note,
      celebrate: cur.celebrate,
      oops: cur.oops,
      bgCount: cur.bg_count,
      dragging,
      pat,
    });
    requestAnimationFrame(loop);
  }
  loop();

  // ---------- 数字格式化 ----------
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
    if (sec <= 0) return "已重置";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  // ---------- 面板渲染 ----------
  const el = (id) => document.getElementById(id);

  // 像素进度条:10 格
  const bar = el("pixel-bar");
  for (let i = 0; i < 10; i++) bar.appendChild(document.createElement("span"));
  // 7 天趋势柱
  const trend = el("trend");
  for (let i = 0; i < 7; i++) trend.appendChild(document.createElement("span"));
  trend.lastChild.className = "today";

  function renderPanel() {
    const u = cur.usage;
    if (!u) return;

    const isSub = u.mode === "subscription";
    el("mode-badge").textContent = isSub ? "订阅" : "API";
    el("sub-block").classList.toggle("hidden", !isSub);
    el("api-block").classList.toggle("hidden", isSub);

    if (isSub) {
      const pct = Math.min(u.block_pct, 1.5);
      // 估算口径加 ≈ 提示仅供参考,别被"100%"吓到
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
            ? "官方数据"
            : u.block_limit > 0
            ? u.basis === "manual"
              ? `限额 ${fmtTokens(u.block_limit)}(手动设置)`
              : "按加权用量·历史峰值窗口估算"
            : "还没有足够数据估算限额";
        el("block-reset").textContent = `${hh}:${mm} 重置(剩 ${fmtCountdown(left)})· ${limitNote}`;
      } else {
        el("block-reset").textContent =
          u.basis === "official" ? "当前无活动窗口 · 官方数据" : "当前无活动窗口";
      }
      if (u.basis === "official") el("acct-status").textContent = "已连接·官方数据";
      // 周限额(官方模式才有)
      const hasWeek =
        u.basis === "official" && u.week_pct !== null && u.week_pct !== undefined;
      el("week-row").classList.toggle("hidden", !hasWeek);
      if (hasWeek) el("week-pct").textContent = Math.round(u.week_pct * 100) + "%";
    } else {
      el("cost-today").textContent = fmtCost(u.today_cost);
      el("cost-week").textContent = fmtCost(u.week_cost);
    }

    // 趋势柱高按 7 天里的最大值归一
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
      : "没找到 ~/.claude 数据";

    const sess = cur.session_count > 1 ? ` · ${cur.session_count} 会话` : "";
    el("hook-status").textContent = cur.hooks_seen
      ? `已连通(最近:${cur.last_event || "--"})${sess}`
      : "还没收到,去装 hooks →";
    // 已经在正常工作的东西不需要按钮;但缺新事件时要重新亮出来
    el("install-hooks").classList.toggle("hidden", cur.hooks_seen && !hooksIncomplete);
    el("connect-claude").classList.toggle("hidden", u.basis === "official" || cfgConnected);
  }

  // 倒计时每秒刷新
  setInterval(renderPanel, 1000);

  // ---------- 事件订阅 ----------
  listen("pet-update", (e) => {
    cur = e.payload;
    onStateChange(cur.state);
    renderPanel();
  });
  invoke("get_update").then((u) => {
    cur = u;
    renderPanel();
  });

  // ---------- 交互 ----------
  // 面板比基础窗口高,展开时把窗口向上扩高,收起时还原,
  // 避免面板顶部被窗口边界裁掉
  const BASE_H = 340;
  const WIN_W = 240;
  let resizing = false;

  // 把窗口调到目标高度,保持底边(宠物脚下)位置不动。
  // 以当前实际高度为基准,不假设窗口处于 BASE_H,避免状态失步
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
        // 面板顶到画布底的实际布局高度(自动含负 margin 的重叠量)
        const need = Math.ceil(
          canvas.getBoundingClientRect().bottom - panel.getBoundingClientRect().top
        ) + 12;
        await setWindowHeight(Math.max(need, BASE_H));
        armAutoHide(); // 打开后若鼠标一直不进面板,也会按时收起
      } else {
        await setWindowHeight(BASE_H);
        panel.classList.add("hidden");
      }
    } finally {
      resizing = false;
    }
  }

  // 面板自动渐隐:鼠标离开面板 1 秒后淡出收起,不用再点一次
  let hideTimer = null;
  function armAutoHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (panel.classList.contains("hidden")) return;
      if (panel.matches(":hover")) {
        armAutoHide();
        return;
      }
      // 正在操作下拉/输入框时不打扰
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

  // 按住宠物直接拖动窗口,原地松开才算点击(开关面板)。
  // 移动超过阈值就交给系统原生拖拽,之后 mouseup 不会再回到页面。
  // 原生拖拽期间页面收不到鼠标事件,靠窗口 Moved 事件维持 dragging 标记,
  // 停止移动 350ms 后视为松手
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
      // 有气泡时点上半区(气泡所在) → 聚焦终端;点宠物本体 → 开关面板
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

  // 摸头:鼠标悬停在宠物身上(没按住时)
  canvas.addEventListener("mousemove", (e) => {
    const gx = e.offsetX / 4, gy = e.offsetY / 4; // 网格坐标(像素放大倍数 4)
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

  // ---------- 设置区 ----------
  let cfgConnected = false;
  let soundOn = false;
  let hooksIncomplete = false;
  invoke("get_config").then((c) => {
    el("cfg-notify").checked = c.notify;
    el("cfg-minsecs").value = c.notify_min_secs;
    el("cfg-sound").checked = c.sound;
    soundOn = c.sound;
    cfgConnected = c.connected;
    hooksIncomplete = !!c.hooks_incomplete;
    el("cfg-skin").value = c.skin || "classic";
    // 非默认皮肤:动态加载覆盖 PetRenderer
    if (c.skin && c.skin !== "classic") {
      const s = document.createElement("script");
      s.src = "skins/" + encodeURIComponent(c.skin) + ".js";
      document.body.appendChild(s);
    }
    if (hooksIncomplete) el("install-hooks").textContent = "更新 Claude Code hooks(有新事件)";
    if (c.connected) el("acct-status").textContent = "已连接";
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
    // 换肤后重载页面让新皮肤生效
    Promise.resolve(saveCfg()).then(() => location.reload());
  });

  // ---------- 8-bit 提示音(WebAudio,无音频文件) ----------
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
    if (cur.oops && !prevOops) beep([[196, 0.1], [147, 0.16]]); // 出错:低沉咕咚
    prevOops = !!cur.oops;
    if (s === prevState) return;
    if (s === "done") beep([[660, 0.09], [880, 0.14]]);       // 完工:叮-咚
    else if (s === "attention") beep([[520, 0.07], [520, 0.07]]); // 等你:嗒嗒
    prevState = s;
  }

  el("connect-claude").addEventListener("click", () => {
    el("acct-status").textContent = "浏览器授权中…";
    invoke("connect_claude")
      .then((msg) => {
        el("acct-status").textContent = "已连接";
        el("install-result").textContent = msg;
      })
      .catch((err) => {
        el("acct-status").textContent = "未连接";
        el("install-result").textContent = "失败:" + err;
      });
  });

  el("install-hooks").addEventListener("click", () => {
    el("install-result").textContent = "安装中…";
    invoke("install_hooks")
      .then((msg) => {
        el("install-result").textContent = msg;
        hooksIncomplete = false;
      })
      .catch((err) => (el("install-result").textContent = "失败:" + err));
  });
})();
