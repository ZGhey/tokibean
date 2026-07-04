// Pet renderer — the skin layer
// To swap skins, just replace this file, keeping the window.PetRenderer interface intact:
//   PetRenderer.draw(ctx, canvas, state, warn, bubble, t, extra)
// state: idle | working | attention | done | limit
// extra (optional, old skins may ignore it): {
//   sessions   number of sessions currently working (>1 draws an ×N badge)
//   workSecs   duration in seconds of the longest-running current work
//   toolNote   stable English key for the tool in use (e.g. "cmd" / "reading")
//   celebrate  completion-celebration level 0/1/2
//   dragging   currently being dragged
//   pat        mouse hovering over the pet (head pat)
//   bgCount    number of background shells running (draws an orbiting satellite)
//   agentCount number of active subagents (draws a mini-clone each, beside the pet)
// }
// Default character: 拱门·墩墩 (persimmon-orange arched dome), an original figure, freely distributable.

(function () {
  const S = 4;            // pixel scale factor
  const GY = 42;          // grid row of the ground
  const C = "#f2823e";    // persimmon orange (拱门·墩墩)
  const K = "#26221d";    // eyes
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
      // Half-open: upper eyelid pressed down
      px(ctx, L, y0 + 5, 3, 2, K);
      px(ctx, R, y0 + 5, 3, 2, K);
    } else if (mode === "wide") {
      // Wide-eyed (being picked up)
      px(ctx, L, y0 + 3, 3, 4, K);
      px(ctx, R, y0 + 3, 3, 4, K);
    } else {
      px(ctx, L, y0 + 4, 3, 3, K);
      px(ctx, R, y0 + 4, 3, 3, K);
    }
  }

  // Body. Returns the head-top row so overlays can be positioned
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
      // Stretching: both arms raised high overhead
      px(ctx, cx - 16, y0 + 1, 3, 2, C);
      px(ctx, cx - 17, y0 - 2, 2, 3, C);
      px(ctx, cx + 13, y0 + 1, 3, 2, C);
      px(ctx, cx + 15, y0 - 2, 2, 3, C);
      eyes(ctx, cx, y0, "closed");
      return y0;
    }
    if (o.handsBack) {
      // Hands behind back: hands hidden from the front, just a bit of cuff showing at the sides
      px(ctx, cx - 15, y0 + 10, 2, 2, C);
      px(ctx, cx + 13, y0 + 10, 2, 2, C);
      eyes(ctx, cx + (o.faceDx || 0), y0, o.eyes || "open");
      return y0;
    }
    if (o.typing) {
      // Typing: two little hands rise and fall alternately in front
      const tap = o.tap ? 1 : 0;
      px(ctx, cx - 16, y0 + 10 + tap, 3, 3, C);
      px(ctx, cx + 13, y0 + 11 - tap, 3, 3, C);
      eyes(ctx, cx, y0, o.eyes || "open");
      return y0;
    }
    px(ctx, cx - 16, y0 + 8, 3, 3, C); // left little hand
    if (o.wave) {
      if (o.waveUp) {
        px(ctx, cx + 13, y0 + 3, 3, 2, C);
        px(ctx, cx + 16, y0, 2, 3, C);
      } else {
        px(ctx, cx + 13, y0 + 5, 3, 2, C);
        px(ctx, cx + 16, y0 + 2, 2, 3, C);
      }
    } else {
      px(ctx, cx + 13, y0 + 8, 3, 3, C); // right little hand
    }
    eyes(ctx, cx, y0, o.eyes || "open");
    return y0;
  }

  // Dragging: suspended in air, all four little legs kicking
  function bodyDangling(ctx, cx, t) {
    const y0 = GY - 30 + Math.round(Math.sin(t * 0.25));
    const legs = [-11, -5, 3, 9];
    for (let i = 0; i < 4; i++) {
      const kick = Math.sin(t * 0.45 + i * 1.7) > 0 ? 1 : 0;
      px(ctx, cx + legs[i], y0 + 15, 2, 5 + kick, C);
    }
    px(ctx, cx - 13, y0, 26, 15, C); px(ctx, cx - 11, y0 - 2, 22, 2, C); px(ctx, cx - 7, y0 - 4, 14, 2, C); px(ctx, cx - 12, y0 + 11, 2, 1, "#f0b8c4"); px(ctx, cx + 10, y0 + 11, 2, 1, "#f0b8c4");
    // Two little hands spread upward
    px(ctx, cx - 16, y0 + 2, 3, 2, C);
    px(ctx, cx + 13, y0 + 2, 3, 2, C);
    eyes(ctx, cx, y0, "wide");
    return y0;
  }

  // Pickaxe: two swing frames (raised / striking ground with debris)
  function pickaxe(ctx, cx, y0, up) {
    const H = "#8a6b4a"; // wooden handle
    const M = "#b9c2c9"; // iron head
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
      px(ctx, cx + 22, GY - 5, 1, 1, "#8a8478"); // debris
      px(ctx, cx + 24, GY - 7, 1, 1, "#6b665c");
      px(ctx, cx + 21, GY - 8, 1, 1, "#a89f8c");
    }
  }

  // Einstein hair V4: the essence is "bald on top, bushy at the sides" — only stray
  // wisps on the crown, temples exploding outward, plus a white handlebar mustache.
  // A wig that caps the whole top would look like a lawyer's.
  function einsteinHair(ctx, cx, y0) {
    const W = "#ddd6c8";
    // Top: a crest of undulating messy hair (connected but uneven; both ends leave the crown showing, not capped)
    px(ctx, cx - 9, y0 - 5, 4, 3, W);
    px(ctx, cx - 5, y0 - 7, 4, 4, W);
    px(ctx, cx - 1, y0 - 8, 4, 4, W);
    px(ctx, cx + 3, y0 - 7, 4, 4, W);
    px(ctx, cx + 7, y0 - 5, 4, 3, W);
    // Little side wings at the temples (gap from the top hair, so it doesn't merge into a wig)
    px(ctx, cx - 16, y0 + 1, 3, 4, W);
    px(ctx, cx - 17, y0 + 3, 2, 3, W);
    px(ctx, cx + 13, y0 + 1, 3, 4, W);
    px(ctx, cx + 15, y0 + 3, 2, 3, W);
    // White handlebar mustache (gap in the middle)
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

  // Completion confetti: scatter pixel paper by level, looping as it falls
  function confetti(ctx, canvas, cx, level, t) {
    const n = level >= 2 ? 16 : 7;
    for (let i = 0; i < n; i++) {
      const seedX = (i * 37 + i * i * 11) % 64;              // stable pseudo-random horizontal spread
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
    // Note: at high DPI canvas.width is physical pixels, so lay out with the CSS logical width
    const W = canvas.clientWidth || canvas.width;
    ctx.font = "12px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
    // Word-aware wrap: keep Latin words whole (never split mid-word), break CJK per character
    // (no spaces to break on) and at spaces; max 3 lines, ellipsize any overflow. Can't use
    // fillText's maxWidth to squeeze — Chinese would get crushed together.
    const maxW = W - 28;
    const isCJK = (ch) => {
      const c = ch.codePointAt(0);
      return (c >= 0x2e80 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff) ||
        (c >= 0xff00 && c <= 0xffef) || (c >= 0x20000 && c <= 0x3ffff);
    };
    // Tokens: whole Latin words, single CJK chars, and spaces (soft breaks)
    const tokens = [];
    let word = "";
    for (const ch of Array.from(text)) {
      if (ch === " ") {
        if (word) { tokens.push(word); word = ""; }
        tokens.push(" ");
      } else if (isCJK(ch)) {
        if (word) { tokens.push(word); word = ""; }
        tokens.push(ch);
      } else {
        word += ch;
      }
    }
    if (word) tokens.push(word);
    const lines = [];
    let line = "";
    let truncated = false;
    outer: for (const tok of tokens) {
      if (tok === " ") {
        if (line && ctx.measureText(line + " ").width <= maxW) line += " ";
        continue;
      }
      // A single token wider than a whole line falls back to per-character breaking
      const units = ctx.measureText(tok).width > maxW ? Array.from(tok) : [tok];
      for (const unit of units) {
        if (line && ctx.measureText(line + unit).width > maxW) {
          if (lines.length === 2) { truncated = true; break outer; }
          lines.push(line);
          line = "";
        }
        line += unit;
      }
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
    const y = Math.max(topPx - h - 24, 2); // clear the dome (~16px above the body top) with a small gap
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

  // Top-right status box: terminal-style "❯ cmd..." green text + animated ellipsis
  function statusTag(ctx, canvas, cx, y0, text, t) {
    if (bulbT > 0) return; // yield during the lightbulb moment, don't overlap the status box
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

  // Small tooltip label (one size smaller than the bubble, doesn't steal the show)
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
  let puffT = 0;   // dust frames when switching states
  let patT = 0;    // continuous head-pat timer
  let wasThinking = false;
  let bulbT = 0;   // flash of insight: lightbulb frames the instant thinking ends
  let prevState = "idle"; // detect the wake-up moment of limit→idle

  function isNight() {
    const h = new Date().getHours();
    return h >= 23 || h < 7;
  }

  // Night ambience: a crescent moon + a few stars in the upper-left sky
  function nightScene(ctx) {
    // Upper-left so the status tag / badges on the right never cover it (full disc minus an offset disc)
    const mx = 8 * S, my = 7 * S, mr = 3.5 * S;
    ctx.save();
    ctx.fillStyle = "#f3e7a6";
    ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath(); ctx.arc(mx + mr * 0.7, my - mr * 0.35, mr, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    px(ctx, 15, 5, 1, 1, "#fff6c0"); // a few tiny stars
    px(ctx, 4, 14, 1, 1, "#fff6c0");
    px(ctx, 14, 12, 1, 1, "#fff6c0");
  }

  // ---- idle roaming state (skin-internal) ----
  let wx = 0;               // grid offset relative to the default position
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
      wUntil = t + 700 + Math.random() * 900;   // take a nap: 12-27 seconds
    } else if (r < (night ? 0.55 : 0.22)) {
      wMode = "stretch";                         // stretch and yawn
      wUntil = t + 55;
    } else if (r < 0.5) {
      wMode = "walk";
      wTarget = Math.round(Math.random() * 24 - 12);
      wUntil = t + 100000; // until it arrives
    } else {
      wMode = "stand";
      wUntil = t + 240 + Math.random() * 360;   // zone out for 4-10 seconds
    }
  }

  function draw(ctx, canvas, state, warn, bubble, t, extra) {
    const x = extra || {};
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const baseCx = 25;

    // Only roam while idle; other states return to the center
    // Just woke up (quota restored / nap ended, back to idle): stretch first
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
      // As soon as there's real work, briskly walk back to the center
      if (t % 2 === 0) wx += Math.sign(-wx);
      dx = wx;
    }
    // While thinking, pace back and forth with a pipe (slow sine round-trip; legs still during turn-around pauses)
    let pace = 0;
    let pacing = false;
    const thinkingNow = state === "working" && !x.toolNote && !x.dragging;
    if (thinkingNow) {
      pace = Math.round(Math.sin(t * 0.018) * 7);
      pacing = Math.abs(Math.cos(t * 0.018)) > 0.35;
    }
    // Figured it out! The moment thinking ends (starts acting, or finishes outright), pop a lightbulb in the top-right
    if (wasThinking && !thinkingNow && (state === "working" || state === "done")) {
      bulbT = 50;
    }
    wasThinking = thinkingNow;
    // Tool error: shake side to side a little in annoyance
    let cx = baseCx + dx + pace;
    if (x.oops) cx += t % 6 < 3 ? 1 : -1;

    // Night ambience (crescent moon) drawn behind the pet
    if (isNight() && !x.dragging) nightScene(ctx);

    // Small ground shadow (shrinks and fades when picked up)
    ctx.fillStyle = x.dragging ? "rgba(0,0,0,0.10)" : "rgba(0,0,0,0.18)";
    ctx.beginPath();
    ctx.ellipse(cx * S, GY * S + 4, (x.dragging ? 10 : 15) * S, 2.4 * S, 0, 0, Math.PI * 2);
    ctx.fill();

    if (blinkT > 0) blinkT--;
    else if (Math.random() < 0.012) blinkT = 8;
    const bl = blinkT > 0;

    let y0 = 0;

    if (x.dragging) {
      // Picked up: suspended and kicking, wide-eyed
      y0 = bodyDangling(ctx, cx, t);
    } else if (state === "limit") {
      // Quota exhausted: sleeping
      y0 = body(ctx, cx, { eyes: "closed", lying: true, breath: Math.sin(t * 0.045) > 0 ? 1 : 0 });
      zzz(ctx, cx, GY - 17, t, 3);
    } else if (state === "working") {
      const tired = (x.workSecs || 0) >= 600;
      const note = x.toolNote || "";
      if (note === "cmd") {
        // Typing + top-right cmd terminal bubble
        y0 = body(ctx, cx, {
          eyes: tired ? "tired" : "up",
          typing: true,
          tap: Math.floor(t / 5) % 2 === 0,
        });
        // A row of QWER keycaps at the feet, lighting up randomly with each tap
        px(ctx, cx - 12, GY - 7, 24, 6, "#2a2723");            // keyboard base
        const tapK = Math.floor(t / 5);
        const lit = (tapK * 7 + (tapK >> 2)) % 4;              // which key lights up this time
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
      } else if (note === "reading") {
        // Wearing a mortarboard and monocle, head bowed carefully turning pages
        y0 = body(ctx, cx, { eyes: "tired" });
        px(ctx, cx - 8, y0 - 4, 16, 3, "#2e3440");    // mortarboard base (caps the dome)
        px(ctx, cx - 11, y0 - 6, 22, 2, "#232a36");   // flat board (raised to clear the dome)
        px(ctx, cx - 11, y0 - 6, 22, 1, "#3d4759");   // board-surface highlight
        px(ctx, cx - 1, y0 - 7, 2, 1, "#e0c05a");     // top button
        const sw = Math.sin(t * 0.05) > 0 ? 1 : 0;    // tassel swaying gently
        px(ctx, cx + 9 + sw, y0 - 4, 1, 3, "#e0c05a");
        px(ctx, cx + 8 + sw, y0 - 1, 2, 2, "#c9a53a"); // tassel fringe
        const G = "#e0c05a"; // gold wire frame
        px(ctx, cx + 1, y0 + 3, 5, 1, G);           // monocle: ringing the right eye
        px(ctx, cx + 1, y0 + 8, 5, 1, G);
        px(ctx, cx + 1, y0 + 4, 1, 4, G);
        px(ctx, cx + 5, y0 + 4, 1, 4, G);
        px(ctx, cx + 6, y0 + 9, 1, 2, G);           // dangling chain
        px(ctx, cx + 7, y0 + 12, 1, 2, G);
        px(ctx, cx - 8, GY - 8, 7, 5, "#e8e2d8");   // left page
        px(ctx, cx + 1, GY - 8, 7, 5, "#f0eadf");   // right page
        px(ctx, cx - 1, GY - 9, 2, 6, "#8a8478");   // spine
        const ph = Math.floor(t / 34) % 4;          // slow, careful page-turning
        if (ph === 1) px(ctx, cx - 4, GY - 10, 3, 2, "#fffdf6");
        else if (ph === 2) px(ctx, cx - 1, GY - 11, 2, 3, "#fffdf6");
        else if (ph === 3) px(ctx, cx + 2, GY - 10, 3, 2, "#fffdf6");
        if (!bubble) statusTag(ctx, canvas, cx, y0, "reading", t);
      } else if (note === "coding") {
        // Hard hat + swinging a pickaxe to dig
        const strike = Math.floor(t / 14) % 2 === 0;
        y0 = body(ctx, cx, { eyes: "open", bounce: strike ? 0 : 1 });
        px(ctx, cx - 8, y0 - 6, 16, 3, "#f7d02e");   // hat crown (site yellow, capping the dome)
        px(ctx, cx - 12, y0 - 3, 24, 1, "#e6eef8");  px(ctx, cx - 12, y0 - 2, 24, 1, "#c9971d");  // reflective white stripe + dark-yellow brim
        px(ctx, cx - 2, y0 - 7, 4, 1, "#fbe36a");    // hat ridge
        pickaxe(ctx, cx, y0, !strike);
        if (!bubble) statusTag(ctx, canvas, cx, y0, "coding", t);
      } else if (note === "searching") {
        // Sweeping a magnifying glass left and right across the ground
        y0 = body(ctx, cx, { eyes: "tired" });
        const mx = cx - 5 + Math.round(Math.sin(t * 0.07) * 8);
        const M = "#b9c2c9";
        px(ctx, mx - 2, GY - 13, 4, 1, M);           // lens ring
        px(ctx, mx - 3, GY - 12, 1, 3, M);
        px(ctx, mx + 2, GY - 12, 1, 3, M);
        px(ctx, mx - 2, GY - 9, 4, 1, M);
        if (Math.floor(t / 18) % 3 === 0) px(ctx, mx - 1, GY - 12, 1, 1, "#fffdf6"); // lens glare
        px(ctx, mx + 3, GY - 8, 2, 2, "#8a6b4a");    // handle
        px(ctx, mx + 5, GY - 6, 2, 2, "#8a6b4a");
        if (!bubble) statusTag(ctx, canvas, cx, y0, "searching", t);
      } else if (note === "browsing") {
        // A little globe spinning beside it
        y0 = body(ctx, cx, { eyes: "up" });
        const gx = cx + 17, gy = y0 - 3;
        const B = "#5a8fd4";
        px(ctx, gx - 2, gy - 3, 4, 1, B);
        px(ctx, gx - 3, gy - 2, 6, 3, B);
        px(ctx, gx - 2, gy + 1, 4, 1, B);
        for (let i = 0; i < 2; i++) {                // rotating continents
          const lx = gx - 3 + ((Math.floor(t / 12) + i * 3) % 6);
          px(ctx, lx, gy - 1 + i, 2, 1, "#9ac47a");
        }
        if (!bubble) statusTag(ctx, canvas, cx, y0, "browsing", t);
      } else if (note === "planning") {
        // A clipboard in front, task items getting green-checked one by one
        y0 = body(ctx, cx, { eyes: "tired" });
        px(ctx, cx - 5, GY - 13, 10, 9, "#e8e2d8");  // board surface
        px(ctx, cx - 1, GY - 14, 3, 1, "#8a8478");   // clip
        const done = Math.floor(t / 35) % 4;
        for (let i = 0; i < 3; i++) {
          px(ctx, cx - 3, GY - 11 + i * 3, 4, 1, "#8a8478"); // item
          if (i < done) px(ctx, cx + 2, GY - 11 + i * 3, 2, 1, "#4a9a4a"); // green check
        }
        if (!bubble) statusTag(ctx, canvas, cx, y0, "planning", t);
      } else if (note) {
        // Other tools (MCP, etc.): generic working pose + status box showing the short name
        y0 = body(ctx, cx, { eyes: tired ? "tired" : "up" });
        const n = Math.floor(t / 22) % 4;
        for (let i = 0; i < n; i++) px(ctx, cx + 10 + i * 3, y0 - 4, 2, 2, "#a89f8c");
        if (!bubble) statusTag(ctx, canvas, cx, y0, note, t);
      } else {
        // Thinking: Einstein-frizzed hair + pipe in mouth, pacing back and forth with hands behind back.
        // Face points in the direction of travel: eyes lean toward the leading side, pipe held on the leading side
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
          px(ctx, cx + 4, y0 + 12, 6, 1, "#7a5a3a");   // pipe stem (facing right)
          px(ctx, cx + 9, y0 + 11, 3, 3, "#5a4028");   // pipe bowl
        } else {
          px(ctx, cx - 9, y0 + 12, 6, 1, "#7a5a3a");   // pipe stem (facing left)
          px(ctx, cx - 11, y0 + 11, 3, 3, "#5a4028");  // pipe bowl
        }
        const sx = dir > 0 ? cx + 10 : cx - 11;        // smoke rising from the bowl
        for (let i = 0; i < 3; i++) {
          const ph = (t / 30 + i * 0.8) % 3;
          ctx.globalAlpha = Math.max(0, 0.6 - ph / 4);
          px(ctx, sx + Math.round(Math.sin(t * 0.05 + i) * 1.5), y0 + 8 - ph * 4, 2, 2, "#b3aca0");
        }
        ctx.globalAlpha = 1;
        if (!bubble) statusTag(ctx, canvas, cx, y0 - 6, "thinking", t);
      }
      // Patted while working: doesn't stop, but secretly leaks a little heart
      if (x.pat && Math.floor(t / 40) % 2 === 0) heart(ctx, cx - 17, y0 - 5, 0.7);
      if (tired) {
        // Tired: a sweat drop hangs at the side of the head, dripping down
        const drip = Math.floor(t / 30) % 3;
        px(ctx, cx + 11, y0 + 1 + drip, 1, 2, "#7fb4d9");
      }
      // Work-time badge (shown after a full minute, minute granularity)
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
        // Waited too long: sits on the ground and sighs
        y0 = body(ctx, cx, { eyes: "tired", lying: true, breath: Math.sin(t * 0.05) > 0 ? 1 : 0 });
        const ph = (t / 50) % 2;
        ctx.globalAlpha = Math.max(0, 0.5 - ph / 3);
        px(ctx, cx + 10, GY - 20 - ph * 3, 2, 1, "#8a8478"); // sighed-out breath
        px(ctx, cx + 12, GY - 22 - ph * 3, 1, 1, "#8a8478");
        ctx.globalAlpha = 1;
      } else if (waited >= 120) {
        // Getting anxious: shouts through a little megaphone + hops more often
        const hop = t % 45 < 8 ? 2 : 0;
        y0 = body(ctx, cx, { eyes: "wide", wave: true, waveUp: Math.floor(t / 8) % 2 === 0, bounce: hop });
        px(ctx, cx + 15, y0 + 6, 3, 3, AMBER);       // megaphone mouth
        px(ctx, cx + 13, y0 + 7, 2, 1, "#b8862e");   // megaphone handle
        if (Math.floor(t / 10) % 2 === 0) {           // sound waves
          px(ctx, cx + 19, y0 + 5, 1, 1, AMBER);
          px(ctx, cx + 20, y0 + 3, 1, 1, AMBER);
          px(ctx, cx + 20, y0 + 8, 1, 1, AMBER);
        }
      } else {
        // Waving + hopping now and then
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
      // idle: head-pat > napping > standing/roaming
      if (x.pat) {
        patT++;
        if (patT > 120) {
          // Nuzzled for a while: blissful, hearts circling
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
        px(ctx, cx - 1, y0 + 11, 3, 2, "#8a5a3a"); // yawning mouth
      } else if (wMode === "doze") {
        y0 = body(ctx, cx, { eyes: "closed", lying: true, breath: Math.sin(t * 0.045) > 0 ? 1 : 0 });
        zzz(ctx, cx, GY - 17, t, 1);
      } else {
        // Now and then a butterfly flutters by; the pet looks up and follows it
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
          px(ctx, bx, by, 1, 1, "#d4537e");                       // body
          px(ctx, bx - 1, by - (flap ? 1 : 0), 1, 1, "#e0a63b");  // left wing
          px(ctx, bx + 1, by - (flap ? 0 : 1), 1, 1, "#e0a63b");  // right wing
        }
      }
      if (!x.pat) patT = 0;
    }

    // Tool error: a comic-style annoyance symbol beside the head (red cross-hatch)
    if (x.oops && !x.dragging) {
      const R = "#d05045";
      const ax = cx - 18, ay = y0 - 6;
      px(ctx, ax + 1, ay, 1, 4, R);
      px(ctx, ax + 3, ay, 1, 4, R);
      px(ctx, ax, ay + 1, 4, 1, R);
      px(ctx, ax, ay + 3, 4, 1, R);
    }

    // The instant a state/tool switches: a little puff of dust kicks up at the feet
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

    // Background tasks: a little satellite cruises an elliptical orbit above the head, tail light blinking
    if ((x.bgCount || 0) > 0 && !x.dragging && state !== "limit") {
      const a = t * 0.035;
      const sx = cx + Math.round(Math.cos(a) * 19);
      const sy = y0 - 7 + Math.round(Math.sin(a) * 4);
      const behind = Math.sin(a) < -0.2; // fades when it swings "behind"
      ctx.globalAlpha = behind ? 0.35 : 1;
      px(ctx, sx, sy, 2, 2, "#b9c2c9");            // satellite body
      px(ctx, sx - 1, sy, 1, 1, "#8a92a8");        // solar panel
      px(ctx, sx + 2, sy + 1, 1, 1, "#8a92a8");
      if (Math.floor(t / 12) % 2 === 0) px(ctx, sx + 1, sy - 1, 1, 1, "#e0a63b"); // blinking light
      ctx.globalAlpha = 1;
      if (x.bgCount > 1) {
        ctx.font = "bold 10px Consolas, monospace";
        ctx.fillStyle = "#b9c2c9";
        ctx.fillText("×" + x.bgCount, (cx - 22) * S, (y0 - 8) * S);
      }
    }

    // Active subagents: a mini persimmon clone per running subagent, sitting at the bottom
    // corners. Independent overlay (does NOT occupy tool_note), so it coexists with whatever
    // the main agent is doing (thinking / cmd / reading / …); distinct from the satellite
    // above, which marks a background shell. Positions are fixed to the canvas — NOT the pet,
    // which paces around — and capped at two so they never clip the narrow canvas; a ×N badge
    // reports the total when there are more.
    if ((x.agentCount || 0) > 0 && !x.dragging && state !== "limit") {
      const n = x.agentCount;
      // Wide flanking positions relative to the pet, so they pace along with it and stay clear
      // of its feet. Two shown (they may run off the narrow canvas edges while pacing — that's
      // fine); a ×N badge reports the total when there are more.
      const slots = [[cx - 20, GY - 7], [cx + 20, GY - 7]];
      const shown = Math.min(n, slots.length);
      for (let i = 0; i < shown; i++) {
        const [mx, my0] = slots[i];
        const hop = Math.abs(Math.sin(t * 0.09 + i * 1.6)) > 0.72 ? 1 : 0;
        const my = my0 - hop;
        px(ctx, mx - 4, my, 8, 5, C);            // clone body
        px(ctx, mx - 3, my + 5, 1, 2 + hop, C);  // legs
        px(ctx, mx + 2, my + 5, 1, 2 + hop, C);
        px(ctx, mx - 2, my + 1, 1, 1, K);        // eyes
        px(ctx, mx + 1, my + 1, 1, 1, K);
      }
      if (n > slots.length) {
        ctx.font = "bold 9px Consolas, monospace";
        ctx.fillStyle = C;
        ctx.fillText("×" + n, (cx - 22) * S, (GY - 10) * S); // total, by the left clone
      }
    }

    // Multi-session badge: mark however many run in parallel
    if ((x.sessions || 0) > 1 && !x.dragging) {
      ctx.font = "bold 11px Consolas, monospace";
      ctx.fillStyle = AMBER;
      ctx.fillText("×" + x.sessions, (cx + 15) * S, (y0 - 3) * S);
    }

    // warn overlay: amber exclamation mark above the head (slow blink)
    if (warn && state !== "limit" && !x.dragging && Math.floor(t / 30) % 2 === 0) {
      px(ctx, cx - 1, y0 - 8, 2, 4, AMBER);
      px(ctx, cx - 1, y0 - 3, 2, 2, AMBER);
    }

    // Flash-of-insight lightbulb (top-right, lights up then fades out)
    if (bulbT > 0) {
      const bx = cx + 13, by = y0 - 13;
      ctx.globalAlpha = Math.min(1, bulbT / 15);
      px(ctx, bx, by, 4, 1, "#f7d060");            // glass bulb
      px(ctx, bx - 1, by + 1, 6, 3, "#f7d060");
      px(ctx, bx, by + 4, 4, 1, "#f7d060");
      px(ctx, bx + 1, by + 1, 2, 2, "#fff6c0");    // highlight
      px(ctx, bx + 1, by + 5, 2, 1, "#8a8478");    // socket
      px(ctx, bx + 1, by + 6, 2, 1, "#6b665c");
      if (bulbT > 35) {                             // rays at first light-up
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
  // Shared drawing toolkit: reusable by skin files (pixels, bubbles, status box, hearts, Zzz, confetti)
  window.PetKit = { S, GY, px, heart, zzz, bubbleBox, statusTag, confetti, isNight };
})();
