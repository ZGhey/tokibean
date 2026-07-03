// Generate app-icon.png (1024×1024): the official "拱门·墩墩" icon
// Zero-dependency: pixel data laid out by hand, PNG encoded via Node's built-in zlib
// Usage: node gen-icon.js && npm run tauri -- icon app-icon.png
const zlib = require("zlib");
const fs = require("fs");

const SIZE = 1024;
const rgba = Buffer.alloc(SIZE * SIZE * 4); // fully transparent by default

// ---- Palette ----
const BG = [0xf5, 0xee, 0xe1, 255];     // off-white rounded background
const C = [0xf2, 0x82, 0x3e, 255];      // persimmon orange (matches pet.js)
const K = [0x26, 0x22, 0x1d, 255];      // eyes
const BLUSH = [0xf0, 0xb8, 0xc4, 255];  // blush

function setPx(x, y, c) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  rgba[i] = c[0]; rgba[i + 1] = c[1]; rgba[i + 2] = c[2]; rgba[i + 3] = c[3];
}

// ---- Rounded-square background (44px outer margin, corner radius 200) ----
const M = 44, R = 200;
for (let y = M; y < SIZE - M; y++) {
  for (let x = M; x < SIZE - M; x++) {
    // Corner-arc test
    const cx = Math.min(Math.max(x, M + R), SIZE - M - R);
    const cy = Math.min(Math.max(y, M + R), SIZE - M - R);
    const dx = x - cx, dy = y - cy;
    if (dx * dx + dy * dy <= R * R) setPx(x, y, BG);
  }
}

// ---- Dundun pixel art (26×26 grid, ported from pet.js's body/eyes geometry) ----
// Grid origin: x = cx-13 → 0, y = y0-4 → 0
const grid = [];
function cell(x, y, w, h, c) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) grid.push([i, j, c]);
}
cell(6, 0, 14, 2, C);   // dome tier 2  px(cx-7,  y0-4, 14, 2)
cell(2, 2, 22, 2, C);   // dome tier 1  px(cx-11, y0-2, 22, 2)
cell(0, 4, 26, 15, C);  // body         px(cx-13, y0,   26, 15)
for (const lx of [2, 8, 16, 22]) cell(lx, 19, 2, 7, C); // four legs, y0+15, height 7
cell(4, 8, 3, 3, K);    // left eye  px(cx-9, y0+4, 3, 3)
cell(15, 8, 3, 3, K);   // right eye px(cx+2, y0+4, 3, 3)
cell(1, 15, 2, 1, BLUSH);  // left blush  px(cx-12, y0+11)
cell(23, 15, 2, 1, BLUSH); // right blush px(cx+10, y0+11)

// 26 cells × 30px = 780, centered
const CELL = 30, OX = (SIZE - 26 * CELL) / 2, OY = (SIZE - 26 * CELL) / 2;
for (const [gx, gy, c] of grid) {
  for (let j = 0; j < CELL; j++)
    for (let i = 0; i < CELL; i++)
      setPx(OX + gx * CELL + i, OY + gy * CELL + j, c);
}

// ---- PNG encoding ----
function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter: none
  rgba.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
fs.writeFileSync("app-icon.png", png);
console.log("app-icon.png 已生成(", png.length, "字节)");
