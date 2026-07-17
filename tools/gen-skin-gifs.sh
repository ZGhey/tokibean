#!/bin/bash
# Regenerate the README skin-gallery GIFs (docs/gifs/skin-*.gif).
#
# Renders every built-in skin in its "done" celebration state via the
# skin-capture.html harness: headless Chrome draws 30 frames straight through
# PetRenderer.draw(), the frames come back as PNG data URLs in the DOM, and
# ffmpeg assembles a transparent 10fps 3s looping GIF (matching the specs of
# the original state-gallery GIFs).
#
# Requires: Google Chrome, node, ffmpeg. Run from anywhere:
#   tools/gen-skin-gifs.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT/docs/gifs"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
if [ ! -x "$CHROME" ]; then
  CHROME="$(command -v google-chrome || command -v chromium || true)"
fi
[ -n "$CHROME" ] || { echo "error: Chrome/Chromium not found (set CHROME=...)"; exit 1; }

BASE="file://$ROOT/src"
HARNESS="file://$ROOT/tools/skin-capture.html"

# <gif name>:<skin file name, empty = default renderer in pet.js>
SKINS="dundun: daruma:daruma maneki:maneki shiba:shiba tabby:tabby tuerye:tuerye"

for pair in $SKINS; do
  name="${pair%%:*}"
  skin="${pair#*:}"
  frames_dir="$WORK_DIR/$name"
  mkdir -p "$frames_dir"

  url="$HARNESS?skin=$skin&state=done&note=&frames=30&step=6&start=600&celebrate=1&base=$BASE"
  "$CHROME" --headless=new --disable-gpu --allow-file-access-from-files \
    --virtual-time-budget=15000 --dump-dom "$url" 2>/dev/null > "$frames_dir/dom.html"

  node -e '
    const fs = require("fs");
    const dir = process.argv[1];
    const dom = fs.readFileSync(dir + "/dom.html", "utf8");
    const m = dom.match(/<pre id="out">(\[.*?\])<\/pre>/s);
    if (!m) {
      const e = dom.match(/<pre id="out">(ERR[^<]*)/);
      console.error("no frames captured" + (e ? ": " + e[1] : ""));
      process.exit(1);
    }
    const arr = JSON.parse(m[1].replace(/&quot;/g, "\""));
    arr.forEach((u, i) => {
      const b = Buffer.from(u.split(",")[1], "base64");
      fs.writeFileSync(dir + "/f" + String(i).padStart(2, "0") + ".png", b);
    });
    console.log(arr.length + " frames");
  ' "$frames_dir"

  ffmpeg -y -v error -framerate 10 -i "$frames_dir/f%02d.png" \
    -filter_complex "[0:v]split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse=alpha_threshold=128" \
    -loop 0 "$OUT_DIR/skin-$name.gif"
  echo "skin-$name.gif"
done
