"use strict";

const api = globalThis.browser?.runtime ? globalThis.browser : globalThis.chrome;

// Una reunión se considera "en curso" si se actualizó hace menos de esto.
const LIVE_MS = 15000;

const $ = (sel) => document.querySelector(sel);

// Íconos (trazos de 24x24, estilo lineal).
const ICONS = {
  chevron: '<path d="m6 9 6 6 6-6"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  download: '<path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  open: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
};

function icon(name) {
  const span = document.createElement("span");
  span.style.display = "contents";
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  return span.firstElementChild;
}

// Crea un elemento: h("div", { class: "x", onclick: fn }, hijo1, "texto", ...)
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style") Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  el.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}

// ---- Formato --------------------------------------------------------------

const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtDay = (ts) => new Date(ts).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
const minutes = (ms) => Math.max(1, Math.round(ms / 60000));
const speaking = (p) => p.speakingMs || 0; // registros viejos no tienen este dato

// 75000 -> "1:15", 3725000 -> "1:02:05"
function clock(ms) {
  const s = Math.round(ms / 1000);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return hh ? `${hh}:${String(mm).padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
}

// 45000 -> "45 s", 750000 -> "12 min", 3900000 -> "1 h 5 min"
function human(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`;
}

function title(m) {
  if (m.customTitle) return m.customTitle;
  return m.title && m.title !== m.code ? m.title : `Reunión ${m.code}`;
}

