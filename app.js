/* =============================================================
   Estadística de Supervisores — Lógica del supervisor
   -------------------------------------------------------------
   - Mesas de cantidad variable.
   - Totales (Capital / Propina) en vivo.
   - Guardado real en la nube con cola de reintento (outbox).
   ============================================================= */
(function () {
  "use strict";

  const KEY_DRAFT = "sup:v1:draft";
  const KEY_DEVICE = "sup:v1:device";
  const KEY_OUTBOX = "sup:v1:outbox";
  const KEY_THEME = "sup:v1:theme";

  const $ = (sel, root = document) => (root || document).querySelector(sel);

  /* ---------- Utilidades ---------- */
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function getDeviceId() {
    let id = localStorage.getItem(KEY_DEVICE);
    if (!id) {
      id = uuid();
      localStorage.setItem(KEY_DEVICE, id);
    }
    return id;
  }

  function todayDate() {
    const d = new Date();
    return (
      d.getFullYear() +
      "-" + String(d.getMonth() + 1).padStart(2, "0") +
      "-" + String(d.getDate()).padStart(2, "0")
    );
  }

  function nowTime() {
    const d = new Date();
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  function num(v) {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  }

  /* ---------- Fecha de actividad (corte fijo 06:00) ---------- */
  function computeActivityDate(reportDateStr, timeStr) {
    if (!reportDateStr || !/^\d{4}-\d{2}-\d{2}$/.test(reportDateStr)) {
      return reportDateStr || "";
    }
    const t = (timeStr || "").trim();
    const hh = parseInt(t.slice(0, 2), 10);
    const hasValidHour = !Number.isNaN(hh);
    if (!hasValidHour || hh < 6) {
      const d = new Date(reportDateStr + "T00:00:00");
      d.setDate(d.getDate() - 1);
      return (
        d.getFullYear() +
        "-" + String(d.getMonth() + 1).padStart(2, "0") +
        "-" + String(d.getDate()).padStart(2, "0")
      );
    }
    return reportDateStr;
  }

  function fmt(n) {
    return num(n).toLocaleString("es-AR", { maximumFractionDigits: 2 });
  }

  function intVal(sel) {
    const raw = String($(sel).value || "").trim();
    if (raw === "") return null;
    const x = Number(raw);
    return Number.isFinite(x) ? Math.round(x) : null;
  }

  /* ---------- Formato de importes (separador de miles) ---------- */
  function digitsOnly(v) {
    return String(v).replace(/\D/g, "");
  }
  function trimLeadingZeros(d) {
    return d.replace(/^0+(?=\d)/, "");
  }
  function fmtThousands(digits) {
    const d = trimLeadingZeros(digitsOnly(digits));
    if (!d) return "";
    return d.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }
  function keepCaretEnd(input) {
    if (document.activeElement === input) {
      try { input.setSelectionRange(input.value.length, input.value.length); } catch (e) { /* no-op */ }
    }
  }
  function formatMoneyInput(input, allowNegative) {
    const v = String(input.value || "").trim();
    const neg = allowNegative && v.startsWith("-");
    const d = trimLeadingZeros(digitsOnly(v)).slice(0, 12);
    input.value = (neg ? "-" : "") + fmtThousands(d);
    keepCaretEnd(input);
  }
  function moneyOf(input) {
    const v = String(input.value || "").trim();
    if (v === "" || v === "-") return 0;
    const neg = v.startsWith("-");
    const d = digitsOnly(v);
    if (!d) return 0;
    const n = parseInt(d, 10);
    return Number.isFinite(n) ? (neg ? -n : n) : 0;
  }

  /* ---------- Mesas (el DOM es la fuente de verdad) ---------- */
  const mesasEl = $("#mesas");

  function makeInput(field, label, value, extraClass) {
    const input = document.createElement("input");
    input.className = "mesa-input" + (extraClass ? " " + extraClass : "");
    input.setAttribute("data-field", field);
    input.setAttribute("aria-label", label);
    if (field === "n") {
      input.type = "number";
      input.inputMode = "numeric";
      input.min = "0";
      input.step = "1";
      input.placeholder = "0";
      if (value !== undefined && value !== null && value !== "") input.value = value;
      return input;
    }
    // Importes: campo de texto con separador de miles (teclado numérico).
    input.type = "text";
    input.inputMode = "numeric";
    input.autocomplete = "off";
    input.maxLength = 16;
    input.placeholder = "0";
    const raw = value === undefined || value === null ? "" : String(value).trim();
    const allowNeg = field === "propina";
    const neg = allowNeg && raw.startsWith("-");
    input.value = (neg ? "-" : "") + fmtThousands(raw).slice(0, 16);
    return input;
  }

  function addMesa(data) {
    const d = data || {};
    const row = document.createElement("div");
    row.className = "mesa-row";

    row.appendChild(makeInput("n", "Mesa", d.n !== undefined ? d.n : ""));
    row.appendChild(makeInput("ganancia", "Ganancia", d.ganancia));
    row.appendChild(makeInput("perdida", "Pérdida", d.perdida));
    row.appendChild(makeInput("propina", "Propina", d.propina));

    const del = document.createElement("button");
    del.type = "button";
    del.className = "row-del";
    del.title = "Quitar mesa";
    del.setAttribute("aria-label", "Quitar mesa");
    del.textContent = "✕";
    del.addEventListener("click", () => {
      row.remove();
      afterRowsChange();
    });
    row.appendChild(del);

    mesasEl.appendChild(row);
    afterRowsChange();
    return row;
  }

  function clearMesas() {
    mesasEl.innerHTML = "";
  }

  function rowList() {
    return Array.prototype.slice.call(mesasEl.querySelectorAll(".mesa-row"));
  }

  function readRows() {
    return rowList().map((row, i) => {
      const get = (f) => row.querySelector(`[data-field="${f}"]`);
      const n = parseInt(get("n").value, 10);
      return {
        n: Number.isFinite(n) && n > 0 ? n : i + 1,
        ganancia: moneyOf(get("ganancia")),
        perdida: moneyOf(get("perdida")),
        propina: moneyOf(get("propina"))
      };
    });
  }

  function rawRows() {
    return rowList().map((row) => {
      const get = (f) => row.querySelector(`[data-field="${f}"]`).value;
      return { n: get("n"), ganancia: get("ganancia"), perdida: get("perdida"), propina: get("propina") };
    });
  }

  function hasNegative() {
    return rowList().some((row) =>
      ["ganancia", "perdida", "propina"].some((f) => moneyOf(row.querySelector(`[data-field="${f}"]`)) < 0)
    );
  }

  /* Verificación en vivo de la caja de empleados (propina) */
  function negativePropinaRows() {
    const out = [];
    rowList().forEach((row, idx) => {
      if (moneyOf(row.querySelector('[data-field="propina"]')) < 0) out.push({ row, idx: idx + 1 });
    });
    return out;
  }

  function updateMoneyErrors() {
    rowList().forEach((row) => {
      const input = row.querySelector('[data-field="propina"]');
      const neg = moneyOf(input) < 0;
      input.classList.toggle("input-err", neg);
      if (neg) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    });
    const list = negativePropinaRows().map((x) => x.idx);
    const msgEl = $("#mesasError");
    if (!msgEl) return;
    if (list.length === 1) {
      msgEl.textContent = "Mesa " + list[0] + " · Caja de empleados: el importe no puede ser negativo.";
    } else if (list.length > 1) {
      msgEl.textContent = "Mesas " + list.join(", ") + " · Caja de empleados: los importes no pueden ser negativos.";
    } else {
      msgEl.textContent = "";
    }
    msgEl.hidden = list.length === 0;
  }

  function afterRowsChange() {
    $("#mesasEmpty").hidden = rowList().length > 0;
    renderTotals();
    updateMoneyErrors();
    saveDraft();
  }

  /* ---------- Totales ---------- */
  function totalsOf(list) {
    let g = 0, p = 0, pr = 0;
    for (const r of list) {
      g += num(r.ganancia);
      p += num(r.perdida);
      pr += num(r.propina);
    }
    return { g, p, capital: g - p, propina: pr };
  }

  function renderTotals() {
    const t = totalsOf(readRows());
    $("#tGanancia").textContent = fmt(t.g);
    $("#tPerdida").textContent = fmt(t.p);
    $("#tPropina").textContent = fmt(t.propina);
    $("#tCapital").textContent = fmt(t.capital);
    const wrap = $("#capitalWrap");
    wrap.classList.toggle("pos", t.capital > 0);
    wrap.classList.toggle("neg", t.capital < 0);
  }

  function syncActivityDate() {
    const activityEl = $("#activityDate");
    if (!activityEl) return;
    const fecha = $("#fecha").value;
    const hora = $("#hora").value;
    activityEl.value = computeActivityDate(fecha, hora);
  }

  /* ---------- Borrador (para no perder datos al recargar) ---------- */
  function saveDraft() {
    try {
      const draft = {
        fecha: $("#fecha").value,
        hora: $("#hora").value,
        activity_date: $("#activityDate") ? $("#activityDate").value : undefined,
        sector: $("#sector").value,
        turno: $("#turno").value,
        legajo: $("#legajo").value,
        notas: $("#notas").value,
        mesas: rawRows()
      };
      localStorage.setItem(KEY_DRAFT, JSON.stringify(draft));
    } catch (e) {
      /* ignorar */
    }
  }

  function clearDraft() {
    localStorage.removeItem(KEY_DRAFT);
  }

  function loadDraft() {
    let d = null;
    try {
      d = JSON.parse(localStorage.getItem(KEY_DRAFT));
    } catch (e) {
      d = null;
    }
    if (!d || typeof d !== "object") return false;
    if (d.fecha) $("#fecha").value = d.fecha;
    if (d.hora) $("#hora").value = d.hora;
    if (d.activity_date !== undefined) {
      const act = $("#activityDate");
      if (act) act.value = d.activity_date;
    } else {
      syncActivityDate();
    }
    if (d.sector !== undefined) $("#sector").value = d.sector;
    if (d.turno !== undefined) $("#turno").value = d.turno;
    if (d.legajo !== undefined) $("#legajo").value = d.legajo;
    if (d.notas !== undefined) $("#notas").value = d.notas;
    clearMesas();
    const list = Array.isArray(d.mesas) ? d.mesas : [];
    if (list.length) list.forEach((m) => addMesa(m));
    else addMesa();
    return true;
  }

  /* ---------- Validación + payload ---------- */
  function validate() {
    const sector = intVal("#sector");
    if (sector === null || sector < 0) return { msg: "Completá el Sector.", sel: "#sector" };
    const turno = intVal("#turno");
    if (turno === null || turno < 0) return { msg: "Completá el Turno.", sel: "#turno" };
    const legajo = intVal("#legajo");
    if (legajo === null || legajo < 0) return { msg: "Completá el Legajo.", sel: "#legajo" };

    if (!rowList().length) return { msg: "Agregá al menos una mesa." };

    // Verificación de la caja de empleados (propina): no puede ser negativa.
    const bad = negativePropinaRows();
    if (bad.length) {
      updateMoneyErrors();
      const input = bad[0].row.querySelector('[data-field="propina"]');
      return { msg: `Mesa ${bad[0].idx} · Caja de empleados: el importe no puede ser negativo.`, sel: input };
    }

    if (hasNegative()) return { msg: "Los importes no pueden ser negativos." };

    const rows = readRows();
    const conDatos = rows.filter((r) => r.ganancia || r.perdida || r.propina);
    if (!conDatos.length) return { msg: "Cargá al menos un importe en las mesas." };

    return null;
  }

  function payloadRows() {
    return readRows()
      .filter((r) => r.ganancia || r.perdida || r.propina)
      .map((r) => ({
        n: Math.round(r.n),
        ganancia: Math.round(r.ganancia),
        perdida: Math.round(r.perdida),
        propina: Math.round(r.propina)
      }));
  }

  function buildPayload() {
    const list = payloadRows();
    const t = totalsOf(list);
    const hora = ($("#hora").value || nowTime()).slice(0, 5);
    const reportDate = $("#fecha").value || todayDate();
    const horaFull = $("#hora").value || nowTime();
    const activityDate = (function() {
      const act = $("#activityDate");
      if (act && act.value) return act.value;
      return computeActivityDate(reportDate, horaFull);
    })();
    return {
      id: uuid(),
      report_date: reportDate,
      hora: hora + ":00",
      activity_date: activityDate,
      sector: intVal("#sector"),
      turno: intVal("#turno"),
      legajo: intVal("#legajo"),
      device_id: getDeviceId(),
      mesas: list,
      total_ganancia: Math.round(t.g),
      total_perdida: Math.round(t.p),
      total_capital: Math.round(t.capital),
      total_propina: Math.round(t.propina),
      notas: ($("#notas").value || "").trim() || null
    };
  }

  /* ---------- Guardado ---------- */
  async function save() {
    const err = validate();
    if (err) {
      toast(err.msg, "warn");
      if (err.sel) {
        if (typeof err.sel === "string") { const el = $(err.sel); if (el) el.focus(); }
        else err.sel.focus();
      }
      return;
    }

    const payload = buildPayload();
    const ok = await confirmDialog(
      "Guardar parte",
      `${payload.mesas.length} mesa(s) · Capital ${fmt(payload.total_capital)} · Propina ${fmt(payload.total_propina)}`
    );
    if (!ok) return;

    const list = outboxGet();
    list.push({
      id: payload.id || uuid(),
      payload: payload,
      attempts: 0,
      lastError: null,
      status: "pending"
    });
    outboxSet(list);

    clearDraft();
    resetAfterSave(payload);
    showSaved(payload);
    flushOutbox();
  }

  function resetAfterSave() {
    // Mantenemos sector / turno / legajo / fecha; limpiamos mesas y notas.
    $("#hora").value = nowTime();
    $("#notas").value = "";
    clearMesas();
    addMesa();
    syncActivityDate();
    saveDraft();
  }

  function showSaved(p) {
    $("#okBody").innerHTML = `
      <div class="ok-row"><span>Mesas</span><b>${p.mesas.length}</b></div>
      <div class="ok-row"><span>Ganancia</span><b>${fmt(p.total_ganancia)}</b></div>
      <div class="ok-row"><span>Pérdida</span><b>${fmt(p.total_perdida)}</b></div>
      <div class="ok-row"><span>Capital</span><b>${fmt(p.total_capital)}</b></div>
      <div class="ok-row"><span>Propina</span><b>${fmt(p.total_propina)}</b></div>
    `;
    openModal("#okModal");
  }

  async function clearForm() {
    const ok = await confirmDialog("Limpiar planilla", "Se vaciarán los datos cargados SIN guardar. ¿Continuar?");
    if (!ok) return;
    clearDraft();
    $("#fecha").value = todayDate();
    $("#hora").value = nowTime();
    const act = $("#activityDate");
    if (act) act.value = computeActivityDate(todayDate(), nowTime());
    $("#sector").value = "";
    $("#turno").value = "";
    $("#legajo").value = "";
    $("#notas").value = "";
    clearMesas();
    addMesa();
    saveDraft();
    toast("Planilla limpia.");
  }

  /* ---------- Cola de subida (outbox) ---------- */
  // Cada ítem: { id, payload, attempts, lastError, status: "pending" | "failed" }.
  // El id viaja como PK del parte: reintentar es idempotente (un 409 = ya subido).
  const RETRY_BASE_MS = 15000;
  const RETRY_MAX_MS = 5 * 60 * 1000;
  let flushing = false;
  let flushAgain = false;
  let retryTimer = null;

  function outboxGet() {
    let raw;
    try {
      raw = JSON.parse(localStorage.getItem(KEY_OUTBOX)) || [];
    } catch (e) {
      return [];
    }
    if (!Array.isArray(raw)) return [];
    // Migra entradas viejas (payload suelto) y les fija un id estable.
    let migrated = false;
    const list = raw.map((entry) => {
      if (entry && entry.payload) return entry;
      migrated = true;
      const payload = entry || {};
      return {
        id: payload.id || uuid(),
        payload: payload,
        attempts: 0,
        lastError: null,
        status: "pending"
      };
    });
    if (migrated) {
      try {
        localStorage.setItem(KEY_OUTBOX, JSON.stringify(list));
      } catch (e) {
        /* sin espacio: seguimos con la copia en memoria */
      }
    }
    return list;
  }

  function outboxSet(v) {
    localStorage.setItem(KEY_OUTBOX, JSON.stringify(v));
    updateSyncBadge();
  }

  // Un error sin status HTTP es de red/timeout (fetch rechazó o abortamos).
  function isTransient(e) {
    return !e || !e.status || e.status >= 500 || e.status === 429;
  }

  function errMsg(e) {
    if (!e || !e.status) return "Sin conexión";
    return e.message || `Error ${e.status}`;
  }

  async function flushOutbox(opts) {
    const o = opts || {};
    if (flushing) {
      flushAgain = true;
      return;
    }
    if (!window.SUPAPI || !SUPAPI.enabled()) {
      updateSyncBadge();
      return;
    }

    let sent = 0;
    let transient = false;
    let failedNow = 0;
    let lastError = null;

    flushing = true;
    try {
      do {
        flushAgain = false;
        const list = outboxGet();
        if (!list.length) break;

        const remaining = [];
        for (const item of list) {
          // Un fallo permanente no se reintenta en loop: solo al abrir la app
          // o con un reintento manual.
          if (item.status === "failed" && !o.retryFailed) {
            remaining.push(item);
            continue;
          }

          try {
            const payload = Object.assign({}, item.payload, { id: item.id });
            await SUPAPI.insertReport(payload, { timeout: 15000 });
            sent++;
          } catch (e) {
            if (e && e.status === 409) {
              // Clave duplicada: el parte ya estaba en la nube.
              sent++;
              continue;
            }
            item.attempts = (item.attempts || 0) + 1;
            item.lastError = errMsg(e);
            if (isTransient(e)) {
              item.status = "pending";
              transient = true;
            } else {
              item.status = "failed";
              failedNow++;
              lastError = item.lastError;
            }
            remaining.push(item);
          }
        }
        outboxSet(remaining);
      } while (flushAgain);
    } finally {
      flushing = false;
    }

    if (failedNow) {
      const n = failedNow === 1 ? "1 parte" : `${failedNow} partes`;
      toast(`No se pudo subir ${n}: ${lastError || "error del servidor"}.`, "warn");
    } else if (sent && !transient) {
      toast(sent === 1 ? "Parte sincronizado con la nube." : `${sent} partes sincronizados con la nube.`);
    } else if (transient) {
      toast("Sin conexión: se reintentará automáticamente.", "warn");
    }

    scheduleRetry(transient);
  }

  function scheduleRetry(needed) {
    clearTimeout(retryTimer);
    if (!needed) return;
    const pending = outboxGet().filter((it) => it.status !== "failed");
    if (!pending.length) return;
    const attempts = Math.max.apply(
      null,
      pending.map((it) => it.attempts || 0).concat([0])
    );
    const delay = Math.min(
      RETRY_BASE_MS * Math.pow(2, Math.max(0, attempts - 1)),
      RETRY_MAX_MS
    );
    retryTimer = setTimeout(() => flushOutbox(), delay);
  }

  function updateSyncBadge() {
    const badge = $("#syncBadge");
    if (!badge) return;
    const list = outboxGet();
    const n = list.length;
    if (!n) {
      badge.hidden = true;
      return;
    }
    const failed = list.filter((it) => it.status === "failed").length;
    badge.hidden = false;
    badge.textContent =
      (n === 1 ? "1 parte pendiente" : `${n} partes pendientes`) +
      (failed ? ` · ${failed} con error` : "");
    const last = list[list.length - 1];
    badge.title =
      (window.SUPAPI && SUPAPI.enabled()
        ? "Partes por subir a la nube"
        : "Nube no configurada: se guardan localmente") +
      (last && last.lastError ? ` · Último error: ${last.lastError}` : "") +
      " · Clic para reintentar";
  }

  /* ---------- Modales ---------- */
  function openModal(sel) {
    const m = $(sel);
    if (m) m.hidden = false;
    document.body.style.overflow = "hidden";
  }
  function closeModal(sel) {
    const m = $(sel);
    if (m) m.hidden = true;
    document.body.style.overflow = "";
  }

  let confirmResolve = null;
  function confirmDialog(title, body) {
    $("#confirmTitle").textContent = title;
    $("#confirmBody").textContent = body;
    openModal("#confirmModal");
    return new Promise((resolve) => {
      confirmResolve = resolve;
    });
  }
  function closeConfirm(val) {
    closeModal("#confirmModal");
    if (confirmResolve) {
      confirmResolve(val);
      confirmResolve = null;
    }
  }

  /* ---------- Toast ---------- */
  let toastTimer = null;
  function toast(msg, type) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast" + (type ? " " + type : "");
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      t.hidden = true;
    }, 2600);
  }

  /* ---------- Tema ---------- */
  function applyTheme(theme) {
    document.body.classList.toggle("dark", theme === "dark");
    const btn = $("#btnTheme");
    if (btn) btn.textContent = theme === "dark" ? "☀️" : "🌙";
  }
  function toggleTheme() {
    const dark = !document.body.classList.contains("dark");
    localStorage.setItem(KEY_THEME, dark ? "dark" : "light");
    applyTheme(dark ? "dark" : "light");
  }

  /* ---------- Eventos ---------- */
  function wireEvents() {
    $("#btnAddMesa").addEventListener("click", () => {
      const row = addMesa();
      const first = row.querySelector('[data-field="n"]');
      if (first) first.focus();
    });
    $("#btnSave").addEventListener("click", save);
    $("#btnClear").addEventListener("click", clearForm);
    $("#btnTheme").addEventListener("click", toggleTheme);

    mesasEl.addEventListener("input", (e) => {
      const t = e.target;
      if (t && t.classList && t.classList.contains("mesa-input")) {
        const field = t.getAttribute("data-field");
        if (field && field !== "n") formatMoneyInput(t, field === "propina");
      }
      renderTotals();
      updateMoneyErrors();
      saveDraft();
    });

    ["#fecha", "#hora", "#activityDate", "#sector", "#turno", "#legajo", "#notas"].forEach((sel) =>
      $(sel).addEventListener("input", () => {
        if (sel === "#fecha" || sel === "#hora") syncActivityDate();
        saveDraft();
      })
    );

    $("#confirmYes").addEventListener("click", () => closeConfirm(true));
    $("#confirmNo").addEventListener("click", () => closeConfirm(false));

    document.querySelectorAll(".modal").forEach((modal) => {
      modal.addEventListener("click", (e) => {
        if (e.target !== modal) return;
        if (modal.id === "confirmModal") closeConfirm(false);
        else closeModal("#" + modal.id);
      });
    });
    document.querySelectorAll("[data-close]").forEach((btn) => {
      btn.addEventListener("click", () => closeModal("#" + btn.closest(".modal").id));
    });

    window.addEventListener("online", () => flushOutbox());
    window.addEventListener("focus", () => flushOutbox());
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) flushOutbox();
    });

    const badge = $("#syncBadge");
    if (badge) {
      badge.addEventListener("click", () => flushOutbox({ retryFailed: true }));
    }
  }

  /* ---------- Init ---------- */
  function init() {
    getDeviceId();
    applyTheme(localStorage.getItem(KEY_THEME) || "light");

    $("#fecha").value = todayDate();
    $("#hora").value = nowTime();
    const actInit = $("#activityDate");
    if (actInit) actInit.value = computeActivityDate(todayDate(), nowTime());

    const restored = loadDraft();
    if (!restored) {
      $("#fecha").value = todayDate();
      $("#hora").value = nowTime();
      const act = $("#activityDate");
      if (act) act.value = computeActivityDate(todayDate(), nowTime());
      addMesa();
    } else {
      syncActivityDate();
    }

    renderTotals();
    updateSyncBadge();
    wireEvents();
    flushOutbox({ retryFailed: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
