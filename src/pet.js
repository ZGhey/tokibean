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
//   resetSecs  seconds until the 5-hour window resets (or null); drives the "waking up" stir in limit
//   gazeX/gazeY cursor position in canvas-logical px (or null) → pupils follow the cursor
//   tickle     fast cursor wiggle over the pet → giggling squirm
//   forceWeather demo/test override for the weather layer ("rain"|"wind"); real app uses the clock
// }
// Default character: 拱门·墩墩 (persimmon-orange arched dome), an original figure, freely distributable.

(function () {
  const S = 4;            // pixel scale factor
  const GY = 42;          // grid row of the ground

  // Text scale for the pet's own labels — the bubble, the "❯ cmd…" status tag, the tool tag.
  // Set from extra.textScale each frame (1 = the original sizes). The pet's ART never scales with
  // this: it's the pixel character, and stretching its geometry to make words bigger would be a
  // different pet. Only type grows.
  //
  // The canvas is a fixed 200 CSS px wide no matter how large the pet is drawn (enlargement is a CSS
  // transform — see applyCanvasScale in main.js), so bigger type has strictly less room, not more.
  // Every box below therefore measures its text and CLAMPS to the canvas: `fit()` is the one place
  // that promises a box cannot grow out of frame, whatever the user picks.
  let TS = 1.2; // matches DEFAULT_TEXT_SCALE (main.js / config.rs)

  // The body top (`y0`) is not the top of the pet — it wears things. Reading puts on a mortarboard and
  // coding a hard hat (both rise 7 rows above the body), and thinking grows Einstein hair. A bubble
  // anchored to y0 sits squarely on the hat.
  //
  // But the headgear is per-state, and charging every state for the tallest hat costs the bubble a
  // whole line of text in the states that wear nothing at all. So the clearance is a fact ABOUT THE
  // CURRENT FRAME: `headRoom`, set in draw() from what the pet is actually wearing.
  //
  // The "❯ cmd…" tag doesn't pay it either — since the canvas widened, the tag sits off to the pet's
  // side, horizontally clear of anything on its head.
  const HEADGEAR = { reading: 7, coding: 7 };   // grid rows above the body top
  const HAIR = 6;                               // thinking's Einstein hair
  let headRoom = 0;                             // this frame's clearance, in grid rows

  const fs = (base) => Math.round(base * TS);            // font size at the current text scale
  const sz = (base) => Math.round(base * TS);            // paddings / line heights, likewise
  const fit = (w, W) => Math.min(w, W - 8);              // never wider than the canvas

  // The pet's home column, in grid units: the middle of the canvas, whatever width that is. Hard-coding
  // 25 (the middle of the old 200px canvas) is what pinned the pet to the left when the canvas widened.
  const centreCx = (canvas) => Math.round((canvas.clientWidth || canvas.width) / S / 2);
  const clampX = (x, w, W) => Math.min(Math.max(x, 4), Math.max(4, W - w - 4));

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
    // Open-eyed modes nudge the pupils ±1px toward the cursor (module var `gaze`, set in draw)
    const gx = gaze ? gaze.x : 0, gy = gaze ? gaze.y : 0;
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
      px(ctx, L + 1 + gx, y0 + 3 + gy, 3, 3, K);
      px(ctx, R + 1 + gx, y0 + 3 + gy, 3, 3, K);
    } else if (mode === "tired") {
      // Half-open: upper eyelid pressed down
      px(ctx, L, y0 + 5, 3, 2, K);
      px(ctx, R, y0 + 5, 3, 2, K);
    } else if (mode === "wide") {
      // Wide-eyed (being picked up)
      px(ctx, L + gx, y0 + 3 + gy, 3, 4, K);
      px(ctx, R + gx, y0 + 3 + gy, 3, 4, K);
    } else {
      px(ctx, L + gx, y0 + 4 + gy, 3, 3, K);
      px(ctx, R + gx, y0 + 4 + gy, 3, 3, K);
    }
  }

  // Body. Returns the head-top row so overlays can be positioned.
  // Also sets _bodyRestY0 (module var) — the head-top without bounce, so the bubble stays put
  // while the pet jumps up and down.
  let _bodyRestY0 = 0;
  function body(ctx, cx, o) {
    let y0;
    if (o.lying) {
      _bodyRestY0 = GY - 15;
      y0 = GY - 15 - (o.breath || 0);
    } else {
      _bodyRestY0 = GY - 24;  // body top — bubble anchor (stays put while pet bounces)
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

  // Umbrella held overhead when it's raining: a red canopy sheltering the head, pole down the right
  // side into a little hand. Offset right so the pole never crosses the face.
  function umbrella(ctx, cx, y0) {
    const U = "#d0544e", D = "#a83f3a", P = "#8a6b4a";
    const uy = y0 - 11;
    px(ctx, cx - 1, uy, 2, 1, U);          // top nub
    px(ctx, cx - 3, uy + 1, 6, 1, U);
    px(ctx, cx - 6, uy + 2, 12, 1, U);
    px(ctx, cx - 8, uy + 3, 16, 1, U);     // widest canopy row
    px(ctx, cx - 8, uy + 4, 16, 1, D);     // rim (shadowed underside)
    for (const sx of [cx - 7, cx - 3, cx + 2, cx + 6]) px(ctx, sx, uy + 5, 1, 1, D); // scalloped drips
    px(ctx, cx + 6, uy + 5, 1, 8, P);      // pole down the right side
    px(ctx, cx + 5, uy + 12, 3, 2, C);     // little hand gripping the pole
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
    ctx.font = fs(12) + "px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
    // Word-aware wrap: keep Latin words whole (never split mid-word), break CJK per character
    // (no spaces to break on) and at spaces; ellipsize any overflow. Can't use fillText's maxWidth
    // to squeeze — Chinese would get crushed together.
    // The canvas is wide so the LABELS have somewhere to live, not so the bubble can run the full
    // width of it — a 320px-wide speech bubble over a 64px pet looks like a billboard. Cap the text
    // column; the extra canvas width still buys more characters per line than the old 200px did.
    const maxW = Math.min(W - 8 - sz(20), sz(230));

    // How many lines actually FIT above the pet's head — never a fixed 3.
    //
    // The bubble sits GAP px above `topPx` and grows upward, so its height is bounded by the strip
    // between the canvas top and the pet. Bigger type makes each line taller while that strip stays
    // exactly as tall as it was, and a count that ignores this doesn't overflow the canvas (the y
    // clamp catches that) — it grows DOWNWARD out of the clamp and sits on the pet's face.
    // So the type decides the line height and the space decides the line count.
    const lineH = sz(16);
    const PAD = 8;                                                   // vertical padding: decoration,
    const budget = (gap) => Math.floor((topPx - gap - 2 - PAD) / lineH); // so it does NOT scale with
    // the type — inflating it just eats the lines the type is asking for. (2 = canvas-top margin.)
    //
    // Three lines is the target at every size. Prefer a roomy gap over the pet's head, but the gap is
    // decoration too and the words are the message: when big type would otherwise cost a line, the
    // gap gives way first.
    let GAP = 20;
    let maxLines = budget(GAP);
    if (maxLines < 3) {
      const tighter = budget(4);
      if (tighter > maxLines) { GAP = 4; maxLines = tighter; }
    }
    maxLines = Math.max(1, Math.min(maxLines, 3)); // 3 is plenty; 1 always fits
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
          if (lines.length === maxLines - 1) { truncated = true; break outer; }
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
    const w = fit(Math.max(...lines.map((l) => ctx.measureText(l).width)) + sz(20), W);
    const h = lines.length * lineH + PAD;
    const x = clampX(cx * S - w / 2, w, W);
    // Sit GAP above the pet. The floor is the canvas top — and because maxLines was derived from
    // this very strip, h fits inside it, so the clamp can no longer push the box down onto the pet.
    const y = Math.max(topPx - h - GAP, 2);
    ctx.fillStyle = "rgba(24,22,20,0.92)";
    ctx.strokeStyle = "rgba(217,119,87,0.6)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#e8e2d8";
    lines.forEach((l, i) => ctx.fillText(l, x + sz(10), y + PAD / 2 + fs(12) + i * lineH));
  }

  // Top-right status box: terminal-style "❯ cmd..." green text + animated ellipsis
  function statusTag(ctx, canvas, cx, y0, text, t) {
    if (bulbT > 0) return; // yield during the lightbulb moment, don't overlap the status box
    const W = canvas.clientWidth || canvas.width;
    ctx.font = "bold " + fs(12) + "px Consolas, monospace";
    const dots = ".".repeat(Math.floor(t / 20) % 4);
    text = "❯ " + text;
    // Reserve the widest ellipsis state so the box doesn't twitch wider as the dots animate
    const w = fit(ctx.measureText(text + "...").width + sz(12), W);
    const h = sz(20);
    // Sit off the pet's right shoulder, and never past the canvas edge.
    //
    // This is the natural anchor, and it only works because the canvas is wide enough to hold the
    // box beside the pet (it wasn't: 200px left 68px of slack next to a tag that needs ~98px even at
    // its default size, so the right-clamp always fired and dragged the box back across the pet's
    // head — the bigger the text, the more obviously). With ~140px a side, the clamp is now the rare
    // case rather than the every case, and the tag stays where it belongs: up and to the right.
    const bx = Math.min((cx + 7) * S, Math.max(W - w - 4, 4));
    // Sit ABOVE the ×N badge, which lives on the same shoulder at (cx+15, y0-3). While the canvas was
    // narrow the tag got clamped away to the left and the two never met; now that it sits where it
    // belongs, they would print on top of each other.
    const by = Math.max((y0 - 8) * S - sz(8) - h, 2);
    ctx.fillStyle = "rgba(18,16,14,0.95)";
    ctx.strokeStyle = "rgba(122,222,122,0.45)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(bx, by, w, h, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#7ade7a";
    ctx.fillText(text + dots, bx + sz(6), by + h - sz(6));
  }

  // Small tooltip label (one size smaller than the bubble, doesn't steal the show)
  function toolTag(ctx, canvas, text, cx, topPx) {
    // Lay out against the CSS width, like every other box here. This used to read canvas.width —
    // PHYSICAL pixels — so on any HiDPI screen the right-edge clamp was computed against a number
    // 2-3x too large and simply never bit. Invisible at 11px; not invisible once the text can scale.
    const W = canvas.clientWidth || canvas.width;
    ctx.font = fs(11) + "px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
    const tw = ctx.measureText(text).width;
    const w = fit(tw + sz(12), W);
    const h = sz(17);
    const x = clampX(cx * S - w / 2, w, W);
    // Anchor the BOTTOM edge a fixed gap above the pet, not the top edge: a top-anchored box grows
    // downward as the type grows, and lands on the pet's head. Same trap as the bubble.
    const y = Math.max(topPx - 8 - h, 2);
    ctx.fillStyle = "rgba(24,22,20,0.82)";
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 6);
    ctx.fill();
    ctx.fillStyle = "#c9b79a";
    ctx.fillText(text, x + sz(6), y + h - sz(4));
  }

  let blinkT = 0;
  let gaze = null; // {x,y} pupil offset toward the cursor (−1..1 px), set per-frame in draw
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

  // ---- Calendar-driven ambience: moon phase / seasons / festivals ----
  // Everything here derives from the local date/time, so it needs no backend data and behaves
  // identically in every skin. Skins opt in by calling PetKit.ambient(ctx, canvas, t) once, early
  // in draw() — it paints the background layer (sky + drifting particles + festival decor) behind
  // the pet. All decor sits at fixed canvas coordinates (never pet-relative), so it stays put while
  // the pet paces around and works regardless of a skin's own geometry.

  const SYNODIC = 29.530588853;        // mean synodic (lunar) month, in days
  const NEW_MOON_REF = 947182440000;   // 2000-01-06 18:14 UTC — a known new moon (Unix ms)

  // Fraction through the current lunation: 0 = new, 0.5 = full, → 1 back to new.
  function moonPhase(now) {
    const days = (now.getTime() - NEW_MOON_REF) / 86400000;
    return (((days % SYNODIC) + SYNODIC) % SYNODIC) / SYNODIC;
  }

  // A smooth crescent moon at grid (mcx, mcy), radius R (grid cells), lit for the given phase — the
  // same clean look as the original night-scene moon (full lit disc, no dark disc, no glow), but the
  // terminator now tracks the real phase. The lit region is a lune: the bright limb is a semicircle
  // on the lit side; the terminator is a half-ellipse whose horizontal radius rx = R·cos(θ),
  // θ = 2π·phase — |rx| shrinks toward the quarters (straight terminator = exact half moon) and its
  // sign flips crescent↔gibbous.
  function drawMoon(ctx, mcx, mcy, R, phase) {
    const cx = mcx * S, cy = mcy * S, r = R * S;
    const th = phase * Math.PI * 2;
    const rx = Math.abs(r * Math.cos(th));
    const waxing = phase < 0.5;                        // waxing → lit limb on the right
    const bulge = Math.cos(th) > 0 ? waxing : !waxing; // terminator bows toward the lit side?
    ctx.save();
    ctx.fillStyle = "#f3e7a6";
    ctx.beginPath();
    if (waxing) {
      ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2, false);
      ctx.ellipse(cx, cy, rx, r, 0, Math.PI / 2, -Math.PI / 2, bulge);
    } else {
      ctx.arc(cx, cy, r, Math.PI / 2, -Math.PI / 2, false);
      ctx.ellipse(cx, cy, rx, r, 0, -Math.PI / 2, Math.PI / 2, !bulge);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Northern-hemisphere season from the month (the user base is CN-centric).
  function season(now) {
    const m = now.getMonth(); // 0-11
    if (m <= 1 || m === 11) return "winter";
    if (m <= 4) return "spring";
    if (m <= 7) return "summer";
    return "autumn";
  }

  // Subtle seasonal particle drift across the whole canvas (grid-pixel dots, low alpha so it never
  // fights the pet): winter snow, spring blossom, summer fireflies (float + blink), autumn leaves.
  function drawSeason(ctx, t, s, gridW, dusk, windy) {
    if (s === "summer" && !dusk) return; // fireflies only come out around dusk/night
    let color, N, speed, sway;
    if (s === "winter") { color = "#e8eef7"; N = 9; speed = 0.06; sway = 2; }
    else if (s === "spring") { color = "#f2b8cf"; N = 8; speed = 0.07; sway = 3; }
    else if (s === "summer") { color = "#d8e87a"; N = 6; speed = 0.02; sway = 4; }
    else { color = "#d98a4a"; N = 8; speed = 0.09; sway = 3; }
    for (let i = 0; i < N; i++) {
      const baseX = (i * 13 + i * i * 7) % gridW;
      let x, y, a;
      if (s === "summer") {
        // Fireflies bob in mid-air and blink instead of falling
        y = 11 + Math.sin(t * 0.02 + i * 2) * 8;
        x = baseX + Math.cos(t * 0.025 + i) * sway;
        a = 0.25 + 0.45 * (0.5 + 0.5 * Math.sin(t * 0.08 + i * 1.3));
      } else {
        y = (t * speed + i * 7) % (GY + 6);
        x = baseX + Math.sin(t * 0.03 + i) * sway;
        if (windy) x = (x + y * 0.9 + t * 0.2) % gridW; // blown rightward, more the lower it falls
        a = Math.max(0.12, 0.5 * (1 - y / (GY + 6)));
      }
      if (y > GY) continue;
      ctx.globalAlpha = a;
      px(ctx, Math.round(x), Math.round(y), 1, 1, color);
    }
    ctx.globalAlpha = 1;
  }

  // Lunar-calendar festivals can't be derived cheaply, so the day-of dates are pinned per year.
  const CNY = { 2025: "01-29", 2026: "02-17", 2027: "02-06", 2028: "01-26", 2029: "02-13", 2030: "02-03" };
  const MIDAUTUMN = { 2025: "10-06", 2026: "09-25", 2027: "09-15", 2028: "10-03", 2029: "09-22", 2030: "09-12" };
  function within(now, iso, before, after) {
    const diff = (now.getTime() - new Date(iso + "T00:00:00").getTime()) / 86400000;
    return diff >= -before && diff < after + 1;
  }
  // Which festival is on today (null if none). Solar dates are computed; lunar ones use the tables.
  function festival(now) {
    const y = now.getFullYear(), m = now.getMonth() + 1, d = now.getDate();
    if ((m === 1 && d === 1) || (m === 12 && d === 31)) return "newyear";
    if (within(now, y + "-12-25", 1, 1)) return "xmas";
    if (within(now, y + "-10-31", 1, 0)) return "halloween";
    if (CNY[y] && within(now, y + "-" + CNY[y], 1, 4)) return "cny";
    if (MIDAUTUMN[y] && within(now, y + "-" + MIDAUTUMN[y], 1, 1)) return "midautumn";
    return null;
  }

  // Festival decorations at fixed canvas corners (grid coords), so they never clash with the pet's
  // state-specific headgear (hard hat / mortarboard / Einstein hair) the way a worn prop would.
  function drawFestival(ctx, t, key, gridW) {
    if (key === "cny") {
      // A red lantern swaying on a string from each top corner
      for (const lx of [3, gridW - 6]) {
        const gx = lx + Math.round(Math.sin(t * 0.04 + lx) * 1.5), gy = 5;
        px(ctx, gx + 1, 0, 1, gy, "#8a6b4a");     // string
        px(ctx, gx, gy, 4, 1, "#e0c05a");         // top cap
        px(ctx, gx - 1, gy + 1, 6, 4, "#d23b3b"); // body
        px(ctx, gx, gy + 2, 1, 2, "#f0a0a0");     // highlight
        px(ctx, gx, gy + 5, 4, 1, "#e0c05a");     // bottom cap
        px(ctx, gx + 1, gy + 6, 2, 2, "#e0c05a"); // tassel
      }
    } else if (key === "xmas") {
      // A little decorated pine in the bottom-left, lights twinkling
      const gx = 5, gy = GY;
      px(ctx, gx, gy - 2, 2, 2, "#7a5a3a");       // trunk
      px(ctx, gx - 3, gy - 5, 8, 3, "#3f7a3f");
      px(ctx, gx - 2, gy - 8, 6, 3, "#3f7a3f");
      px(ctx, gx - 1, gy - 10, 4, 2, "#3f7a3f");
      px(ctx, gx, gy - 12, 1, 2, "#e0c05a");      // topper star
      const lights = [["#d4537e", gx - 2, gy - 4], ["#7fb4d9", gx + 2, gy - 6], ["#e0a63b", gx - 1, gy - 7], ["#9ac47a", gx + 1, gy - 9]];
      for (let i = 0; i < lights.length; i++) {
        if (Math.floor(t / 15 + i) % 2 === 0) px(ctx, lights[i][1], lights[i][2], 1, 1, lights[i][0]);
      }
    } else if (key === "halloween") {
      const gx = 6, gy = GY;
      if (Math.floor(t / 20) % 2 === 0) { ctx.globalAlpha = 0.35; px(ctx, gx - 4, gy - 5, 10, 6, "#ffcf6a"); ctx.globalAlpha = 1; } // candle flicker
      px(ctx, gx, gy - 5, 1, 1, "#3f7a3f");       // stem
      px(ctx, gx - 3, gy - 4, 8, 4, "#e08028");   // pumpkin body
      px(ctx, gx - 2, gy - 3, 1, 1, "#3a2a10");   // carved eye
      px(ctx, gx + 2, gy - 3, 1, 1, "#3a2a10");   // carved eye
      px(ctx, gx - 1, gy - 1, 3, 1, "#3a2a10");   // grin
    } else if (key === "midautumn") {
      const gx = 6, gy = GY;
      px(ctx, gx - 3, gy - 3, 8, 3, "#c79a5a");   // mooncake
      px(ctx, gx - 3, gy - 1, 8, 1, "#a87a3a");   // base
      px(ctx, gx - 1, gy - 2, 4, 1, "#a87a3a");   // pressed imprint
    } else if (key === "newyear") {
      // A few fireworks blooming and fading in the sky
      const bursts = [[10, 8], [gridW - 10, 10], [Math.round(gridW / 2), 6]];
      for (let i = 0; i < bursts.length; i++) {
        const ph = (t * 0.03 + i * 1.4) % 3;
        if (ph > 1.6) continue;
        ctx.globalAlpha = Math.max(0, 1 - ph / 1.6);
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          px(ctx, Math.round(bursts[i][0] + Math.cos(a) * ph * 4), Math.round(bursts[i][1] + Math.sin(a) * ph * 4), 1, 1, CONFETTI[i % CONFETTI.length]);
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  // Slow deterministic pseudo-weather (changes ~every 3h, mostly clear) — no network, and stable
  // across skins/frames because it's a pure hash of the time bucket.
  function weather(now) {
    const bucket = Math.floor(now.getTime() / (3 * 3600 * 1000));
    const r = ((bucket * 2654435761) >>> 0) % 100;
    if (r < 12) return "rain";
    if (r < 20) return "wind";
    return "clear";
  }

  // Weather overlay: slanted rain + ground splashes, or horizontal wind speed-lines.
  function drawWeather(ctx, t, kind, gridW) {
    if (kind === "rain") {
      ctx.globalAlpha = 0.5;
      for (let i = 0; i < 16; i++) {
        const baseX = (i * 11 + i * i * 5) % gridW;
        const fall = (t * 0.5 + i * 9) % (GY + 4);
        if (fall > GY) continue;
        px(ctx, Math.round(baseX - fall * 0.3), Math.round(fall), 1, 2, "#8fb4d9"); // slanted streak
      }
      for (let i = 0; i < 3; i++) { // occasional ground splash
        if (Math.floor(t / 12 + i * 2) % 3 === 0) px(ctx, (i * 17 + 7) % gridW, GY - 1, 2, 1, "#8fb4d9");
      }
      ctx.globalAlpha = 1;
    } else if (kind === "wind") {
      ctx.globalAlpha = 0.28;
      for (let i = 0; i < 5; i++) {
        const y = (i * 8 + 3) % GY;
        const sweep = ((t * 3 + i * 20) % (gridW + 12)) - 6;
        px(ctx, Math.round(sweep), y, 4, 1, "#c9d2da"); // horizontal speed line
      }
      ctx.globalAlpha = 1;
    }
  }

  // The full background ambience: dusk/night moon (real phase) + season drift + weather + festivals.
  // `force` overrides the deterministic weather (used by the demo gallery to show rain/wind on cue).
  function ambient(ctx, canvas, t, force) {
    const now = new Date();
    const gridW = Math.floor((canvas.clientWidth || canvas.width) / S);
    const h = now.getHours();
    // The scenery is composed around the PET, not around the canvas. These positions were chosen when
    // the canvas was 200 wide and the pet sat at grid 25; the canvas has since widened to give the
    // labels room, and anything still measured from the canvas's own corner drifted away with it —
    // the moon ended up hanging out by the window's edge, half a screen from the pet it belongs to.
    // `ox` re-hangs it where it was always meant to be: up and to the pet's left.
    const ox = centreCx(canvas) - 25;
    if (h >= 20 || h < 7) { // evening & night: hang the moon in the upper-left, out of the badges' way
      drawMoon(ctx, 8 + ox, 7, 3.5, moonPhase(now));
      px(ctx, 15 + ox, 5, 1, 1, "#fff6c0"); // a few tiny stars
      px(ctx, 4 + ox, 14, 1, 1, "#fff6c0");
      px(ctx, 14 + ox, 12, 1, 1, "#fff6c0");
    }
    const w = force || weather(now);
    if (w !== "rain") drawSeason(ctx, t, season(now), gridW, h >= 18 || h < 7, w === "wind");
    if (w !== "clear") drawWeather(ctx, t, w, gridW);
    const f = festival(now);
    // Festivals flank the pet (lanterns either side, a tree at its feet), so they're laid out in the
    // pet's own 50-row neighbourhood rather than smeared to the corners of a wider canvas.
    if (f) {
      ctx.save();
      ctx.translate(ox * S, 0);
      drawFestival(ctx, t, f, 50);
      ctx.restore();
    }
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
    const morning = h >= 6 && h < 10;   // coffee o'clock
    const noon = h >= 12 && h < 14;     // after-lunch drowsiness
    const deepNight = h >= 2 && h < 5;  // the small hours — fighting sleep
    const r = Math.random();
    // Morning: now and then it takes a coffee break
    if (morning && r < 0.28) {
      wMode = "coffee";
      wUntil = t + 260 + Math.random() * 200;   // sip for ~4-8 seconds
      return;
    }
    // Small hours: keeps nodding off (head droops, then jerks awake)
    if (deepNight && r < 0.5) {
      wMode = "nod";
      wUntil = t + 240 + Math.random() * 200;
      return;
    }
    if (r < (night ? 0.45 : noon ? 0.32 : 0.12)) {
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

  function setTextScale(n) {
    const v = Number(n);
    TS = v >= 0.8 && v <= 2 ? v : 1.2;  // a hand-edited config can't blow the labels off the canvas
  }

  function draw(ctx, canvas, state, warn, bubble, t, extra) {
    if (extra && extra.textScale) setTextScale(extra.textScale);
    const x = extra || {};
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const baseCx = centreCx(canvas);
    // What is the pet wearing this frame? (thinking is a working state with no toolNote)
    headRoom = state === "working"
      ? (HEADGEAR[x.toolNote] || (x.toolNote ? 0 : HAIR))
      : 0;

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

    // Eyes-follow-cursor: nudge pupils toward the cursor when it's off to one side (not while
    // dragging or being tickled, which have their own expressions). gazeX/Y are canvas-logical px.
    gaze = null;
    if (x.gazeX != null && !x.dragging && !x.tickle) {
      const dxg = x.gazeX / S - cx, dyg = x.gazeY / S - (GY - 16);
      gaze = {
        x: dxg > 3 ? 1 : dxg < -3 ? -1 : 0,
        y: dyg > 3 ? 1 : dyg < -3 ? -1 : 0,
      };
    }

    // Calendar ambience (moon phase / season drift / weather / festival decor) drawn behind the pet
    const wthr = x.forceWeather || weather(new Date());
    ambient(ctx, canvas, t, wthr);

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
      // Quota exhausted: sleeping. As the 5-hour window's reset nears, it stirs — breathing quickens
      // and an eye cracks open now and then; it wakes fully on limit→idle (the stretch handled above).
      const reset = x.resetSecs;
      const waking = reset != null && reset > 0 && reset < 300;
      if (waking) {
        ctx.globalAlpha = 0.25 + 0.15 * (0.5 + 0.5 * Math.sin(t * 0.05)); // a faint sunrise on the horizon
        px(ctx, 0, GY - 2, Math.ceil((canvas.clientWidth || canvas.width) / S), 2, "#e0a63b");
        ctx.globalAlpha = 1;
        const peek = Math.floor(t / 25) % 4 === 0;
        y0 = body(ctx, cx, { eyes: peek ? "tired" : "closed", lying: true, breath: Math.sin(t * 0.12) > 0 ? 1 : 0 });
        zzz(ctx, cx, GY - 17, t, 1);
      } else {
        y0 = body(ctx, cx, { eyes: "closed", lying: true, breath: Math.sin(t * 0.045) > 0 ? 1 : 0 });
        zzz(ctx, cx, GY - 17, t, 3);
      }
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
      } else if (note === "git") {
        // Reviewing a commit graph: main branch line with commit dots, a side branch, newest pulses in
        y0 = body(ctx, cx, { eyes: "up" });
        const gx = cx - 2;
        px(ctx, gx, GY - 12, 1, 10, "#6b665c");                       // main branch line
        for (const cy of [GY - 11, GY - 7, GY - 3]) px(ctx, gx - 1, cy, 3, 2, "#e0a63b"); // commits
        px(ctx, gx + 1, GY - 7, 3, 1, "#6b665c");                     // branch off to the right
        px(ctx, gx + 4, GY - 9, 1, 3, "#6b665c");
        px(ctx, gx + 3, GY - 10, 3, 2, "#9b7fd4");                    // branch commit (purple)
        if (Math.floor(t / 18) % 2 === 0) px(ctx, gx - 1, GY - 15, 3, 2, "#fbe36a"); // newest commit pulses in
        if (!bubble) statusTag(ctx, canvas, cx, y0, "git", t);
      } else if (note === "testing") {
        // Running tests: a flask bubbling, pass ✓ (occasionally a fail ✗) popping out
        y0 = body(ctx, cx, { eyes: "up" });
        const gx = cx - 1;
        px(ctx, gx, GY - 11, 2, 2, "#cdd6dd");                        // flask neck
        px(ctx, gx - 2, GY - 9, 6, 6, "#cdd6dd");                     // flask body
        px(ctx, gx - 1, GY - 6, 4, 3, "#5aa46a");                     // green reagent
        for (let i = 0; i < 3; i++) {                                 // bubbles rising
          const ph = (t / 10 + i * 1.3) % 4;
          if (ph < 3) px(ctx, gx + (i % 3) - 1, GY - 6 - Math.round(ph), 1, 1, "#9fe8a0");
        }
        const mx = cx + 9, my = y0 + 1;
        if (Math.floor(t / 45) % 5 === 4) {                           // an occasional fail ✗
          px(ctx, mx, my, 1, 1, "#d05045"); px(ctx, mx + 2, my, 1, 1, "#d05045");
          px(ctx, mx + 1, my + 1, 1, 1, "#d05045");
          px(ctx, mx, my + 2, 1, 1, "#d05045"); px(ctx, mx + 2, my + 2, 1, 1, "#d05045");
        } else {                                                      // green ✓
          px(ctx, mx, my + 1, 1, 1, "#4a9a4a"); px(ctx, mx + 1, my + 2, 1, 1, "#4a9a4a");
          px(ctx, mx + 2, my, 1, 1, "#4a9a4a"); px(ctx, mx + 3, my - 1, 1, 1, "#4a9a4a");
        }
        if (!bubble) statusTag(ctx, canvas, cx, y0, "testing", t);
      } else if (note === "deps") {
        // Installing dependencies: a download arrow dropping packages into a box
        y0 = body(ctx, cx, { eyes: "up" });
        const gx = cx - 3;
        px(ctx, gx, GY - 8, 7, 6, "#8a6b4a");                         // box
        px(ctx, gx, GY - 8, 7, 1, "#a3805a");                         // lid highlight
        px(ctx, gx + 3, GY - 8, 1, 6, "#6b4f35");                     // tape seam
        const ay = GY - 15 + (Math.floor(t / 6) % 5);                 // arrow dropping in
        px(ctx, gx + 3, ay, 1, 3, "#7fb4d9");                         // shaft
        px(ctx, gx + 2, ay + 2, 3, 1, "#7fb4d9");                     // head sides
        px(ctx, gx + 3, ay + 3, 1, 1, "#7fb4d9");                     // head tip
        if (!bubble) statusTag(ctx, canvas, cx, y0, "deps", t);
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
        if (!bubble) statusTag(ctx, canvas, cx, y0, "thinking", t);
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
      // idle: tickle > head-pat > napping > standing/roaming
      if (x.tickle) {
        // Tickled (fast cursor wiggle over the pet): squirms and giggles
        const wob = (Math.floor(t / 3) % 2 ? 1 : -1) * 2;
        y0 = body(ctx, cx + wob, { eyes: "happy" });
        if (Math.floor(t / 6) % 2 === 0) {         // little laughter squiggles
          ctx.font = "bold 10px Consolas, monospace";
          ctx.fillStyle = "#e0a63b";
          ctx.fillText("~", (cx + 13) * S, (y0 + 1) * S);
        }
        heart(ctx, cx - 17, y0 - 4, 0.7);
      } else if (x.pat) {
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
      } else if (wMode === "coffee") {
        // A morning coffee break: holds a steaming mug, sipping now and then
        const sip = Math.floor(t / 45) % 3 === 0;
        y0 = body(ctx, cx, { eyes: sip ? "closed" : "open" });
        px(ctx, cx - 3, GY - 12, 6, 5, "#d97757");  // mug
        px(ctx, cx - 3, GY - 12, 6, 1, "#3a2a20");  // coffee surface
        px(ctx, cx + 3, GY - 11, 1, 3, "#d97757");  // handle
        px(ctx, cx + 4, GY - 10, 1, 1, "#d97757");
        for (let i = 0; i < 2; i++) {                // steam curling up
          const ph = (t / 30 + i * 0.9) % 3;
          ctx.globalAlpha = Math.max(0, 0.5 - ph / 4);
          px(ctx, cx - 1 + i * 2 + Math.round(Math.sin(t * 0.06 + i)), GY - 14 - ph * 3, 1, 1, "#cfc7ba");
        }
        ctx.globalAlpha = 1;
      } else if (wMode === "nod") {
        // Small-hours micro-sleep: head droops lower and lower, then jerks back awake
        const ph = (t % 130) / 130;
        const jerk = ph > 0.88;
        const droop = jerk ? 0 : Math.round(ph * 4);
        y0 = body(ctx, cx, { eyes: jerk ? "open" : "tired", bounce: -droop });
        if (!jerk && ph > 0.35) zzz(ctx, cx, GY - 16 - droop, t, 1);
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

    // Umbrella when raining — only in upright, unbusy poses (skip sleeping / dozing / nodding /
    // coffee / stretching / tool-use / dragging / patting / tickling, where it would clash)
    const busyIdle = state === "idle" && (wMode === "doze" || wMode === "coffee" || wMode === "nod" || wMode === "stretch");
    if (wthr === "rain" && !x.dragging && state !== "limit" && !x.toolNote && !x.pat && !x.tickle && !busyIdle) {
      umbrella(ctx, cx, y0);
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

    // Multi-session badge: mark however many run in parallel (per-session detail lives in the panel)
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

    if (bubble) bubbleBox(ctx, canvas, bubble, cx, (_bodyRestY0 - 4 - headRoom) * S); // dome(4) + headgear
  }

  window.PetRenderer = { draw };
  // Shared drawing toolkit: reusable by skin files (pixels, bubbles, status box, hearts, Zzz, confetti,
  // and the calendar ambience — call ambient(ctx, canvas, t) early in a skin's draw for moon/season/festival).
  // setTextScale is how a skin with its own draw() (bean, tabby) still gets the user's text size:
  // main.js calls it whenever the setting changes. The default skin's draw() also reads
  // extra.textScale, so a skin that ignores PetKit entirely can still be handed the value.
  window.PetKit = { S, GY, px, heart, zzz, bubbleBox, statusTag, confetti, isNight, ambient, moonPhase, drawMoon, season, festival, weather, drawWeather, setTextScale, centreCx };
})();