function initials(name) {
  const parts = name.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

// Color estable por nombre.
function avatarColor(name) {
  let hash = 0;
  for (const ch of name.toLowerCase()) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return `hsl(${hash % 360} 55% 48%)`;
}

const isLive = (m) => Date.now() - (m.end ?? 0) < LIVE_MS;

// ---- Datos ----------------------------------------------------------------

async function getMeetings() {
  const { meetings = {} } = await api.storage.local.get("meetings");
  return Object.values(meetings).sort((a, b) => b.start - a.start);
}

async function updateMeeting(id, change) {
  const { meetings = {} } = await api.storage.local.get("meetings");
  if (!meetings[id]) return;
  if (change === null) delete meetings[id];
  else Object.assign(meetings[id], change);
  await api.storage.local.set({ meetings });
}

// Ranking: primero quien más habló; a igual tiempo, quien llegó antes.
function sortedParticipants(meeting) {
  return Object.entries(meeting.participants)
    .sort((a, b) => speaking(b[1]) - speaking(a[1]) || a[1].firstSeen - b[1].firstSeen);
}

function totalSpeaking(meeting) {
  return Object.values(meeting.participants).reduce((sum, p) => sum + speaking(p), 0);
}

function share(meeting, p) {
  const total = totalSpeaking(meeting);
  return total ? Math.round((100 * speaking(p)) / total) : 0;
}

// ---- Exportar -------------------------------------------------------------

// Cada columna tiene un tipo, que define cómo se escribe en Excel y en Sheets.
const COLUMNS = [
  ["Reunión", "text", 28], ["Código", "text", 14], ["Fecha", "date", 11], ["Puesto", "int", 8],
  ["Nombre", "text", 28], ["Tiempo hablando", "duration", 10], ["Segundos hablando", "int", 10],
  ["% del tiempo de habla", "pct", 11], ["Minutos presente", "int", 10], ["Entrada", "time", 9],
  ["Última vez visto", "time", 9], ["Veces que entró", "int", 9],
];

function attendanceRows(meetings) {
  const rows = [];
  for (const m of meetings) {
    sortedParticipants(m).forEach(([name, p], i) => {
      rows.push([
        title(m), m.code, m.start, i + 1, name, speaking(p), Math.round(speaking(p) / 1000),
        share(m, p) / 100, minutes(p.totalMs), p.firstSeen, p.lastSeen, p.intervals.length,
      ]);
    });
  }
  return rows;
}

const pad2 = (n) => String(n).padStart(2, "0");

// Texto que Google Sheets interpreta con el tipo correcto al pegar.
function sheetsText(type, v) {
  const d = new Date(v);
  switch (type) {
    case "date": return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    case "time": return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    case "duration": {
      const s = Math.round(v / 1000);
      return `${Math.floor(s / 3600)}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`;
    }
    case "pct": return `${Math.round(v * 100)}%`;
    default: return String(v);
  }
}

// Copia la tabla (como HTML y como texto con tabulaciones) para pegarla en Sheets.
async function copyForSheets(meetings) {
  const header = COLUMNS.map(([name]) => name);
  const rows = attendanceRows(meetings).map((r) => r.map((v, i) => sheetsText(COLUMNS[i][1], v)));
  const tsv = [header, ...rows].map((r) => r.map((c) => c.replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n");
  const esc = (c) => c.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = "<table><tr>" + header.map((c) => `<td><b>${esc(c)}</b></td>`).join("") + "</tr>" +
    rows.map((r) => "<tr>" + r.map((c) => `<td>${esc(c)}</td>`).join("") + "</tr>").join("") + "</table>";
  try {
    await navigator.clipboard.write([new ClipboardItem({
      "text/plain": new Blob([tsv], { type: "text/plain" }),
      "text/html": new Blob([html], { type: "text/html" }),
    })]);
  } catch {
    await navigator.clipboard.writeText(tsv);
  }
}

async function openInSheets(meetings) {
  await copyForSheets(meetings);
  toast("Copiado. En la hoja nueva, pegá con Ctrl+V", 3000);
  // Dar tiempo a leer el aviso: al abrirse la pestaña, el popup se cierra.
  setTimeout(() => api.tabs.create({ url: "https://sheets.new" }), 1600);
}

// ---- Planilla .xlsx (sin dependencias) -------------------------------------

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Índices de <cellXfs> en styles.xml.
const STYLE = { header: 1, date: 2, duration: 3, time: 4, pct: 5 };

const xmlEscape = (s) => String(s)
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Fecha de Excel: días desde 1899-12-30, en hora local.
const excelDate = (ts) => (ts - new Date(ts).getTimezoneOffset() * 60000) / 86400000 + 25569;

function xlsxCell(type, v, ref) {
  switch (type) {
    case "text": return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(v)}</t></is></c>`;
    case "int": return `<c r="${ref}"><v>${v}</v></c>`;
    case "pct": return `<c r="${ref}" s="${STYLE.pct}"><v>${v}</v></c>`;
    case "duration": return `<c r="${ref}" s="${STYLE.duration}"><v>${v / 86400000}</v></c>`;
    default: return `<c r="${ref}" s="${STYLE[type]}"><v>${excelDate(v)}</v></c>`;
  }
}

function sheetXml(meetings) {
  const col = (i) => String.fromCharCode(65 + i); // alcanza para hasta 26 columnas
  const rows = attendanceRows(meetings);
  const header = `<row r="1">${COLUMNS.map(([name], i) =>
    `<c r="${col(i)}1" t="inlineStr" s="${STYLE.header}"><is><t>${xmlEscape(name)}</t></is></c>`).join("")}</row>`;
  const body = rows.map((r, n) =>
    `<row r="${n + 2}">${r.map((v, i) => xlsxCell(COLUMNS[i][1], v, `${col(i)}${n + 2}`)).join("")}</row>`).join("");
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<cols>${COLUMNS.map(([, , w], i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` +
    `<sheetData>${header}${body}</sheetData>` +
    `<autoFilter ref="A1:${col(COLUMNS.length - 1)}${rows.length + 1}"/></worksheet>`;
}

const XLSX_PARTS = {
  "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    "</Types>",
  "_rels/.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    "</Relationships>",
  "xl/workbook.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="Asistencia" sheetId="1" r:id="rId1"/></sheets></workbook>',
  "xl/_rels/workbook.xml.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    "</Relationships>",
  "xl/styles.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="2"><numFmt numFmtId="164" formatCode="[h]:mm:ss"/><numFmt numFmtId="165" formatCode="hh:mm"/></numFmts>' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFECEBFD"/></patternFill></fill></fills>' +
    '<borders count="1"><border/></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
    '<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    "</styleSheet>",
};

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ZIP sin compresión: alcanza para planillas chicas y evita dependencias.
function zip(files, type) {
  const enc = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [path, text] of Object.entries(files)) {
    const name = enc.encode(path);
    const data = enc.encode(text);
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);       // versión necesaria
    local.setUint16(6, 0x0800, true);   // nombres en UTF-8
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    locals.push(local, name, data);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);     // creado por
    central.setUint16(6, 20, true);     // versión necesaria
    central.setUint16(8, 0x0800, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, data.length, true);
    central.setUint16(28, name.length, true);
    central.setUint32(42, offset, true);
    centrals.push(central, name);

    offset += 30 + name.length + data.length;
  }

  const count = centrals.length / 2;
  const centralSize = centrals.reduce((s, b) => s + b.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, count, true);
  end.setUint16(10, count, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...locals, ...centrals, end], { type });
}

const toXlsx = (meetings) => zip({ ...XLSX_PARTS, "xl/worksheets/sheet1.xml": sheetXml(meetings) }, XLSX_TYPE);

