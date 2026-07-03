// 皮肤:豆豆 —— 原创小史莱姆(青绿色圆团子)
// 覆盖 window.PetRenderer,复用 window.PetKit 的公共绘图工具。
// 本皮肤为原创形象,可随项目公开分发。

(function () {
  const K = window.PetKit;
  const { S, GY, px } = K;
  const BODY = "#4fb8a8"; // 青绿
  const DARK = "#2e7d71";
  const EYE = "#1d2b28";

  function blob(ctx, cx, o) {
    const squish = o.squish || 0;
    const y0 = GY - 16 + squish - (o.bounce || 0);
    // 圆团子:三段宽度模拟圆
    px(ctx, cx - 8, y0, 16, 4 - squish, BODY);
    px(ctx, cx - 11, y0 + 4 - squish, 22, 8, BODY);
    px(ctx, cx - 8, y0 + 12 - squish, 16, 4 + squish, BODY);
    px(ctx, cx - 11, y0 + 10, 22, 2, DARK); // 底部阴影色
    if (o.eyes === "closed") {
      px(ctx, cx - 5, y0 + 5, 3, 1, EYE);
      px(ctx, cx + 2, y0 + 5, 3, 1, EYE);
    } else if (o.eyes === "happy") {
      for (const ex of [cx - 5, cx + 2]) {
        px(ctx, ex, y0 + 5, 1, 1, EYE);
        px(ctx, ex + 1, y0 + 4, 1, 1, EYE);
        px(ctx, ex + 2, y0 + 5, 1, 1, EYE);
      }
    } else {
      px(ctx, cx - 5, y0 + 4, 2, 3, EYE);
      px(ctx, cx + 3, y0 + 4, 2, 3, EYE);
    }
    return y0;
  }

  function draw(ctx, canvas, state, warn, bubble, t, extra) {
    const x = extra || {};
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let cx = 25;
    if (x.oops) cx += t % 6 < 3 ? 1 : -1;

    ctx.fillStyle = x.dragging ? "rgba(0,0,0,0.10)" : "rgba(0,0,0,0.18)";
    ctx.beginPath();
    ctx.ellipse(cx * S, GY * S + 4, 13 * S, 2.2 * S, 0, 0, Math.PI * 2);
    ctx.fill();

    let y0;
    if (x.dragging) {
      y0 = blob(ctx, cx, { eyes: "open", bounce: 8, squish: -1 });
    } else if (state === "limit") {
      y0 = blob(ctx, cx, { eyes: "closed", squish: 2 });
      K.zzz(ctx, cx, GY - 12, t, 3);
    } else if (state === "working") {
      // 果冻式呼吸蠕动
      const squish = Math.sin(t * 0.08) > 0.4 ? 1 : 0;
      y0 = blob(ctx, cx, { eyes: "open", squish });
      if (!bubble) {
        const label =
          { "跑命令": "cmd", "读文件": "reading", "改代码": "coding", "搜代码": "searching",
            "查资料": "browsing", "派子任务": "agents", "列计划": "planning" }[x.toolNote] ||
          (x.toolNote ? x.toolNote.replace(/^用 /, "") : "thinking");
        K.statusTag(ctx, canvas, cx, y0 + 4, label, t);
      }
      if (K.isNight()) px(ctx, cx - 3, y0 - 2, 6, 2, "#f0d468");
    } else if (state === "attention") {
      const hop = t % 40 < 8 ? 3 : 0;
      y0 = blob(ctx, cx, { eyes: "open", bounce: hop });
      // 头顶蹦出的感叹泡
      if (Math.floor(t / 25) % 2 === 0) px(ctx, cx - 1, y0 - 6, 2, 4, "#e0a63b");
    } else if (state === "done") {
      const b = Math.abs(Math.sin(t * 0.13)) * ((x.celebrate || 0) >= 2 ? 7 : 5);
      y0 = blob(ctx, cx, { eyes: "happy", bounce: b });
      K.heart(ctx, cx + (Math.floor(t / 18) % 2 ? 13 : -15), y0 - 4, 0.9);
      if ((x.celebrate || 0) >= 1) K.confetti(ctx, canvas, cx, x.celebrate, t);
    } else {
      // idle:慢呼吸 + 摸头开心
      const squish = Math.sin(t * 0.04) > 0 ? 1 : 0;
      y0 = blob(ctx, cx, { eyes: x.pat ? "happy" : "open", squish });
      if (x.pat) K.heart(ctx, cx + 8, y0 - 5 - ((t % 50) / 10), 0.8);
    }

    if (warn && state !== "limit" && Math.floor(t / 30) % 2 === 0) {
      px(ctx, cx - 1, y0 - 8, 2, 4, "#e0a63b");
      px(ctx, cx - 1, y0 - 3, 2, 2, "#e0a63b");
    }
    if ((x.sessions || 0) > 1 && !x.dragging) {
      ctx.font = "bold 11px Consolas, monospace";
      ctx.fillStyle = "#e0a63b";
      ctx.fillText("×" + x.sessions, (cx + 13) * S, (y0 - 2) * S);
    }
    if (bubble) K.bubbleBox(ctx, canvas, bubble, cx, y0 * S);
  }

  window.PetRenderer = { draw };
})();
