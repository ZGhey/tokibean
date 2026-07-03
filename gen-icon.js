// 生成 app-icon.png(1024×1024):拱门·墩墩官方图标
// 零依赖:像素数据手工铺,PNG 用 Node 内置 zlib 编码
// 用法:node gen-icon.js && npm run tauri -- icon app-icon.png
const zlib = require("zlib");
const fs = require("fs");

const SIZE = 1024;
const rgba = Buffer.alloc(SIZE * SIZE * 4); // 默认全透明

// ---- 调色板 ----
const BG = [0xf5, 0xee, 0xe1, 255];     // 米白圆角底
const C = [0xf2, 0x82, 0x3e, 255];      // 柿子橙(与 pet.js 一致)
const K = [0x26, 0x22, 0x1d, 255];      // 眼睛
const BLUSH = [0xf0, 0xb8, 0xc4, 255];  // 腮红

function setPx(x, y, c) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  rgba[i] = c[0]; rgba[i + 1] = c[1]; rgba[i + 2] = c[2]; rgba[i + 3] = c[3];
}

// ---- 圆角方形底(留 44px 外边距,圆角半径 200)----
const M = 44, R = 200;
for (let y = M; y < SIZE - M; y++) {
  for (let x = M; x < SIZE - M; x++) {
    // 四角圆弧判定
    const cx = Math.min(Math.max(x, M + R), SIZE - M - R);
    const cy = Math.min(Math.max(y, M + R), SIZE - M - R);
    const dx = x - cx, dy = y - cy;
    if (dx * dx + dy * dy <= R * R) setPx(x, y, BG);
  }
}

// ---- 墩墩像素图(26×26 网格,搬运自 pet.js 的 body/eyes 几何)----
// 网格原点:x = cx-13 → 0,y = y0-4 → 0
const grid = [];
function cell(x, y, w, h, c) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) grid.push([i, j, c]);
}
cell(6, 0, 14, 2, C);   // 穹顶第二级 px(cx-7,  y0-4, 14, 2)
cell(2, 2, 22, 2, C);   // 穹顶第一级 px(cx-11, y0-2, 22, 2)
cell(0, 4, 26, 15, C);  // 身体       px(cx-13, y0,   26, 15)
for (const lx of [2, 8, 16, 22]) cell(lx, 19, 2, 7, C); // 四条腿 y0+15 高 7
cell(4, 8, 3, 3, K);    // 左眼 px(cx-9, y0+4, 3, 3)
cell(15, 8, 3, 3, K);   // 右眼 px(cx+2, y0+4, 3, 3)
cell(1, 15, 2, 1, BLUSH);  // 左腮红 px(cx-12, y0+11)
cell(23, 15, 2, 1, BLUSH); // 右腮红 px(cx+10, y0+11)

// 26 格 × 30px = 780,居中
const CELL = 30, OX = (SIZE - 26 * CELL) / 2, OY = (SIZE - 26 * CELL) / 2;
for (const [gx, gy, c] of grid) {
  for (let j = 0; j < CELL; j++)
    for (let i = 0; i < CELL; i++)
      setPx(OX + gx * CELL + i, OY + gy * CELL + j, c);
}

// ---- PNG 编码 ----
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
ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
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
