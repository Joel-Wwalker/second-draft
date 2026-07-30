// Draws the extension icon: a white "2" on an indigo rounded square.
//
// Shapes are distance functions over a 0..1 square, sampled 4x4 per pixel, so
// edges come out smooth at every size. Zero dependencies; the PNGs are written
// by hand. Run with `npm run icons`.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const INDIGO = [79, 70, 229];
const WHITE = [255, 255, 255];
const SAMPLES = 4; // per axis, so 16 samples per pixel
const CORNER = 0.225; // background corner radius, as a fraction of the icon
const ARC = { cx: 0.5, cy: 0.4, r: 0.137 };

/** Distance from a point to a line segment. */
function distToSegment(x, y, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const along = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (ax + along * dx), y - (ay + along * dy));
}

/** Rounded square filling the unit box. Negative inside. */
function background(x, y) {
  const qx = Math.abs(x - 0.5) - (0.5 - CORNER);
  const qy = Math.abs(y - 0.5) - (0.5 - CORNER);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - CORNER;
}

/**
 * The numeral: an arc across the top, a diagonal down to the left, and a bar
 * along the bottom. Angles are measured with y pointing down, and the arc omits
 * the lower-left quadrant, where a 2 opens up.
 */
function glyph(x, y, thickness) {
  const half = thickness / 2;
  const angle = (Math.atan2(y - ARC.cy, x - ARC.cx) * 180) / Math.PI;
  const onArc = !(angle > 30 && angle < 160);
  const arc = onArc ? Math.abs(Math.hypot(x - ARC.cx, y - ARC.cy) - ARC.r) - half : Infinity;

  // The diagonal starts where the arc stops, so the join is seamless.
  const endX = ARC.cx + ARC.r * Math.cos((30 * Math.PI) / 180);
  const endY = ARC.cy + ARC.r * Math.sin((30 * Math.PI) / 180);
  const diagonal = distToSegment(x, y, endX, endY, 0.377, 0.688) - half;
  const base = distToSegment(x, y, 0.357, 0.688, 0.652, 0.688) - half;

  return Math.min(arc, diagonal, base);
}

/** Fraction of a pixel the shape covers, by supersampling. */
function coverage(shape, px, py, size) {
  let hits = 0;
  for (let sy = 0; sy < SAMPLES; sy++) {
    for (let sx = 0; sx < SAMPLES; sx++) {
      const x = (px + (sx + 0.5) / SAMPLES) / size;
      const y = (py + (sy + 0.5) / SAMPLES) / size;
      if (shape(x, y) < 0) hits++;
    }
  }
  return hits / (SAMPLES * SAMPLES);
}

function rows(size) {
  // A hairline stroke disappears in a 16px toolbar, so thicken it as the icon
  // shrinks. The numeral has to stay legible at the size people actually see.
  const thickness = size <= 16 ? 0.125 : size <= 32 ? 0.108 : 0.094;
  const out = [];
  for (let py = 0; py < size; py++) {
    const row = [0]; // PNG filter byte: none
    for (let px = 0; px < size; px++) {
      const bg = coverage(background, px, py, size);
      const fg = coverage((x, y) => glyph(x, y, thickness), px, py, size);
      // White over indigo, with the rounded corner cutting the alpha.
      const mix = Math.min(fg, bg);
      const channel = i => Math.round(INDIGO[i] * (1 - mix) + WHITE[i] * mix);
      row.push(channel(0), channel(1), channel(2), Math.round(bg * 255));
    }
    out.push(Buffer.from(row));
  }
  return out;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows(size)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public/icons', { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writeFileSync(`public/icons/${size}.png`, png(size));
  console.log(`wrote public/icons/${size}.png`);
}

// The store wants a 512. It lives outside public/ so WXT does not add it to the
// manifest, where it is not a size Chrome asks for and would only add weight.
mkdirSync('docs/screenshots', { recursive: true });
writeFileSync('docs/screenshots/icon-512.png', png(512));
console.log('wrote docs/screenshots/icon-512.png');
