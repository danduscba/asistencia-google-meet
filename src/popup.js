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

// ---- Exportar / copiar ----------------------------------------------------

function csvEscape(value) {
  const s = String(value);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(meetings) {
  const rows = [["Reunión", "Código", "Fecha", "Puesto", "Nombre", "Tiempo hablando", "Segundos hablando",
    "% del tiempo de habla", "Minutos presente", "Entrada", "Última vez visto", "Veces que entró"]];
  for (const m of meetings) {
    sortedParticipants(m).forEach(([name, p], i) => {
      rows.push([
        title(m), m.code, new Date(m.start).toLocaleDateString(), i + 1, name,
        clock(speaking(p)), Math.round(speaking(p) / 1000), `${share(m, p)}%`,
        minutes(p.totalMs), fmtTime(p.firstSeen), fmtTime(p.lastSeen), p.intervals.length,
      ]);
    });
  }
  // BOM para que Excel reconozca UTF-8 (acentos y ñ).
  return "﻿" + rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
}

function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = h("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const fileDate = (ts) => new Date(ts).toISOString().slice(0, 10);

let toastTimer;
function toast(text) {
  const el = $("#toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1800);
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
      class: "btn", title: "Descargar como CSV (Excel)",
      onclick: () => download(`asistencia_${m.code}_${fileDate(m.start)}.csv`, toCsv([m])),
    }, icon("download"), "CSV"),
    h("button", {
      class: "btn", title: "Cambiar el nombre de la reunión",
      onclick: () => { renamingId = m.id; expanded.add(m.id); render(); },
    }, icon("edit"), "Renombrar"),
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
  $("#exportAll").disabled = $("#clearAll").disabled = meetings.length === 0;

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

  const exportAll = $("#exportAll");
  exportAll.append(icon("download"), "Exportar todo");
  exportAll.addEventListener("click", async () => {
    const meetings = await getMeetings();
    if (meetings.length) download(`asistencia_meet_${fileDate(Date.now())}.csv`, toCsv(meetings));
  });

  const clearAll = $("#clearAll");
  clearAll.append(icon("trash"), "Borrar historial");
  confirmButton(clearAll, "clearAll", "¿Borrar todo? Clic para confirmar", async () => {
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
