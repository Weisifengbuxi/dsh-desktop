// make-icon.js — 生成占位应用图标（纯 Node，无外部依赖）
// 运行：node scripts/make-icon.js
// 产物：build/icon.png (512x512)、build/icon.ico (16~256，供 Windows 安装器使用)
// 想换成自己的图标：直接覆盖 build/icon.png 和 build/icon.ico 即可，无需改代码。
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "build");

// ---------- 极简 PNG 编码器 ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// ---------- 占位图案：蓝色圆角方块 + 白色圆点 ----------
function drawTile(size) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.19; // 圆角半径
  const half = size * 0.5 - r;
  const dotR = size * 0.16;
  const tile = [77, 107, 254, 255]; // #4d6bfe
  const dot = [255, 255, 255, 255];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.max(Math.abs(x - cx) - half, 0);
      const dy = Math.max(Math.abs(y - cy) - half, 0);
      const inTile = dx * dx + dy * dy <= r * r;
      let o = (y * size + x) * 4;
      if (inTile) {
        buf[o] = tile[0];
        buf[o + 1] = tile[1];
        buf[o + 2] = tile[2];
        buf[o + 3] = tile[3];
      }
      const ddx = x - cx;
      const ddy = y - cy;
      if (inTile && ddx * ddx + ddy * ddy <= dotR * dotR) {
        buf[o] = dot[0];
        buf[o + 1] = dot[1];
        buf[o + 2] = dot[2];
        buf[o + 3] = dot[3];
      }
    }
  }
  return buf;
}

// ---------- ICO 封装（内嵌 PNG，Windows Vista+ 支持） ----------
function encodeIco(pngs) {
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  const entries = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  pngs.forEach((p, i) => {
    const e = entries.subarray(i * 16, (i + 1) * 16);
    e[0] = p.size >= 256 ? 0 : p.size;
    e[1] = p.size >= 256 ? 0 : p.size;
    e[2] = 0;
    e[3] = 0;
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(p.data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += p.data.length;
  });
  return Buffer.concat([header, entries, ...pngs.map((p) => p.data)]);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "icon.png"), encodePng(512, 512, drawTile(512)));
const sizes = [16, 24, 32, 48, 64, 128, 256];
writeFileSync(join(outDir, "icon.ico"), encodeIco(sizes.map((s) => ({ size: s, data: encodePng(s, s, drawTile(s)) }))));
console.log("已生成: build/icon.png (512x512) 和 build/icon.ico (16~256)");
