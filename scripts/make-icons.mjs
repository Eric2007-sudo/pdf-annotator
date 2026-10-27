// 生成扩展图标（纯 Node，无依赖）。运行：node scripts/make-icons.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "icons");
mkdirSync(outDir, { recursive: true });

const BG = [38, 40, 44, 255];
const PAPER = [242, 244, 248, 255];
const ACCENT = [255, 214, 102, 255];
const ACCENT2 = [76, 141, 255, 255];

function drawIcon(size) {
  const px = new Uint8Array(size * size * 4);
  const set = (x, y, [r, g, b, a]) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = a;
  };
  const rect = (x0, y0, w, h, color) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(Math.round(x), Math.round(y), color);
  };

  // 圆角背景
  const r = size * 0.22;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.max(r - x, 0, x - (size - 1 - r));
      const dy = Math.max(r - y, 0, y - (size - 1 - r));
      if (dx * dx + dy * dy <= r * r) set(x, y, BG);
    }
  }

  // 纸张
  const pw = Math.round(size * 0.46);
  const ph = Math.round(size * 0.6);
  const px0 = Math.round(size * 0.27);
  const py0 = Math.round(size * 0.2);
  rect(px0, py0, pw, ph, PAPER);

  // 折角
  const fold = Math.round(size * 0.14);
  for (let y = 0; y < fold; y++) for (let x = 0; x < fold - y; x++) set(px0 + pw - fold + x, py0 + y, BG);

  // 文本行
  const lineH = Math.max(1, Math.round(size * 0.045));
  const gap = Math.max(1, Math.round(size * 0.085));
  let y = py0 + Math.round(size * 0.28);
  for (let i = 0; i < 4; i++) {
    const w = pw - Math.round(size * 0.2) - (i === 3 ? Math.round(size * 0.12) : 0);
    rect(px0 + Math.round(size * 0.1), y, w, lineH, [170, 175, 185, 255]);
    y += gap;
  }

  // 高亮
  rect(px0 + Math.round(size * 0.1) - 1, py0 + Math.round(size * 0.28) + gap * 2 - 1, pw - Math.round(size * 0.18), lineH + 2, ACCENT);

  // 右下角 AI 点
  const cr = Math.round(size * 0.14);
  const cx = Math.round(size * 0.76);
  const cy = Math.round(size * 0.78);
  for (let yy = -cr; yy <= cr; yy++)
    for (let xx = -cr; xx <= cr; xx++) if (xx * xx + yy * yy <= cr * cr) set(cx + xx, cy + yy, ACCENT2);

  return px;
}

/* ---- 编码 PNG ---- */
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function encodePng(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

for (const size of [16, 32, 48, 128]) {
  const px = drawIcon(size);
  writeFileSync(join(outDir, `icon${size}.png`), encodePng(size, px));
  console.log("icon" + size + ".png");
}
