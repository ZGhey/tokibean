// Skin: Tabby the Slacker — an original pixel orange cat
// @skin-name-zh 橘猫·摸鱼
// @skin-name-en Tabby
// Overrides window.PetRenderer, reusing window.PetKit.
//
// Design rule: Tabby is a cat, not a coder in a cat suit. Every tool state is
// reinterpreted as cat behavior (digging in a box, chasing a laser, knocking a
// cup off the table, etc.) while keeping the same stable tool-note key contract.

(function () {
  const K = window.PetKit;
  const { S, GY, px } = K;
  const O = "#e8933a";  // orange fur
  const D = "#c9712a";  // dark orange stripes
  const W = "#f7efe2";  // white fur
  const P = "#e8879a";  // pink (inner ear / nose)
  const E = "#2b241c";  // eyes
  const R = "#d05045";  // red / fail
  const G = "#4a9a4a";  // green / pass
  const AMBER = "#e0a63b";

  function catEyes(ctx, cx, hy, mode, gaze) {
    const L = cx - 5, R = cx + 3;
    const gx = gaze && gaze.x != null ? gaze.x : null;
    const gy = gaze && gaze.y != null ? gaze.y : null;
    let dx = 0, dy = 0;
    if (gx != null && gy != null) {
      // Each eye is 2x2 px; pupil offset capped at 1 px
      const lx = (L + 0.5) * S, ly = (hy + 3.5) * S;
      const rx = (R + 1.5) * S, ry = (hy + 3.5) * S;
      dx = Math.max(-1, Math.min(1, Math.round((gx - (lx + rx) / 2) / S / 4)));
      dy = Math.max(-1, Math.min(1, Math.round((gy - (ly + ry) / 2) / S / 4)));
    }
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
      px(ctx, L + dx, hy + 2 + dy, 2, 3, E);
      px(ctx, R + 1 + dx, hy + 2 + dy, 2, 3, E);
    } else if (mode === "down") {
      px(ctx, L + dx, hy + 4 + dy, 2, 2, E);
      px(ctx, R + 1 + dx, hy + 4 + dy, 2, 2, E);
    } else {
      px(ctx, L + dx, hy + 3 + dy, 2, 2, E);
      px(ctx, R + 1 + dx, hy + 3 + dy, 2, 2, E);
    }
  }

  // Sitting cat. tail: -2..2 tail-wag phase; returns the head-top row
  function catSit(ctx, cx, o) {
    const hy = GY - 17 - (o.bounce || 0);
    const t2 = o.tail || 0;
    // Tail curls up on the right and sways
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
    catEyes(ctx, cx, hy, o.eyes || "open", currentGaze);
    // White muzzle + pink nose
    px(ctx, cx - 2, hy + 5, 5, 3, W);
    px(ctx, cx, hy + 5, 1, 1, P);
    // Front paws
    const tap = o.tap ? 1 : 0;
    if (o.raisedPaw) {
      // One paw lifted (attention: scratching the glass)
      const up = o.raisedPaw > 0 ? 2 : 0;
      px(ctx, cx - 5, GY - 2, 3, 2, O);
      px(ctx, cx - 5, GY - 1, 3, 1, W);
      px(ctx, cx + 8, GY - 4 - up, 3, 3, O);
      px(ctx, cx + 9, GY - 3 - up, 2, 1, W);
    } else if (o.wave) {
      // Friendly wave
      const up = o.waveUp ? 2 : 0;
      px(ctx, cx - 5, GY - 2, 3, 2, O);
      px(ctx, cx - 5, GY - 1, 3, 1, W);
      px(ctx, cx + 8, GY - 4 - up, 3, 2, O);
      px(ctx, cx + 10, GY - 5 - up, 2, 2, W);
    } else {
      px(ctx, cx - 5, GY - 2 + (o.typing ? tap : 0), 3, 2, O);
      px(ctx, cx + 2, GY - 2 + (o.typing ? 1 - tap : 0), 3, 2, O);
      px(ctx, cx - 5, GY - 1, 3, 1, W);
      px(ctx, cx + 2, GY - 1, 3, 1, W);
    }
    return hy;
  }

  // Lying-down cat (side/belly), used for reading, limit, done belly-roll
  function catLie(ctx, cx, o) {
    const hy = GY - 12 - (o.bounce || 0);
    // Body stretched along the ground
    const w = o.belly ? 20 : 22;
    px(ctx, cx - w / 2, GY - 8, w, 8, O);
    px(ctx, cx - w / 2, GY - 2, w, 2, D);
    // White belly patch
    if (o.belly) {
      px(ctx, cx - 6, GY - 6, 12, 5, W);
    } else {
      px(ctx, cx - 7, GY - 6, 10, 5, W);
    }
    // Head
    const hx = o.belly ? cx : cx - 8;
    px(ctx, hx - 8, hy, 16, 8, O);
    px(ctx, hx - 8, hy - 3, 4, 3, O);
    px(ctx, hx + 4, hy - 3, 4, 3, O);
    px(ctx, hx - 7, hy - 2, 2, 2, P);
    px(ctx, hx + 5, hy - 2, 2, 2, P);
    catEyes(ctx, hx, hy, o.eyes || "open", currentGaze);
    px(ctx, hx - 2, hy + 5, 5, 3, W);
    px(ctx, hx, hy + 5, 1, 1, P);
    // Paws
    if (o.belly) {
      // Front paws curled in the air
      px(ctx, cx - 9, GY - 9, 3, 3, O);
      px(ctx, cx + 6, GY - 9, 3, 3, O);
      // Hind paws splayed
      px(ctx, cx - 10, GY - 3, 3, 2, O);
      px(ctx, cx + 7, GY - 3, 3, 2, O);
    } else {
      // Lying on side: paws stacked at the front
      px(ctx, cx + 6, GY - 5, 3, 3, O);
      px(ctx, cx + 9, GY - 5, 2, 3, O);
    }
    // Tail
    const tx = o.belly ? cx + 10 : cx + 10;
    const tailY = o.belly ? GY - 4 : GY - 6;
    px(ctx, tx, tailY, 2, 4, O);
    px(ctx, tx + 1, tailY - 3, 2, 3, O);
    px(ctx, tx + 2, tailY - 5, 2, 2, D);
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

  // ---------- Tool props (cat behavior reinterpretations) ----------

  function keyboard(ctx, cx, t) {
    // Cat sprawled over a keyboard; keys light up under its paws
    px(ctx, cx - 10, GY - 3, 20, 3, "#2a2723");
    const lit = Math.floor(t / 5) % 4;
    const keys = [cx - 8, cx - 3, cx + 2, cx + 7];
    for (let i = 0; i < 4; i++) {
      const on = i === lit;
      px(ctx, keys[i], GY - 2, 3, 2, on ? "#4a6b4a" : "#454c58");
    }
  }

  function openBook(ctx, cx, t) {
    // Cat lying on an open book; pages turn slowly
    px(ctx, cx - 9, GY - 4, 8, 5, "#e8e2d8");
    px(ctx, cx + 1, GY - 4, 8, 5, "#f0eadf");
    px(ctx, cx - 1, GY - 5, 2, 6, "#8a8478");
    const ph = Math.floor(t / 34) % 4;
    if (ph === 1) px(ctx, cx - 6, GY - 6, 3, 2, "#fffdf6");
    else if (ph === 2) px(ctx, cx - 1, GY - 7, 2, 3, "#fffdf6");
    else if (ph === 3) px(ctx, cx + 3, GY - 6, 3, 2, "#fffdf6");
  }

  function litterBox(ctx, cx, t) {
    // Cat digging in a litter box; sand particles fly
    const boxX = cx - 9;
    px(ctx, boxX, GY - 4, 18, 4, "#c9b79a"); // box
    px(ctx, boxX, GY - 5, 18, 1, "#a89f8c"); // rim
    // Sand surface
    px(ctx, boxX + 2, GY - 4, 14, 2, "#d9c9a9");
    // Alternating paws digging
    const dig = Math.floor(t / 6) % 2;
    px(ctx, cx - 4 + dig, GY - 5, 3, 2, O);
    px(ctx, cx + 1 - dig, GY - 4, 3, 2, O);
    // Sand spray
    for (let i = 0; i < 3; i++) {
      const phase = (t / 8 + i * 1.3) % 3;
      if (phase < 2) {
        px(ctx, cx - 2 + i * 2, GY - 7 - Math.round(phase), 1, 1, "#d9c9a9");
      }
    }
  }

  function cardboardBox(ctx, cx, t) {
    // Cat head stuck in a cardboard box; only body and tail visible
    const bx = cx - 8;
    px(ctx, bx, GY - 10, 16, 10, "#a3805a"); // box back
    px(ctx, bx, GY - 10, 16, 1, "#c9a77a");  // top rim
    px(ctx, bx, GY - 1, 16, 1, "#6b4f35");   // bottom shadow
    // Cat rump wiggling as it rummages inside
    const wiggle = t % 8 < 4 ? 0 : 1;
    px(ctx, cx - 7 + wiggle, GY - 10, 14, 6, O);
    px(ctx, cx - 6 + wiggle, GY - 11, 12, 2, O);
    px(ctx, cx - 7 + wiggle, GY - 5, 14, 2, D);
    // Tail sticking up out of the box, flicking
    const flick = Math.round(Math.sin(t * 0.25) * 2);
    px(ctx, cx + 5 + wiggle, GY - 16 + flick, 2, 5, O);
    px(ctx, cx + 6 + wiggle, GY - 18 + flick, 2, 2, D);
  }

  function fishTank(ctx, cx, t) {
    // Cat sitting beside a fish tank, watching fish swim by
    px(ctx, cx + 12, GY - 13, 12, 11, "#7fb4d9"); // tank water
    px(ctx, cx + 12, GY - 14, 12, 1, "#5a8fd4");  // top rim
    px(ctx, cx + 12, GY - 2, 12, 1, "#5a8fd4");   // bottom rim
    // Fish swimming left to right
    const fx = cx + 14 + ((Math.floor(t / 7) % 9));
    px(ctx, fx, GY - 9, 3, 2, "#e0a63b");
    px(ctx, fx + 3, GY - 8, 1, 1, "#e0a63b");
    // Bubbles
    for (let i = 0; i < 2; i++) {
      const by = GY - 12 - ((Math.floor(t / 10) + i * 3) % 7);
      px(ctx, cx + 15 + i * 4, by, 1, 1, "rgba(255,255,255,0.7)");
    }
  }

  function checklist(ctx, cx, t) {
    // Cat pawing items off a vertical checklist
    const bx = cx + 10;
    px(ctx, bx, GY - 14, 8, 13, "#e8e2d8"); // clipboard
    px(ctx, bx, GY - 15, 8, 1, "#8a8478");  // clip
    const done = Math.floor(t / 35) % 4;
    for (let i = 0; i < 3; i++) {
      const y = GY - 12 + i * 4;
      px(ctx, bx + 1, y, 4, 1, "#6b665c"); // item line
      if (i < done) {
        // Knocked-off item falling to the right
        const fall = (t / 8 + i) % 4;
        px(ctx, bx + 4 + Math.round(fall), y + Math.round(fall), 2, 1, R);
      }
    }
  }

  function yarnTangle(ctx, cx, t) {
    // Cat tangled in yarn; strands branch like git history
    const Y = "#d97757";
    // Main strand around the cat
    px(ctx, cx - 10, GY - 8, 20, 1, Y);
    px(ctx, cx - 8, GY - 5, 1, 5, Y);
    px(ctx, cx + 7, GY - 6, 1, 4, Y);
    // Branch strands
    px(ctx, cx + 4, GY - 8, 8, 1, "#9b7fd4");
    px(ctx, cx + 11, GY - 10, 1, 3, "#9b7fd4");
    px(ctx, cx - 8, GY - 8, 6, 1, "#7fb4d9");
    px(ctx, cx - 12, GY - 7, 1, 3, "#7fb4d9");
    // Yarn ball on the ground, slightly rolling
    const roll = Math.floor(t / 12) % 2;
    px(ctx, cx - 15 + roll, GY - 3, 4, 3, Y);
    px(ctx, cx - 14 + roll, GY - 4, 2, 1, Y);
  }

  function testingShelf(ctx, cx, t) {
    // Cat on a shelf pushing a cup toward the edge
    const sx = cx - 12;
    px(ctx, sx, GY - 10, 18, 2, "#6b4f35"); // shelf
    // Cup sliding toward the edge
    const slide = (Math.floor(t / 5) % 10);
    const cupX = sx + 3 + slide;
    px(ctx, cupX, GY - 13, 3, 3, "#d9c9a9");
    px(ctx, cupX + 1, GY - 14, 1, 1, "#fffdf6");
    // Cat paw pushing
    const push = slide < 8 ? 0 : 1;
    px(ctx, cupX - 3 - push, GY - 11, 3, 2, O);
    // Result: near the end of the cycle, show pass/fail
    if (slide >= 8) {
      const pass = Math.floor(t / 45) % 5 !== 4;
      const rx = cupX + 4, ry = GY - 14;
      if (pass) {
        px(ctx, rx, ry + 1, 1, 1, G); px(ctx, rx + 1, ry + 2, 1, 1, G);
        px(ctx, rx + 2, ry, 1, 1, G); px(ctx, rx + 3, ry - 1, 1, 1, G);
      } else {
        px(ctx, rx, ry, 1, 1, R); px(ctx, rx + 2, ry, 1, 1, R);
        px(ctx, rx + 1, ry + 1, 1, 1, R);
        px(ctx, rx, ry + 2, 1, 1, R); px(ctx, rx + 2, ry + 2, 1, 1, R);
      }
    }
  }

  function packageBoxes(ctx, cx, t) {
    // Cat playing in a pile of delivery boxes
    // Box 1: stacked
    px(ctx, cx - 14, GY - 5, 8, 5, "#a3805a");
    px(ctx, cx - 14, GY - 5, 8, 1, "#c9a77a");
    // Box 2: tipped over, cat peeking out
    px(ctx, cx + 5, GY - 7, 9, 6, "#a3805a");
    px(ctx, cx + 5, GY - 7, 9, 1, "#c9a77a");
    const peek = t % 20 < 12;
    if (peek) {
      // Cat ears and eyes peeking from the box opening
      px(ctx, cx + 8, GY - 10, 3, 3, O);
      px(ctx, cx + 12, GY - 10, 3, 3, O);
      px(ctx, cx + 9, GY - 8, 1, 1, E);
      px(ctx, cx + 13, GY - 8, 1, 1, E);
    }
    // Falling arrow / package dropping in
    const ay = GY - 15 + (Math.floor(t / 6) % 5);
    px(ctx, cx - 10, ay, 1, 3, "#7fb4d9");
    px(ctx, cx - 11, ay + 2, 3, 1, "#7fb4d9");
    px(ctx, cx - 10, ay + 3, 1, 1, "#7fb4d9");
  }

  function chasingTail(ctx, cx, t) {
    // Thinking: cat chasing its own tail in a tight circle
    const ang = t * 0.12;
    const r = 6;
    const tx = cx + Math.round(Math.cos(ang) * r);
    const ty = GY - 7 + Math.round(Math.sin(ang) * r * 0.5);
    // Dashed circular path
    for (let i = 0; i < 8; i++) {
      const a = ang + i * Math.PI / 4;
      const x = cx + Math.round(Math.cos(a) * r);
      const y = GY - 7 + Math.round(Math.sin(a) * r * 0.5);
      px(ctx, x, y, 1, 1, i % 2 === 0 ? D : O);
    }
    // Cat body slightly crouched, facing the tail
    px(ctx, cx - 2, GY - 8, 4, 6, O);
    px(ctx, cx - 1, GY - 10, 2, 2, O);
    catEyes(ctx, cx, GY - 9, "wide");
    // Tail tip at tx,ty
    px(ctx, tx, ty, 2, 2, D);
    return GY - 9;
  }

  function lickPaw(ctx, cx, t) {
    // Idle: cat sitting and grooming a front paw
    const hy = catSit(ctx, cx, { eyes: "closed", tail: Math.round(Math.sin(t * 0.05)) });
    const lick = t % 20 < 10;
    // Raised paw near mouth
    px(ctx, cx + 5, GY - 6 - (lick ? 1 : 0), 3, 2, O);
    px(ctx, cx + 5, GY - 5 - (lick ? 1 : 0), 3, 1, W);
    // Little tongue flicker
    if (lick) px(ctx, cx + 6, hy + 6, 1, 1, P);
    return hy;
  }

  function stretchCat(ctx, cx, t) {
    // Idle: full-body stretch, front paws forward, rear up
    const hy = GY - 16;
    // Head low, front extended
    px(ctx, cx - 6, hy, 12, 7, O);
    px(ctx, cx - 6, hy - 3, 3, 3, O);
    px(ctx, cx + 3, hy - 3, 3, 3, O);
    catEyes(ctx, cx, hy, "closed", currentGaze);
    px(ctx, cx - 2, hy + 5, 4, 2, W);
    // Front paws extended far forward
    px(ctx, cx - 12, GY - 3, 6, 2, O);
    px(ctx, cx - 11, GY - 2, 4, 1, W);
    // Rear up
    px(ctx, cx - 3, GY - 9, 8, 8, O);
    px(ctx, cx - 3, GY - 2, 8, 1, D);
    // Tail up and curved
    px(ctx, cx + 5, GY - 14, 2, 6, O);
    px(ctx, cx + 4, GY - 16, 3, 2, D);
    return hy;
  }

  function laserChase(ctx, cx, t) {
    // Idle: cat tracking and pouncing at a red laser dot
    const dotX = cx - 12 + ((Math.floor(t * 0.7) % 26));
    const dotY = GY - 10 + Math.round(Math.sin(t * 0.2) * 4);
    px(ctx, dotX, dotY, 1, 1, "#d05045");
    // Cat crouched, facing the dot
    const facingRight = dotX > cx;
    const hx = facingRight ? cx + 2 : cx - 2;
    const dir = facingRight ? 1 : -1;
    px(ctx, hx - 6, GY - 10, 12, 7, O);
    px(ctx, hx - 6, GY - 13, 3, 3, O);
    px(ctx, hx + 3, GY - 13, 3, 3, O);
    catEyes(ctx, hx, GY - 10, "wide", currentGaze);
    // Rear wiggling before pounce
    const wiggle = Math.round(Math.sin(t * 0.5) * 1);
    px(ctx, cx - 4 + wiggle, GY - 5, 10, 5, O);
    px(ctx, cx - 4 + wiggle, GY - 1, 10, 1, D);
    // Tail low and twitching
    px(ctx, cx - 8 + wiggle, GY - 3, 4, 2, O);
    px(ctx, cx - 10 + wiggle, GY - 4, 2, 2, D);
    return GY - 13;
  }

  function miniKitten(ctx, kx, ky, t, offset) {
    // Tiny kitten drawn beside the main cat for agentCount
    const bounce = Math.abs(Math.sin(t * 0.2 + offset)) > 0.5 ? 1 : 0;
    const y = ky - bounce;
    px(ctx, kx - 2, y, 4, 3, O);
    px(ctx, kx - 2, y - 2, 1, 2, O);
    px(ctx, kx + 1, y - 2, 1, 2, O);
    px(ctx, kx - 1, y + 1, 1, 1, E);
    px(ctx, kx + 1, y + 1, 1, 1, E);
    px(ctx, kx, y - 1, 1, 1, P);
    px(ctx, kx - 2, y + 3, 1, 1, O);
    px(ctx, kx + 1, y + 3, 1, 1, O);
    // Tiny tail
    const tw = Math.sin(t * 0.3 + offset) > 0 ? 1 : 0;
    px(ctx, kx + 2 + tw, y + 1, 2, 1, D);
  }

  let wx = 0, wTarget = 0, wMode = "stand", wUntil = -1;
  let patT = 0;
  let blinkT = 0;
  let currentGaze = null;

  function draw(ctx, canvas, state, warn, bubble, t, extra) {
    const x = extra || {};
    currentGaze = x.gazeX != null && x.gazeY != null ? { x: x.gazeX, y: x.gazeY } : null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    K.ambient(ctx, canvas, t);
    let cx = (K && K.centreCx) ? K.centreCx(canvas) : 25;

    // Idle roaming / state return
    if (state === "idle" && !x.dragging) {
      if (t >= wUntil) {
        const r = Math.random();
        const night = K.isNight();
        if (r < (night ? 0.5 : 0.2)) { wMode = "doze"; wUntil = t + 800 + Math.random() * 900; }
        else if (r < 0.35) { wMode = "walk"; wTarget = Math.round(Math.random() * 20 - 10); wUntil = t + 100000; }
        else if (r < 0.55) { wMode = "lick"; wUntil = t + 200 + Math.random() * 200; }
        else if (r < 0.75) { wMode = "stretch"; wUntil = t + 140; }
        else if (r < 0.9) { wMode = "laser"; wUntil = t + 300 + Math.random() * 200; }
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
        hy = catSit(ctx, cx, { eyes: tired ? "down" : "down", typing: true, tap: Math.floor(t / 5) % 2 === 0, tail: tailFast });
        keyboard(ctx, cx, t);
      } else if (note === "reading") {
        hy = catLie(ctx, cx, { eyes: tired ? "closed" : "down" });
        openBook(ctx, cx, t);
      } else if (note === "coding") {
        hy = catSit(ctx, cx, { eyes: "down", tail: tailFast });
        litterBox(ctx, cx, t);
      } else if (note === "searching") {
        // Body only; head is inside the box
        hy = GY - 12;
        cardboardBox(ctx, cx, t);
      } else if (note === "browsing") {
        hy = catSit(ctx, cx, { eyes: "open", tail: tailSlow });
        fishTank(ctx, cx, t);
      } else if (note === "planning") {
        hy = catSit(ctx, cx, { eyes: "open", tail: tailFast });
        checklist(ctx, cx, t);
      } else if (note === "git") {
        hy = catSit(ctx, cx, { eyes: "wide", tail: tailFast });
        yarnTangle(ctx, cx, t);
      } else if (note === "testing") {
        hy = catSit(ctx, cx, { eyes: "open", tail: tailFast });
        testingShelf(ctx, cx, t);
      } else if (note === "deps") {
        // Cat peeking from a box is drawn inside packageBoxes
        hy = GY - 10;
        packageBoxes(ctx, cx, t);
      } else if (note === "agents") {
        hy = catSit(ctx, cx, { eyes: "open", tail: tailSlow });
        // A few toy mice running around
        for (let i = 0; i < 3; i++) {
          const mx = cx - 12 + ((Math.floor(t * 0.5 + i * 2) % 26));
          const my = GY - 3 + (i % 2 === 0 ? 0 : 1);
          px(ctx, mx, my, 2, 1, "#7a5a3a");
          px(ctx, mx + 2, my, 1, 1, "#9b7fd4");
        }
      } else {
        // Generic tool or unknown MCP: confused cat with a mysterious object
        hy = catSit(ctx, cx, { eyes: tired ? "down" : "open", tail: tailFast });
        // Mysterious glowing cube
        const glow = Math.floor(t / 10) % 2 === 0;
        px(ctx, cx + 11, GY - 10, 5, 5, glow ? "#7fb4d9" : "#5a8fd4");
        px(ctx, cx + 12, GY - 11, 3, 1, "#a8d4f0");
      }
      if (!bubble) {
        const label = note || "thinking";
        K.statusTag(ctx, canvas, cx, hy, label, t);
      }
      if (K.isNight()) px(ctx, cx - 3, hy - 1, 6, 1, "#f0d468");
      if (tired) px(ctx, cx + 9, hy + 2 + (Math.floor(t / 30) % 3), 1, 2, "#7fb4d9");
    } else if (state === "attention") {
      const waited = x.attnSecs || 0;
      if (waited >= 300) {
        // Ignoring the cat too long: curled up with back to you
        hy = catCurl(ctx, cx, t);
        catEyes(ctx, cx + 4, GY - 12, "open");
      } else if (waited >= 120) {
        // Getting anxious: scratches the glass + hops
        const hop = t % 50 < 8 ? 2 : 0;
        hy = catSit(ctx, cx, { eyes: "wide", bounce: hop, tail: tailFast, raisedPaw: 1 });
        // Sound waves
        if (Math.floor(t / 10) % 2 === 0) {
          px(ctx, cx + 13, hy + 2, 1, 1, AMBER);
          px(ctx, cx + 15, hy, 1, 1, AMBER);
          px(ctx, cx + 15, hy + 4, 1, 1, AMBER);
        }
      } else {
        // Polite wave + occasional hop
        const hopPh = t % 90;
        const hop = hopPh < 10 ? (hopPh < 5 ? 2 : 1) : 0;
        hy = catSit(ctx, cx, {
          eyes: blinkT > 0 ? "closed" : "open",
          wave: true,
          waveUp: Math.floor(t / 12) % 2 === 0,
          bounce: hop,
          tail: tailFast,
        });
        if (Math.random() < 0.012) blinkT = 8;
        if (blinkT > 0) blinkT--;
      }
    } else if (state === "done") {
      const level = x.celebrate || 0;
      const b = Math.abs(Math.sin(t * 0.13)) * (level >= 2 ? 3 : 2);
      hy = catLie(ctx, cx, { eyes: "happy", belly: true, bounce: b });
      K.heart(ctx, cx + (Math.floor(t / 18) % 2 ? 14 : -16), hy - 4, 0.9);
      if (level >= 2) K.heart(ctx, cx + (Math.floor(t / 18) % 2 ? -19 : 17), hy - 2, 0.7);
      if (level >= 1) K.confetti(ctx, canvas, cx, level, t);
    } else {
      // idle
      if (x.tickle) {
        // Tickled: squirm and giggle
        const wob = (Math.floor(t / 3) % 2 ? 1 : -1) * 2;
        hy = catSit(ctx, cx + wob, { eyes: "happy", tail: tailFast });
        if (Math.floor(t / 6) % 2 === 0) {
          ctx.font = "bold 10px Consolas, monospace";
          ctx.fillStyle = "#e0a63b";
          ctx.fillText("~", (cx + 13) * S, (hy + 1) * S);
        }
        K.heart(ctx, cx - 17, hy - 4, 0.7);
      } else if (x.pat) {
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
      } else if (wMode === "lick") {
        hy = lickPaw(ctx, cx, t);
      } else if (wMode === "stretch") {
        hy = stretchCat(ctx, cx, t);
      } else if (wMode === "laser") {
        hy = laserChase(ctx, cx, t);
      } else if (wMode === "walk") {
        hy = catSit(ctx, cx, { eyes: "open", tail: tailSlow });
      } else {
        // stand, maybe with a butterfly
        const blink = Math.floor(t / 90) % 7 === 0;
        hy = catSit(ctx, cx, { eyes: blink ? "closed" : "open", tail: tailSlow });
      }
      if (!x.pat) patT = 0;
    }

    // Tool error: annoyed red X
    if (x.oops && !x.dragging) {
      px(ctx, cx - 17, hy - 4, 1, 4, R);
      px(ctx, cx - 15, hy - 4, 1, 4, R);
      px(ctx, cx - 18, hy - 3, 4, 1, R);
      px(ctx, cx - 18, hy - 1, 4, 1, R);
    }

    // Usage warning
    if (warn && state !== "limit" && Math.floor(t / 30) % 2 === 0) {
      px(ctx, cx - 1, hy - 8, 2, 4, "#e0a63b");
      px(ctx, cx - 1, hy - 3, 2, 2, "#e0a63b");
    }

    // Multi-session badge
    if ((x.sessions || 0) > 1 && !x.dragging) {
      ctx.font = "bold 11px Consolas, monospace";
      ctx.fillStyle = "#e0a63b";
      ctx.fillText("×" + x.sessions, (cx + 14) * S, (hy - 2) * S);
    }

    // Subagent mini-kittens
    const agents = x.agentCount || 0;
    if (agents > 0 && !x.dragging) {
      for (let i = 0; i < agents; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const dist = 18 + Math.floor(i / 2) * 10;
        miniKitten(ctx, cx + side * dist, GY - 4, t, i);
      }
    }

    if (bubble) K.bubbleBox(ctx, canvas, bubble, cx, hy * S);
  }

  window.PetRenderer = { draw };
})();
