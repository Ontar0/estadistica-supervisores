/* =============================================================
   Estadística de Supervisores 2.0 — Lógica del supervisor
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

  function fmt(n) {
    return num(n).toLocaleString("es-AR", { maximumFractionDigits: 2 });
  }

  function intVal(sel) {
    const raw = String($(sel).value || "").trim();
    if (raw === "") return null;
    const x = Number(raw);
    return Number.isFinite(x) ? Math.round(x) : null;
  }

  /* ---------- Mesas (el DOM es la fuente de verdad) ---------- */
  const mesasEl = $("#mesas");

  function makeInput(field, label, value, extraClass) {
    const input = document.createElement("input");
    input.type = "number";
    input.inputMode = "numeric";
    input.min = "0";
    input.step = "1";
    input.className = "mesa-input" + (extraClass ? " " + extraClass : "");
    input.setAttribute("data-field", field);
    input.setAttribute("aria-label", label);
    input.placeholder = "0";
    if (value !== undefined && value !== null && value !== "") input.value = value;
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
        ganancia: num(get("ganancia").value),
        perdida: num(get("perdida").value),
        propina: num(get("propina").value)
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
      ["ganancia", "perdida", "propina"].some((f) => {
        const v = row.querySelector(`[data-field="${f}"]`).value;
        return v !== "" && Number(v) < 0;
      })
    );
  }

  function afterRowsChange() {
    $("#mesasEmpty").hidden = rowList().length > 0;
    renderTotals();
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

  /* ---------- Borrador (para no perder datos al recargar) ---------- */
  function saveDraft() {
    try {
      const draft = {
        fecha: $("#fecha").value,
        hora: $("#hora").value,
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
    return {
      report_date: $("#fecha").value || todayDate(),
      hora: hora + ":00",
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
      if (err.sel) $(err.sel).focus();
      return;
    }

    const payload = buildPayload();
    const ok = await confirmDialog(
      "Guardar parte",
      `${payload.mesas.length} mesa(s) · Capital ${fmt(payload.total_capital)} · Propina ${fmt(payload.total_propina)}`
    );
    if (!ok) return;

    const list = outboxGet();
    list.push(payload);
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
  function outboxGet() {
    try {
      return JSON.parse(localStorage.getItem(KEY_OUTBOX)) || [];
    } catch (e) {
      return [];
    }
  }
  function outboxSet(v) {
    localStorage.setItem(KEY_OUTBOX, JSON.stringify(v));
    updateSyncBadge();
  }

  async function flushOutbox() {
    const list = outboxGet();
    if (!list.length) {
      updateSyncBadge();
      return;
    }
    if (!window.SUPAPI || !SUPAPI.enabled()) {
      updateSyncBadge();
      return;
    }
    const remaining = [];
    for (const item of list) {
      try {
        await SUPAPI.insertReport(item);
      } catch (e) {
        remaining.push(item);
      }
    }
    outboxSet(remaining);
    if (!remaining.length) toast("Parte sincronizado con la nube.");
    else toast("Sin conexión: se reintentará automáticamente.", "warn");
  }

  function updateSyncBadge() {
    const badge = $("#syncBadge");
    if (!badge) return;
    const n = outboxGet().length;
    if (!n) {
      badge.hidden = true;
      return;
    }
    badge.hidden = false;
    badge.textContent = n === 1 ? "1 parte pendiente" : `${n} partes pendientes`;
    badge.title =
      window.SUPAPI && SUPAPI.enabled()
        ? "Partes por subir a la nube"
        : "Nube no configurada: se guardan localmente";
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

    mesasEl.addEventListener("input", () => {
      renderTotals();
      saveDraft();
    });

    ["#fecha", "#hora", "#sector", "#turno", "#legajo", "#notas"].forEach((sel) =>
      $(sel).addEventListener("input", saveDraft)
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

    window.addEventListener("online", flushOutbox);
  }

  /* ---------- Init ---------- */
  function init() {
    getDeviceId();
    applyTheme(localStorage.getItem(KEY_THEME) || "light");

    $("#fecha").value = todayDate();
    $("#hora").value = nowTime();

    const restored = loadDraft();
    if (!restored) {
      $("#fecha").value = todayDate();
      $("#hora").value = nowTime();
      addMesa();
    }

    renderTotals();
    updateSyncBadge();
    wireEvents();
    flushOutbox();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
