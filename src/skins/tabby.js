// Skin: Tabby the Slacker — an original pixel orange cat
// Overrides window.PetRenderer, reusing window.PetKit.

(function () {
  const K = window.PetKit;
  const { S, GY, px } = K;
  const O = "#e8933a";  // orange
  const D = "#c9712a";  // dark orange stripes
  const W = "#f7efe2";  // white fur
  const P = "#e8879a";  // pink (inner ear / nose)
  const E = "#2b241c";  // eyes

  function catEyes(ctx, cx, hy, mode) {
    const L = cx - 5, R = cx + 3;
    if (mode === "closed") {
      px(ctx, L, hy + 4, 3, 1, E);
      px(ctx, R, hy + 4, 3, 1, E);
    } else if (mode === "happy") {
      for (const ex of [L, R]) {
        px(ctx, ex, hy + 4, 1, 1, E);
        px(ctx, ex + 1, hy + 3, 1, 1, E);
        px(ctx, ex + 2, hy + 4, 1, 1, E);
      }
    } else if (mode === "wide") {
      px(ctx, L, hy + 2, 2, 3, E);
      px(ctx, R + 1, hy + 2, 2, 3, E);
    } else if (mode === "down") {
      px(ctx, L, hy + 4, 2, 2, E);
      px(ctx, R + 1, hy + 4, 2, 2, E);
    } else {
      px(ctx, L, hy + 3, 2, 2, E);
      px(ctx, R + 1, hy + 3, 2, 2, E);
    }
  }

  // Sitting cat. tail: -2..2 tail-wag phase; returns the head-top row
  function catSit(ctx, cx, o) {
    const hy = GY - 17 - (o.bounce || 0);
    const t2 = o.tail || 0;
    // Tail (curls up on the right and sways)
    px(ctx, cx + 11, GY - 6, 2, 4, O);
    px(ctx, cx + 12 + t2, GY - 9, 2, 3, O);
    px(ctx, cx + 13 + t2 * 2, GY - 11, 2, 2, D);
    // Rear body
    px(ctx, cx - 9, GY - 9, 18, 9, O);
    px(ctx, cx - 9, GY - 1, 18, 1, D);
    // White chest
    px(ctx, cx - 3, GY - 7, 7, 7, W);
    // Head
    px(ctx, cx - 8, hy, 16, 8, O);
    // Ears
    px(ctx, cx - 8, hy - 3, 4, 3, O);
    px(ctx, cx + 4, hy - 3, 4, 3, O);
    px(ctx, cx - 7, hy - 2, 2, 2, P);
    px(ctx, cx + 5, hy - 2, 2, 2, P);
    // Forehead stripes
    px(ctx, cx - 5, hy, 2, 2, D);
    px(ctx, cx - 1, hy, 2, 2, D);
    px(ctx, cx + 3, hy, 2, 2, D);
    catEyes(ctx, cx, hy, o.eyes || "open");
    // White muzzle + pink nose
    px(ctx, cx - 2, hy + 5, 5, 3, W);
    px(ctx, cx, hy + 5, 1, 1, P);
    // Front paws
    const tap = o.tap ? 1 : 0;
    px(ctx, cx - 5, GY - 2 + (o.typing ? tap : 0), 3, 2, O);
    px(ctx, cx + 2, GY - 2 + (o.typing ? 1 - tap : 0), 3, 2, O);
    px(ctx, cx - 5, GY - 1, 3, 1, W);
    px(ctx, cx + 2, GY - 1, 3, 1, W);
    return hy;
  }

  // Curled up asleep
  function catCurl(ctx, cx, t) {
    const br = Math.sin(t * 0.045) > 0 ? 1 : 0;
    px(ctx, cx - 10, GY - 8 - br, 20, 8 + br, O);
    px(ctx, cx - 8, GY - 10 - br, 16, 2, O);
    px(ctx, cx - 10, GY - 2, 20, 2, D);
    // Head tucked against the side
    px(ctx, cx + 2, GY - 9 - br, 8, 5, O);
    px(ctx, cx + 3, GY - 11 - br, 2, 2, O);
    px(ctx, cx + 8, GY - 11 - br, 2, 2, O);
    px(ctx, cx + 4, GY - 7 - br, 3, 1, E); // closed eye
    // Tail wrapped around to the front
    px(ctx, cx - 12, GY - 5, 3, 3, D);
    return GY - 11;
  }

  // Picked up: cat goes limp, body stretches out with limbs dangling
  function catDangle(ctx, cx, t) {
    const hy = GY - 32 + Math.round(Math.sin(t * 0.2));
    px(ctx, cx - 8, hy, 16, 7, O);
    px(ctx, cx - 8, hy - 3, 4, 3, O);
    px(ctx, cx + 4, hy - 3, 4, 3, O);
    catEyes(ctx, cx, hy, "wide");
    px(ctx, cx - 2, hy + 5, 5, 2, W);
    // Stretched-out body
    px(ctx, cx - 6, hy + 7, 12, 12, O);
    px(ctx, cx - 2, hy + 8, 5, 10, W);
    // Dangling limbs (slight sway)
    for (const [lx, ph] of [[-6, 0], [-2, 1.2], [2, 2.1], [5, 3.0]]) {
      const sway = Math.sin(t * 0.15 + ph) > 0 ? 1 : 0;
      px(ctx, cx + lx + sway, hy + 19, 2, 4, O);
    }
    // Tail hanging straight down
    px(ctx, cx + 7, hy + 18, 2, 6, D);
    return hy;
  }

  let wx = 0, wTarget = 0, wMode = "stand", wUntil = -1;
  let patT = 0;

  function draw(ctx, canvas, state, warn, bubble, t, extra) {
    const x = extra || {};
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let cx = 25;
    if (state === "idle" && !x.dragging) {
      if (t >= wUntil) {
        const r = Math.random();
        const night = K.isNight();
        if (r < (night ? 0.5 : 0.2)) { wMode = "doze"; wUntil = t + 800 + Math.random() * 900; }
        else if (r < 0.5) { wMode = "walk"; wTarget = Math.round(Math.random() * 20 - 10); wUntil = t + 100000; }
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
    if (x.oops) cx += t % 6 < 3 ? 1 : -1;

    ctx.fillStyle = x.dragging ? "rgba(0,0,0,0.10)" : "rgba(0,0,0,0.18)";
    ctx.beginPath();
    ctx.ellipse(cx * S, GY * S + 4, 14 * S, 2.3 * S, 0, 0, Math.PI * 2);
    ctx.fill();

    const tailSlow = Math.round(Math.sin(t * 0.05) * 1.5);
    const tailFast = Math.round(Math.sin(t * 0.18) * 2);
    let hy;

    if (x.dragging) {
      hy = catDangle(ctx, cx, t);
    } else if (state === "limit") {
      hy = catCurl(ctx, cx, t);
      K.zzz(ctx, cx, GY - 14, t, 3);
    } else if (state === "working") {
      const note = x.toolNote || "";
      const tired = (x.workSecs || 0) >= 600;
      if (note === "cmd") {
        hy = catSit(ctx, cx, { eyes: "down", typing: true, tap: Math.floor(t / 5) % 2 === 0, tail: tailFast });
        px(ctx, cx - 7, GY - 1, 14, 2, "#3a3630"); // keyboard
      } else if (note === "reading") {
        hy = catSit(ctx, cx, { eyes: "down", tail: tailSlow });
        px(ctx, cx - 6, GY - 3, 6, 4, "#e8e2d8");
        px(ctx, cx + 1, GY - 3, 6, 4, "#f0eadf");
        px(ctx, cx, GY - 4, 1, 5, "#8a8478");
      } else {
        // Thinking / other tools: tail whips fast like a metronome
        hy = catSit(ctx, cx, { eyes: tired ? "down" : "open", tail: tailFast });
      }
      if (!bubble) {
        // toolNote is already a stable English key ("cmd"/"reading"/…) or a short tool name
        const label = note || "thinking";
        K.statusTag(ctx, canvas, cx, hy, label, t);
      }
      if (K.isNight()) px(ctx, cx - 3, hy - 1, 6, 1, "#f0d468");
      if (tired) px(ctx, cx + 9, hy + 2 + (Math.floor(t / 30) % 3), 1, 2, "#7fb4d9");
    } else if (state === "attention") {
      const waited = x.attnSecs || 0;
      if (waited >= 300) {
        hy = catCurl(ctx, cx, t);
        catEyes(ctx, cx + 4, GY - 12, "open"); // lying down but eyes open, staring at you
      } else {
        // Raise a paw to scratch the glass + hop
        const hop = t % 50 < 8 ? 2 : 0;
        hy = catSit(ctx, cx, { eyes: waited >= 120 ? "wide" : "open", bounce: hop, tail: tailFast });
        const up = Math.floor(t / 10) % 2 === 0 ? 2 : 0;
        px(ctx, cx + 8, hy + 4 - up, 3, 2, O);
        px(ctx, cx + 9, hy + 3 - up, 2, 1, W);
      }
    } else if (state === "done") {
      const level = x.celebrate || 0;
      const b = Math.abs(Math.sin(t * 0.13)) * (level >= 2 ? 7 : 5);
      hy = catSit(ctx, cx, { eyes: "happy", bounce: b, tail: tailFast });
      K.heart(ctx, cx + (Math.floor(t / 18) % 2 ? 14 : -16), hy - 4, 0.9);
      if (level >= 1) K.confetti(ctx, canvas, cx, level, t);
    } else {
      // idle
      if (x.pat) {
        patT++;
        hy = catSit(ctx, cx, { eyes: "happy", tail: tailSlow });
        if (patT > 120) {
          for (let i = 0; i < 3; i++) {
            const a = t * 0.08 + i * 2.1;
            K.heart(ctx, cx + Math.round(Math.cos(a) * 13), hy + 6 + Math.round(Math.sin(a) * 5), 0.85);
          }
        } else {
          K.heart(ctx, cx + 9, hy - 4 - ((t % 50) / 12), 0.8);
        }
      } else if (wMode === "doze") {
        hy = catCurl(ctx, cx, t);
        K.zzz(ctx, cx, GY - 14, t, 1);
      } else {
        const blink = Math.floor(t / 90) % 7 === 0;
        hy = catSit(ctx, cx, { eyes: blink ? "closed" : "open", tail: tailSlow });
      }
      if (!x.pat) patT = 0;
    }

    if (x.oops && !x.dragging) {
      const R = "#d05045";
      px(ctx, cx - 17, hy - 4, 1, 4, R);
      px(ctx, cx - 15, hy - 4, 1, 4, R);
      px(ctx, cx - 18, hy - 3, 4, 1, R);
      px(ctx, cx - 18, hy - 1, 4, 1, R);
    }
    if (warn && state !== "limit" && Math.floor(t / 30) % 2 === 0) {
      px(ctx, cx - 1, hy - 8, 2, 4, "#e0a63b");
      px(ctx, cx - 1, hy - 3, 2, 2, "#e0a63b");
    }
    if ((x.sessions || 0) > 1 && !x.dragging) {
      ctx.font = "bold 11px Consolas, monospace";
      ctx.fillStyle = "#e0a63b";
      ctx.fillText("×" + x.sessions, (cx + 14) * S, (hy - 2) * S);
    }
    if (bubble) K.bubbleBox(ctx, canvas, bubble, cx, hy * S);
  }

  window.PetRenderer = { draw };
})();
