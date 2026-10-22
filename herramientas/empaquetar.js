// Arma el .zip para subir a las tiendas (Chrome Web Store, Edge Add-ons y
// Firefox Add-ons). Incluye solo los archivos que usa la extensión.
// Uso: node herramientas/empaquetar.js
"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const INCLUDE = ["manifest.json", "src", "icons"];

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
const OUT = path.join(ROOT, "dist", `asistencia-google-meet-${manifest.version}.zip`);

function listFiles(rel) {
  const abs = path.join(ROOT, rel);
  if (fs.statSync(abs).isFile()) return [rel];
  return fs.readdirSync(abs).flatMap((name) => listFiles(path.join(rel, name)));
}

// ---- Escritura de ZIP (sin dependencias) -----------------------------------

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

function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

function buildZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const { time, date } = dosDateTime(new Date());

  for (const rel of files) {
    // Las tiendas exigen "/" como separador, no "\" de Windows.
    const name = Buffer.from(rel.split(path.sep).join("/"), "utf8");
    const data = fs.readFileSync(path.join(ROOT, rel));
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // versión necesaria
    local.writeUInt16LE(0x0800, 6);      // nombres en UTF-8
    local.writeUInt16LE(8, 8);           // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);        // creado por
    central.writeUInt16LE(20, 6);        // versión necesaria
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralSize = centrals.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, ...centrals, end]);
}

const files = INCLUDE.flatMap(listFiles).sort();
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, buildZip(files));

console.log(`Paquete creado: ${path.relative(ROOT, OUT)} (${files.length} archivos)`);
for (const f of files) console.log("  " + f.split(path.sep).join("/"));
