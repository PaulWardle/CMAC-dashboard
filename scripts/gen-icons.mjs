/**
 * Generates the PWA / favicon PNGs with zero dependencies (Node's zlib only).
 * Produces a simple on-brand mark: navy field with the CMAC red disc.
 * Replace the files in public/icons with real artwork whenever you have it —
 * just keep the same filenames and sizes.
 *
 * Run: npm run gen:icons
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const NAVY = [17, 33, 56];
const RED = [253, 14, 51];

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
function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  return Buffer.concat([u32(data.length), body, u32(crc32(body))]);
}
function encodePNG(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.concat([u32(size), u32(size), Buffer.from([8, 6, 0, 0, 0])]);
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

function makeIcon(size, radiusFactor = 0.3) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    rgba[i * 4] = NAVY[0];
    rgba[i * 4 + 1] = NAVY[1];
    rgba[i * 4 + 2] = NAVY[2];
    rgba[i * 4 + 3] = 255;
  }
  const cx = size / 2;
  const cy = size / 2;
  const r = size * radiusFactor;
  const rr = r * r;
  const edge = 1.5; // soft anti-aliased edge in px
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const t = Math.min(1, Math.max(0, (r - dist) / edge + 0.5));
      if (t > 0) {
        const i = (y * size + x) * 4;
        rgba[i] = Math.round(NAVY[0] + (RED[0] - NAVY[0]) * t);
        rgba[i + 1] = Math.round(NAVY[1] + (RED[1] - NAVY[1]) * t);
        rgba[i + 2] = Math.round(NAVY[2] + (RED[2] - NAVY[2]) * t);
      }
    }
  }
  return encodePNG(size, rgba);
}

mkdirSync(join(ROOT, "public", "icons"), { recursive: true });

const outputs = [
  ["public/icons/icon-192.png", makeIcon(192, 0.3)],
  ["public/icons/icon-512.png", makeIcon(512, 0.3)],
  ["public/icons/icon-512-maskable.png", makeIcon(512, 0.22)], // smaller mark for maskable safe zone
  ["public/icons/apple-touch-icon.png", makeIcon(180, 0.3)],
  ["public/favicon.png", makeIcon(48, 0.32)],
];

for (const [rel, buf] of outputs) {
  writeFileSync(join(ROOT, rel), buf);
  console.log("wrote", rel, buf.length + "b");
}
console.log("done");
