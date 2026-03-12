// Generates assets/icon.png, assets/icon.ico, assets/tray.png
// Uses only Node.js built-in modules (zlib, fs, path)
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

const W = 256, H = 256;
const px = new Uint8Array(W * H * 4);

const BG     = [20, 21, 28];
const ACCENT = [140, 131, 250];

function setPixel(x, y, col, a = 255) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 4;
  px[i] = col[0]; px[i+1] = col[1]; px[i+2] = col[2]; px[i+3] = a;
}

function fillRect(x, y, w, h, col, a = 255) {
  for (let dy = 0; dy < h; dy++)
    for (let dx = 0; dx < w; dx++)
      setPixel(x + dx, y + dy, col, a);
}

function drawLine(x0, y0, x1, y1, col, t = 1) {
  const dx = Math.abs(x1-x0), dy = Math.abs(y1-y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  const half = Math.floor(t / 2);
  while (true) {
    for (let ty = -half; ty <= half; ty++)
      for (let tx = -half; tx <= half; tx++)
        setPixel(x0+tx, y0+ty, col);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx)  { err += dx; y0 += sy; }
  }
}

// ── Background ────────────────────────────────────────────────────────────────
fillRect(0, 0, W, H, BG);

// Rounded corners (radius 48, transparent)
const CR = 48;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const inCorner =
      (x < CR      && y < CR      && (x-CR)**2       + (y-CR)**2       > CR**2) ||
      (x > W-CR-1  && y < CR      && (x-(W-CR-1))**2 + (y-CR)**2       > CR**2) ||
      (x < CR      && y > H-CR-1  && (x-CR)**2       + (y-(H-CR-1))**2 > CR**2) ||
      (x > W-CR-1  && y > H-CR-1  && (x-(W-CR-1))**2 + (y-(H-CR-1))**2 > CR**2);
    if (inCorner) { const i=(y*W+x)*4; px[i+3] = 0; }
  }
}

// ── Draw "K" ─────────────────────────────────────────────────────────────────
const T  = 28;   // stroke thickness
const LH = 152;  // letter height
const kx = 40, ky = 52;

fillRect(kx, ky, T, LH, ACCENT);                         // vertical bar
drawLine(kx+T, ky+LH/2, kx+T+82, ky,      ACCENT, T);   // upper arm
drawLine(kx+T, ky+LH/2, kx+T+82, ky+LH,  ACCENT, T);   // lower arm

// ── Draw "T" ─────────────────────────────────────────────────────────────────
const tx = 152, ty = 52;
fillRect(tx,    ty,    90, T,       ACCENT);              // horizontal bar
fillRect(tx+31, ty+T,  T,  LH-T,   ACCENT);              // vertical bar

// ── PNG encoder ──────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const lenBuf = Buffer.alloc(4); lenBuf.writeUInt32BE(data.length);
  const tb  = Buffer.from(type);
  const crc = Buffer.alloc(4);   crc.writeUInt32BE(crc32(Buffer.concat([tb, data])));
  return Buffer.concat([lenBuf, tb, data, crc]);
}

function makePNG(w, h, pixels) {
  const sig  = Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA

  const rows = [];
  for (let y = 0; y < h; y++) {
    rows.push(0);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      rows.push(pixels[i], pixels[i+1], pixels[i+2], pixels[i+3]);
    }
  }
  const idat = zlib.deflateSync(Buffer.from(rows));
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

// ── Nearest-neighbour downscale ───────────────────────────────────────────────
function downscale(src, sw, sh, dw, dh) {
  const dst = new Uint8Array(dw * dh * 4);
  for (let y = 0; y < dh; y++)
    for (let x = 0; x < dw; x++) {
      const si = (Math.floor(y*sh/dh)*sw + Math.floor(x*sw/dw)) * 4;
      const di = (y*dw + x) * 4;
      dst[di] = src[si]; dst[di+1] = src[si+1]; dst[di+2] = src[si+2]; dst[di+3] = src[si+3];
    }
  return dst;
}

// ── ICO builder (single 256×256 PNG frame) ───────────────────────────────────
function makeICO(pngBuf) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: ICO
  header.writeUInt16LE(1, 4); // count

  const entry = Buffer.alloc(16);
  entry[0] = 0;  // width  (0 = 256)
  entry[1] = 0;  // height (0 = 256)
  entry[2] = 0;  // color count
  entry[3] = 0;  // reserved
  entry.writeUInt16LE(1,  4); // planes
  entry.writeUInt16LE(32, 6); // bpp
  entry.writeUInt32LE(pngBuf.length, 8);
  entry.writeUInt32LE(6 + 16, 12); // offset = header + one entry

  return Buffer.concat([header, entry, pngBuf]);
}

// ── Write files ───────────────────────────────────────────────────────────────
const assetsDir = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir);

const iconPng = makePNG(W, H, px);
fs.writeFileSync(path.join(assetsDir, 'icon.png'), iconPng);
fs.writeFileSync(path.join(assetsDir, 'icon.ico'), makeICO(iconPng));

const tray32 = downscale(px, W, H, 32, 32);
fs.writeFileSync(path.join(assetsDir, 'tray.png'), makePNG(32, 32, tray32));

console.log('✓ assets/icon.png');
console.log('✓ assets/icon.ico');
console.log('✓ assets/tray.png');
