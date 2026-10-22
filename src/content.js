// Content script: se ejecuta dentro de meet.google.com, detecta participantes
// y mide cuánto tiempo habla cada uno.
(() => {
  "use strict";

  // En Firefox existe `browser`; en Chrome/Edge solo `chrome`. Se valida
  // `runtime` porque un elemento con id="browser" también crearía window.browser.
  const api = globalThis.browser?.runtime ? globalThis.browser : globalThis.chrome;
  const log = (...args) => console.log("[Asistencia para Google Meet]", ...args);

  // Cada cuánto se revisa la lista de participantes y se guarda (ms).
  const TICK_MS = 3000;
  // Cada cuánto se revisa quién está hablando (ms).
  const SPEAK_TICK_MS = 250;
  // Tras detectar voz, se sigue contando este tiempo para cubrir las pausas
  // naturales entre palabras.
  const SPEAK_HANGOVER_MS = 1000;
  // Si alguien desaparece menos de este tiempo, se considera la misma presencia
  // (Meet a veces oculta mosaicos momentáneamente al reorganizar la grilla).
  const GAP_TOLERANCE_MS = 20000;

  // Código de reunión de Meet: abc-defg-hij. Puede venir como /abc-defg-hij
  // o con prefijo, por ejemplo /meet/abc-defg-hij.
  const MEETING_CODE_RE = /\/([a-z]{3}-[a-z]{4}-[a-z]{3})(?:$|[/?#])/i;

  // Selectores del DOM de Meet. Google cambia sus clases con frecuencia; si la
  // extensión deja de funcionar, este es el lugar a ajustar.
  const SELECTORS = {
    // Mosaicos de video y filas del panel "Personas".
    participant: "[data-participant-id]",
    // Filas del panel "Personas" (el nombre está en aria-label).
    panelItem: '[role="listitem"][aria-label]',
    // Nombres dentro de un mosaico (Meet los marca para que no se traduzcan).
    nameInTile: ".notranslate",
    // Nombre del usuario propio.
    selfName: "[data-self-name]",
    // Indicador de "está hablando" dentro de un mosaico (clases ofuscadas,
    // detectadas con diagnostico/prueba-habla.js).
    speaking: ".kssMZb, .sxlEM",
  };

  const ICON_RE = /^[a-z_]+$/; // sin flag "i": "mic_off" es ícono, "Fernando" no
  const NOISE_RE = /^(tú|you|vous|você|du)$|^\(.*\)$/i;
  // Sufijos que Meet agrega al nombre.
  const SUFFIX_RE = /\s*\((tú|you|vous|você|du|anfitrión|host|coanfitrión|co-host)\)\s*$/i;
  // Mosaicos de presentación: "Presentación de Ana", "Ana (presentando)", etc.
  const PRESENTING_RE = /^(presentación de|presentando:?|.*\bpresenting\b:?)\s*/i;

  let session = null;       // reunión en curso
  let lastSaved = "";
  // data-participant-id -> nombre, para no confundir el nombre con textos de
  // botones que aparecen al pasar el mouse ("Reencuadrar", "Fijar", etc.).
  const nameById = new Map();
  const lastSpokeAt = new Map(); // nombre -> última vez que se detectó su voz
  let lastSpeakTick = 0;

  function meetingCode() {
    const m = location.pathname.match(MEETING_CODE_RE);
    return m ? m[1].toLowerCase() : null;
  }

  function cleanName(raw) {
    if (!raw) return null;
    let name = raw.replace(/\s+/g, " ").trim();
    name = name.replace(SUFFIX_RE, "").replace(PRESENTING_RE, "").trim();
    if (!name || name.length > 80 || ICON_RE.test(name) || NOISE_RE.test(name)) return null;
    return name;
  }

  // Devuelve { name, sure }: `sure` indica que vino de una fuente confiable y
  // puede recordarse para ese participante.
  function readTileName(el) {
    // 1) Atributo explícito del usuario propio.
    const self = el.matches(SELECTORS.selfName) ? el : el.querySelector(SELECTORS.selfName);
    if (self) {
      const n = cleanName(self.getAttribute("data-self-name"));
      if (n) return { name: n, sure: true };
    }
    // 2) Fila del panel "Personas".
    if (el.matches(SELECTORS.panelItem)) {
      const n = cleanName(el.getAttribute("aria-label"));
      if (n) return { name: n, sure: true };
    }
    // 3) Textos "hoja" marcados como "notranslate" (los botones de la interfaz
    //    sí se traducen, así que no llevan esa marca).
    for (const node of el.querySelectorAll(SELECTORS.nameInTile)) {
      if (node.children.length) continue;
      const n = cleanName(node.textContent);
      if (n) return { name: n, sure: true };
    }
    // 4) Texto visible: Meet muestra el nombre dos veces en el mosaico, así que
    //    una línea repetida es casi seguro el nombre.
    const lines = (el.innerText || "").split("\n").map(cleanName).filter(Boolean);
    const repeated = lines.find((l, i) => lines.indexOf(l) !== i);
    if (repeated) return { name: repeated, sure: true };
    // 5) Último recurso: primera línea que parezca un nombre.
    return lines.length ? { name: lines[0], sure: false } : null;
  }

  function nameFor(el) {
    const id = el.getAttribute("data-participant-id");
    if (id && nameById.has(id)) return nameById.get(id);
    const found = readTileName(el);
    if (!found) return null;
    if (id && found.sure) nameById.set(id, found.name);
    return found.name;
  }

  function detectParticipants() {
    const names = new Set();

    for (const el of document.querySelectorAll(SELECTORS.participant)) {
      const n = nameFor(el);
      if (n) names.add(n);
    }

    // Panel "Personas" abierto: lista completa (más confiable en reuniones grandes).
    for (const el of document.querySelectorAll(SELECTORS.panelItem)) {
      if (!el.closest('[role="list"]')) continue;
      if (!el.querySelector("img")) continue; // las filas de personas tienen avatar
      const n = cleanName(el.getAttribute("aria-label"));
      if (n) names.add(n);
    }

    return names;
  }

  function startSession(code) {
    const now = Date.now();
    session = {
      id: `${code}_${now}`,
      code,
      title: document.title.replace(/^Meet\s*[-–]\s*/i, "").trim() || code,
      start: now,
      end: null,
      // nombre -> { firstSeen, lastSeen, totalMs, speakingMs, intervals: [[desde, hasta], ...] }
      participants: {},
    };
    nameById.clear();
    lastSpokeAt.clear();
  }

  function participant(name, now) {
    return (session.participants[name] ??= {
      firstSeen: now, lastSeen: now, totalMs: 0, speakingMs: 0, intervals: [[now, now]],
    });
  }

  function updatePresence(names) {
    const now = Date.now();
    for (const name of names) {
      const isNew = !session.participants[name];
      const p = participant(name, now);
      if (isNew) {
        log("Participante nuevo:", name);
        continue;
      }
      const last = p.intervals[p.intervals.length - 1];
      if (now - last[1] <= GAP_TOLERANCE_MS) {
        p.totalMs += now - last[1];
        last[1] = now;
      } else {
        p.intervals.push([now, now]);
      }
      p.lastSeen = now;
    }
    session.end = now;
  }

  function speakTick() {
    const now = Date.now();
    // Si la pestaña estuvo en segundo plano, el navegador frena los timers:
    // no sumar más de lo razonable entre dos muestras.
    const elapsed = Math.min(now - lastSpeakTick, 1000);
    lastSpeakTick = now;
    if (!session) return;

    for (const el of document.querySelectorAll(SELECTORS.participant)) {
      // El indicador puede estar en el propio mosaico o en un elemento interno.
      if (!el.matches(SELECTORS.speaking) && !el.querySelector(SELECTORS.speaking)) continue;
      const n = nameFor(el);
      if (!n) continue;
      if (now - (lastSpokeAt.get(n) ?? 0) > 5000) log("Hablando:", n);
      lastSpokeAt.set(n, now);
    }

    for (const [name, at] of lastSpokeAt) {
      if (now - at > SPEAK_HANGOVER_MS) continue;
      participant(name, now).speakingMs += elapsed;
    }
  }

  async function save() {
    if (!session) return;
    const serialized = JSON.stringify(session);
    if (serialized === lastSaved) return;
    lastSaved = serialized;
    try {
      const { meetings = {} } = await api.storage.local.get("meetings");
      // Conservar el nombre que el usuario le haya puesto desde el popup.
      const customTitle = meetings[session.id]?.customTitle;
      meetings[session.id] = customTitle ? { ...session, customTitle } : session;
      await api.storage.local.set({ meetings });
    } catch (e) {
      // El contexto de la extensión puede invalidarse al recargarla.
      console.warn("[Asistencia para Google Meet] No se pudo guardar:", e);
    }
  }

  async function isEnabled() {
    try {
      const { enabled = true } = await api.storage.local.get("enabled");
      return enabled;
    } catch {
      return false;
    }
  }

  async function tick() {
    const code = meetingCode();

    // Cambió de reunión o salió de ella: cerrar la sesión actual.
    if (session && session.code !== code) {
      await save();
      session = null;
    }
    if (!code || !(await isEnabled())) {
      if (session) { await save(); session = null; }
      return;
    }

    const names = detectParticipants();
    // Aún en la sala de espera (sin mosaicos): no registrar nada.
    if (names.size === 0) return;

    if (!session) {
      startSession(code);
      log("Reunión detectada:", code);
    }
    updatePresence(names);
    // Quién está hablando ahora, para mostrarlo en vivo en el popup.
    const now = Date.now();
    session.speakingNow = [...lastSpokeAt]
      .filter(([, at]) => now - at <= SPEAK_HANGOVER_MS + TICK_MS)
      .map(([name]) => name);
    await save();
  }

  log("Cargada en", location.href);
  lastSpeakTick = Date.now();
  setInterval(speakTick, SPEAK_TICK_MS);
  setInterval(() => tick().catch((e) => console.error("[Asistencia para Google Meet]", e)), TICK_MS);
  window.addEventListener("pagehide", () => { save(); });
})();
