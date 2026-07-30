// Draws the extension icon: a white "2" on an indigo rounded square.
//
// The numeral is one continuous stroked path, an arc across the top that runs into
// a diagonal and then a base bar, so the joins are round and there are no flat
// terminals or kinks. Edges come from the distance field directly rather than from
// supersampling: coverage is 0.5 minus the signed distance in pixels, which is
// exact for these shapes and smoother than any sample count.
//
// Zero dependencies; the PNGs are written by hand. Run with `npm run icons`.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const INDIGO = [79, 70, 229];
const WHITE = [255, 255, 255];
const CORNER = 0.225; // background corner radius, as a fraction of the icon

// The numeral, in a 0..1 box, with angles measured y-down so 270 is straight up.
// The stroke starts at the upper left of the bowl, near ten o'clock, sweeps over
// the top and down the right side, then carries on into the diagonal and the base
// as one path.
//
// Starting lower than this is what made an earlier attempt read as a spiral: the
// terminal curled inward toward the diagonal and closed the bowl.
const ARC = { cx: 0.5, cy: 0.382, r: 0.148, fromDeg: 200, sweepDeg: 190 };
const DIAGONAL_END = [0.35, 0.705];
const BASE_END = [0.658, 0.705];
const ARC_STEPS = 40;

/** The path as a polyline, dense enough that the chords are inside the ink. */
function glyphPath() {
  const points = [];
  for (let i = 0; i <= ARC_STEPS; i++) {
    const deg = ARC.fromDeg + (ARC.sweepDeg * i) / ARC_STEPS;
    const rad = (deg * Math.PI) / 180;
    points.push([ARC.cx + ARC.r * Math.cos(rad), ARC.cy + ARC.r * Math.sin(rad)]);
  }
  points.push(DIAGONAL_END, BASE_END);
  return points;
}

const PATH = glyphPath();

/** Distance from a point to a line segment. */
function distToSegment(x, y, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const along = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (ax + along * dx), y - (ay + along * dy));
}

/**
 * Signed distance to the stroked path. Taking the smallest segment distance and
 * subtracting half the stroke width is exactly a path with round caps and round
 * joins, which is why the terminals and the corner come out clean.
 */
function glyph(x, y, thickness) {
  let nearest = Infinity;
  for (let i = 1; i < PATH.length; i++) {
    const [ax, ay] = PATH[i - 1];
    const [bx, by] = PATH[i];
    const d = distToSegment(x, y, ax, ay, bx, by);
    if (d < nearest) nearest = d;
  }
  return nearest - thickness / 2;
}

/** Signed distance to the rounded square filling the unit box. Negative inside. */
function background(x, y) {
  const qx = Math.abs(x - 0.5) - (0.5 - CORNER);
  const qy = Math.abs(y - 0.5) - (0.5 - CORNER);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - CORNER;
}

/** Coverage of one pixel, from the signed distance scaled into pixel units. */
function coverage(distance, size) {
  return Math.min(1, Math.max(0, 0.5 - distance * size));
}

function rows(size) {
  // A hairline stroke disappears in a 16px toolbar, so thicken it as the icon
  // shrinks. The numeral has to stay legible at the size people actually see.
  const thickness = size <= 16 ? 0.128 : size <= 32 ? 0.11 : 0.094;
  const out = [];
  for (let py = 0; py < size; py++) {
    const row = [0]; // PNG filter byte: none
    const y = (py + 0.5) / size;
    for (let px = 0; px < size; px++) {
      const x = (px + 0.5) / size;
      const bg = coverage(background(x, y), size);
      const fg = coverage(glyph(x, y, thickness), size);
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
    chunk('IDAT', deflateSync(Buffer.concat(rows(size)), { level: 9 })),
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
