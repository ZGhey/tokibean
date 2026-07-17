// Skin: Shiba the Good Boy — an original pixel shiba inu
// @skin-name-zh 柴犬·豆豆
// @skin-name-en Shiba
// Overrides window.PetRenderer, reusing window.PetKit.
//
// Design rule: Shiba is a loyal, upbeat dog. Every state is expressed through dog
// body language — tail wags, perked ears, a lifted paw, tongue-out zoomies — while
// keeping the same stable tool-note key contract for the working states.
//
// The character geometry is fixed (a user-approved sprite); only animation offsets
// move. All offsets are relative to the pet column (cx) and the ground row (gy),
// re-anchored to the real canvas the same way tabby.js does.

(function () {
  const K = window.PetKit;
  const { S, GY, px } = K;

  const COAT = "#e0893e";   // shiba coat (orange-tan)
  const SHADE = "#c26d2b";  // darker fur (tail swirl, belly line)
  const CREAM = "#faf3e3";  // urajiro cream (bib, muzzle, inner ear)
  const INK = "#26221d";    // eyes, nose, mouth
  const BLUSH = "#f0a8a0";  // cheek blush
  const TONGUE = "#f0808a"; // tongue (done)
  const AMBER = "#e0a63b";  // warn / sound waves
  const R = "#d05045";      // fail / annoyance

  // ---- Prop-theater palette (working-state tool props) -----------------------
  const DIRT = "#8a6b4a";   // dug earth / paw-print trail
  const DIRTLT = "#a3805a"; // lighter dirt / box lid
  const PAPER = "#ece6d8";  // newspaper page
  const PAPER2 = "#f4efe4"; // newspaper page (brighter half)
  const KEYBG = "#2a2723";  // keyboard chassis
  const KEYCAP = "#454c58"; // resting keycap
  const KEYLIT = "#9fe8a0"; // lit keycap glow
  const GREEN = "#4a9a4a";  // check mark / pass
  const BONE = "#efe6cf";   // bone (commit / task / reward)
  const BONEH = "#fffdf6";  // bone highlight / pulse
  const DISC = "#7fb4d9";   // frisbee
  const DISC2 = "#a9d2ec";  // frisbee highlight
  const BALL = "#e05a45";   // thrown fetch ball
  const BOWL = "#b9c2c9";   // food bowl rim
  const KIBBLE = "#c98a4a"; // kibble in bowl
  const ROPE = "#c9a36a";   // dragging rope

  // ---- Eyes ------------------------------------------------------------------
  // Each eye is a 2x2 ink block at row `ey`. Modes cover the whole personality:
  // open (with cursor gaze), closed/blink (flat line), happy arc, wide (startled),
  // squint (>< oops).
  function shibaEyes(ctx, cx, ey, mode, gaze) {
    const L = cx - 6, R2 = cx + 5;
    const gx = gaze ? gaze.x : 0, gyv = gaze ? gaze.y : 0;
    if (mode === "closed") {
      px(ctx, L, ey + 1, 2, 1, INK);
      px(ctx, R2, ey + 1, 2, 1, INK);
    } else if (mode === "happy") {
      // Upward arcs ^ ^ (content, squinty)
      for (const ex of [L, R2]) {
        px(ctx, ex - 1, ey + 1, 1, 1, INK);
        px(ctx, ex, ey, 1, 1, INK);
        px(ctx, ex + 1, ey, 1, 1, INK);
        px(ctx, ex + 2, ey + 1, 1, 1, INK);
      }
    } else if (mode === "wide") {
      px(ctx, L + gx, ey - 1 + gyv, 2, 3, INK);
      px(ctx, R2 + gx, ey - 1 + gyv, 2, 3, INK);
    } else if (mode === "squint") {
      // >< scrunched shut (oops)
      px(ctx, L, ey, 1, 1, INK); px(ctx, L + 1, ey + 1, 1, 1, INK); px(ctx, L, ey + 2, 1, 1, INK);
      px(ctx, R2 + 1, ey, 1, 1, INK); px(ctx, R2, ey + 1, 1, 1, INK); px(ctx, R2 + 1, ey + 2, 1, 1, INK);
    } else {
      // open, pupils nudge toward the cursor
      px(ctx, L + gx, ey + gyv, 2, 2, INK);
      px(ctx, R2 + gx, ey + gyv, 2, 2, INK);
    }
  }

  // ---- Ears ------------------------------------------------------------------
  // Triangular ears that taper upward with cream inners. `mode` raises them
  // (up/perk), pins them back (pin, for oops), or leaves them at rest. The right
  // ear can twitch a row on its own during idle.
  function drawEars(ctx, hx, gy, mode, twitchR, hd) {
    if (mode === "pin") {
      // Folded back flat against the head (worried / oops)
      px(ctx, hx - 12, gy - 24 + hd, 3, 2, COAT);
      px(ctx, hx - 13, gy - 22 + hd, 2, 2, COAT);
      px(ctx, hx + 9, gy - 24 + hd, 3, 2, COAT);
      px(ctx, hx + 11, gy - 22 + hd, 2, 2, COAT);
      return;
    }
    const up = mode === "perk" ? 2 : mode === "up" ? 1 : 0;
    const tw = twitchR ? 1 : 0;
    // Left ear
    px(ctx, hx - 8, gy - 29 - up + hd, 5, 3, COAT);
    px(ctx, hx - 7, gy - 31 - up + hd, 4, 2, COAT);
    px(ctx, hx - 5, gy - 33 - up + hd, 2, 2, COAT);
    px(ctx, hx - 6, gy - 29 - up + hd, 2, 2, CREAM);
    // Right ear (twitches independently)
    px(ctx, hx + 4, gy - 29 - up - tw + hd, 5, 3, COAT);
    px(ctx, hx + 4, gy - 31 - up - tw + hd, 4, 2, COAT);
    px(ctx, hx + 4, gy - 33 - up - tw + hd, 2, 2, COAT);
    px(ctx, hx + 5, gy - 29 - up - tw + hd, 2, 2, CREAM);
  }

  // ---- Sitting shiba (the approved sprite) -----------------------------------
  // The whole sprite shifts by `dy` for breathing / bounce; the head can shift by
  // headDx/headDy for a tilt. Returns a STABLE overlay-anchor row (ignores bounce)
  // so the bubble/status tag don't jitter while the dog moves.
  function shibaSit(ctx, cx, gy, o) {
    o = o || {};
    const dy = -(o.bounce ? Math.round(o.bounce) : 0) + (o.breath ? 1 : 0);
    const g = gy + dy;
    const hx = cx + (o.headDx || 0);
    const hd = o.headDy || 0;
    const td = o.tailDx || 0;

    // Tail: solid curled swirl against the haunch (wags via td)
    px(ctx, cx + 9 + td, g - 13, 5, 6, SHADE);
    px(ctx, cx + 10 + td, g - 14, 3, 1, SHADE);
    px(ctx, cx + 10 + td, g - 7, 3, 1, SHADE);
    px(ctx, cx + 11 + td, g - 11, 3, 3, CREAM);

    // Body (sitting)
    px(ctx, cx - 9, g - 12, 18, 12, COAT);
    px(ctx, cx - 10, g - 8, 1, 8, COAT);
    px(ctx, cx + 9, g - 8, 1, 8, COAT);
    px(ctx, cx - 3, g - 12, 7, 6, CREAM); // bib

    // Front legs / paws
    if (o.dangle) {
      // Legs hang and kick (being carried)
      const legs = [-3, 1];
      for (let i = 0; i < 2; i++) {
        const kick = Math.sin((o.t || 0) * 0.45 + i * 1.7) > 0 ? 1 : 0;
        px(ctx, cx + legs[i], g - 6, 3, 8 + kick, CREAM);
      }
    } else if (o.pawLift) {
      // Left paw planted, right paw lifted ("give me your hand")
      px(ctx, cx - 3, g - 6, 3, 6, CREAM);
      const lift = o.pawLift > 0.75 ? 3 : 2;
      px(ctx, cx + 1, g - 6 - lift, 3, 4, CREAM);
      px(ctx, cx + 1, g - 3 - lift, 3, 1, COAT);
    } else {
      px(ctx, cx - 3, g - 6, 3, 6, CREAM);
      px(ctx, cx + 1, g - 6, 3, 6, CREAM);
    }

    // Head + cheek fluff
    px(ctx, hx - 9, g - 26 + hd, 19, 13, COAT);
    px(ctx, hx - 11, g - 19 + hd, 2, 4, COAT);
    px(ctx, hx + 10, g - 19 + hd, 2, 4, COAT);
    px(ctx, hx - 10, g - 15 + hd, 2, 2, COAT);
    px(ctx, hx + 9, g - 15 + hd, 2, 2, COAT);

    drawEars(ctx, hx, g, o.earMode || "normal", o.earTwitchR, hd);

    // Urajiro muzzle patch + brow dots
    px(ctx, hx - 5, g - 18 + hd, 11, 5, CREAM);
    px(ctx, hx - 3, g - 19 + hd, 7, 1, CREAM);
    px(ctx, hx - 6, g - 23 + hd, 2, 1, CREAM);
    px(ctx, hx + 5, g - 23 + hd, 2, 1, CREAM);

    shibaEyes(ctx, hx, g - 21 + hd, o.eyes || "open", o.gaze);

    // Nose + ω mouth
    px(ctx, hx - 1, g - 18 + hd, 3, 2, INK);
    px(ctx, hx, g - 16 + hd, 1, 1, INK);
    px(ctx, hx - 2, g - 15 + hd, 2, 1, INK);
    px(ctx, hx + 1, g - 15 + hd, 2, 1, INK);

    // Tongue (done): little pink 2x2 below the mouth
    if (o.tongue) px(ctx, hx - 1, g - 14 + hd, 2, 2, TONGUE);

    // Blush
    px(ctx, hx - 10, g - 17 + hd, 2, 1, BLUSH);
    px(ctx, hx + 9, g - 17 + hd, 2, 1, BLUSH);

    return gy - 28; // stable overlay/bubble anchor (above the head, below ear tips)
  }

  // ---- Lying-down shiba (limit only) -----------------------------------------
  // The one pose where the geometry is rearranged: sprawled flat, ears drooped.
  function shibaLie(ctx, cx, gy, t) {
    const br = Math.sin(t * 0.045) > 0 ? 1 : 0;
    // Curled tail at the rear-left
    px(ctx, cx - 16, gy - 6, 4, 5, SHADE);
    px(ctx, cx - 15, gy - 7, 2, 1, SHADE);
    px(ctx, cx - 14, gy - 4, 2, 2, CREAM);
    // Body stretched along the ground
    px(ctx, cx - 12, gy - 6 - br, 20, 6 + br, COAT);
    px(ctx, cx - 12, gy - 1, 20, 1, SHADE);
    px(ctx, cx - 6, gy - 5, 11, 3, CREAM); // cream underside
    // Head resting on the ground at the right
    const hx = cx + 9;
    px(ctx, hx - 7, gy - 9 - br, 13, 9, COAT);
    // Drooped ears hanging down the sides
    px(ctx, hx - 8, gy - 7 - br, 2, 5, COAT);
    px(ctx, hx + 5, gy - 7 - br, 2, 5, COAT);
    // Muzzle patch + closed eyes + nose
    px(ctx, hx - 4, gy - 5 - br, 10, 4, CREAM);
    px(ctx, hx - 4, gy - 7 - br, 2, 1, INK);
    px(ctx, hx + 2, gy - 7 - br, 2, 1, INK);
    px(ctx, hx + 5, gy - 5 - br, 2, 2, INK);
    return gy - 14;
  }

  // ---- Subagent mini-pup ------------------------------------------------------
  function miniPup(ctx, kx, ky, t, offset) {
    const bounce = Math.abs(Math.sin(t * 0.2 + offset)) > 0.5 ? 1 : 0;
    const y = ky - bounce;
    px(ctx, kx - 3, y, 6, 4, COAT);      // body
    px(ctx, kx - 3, y - 2, 2, 2, COAT);  // left ear
    px(ctx, kx + 1, y - 2, 2, 2, COAT);  // right ear
    px(ctx, kx - 2, y + 1, 1, 1, INK);   // eyes
    px(ctx, kx + 1, y + 1, 1, 1, INK);
    px(ctx, kx - 1, y + 2, 2, 1, CREAM); // muzzle
    const tw = Math.sin(t * 0.3 + offset) > 0 ? 1 : 0;
    px(ctx, kx + 3 + tw, y - 1, 2, 2, SHADE); // curled tail
  }

  // ---- Small props shared by the working-state prop theater ------------------
  // A dog bone: two knobby ends joined by a shaft (5 wide, 3 tall).
  function bone(ctx, bx, by, c) {
    px(ctx, bx, by, 1, 3, c);      // left knob
    px(ctx, bx + 4, by, 1, 3, c);  // right knob
    px(ctx, bx + 1, by + 1, 3, 1, c); // shaft
  }

  // A single paw print: pad plus two toe dots (3 wide, 3 tall).
  function pawPrint(ctx, ax, ay, c) {
    px(ctx, ax, ay + 1, 3, 2, c);  // pad
    px(ctx, ax, ay, 1, 1, c);      // toe
    px(ctx, ax + 2, ay, 1, 1, c);  // toe
  }

  // ---- idle roaming state (skin-internal) ------------------------------------
  let wx = 0, wTarget = 0, wMode = "stand", wUntil = -1;
  let patT = 0;
  let blinkT = 0;
  let earTwitchT = 0;

  function draw(ctx, canvas, state, warn, bubble, t, extra) {
    const x = extra || {};
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    K.ambient(ctx, canvas, t);
    let cx = (K && K.centreCx) ? K.centreCx(canvas) : 25;

    // Eyes-follow-cursor: nudge pupils ±1px toward the cursor (not while dragged / tickled)
    let gaze = null;
    if (x.gazeX != null && x.gazeY != null && !x.dragging && !x.tickle) {
      const dxg = x.gazeX / S - cx;
      const dyg = x.gazeY / S - (GY - 21);
      gaze = { x: dxg > 3 ? 1 : dxg < -3 ? -1 : 0, y: dyg > 3 ? 1 : dyg < -3 ? -1 : 0 };
    }

    // Idle roaming / return to centre when work arrives
    if (state === "idle" && !x.dragging && !x.pat && !x.tickle) {
      if (t >= wUntil) {
        const r = Math.random();
        const night = K.isNight();
        if (r < (night ? 0.55 : 0.16)) { wMode = "doze"; wUntil = t + 700 + Math.random() * 800; }
        else if (r < 0.4) { wMode = "walk"; wTarget = Math.round(Math.random() * 20 - 10); wUntil = t + 100000; }
        else { wMode = "stand"; wUntil = t + 240 + Math.random() * 360; }
      }
      if (wMode === "walk") {
        if (t % 7 === 0) wx += Math.sign(wTarget - wx);
        if (wx === wTarget) { wMode = "stand"; wUntil = t + 300; }
      }
      cx += wx;
    } else if (wx !== 0) {
      if (t % 2 === 0) wx += Math.sign(-wx);
      cx += wx;
    }
    // Tool error: shake side to side a little
    if (x.oops) cx += t % 6 < 3 ? 1 : -1;

    // Ground shadow (shrinks and fades when picked up)
    ctx.fillStyle = x.dragging ? "rgba(0,0,0,0.10)" : "rgba(0,0,0,0.18)";
    ctx.beginPath();
    ctx.ellipse(cx * S, GY * S + 4, (x.dragging ? 10 : 15) * S, 2.3 * S, 0, 0, Math.PI * 2);
    ctx.fill();

    // Blink + occasional single ear-twitch (idle life)
    if (blinkT > 0) blinkT--; else if (Math.random() < 0.012) blinkT = 8;
    if (earTwitchT > 0) earTwitchT--; else if (Math.random() < 0.006) earTwitchT = 6;
    const bl = blinkT > 0;
    const twitch = earTwitchT > 0;

    // Tail wag speeds
    const tailSlow = Math.round(Math.sin(t * 0.05));          // -1..1, lazy
    const tailFast = Math.round(Math.sin(t * 0.32) * 1.5);    // -2..2, excited

    const faceOops = x.oops && !x.dragging && state !== "limit";
    let hy = GY - 28;

    if (x.dragging) {
      // Picked up: suspended and kicking, wide startled eyes
      const gy = GY - 12 + Math.round(Math.sin(t * 0.25));
      hy = shibaSit(ctx, cx, gy, { eyes: "wide", dangle: true, t, earMode: "up", gaze });
    } else if (state === "limit") {
      // Quota exhausted: lying flat, fast asleep
      hy = shibaLie(ctx, cx, GY, t);
      K.zzz(ctx, cx, hy, t, 3);
    } else if (state === "working") {
      const note = x.toolNote || "";
      const lean = Math.sin(t * 0.25) > 0 ? 1 : 0; // rhythmic forward-lean bounce
      if (faceOops) {
        hy = shibaSit(ctx, cx, GY, { eyes: "squint", earMode: "pin", tailDx: 0 });
      } else if (note === "cmd") {
        // cmd: front paws alternately tap a keyboard at the feet; keycaps light per tap
        hy = shibaSit(ctx, cx, GY, {
          eyes: bl ? "closed" : "open", earMode: "up", tailDx: tailFast, bounce: lean, gaze,
        });
        px(ctx, cx - 11, GY - 6, 21, 5, KEYBG); // keyboard chassis
        const tapK = Math.floor(t / 6);
        const lit = (tapK * 3) % 4;             // which keycap lights this beat
        for (let i = 0; i < 4; i++) {
          const kx = cx - 9 + i * 5;
          px(ctx, kx, GY - 5, 4, 3, i === lit ? "#3f5e43" : KEYCAP);
          if (i === lit) px(ctx, kx, GY - 5, 4, 1, KEYLIT); // lit cap glow
        }
        // two front paws tapping in alternation (one presses down, the other lifts)
        const down = tapK % 2 === 0;
        px(ctx, cx - 6, GY - 7 + (down ? 1 : 0), 3, 2, CREAM);
        px(ctx, cx + 3, GY - 7 + (down ? 0 : 1), 3, 2, CREAM);
      } else if (note === "reading") {
        // reading: newspaper spread under the paws, nose nudges the pages over
        hy = shibaSit(ctx, cx, GY, {
          eyes: bl ? "closed" : "open", earMode: "up", tailDx: tailSlow,
          headDy: Math.floor(t / 30) % 3 === 0 ? 1 : 0, gaze,
        });
        px(ctx, cx - 11, GY - 7, 10, 6, PAPER);   // left page
        px(ctx, cx - 1, GY - 7, 11, 6, PAPER2);   // right page
        px(ctx, cx - 1, GY - 8, 1, 7, "#c9c2b2"); // center fold
        for (let r = 0; r < 3; r++) {             // columns of print
          px(ctx, cx - 9, GY - 5 + r * 2, 6, 1, "#b3aca0");
          px(ctx, cx + 2, GY - 5 + r * 2, 6, 1, "#b3aca0");
        }
        const ph = Math.floor(t / 30) % 4;        // a page corner flipping over
        if (ph === 1) px(ctx, cx - 2, GY - 9, 3, 2, BONEH);
        else if (ph === 2) px(ctx, cx, GY - 10, 2, 3, BONEH);
      } else if (note === "coding") {
        // coding: digs a pit, dirt clods flying out behind
        const dig = Math.floor(t / 10) % 2 === 0;
        hy = shibaSit(ctx, cx, GY, {
          eyes: "open", earMode: "up", tailDx: tailFast,
          bounce: dig ? 0 : 1, headDy: dig ? 1 : 0, gaze,
        });
        px(ctx, cx - 8, GY - 1, 12, 2, "#3a2c1d"); // pit
        px(ctx, cx - 9, GY - 2, 2, 1, DIRT);        // rim
        px(ctx, cx + 3, GY - 2, 2, 1, DIRT);
        for (let i = 0; i < 3; i++) {               // clods arcing out behind
          const cp = (t / 6 + i * 1.4) % 3;
          const dx = cx + 12 + Math.round(cp * 3);
          const dyv = GY - 6 - Math.round(Math.sin((cp / 3) * Math.PI) * 7);
          px(ctx, dx, dyv, 2, 2, i % 2 ? DIRT : DIRTLT);
        }
      } else if (note === "searching") {
        // searching: nose low, sweeping left-right; sniff puffs + a paw-print trail appear
        const sdx = Math.round(Math.sin(t * 0.08) * 3);
        hy = shibaSit(ctx, cx, GY, {
          eyes: bl ? "closed" : "open", earMode: "up", tailDx: tailSlow,
          headDx: sdx, headDy: 1, gaze,
        });
        const nx = cx + sdx;
        if (Math.floor(t / 8) % 2 === 0) {          // sniff dust puffs at the nose
          px(ctx, nx + 5, GY - 4, 1, 1, "#d8cdb8");
          px(ctx, nx + 7, GY - 5, 1, 1, "#e8dfca");
        }
        const prints = 5;                           // trail appears one print at a time
        const shown = Math.floor(t / 14) % (prints + 2);
        for (let i = 0; i < prints && i < shown; i++) pawPrint(ctx, cx - 13 + i * 5, GY - 1, DIRTLT);
      } else if (note === "browsing") {
        // browsing: head tracks a frisbee flying past overhead
        const fp = (t % 120) / 120;                 // 0..1 sweep across
        const fxr = -14 + fp * 30;                  // -14..+16 relative to cx
        const fx = cx + Math.round(fxr);
        const fy = GY - 20 - Math.round(Math.sin(fp * Math.PI) * 5);
        hy = shibaSit(ctx, cx, GY, {
          eyes: "open", earMode: "perk", tailDx: tailFast,
          headDx: Math.max(-2, Math.min(2, Math.round(fxr / 8))),
          gaze: { x: fxr > 3 ? 1 : fxr < -3 ? -1 : 0, y: -1 },
        });
        px(ctx, fx - 2, fy, 5, 1, DISC);            // spinning disc
        px(ctx, fx - 1, fy - 1, 3, 1, DISC2);
        px(ctx, fx - 1, fy + 1, 3, 1, DISC);
      } else if (note === "agents") {
        // agents: throws a ball out, mini pups chase it (the pack fetching)
        hy = shibaSit(ctx, cx, GY, {
          eyes: "open", earMode: "up", tailDx: tailFast, headDx: 1, gaze,
        });
        const bp = (t % 90) / 90;
        const bx = cx + 4 + Math.round(bp * 16);    // ball arcing out to the right
        const by = GY - 4 - Math.round(Math.sin(bp * Math.PI) * 9);
        px(ctx, bx, by, 2, 2, BALL);
        px(ctx, bx, by, 1, 1, "#f0908a");
        miniPup(ctx, cx + 8 + Math.round(bp * 10), GY - 4, t, 0);   // pack chasing
        miniPup(ctx, cx + 3 + Math.round(bp * 10), GY - 4, t, 1.5);
      } else if (note === "planning") {
        // planning: a row of bones on the ground, counted one green-check at a time
        hy = shibaSit(ctx, cx, GY, {
          eyes: "open", earMode: "up", tailDx: tailSlow,
          headDx: Math.round(Math.sin(t * 0.06) * 2), headDy: 1, gaze,
        });
        const total = 4;
        const counted = Math.floor(t / 30) % (total + 1);
        for (let i = 0; i < total; i++) {
          bone(ctx, cx - 12 + i * 6, GY - 2, BONE);
          if (i < counted) {                        // green check over a counted bone
            px(ctx, cx - 11 + i * 6, GY - 5, 1, 1, GREEN);
            px(ctx, cx - 10 + i * 6, GY - 4, 1, 1, GREEN);
            px(ctx, cx - 9 + i * 6, GY - 6, 1, 1, GREEN);
          }
        }
      } else if (note === "git") {
        // git: a branching path of paw prints with buried bones as commits; newest pulses
        hy = shibaSit(ctx, cx, GY, {
          eyes: "open", earMode: "up", tailDx: tailSlow,
          headDx: Math.round(Math.sin(t * 0.05) * 2), gaze,
        });
        pawPrint(ctx, cx - 12, GY - 1, DIRTLT);     // main path climbing up-left
        pawPrint(ctx, cx - 8, GY - 3, DIRTLT);
        pawPrint(ctx, cx - 4, GY - 7, DIRTLT);
        for (const [nx, ny] of [[cx - 10, GY - 1], [cx - 6, GY - 5], [cx - 2, GY - 9]]) bone(ctx, nx, ny, BONE); // commits
        pawPrint(ctx, cx + 1, GY - 6, DIRTLT);      // branch splitting off to the right
        pawPrint(ctx, cx + 4, GY - 8, DIRTLT);
        bone(ctx, cx + 5, GY - 10, "#d9c8e0");      // branch commit (pale purple bone)
        if (Math.floor(t / 16) % 2 === 0) bone(ctx, cx - 2, GY - 12, BONEH); // newest bone pulses
      } else if (note === "testing") {
        // testing: two food bowls, sniff-tested each — mostly edible, occasional bad one
        const which = Math.floor(t / 40) % 2;        // which bowl is being sniffed
        const fail = Math.floor(t / 40) % 7 === 6;   // occasional inedible bowl
        const shake = fail ? (t % 4 < 2 ? 1 : -1) : 0; // head-shake on a bad one
        hy = shibaSit(ctx, cx, GY, {
          eyes: bl ? "closed" : "open", earMode: "up", tailDx: fail ? 0 : tailFast,
          headDx: (which === 0 ? -3 : 3) + shake, headDy: 1, gaze,
        });
        for (let i = 0; i < 2; i++) {
          const bxc = cx - 9 + i * 11;
          px(ctx, bxc, GY - 2, 7, 2, BOWL);          // bowl
          px(ctx, bxc + 1, GY - 3, 5, 1, KIBBLE);    // kibble
          if (i === which) {                         // verdict over the sniffed bowl
            const mx = bxc + 2, my = GY - 8;
            if (fail) {                              // red cross
              px(ctx, mx, my, 1, 1, R); px(ctx, mx + 2, my, 1, 1, R);
              px(ctx, mx + 1, my + 1, 1, 1, R);
              px(ctx, mx, my + 2, 1, 1, R); px(ctx, mx + 2, my + 2, 1, 1, R);
            } else {                                 // green check
              px(ctx, mx, my + 1, 1, 1, GREEN); px(ctx, mx + 1, my + 2, 1, 1, GREEN);
              px(ctx, mx + 2, my, 1, 1, GREEN); px(ctx, mx + 3, my - 1, 1, 1, GREEN);
            }
          }
        }
      } else if (note === "deps") {
        // deps: drags a delivery box into frame by a rope held in its teeth
        const dp = (t % 100) / 100;
        const boxx = cx + 20 - Math.round(dp * 16);  // box slides in toward the dog
        hy = shibaSit(ctx, cx, GY, {
          eyes: "open", earMode: "up", tailDx: tailSlow, headDx: 2, headDy: 1, gaze,
        });
        const mnx = cx + 3, mny = GY - 16;           // rope anchor near the muzzle
        for (let i = 0; i <= 6; i++) {               // rope from teeth to box
          const rx = mnx + Math.round((boxx - mnx) * i / 6);
          const ry = mny + Math.round((GY - 5 - mny) * i / 6);
          px(ctx, rx, ry, 1, 1, ROPE);
        }
        px(ctx, boxx, GY - 6, 8, 6, DIRT);           // box
        px(ctx, boxx, GY - 6, 8, 1, DIRTLT);         // lid highlight
        px(ctx, boxx + 3, GY - 6, 1, 6, "#6b4f35");  // tape seam
      } else if (note) {
        // Unknown/other tool (MCP, etc.): generic eager on-tool pose (fallback)
        hy = shibaSit(ctx, cx, GY, {
          eyes: bl ? "closed" : "open",
          earMode: "up",
          tailDx: tailFast,
          bounce: lean,
          gaze,
        });
      } else {
        // Thinking (no tool): slow head-tilt cycle side to side
        const tilt = Math.sin(t * 0.05);
        hy = shibaSit(ctx, cx, GY, {
          eyes: "open",
          earMode: "up",
          tailDx: tailSlow,
          headDx: Math.round(tilt * 2),
          headDy: Math.abs(tilt) > 0.55 ? 1 : 0,
          gaze,
        });
      }
      if (!bubble) K.statusTag(ctx, canvas, cx, hy, note || "thinking", t);
    } else if (state === "attention") {
      // Classic "waiting for you": perked ears, head tilted, one paw lifted
      const waited = x.attnSecs || 0;
      const hop = t % 60 < 8 ? 1 : 0;
      hy = shibaSit(ctx, cx, GY, {
        eyes: faceOops ? "squint" : (bl ? "closed" : "open"),
        earMode: faceOops ? "pin" : "perk",
        headDx: faceOops ? 0 : 2,
        headDy: faceOops ? 0 : 1,
        pawLift: faceOops ? 0 : (Math.floor(t / 20) % 2 === 0 ? 1 : 0.5),
        tailDx: tailFast,
        bounce: hop,
        gaze,
      });
      // Waited a while: little sound waves off the ear
      if (waited >= 120 && !faceOops && Math.floor(t / 10) % 2 === 0) {
        px(ctx, cx + 14, hy + 6, 1, 1, AMBER);
        px(ctx, cx + 16, hy + 4, 1, 1, AMBER);
        px(ctx, cx + 16, hy + 8, 1, 1, AMBER);
      }
    } else if (state === "done") {
      // Zoomies: bouncy jump, tongue out, confetti
      const level = x.celebrate || 0;
      const amp = level >= 2 ? 6 : 4;
      const b = Math.abs(Math.sin(t * 0.2)) * amp;
      hy = shibaSit(ctx, cx, GY, {
        eyes: "happy",
        earMode: "up",
        tongue: true,
        tailDx: tailFast,
        bounce: b,
      });
      K.heart(ctx, cx + (Math.floor(t / 18) % 2 ? 14 : -16), hy + 2, 0.9);
      if (level >= 2) K.heart(ctx, cx + (Math.floor(t / 18) % 2 ? -18 : 16), hy + 5, 0.7);
      if (level >= 1) K.confetti(ctx, canvas, cx, level, t);
    } else {
      // idle: tickle > head-pat > napping > standing/roaming
      if (x.tickle) {
        // Tickled: quick body wiggle + giggle
        const wob = (Math.floor(t / 3) % 2 ? 1 : -1) * 2;
        hy = shibaSit(ctx, cx + wob, GY, { eyes: "happy", earMode: "up", tailDx: tailFast });
        if (Math.floor(t / 6) % 2 === 0) {
          ctx.font = "bold 10px Consolas, monospace";
          ctx.fillStyle = AMBER;
          ctx.fillText("~", (cx + 13) * S, (hy + 6) * S);
        }
        K.heart(ctx, cx - 16, hy + 2, 0.7);
      } else if (x.pat) {
        patT++;
        hy = shibaSit(ctx, cx, GY, { eyes: "happy", earMode: "up", tailDx: tailFast });
        if (patT > 120) {
          // Nuzzled a while: blissful, hearts circling
          for (let i = 0; i < 3; i++) {
            const a = t * 0.08 + i * 2.1;
            K.heart(ctx, cx + Math.round(Math.cos(a) * 13), hy + 6 + Math.round(Math.sin(a) * 5), 0.85);
          }
        } else {
          K.heart(ctx, cx + 9, hy + 2 - ((t % 50) / 12), 0.85);
        }
      } else if (faceOops) {
        hy = shibaSit(ctx, cx, GY, { eyes: "squint", earMode: "pin", tailDx: 0 });
      } else if (wMode === "doze") {
        // Napping (also the default at night)
        hy = shibaLie(ctx, cx, GY, t);
        K.zzz(ctx, cx, hy, t, 1);
      } else {
        // Standing / roaming: breathing, blinking, slow tail wag, ear twitch, gaze
        hy = shibaSit(ctx, cx, GY, {
          eyes: bl ? "closed" : "open",
          breath: Math.sin(t * 0.08) > 0 ? 1 : 0,
          tailDx: tailSlow,
          earTwitchR: twitch,
          gaze,
        });
      }
      if (!x.pat) patT = 0;
    }

    // Tool error: red annoyance mark beside the head
    if (x.oops && !x.dragging) {
      const ax = cx - 15, ay = hy + 2;
      px(ctx, ax, ay, 1, 4, R);
      px(ctx, ax + 2, ay, 1, 4, R);
      px(ctx, ax - 1, ay + 1, 4, 1, R);
      px(ctx, ax - 1, ay + 3, 4, 1, R);
    }

    // Usage warning: amber exclamation above the head (slow blink)
    if (warn && state !== "limit" && !x.dragging && Math.floor(t / 30) % 2 === 0) {
      px(ctx, cx - 1, hy - 5, 2, 3, AMBER);
      px(ctx, cx - 1, hy - 1, 2, 2, AMBER);
    }

    // Multi-session badge
    if ((x.sessions || 0) > 1 && !x.dragging) {
      ctx.font = "bold 11px Consolas, monospace";
      ctx.fillStyle = AMBER;
      ctx.fillText("×" + x.sessions, (cx + 14) * S, (hy + 2) * S);
    }

    // Subagent mini-pups flanking the pet
    const agents = x.agentCount || 0;
    if (agents > 0 && !x.dragging && state !== "limit") {
      const shown = Math.min(agents, 2);
      for (let i = 0; i < shown; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        miniPup(ctx, cx + side * 20, GY - 4, t, i);
      }
      if (agents > 2) {
        ctx.font = "bold 9px Consolas, monospace";
        ctx.fillStyle = COAT;
        ctx.fillText("×" + agents, (cx - 24) * S, (GY - 9) * S);
      }
    }

    if (bubble) K.bubbleBox(ctx, canvas, bubble, cx, hy * S);
  }

  window.PetRenderer = { draw };
})();