function download(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const fileDate = (ts) => new Date(ts).toISOString().slice(0, 10);

let toastTimer;
function toast(text, ms = 1800) {
  const el = $("#toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}

// Botón que pide un segundo clic para confirmar (window.confirm no funciona
// en los popups de Firefox). El estado se guarda por `key` para que sobreviva
// a los redibujados que ocurren durante una reunión en curso.
const CONFIRM_MS = 4000;
let pendingConfirm = { key: null, until: 0 };

function confirmButton(btn, key, question, onConfirm) {
  const original = [...btn.childNodes];
  const setConfirming = (on) => {
    btn.classList.toggle("confirming", on);
    btn.replaceChildren(...(on ? [question] : original));
  };
  const remaining = pendingConfirm.key === key ? pendingConfirm.until - Date.now() : 0;
  if (remaining > 0) {
    setConfirming(true);
    setTimeout(() => btn.isConnected && setConfirming(false), remaining);
  }

  btn.addEventListener("click", async () => {
    if (!btn.classList.contains("confirming")) {
      pendingConfirm = { key, until: Date.now() + CONFIRM_MS };
      setConfirming(true);
      setTimeout(() => btn.isConnected && setConfirming(false), CONFIRM_MS);
      return;
    }
    pendingConfirm = { key: null, until: 0 };
    setConfirming(false);
    await onConfirm();
  });
}

// ---- Interfaz -------------------------------------------------------------

const expanded = new Set(); // ids de reuniones abiertas
let firstRender = true;
let renamingId = null;

function personRow(meeting, [name, p], i, live) {
  const talking = live && meeting.speakingNow?.includes(name);
  const pct = share(meeting, p);
  return h("li", { class: "person" },
    h("span", { class: "rank" }, String(i + 1)),
    h("span", {
      class: `avatar${talking ? " speaking" : ""}`,
      style: { background: avatarColor(name) },
      title: talking ? "Hablando ahora" : undefined,
    }, initials(name)),
    h("div", { class: "person-main" },
      h("div", { class: "person-name", title: name }, name),
      h("div", { class: "bar", title: `${pct}% del tiempo total de habla` },
        h("span", { style: { width: `${pct}%` } }))),
    h("div", { class: "person-stats" },
      h("div", { class: "talk", title: "Tiempo hablando" }, clock(speaking(p)), h("small", {}, `${pct}%`)),
      h("div", { class: "presence", title: `Entró a las ${fmtTime(p.firstSeen)}` },
        `presente ${human(p.totalMs || 0)}`)),
  );
}

function meetingCard(m) {
  const live = isLive(m);
  const people = sortedParticipants(m);
  const top = people[0] && speaking(people[0][1]) > 0 ? people[0][0] : null;
  const open = expanded.has(m.id);
  const meta = live
    ? `Desde las ${fmtTime(m.start)} · ${people.length} ${people.length === 1 ? "persona" : "personas"}`
    : `${fmtDay(m.start)} · ${fmtTime(m.start)}–${fmtTime(m.end ?? m.start)} · ${people.length} ${people.length === 1 ? "persona" : "personas"}`;

  const body = h("div", { class: "card-body", hidden: !open },
    people.length
      ? h("ul", { class: "people" }, people.map((entry, i) => personRow(m, entry, i, live)))
      : h("p", { class: "no-people" }, "Sin participantes registrados."));

  if (renamingId === m.id) {
    const input = h("input", { type: "text", value: title(m), maxlength: "80", "aria-label": "Nombre de la reunión" });
    const save = async () => {
      renamingId = null;
      await updateMeeting(m.id, { customTitle: input.value.trim() || undefined });
      render();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") save();
      if (e.key === "Escape") { renamingId = null; render(); }
    });
    body.append(h("div", { class: "rename" }, input,
      h("button", { class: "btn btn-primary", onclick: save }, icon("check"), "Guardar")));
    requestAnimationFrame(() => { input.focus(); input.select(); });
  }

  const del = h("button", { class: "btn btn-danger", title: "Eliminar esta reunión", "aria-label": "Eliminar esta reunión" }, icon("trash"));
  confirmButton(del, `delete:${m.id}`, "¿Eliminar?", async () => {
    expanded.delete(m.id);
    await updateMeeting(m.id, null);
    toast("Reunión eliminada");
  });

  body.append(h("div", { class: "actions" },
    h("button", {
      class: "btn", title: "Copiar la lista de nombres",
      onclick: async () => {
        await navigator.clipboard.writeText(people.map(([n]) => n).join("\n"));
        toast(`${people.length} nombres copiados`);
      },
    }, icon("copy"), "Copiar"),
    h("button", {
      class: "btn", title: "Descargar una planilla de Excel",
      onclick: () => download(`asistencia_${m.code}_${fileDate(m.start)}.xlsx`, toXlsx([m])),
    }, icon("download"), "Excel"),
    h("button", {
      class: "btn", title: "Abrir en una hoja nueva de Google Sheets",
      onclick: () => openInSheets([m]),
    }, icon("open"), "Sheets"),
    h("button", {
      class: "btn", title: "Cambiar el nombre de la reunión", "aria-label": "Cambiar el nombre de la reunión",
      onclick: () => { renamingId = m.id; expanded.add(m.id); render(); },
    }, icon("edit")),
    h("span", { class: "spacer" }),
    del));

  const head = h("button", {
    class: "card-head",
    "aria-expanded": String(open),
    onclick: () => {
      if (expanded.has(m.id)) expanded.delete(m.id); else expanded.add(m.id);
      render();
    },
  },
    h("div", { class: "card-info" },
      h("div", { class: "card-title", title: title(m) }, title(m)),
      h("div", { class: "card-meta" }, meta)),
    live && m.speakingNow?.length
      ? h("span", { class: "chip live", title: "Hablando ahora" }, icon("mic"), m.speakingNow[0])
      : top && h("span", { class: "chip", title: "Quien más habló" }, icon("mic"), top),
    icon("chevron"));
  head.lastElementChild.classList.add("chev");

  return h("section", { class: `card${live ? " is-live" : ""}` }, head, body);
}

function emptyState(enabled) {
  return h("div", { class: "empty" },
    h("img", { src: "../icons/icon-48.png", alt: "", width: "48", height: "48" }),
    h("h2", {}, "Todavía no hay reuniones"),
    h("p", {}, enabled ? "El registro es automático. Para empezar:" : "El registro está pausado. Activalo con el interruptor de arriba."),
    enabled && h("ol", {},
      h("li", {}, "Abrí una reunión de Google Meet."),
      h("li", {}, "Hacé clic en “Unirse ahora”."),
      h("li", {}, "Volvé acá: vas a ver quién participa y cuánto habla cada uno.")));
}

function renderStatus(live, enabled) {
  const el = $("#status");
  el.className = "status";
  if (!enabled) {
    el.replaceChildren(h("span", { class: "dot" }), "Registro pausado");
  } else if (live) {
    el.classList.add("live");
    el.replaceChildren(h("span", { class: "dot" }), `Registrando · ${title(live)}`);
  } else {
    el.replaceChildren("Esperando una reunión de Meet");
  }
}

async function render() {
  // No redibujar mientras se escribe un nombre: se perdería lo tipeado.
  if (document.activeElement?.matches(".rename input") && renamingId) return;

  const [meetings, { enabled = true }] = await Promise.all([getMeetings(), api.storage.local.get("enabled")]);
  const live = enabled ? meetings.find(isLive) : null;

  if (firstRender && meetings.length) {
    expanded.add((live ?? meetings[0]).id);
    firstRender = false;
  }

  renderStatus(live, enabled);
  for (const id of ["#excelAll", "#sheetsAll", "#clearAll"]) $(id).disabled = meetings.length === 0;

  const main = $("#content");
  const scroll = main.scrollTop;
  if (meetings.length === 0) {
    main.replaceChildren(emptyState(enabled));
    return;
  }

  const history = meetings.filter((m) => m !== live);
  const sections = [];
  if (live) sections.push(h("h2", { class: "section-title" }, "En curso"), meetingCard(live));
  if (history.length) {
    sections.push(h("h2", { class: "section-title" }, `Historial (${history.length})`), ...history.map(meetingCard));
  }
  main.replaceChildren(...sections);
  main.scrollTop = scroll;
}

async function init() {
  const { enabled = true } = await api.storage.local.get("enabled");
  const toggle = $("#enabled");
  toggle.checked = enabled;
  toggle.addEventListener("change", async () => {
    await api.storage.local.set({ enabled: toggle.checked });
    toast(toggle.checked ? "Registro activado" : "Registro pausado");
  });

  $("#excelAll").addEventListener("click", async () => {
    const meetings = await getMeetings();
    if (meetings.length) download(`asistencia_meet_${fileDate(Date.now())}.xlsx`, toXlsx(meetings));
  });
  $("#sheetsAll").addEventListener("click", async () => {
    const meetings = await getMeetings();
    if (meetings.length) openInSheets(meetings);
  });

  const clearAll = $("#clearAll");
  clearAll.append(icon("trash"), "Borrar historial");
  confirmButton(clearAll, "clearAll", "¿Borrar todo?", async () => {
    await api.storage.local.set({ meetings: {} });
    expanded.clear();
    toast("Historial borrado");
  });

  api.storage.onChanged.addListener((changes, area) => {
    if (area === "local") render();
  });

  // Actualizar el estado "en curso" aunque no lleguen cambios.
  setInterval(render, 5000);
  render();
}

init();
