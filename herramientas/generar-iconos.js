// Genera los íconos PNG de la extensión sin dependencias externas.
// Uso: node herramientas/generar-iconos.js
"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SIZES = [16, 32, 48, 128];
const OUT_DIR = path.join(__dirname, "..", "icons");
const SUPERSAMPLE = 4; // antialiasing: 4x4 muestras por píxel

// Degradé del fondo (arriba-izquierda -> abajo-derecha).
const FROM = [99, 102, 241]; // #6366f1
const TO = [124, 58, 237];   // #7c3aed

// --- Formas en coordenadas normalizadas (0..1) ---------------------------

function inRoundedRect(x, y, r) {
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function inCircle(x, y, cx, cy, r) {
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

// Barra vertical con extremos redondeados.
function inCapsule(x, y, cx, cy, halfH, r) {
  const dy = Math.max(Math.abs(y - cy) - halfH, 0);
  return (x - cx) ** 2 + dy * dy <= r * r;
}

function inGlyph(x, y) {
  // Persona: cabeza + hombros.
  if (inCircle(x, y, 0.37, 0.37, 0.135)) return true;
  if (y < 0.78 && inCircle(x, y, 0.37, 0.86, 0.265)) return true;
  // Ondas de voz: tres barras.
  const bars = [[0.68, 0.53, 0.07], [0.775, 0.53, 0.15], [0.87, 0.53, 0.095]];
  return bars.some(([cx, cy, h]) => inCapsule(x, y, cx, cy, h, 0.032));
}

// --- Rasterizado ----------------------------------------------------------

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const n = SUPERSAMPLE;
  for (let py = 0; py < size; py++) {
    for (let pxl = 0; pxl < size; pxl++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < n; sy++) {
        for (let sx = 0; sx < n; sx++) {
          const x = (pxl + (sx + 0.5) / n) / size;
          const y = (py + (sy + 0.5) / n) / size;
          if (!inRoundedRect(x, y, 0.23)) continue;
          let c;
          if (inGlyph(x, y)) {
            c = [255, 255, 255];
          } else {
            const t = (x + y) / 2;
            c = FROM.map((f, i) => f + (TO[i] - f) * t);
          }
          r += c[0]; g += c[1]; b += c[2]; a += 1;
        }
      }
      const i = (py * size + pxl) * 4;
      if (a) {
        px[i] = Math.round(r / a);
        px[i + 1] = Math.round(g / a);
        px[i + 2] = Math.round(b / a);
        px[i + 3] = Math.round((255 * a) / (n * n));
      }
    }
  }
  return px;
}

// --- Codificación PNG -----------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bits por canal
  ihdr[9] = 6;  // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // sin filtro
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = path.join(OUT_DIR, `icon-${size}.png`);
  fs.writeFileSync(file, encodePng(size, render(size)));
  console.log("Generado", path.relative(process.cwd(), file));
}
