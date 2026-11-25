// DompetKu v1.0.2 — generate PWA icons (dependency-free PNG encoder).
// Green rounded square, pearl coin with a brass center. Run: npm run gen-icons
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'icons');
mkdirSync(outDir, { recursive: true });

// CRC32 (PNG chunks need it).
const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function hex(rgb) {
  return [parseInt(rgb.slice(1, 3), 16), parseInt(rgb.slice(3, 5), 16), parseInt(rgb.slice(5, 7), 16)];
}

const GREEN = hex('#0C3B2E');
const PEARL = hex('#FAF7F2');
const BRASS = hex('#B7791F');

function pixel(x, y, size, maskable) {
  const cx = size / 2;
  const cy = size / 2;
  if (!maskable) {
    // Rounded-square clip for "any" icons.
    const r = size * 0.22;
    const dx = Math.max(Math.abs(x - cx) - (size / 2 - r), 0);
    const dy = Math.max(Math.abs(y - cy) - (size / 2 - r), 0);
    if (dx * dx + dy * dy > r * r) return [0, 0, 0, 0];
  }
  const d = Math.hypot(x - cx, y - cy);
  const coinR = size * 0.27;
  const ringInner = size * 0.2;
  const ringOuter = size * 0.235;
  const dotR = size * 0.05;
  if (d <= dotR) return [...BRASS, 255];
  if (d >= ringInner && d <= ringOuter) return [...GREEN, 255];
  if (d <= coinR) return [...PEARL, 255];
  return [...GREEN, 255];
}

function png(size, maskable) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5, size, maskable);
      const off = y * (size * 4 + 1) + 1 + x * 4;
      raw[off] = r;
      raw[off + 1] = g;
      raw[off + 2] = b;
      raw[off + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const idat = deflateSync(raw, { level: 9 });
  const file = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return file;
}

for (const [name, size, maskable] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
]) {
  const path = join(outDir, name);
  writeFileSync(path, png(size, maskable));
  console.log(`wrote ${path}`);
}

// Browsers probe /favicon.ico on page load even when the page declares an
// SVG icon, and the dev server (and the static host) 404s when it is
// missing — a bare "Failed to load resource: 404" in the console. A real
// .ico file ends that. The entries are PNG-compressed, which every modern
// browser accepts inside an ICO container.
function ico(sizes) {
  const images = sizes.map((size) => png(size, false));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: ICO
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map((data, i) => {
    const entry = Buffer.alloc(16);
    entry[0] = sizes[i]; // width (0 would mean 256)
    entry[1] = sizes[i]; // height
    entry[2] = 0; // color count
    entry[3] = 0; // reserved
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bit count
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images]);
}

const faviconPath = join(root, 'public', 'favicon.ico');
writeFileSync(faviconPath, ico([16, 32]));
console.log(`wrote ${faviconPath}`);
