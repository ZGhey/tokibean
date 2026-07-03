// 宠物渲染器 —— 皮肤层
// 想换皮肤只需要替换这个文件,保持 window.PetRenderer 接口不变:
//   PetRenderer.draw(ctx, canvas, state, warn, bubble, t, extra)
// state: idle | working | attention | done | limit
// extra(可选,老皮肤可以忽略): {
//   sessions   正在干活的会话数(>1 画 ×N 徽章)
//   workSecs   当前最长一路工作的持续秒数
//   toolNote   正在用的工具短语(如"跑命令")
//   celebrate  完工庆祝等级 0/1/2
//   dragging   正被拖拽
//   pat        鼠标悬停在宠物身上(摸头)
// }
// 默认角色:拱门·墩墩(柿子橙圆拱顶),原创形象,可自由分发。
// 本地私藏皮肤放 src/skins/tribute.js(已被 .gitignore 排除)。

(function () {
  const S = 4;            // 像素放大倍数
  const GY = 42;          // 地面所在的网格行
  const C = "#f2823e";    // 柿子橙(拱门·墩墩)
  const K = "#26221d";    // 眼睛
  const AMBER = "#e0a63b";
  const CONFETTI = ["#d97757", "#e0a63b", "#7fb4d9", "#d4537e", "#9ac47a"];

  function px(ctx, x, y, w, h, c) {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x) * S, Math.round(y) * S, w * S, h * S);
  }

  function eyes(ctx, cx, y0, mode) {
    const L = cx - 9, R = cx + 2;
    if (mode === "closed") {
      px(ctx, L, y0 + 6, 3, 1, K);
      px(ctx, R, y0 + 6, 3, 1, K);
    } else if (mode === "happy") {
      for (const ex of [L, R]) {
        px(ctx, ex, y0 + 5, 1, 1, K);
        px(ctx, ex + 1, y0 + 4, 1, 1, K);
        px(ctx, ex + 2, y0 + 5, 1, 1, K);
      }
    } else if (mode === "up") {
      px(ctx, L + 1, y0 + 3, 3, 3, K);
      px(ctx, R + 1, y0 + 3, 3, 3, K);
    } else if (mode === "tired") {
      // 半睁:上眼皮压下来
      px(ctx, L, y0 + 5, 3, 2, K);
      px(ctx, R, y0 + 5, 3, 2, K);
    } else if (mode === "wide") {
      // 瞪大(被拎起来)
      px(ctx, L, y0 + 3, 3, 4, K);
      px(ctx, R, y0 + 3, 3, 4, K);
    } else {
      px(ctx, L, y0 + 4, 3, 3, K);
      px(ctx, R, y0 + 4, 3, 3, K);
    }
  }

  // 身体。返回头顶所在行,供叠加元素定位
  function body(ctx, cx, o) {
    let y0;
    if (o.lying) {
      y0 = GY - 15 - (o.breath || 0);
    } else {
      y0 = GY - 22 - (o.bounce || 0);
      const legs = [-11, -5, 3, 9];
      const lift = o.step ? 1 : 0;
      for (let i = 0; i < 4; i++) {
        const up = o.moving ? (i % 2 === 0 ? lift : 1 - lift) : 0;
        px(ctx, cx + legs[i], y0 + 15, 2, 7 - up, C);
      }
    }
    px(ctx, cx - 13, y0, 26, 15, C); px(ctx, cx - 11, y0 - 2, 22, 2, C); px(ctx, cx - 7, y0 - 4, 14, 2, C); px(ctx, cx - 12, y0 + 11, 2, 1, "#f0b8c4"); px(ctx, cx + 10, y0 + 11, 2, 1, "#f0b8c4");
    if (o.stretch) {
      // 伸懒腰:两臂高举过头
      px(ctx, cx - 16, y0 + 1, 3, 2, C);
      px(ctx, cx - 17, y0 - 2, 2, 3, C);
      px(ctx, cx + 13, y0 + 1, 3, 2, C);
      px(ctx, cx + 15, y0 - 2, 2, 3, C);
      eyes(ctx, cx, y0, "closed");
      return y0;
    }
    if (o.handsBack) {
      // 背着手:正面看不到手,只在身侧露出一点点袖口
      px(ctx, cx - 15, y0 + 10, 2, 2, C);
      px(ctx, cx + 13, y0 + 10, 2, 2, C);
      eyes(ctx, cx + (o.faceDx || 0), y0, o.eyes || "open");
      return y0;
    }
    if (o.typing) {
      // 敲键盘:两只小手在身前交替起落
      const tap = o.tap ? 1 : 0;
      px(ctx, cx - 16, y0 + 10 + tap, 3, 3, C);
      px(ctx, cx + 13, y0 + 11 - tap, 3, 3, C);
      eyes(ctx, cx, y0, o.eyes || "open");
      return y0;
    }
    px(ctx, cx - 16, y0 + 8, 3, 3, C); // 左小手
    if (o.wave) {
      if (o.waveUp) {
        px(ctx, cx + 13, y0 + 3, 3, 2, C);
        px(ctx, cx + 16, y0, 2, 3, C);
      } else {
        px(ctx, cx + 13, y0 + 5, 3, 2, C);
        px(ctx, cx + 16, y0 + 2, 2, 3, C);
      }
    } else {
      px(ctx, cx + 13, y0 + 8, 3, 3, C); // 右小手
    }
    eyes(ctx, cx, y0, o.eyes || "open");
    return y0;
  }

  // 拖拽:悬空,四条小腿乱蹬
  function bodyDangling(ctx, cx, t) {
    const y0 = GY - 30 + Math.round(Math.sin(t * 0.25));
    const legs = [-11, -5, 3, 9];
    for (let i = 0; i < 4; i++) {
      const kick = Math.sin(t * 0.45 + i * 1.7) > 0 ? 1 : 0;
      px(ctx, cx + legs[i], y0 + 15, 2, 5 + kick, C);
    }
    px(ctx, cx - 13, y0, 26, 15, C); px(ctx, cx - 11, y0 - 2, 22, 2, C); px(ctx, cx - 7, y0 - 4, 14, 2, C); px(ctx, cx - 12, y0 + 11, 2, 1, "#f0b8c4"); px(ctx, cx + 10, y0 + 11, 2, 1, "#f0b8c4");
    // 两只小手向上张开
    px(ctx, cx - 16, y0 + 2, 3, 2, C);
    px(ctx, cx + 13, y0 + 2, 3, 2, C);
    eyes(ctx, cx, y0, "wide");
    return y0;
  }

  // 镐头:两帧挥舞(举起 / 砸地带碎屑)
  function pickaxe(ctx, cx, y0, up) {
    const H = "#8a6b4a"; // 木柄
    const M = "#b9c2c9"; // 铁头
    if (up) {
      px(ctx, cx + 14, y0 + 4, 2, 2, H);
      px(ctx, cx + 16, y0 + 1, 2, 3, H);
      px(ctx, cx + 13, y0 - 2, 8, 2, M);
      px(ctx, cx + 12, y0 - 1, 2, 2, M);
      px(ctx, cx + 20, y0 - 1, 2, 2, M);
    } else {
      px(ctx, cx + 14, y0 + 9, 2, 3, H);
      px(ctx, cx + 15, y0 + 12, 2, 3, H);
      px(ctx, cx + 13, GY - 3, 8, 2, M);
      px(ctx, cx + 22, GY - 5, 1, 1, "#8a8478"); // 碎屑
      px(ctx, cx + 24, GY - 7, 1, 1, "#6b665c");
      px(ctx, cx + 21, GY - 8, 1, 1, "#a89f8c");
    }
  }

  // 爱因斯坦发型 V4:精髓是"顶秃侧蓬"——头顶只留零星呆毛,
  // 两鬓向外爆炸,再配白八字胡。盖顶式的假发会像律师
  function einsteinHair(ctx, cx, y0) {
    const W = "#ddd6c8";
    // 顶部:一冠起伏的乱发(相连但高低错落,两端露出头顶,不盖死)
    px(ctx, cx - 9, y0 - 5, 4, 3, W);
    px(ctx, cx - 5, y0 - 7, 4, 4, W);
    px(ctx, cx - 1, y0 - 8, 4, 4, W);
    px(ctx, cx + 3, y0 - 7, 4, 4, W);
    px(ctx, cx + 7, y0 - 5, 4, 3, W);
    // 两鬓小侧翼(和顶发之间留缝,避免连成假发)
    px(ctx, cx - 16, y0 + 1, 3, 4, W);
    px(ctx, cx - 17, y0 + 3, 2, 3, W);
    px(ctx, cx + 13, y0 + 1, 3, 4, W);
    px(ctx, cx + 15, y0 + 3, 2, 3, W);
    // 白八字胡(中间留缝)
    px(ctx, cx - 5, y0 + 9, 4, 2, W);
    px(ctx, cx + 2, y0 + 9, 4, 2, W);
  }

  function heart(ctx, x, y, a) {
    ctx.globalAlpha = a;
    px(ctx, x, y, 1, 1, "#d4537e");
    px(ctx, x + 2, y, 1, 1, "#d4537e");
    px(ctx, x, y + 1, 3, 1, "#d4537e");
    px(ctx, x + 1, y + 2, 1, 1, "#d4537e");
    ctx.globalAlpha = 1;
  }

  function zzz(ctx, cx, topY, t, n) {
    ctx.font = "500 13px monospace";
    for (let i = 0; i < n; i++) {
      const ph = (t / 40 + i * 0.9) % 3;
      ctx.globalAlpha = Math.max(0, 0.75 - ph / 3.5);
      ctx.fillStyle = "#a89f8c";
      ctx.fillText("z", (cx - 2) * S + ph * 8, topY * S - ph * 12);
    }
    ctx.globalAlpha = 1;
  }

  // 完工彩纸:按等级撒像素纸屑,循环飘落
  function confetti(ctx, canvas, cx, level, t) {
    const n = level >= 2 ? 16 : 7;
    for (let i = 0; i < n; i++) {
      const seedX = (i * 37 + i * i * 11) % 64;              // 稳定的伪随机横向分布
      const x = (cx - 32 + seedX) * S;
      const speed = 0.35 + (i % 4) * 0.12;
      const fall = (t * speed + i * 29) % 130;
      const y = (GY - 46) * S + fall;
      if (y > (GY + 1) * S) continue;
      const a = 1 - fall / 140;
      ctx.globalAlpha = Math.max(0.15, a);
      const sway = Math.sin(t * 0.1 + i) * 2;
      ctx.fillStyle = CONFETTI[i % CONFETTI.length];
      ctx.fillRect(Math.round(x + sway), Math.round(y), S - 1, S - 1);
    }
    ctx.globalAlpha = 1;
  }

  function bubbleBox(ctx, canvas, text, cx, topPx) {
    // 注意:高 DPI 下 canvas.width 是物理像素,布局要用 CSS 逻辑宽度
    const W = canvas.clientWidth || canvas.width;
    ctx.font = "12px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
    // 逐字换行(中文没有空格可断,按字符断),最多 3 行,超出截断加省略号。
    // 不能用 fillText 的 maxWidth 挤压——中文会被压成一团
    const maxW = W - 28;
    const lines = [];
    let line = "";
    let truncated = false;
    for (const ch of Array.from(text)) {
      if (line && ctx.measureText(line + ch).width > maxW) {
        if (lines.length === 2) {
          truncated = true;
          break;
        }
        lines.push(line);
        line = "";
      }
      line += ch;
    }
    if (line) lines.push(line);
    if (truncated) {
      let last = lines[lines.length - 1];
      while (last && ctx.measureText(last + "…").width > maxW) last = last.slice(0, -1);
      lines[lines.length - 1] = last + "…";
    }
    const lineH = 16;
    const w = Math.min(
      Math.max(...lines.map((l) => ctx.measureText(l).width)) + 20,
      W - 8
    );
    const h = lines.length * lineH + 8;
    const x = Math.min(Math.max(cx * S - w / 2, 4), W - w - 4);
    const y = Math.max(topPx - h - 10, 2);
    ctx.fillStyle = "rgba(24,22,20,0.92)";
    ctx.strokeStyle = "rgba(217,119,87,0.6)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#e8e2d8";
    lines.forEach((l, i) => ctx.fillText(l, x + 10, y + 16 + i * lineH));
  }

  // 右上角状态框:终端风 "❯ cmd..." 绿字 + 动态省略号
  function statusTag(ctx, canvas, cx, y0, text, t) {
    if (bulbT > 0) return; // 灯泡时刻让位,不和状态框叠在一起
    const W = canvas.clientWidth || canvas.width;
    ctx.font = "bold 12px Consolas, monospace";
    const dots = ".".repeat(Math.floor(t / 20) % 4);
    text = "❯ " + text;
    const w = ctx.measureText(text + "...").width + 12;
    const bx = Math.min((cx + 13) * S, W - w - 4);
    const by = Math.max((y0 - 13) * S, 2);
    ctx.fillStyle = "rgba(18,16,14,0.95)";
    ctx.strokeStyle = "rgba(122,222,122,0.45)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(bx, by, w, 20, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#7ade7a";
    ctx.fillText(text + dots, bx + 6, by + 14);
  }

  // 工具提示小标签(比气泡矮一号,不抢戏)
  function toolTag(ctx, canvas, text, cx, topPx) {
    ctx.font = "11px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
    const tw = ctx.measureText(text).width;
    const x = Math.min(Math.max(cx * S - (tw + 12) / 2, 4), canvas.width - tw - 16);
    const y = Math.max(topPx - 24, 2);
    ctx.fillStyle = "rgba(24,22,20,0.82)";
    ctx.beginPath();
    ctx.roundRect(x, y, tw + 12, 17, 6);
    ctx.fill();
    ctx.fillStyle = "#c9b79a";
    ctx.fillText(text, x + 6, y + 13);
  }

  let blinkT = 0;
  let prevKey;
  let puffT = 0;   // 切换状态时的烟尘帧
  let patT = 0;    // 连续摸头计时
  let wasThinking = false;
  let bulbT = 0;   // 灵光一闪:思考结束瞬间的灯泡帧
  let prevState = "idle"; // 检测 limit→idle 的睡醒时刻

  function isNight() {
    const h = new Date().getHours();
    return h >= 23 || h < 7;
  }

  // 矿灯 + 向下的光锥
  function headlamp(ctx, cx, y0) {
    px(ctx, cx - 4, y0 - 2, 8, 2, "#f0d468");
    ctx.fillStyle = "rgba(240,212,104,0.10)";
    ctx.beginPath();
    ctx.moveTo(cx * S, (y0 + 1) * S);
    ctx.lineTo((cx - 9) * S, (GY + 2) * S);
    ctx.lineTo((cx + 9) * S, (GY + 2) * S);
    ctx.closePath();
    ctx.fill();
  }

  // ---- idle 漫游状态(皮肤内部) ----
  let wx = 0;               // 相对默认位置的网格偏移
  let wTarget = 0;
  let wMode = "stand";      // stand | walk | doze
  let wUntil = -1;

  function idleThink(t) {
    if (t < wUntil) return;
    const h = new Date().getHours();
    const night = h >= 23 || h < 7;
    const r = Math.random();
    if (r < (night ? 0.45 : 0.12)) {
      wMode = "doze";
      wUntil = t + 700 + Math.random() * 900;   // 打个盹:12-27 秒
    } else if (r < (night ? 0.55 : 0.22)) {
      wMode = "stretch";                         // 伸个懒腰打个哈欠
      wUntil = t + 55;
    } else if (r < 0.5) {
      wMode = "walk";
      wTarget = Math.round(Math.random() * 24 - 12);
      wUntil = t + 100000; // 走到为止
    } else {
      wMode = "stand";
      wUntil = t + 240 + Math.random() * 360;   // 发呆 4-10 秒
    }
  }

  function draw(ctx, canvas, state, warn, bubble, t, extra) {
    const x = extra || {};
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const baseCx = 25;

    // idle 才漫游;其他状态回到中间
    // 睡醒了(额度恢复/盹结束回到 idle):先伸个懒腰
    if (prevState === "limit" && state === "idle") {
      wMode = "stretch";
      wUntil = t + 60;
    }
    prevState = state;

    let dx = 0;
    if (state === "idle" && !x.dragging) {
      idleThink(t);
      if (wMode === "walk") {
        if (t % 6 === 0) wx += Math.sign(wTarget - wx);
        if (wx === wTarget) {
          wMode = "stand";
          wUntil = t + 240 + Math.random() * 360;
        }
      }
      dx = wx;
    } else if (wx !== 0 && state !== "idle") {
      // 一有正事,快步走回中间
      if (t % 2 === 0) wx += Math.sign(-wx);
      dx = wx;
    }
    // 思考时叼着烟斗来回踱步(慢速正弦往返,转身停顿时腿不动)
    let pace = 0;
    let pacing = false;
    const thinkingNow = state === "working" && !x.toolNote && !x.dragging;
    if (thinkingNow) {
      pace = Math.round(Math.sin(t * 0.018) * 7);
      pacing = Math.abs(Math.cos(t * 0.018)) > 0.35;
    }
    // 想通了!思考一结束(开始动手或直接完工)右上角弹灯泡
    if (wasThinking && !thinkingNow && (state === "working" || state === "done")) {
      bulbT = 50;
    }
    wasThinking = thinkingNow;
    // 工具报错:恼火地小幅左右晃
    let cx = baseCx + dx + pace;
    if (x.oops) cx += t % 6 < 3 ? 1 : -1;

    // 地面小影子(被拎起来时影子缩小变淡)
    ctx.fillStyle = x.dragging ? "rgba(0,0,0,0.10)" : "rgba(0,0,0,0.18)";
    ctx.beginPath();
    ctx.ellipse(cx * S, GY * S + 4, (x.dragging ? 10 : 15) * S, 2.4 * S, 0, 0, Math.PI * 2);
    ctx.fill();

    if (blinkT > 0) blinkT--;
    else if (Math.random() < 0.012) blinkT = 8;
    const bl = blinkT > 0;

    let y0 = 0;

    if (x.dragging) {
      // 被拎起来:悬空乱蹬,瞪大眼
      y0 = bodyDangling(ctx, cx, t);
    } else if (state === "limit") {
      // 额度耗尽:睡觉
      y0 = body(ctx, cx, { eyes: "closed", lying: true, breath: Math.sin(t * 0.045) > 0 ? 1 : 0 });
      zzz(ctx, cx, GY - 17, t, 3);
    } else if (state === "working") {
      const tired = (x.workSecs || 0) >= 600;
      const note = x.toolNote || "";
      if (note === "跑命令") {
        // 敲键盘 + 右上角 cmd 终端气泡
        y0 = body(ctx, cx, {
          eyes: tired ? "tired" : "up",
          typing: true,
          tap: Math.floor(t / 5) % 2 === 0,
        });
        // 脚边一排 QWER 键帽,随敲击随机亮起
        px(ctx, cx - 12, GY - 7, 24, 6, "#2a2723");            // 键盘底座
        const tapK = Math.floor(t / 5);
        const lit = (tapK * 7 + (tapK >> 2)) % 4;              // 本次点亮哪颗键
        const keys = ["Q", "W", "E", "R"];
        ctx.font = "bold 10px Consolas, monospace";
        ctx.textAlign = "center";
        for (let i = 0; i < 4; i++) {
          const kx = cx - 11 + i * 6;
          px(ctx, kx, GY - 6, 5, 4, i === lit ? "#4a6b4a" : "#454c58");
          ctx.fillStyle = i === lit ? "#9fe8a0" : "#b3aca0";
          ctx.fillText(keys[i], (kx + 2.5) * S, (GY - 3.2) * S);
        }
        ctx.textAlign = "start";
        if (!bubble) statusTag(ctx, canvas, cx, y0, "cmd", t);
      } else if (note === "读文件") {
        // 戴博士帽和单片眼镜,低头仔细翻书
        y0 = body(ctx, cx, { eyes: "tired" });
        px(ctx, cx - 8, y0 - 4, 16, 3, "#2e3440");    // 博士帽帽座(罩住穹顶)
        px(ctx, cx - 11, y0 - 6, 22, 2, "#232a36");   // 方板(抬高越过穹顶)
        px(ctx, cx - 11, y0 - 6, 22, 1, "#3d4759");   // 板面高光
        px(ctx, cx - 1, y0 - 7, 2, 1, "#e0c05a");     // 顶扣
        const sw = Math.sin(t * 0.05) > 0 ? 1 : 0;    // 流苏轻摆
        px(ctx, cx + 9 + sw, y0 - 4, 1, 3, "#e0c05a");
        px(ctx, cx + 8 + sw, y0 - 1, 2, 2, "#c9a53a"); // 流苏穗
        const G = "#e0c05a"; // 金丝镜框
        px(ctx, cx + 1, y0 + 3, 5, 1, G);           // 单片眼镜:圈住右眼
        px(ctx, cx + 1, y0 + 8, 5, 1, G);
        px(ctx, cx + 1, y0 + 4, 1, 4, G);
        px(ctx, cx + 5, y0 + 4, 1, 4, G);
        px(ctx, cx + 6, y0 + 9, 1, 2, G);           // 垂下的链子
        px(ctx, cx + 7, y0 + 12, 1, 2, G);
        px(ctx, cx - 8, GY - 8, 7, 5, "#e8e2d8");   // 左页
        px(ctx, cx + 1, GY - 8, 7, 5, "#f0eadf");   // 右页
        px(ctx, cx - 1, GY - 9, 2, 6, "#8a8478");   // 书脊
        const ph = Math.floor(t / 34) % 4;          // 慢速细读翻页
        if (ph === 1) px(ctx, cx - 4, GY - 10, 3, 2, "#fffdf6");
        else if (ph === 2) px(ctx, cx - 1, GY - 11, 2, 3, "#fffdf6");
        else if (ph === 3) px(ctx, cx + 2, GY - 10, 3, 2, "#fffdf6");
        if (!bubble) statusTag(ctx, canvas, cx, y0, "reading", t);
      } else if (note === "改代码") {
        // 工程帽 + 抡镐头挖地
        const strike = Math.floor(t / 14) % 2 === 0;
        y0 = body(ctx, cx, { eyes: "open", bounce: strike ? 0 : 1 });
        px(ctx, cx - 8, y0 - 6, 16, 3, "#f7d02e");   // 帽顶(工地黄,扣住穹顶)
        px(ctx, cx - 12, y0 - 3, 24, 1, "#e6eef8");  px(ctx, cx - 12, y0 - 2, 24, 1, "#c9971d");  // 反光白条+深黄檐
        px(ctx, cx - 2, y0 - 7, 4, 1, "#fbe36a");    // 帽脊
        pickaxe(ctx, cx, y0, !strike);
        if (!bubble) statusTag(ctx, canvas, cx, y0, "coding", t);
      } else if (note === "搜代码") {
        // 拿放大镜在地上左右扫
        y0 = body(ctx, cx, { eyes: "tired" });
        const mx = cx - 5 + Math.round(Math.sin(t * 0.07) * 8);
        const M = "#b9c2c9";
        px(ctx, mx - 2, GY - 13, 4, 1, M);           // 镜圈
        px(ctx, mx - 3, GY - 12, 1, 3, M);
        px(ctx, mx + 2, GY - 12, 1, 3, M);
        px(ctx, mx - 2, GY - 9, 4, 1, M);
        if (Math.floor(t / 18) % 3 === 0) px(ctx, mx - 1, GY - 12, 1, 1, "#fffdf6"); // 镜面反光
        px(ctx, mx + 3, GY - 8, 2, 2, "#8a6b4a");    // 手柄
        px(ctx, mx + 5, GY - 6, 2, 2, "#8a6b4a");
        if (!bubble) statusTag(ctx, canvas, cx, y0, "searching", t);
      } else if (note === "查资料") {
        // 身旁一颗自转的小地球
        y0 = body(ctx, cx, { eyes: "up" });
        const gx = cx + 17, gy = y0 - 3;
        const B = "#5a8fd4";
        px(ctx, gx - 2, gy - 3, 4, 1, B);
        px(ctx, gx - 3, gy - 2, 6, 3, B);
        px(ctx, gx - 2, gy + 1, 4, 1, B);
        for (let i = 0; i < 2; i++) {                // 自转的大陆
          const lx = gx - 3 + ((Math.floor(t / 12) + i * 3) % 6);
          px(ctx, lx, gy - 1 + i, 2, 1, "#9ac47a");
        }
        if (!bubble) statusTag(ctx, canvas, cx, y0, "browsing", t);
      } else if (note === "派子任务") {
        // 左右冒出两只迷你分身一起干活
        y0 = body(ctx, cx, { eyes: "open" });
        for (const [mx, phase] of [[cx - 20, 0], [cx + 20, 1.6]]) {
          const hop = Math.abs(Math.sin(t * 0.09 + phase)) > 0.72 ? 1 : 0;
          const my = GY - 7 - hop;
          px(ctx, mx - 4, my, 8, 5, C);
          px(ctx, mx - 3, my + 5, 1, 2 + hop, C);
          px(ctx, mx + 2, my + 5, 1, 2 + hop, C);
          px(ctx, mx - 2, my + 1, 1, 1, K);
          px(ctx, mx + 1, my + 1, 1, 1, K);
        }
        if (!bubble) statusTag(ctx, canvas, cx, y0, "agents", t);
      } else if (note === "列计划") {
        // 面前的写字板,任务项逐条打绿勾
        y0 = body(ctx, cx, { eyes: "tired" });
        px(ctx, cx - 5, GY - 13, 10, 9, "#e8e2d8");  // 板面
        px(ctx, cx - 1, GY - 14, 3, 1, "#8a8478");   // 夹子
        const done = Math.floor(t / 35) % 4;
        for (let i = 0; i < 3; i++) {
          px(ctx, cx - 3, GY - 11 + i * 3, 4, 1, "#8a8478"); // 条目
          if (i < done) px(ctx, cx + 2, GY - 11 + i * 3, 2, 1, "#4a9a4a"); // 绿勾
        }
        if (!bubble) statusTag(ctx, canvas, cx, y0, "planning", t);
      } else if (note) {
        // 其他工具(MCP 等):通用工作态 + 状态框显示短名
        y0 = body(ctx, cx, { eyes: tired ? "tired" : "up" });
        const n = Math.floor(t / 22) % 4;
        for (let i = 0; i < n; i++) px(ctx, cx + 10 + i * 3, y0 - 4, 2, 2, "#a89f8c");
        if (!bubble) statusTag(ctx, canvas, cx, y0, note.replace(/^用 /, ""), t);
      } else {
        // 思考中:爱因斯坦炸毛 + 叼烟斗,背着手来回踱步。
        // 面部朝行进方向:眼睛偏向前进侧,烟斗叼在前进侧
        const dir = Math.cos(t * 0.018) >= 0 ? 1 : -1;
        y0 = body(ctx, cx, {
          eyes: tired ? "tired" : "up",
          moving: pacing,
          step: Math.floor(t / 7) % 2 === 0,
          handsBack: true,
          faceDx: dir * 2,
        });
        einsteinHair(ctx, cx, y0);
        if (dir > 0) {
          px(ctx, cx + 4, y0 + 12, 6, 1, "#7a5a3a");   // 烟斗杆(朝右)
          px(ctx, cx + 9, y0 + 11, 3, 3, "#5a4028");   // 烟斗锅
        } else {
          px(ctx, cx - 9, y0 + 12, 6, 1, "#7a5a3a");   // 烟斗杆(朝左)
          px(ctx, cx - 11, y0 + 11, 3, 3, "#5a4028");  // 烟斗锅
        }
        const sx = dir > 0 ? cx + 10 : cx - 11;        // 烟从锅口升起
        for (let i = 0; i < 3; i++) {
          const ph = (t / 30 + i * 0.8) % 3;
          ctx.globalAlpha = Math.max(0, 0.6 - ph / 4);
          px(ctx, sx + Math.round(Math.sin(t * 0.05 + i) * 1.5), y0 + 8 - ph * 4, 2, 2, "#b3aca0");
        }
        ctx.globalAlpha = 1;
        if (!bubble) statusTag(ctx, canvas, cx, y0 - 6, "thinking", t);
      }
      // 干活时被摸头:不停工,但会偷偷冒小心心
      if (x.pat && Math.floor(t / 40) % 2 === 0) heart(ctx, cx - 17, y0 - 5, 0.7);
      // 深夜加班:戴矿灯(挖矿模式已有工程帽,不叠加)
      if (isNight() && note !== "改代码") headlamp(ctx, cx, y0);
      if (tired) {
        // 累了:头侧挂汗珠,一滴一滴往下
        const drip = Math.floor(t / 30) % 3;
        px(ctx, cx + 11, y0 + 1 + drip, 1, 2, "#7fb4d9");
      }
      // 工时角标(干满 1 分钟显示,分钟粒度)
      if ((x.workSecs || 0) >= 60) {
        const label = Math.floor(x.workSecs / 60) + "m";
        ctx.font = "bold 11px Consolas, monospace";
        ctx.fillStyle = "#e0a63b";
        const tw2 = ctx.measureText(label).width;
        const txx = Math.min((cx + 16) * S, (canvas.clientWidth || canvas.width) - tw2 - 4);
        ctx.fillText(label, txx, (y0 + 3) * S);
      }
    } else if (state === "attention") {
      const waited = x.attnSecs || 0;
      if (waited >= 300) {
        // 等太久了:坐地叹气
        y0 = body(ctx, cx, { eyes: "tired", lying: true, breath: Math.sin(t * 0.05) > 0 ? 1 : 0 });
        const ph = (t / 50) % 2;
        ctx.globalAlpha = Math.max(0, 0.5 - ph / 3);
        px(ctx, cx + 10, GY - 20 - ph * 3, 2, 1, "#8a8478"); // 叹出的气
        px(ctx, cx + 12, GY - 22 - ph * 3, 1, 1, "#8a8478");
        ctx.globalAlpha = 1;
      } else if (waited >= 120) {
        // 急了:拿小喇叭喊 + 蹦得更勤
        const hop = t % 45 < 8 ? 2 : 0;
        y0 = body(ctx, cx, { eyes: "wide", wave: true, waveUp: Math.floor(t / 8) % 2 === 0, bounce: hop });
        px(ctx, cx + 15, y0 + 6, 3, 3, AMBER);       // 喇叭口
        px(ctx, cx + 13, y0 + 7, 2, 1, "#b8862e");   // 喇叭柄
        if (Math.floor(t / 10) % 2 === 0) {           // 声波
          px(ctx, cx + 19, y0 + 5, 1, 1, AMBER);
          px(ctx, cx + 20, y0 + 3, 1, 1, AMBER);
          px(ctx, cx + 20, y0 + 8, 1, 1, AMBER);
        }
      } else {
        // 挥手 + 时不时蹦一下
        const hopPh = t % 90;
        const hop = hopPh < 10 ? (hopPh < 5 ? 2 : 1) : 0;
        y0 = body(ctx, cx, {
          eyes: bl ? "closed" : "open",
          wave: true,
          waveUp: Math.floor(t / 12) % 2 === 0,
          bounce: hop,
        });
      }
    } else if (state === "done") {
      const level = x.celebrate || 0;
      const amp = level >= 2 ? 7 : 5;
      const b = Math.abs(Math.sin(t * 0.13)) * amp;
      y0 = body(ctx, cx, { eyes: "happy", bounce: b });
      const ph = Math.floor(t / 18) % 2;
      heart(ctx, cx + (ph ? 15 : -17), y0 - (ph ? 5 : 3), 0.9);
      if (level >= 2) heart(ctx, cx + (ph ? -19 : 17), y0 - (ph ? 2 : 6), 0.7);
      if (level >= 1) confetti(ctx, canvas, cx, level, t);
    } else {
      // idle:摸头 > 打盹 > 站着/漫步
      if (x.pat) {
        patT++;
        if (patT > 120) {
          // 蹭了半天:陶醉,爱心绕圈
          const wob = Math.round(Math.sin(t * 0.15));
          y0 = body(ctx, cx + wob, { eyes: "happy" });
          for (let i = 0; i < 3; i++) {
            const a = t * 0.08 + i * 2.1;
            heart(ctx, cx + Math.round(Math.cos(a) * 13), y0 + 4 + Math.round(Math.sin(a) * 6), 0.85);
          }
        } else {
          y0 = body(ctx, cx, { eyes: "happy" });
          const ph = (t % 50) / 50;
          heart(ctx, cx + 9, y0 - 4 - ph * 5, 0.9 - ph * 0.7);
        }
      } else if (wMode === "stretch") {
        y0 = body(ctx, cx, { stretch: true });
        px(ctx, cx - 1, y0 + 11, 3, 2, "#8a5a3a"); // 哈欠嘴
      } else if (wMode === "doze") {
        y0 = body(ctx, cx, { eyes: "closed", lying: true, breath: Math.sin(t * 0.045) > 0 ? 1 : 0 });
        zzz(ctx, cx, GY - 17, t, 1);
      } else {
        // 偶尔飞过一只蝴蝶,宠物抬头目送
        const cyc = t % 2200;
        const butterfly = cyc < 600;
        const moving = wMode === "walk" && wx !== wTarget;
        y0 = body(ctx, cx, {
          eyes: butterfly ? "up" : bl ? "closed" : "open",
          moving,
          step: Math.floor(t / 6) % 2 === 0,
        });
        if (butterfly) {
          const bx = Math.round(-4 + (cyc / 600) * 58);
          const by = Math.round(y0 - 13 + Math.sin(t * 0.12) * 3);
          const flap = t % 8 < 4;
          px(ctx, bx, by, 1, 1, "#d4537e");                       // 身
          px(ctx, bx - 1, by - (flap ? 1 : 0), 1, 1, "#e0a63b");  // 左翅
          px(ctx, bx + 1, by - (flap ? 0 : 1), 1, 1, "#e0a63b");  // 右翅
        }
      }
      if (!x.pat) patT = 0;
    }

    // 工具报错:头侧漫画式恼火符号(红色井字纹)
    if (x.oops && !x.dragging) {
      const R = "#d05045";
      const ax = cx - 18, ay = y0 - 6;
      px(ctx, ax + 1, ay, 1, 4, R);
      px(ctx, ax + 3, ay, 1, 4, R);
      px(ctx, ax, ay + 1, 4, 1, R);
      px(ctx, ax, ay + 3, 4, 1, R);
    }

    // 状态/工具切换瞬间:脚边扬起一小团烟尘
    const key = state + "|" + (x.toolNote || "");
    if (prevKey !== undefined && key !== prevKey) puffT = 10;
    prevKey = key;
    if (puffT > 0) {
      ctx.globalAlpha = puffT / 14;
      for (const [ox, oy] of [[-16, 0], [16, 2], [-12, -5], [14, -3], [0, 4]]) {
        px(ctx, cx + ox, GY - 4 + oy, 2, 2, "#b3aca0");
      }
      ctx.globalAlpha = 1;
      puffT--;
    }

    // 后台任务:小卫星绕头顶椭圆轨道巡航,尾灯闪烁
    if ((x.bgCount || 0) > 0 && !x.dragging && state !== "limit") {
      const a = t * 0.035;
      const sx = cx + Math.round(Math.cos(a) * 19);
      const sy = y0 - 7 + Math.round(Math.sin(a) * 4);
      const behind = Math.sin(a) < -0.2; // 转到"身后"时变淡
      ctx.globalAlpha = behind ? 0.35 : 1;
      px(ctx, sx, sy, 2, 2, "#b9c2c9");            // 卫星本体
      px(ctx, sx - 1, sy, 1, 1, "#8a92a8");        // 太阳能板
      px(ctx, sx + 2, sy + 1, 1, 1, "#8a92a8");
      if (Math.floor(t / 12) % 2 === 0) px(ctx, sx + 1, sy - 1, 1, 1, "#e0a63b"); // 闪灯
      ctx.globalAlpha = 1;
      if (x.bgCount > 1) {
        ctx.font = "bold 10px Consolas, monospace";
        ctx.fillStyle = "#b9c2c9";
        ctx.fillText("×" + x.bgCount, (cx - 22) * S, (y0 - 8) * S);
      }
    }

    // 多会话徽章:几路并行就标几
    if ((x.sessions || 0) > 1 && !x.dragging) {
      ctx.font = "bold 11px Consolas, monospace";
      ctx.fillStyle = AMBER;
      ctx.fillText("×" + x.sessions, (cx + 15) * S, (y0 - 3) * S);
    }

    // warn 叠加:头顶琥珀色感叹号(慢闪)
    if (warn && state !== "limit" && !x.dragging && Math.floor(t / 30) % 2 === 0) {
      px(ctx, cx - 1, y0 - 8, 2, 4, AMBER);
      px(ctx, cx - 1, y0 - 3, 2, 2, AMBER);
    }

    // 灵光一闪的灯泡(右上角,先亮后淡出)
    if (bulbT > 0) {
      const bx = cx + 13, by = y0 - 13;
      ctx.globalAlpha = Math.min(1, bulbT / 15);
      px(ctx, bx, by, 4, 1, "#f7d060");            // 玻璃泡
      px(ctx, bx - 1, by + 1, 6, 3, "#f7d060");
      px(ctx, bx, by + 4, 4, 1, "#f7d060");
      px(ctx, bx + 1, by + 1, 2, 2, "#fff6c0");    // 高光
      px(ctx, bx + 1, by + 5, 2, 1, "#8a8478");    // 灯座
      px(ctx, bx + 1, by + 6, 2, 1, "#6b665c");
      if (bulbT > 35) {                             // 初亮时的光芒
        px(ctx, bx - 3, by + 1, 1, 1, "#f7d060");
        px(ctx, bx + 6, by + 1, 1, 1, "#f7d060");
        px(ctx, bx + 1, by - 3, 2, 1, "#f7d060");
        px(ctx, bx - 2, by - 2, 1, 1, "#f0b840");
        px(ctx, bx + 5, by - 2, 1, 1, "#f0b840");
      }
      ctx.globalAlpha = 1;
      bulbT--;
    }

    if (bubble) bubbleBox(ctx, canvas, bubble, cx, y0 * S);
  }

  window.PetRenderer = { draw };
  // 公共绘图工具箱:皮肤文件可复用(像素、气泡、状态框、爱心、Zzz、彩纸)
  window.PetKit = { S, GY, px, heart, zzz, bubbleBox, statusTag, confetti, isNight };
})();
