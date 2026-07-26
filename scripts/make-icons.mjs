// Generates placeholder extension icons: white 2 on an indigo rounded square.
// Zero dependencies; writes minimal RGBA PNGs by hand.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const BLUE = [79, 70, 229, 255];
const WHITE = [255, 255, 255, 255];
const CLEAR = [0, 0, 0, 0];

// 5x7 bitmap of "2"
const GLYPH = ['01110', '10001', '00001', '00110', '01000', '10000', '11111'];

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
  const corner = Math.max(1, Math.round(size / 8));
  const cell = size / 8;
  const offX = Math.round((size - 5 * cell * 0.9) / 2);
  const offY = Math.round((size - 7 * cell * 0.9) / 2);
  const scale = cell * 0.9;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = [0];
    for (let x = 0; x < size; x++) {
      const inCorner =
        (x < corner && y < corner && (corner - x) ** 2 + (corner - y) ** 2 > corner ** 2) ||
        (x >= size - corner && y < corner && (x - (size - corner - 1)) ** 2 + (corner - y) ** 2 > corner ** 2) ||
        (x < corner && y >= size - corner && (corner - x) ** 2 + (y - (size - corner - 1)) ** 2 > corner ** 2) ||
        (x >= size - corner && y >= size - corner && (x - (size - corner - 1)) ** 2 + (y - (size - corner - 1)) ** 2 > corner ** 2);
      let color = inCorner ? CLEAR : BLUE;
      const gx = Math.floor((x - offX) / scale);
      const gy = Math.floor((y - offY) / scale);
      if (!inCorner && gy >= 0 && gy < 7 && gx >= 0 && gx < 5 && GLYPH[gy][gx] === '1') color = WHITE;
      row.push(...color);
    }
    rows.push(Buffer.from(row));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public/icons', { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writeFileSync(`public/icons/${size}.png`, png(size));
  console.log(`wrote public/icons/${size}.png`);
}
