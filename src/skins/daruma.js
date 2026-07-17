// Skin: Daruma the Wish-Keeper — a pixel-art daruma doll
// @skin-name-zh 达摩·许愿
// @skin-name-en Daruma
// Overrides window.PetRenderer, reusing window.PetKit.
//
// Design rule: the daruma has no limbs. Its whole body language is ROCKING on a
// weighted, rounded base — a stoic wish-keeper that "works" by persevering. It
// never walks. The signature moment is completion: the blank right eye gets
// painted in, brush-stroke from the top down, the way a real daruma's second eye
// is filled once a wish comes true.
//
// The approved sprite geometry is preserved EXACTLY (prototype space: cx, gy with
// S=4, dome top at gy-30, base shade at gy-3). Everything animates around a
// bottom-center pivot via ctx.save/translate/rotate/restore; all pixels go through
// K.px so the art stays on the grid.

(function () {
  const K = window.PetKit;
  const { S, GY, px } = K;

  // Approved palette — do not restyle.
  const COL = {
    body: "#c23a2b",   // lacquered red
    shade: "#962b1f",  // darker base
    face: "#f5ead6",   // cream face window
    ink: "#1c1a17",    // calligraphy ink
    gold: "#d4a13a",   // gold swirls / belly roundel
  };
  const AMBER = "#e0a63b";
  const DEG = Math.PI / 180;

  // ---------------------------------------------------------------------------
  // Facial parts. Each reads a small options object so the same sprite can wear
  // a different expression per state without ever moving a pixel of its outline.
  // ---------------------------------------------------------------------------

  // Calligraphy brows. Three moods share the same brush strokes, only shifted:
  //   normal — inner ends lifted (the classic serene daruma arch)
  //   down   — inner ends dropped toward the nose (effort / determination)
  //   up     — the whole pair raised high (alarm / delight / raised in surprise)
  function drawBrows(ctx, cx, gy, mode) {
    const ink = COL.ink;
    if (mode === "up") {
      px(ctx, cx - 7, gy - 23, 5, 2, ink);
      px(ctx, cx - 3, gy - 24, 2, 2, ink);
      px(ctx, cx + 2, gy - 23, 5, 2, ink);
      px(ctx, cx + 1, gy - 24, 2, 2, ink);
    } else if (mode === "down") {
      px(ctx, cx - 7, gy - 21, 5, 2, ink);
      px(ctx, cx - 3, gy - 20, 2, 2, ink);   // inner end drops = furrow
      px(ctx, cx + 2, gy - 21, 5, 2, ink);
      px(ctx, cx + 1, gy - 20, 2, 2, ink);
    } else {
      px(ctx, cx - 7, gy - 21, 5, 2, ink);
      px(ctx, cx - 3, gy - 22, 2, 2, ink);
      px(ctx, cx + 2, gy - 21, 5, 2, ink);
      px(ctx, cx + 1, gy - 22, 2, 2, ink);
    }
  }

  // The FILLED left eye — the wish that was made. It is the only eye that blinks
  // or rests; the right eye is paint, not an eye. Its catch-light shifts 1px
  // toward the cursor (gaze), or spirals when dizzy (oops).
  function drawFilledEye(ctx, cx, gy, o) {
    const ink = COL.ink, fc = COL.face;
    if (o.eyeClosed || o.blink) {
      px(ctx, cx - 6, gy - 17, 3, 1, ink);   // a resting / blinking line
      return;
    }
    px(ctx, cx - 6, gy - 18, 3, 3, ink);
    if (o.dizzy) {
      const a = (o.dizzyT || 0) * 0.5;
      const hx = Math.cos(a) > 0 ? 1 : -1;
      const hy = Math.sin(a) > 0 ? 1 : -1;
      px(ctx, cx - 5 + (hx > 0 ? 1 : -1), gy - 17 + (hy > 0 ? 0 : -1), 1, 1, fc);
    } else {
      px(ctx, cx - 5 + (o.gaze || 0), gy - 18, 1, 1, fc);  // catch-light follows cursor
    }
  }

  // The BLANK right eye — the wish waiting to come true. Normally a hollow
  // outline. On completion it is painted in, top row to bottom, over ~20 frames
  // (o.paint 0..1); once full it becomes a twin of the left eye.
  function drawBlankEye(ctx, cx, gy, o) {
    const ink = COL.ink, fc = COL.face;
    if (o.eyeClosed) {
      px(ctx, cx + 3, gy - 17, 3, 1, ink);
      return;
    }
    const frac = o.paint || 0;
    if (frac >= 1) {
      px(ctx, cx + 3, gy - 18, 3, 3, ink);
      px(ctx, cx + 4 + (o.gaze || 0), gy - 18, 1, 1, fc);
      return;
    }
    // Hollow outline (top / bottom / left / right edges).
    px(ctx, cx + 3, gy - 18, 3, 1, ink);
    px(ctx, cx + 3, gy - 16, 3, 1, ink);
    px(ctx, cx + 3, gy - 17, 1, 1, ink);
    px(ctx, cx + 5, gy - 17, 1, 1, ink);
    // Brush-fill downward as the paint frac grows.
    if (frac > 0) {
      const rows = Math.min(3, Math.floor(frac * 3) + 1);
      for (let r = 0; r < rows; r++) px(ctx, cx + 3, gy - 18 + r, 3, 1, ink);
      // A wet brush-tip glint on the row currently being painted.
      if (frac < 1) px(ctx, cx + 4, gy - 18 + Math.min(2, rows), 1, 1, COL.gold);
    }
  }

  // The stern mouth. "flat" spreads it wider (dragging), "smile" lifts it
  // (patted / celebrating).
  function drawMouth(ctx, cx, gy, mode) {
    const ink = COL.ink;
    if (mode === "flat") {
      px(ctx, cx - 3, gy - 13, 6, 1, ink);
      return;
    }
    if (mode === "smile") {
      px(ctx, cx - 2, gy - 13, 1, 1, ink);
      px(ctx, cx - 1, gy - 12, 3, 1, ink);
      px(ctx, cx + 2, gy - 13, 1, 1, ink);
      return;
    }
    px(ctx, cx - 2, gy - 13, 4, 1, ink);   // stern default
  }

  // The full doll — approved sprite, exact geometry. `o` carries expression.
  function drawDaruma(ctx, cx, gy, o) {
    const b = COL.body, sh = COL.shade, fc = COL.face, gold = COL.gold;
    // Stepped-round dome.
    px(ctx, cx - 8, gy - 30, 16, 2, b);
    px(ctx, cx - 11, gy - 28, 22, 3, b);
    px(ctx, cx - 13, gy - 25, 26, 19, b);
    px(ctx, cx - 11, gy - 6, 22, 3, b);
    px(ctx, cx - 8, gy - 3, 16, 2, sh);
    // Face window.
    px(ctx, cx - 7, gy - 26, 14, 2, fc);
    px(ctx, cx - 8, gy - 24, 16, 12, fc);
    px(ctx, cx - 7, gy - 12, 14, 2, fc);
    // Calligraphy brows.
    drawBrows(ctx, cx, gy, o.brow || "normal");
    // Eyes: one filled (wish made), one blank/painting (wish pending).
    drawFilledEye(ctx, cx, gy, o);
    drawBlankEye(ctx, cx, gy, o);
    // Gold cheek swirls.
    px(ctx, cx - 8, gy - 15, 2, 2, gold);
    px(ctx, cx + 6, gy - 15, 2, 2, gold);
    // Mouth.
    drawMouth(ctx, cx, gy, o.mouth || "stern");
    // Gold belly roundel.
    px(ctx, cx - 4, gy - 9, 8, 5, gold);
    px(ctx, cx - 2, gy - 8, 4, 3, b);
  }

  // Rock the whole doll around its bottom-center pivot (where the rounded base
  // meets the ground). Rotation is the prototype's own technique; the art inside
  // still goes through K.px.
  function withRock(ctx, cx, gy, angle, fn) {
    const pxp = cx * S, pyp = gy * S;
    ctx.save();
    ctx.translate(pxp, pyp);
    ctx.rotate(angle);
    ctx.translate(-pxp, -pyp);
    fn();
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Per-tool "prop theater". The daruma has no hands, so each tool is a zen-room
  // prop that sits at the base or just beside the doll and rocks with it (drawn
  // inside the rock, behind the doll — so only the parts clear of the dome and
  // below its base show through). Several props harness the doll's own rocking.
  //
  // CLOSED key set (exactly these ten, never extend, never localize):
  //   cmd reading coding searching browsing agents planning git testing deps
  // Anything else falls through to a small generic offering; the status tag
  // (drawn separately) still names the tool.
  // ---------------------------------------------------------------------------
  function toolToken(ctx, cx, gy, note, t) {
    const gold = COL.gold, ink = COL.ink;
    const sway = Math.sin(t * 0.13);        // same phase as the working-state rock

    if (note === "cmd") {
      // Keyboard at the base; the doll's ROCKING does the typing — whichever key
      // it leans over presses down and lights green.
      px(ctx, cx - 11, gy - 1, 22, 3, "#2a2723");            // keyboard slab (below the base)
      px(ctx, cx - 11, gy - 1, 22, 1, "#3a352f");            // top bevel
      const keys = 5;
      const lit = Math.min(keys - 1, Math.max(0, Math.floor((sway + 1) * keys / 2)));
      for (let i = 0; i < keys; i++) {
        const kx = cx - 9 + i * 4;
        const down = i === lit;
        px(ctx, kx, gy - 1, 3, 1, down ? "#4a6b4a" : "#454c58");
        if (down) px(ctx, kx, gy - 1, 3, 1, "#9fe8a0");      // the pressed key glows
      }
    } else if (note === "reading") {
      // A sutra scroll unrolls sideways; text dashes appear as far as it has read.
      const prog = (t * 0.02) % 1;                            // 0..1 unroll, then loop
      const full = 20;
      const w = Math.max(4, Math.round(full * prog));
      const leftX = cx - 10;
      px(ctx, leftX - 1, gy - 2, 2, 4, "#8a6b4a");           // fixed left roller
      px(ctx, leftX, gy - 1, w, 2, "#efe7d5");               // paper, growing rightward
      px(ctx, leftX + w, gy - 2, 2, 4, "#8a6b4a");           // moving right roller
      const nd = Math.floor(w / 3);                          // dashes up to the read edge
      for (let i = 0; i < nd; i++) px(ctx, leftX + 1 + i * 3, gy - 1, 2, 1, "#7a6f5c");
    } else if (note === "coding") {
      // An ink brush hovers at its side writing strokes onto rice paper
      // (calligraphy = coding). Strokes accumulate down the sheet, then clear.
      const px0 = cx + 15;
      px(ctx, px0, gy - 14, 8, 12, "#efe7d5");               // rice paper panel
      const strokes = Math.floor((t * 0.04) % 5);            // 0..4 strokes written so far
      for (let i = 0; i < strokes; i++) px(ctx, px0 + 2, gy - 12 + i * 2, 4, 1, ink);
      const bx = px0 + 3 + Math.round(Math.sin(t * 0.2) * 2);// brush drifting as it writes
      const by = gy - 12 + strokes * 2;
      px(ctx, bx, by - 6, 1, 6, "#8a6b4a");                  // bamboo shaft
      px(ctx, bx - 1, by, 3, 2, ink);                        // inked tip
    } else if (note === "searching") {
      // A paper lantern held at its side; the light patch it casts on the ground
      // sweeps left and right with the rocking.
      const lx = cx + 15;
      px(ctx, lx + 2, gy - 18, 1, 2, "#6b4f35");             // hanging cord
      px(ctx, lx, gy - 16, 5, 1, "#2a2723");                 // top cap
      px(ctx, lx, gy - 15, 5, 6, COL.body);                  // lantern body
      px(ctx, lx + 2, gy - 15, 1, 6, gold);                  // gold rib
      px(ctx, lx, gy - 9, 5, 1, "#2a2723");                  // bottom cap
      const sweep = Math.round(sway * 6);                    // patch follows the sway
      ctx.globalAlpha = 0.22 + 0.1 * (0.5 + 0.5 * Math.sin(t * 0.2));
      px(ctx, cx - 4 + sweep, gy - 1, 8, 2, AMBER);          // warm light patch on the ground
      ctx.globalAlpha = 1;
    } else if (note === "browsing") {
      // A string of ema wish-plaques slides past horizontally (browsing wishes).
      const spacing = 10;
      const scroll = Math.round((t * 0.4) % spacing);
      px(ctx, cx - 20, gy - 9, 40, 1, "#6b4f35");            // the hanging cord
      for (let i = -1; i < 5; i++) {
        const ex = cx - 22 + i * spacing + scroll;
        if (ex < cx - 22 || ex > cx + 18) continue;          // stay inside the band
        px(ctx, ex, gy - 8, 5, 4, "#b58a4a");                // wood plaque
        px(ctx, ex + 1, gy - 9, 3, 1, "#9c7238");            // pentagon top
        px(ctx, ex + 1, gy - 6, 3, 1, ink);                  // a line of writing
      }
    } else if (note === "agents") {
      // Mini daruma dolls pop up beside it, each with ONE blank eye that gets
      // painted in when its task ends, then the doll cycles away.
      for (let i = 0; i < 3; i++) {
        const phase = (t + i * 40) % 120;                    // per-doll lifecycle
        if (phase < 12) continue;                            // not popped up yet
        const grow = phase < 24 ? (phase - 12) / 12 : 1;     // pop-in
        const h = Math.round(4 * grow);
        const mx = cx + 14 + i * 6;
        const my = gy - 2 - h;
        px(ctx, mx, my, 5, h + 1, COL.body);                 // tiny lacquered dome
        if (h >= 3) {
          px(ctx, mx + 1, my + 1, 3, 2, COL.face);           // face window
          px(ctx, mx + 1, my + 1, 1, 1, ink);               // filled left eye
          if (phase > 90) px(ctx, mx + 3, my + 1, 1, 1, ink);              // task done: painted
          else if (Math.floor(t / 6) % 2 === 0) px(ctx, mx + 3, my + 1, 1, 1, gold); // blank, blinking
        }
      }
    } else if (note === "planning") {
      // A row of incense sticks beside it; one lights per interval — each lit
      // stick is one plan item checked off.
      const n = 5;
      const bx = cx + 14;
      px(ctx, bx - 1, gy - 1, n * 2 + 3, 2, "#6b4f35");      // holder
      const lit = Math.floor(t / 40) % (n + 1);              // 0..n sticks alight
      for (let i = 0; i < n; i++) {
        const sx = bx + i * 2;
        px(ctx, sx, gy - 9, 1, 8, "#c9b48a");                // incense stick
        if (i < lit) {
          px(ctx, sx, gy - 10, 1, 1, AMBER);                 // glowing tip
          ctx.globalAlpha = 0.5;
          px(ctx, sx, gy - 12 - (Math.floor(t / 8 + i) % 3), 1, 1, "#b9c2c9"); // smoke wisp
          ctx.globalAlpha = 1;
        }
      }
    } else if (note === "git") {
      // A zen sand garden at the base: raked lines branch like the commit graph,
      // stones are commits, the newest stone pulses.
      const bx = cx - 12, by = gy - 1, bw = 24, bh = 5;
      px(ctx, bx, by, bw, bh, "#e5dcc4");                    // raked sand bed
      for (let r = 0; r < bh; r += 2) px(ctx, bx, by + r, bw, 1, "#cdbf9c"); // rake lines
      px(ctx, bx + 10, by + 1, 8, 1, "#cdbf9c");             // a diverging branch line
      px(ctx, bx + 4, by + 1, 2, 2, "#7a746a");              // stone (commit)
      px(ctx, bx + 9, by + 3, 2, 2, "#7a746a");
      px(ctx, bx + 15, by + 1, 2, 2, "#7a746a");
      const pulse = Math.floor(t / 16) % 2 === 0;
      px(ctx, bx + 19, by + 3, 2, 2, pulse ? AMBER : "#9a948a"); // newest commit pulses
    } else if (note === "testing") {
      // Drawing omikuji fortune slips: mostly 吉 (green check), occasional 凶 (red ✗).
      const bx = cx + 14;
      for (let i = 0; i < 3; i++) {
        const sx = bx + i * 5, sy = gy - 12 + i;
        px(ctx, sx, sy, 4, 10, "#f2ead6");                   // paper slip
        px(ctx, sx, sy, 4, 1, COL.body);                     // red header band
      }
      const bad = Math.floor(t / 50) % 5 === 4;              // an occasional 凶
      const mx = bx + 1, my = gy - 6;
      if (bad) {                                             // red ✗
        px(ctx, mx, my, 1, 1, "#d05045"); px(ctx, mx + 2, my, 1, 1, "#d05045");
        px(ctx, mx + 1, my + 1, 1, 1, "#d05045");
        px(ctx, mx, my + 2, 1, 1, "#d05045"); px(ctx, mx + 2, my + 2, 1, 1, "#d05045");
      } else {                                               // green ✓
        px(ctx, mx, my + 1, 1, 1, "#4a9a4a"); px(ctx, mx + 1, my + 2, 1, 1, "#4a9a4a");
        px(ctx, mx + 2, my, 1, 1, "#4a9a4a"); px(ctx, mx + 3, my - 1, 1, 1, "#4a9a4a");
      }
    } else if (note === "deps") {
      // A wooden offerings box; coins and mochi drop in one by one.
      const bx = cx + 14, by = gy - 6;
      px(ctx, bx, by, 12, 5, "#8a6b4a");                     // box body
      px(ctx, bx, by, 12, 1, "#a3805a");                     // rim highlight
      for (let i = 0; i < 4; i++) px(ctx, bx + 1 + i * 3, by, 1, 1, "#6b4f35"); // slatted top
      const coin = Math.floor(t / 30) % 2 === 0;             // alternate coin / mochi
      const dropY = by - 10 + (Math.floor(t / 5) % 10);      // the offering falling in
      const dx = bx + 5;
      if (dropY < by) {
        if (coin) px(ctx, dx, dropY, 2, 2, gold);            // a coin
        else { px(ctx, dx, dropY, 2, 2, "#f0eadf"); px(ctx, dx, dropY, 2, 1, "#ffffff"); } // mochi
      }
    } else {
      // Unknown / missing tool key: a small stack of prayer pebbles at the base.
      const n = 1 + Math.floor(t / 20) % 3;
      for (let i = 0; i < n; i++) px(ctx, cx + 12, gy - 2 - i * 2, 4, 2, i % 2 ? "#9a948a" : "#7a746a");
    }
  }

  // ---------------------------------------------------------------------------
  // Animation state (module-scoped; all driven by the frame counter `t`).
  // ---------------------------------------------------------------------------
  let blinkT = 0;      // filled-eye blink timer
  let doneT = 0;       // frames spent in `done` — drives the eye-painting + bow
  let oopsT = 0;       // decaying knocked-wobble timer
  let prevOops = false;
  let patT = 0;        // continuous head-pat timer

  function draw(ctx, canvas, state, warn, bubble, t, extra) {
    const x = extra || {};
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Calendar ambience (moon / season / weather / festival) behind the doll.
    K.ambient(ctx, canvas, t);

    const cx = (K && K.centreCx) ? K.centreCx(canvas) : 25;
    const gy = GY;                 // the doll rests its base on the ground row
    const night = K.isNight();

    // The eye-painting counter resets the instant we leave `done`, so every
    // finished job earns a fresh, un-painted eye to fill.
    if (state === "done") doneT++; else doneT = 0;

    // A tool error arms a violent knocked wobble that decays away (rising edge).
    if (x.oops && !prevOops) oopsT = 42;
    prevOops = !!x.oops;
    if (oopsT > 0) oopsT--;

    // Head-pat timer (idle only).
    if (x.pat && state === "idle" && !x.dragging) patT++; else patT = 0;

    // Blink the filled eye only (the blank one is paint).
    if (blinkT > 0) blinkT--;
    else if (Math.random() < 0.014) blinkT = 7;

    // Gaze: the catch-light nudges 1px toward the cursor.
    let gaze = 0;
    if (x.gazeX != null && !x.dragging && !x.tickle) {
      const d = x.gazeX / S - cx;
      gaze = d > 2 ? 1 : d < -2 ? -1 : 0;
    }

    // Ground shadow (shrinks and fades when picked up).
    ctx.fillStyle = x.dragging ? "rgba(0,0,0,0.10)" : "rgba(0,0,0,0.20)";
    ctx.beginPath();
    ctx.ellipse(cx * S, gy * S + 3, (x.dragging ? 11 : 15) * S, 2.4 * S, 0, 0, Math.PI * 2);
    ctx.fill();

    // ---- decide the rock angle and the expression for this frame ----
    let angle = 0;
    const o = { gaze, brow: "normal", mouth: "stern" };

    if (x.dragging) {
      // Weighted bottom resists the lift: a slow, heavy sway, mouth flattened.
      angle = Math.sin(t * 0.14) * 4 * DEG;
      o.brow = "up";
      o.mouth = "flat";
    } else if (state === "limit") {
      // Quota spent: a slumped lean, both eyes shut.
      angle = 6 * DEG;
      o.eyeClosed = true;
    } else if (state === "attention") {
      // Stillness itself is the signal: dead upright, brows raised high.
      angle = 0;
      o.brow = "up";
    } else if (state === "working") {
      // Perseverance: a faster, deeper, determined rocking; brows furrowed.
      angle = Math.sin(t * 0.13) * 3.6 * DEG;
      o.brow = "down";
    } else if (state === "done") {
      // THE moment: the blank eye is painted in over ~20 frames...
      const paintDur = 20;
      o.paint = Math.min(1, doneT / paintDur);
      o.brow = "up";
      o.mouth = "smile";
      if (doneT < paintDur) {
        angle = Math.sin(t * 0.05) * 1.5 * DEG;          // steady while the brush works
      } else {
        // ...then a triumphant deep bow-and-return rock, scaled by celebrate.
        const lvl = x.celebrate || 0;
        const amp = 5 + lvl * 2;
        angle = Math.sin((doneT - paintDur) * 0.16) * amp * DEG;
      }
    } else {
      // idle
      if (x.tickle) {
        angle = Math.sin(t * 0.6) * 2 * DEG;             // rapid tiny wobble
        o.brow = "up";
        o.mouth = "smile";
      } else if (patT > 0) {
        angle = Math.sin(t * 0.18) * 3 * DEG;            // pleased happy wobble
        o.brow = "up";
        o.mouth = "smile";
      } else if (night) {
        angle = Math.sin(t * 0.03) * 2 * DEG;            // resting overnight
        o.eyeClosed = true;
      } else {
        angle = Math.sin(t * 0.04) * 2.6 * DEG;          // slow gentle rocking
      }
    }

    // The filled eye blinks only in calm, open-eyed states.
    if (blinkT > 0 && !o.eyeClosed && !x.dragging && state !== "attention" && state !== "done") {
      o.blink = true;
    }

    // Oops overlays a decaying violent wobble + a spiral pupil in the filled eye.
    if (oopsT > 0 && !x.dragging) {
      angle += Math.sin(t * 0.8) * 8 * DEG * (oopsT / 42);
      o.dizzy = true;
      o.dizzyT = t;
      o.brow = "up";
    }

    // ---- draw the rocking doll (art + base-level tool token rock together) ----
    withRock(ctx, cx, gy, angle, () => {
      if (state === "working" && x.toolNote) toolToken(ctx, cx, gy, x.toolNote, t);
      drawDaruma(ctx, cx, gy, o);
    });

    // ---- overlays in screen space (unrotated, so they don't jitter) ----
    const headTop = gy - 31;

    // Completion confetti, once the eye is fully painted.
    if (state === "done" && doneT >= 20) {
      K.confetti(ctx, canvas, cx, Math.max(1, x.celebrate || 1), t);
    }

    // Affection hearts.
    if (state === "idle" && !x.dragging) {
      if (x.tickle) {
        K.heart(ctx, cx - 15, headTop + 6, 0.7);
      } else if (patT > 0) {
        if (patT > 120) {
          for (let i = 0; i < 3; i++) {
            const a = t * 0.08 + i * 2.1;
            K.heart(ctx, cx + Math.round(Math.cos(a) * 12), headTop + 8 + Math.round(Math.sin(a) * 5), 0.85);
          }
        } else {
          K.heart(ctx, cx + 9, headTop + 4 - ((t % 50) / 12), 0.85);
        }
      }
    }

    // Sleep Zzz: quota-spent, or resting overnight.
    if (state === "limit") {
      K.zzz(ctx, cx + 6, gy - 26, t, 3);
    } else if (night && state === "idle" && !x.dragging && !x.tickle && patT === 0) {
      K.zzz(ctx, cx + 6, gy - 26, t, 1);
    }

    // Multi-session badge.
    if ((x.sessions || 0) > 1 && !x.dragging) {
      ctx.font = "bold 11px Consolas, monospace";
      ctx.fillStyle = COL.gold;
      ctx.fillText("×" + x.sessions, (cx + 14) * S, (headTop + 6) * S);
    }

    // Usage warning: a slow-blinking amber exclamation above the head (mirrors
    // pet.js / tabby.js).
    if (warn && state !== "limit" && !x.dragging && Math.floor(t / 30) % 2 === 0) {
      px(ctx, cx - 1, headTop - 2, 2, 4, AMBER);
      px(ctx, cx - 1, headTop + 3, 2, 2, AMBER);
    }

    // Tool status tag (off the doll's shoulder) — plain toolNote key.
    if (state === "working" && !bubble) {
      K.statusTag(ctx, canvas, cx, gy - 30, x.toolNote || "working", t);
    }

    // Speech bubble, anchored to the rest head-top so the rock doesn't shake it.
    if (bubble) K.bubbleBox(ctx, canvas, bubble, cx, (gy - 31) * S);
  }

  window.PetRenderer = { draw };
})();
