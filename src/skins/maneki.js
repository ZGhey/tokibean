// Skin: Maneki the Fortune Cat — a calico maneki-neko (beckoning cat) in pixel art
// @skin-name-zh 招财猫·墩墩
// @skin-name-en Maneki
// Overrides window.PetRenderer, reusing window.PetKit.
//
// Design rule: this cat's whole language is the BECKONING PAW. Beckon speed is its
// mood — a slow bob at rest, doubling when it works ("summoning fortune"), tripling
// in celebration. It sits on a red zabuton cushion that is part of the character and
// stays in every state. The approved sprite geometry is preserved exactly; only the
// paw bob, the eyes, the bell, the ears and a few fur wiggles are animated.
//
// The sprite is anchored so the cushion's bottom rests on the ground row (GY). All
// offsets below are lifted verbatim from the 7-round-approved prototype
// (prototype space cx=23, gy=38); here cx = canvas centre and gy = GY - 2.

(function () {
  const K = window.PetKit;
  const { S, GY, px } = K;

  // Approved palette
  const MK = {
    white: "#faf6ee", shade: "#e2d8c4", ink: "#26221d", black: "#2e2a26", brown: "#6e4a34",
    red: "#c23a2b", gold: "#d4a13a", goldShade: "#b3862c",
    pink: "#f0b0a8", plum: "#e08898", cushion: "#c0271b",
  };
  const TOE = "#e07038";     // orange toe dashes on the raised paw
  const INNER = "#d84838";   // bright red ear inners
  const SEAL = "#c86868";    // belly plum-blossom centre
  const TIE = "#7a9a4a";     // green cushion corner ties
  const AMBER = "#e0a63b";
  const FAIL = "#d05045";

  // ---------- Face ----------
  // The resting face is a pair of closed happy arcs (∩ ∩). The ONLY state that opens
  // the eyes into round ink dots is attention (and the startled/dragged variants) —
  // "you're needed" is the cat actually looking at you.
  function eyes(ctx, cx, gy, mode) {
    const ink = MK.ink;
    if (mode === "open") {
      // round 2x2 ink dots — the cat opens its eyes
      px(ctx, cx - 6, gy - 21, 2, 2, ink);
      px(ctx, cx + 5, gy - 21, 2, 2, ink);
    } else if (mode === "wide") {
      // startled / dangling: taller round eyes
      px(ctx, cx - 6, gy - 22, 2, 3, ink);
      px(ctx, cx + 5, gy - 22, 2, 3, ink);
    } else if (mode === "blink") {
      // brief squeeze: the arcs flatten to a line 1px lower
      px(ctx, cx - 7, gy - 20, 4, 1, ink);
      px(ctx, cx + 4, gy - 20, 4, 1, ink);
    } else if (mode === "pleased") {
      // a deeper, more curved happy arc (pat / celebrate)
      px(ctx, cx - 6, gy - 21, 3, 1, ink);
      px(ctx, cx - 7, gy - 20, 1, 1, ink);
      px(ctx, cx - 3, gy - 20, 1, 1, ink);
      px(ctx, cx - 6, gy - 19, 3, 1, ink);
      px(ctx, cx + 4, gy - 21, 3, 1, ink);
      px(ctx, cx + 3, gy - 20, 1, 1, ink);
      px(ctx, cx + 7, gy - 20, 1, 1, ink);
      px(ctx, cx + 4, gy - 19, 3, 1, ink);
    } else {
      // default closed happy arcs (∩ ∩)
      px(ctx, cx - 6, gy - 21, 3, 1, ink);
      px(ctx, cx - 7, gy - 20, 1, 1, ink);
      px(ctx, cx - 3, gy - 20, 1, 1, ink);
      px(ctx, cx + 4, gy - 21, 3, 1, ink);
      px(ctx, cx + 3, gy - 20, 1, 1, ink);
      px(ctx, cx + 7, gy - 20, 1, 1, ink);
    }
  }

  // ---------- The red zabuton cushion (constant in every state) ----------
  function cushion(ctx, cx, gy) {
    px(ctx, cx - 14, gy, 30, 3, MK.cushion);
    px(ctx, cx - 15, gy + 1, 32, 2, MK.cushion);
    // corner tassels / ties
    px(ctx, cx - 15, gy, 1, 1, TIE);
    px(ctx, cx + 16, gy, 1, 1, TIE);
    px(ctx, cx - 16, gy + 2, 1, 1, TIE);
    px(ctx, cx + 17, gy + 2, 1, 1, TIE);
  }

  // Fur standing on end — 1px jags poking out of the silhouette (oops / tickle)
  function bristle(ctx, cx, gy, jag) {
    const c = MK.white;
    px(ctx, cx - 11, gy - 25 - jag, 1, 1, c);
    px(ctx, cx - 12, gy - 21, 1, 1, c);
    px(ctx, cx - 11, gy - 10, 1, 1, c);
    px(ctx, cx - 10, gy - 6 + jag, 1, 1, c);
    px(ctx, cx + 11, gy - 25 - jag, 1, 1, c);
    px(ctx, cx + 16, gy - 20, 1, 1, c);
    px(ctx, cx + 10, gy - 4 + jag, 1, 1, c);
  }

  // ---------- The cat ----------
  // Options: beckon (0/1 paw bob), eyes (mode), bellDx, headDx (gaze), earTwitch,
  // whiskerDx, pawDown (asleep resting paw), bristleJag.
  function cat(ctx, cx, gy, o) {
    o = o || {};
    const beckon = o.beckon || 0;
    const bellDx = o.bellDx || 0;
    const hdx = o.headDx || 0;
    const et = o.earTwitch || 0;
    const wdx = o.whiskerDx || 0;
    const hcx = cx + hdx;           // head/face shift toward the cursor

    // Body: symmetric; black calico patch on the LEFT flank
    px(ctx, cx - 8, gy - 13, 17, 13, MK.white);
    px(ctx, cx - 9, gy - 8, 1, 8, MK.white);
    px(ctx, cx + 9, gy - 8, 1, 8, MK.white);
    px(ctx, cx - 5, gy - 2, 4, 2, MK.white);
    px(ctx, cx + 1, gy - 2, 4, 2, MK.white);
    px(ctx, cx - 8, gy - 7, 3, 4, MK.black);

    // Right paw
    if (o.pawDown) {
      // Asleep: the paw drops fully and rests folded against the body
      px(ctx, cx + 9, gy - 13, 4, 2, MK.white);
      px(ctx, cx + 10, gy - 12, 4, 5, MK.white);
      px(ctx, cx + 11, gy - 8, 3, 2, MK.white);
      px(ctx, cx + 12, gy - 7, 1, 1, TOE);
    } else {
      // Raised, beckoning: short & chubby, pressed against the body; a fur-crease
      // (shade) separates it from the cheek so the right silhouette stays full.
      px(ctx, cx + 9, gy - 13, 4, 2, MK.white);            // shoulder
      px(ctx, cx + 11, gy - 23, 1, 9, MK.shade);           // crease
      px(ctx, cx + 12, gy - 24, 3, 11, MK.white);          // arm
      px(ctx, cx + 11, gy - 28 + beckon, 5, 4, MK.white);  // paw
      px(ctx, cx + 12, gy - 27 + beckon, 1, 1, TOE);       // orange toe dashes
      px(ctx, cx + 14, gy - 27 + beckon, 1, 1, TOE);
      px(ctx, cx + 13, gy - 26 + beckon, 1, 1, TOE);
    }

    // Belly: one plum blossom (5-dot cluster) + a red seal dot
    px(ctx, cx - 3, gy - 9, 1, 1, MK.plum);
    px(ctx, cx - 1, gy - 9, 1, 1, MK.plum);
    px(ctx, cx - 2, gy - 10, 1, 1, MK.plum);
    px(ctx, cx - 2, gy - 8, 1, 1, MK.plum);
    px(ctx, cx - 2, gy - 9, 1, 1, SEAL);
    px(ctx, cx + 2, gy - 5, 1, 1, MK.red);

    // Red floral collar + gold bell (bell shifts with bellDx when it swings)
    px(ctx, cx - 7, gy - 15, 15, 2, MK.red);
    px(ctx, cx - 4, gy - 15, 2, 1, MK.plum);
    px(ctx, cx + 2, gy - 14, 2, 1, MK.plum);
    px(ctx, cx - 1 + bellDx, gy - 13, 3, 3, MK.gold);
    px(ctx, cx + bellDx, gy - 11, 1, 1, MK.goldShade);

    // Head: symmetric cheek bulges
    px(ctx, hcx - 9, gy - 26, 19, 11, MK.white);
    px(ctx, hcx - 10, gy - 24, 1, 7, MK.white);
    px(ctx, hcx + 10, gy - 24, 1, 7, MK.white);

    // Calico ears: LEFT BLACK, RIGHT BROWN, bright red inners. earTwitch flicks the tips.
    px(ctx, hcx - 9, gy - 28, 5, 2, MK.black);
    px(ctx, hcx - 8 - et, gy - 30, 3, 2, MK.black);
    px(ctx, hcx - 7 - et, gy - 31, 1, 1, MK.black);
    px(ctx, hcx - 7, gy - 28, 2, 2, INNER);
    px(ctx, hcx + 5, gy - 28, 5, 2, MK.brown);
    px(ctx, hcx + 6 + et, gy - 30, 3, 2, MK.brown);
    px(ctx, hcx + 7 + et, gy - 31, 1, 1, MK.brown);
    px(ctx, hcx + 6, gy - 28, 2, 2, INNER);

    // Face: eyes (per state), pink nose, red smile, soft whiskers
    eyes(ctx, hcx, gy, o.eyes || "closed");
    px(ctx, hcx - 1, gy - 19, 2, 1, MK.pink);
    px(ctx, hcx - 2, gy - 17, 1, 1, MK.red);
    px(ctx, hcx + 1, gy - 17, 1, 1, MK.red);
    px(ctx, hcx - 1, gy - 16, 2, 1, MK.red);
    px(ctx, hcx - 10 + wdx, gy - 19, 2, 1, MK.shade);
    px(ctx, hcx - 10 + wdx, gy - 17, 2, 1, MK.shade);
    px(ctx, hcx + 8 - wdx, gy - 19, 2, 1, MK.shade);
    px(ctx, hcx + 8 - wdx, gy - 17, 2, 1, MK.shade);

    if (o.bristleJag != null) bristle(ctx, cx, gy, o.bristleJag);
  }

  // A tiny beckoning kitten drawn beside the main cat for agentCount
  function miniNeko(ctx, kx, ky, t, offset) {
    const bob = Math.floor(t / 12 + offset) % 2;
    px(ctx, kx - 3, ky, 6, 5, MK.white);          // body
    px(ctx, kx - 3, ky - 2, 2, 2, MK.black);      // left ear
    px(ctx, kx + 1, ky - 2, 2, 2, MK.brown);      // right ear
    px(ctx, kx - 2, ky + 1, 1, 1, MK.ink);        // eyes
    px(ctx, kx + 1, ky + 1, 1, 1, MK.ink);
    px(ctx, kx - 3, ky + 1, 4, 1, MK.red);        // collar
    px(ctx, kx + 3, ky - 2 - bob, 2, 3, MK.white); // raised paw
  }

  // A tiny oval koban coin (fortune currency), used across the working prop theater
  function koban(ctx, kx, ky, bright) {
    px(ctx, kx, ky, 3, 2, bright ? "#fbe36a" : MK.gold);
    px(ctx, kx, ky + 1, 1, 1, MK.goldShade);
    px(ctx, kx + 2, ky, 1, 1, MK.goldShade);
  }

  // ---------- Module state ----------
  let blinkT = 0;
  let patT = 0;

  function draw(ctx, canvas, state, warn, bubble, t, extra) {
    const x = extra || {};
    if (x.textScale && K.setTextScale) K.setTextScale(x.textScale);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    K.ambient(ctx, canvas, t);

    const cx0 = (K && K.centreCx) ? K.centreCx(canvas) : 25;
    const gy = GY - 2;                       // cushion bottom rests on the ground row
    let cx = cx0;
    if (x.oops && !x.dragging) cx += t % 6 < 3 ? 1 : -1;  // annoyed shake (cat only)

    // Gaze: a subtle 1px head shift toward the cursor (eyes stay closed — it senses)
    let hdx = 0;
    if (x.gazeX != null && !x.dragging && !x.tickle) {
      const d = x.gazeX / S - cx0;
      hdx = d > 4 ? 1 : d < -4 ? -1 : 0;
    }

    // When dragged, the cat and its cushion travel together as one unit: the whole
    // thing lifts only 2-3 cells and sways, with the cushion lagging 2 cells below the
    // body as if held up by the scruff. The character never comes apart and the ear
    // tips (catGy - 31) stay well clear of the canvas top.
    const sway = x.dragging ? Math.round(Math.sin(t * 0.2)) : 0;
    const dragLift = x.dragging ? 2 + (Math.sin(t * 0.2) > 0 ? 1 : 0) : 0;

    // Ground shadow, then the cushion. The shadow shrinks and fades while airborne.
    ctx.fillStyle = x.dragging ? "rgba(0,0,0,0.10)" : "rgba(0,0,0,0.16)";
    ctx.beginPath();
    ctx.ellipse(cx0 * S, (gy + 3) * S, (x.dragging ? 11 : 17) * S, 2.2 * S, 0, 0, Math.PI * 2);
    ctx.fill();
    cushion(ctx, cx0 + sway, gy - dragLift + (x.dragging ? 2 : 0));

    const breath = Math.sin(t * 0.06) > 0 ? 0 : 1;   // gentle 1px breathing
    const night = K.isNight ? K.isNight() : false;

    let catGy = gy;   // the row the cat's own geometry is anchored to (lifts when dragged)

    if (x.dragging) {
      // Held up over its cushion: grasps at the air (fast small beckon), eyes wide
      const beckon = Math.floor(t / 6) % 2;
      catGy = gy - dragLift;
      cat(ctx, cx + sway, catGy, {
        beckon, eyes: "wide", bellDx: beckon ? 1 : -1,
      });
    } else if (state === "limit") {
      // Quota exhausted: the paw drops fully and the cat curls asleep on the cushion
      const reset = x.resetSecs;
      const waking = reset != null && reset > 0 && reset < 300;
      catGy = gy - breath;
      const peek = waking && Math.floor(t / 25) % 4 === 0;
      cat(ctx, cx, catGy, { pawDown: true, eyes: peek ? "blink" : "closed" });
      K.zzz(ctx, cx, catGy - 26, t, waking ? 1 : 3);
    } else if (state === "working") {
      // Beckon speed DOUBLES — summoning fortune is doing the work; the bell swings with it.
      // Each tool key drives its own fortune-cat "prop theater"; the status tag still shows
      // unless a speech bubble is up (mirrors the house pet.js standard).
      const note = x.toolNote || "";
      const beckon = Math.floor(t / 12) % 2;
      const thinking = !note;
      // A few tool keys move the cat itself; the props for each are drawn just below.
      let catDx = 0, catBob = 0, eyeMode = "closed";
      if (note === "coding") catBob = Math.floor(t / 8) % 2;                      // kneading rhythm
      else if (note === "searching") catDx = Math.round(Math.sin(t * 0.16) * 2);  // pouncing left-right
      else if (note === "browsing") eyeMode = "open";                            // watching the coin
      else if (note === "testing" && Math.floor(t / 50) % 5 === 4) { catDx = -2; eyeMode = "blink"; } // sniff recoil
      catGy = gy - breath - catBob;
      cat(ctx, cx + catDx, catGy, {
        beckon,
        eyes: eyeMode,
        bellDx: beckon ? 1 : 0,
        headDx: hdx,
        // Thinking (no toolNote): ears rotate slightly as if listening
        earTwitch: thinking ? Math.floor(t / 20) % 2 : 0,
      });

      // ---- Prop theater: a CLOSED set of 10 tool keys. Unknown/missing keys draw no
      // prop and fall through to the generic status tag below. ----
      if (note === "cmd") {
        // Beckons at a keyboard on the near cushion; the beckon "presses" a lit key
        const kbx = cx - 22;
        px(ctx, kbx, gy - 2, 13, 4, "#2a2723");                    // keyboard base
        const lit = Math.floor(t / 12) % 4;                        // which cap lights, in beckon sync
        for (let i = 0; i < 4; i++) {
          const on = i === lit && beckon === 1;                    // brightest as the paw dips
          px(ctx, kbx + 1 + i * 3, gy - 1, 2, 2, on ? "#9fe8a0" : "#454c58");
        }
      } else if (note === "reading") {
        // Flipping through a ledger book with the free paw
        const bx = cx - 22;
        px(ctx, bx, gy - 5, 6, 6, "#e8e2d8");                      // left leaf
        px(ctx, bx + 6, gy - 5, 6, 6, "#f0eadf");                  // right leaf
        px(ctx, bx + 5, gy - 6, 2, 7, MK.brown);                   // spine / cover
        const ph = Math.floor(t / 16) % 3;                         // a page lifting over
        if (ph === 1) px(ctx, bx + 3, gy - 6, 3, 2, "#fffdf6");
        else if (ph === 2) px(ctx, bx + 6, gy - 6, 3, 2, "#fffdf6");
        px(ctx, bx + 1, gy - 3, 4, 1, "#b9b0a0");                  // ledger rule lines
        px(ctx, bx + 7, gy - 3, 4, 1, "#b9b0a0");
      } else if (note === "coding") {
        // Kneading (踩奶) on the cushion — dough lumps well up just outside the paws,
        // alternating side to side. Warm beige reads against both the cream body and
        // the red cushion, so the motion is clearly visible.
        const kf = Math.floor(t / 8) % 2;
        const dough = "#e0c9a0";
        px(ctx, cx - 14, gy - 1 - (kf ? 1 : 0), 3, 2, dough);   // left paw kneads
        px(ctx, cx + 11, gy - 1 - (kf ? 0 : 1), 3, 2, dough);   // right paw kneads (offbeat)
        if (Math.floor(t / 8) % 4 === 0) px(ctx, cx - 1, gy + 1, 2, 1, dough); // stray lump on the cushion front
      } else if (note === "searching") {
        // A toy mouse pinned on the cushion; the cat pounces onto it (cat sways via catDx)
        const mxp = cx - 14;
        px(ctx, mxp, gy - 2, 4, 2, "#9aa0a6");                     // mouse body
        px(ctx, mxp - 1, gy - 2, 1, 1, "#9aa0a6");                 // nose
        px(ctx, mxp, gy - 3, 1, 1, "#c9cfd4");                     // ear
        px(ctx, mxp + 3, gy - 1, 1, 1, MK.ink);                    // eye
        const tw = Math.floor(t / 6) % 2 ? 1 : 0;                  // tail flick
        px(ctx, mxp + 4, gy - 1 + tw, 2, 1, "#c86868");            // tail
      } else if (note === "browsing") {
        // A koban dangles on a swinging string; the cat's gaze (and paw) chase it
        const sway = Math.round(Math.sin(t * 0.12) * 4);
        const ax = cx + 15, ay = catGy - 30;                       // string anchor above the shoulder
        for (let i = 0; i < 5; i++) {
          px(ctx, ax + Math.round((sway * i) / 5), ay + i * 2, 1, 1, "#8a8478");
        }
        koban(ctx, ax - 1 + sway, ay + 10, Math.floor(t / 10) % 2 === 0);
      } else if (note === "agents") {
        // Summons a huddle of mini lucky cats beside the cushion, each doing a tiny beckon
        const summoned = 1 + (Math.floor(t / 24) % 3);             // pop in one by one
        const spots = [[cx - 16, gy - 4], [cx + 20, gy - 4], [cx - 22, gy - 4]];
        for (let i = 0; i < summoned; i++) miniNeko(ctx, spots[i][0], spots[i][1], t, i * 1.7);
      } else if (note === "planning") {
        // Coins stacked into piles; one pile earns a green check each interval
        const piles = [[cx - 21, 3], [cx - 17, 4], [cx - 13, 2]];
        const checked = Math.floor(t / 30) % 3;
        for (let p = 0; p < piles.length; p++) {
          const pxx = piles[p][0], hgt = piles[p][1];
          for (let j = 0; j < hgt; j++) koban(ctx, pxx, gy - 1 - j * 2, false);
          if (p === checked) {                                     // green tick over the pile
            const ty = gy - 2 - hgt * 2;
            px(ctx, pxx, ty + 1, 1, 1, "#4a9a4a");
            px(ctx, pxx + 1, ty + 2, 1, 1, "#4a9a4a");
            px(ctx, pxx + 2, ty, 1, 1, "#4a9a4a");
            px(ctx, pxx + 3, ty - 1, 1, 1, "#4a9a4a");
          }
        }
      } else if (note === "git") {
        // A branching trail of coins — the commit chain; the newest pulses gold
        const tk = cx - 16;
        px(ctx, tk + 1, gy - 9, 1, 9, "#6b665c");                  // main line
        koban(ctx, tk, gy - 1, false);                            // older commits
        koban(ctx, tk, gy - 5, false);
        px(ctx, tk + 2, gy - 5, 2, 1, "#6b665c");                  // branch off
        px(ctx, tk + 3, gy - 7, 1, 2, "#6b665c");
        koban(ctx, tk + 2, gy - 9, false);                        // side-branch commit
        koban(ctx, tk, gy - 9, Math.floor(t / 12) % 2 === 0);     // newest, pulsing gold
      } else if (note === "testing") {
        // Sniffing a fish: mostly fresh ✓, occasionally a nose-covered ✗ recoil (via catDx)
        const fx = cx - 14;
        px(ctx, fx, gy - 3, 5, 3, "#8fb4c9");                      // fish body
        px(ctx, fx + 5, gy - 3, 2, 1, "#8fb4c9");                  // tail (upper)
        px(ctx, fx + 5, gy - 1, 2, 1, "#8fb4c9");                  // tail (lower)
        px(ctx, fx + 4, gy - 2, 1, 1, "#f0eadf");                  // gill
        px(ctx, fx, gy - 3, 1, 1, MK.ink);                        // eye
        const spoiled = Math.floor(t / 50) % 5 === 4;
        const rx = cx - 16, ry = gy - 9;                           // verdict mark above the fish
        if (spoiled) {                                             // red ✗
          px(ctx, rx, ry, 1, 1, FAIL); px(ctx, rx + 2, ry, 1, 1, FAIL);
          px(ctx, rx + 1, ry + 1, 1, 1, FAIL);
          px(ctx, rx, ry + 2, 1, 1, FAIL); px(ctx, rx + 2, ry + 2, 1, 1, FAIL);
        } else {                                                   // green ✓
          px(ctx, rx, ry + 1, 1, 1, "#4a9a4a"); px(ctx, rx + 1, ry + 2, 1, 1, "#4a9a4a");
          px(ctx, rx + 2, ry, 1, 1, "#4a9a4a"); px(ctx, rx + 3, ry - 1, 1, 1, "#4a9a4a");
        }
      } else if (note === "deps") {
        // A wrapped gift slides in from the right; the beckon paw drags it onto the cushion
        const inn = Math.round(8 + 5 * Math.cos(t * 0.05));        // slide-in offset (3..13)
        const bxg = cx + 9 + inn;
        px(ctx, bxg, gy - 6, 7, 6, MK.brown);                     // box
        px(ctx, bxg, gy - 6, 7, 1, "#a3805a");                    // lid highlight
        px(ctx, bxg + 3, gy - 6, 1, 6, MK.red);                   // ribbon (vertical)
        px(ctx, bxg, gy - 4, 7, 1, MK.red);                       // ribbon (horizontal)
        px(ctx, bxg + 2, gy - 8, 2, 2, MK.red);                   // bow
        px(ctx, bxg + 3, gy - 7, 1, 1, MK.gold);                  // bow knot
      }

      if (!bubble) K.statusTag(ctx, canvas, cx, catGy - 26, note || "thinking", t);
      // Patted mid-work: doesn't stop, but leaks a little heart
      if (x.pat && Math.floor(t / 40) % 2 === 0) K.heart(ctx, cx - 17, catGy - 24, 0.7);
    } else if (state === "attention") {
      // The paw FREEZES mid-beckon at its highest point; the eyes OPEN — it's looking at you
      catGy = gy;
      cat(ctx, cx, catGy, { beckon: 0, eyes: "wide", bellDx: 0 });
      // A soft gold sparkle to draw the eye up to the frozen paw
      if (Math.floor(t / 16) % 2 === 0) {
        px(ctx, cx + 17, catGy - 27, 1, 1, AMBER);
        px(ctx, cx + 18, catGy - 25, 1, 1, AMBER);
        px(ctx, cx + 17, catGy - 23, 1, 1, AMBER);
      }
    } else if (state === "done") {
      // Triple-speed victory beckon + confetti + the bell swinging wide
      const level = Math.max(0, Math.min(3, x.celebrate || 0));
      const beckon = Math.floor(t / 8) % 2;
      const bob = Math.abs(Math.sin(t * 0.13)) > 0.5 ? 1 : 0;
      catGy = gy - bob;
      cat(ctx, cx, catGy, {
        beckon,
        eyes: "pleased",
        bellDx: Math.round(Math.sin(t * 0.35) * (1 + level)),
      });
      const ph = Math.floor(t / 18) % 2;
      K.heart(ctx, cx + (ph ? 16 : -18), catGy - 24, 0.9);
      if (level >= 2) K.heart(ctx, cx + (ph ? -20 : 18), catGy - 20, 0.7);
      if (level >= 1) K.confetti(ctx, canvas, cx, level, t);
    } else {
      // idle: tickle > pat > night-sleep > serene beckon
      if (x.tickle) {
        // Fast cursor wiggle over the pet: fur bristles and it squirms
        const wob = (Math.floor(t / 3) % 2 ? 1 : -1) * 2;
        catGy = gy;
        cat(ctx, cx + wob, catGy, { beckon: 0, eyes: "blink", bristleJag: t % 6 < 3 ? 1 : 0 });
        if (Math.floor(t / 6) % 2 === 0) {
          ctx.font = "bold 10px Consolas, monospace";
          ctx.fillStyle = AMBER;
          ctx.fillText("~", (cx + 15) * S, (catGy - 24) * S);
        }
        K.heart(ctx, cx - 18, catGy - 24, 0.7);
      } else if (x.pat) {
        // Head pat: a pleased deeper eye-arc, hearts, and the bell jingling side to side
        patT++;
        catGy = gy - breath;
        const jingle = Math.round(Math.sin(t * 0.4) * 1.2);
        cat(ctx, cx, catGy, { beckon: Math.floor(t / 25) % 2, eyes: "pleased", bellDx: jingle });
        if (patT > 120) {
          for (let i = 0; i < 3; i++) {
            const a = t * 0.08 + i * 2.1;
            K.heart(ctx, cx + Math.round(Math.cos(a) * 13), catGy - 20 + Math.round(Math.sin(a) * 5), 0.85);
          }
        } else {
          const ph = (t % 50) / 50;
          K.heart(ctx, cx + 9, catGy - 26 - ph * 5, 0.9 - ph * 0.7);
        }
      } else if (night) {
        // Night: curled asleep on the cushion, paw down
        catGy = gy - breath;
        cat(ctx, cx, catGy, { pawDown: true, eyes: "closed" });
        K.zzz(ctx, cx, catGy - 26, t, 1);
      } else {
        // Serene: a slow beckon (~one bob per 50 frames), the odd whisker twitch and blink
        if (blinkT > 0) blinkT--; else if (Math.random() < 0.02) blinkT = 6;
        const beckon = Math.floor(t / 25) % 2;
        const wdx = Math.floor(t / 60) % 11 === 0 ? (t % 2 ? 1 : -1) : 0;
        catGy = gy - breath;
        cat(ctx, cx, catGy, {
          beckon,
          eyes: blinkT > 0 ? "blink" : "closed",
          bellDx: beckon ? 1 : 0,
          headDx: hdx,
          whiskerDx: wdx,
        });
      }
      if (!x.pat) patT = 0;
    }

    // Oops: eyes already forced open where relevant; add bristles + a red annoyance mark
    if (x.oops && !x.dragging && state !== "limit") {
      bristle(ctx, cx, catGy, t % 6 < 3 ? 1 : 0);
      const ax = cx - 19, ay = catGy - 27;
      px(ctx, ax + 1, ay, 1, 4, FAIL);
      px(ctx, ax + 3, ay, 1, 4, FAIL);
      px(ctx, ax, ay + 1, 4, 1, FAIL);
      px(ctx, ax, ay + 3, 4, 1, FAIL);
    }

    // Background shells: a gold coin of fortune orbiting overhead
    if ((x.bgCount || 0) > 0 && !x.dragging && state !== "limit") {
      const a = t * 0.035;
      const sx = cx + Math.round(Math.cos(a) * 19);
      const sy = catGy - 30 + Math.round(Math.sin(a) * 4);
      const behind = Math.sin(a) < -0.2;
      ctx.globalAlpha = behind ? 0.4 : 1;
      px(ctx, sx, sy, 2, 2, MK.gold);
      px(ctx, sx, sy, 1, 2, MK.goldShade);
      ctx.globalAlpha = 1;
      if (x.bgCount > 1) {
        ctx.font = "bold 10px Consolas, monospace";
        ctx.fillStyle = MK.gold;
        ctx.fillText("×" + x.bgCount, (cx - 24) * S, (catGy - 30) * S);
      }
    }

    // Active subagents: a mini beckoning kitten each, flanking the cushion
    const agents = x.agentCount || 0;
    if (agents > 0 && !x.dragging && state !== "limit") {
      const slots = [[cx0 - 22, gy - 4], [cx0 + 22, gy - 4]];
      const shown = Math.min(agents, slots.length);
      for (let i = 0; i < shown; i++) miniNeko(ctx, slots[i][0], slots[i][1], t, i * 1.7);
      if (agents > slots.length) {
        ctx.font = "bold 9px Consolas, monospace";
        ctx.fillStyle = MK.brown;
        ctx.fillText("×" + agents, (cx0 - 26) * S, (gy - 6) * S);
      }
    }

    // Usage warning: amber exclamation above the head (slow blink) — mirrors pet.js / tabby
    if (warn && state !== "limit" && !x.dragging && Math.floor(t / 30) % 2 === 0) {
      px(ctx, cx - 1, catGy - 34, 2, 4, AMBER);
      px(ctx, cx - 1, catGy - 29, 2, 2, AMBER);
    }

    // Multi-session badge
    if ((x.sessions || 0) > 1 && !x.dragging) {
      ctx.font = "bold 11px Consolas, monospace";
      ctx.fillStyle = AMBER;
      ctx.fillText("×" + x.sessions, (cx + 15) * S, (catGy - 28) * S);
    }

    // Work-time badge (after a full minute, minute granularity)
    if (state === "working" && (x.workSecs || 0) >= 60 && !x.dragging) {
      const label = Math.floor(x.workSecs / 60) + "m";
      ctx.font = "bold 11px Consolas, monospace";
      ctx.fillStyle = AMBER;
      const tw = ctx.measureText(label).width;
      const txx = Math.min((cx + 16) * S, (canvas.clientWidth || canvas.width) - tw - 4);
      ctx.fillText(label, txx, (catGy - 14) * S);
    }

    // Speech bubble, anchored above the ear tops (the sprite's highest point)
    if (bubble) K.bubbleBox(ctx, canvas, bubble, cx, (catGy - 31) * S);
  }

  window.PetRenderer = { draw };
})();
