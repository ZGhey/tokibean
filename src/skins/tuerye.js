// Skin: Tu'er Ye — 兔爷 (the Beijing Rabbit God) riding his tiger
// @skin-name-zh 兔爷·骑虎
// @skin-name-en Tu'er Ye
// Overrides window.PetRenderer, reusing window.PetKit.
//
// Design rule: this is a two-character act. A dignified little general (a
// helmeted, opera-faced rabbit holding a medicine pestle) rides a prone tiger
// whose round head faces the viewer at the left. The rabbit stays composed; the
// TIGER gets a life of its own — it blinks, flicks its tail, gallops, purrs and
// startles on its own cycles, and its pupils (never the rabbit's) follow the
// cursor. The sprite geometry is fixed; states animate it, they never redesign it.
//
// Tool-note keys (cmd/reading/coding/searching/browsing/agents/planning/git/
// testing/deps) are a closed set surfaced verbatim through K.statusTag — never
// invented or localized here.

(function () {
  const K = window.PetKit;
  const { S, GY, px } = K;

  // Palette — preserved exactly from the approved sprite.
  const TU = {
    white: "#faf6ee", shade: "#e2d8c4", ink: "#26221d", red: "#c23a2b",
    darkRed: "#96281c", gold: "#d4a13a", goldShade: "#b3862c", pink: "#f0b0a8",
    innerEar: "#eaa0a8", flag: "#d4553e",
  };
  const TIG = "#e8973c";   // tiger fur
  const TIGD = "#26221d";  // tiger ink (stripes / eyes)
  const TIGW = "#faf6ee";  // tiger cream
  const WOOD = "#8a6a48";  // pestle shaft
  const HL = "#e8b054";    // flag highlight
  const AMBER = "#e0a63b";

  // Prop-theatre palette for the ten working tool-keys (camp / medicine theme).
  const PROP = {
    parch: "#e6d7b0", parchHL: "#f2e8cf",                 // battle-map parchment
    mapLine: "#9a7b52", rod: "#8a6a48",                   // map contours + scroll rods
    stone: "#9a958b", stoneD: "#6f6a60", stoneHL: "#b7b2a7", // mortar bowl
    spark: "#fbe36a", flash: "#fffdf6",                   // strike spark / glint
    puff: "#cfe6bd", puffHL: "#eef6e6",                   // herbal powder puff
    pinRed: TU.red, pinSet: "#5aa46a",                    // map pins (red placing → green set)
    kite: TU.flag, kiteGold: TU.gold, string: "#c9b892",  // browsing kite
    pole: TU.goldShade,                                   // banner / pennant poles
    sniff: "#cdd6dd",                                     // scent dabs on the ground
    crate: WOOD, crateD: "#6b4f35", crateHL: "#a3805a", rope: "#c9b892", // supply crate
    bowl: "#cdd6dd", bowlHL: "#eef2f5", brew: "#7bb36a",  // medicine cup
    good: "#4a9a4a", bad: "#d05045",                      // testing verdicts
  };

  // ---------------------------------------------------------------------------
  //  The mount: a prone tiger, round head facing the viewer at the left.
  //  All offsets are exactly the approved sprite's, relative to (cx, gy).
  //  o: { dy, headDy, shake, tailDx, ears:"up"|"back", gallop, legPhase,
  //       splay, lieFlat, blink, closed, happy, wide, gaze }
  // ---------------------------------------------------------------------------
  function tigerEyes(ctx, cx, gy, hDy, o) {
    const y = hDy || 0;
    const L = cx - 20, R = cx - 14;               // both eyes 2x2 at gy-7
    if (o.closed || o.blink) {
      px(ctx, L, gy - 6 + y, 2, 1, TIGD);          // blink → flat line
      px(ctx, R, gy - 6 + y, 2, 1, TIGD);
    } else if (o.happy) {
      px(ctx, L, gy - 6 + y, 2, 1, TIGD);          // purring squint (upturned)
      px(ctx, R, gy - 6 + y, 2, 1, TIGD);
      px(ctx, L, gy - 7 + y, 1, 1, TIGD);
      px(ctx, R + 1, gy - 7 + y, 1, 1, TIGD);
    } else if (o.wide) {
      px(ctx, L, gy - 8 + y, 2, 3, TIGD);          // startled / alarmed
      px(ctx, R, gy - 8 + y, 2, 3, TIGD);
    } else {
      const g = o.gaze;
      const gx = g ? g.x : 0, gyy = g ? g.y : 0;   // pupils track the cursor
      px(ctx, L + gx, gy - 7 + gyy + y, 2, 2, TIGD);
      px(ctx, R + gx, gy - 7 + gyy + y, 2, 2, TIGD);
    }
  }

  function drawTiger(ctx, cx, gy, o) {
    o = o || {};
    const dy = o.dy || 0;
    const sx = o.shake || 0;
    const hDy = dy + (o.headDy || 0) + (o.lieFlat ? 2 : 0); // head droops when lying flat
    const tailDx = o.tailDx || 0;

    // Prone body + cream belly line + back stripes
    px(ctx, cx - 13 + sx, gy - 6 + dy, 29, 6, TIG);
    px(ctx, cx - 12 + sx, gy - 1 + dy, 27, 1, TIGW);
    for (const bx of [-6, -1, 4, 9]) px(ctx, cx + bx + sx, gy - 6 + dy, 1, 3, TIGD);

    // Tail curling up (flicks via tailDx), striped tip
    px(ctx, cx + 15 + tailDx, gy - 8 + dy, 2, 5, TIG);
    px(ctx, cx + 15 + tailDx, gy - 9 + dy, 2, 1, TIGD);

    // Round front-facing head + cheeks
    px(ctx, cx - 22 + sx, gy - 11 + hDy, 10, 11, TIG);
    px(ctx, cx - 23 + sx, gy - 8 + hDy, 1, 6, TIG);
    px(ctx, cx - 12 + sx, gy - 8 + hDy, 1, 6, TIG);

    // Ears — up by default, flattened/back when startled or squirming
    if (o.ears === "back") {
      px(ctx, cx - 23 + sx, gy - 11 + hDy, 3, 2, TIG);
      px(ctx, cx - 14 + sx, gy - 11 + hDy, 3, 2, TIG);
    } else {
      px(ctx, cx - 22 + sx, gy - 13 + hDy, 3, 2, TIG);
      px(ctx, cx - 15 + sx, gy - 13 + hDy, 3, 2, TIG);
    }

    // 王 forehead mark
    px(ctx, cx - 19 + sx, gy - 11 + hDy, 4, 1, TIGD);
    px(ctx, cx - 18 + sx, gy - 10 + hDy, 2, 1, TIGD);
    px(ctx, cx - 19 + sx, gy - 9 + hDy, 4, 1, TIGD);

    tigerEyes(ctx, cx + sx, gy, hDy, o);

    // White muzzle + nose
    px(ctx, cx - 19 + sx, gy - 4 + hDy, 6, 3, TIGW);
    px(ctx, cx - 17 + sx, gy - 4 + hDy, 2, 1, TIGD);
    // Cheek stripes
    px(ctx, cx - 23 + sx, gy - 6 + hDy, 2, 1, TIGD);
    px(ctx, cx - 11 + sx, gy - 6 + hDy, 2, 1, TIGD);

    // Front paws — one thin row at rest; splayed when picked up; a small alternating
    // shuffle when galloping (it is prone, so the gallop reads as a paw shuffle + body bounce)
    if (o.splay) {
      px(ctx, cx - 24 + sx, gy - 1 + dy, 5, 1, TIG);
      px(ctx, cx - 16 + sx, gy - 1 + dy, 5, 1, TIG);
    } else if (o.gallop) {
      const lift = o.legPhase ? 1 : 0;
      px(ctx, cx - 21 + sx, gy - 1 - lift + dy, 4, 1 + lift, TIG);
      px(ctx, cx - 16 + sx, gy - 1 - (1 - lift) + dy, 3, 1 + (1 - lift), TIG);
    } else {
      px(ctx, cx - 21 + sx, gy - 1 + dy, 8, 1, TIG);
    }
  }

  // ---------------------------------------------------------------------------
  //  背旗 (back flags) rising behind the rabbit's shoulders. `sway` slides the
  //  banners; the two flutter in mirror so it reads like wind.
  // ---------------------------------------------------------------------------
  function drawFlags(ctx, rx, gy, sway) {
    const g = TU.goldShade, f = TU.flag;
    // Left pole + banner
    px(ctx, rx - 10, gy - 24, 2, 7, g);
    px(ctx, rx - 15 + sway, gy - 30, 5, 4, f);
    px(ctx, rx - 14 + sway, gy - 29, 3, 2, HL);
    px(ctx, rx - 12 + sway, gy - 27, 2, 3, g);
    // Right pole + banner (opposite sway)
    px(ctx, rx + 8, gy - 24, 2, 7, g);
    px(ctx, rx + 10 - sway, gy - 30, 5, 4, f);
    px(ctx, rx + 11 - sway, gy - 29, 3, 2, HL);
    px(ctx, rx + 10 - sway, gy - 27, 2, 3, g);
  }

  // ---------------------------------------------------------------------------
  //  The rider: helmeted, opera-faced rabbit in red armor holding a pestle.
  // ---------------------------------------------------------------------------
  function rabbitTorso(ctx, rx, gy, dy) {
    const red = TU.red, g = TU.gold, dr = TU.darkRed;
    const y = dy || 0;
    px(ctx, rx - 7, gy - 17 + y, 15, 10, red);   // armored torso
    px(ctx, rx - 10, gy - 17 + y, 3, 4, red);    // pauldron flares
    px(ctx, rx + 8, gy - 17 + y, 3, 4, red);
    px(ctx, rx - 10, gy - 17 + y, 3, 1, g);      // pauldron trim
    px(ctx, rx + 8, gy - 17 + y, 3, 1, g);
    px(ctx, rx - 7, gy - 17 + y, 15, 1, g);      // collar trim
    px(ctx, rx - 2, gy - 16 + y, 5, 7, g);       // chest panel
    px(ctx, rx - 1, gy - 14 + y, 3, 3, dr);      // panel jewel
    px(ctx, rx - 7, gy - 9 + y, 15, 2, g);       // belt
    px(ctx, rx - 1, gy - 9 + y, 2, 2, dr);       // buckle
  }

  // The right paw + pestle, in one of several poses.
  function rabbitArm(ctx, rx, gy, pose, dy, t, celebrate) {
    const g = TU.gold, r = TU.red, w = TU.white;
    const y = dy || 0;
    if (pose === "raise") {
      // Attention: the pestle lifted high like a summons
      px(ctx, rx + 9, gy - 24 + y, 3, 3, r);
      px(ctx, rx + 11, gy - 33 + y, 4, 3, w);
      px(ctx, rx + 12, gy - 36 + y, 2, 10, WOOD);
      px(ctx, rx + 11, gy - 38 + y, 4, 2, g);
    } else if (pose === "sky") {
      // Done: thrust skyward, a little higher with the celebration level
      const up = (celebrate >= 2 ? 1 : 0) + (Math.abs(Math.sin(t * 0.25)) > 0.5 ? 1 : 0);
      px(ctx, rx + 9, gy - 26 + y, 3, 4, r);
      px(ctx, rx + 11, gy - 35 - up + y, 4, 3, w);
      px(ctx, rx + 12, gy - 38 - up + y, 2, 12, WOOD);
      px(ctx, rx + 11, gy - 40 - up + y, 4, 2, g);
    } else if (pose === "grab") {
      // Oops / dragging: both paws fling out to clutch the flag poles
      px(ctx, rx - 9, gy - 19 + y, 3, 2, r);
      px(ctx, rx - 12, gy - 21 + y, 4, 3, w);
      px(ctx, rx + 8, gy - 19 + y, 3, 2, r);
      px(ctx, rx + 11, gy - 21 + y, 4, 3, w);
    } else if (pose === "slump") {
      // Limit: an arm slung forward over the tiger's neck, pestle across the lap
      px(ctx, rx - 6, gy - 13 + y, 5, 2, r);
      px(ctx, rx - 11, gy - 12 + y, 5, 3, w);
      px(ctx, rx + 6, gy - 11 + y, 8, 2, WOOD);
      px(ctx, rx + 13, gy - 12 + y, 2, 3, g);
    } else {
      // rest / tap: pestle held upright; "tap" bobs it on a beat (thinking)
      const tap = pose === "tap" && Math.floor(t / 10) % 2 === 0 ? 1 : 0;
      px(ctx, rx + 12, gy - 19 + y + tap, 2, 9, WOOD);
      px(ctx, rx + 11, gy - 21 + y + tap, 4, 2, g);
      px(ctx, rx + 8, gy - 15 + y, 4, 2, r);
      px(ctx, rx + 11, gy - 16 + y + tap, 4, 3, w);
    }
  }

  // Head + helmet + tall ears + opera face. hx = rx + lean so the head can tilt
  // forward without dragging the torso with it.
  function rabbitHead(ctx, hx, gy, headDy, eyes, smile) {
    const w = TU.white, g = TU.gold, gs = TU.goldShade, dr = TU.darkRed,
      f = TU.flag, ink = TU.ink, red = TU.red, pink = TU.pink, ie = TU.innerEar;
    const y = headDy || 0;

    // Tall ears with pink inners
    px(ctx, hx - 6, gy - 41 + y, 3, 12, w);
    px(ctx, hx - 5, gy - 39 + y, 1, 9, ie);
    px(ctx, hx + 3, gy - 41 + y, 3, 12, w);
    px(ctx, hx + 4, gy - 39 + y, 1, 9, ie);

    // Head
    px(ctx, hx - 7, gy - 27 + y, 15, 10, w);
    px(ctx, hx - 8, gy - 25 + y, 1, 6, w);
    px(ctx, hx + 8, gy - 25 + y, 1, 6, w);

    // Gold helmet: band + red jewel + slim red tassels
    px(ctx, hx - 7, gy - 29 + y, 15, 3, g);
    px(ctx, hx - 1, gy - 29 + y, 3, 2, dr);
    px(ctx, hx - 7, gy - 26 + y, 15, 1, gs);
    px(ctx, hx - 9, gy - 28 + y, 1, 3, f);
    px(ctx, hx + 8, gy - 28 + y, 1, 3, f);

    // Opera face paint
    if (eyes === "closed") {
      // Serene / asleep: eyes drop to level lines
      px(ctx, hx - 5, gy - 23 + y, 3, 1, ink);
      px(ctx, hx + 2, gy - 23 + y, 3, 1, ink);
    } else if (eyes === "happy") {
      // Allowed a smile: eyes arch upward
      px(ctx, hx - 5, gy - 23 + y, 1, 1, ink);
      px(ctx, hx - 4, gy - 24 + y, 1, 1, ink);
      px(ctx, hx - 3, gy - 23 + y, 1, 1, ink);
      px(ctx, hx + 2, gy - 23 + y, 1, 1, ink);
      px(ctx, hx + 3, gy - 24 + y, 1, 1, ink);
      px(ctx, hx + 4, gy - 23 + y, 1, 1, ink);
    } else {
      // Thin arched brows + phoenix eyes with upturned outer tips
      px(ctx, hx - 5, gy - 24 + y, 3, 1, ink);
      px(ctx, hx + 2, gy - 24 + y, 3, 1, ink);
      px(ctx, hx - 5, gy - 22 + y, 3, 1, ink);
      px(ctx, hx - 6, gy - 23 + y, 1, 1, ink);
      px(ctx, hx + 2, gy - 22 + y, 3, 1, ink);
      px(ctx, hx + 5, gy - 23 + y, 1, 1, ink);
    }

    // Pink cheek circles
    px(ctx, hx - 6, gy - 21 + y, 2, 2, pink);
    px(ctx, hx + 5, gy - 21 + y, 2, 2, pink);

    // Three-petal rabbit lip (curls up at the corners when smiling)
    px(ctx, hx - 1, gy - 20 + y, 3, 1, red);
    px(ctx, hx, gy - 19 + y, 1, 1, red);
    if (smile) {
      px(ctx, hx - 2, gy - 19 + y, 1, 1, red);
      px(ctx, hx + 2, gy - 19 + y, 1, 1, red);
    }
  }

  function drawRabbit(ctx, rx, gy, o) {
    o = o || {};
    const dy = o.dy || 0;
    const lean = o.lean || 0;
    const headDy = dy + (o.headDy || 0);
    rabbitTorso(ctx, rx, gy, dy);
    rabbitArm(ctx, rx, gy, o.pose || "rest", dy, o.t || 0, o.celebrate || 0);
    rabbitHead(ctx, rx + lean, gy, headDy, o.eyes || "open", o.smile);
  }

  // A tiny tiger cub, drawn beside the mount for agentCount.
  function miniCub(ctx, kx, ky, t, i) {
    const bounce = Math.abs(Math.sin(t * 0.2 + i)) > 0.5 ? 1 : 0;
    const y = ky - bounce;
    px(ctx, kx - 2, y, 4, 3, TIG);
    px(ctx, kx - 2, y - 2, 1, 2, TIG);   // ears
    px(ctx, kx + 1, y - 2, 1, 2, TIG);
    px(ctx, kx - 1, y + 1, 1, 1, TIGD);  // eyes
    px(ctx, kx + 1, y + 1, 1, 1, TIGD);
    px(ctx, kx - 2, y + 3, 1, 1, TIG);   // paws
    px(ctx, kx + 1, y + 3, 1, 1, TIG);
    const tw = Math.sin(t * 0.3 + i) > 0 ? 1 : 0; // flicking tail
    px(ctx, kx + 2 + tw, y + 1, 2, 1, TIGD);
  }

  // ---------------------------------------------------------------------------
  //  Prop theatre for the ten working tool-keys (closed set). Each prop paints
  //  ON TOP of the pair; K.statusTag still prints its verbatim key below unless a
  //  bubble is speaking. Themed to the camp: banners, pestle & mortar, and the
  //  tiger doing the legwork. `dy` is the rider's gallop bounce so lap-held props
  //  track it. Everything stays inside the sprite's safe span (cx-24 .. cx+17,
  //  y >= 1) so nothing clips the 288x184 canvas. Unlisted keys draw nothing and
  //  fall through to the plain status tag.
  // ---------------------------------------------------------------------------
  function drawToolProp(ctx, cx, rx, gy, note, t, dy) {
    const P = PROP;
    if (note === "cmd" || note === "coding") {
      // Pestle & mortar beside the rider; the pestle (pose "tap") pounds on the beat.
      const strike = Math.floor(t / 10) % 2 === 0;
      px(ctx, rx + 7, gy - 8 + dy, 8, 2, P.stone);        // mortar rim
      px(ctx, rx + 8, gy - 6 + dy, 6, 2, P.stoneD);       // bowl body
      px(ctx, rx + 7, gy - 8 + dy, 8, 1, P.stoneHL);      // rim highlight
      if (note === "cmd") {
        // Typing away: one spark flies off with each strike.
        if (strike) {
          px(ctx, rx + 11, gy - 9 + dy, 1, 1, P.spark);
          px(ctx, rx + 13, gy - 10 + dy, 1, 1, P.spark);
          px(ctx, rx + 12, gy - 11 + dy, 1, 1, P.flash);
        }
      } else {
        // Pounding medicine (its craft = building): a powder puff per strike, motes rising.
        if (strike) {
          px(ctx, rx + 10, gy - 10 + dy, 2, 1, P.puff);
          px(ctx, rx + 13, gy - 11 + dy, 2, 1, P.puff);
          px(ctx, rx + 12, gy - 12 + dy, 1, 1, P.puffHL);
        }
        for (let i = 0; i < 2; i++) {
          const ph = (t / 9 + i * 2) % 5;
          if (ph < 3) px(ctx, rx + 10 + i * 3, gy - 9 - Math.round(ph) + dy, 1, 1, P.puff);
        }
      }
    } else if (note === "reading") {
      // A battle map unrolls above the mount; markers pop on one by one as it opens.
      const mx0 = cx - 23, top = gy - 16;
      const phase = Math.floor(t / 14) % 6;               // re-studies the map on a loop
      const w = Math.min(2 + phase * 2, 10);              // parchment unrolls to 10 wide
      px(ctx, mx0, top - 1, 1, 6, P.rod);                 // fixed left scroll rod
      px(ctx, mx0 + 1, top, w, 4, P.parch);               // parchment
      px(ctx, mx0 + 1, top, w, 1, P.parchHL);
      px(ctx, mx0 + 1 + w, top - 1, 1, 6, P.rod);         // rolling right rod
      if (w >= 4) px(ctx, mx0 + 2, top + 2, Math.max(w - 3, 1), 1, P.mapLine); // contour line
      const markers = Math.min(phase, 3);                 // markers appear one by one
      for (let i = 0; i < markers; i++) px(ctx, mx0 + 3 + i * 3, top + 1, 1, 1, P.pinRed);
    } else if (note === "searching") {
      // The tiger sniffs the ground ahead; the rabbit shades its eyes and scans the horizon.
      // Dust/scent puffs kicked up at the tiger's nose — grey clusters that read on both the
      // light panel (#f2ede4) and the orange fur, drifting up and resetting t-driven.
      for (let i = 0; i < 3; i++) {
        const sp = Math.round((t / 7 + i * 1.7) % 5);     // rises, then resets
        const dxp = cx - 23 + i * 3;
        px(ctx, dxp, gy - 1 - sp, 2, 2, P.stone);         // puff body
        px(ctx, dxp, gy - 1 - sp, 2, 1, P.stoneHL);       // lit top
        px(ctx, dxp - 1, gy + 1 - sp, 1, 1, P.stoneD);    // scattered speck
      }
      // Brow-shading paw in gold (contrasts the white face); it sweeps ±1px on a slow
      // period so the "scanning the horizon" gesture reads, keeping the vertical bob.
      const scan = (Math.floor(t / 18) % 3) - 1;          // -1 / 0 / +1 sweep
      const bob = Math.floor(t / 12) % 2;
      const bx = rx - 6 + scan, by = gy - 25 - bob + dy;
      px(ctx, bx, by, 5, 2, TU.gold);                     // gold-cuffed paw over the brow
      px(ctx, bx, by + 2, 5, 1, TU.goldShade);            // shaded underside
      px(ctx, bx + 4, by - 1, 1, 1, TU.white);            // fingertip peeking up
    } else if (note === "browsing") {
      // A kite drifts overhead on a string running down to the pestle (Beijing folk).
      const kxc = cx - 14 + Math.round(Math.sin(t * 0.03) * 6);
      const ky = gy - 31 + Math.round(Math.sin(t * 0.05) * 2);
      px(ctx, kxc, ky - 2, 1, 1, P.kite);                 // diamond kite
      px(ctx, kxc - 1, ky - 1, 3, 1, P.kite);
      px(ctx, kxc - 2, ky, 5, 1, P.kite);
      px(ctx, kxc, ky, 1, 1, P.kiteGold);                 // gold centre
      px(ctx, kxc - 1, ky + 1, 3, 1, P.kite);
      px(ctx, kxc, ky + 2, 1, 1, P.kite);
      px(ctx, kxc, ky + 3, 1, 1, P.kiteGold);             // tail
      px(ctx, kxc - 1, ky + 4, 1, 1, P.kiteGold);
      for (let i = 1; i <= 3; i++) {                      // string down to the pestle top
        const sxp = Math.round(kxc + (rx + 12 - kxc) * (i / 4));
        const syp = Math.round((ky + 2) + (gy - 20 - (ky + 2)) * (i / 4));
        px(ctx, sxp, syp, 1, 1, P.string);
      }
    } else if (note === "agents") {
      // Scouts dispatched: mini pennants run out in a line above the mount.
      const outN = 1 + Math.floor(t / 12) % 4;
      for (let i = 0; i < outN; i++) {
        const fxp = cx - 22 + i * 4;
        const b = Math.abs(Math.sin(t * 0.2 + i)) > 0.5 ? 1 : 0;
        px(ctx, fxp, gy - 13 - b, 1, 4, P.pole);          // pole
        px(ctx, fxp + 1, gy - 13 - b, 3, 2, TU.flag);     // pennant
        px(ctx, fxp + 1, gy - 13 - b, 3, 1, HL);
      }
    } else if (note === "planning") {
      // A battle map on the ground; flag pins planted one by one, set = green.
      const mx0 = cx - 23, top = gy - 4;
      px(ctx, mx0, top, 10, 4, P.parch);                  // map spread on the ground
      px(ctx, mx0, top, 10, 1, P.parchHL);
      px(ctx, mx0 + 1, top + 2, 8, 1, P.mapLine);         // contour line
      const pins = Math.floor(t / 16) % 4;
      for (let i = 0; i < pins; i++) {
        const pxp = mx0 + 2 + i * 3;
        const col = i === pins - 1 ? P.pinRed : P.pinSet; // newest still red, the rest set green
        px(ctx, pxp, top - 3, 1, 3, P.pole);              // pin pole
        px(ctx, pxp + 1, top - 3, 2, 2, col);             // pin flag
      }
    } else if (note === "git") {
      // Banner formation chart: a branching pole, pennants as commits, newest pulses.
      const bx0 = cx - 20;
      px(ctx, bx0, gy - 17, 1, 10, P.pole);               // main pole
      for (const cyy of [gy - 16, gy - 12, gy - 9]) {     // commit pennants
        px(ctx, bx0 + 1, cyy, 3, 2, TU.flag);
        px(ctx, bx0 + 1, cyy, 3, 1, HL);
      }
      px(ctx, bx0 + 4, gy - 12, 2, 1, P.pole);            // branch out
      px(ctx, bx0 + 6, gy - 15, 1, 4, P.pole);            // branch pole
      px(ctx, bx0 + 7, gy - 15, 3, 2, TU.gold);           // branch pennant
      px(ctx, bx0 + 7, gy - 15, 3, 1, P.parchHL);
      if (Math.floor(t / 16) % 2 === 0) px(ctx, bx0 + 1, gy - 19, 3, 2, P.spark); // newest pulses in
    } else if (note === "testing") {
      // The rabbit sips the brewed medicine; ✓ a good batch, ✗ an occasional bitter one.
      const cxp = rx - 3, cyp = gy - 18 + dy;
      px(ctx, cxp, cyp, 4, 3, P.bowl);                    // raised cup
      px(ctx, cxp, cyp, 4, 1, P.bowlHL);
      px(ctx, cxp + 1, cyp + 1, 2, 1, P.brew);            // brew
      if (Math.floor(t / 7) % 3 === 0) px(ctx, cxp + 1, cyp - 1, 1, 1, P.bowlHL); // steam wisp
      const vx = cx - 11, vy = gy - 15;
      if (Math.floor(t / 40) % 5 !== 4) {                 // green check
        px(ctx, vx, vy + 1, 1, 1, P.good);
        px(ctx, vx + 1, vy + 2, 1, 1, P.good);
        px(ctx, vx + 2, vy, 1, 1, P.good);
        px(ctx, vx + 3, vy - 1, 1, 1, P.good);
      } else {                                            // red cross (bitter batch)
        px(ctx, vx, vy, 1, 1, P.bad);
        px(ctx, vx + 2, vy, 1, 1, P.bad);
        px(ctx, vx + 1, vy + 1, 1, 1, P.bad);
        px(ctx, vx, vy + 2, 1, 1, P.bad);
        px(ctx, vx + 2, vy + 2, 1, 1, P.bad);
      }
    } else if (note === "deps") {
      // Army logistics: the tiger drags in a supply crate by a rope.
      const slide = Math.floor(t / 10) % 4;
      const kx = cx - 24 + slide;                         // crate inches toward the tiger
      px(ctx, kx, gy - 3, 3, 3, P.crate);                 // crate
      px(ctx, kx, gy - 3, 3, 1, P.crateHL);
      px(ctx, kx + 1, gy - 3, 1, 3, P.crateD);            // slat
      for (let i = 0; i < 3; i++) px(ctx, kx + 3 + i * 2, gy - 2, 1, 1, P.rope); // rope to the muzzle
    }
  }

  let patT = 0;

  function draw(ctx, canvas, state, warn, bubble, t, extra) {
    const x = extra || {};
    if (K.setTextScale && x.textScale) K.setTextScale(x.textScale);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    K.ambient(ctx, canvas, t);

    const gy = GY;
    const gridW = Math.floor((canvas.clientWidth || canvas.width) / S);

    // Anchor the COMPOSITE, not just cx. The sprite runs from the tiger's cheek at
    // cx-23 to the tail/flag at cx+17 — its horizontal midpoint is cx-3, so nudge
    // the centre right to sit the whole pair in the middle, then clamp both edges.
    let cx = K.centreCx(canvas) + 3;
    if (cx - 24 < 0) cx = 24;                 // keep the tiger cheek on-canvas
    if (cx + 18 > gridW) cx = gridW - 18;      // keep the tail/flag on-canvas

    // Tool error: the whole pair shudders a little.
    if (x.oops && !x.dragging && state !== "limit") cx += t % 6 < 3 ? 1 : -1;
    const rx = cx + 2;

    // The TIGER's pupils follow the cursor (the rabbit stays composed).
    let gaze = null;
    if (x.gazeX != null && x.gazeY != null && !x.dragging && !x.tickle) {
      const tigerCx = cx - 17, tigerEyeY = gy - 7;
      const dxg = x.gazeX / S - tigerCx, dyg = x.gazeY / S - tigerEyeY;
      gaze = { x: dxg > 2 ? 1 : dxg < -2 ? -1 : 0, y: dyg > 2 ? 1 : dyg < -2 ? -1 : 0 };
    }

    // Ground shadow, centred under the tiger's mass (shrinks when picked up).
    ctx.fillStyle = x.dragging ? "rgba(0,0,0,0.10)" : "rgba(0,0,0,0.18)";
    ctx.beginPath();
    ctx.ellipse((cx - 3) * S, gy * S + 4, (x.dragging ? 12 : 18) * S, 2.6 * S, 0, 0, Math.PI * 2);
    ctx.fill();

    // Independent tiger cycles (idle defaults; states override).
    const tigerBlink = t % 210 < 7;
    const tailFlick = Math.round(Math.sin(t * 0.06));
    const flagSlow = Math.round(Math.sin(t * 0.05));

    const night = K.isNight();
    const nightSleep = state === "idle" && night && !x.dragging && !x.pat && !x.tickle;

    // Per-frame pose plans.
    let tOpt = { blink: tigerBlink, tailDx: tailFlick, gaze };
    let rOpt = { eyes: "open", pose: "rest", t };
    let sway = flagSlow;
    let showStatus = null;   // tool key for K.statusTag while working
    let toolDy = 0;          // rider bounce offset handed to the working prop
    let showConfetti = 0;    // celebrate level while done
    let showZzz = 0;         // number of z's to float over the tiger
    let patHeart = false;
    let tickleGiggle = false;

    if (x.dragging) {
      // Picked up: the tiger's paws splay, both alarmed.
      const bob = Math.round(Math.sin(t * 0.25));
      tOpt = { wide: true, splay: true, ears: "back", tailDx: 0, dy: bob };
      rOpt = { eyes: "open", pose: "grab", dy: bob, t };
    } else if (state === "limit") {
      // Quota exhausted: the tiger lies flat, head down; the rabbit slumps forward.
      const breath = Math.sin(t * 0.05) > 0 ? 1 : 0;
      tOpt = { closed: true, lieFlat: true, tailDx: 0 };
      rOpt = { eyes: "closed", pose: "slump", headDy: 3, lean: -3, dy: 2 + breath, t };
      showZzz = 3;
    } else if (state === "working") {
      // The tiger gallops in place; flags stream harder; the rabbit charges forward.
      const legPhase = Math.floor(t / 6) % 2 === 0;
      const bounce = legPhase ? 1 : 0;
      tOpt = {
        blink: tigerBlink, gallop: true, legPhase, dy: -bounce,
        tailDx: Math.round(Math.sin(t * 0.25)), gaze,
      };
      sway = Math.round(Math.sin(t * 0.16) * 2);   // ±2, fast
      const note = x.toolNote || "";
      if (note) {
        // cmd/coding pound the pestle into the mortar; the rest hold it at the ready.
        const pounding = note === "cmd" || note === "coding";
        rOpt = { eyes: "open", pose: pounding ? "tap" : "rest", lean: -2, dy: -bounce, t };
        showStatus = note;
        toolDy = -bounce;
      } else {
        // Thinking (no tool): the rabbit taps the pestle rhythmically.
        rOpt = { eyes: "open", pose: "tap", lean: -1, dy: -bounce, t };
        showStatus = "thinking";
      }
    } else if (state === "attention") {
      // The tiger halts, ears up; the rabbit raises the pestle high. Both stare out.
      tOpt = { blink: tigerBlink, tailDx: 0, gaze: null };
      sway = flagSlow;
      rOpt = { eyes: "open", pose: "raise", t };
    } else if (state === "done") {
      // Celebration: pestle to the sky, the tiger rears its head up 1-2px.
      const level = x.celebrate || 0;
      const headUp = 1 + (Math.abs(Math.sin(t * 0.2)) > 0.5 ? 1 : 0);
      tOpt = { blink: tigerBlink, headDy: -headUp, tailDx: Math.round(Math.sin(t * 0.2)), gaze: null };
      rOpt = { eyes: "happy", pose: "sky", celebrate: level, t };
      showConfetti = level;
    } else {
      // idle: tickle > head-pat > night sleep > serene
      if (x.tickle) {
        // The tiger's ears flatten and it squirms.
        const wob = (Math.floor(t / 3) % 2 ? 1 : -1);
        tOpt = { ears: "back", blink: t % 20 < 6, tailDx: Math.round(Math.sin(t * 0.4) * 2), shake: wob };
        rOpt = { eyes: "open", pose: "rest", lean: wob, t };
        tickleGiggle = true;
      } else if (x.pat) {
        // The tiger purrs (tiny body shake) + a heart; the rabbit allows a small smile.
        patT++;
        const shk = Math.floor(t / 4) % 2 ? 1 : -1;
        tOpt = { happy: true, tailDx: tailFlick, shake: shk };
        rOpt = { eyes: "happy", pose: "rest", smile: true, t };
        patHeart = true;
      } else if (nightSleep) {
        // Night: both asleep, z's over the tiger.
        const breath = Math.sin(t * 0.05) > 0 ? 1 : 0;
        tOpt = { closed: true, tailDx: 0, dy: breath ? 0 : 0 };
        rOpt = { eyes: "closed", pose: "rest", headDy: 1, t };
        showZzz = 1;
      } else {
        // Serene: the tiger blinks and flicks its tail; the rabbit blinks slowly now and then.
        const slowBlink = t % 260 < 10;
        tOpt = { blink: tigerBlink, tailDx: tailFlick, gaze };
        rOpt = { eyes: slowBlink ? "closed" : "open", pose: "rest", t };
      }
      if (!x.pat) patT = 0;
    }

    // Oops override (may fire during any live state): the tiger startles, the rabbit grabs the flags.
    if (x.oops && !x.dragging && state !== "limit") {
      tOpt.wide = true;
      tOpt.ears = "back";
      tOpt.gallop = false;
      tOpt.gaze = null;
      rOpt = { eyes: "open", pose: "grab", dy: rOpt.dy || 0, t };
    }

    // --- Paint the pair back-to-front: mount, then flags, then rider. ---
    drawTiger(ctx, cx, gy, tOpt);
    drawFlags(ctx, rx, gy, sway);
    drawRabbit(ctx, rx, gy, rOpt);

    // Themed prop-theatre for the ten working tool-keys — paints atop the pair;
    // the verbatim status tag still prints below (unless a bubble is speaking).
    if (state === "working" && showStatus && showStatus !== "thinking") {
      drawToolProp(ctx, cx, rx, gy, showStatus, t, toolDy);
    }

    // --- Overlays ---
    if (showConfetti >= 1) K.confetti(ctx, canvas, cx - 3, showConfetti, t);
    if (showZzz > 0) K.zzz(ctx, cx - 17, gy - 14, t, showZzz);

    if (patHeart) {
      if (patT > 120) {
        // Nuzzled a while: hearts circle the rabbit.
        for (let i = 0; i < 3; i++) {
          const a = t * 0.08 + i * 2.1;
          K.heart(ctx, rx + Math.round(Math.cos(a) * 12), gy - 26 + Math.round(Math.sin(a) * 6), 0.85);
        }
      } else {
        K.heart(ctx, rx + 9, gy - 33 - ((t % 50) / 12), 0.85);
      }
    }

    if (tickleGiggle && Math.floor(t / 6) % 2 === 0) {
      ctx.font = "bold 10px Consolas, monospace";
      ctx.fillStyle = AMBER;
      ctx.fillText("~", (cx - 26) * S, (gy - 8) * S);   // laughter, off the tiger's head
    }

    // Tool status box while working (unless a bubble is already speaking).
    if (showStatus && !bubble) K.statusTag(ctx, canvas, rx, gy - 27, showStatus, t);

    // Tool error: a red cross-hatch above the tiger's head.
    if (x.oops && !x.dragging) {
      const R = "#d05045";
      const axp = cx - 26, ayp = gy - 20;
      px(ctx, axp + 1, ayp, 1, 4, R);
      px(ctx, axp + 3, ayp, 1, 4, R);
      px(ctx, axp, ayp + 1, 4, 1, R);
      px(ctx, axp, ayp + 3, 4, 1, R);
    }

    // Usage warning: a slow-blinking amber exclamation, kept clear of the pestle column.
    if (warn && state !== "limit" && !x.dragging && Math.floor(t / 30) % 2 === 0) {
      px(ctx, cx - 18, gy - 20, 2, 4, AMBER);
      px(ctx, cx - 18, gy - 15, 2, 2, AMBER);
    }

    // Multi-session badge.
    if ((x.sessions || 0) > 1 && !x.dragging) {
      ctx.font = "bold 11px Consolas, monospace";
      ctx.fillStyle = AMBER;
      ctx.fillText("×" + x.sessions, (rx + 9) * S, (gy - 30) * S);
    }

    // Subagent cubs padding along beside the mount (two shown, ×N reports the rest).
    const agents = x.agentCount || 0;
    if (agents > 0 && !x.dragging && state !== "limit") {
      const slots = [[cx - 27, gy - 3], [cx + 20, gy - 3]];
      const shown = Math.min(agents, slots.length);
      for (let i = 0; i < shown; i++) miniCub(ctx, slots[i][0], slots[i][1], t, i);
      if (agents > slots.length) {
        ctx.font = "bold 9px Consolas, monospace";
        ctx.fillStyle = TIG;
        ctx.fillText("×" + agents, (cx + 24) * S, (gy - 5) * S);
      }
    }

    // Speech bubble, floated above the tall ears/pestle, centred on the composite.
    if (bubble) K.bubbleBox(ctx, canvas, bubble, cx - 3, (gy - 41) * S);
  }

  window.PetRenderer = { draw };
})();
