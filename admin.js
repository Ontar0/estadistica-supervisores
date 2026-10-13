/* =============================================================
   Estadística de Supervisores — Panel de administración
   ============================================================= */
(function () {
  "use strict";

  const $ = (sel, root = document) => (root || document).querySelector(sel);
  const SESSION_KEY = "sup:v1:admin:session";
  const THEME_KEY = "sup:v1:theme";

  /* ---------- Sesión ---------- */
  function getSession() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY)) || null;
    } catch (e) {
      return null;
    }
  }
  function setSession(s) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  }
  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }
  function storeTokens(data) {
    setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (Number(data.expires_in || 3600) - 30) * 1000
    });
  }
  async function currentToken() {
    const s = getSession();
    if (!s) return null;
    if (s.access_token && Date.now() < (s.expires_at || 0)) return s.access_token;
    if (s.refresh_token) {
      try {
        const data = await SUPAPI.refresh(s.refresh_token);
        storeTokens(data);
        return data.access_token;
      } catch (e) {
        clearSession();
        return null;
      }
    }
    return null;
  }

  /* ---------- Utilidades ---------- */
  function escapeHtml(s) {
    return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }
  function money(n) {
    const x = Number(n) || 0;
    return x.toLocaleString("es-AR", { maximumFractionDigits: 2 });
  }
  function moneyClass(n) {
    const x = Number(n) || 0;
    return x > 0 ? "pos" : x < 0 ? "neg" : "";
  }
  function fmtStamp(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso).slice(0, 16).replace("T", " ");
    return d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
  }
  function shortId(id) {
    return id ? String(id).slice(0, 8) : "—";
  }
  function normalizeMesas(r) {
    let m = r && r.mesas;
    if (typeof m === "string") {
      try { m = JSON.parse(m); } catch (e) { m = []; }
    }
    return Array.isArray(m) ? m : [];
  }
  function horaShort(v) {
    return v ? String(v).slice(0, 5) : "—";
  }

  /* ---------- Toast ---------- */
  let toastTimer = null;
  function toast(msg, type) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast" + (type ? " " + type : "");
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
  }

  /* ---------- Vistas ---------- */
  function showLogin(msg) {
    $("#loginView").hidden = false;
    $("#dashView").hidden = true;
    $("#btnLogout").hidden = true;
    $("#btnReload").hidden = true;
    $("#btnExport").hidden = true;
    if (msg) $("#loginMsg").textContent = msg;
  }
  function showDash() {
    $("#loginView").hidden = true;
    $("#dashView").hidden = false;
    $("#btnLogout").hidden = false;
    $("#btnReload").hidden = false;
    $("#btnExport").hidden = false;
  }

  /* ---------- Cálculos ---------- */
  let currentRows = [];

  function totalsOf(list) {
    return list.reduce(
      (acc, r) => {
        acc.partes += 1;
        acc.g += Number(r.total_ganancia) || 0;
        acc.p += Number(r.total_perdida) || 0;
        acc.capital += Number(r.total_capital) || 0;
        acc.propina += Number(r.total_propina) || 0;
        acc.mesas += normalizeMesas(r).length;
        return acc;
      },
      { partes: 0, g: 0, p: 0, capital: 0, propina: 0, mesas: 0 }
    );
  }

  function aggregate(rows, keyFn) {
    const map = new Map();
    for (const r of rows) {
      const k = keyFn(r);
      const g = map.get(k) || { key: k, partes: 0, g: 0, p: 0, capital: 0, propina: 0 };
      g.partes += 1;
      g.g += Number(r.total_ganancia) || 0;
      g.p += Number(r.total_perdida) || 0;
      g.capital += Number(r.total_capital) || 0;
      g.propina += Number(r.total_propina) || 0;
      map.set(k, g);
    }
    return Array.from(map.values());
  }

  /* ---------- Render ---------- */
  function render(rows) {
    currentRows = rows;
    renderKpis(rows);
    renderDayBars(rows);
    renderAggTable("#turnoTable", aggregate(rows, (r) => "Turno " + (r.turno ?? "—")), "Turno");
    renderAggTable("#sectorTable", aggregate(rows, (r) => "Sector " + (r.sector ?? "—")), "Sector");
    renderAggTable("#legajoTable", aggregate(rows, (r) => "Legajo " + (r.legajo ?? "—")), "Legajo");
    renderAggTable(
      "#dayTable",
      aggregate(rows, (r) => actDate(r)).sort((a, b) => (a.key < b.key ? 1 : -1)),
      "Fecha actividad"
    );
    renderReports(rows);
  }

  function actDate(r) {
    return r && r.activity_date ? r.activity_date : (r && r.report_date ? r.report_date : "—");
  }

  function kpi(label, value, sub, cls) {
    return `<div class="kpi">
      <span class="kpi-label">${label}</span>
      <span class="kpi-value ${cls || ""}">${value}</span>
      ${sub ? `<span class="kpi-sub">${sub}</span>` : ""}
    </div>`;
  }

  function renderKpis(rows) {
    const t = totalsOf(rows);
    const supervisores = new Set(rows.map((r) => r.legajo)).size;
    const dias = new Set(rows.map((r) => actDate(r))).size;
    $("#kpis").innerHTML = [
      kpi("Partes", t.partes),
      kpi("Capital", money(t.capital), "Ganancia − Pérdida", moneyClass(t.capital)),
      kpi("Propina", money(t.propina)),
      kpi("Ganancia", money(t.g)),
      kpi("Pérdida", money(t.p)),
      kpi("Mesas", t.mesas),
      kpi("Supervisores", supervisores),
      kpi("Días", dias)
    ].join("");
  }

  function renderDayBars(rows) {
    const map = new Map();
    for (const r of rows) {
      const k = actDate(r);
      if (k === "—") continue;
      map.set(k, (map.get(k) || 0) + 1);
    }
    const list = Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-14);
    if (!list.length) {
      $("#dayBars").innerHTML = '<p class="empty">Sin datos todavía.</p>';
      return;
    }
    const max = list.reduce((m, e) => Math.max(m, e[1]), 1);
    $("#dayBars").innerHTML = list
      .map(([day, n]) => {
        const w = Math.max(4, Math.round((n / max) * 100));
        return `<div class="bar-row">
          <span class="bar-day">${escapeHtml(day.slice(5))}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${w}%"></span></span>
          <span class="bar-val">${n}</span>
        </div>`;
      })
      .join("");
  }

  function renderAggTable(sel, list, firstHeader) {
    let html =
      `<thead><tr><th>${firstHeader}</th><th class="num">Partes</th><th class="num">Ganancia</th><th class="num">Pérdida</th><th class="num">Capital</th><th class="num">Propina</th></tr></thead><tbody>`;
    if (!list.length) {
      html += '<tr><td colspan="6" class="empty">Sin datos todavía.</td></tr>';
    } else {
      for (const g of list) {
        html += `<tr>
          <td>${escapeHtml(g.key)}</td>
          <td class="num">${g.partes}</td>
          <td class="num">${money(g.g)}</td>
          <td class="num">${money(g.p)}</td>
          <td class="num ${moneyClass(g.capital)}">${money(g.capital)}</td>
          <td class="num">${money(g.propina)}</td>
        </tr>`;
      }
    }
    html += "</tbody>";
    $(sel).innerHTML = html;
  }

  function renderReports(rows) {
    const list = rows.slice(0, 500);
    let html =
      "<thead><tr><th></th><th>Fecha actividad</th><th>Fecha</th><th>Hora carga</th><th class='num'>Sector</th><th class='num'>Turno</th><th class='num'>Legajo</th><th class='num'>Ganancia</th><th class='num'>Pérdida</th><th class='num'>Capital</th><th class='num'>Propina</th></tr></thead><tbody>";
    if (!list.length) {
      html += '<tr><td colspan="11" class="empty">Sin datos todavía.</td></tr>';
    } else {
      list.forEach((r, i) => {
        const mesas = normalizeMesas(r);
        const chips = mesas
          .map((m) => `<span class="chip">M${escapeHtml(m.n)} · G ${money(m.ganancia)} · P ${money(m.perdida)} · T ${money(m.propina)}</span>`)
          .join("") || '<span class="chip">Sin mesas</span>';
        const notas = r.notas ? `<div class="detail-notes">Notas: ${escapeHtml(r.notas)}</div>` : "";
        html += `<tr>
          <td><button class="js-toggle" type="button" data-target="det-${i}" aria-label="Ver detalle">▶</button></td>
          <td>${escapeHtml(actDate(r))}</td>
          <td>${escapeHtml(r.report_date || "—")}</td>
          <td>${escapeHtml(horaShort(r.hora))}</td>
          <td class="num">${escapeHtml(r.sector)}</td>
          <td class="num">${escapeHtml(r.turno)}</td>
          <td class="num">${escapeHtml(r.legajo)}</td>
          <td class="num">${money(r.total_ganancia)}</td>
          <td class="num">${money(r.total_perdida)}</td>
          <td class="num ${moneyClass(r.total_capital)}">${money(r.total_capital)}</td>
          <td class="num">${money(r.total_propina)}</td>
        </tr>
        <tr class="detail-row" id="det-${i}" hidden>
          <td colspan="11"><div class="detail-inner">${chips}${notas}
            <div class="detail-notes">Cargado: ${escapeHtml(fmtStamp(r.created_at))} · Dispositivo ${escapeHtml(shortId(r.device_id))}</div>
          </div></td>
        </tr>`;
      });
    }
    html += "</tbody>";
    $("#reportsTable").innerHTML = html;
  }

  /* ---------- Export CSV ---------- */
  function csvCell(v) {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function exportCsv() {
    const header = [
      "fecha_actividad", "report_date", "hora_carga", "sector", "turno", "legajo",
      "total_ganancia", "total_perdida", "total_capital", "total_propina",
      "mesas", "notas", "created_at", "device_id"
    ];
    const lines = [header.join(",")];
    for (const r of currentRows) {
      const mesas = normalizeMesas(r)
        .map((m) => `${m.n}:${Number(m.ganancia) || 0}/${Number(m.perdida) || 0}/${Number(m.propina) || 0}`)
        .join(" | ");
      lines.push(
        [
          actDate(r) || "",
          r.report_date || "",
          horaShort(r.hora),
          r.sector ?? "",
          r.turno ?? "",
          r.legajo ?? "",
          r.total_ganancia || 0,
          r.total_perdida || 0,
          r.total_capital || 0,
          r.total_propina || 0,
          csvCell(mesas),
          csvCell(r.notas || ""),
          r.created_at || "",
          r.device_id || ""
        ].join(",")
      );
    }
    const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `estadistica-supervisores_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /* ---------- Filtros + carga ---------- */
  function readFilters() {
    const from = $("#fFrom").value;
    const to = $("#fTo").value;
    const sector = $("#fSector").value;
    const turno = $("#fTurno").value;
    const legajo = $("#fLegajo").value;
    return {
      from: from || null,
      to: to || null,
      sector: sector !== "" ? Math.round(Number(sector)) : null,
      turno: turno !== "" ? Math.round(Number(turno)) : null,
      legajo: legajo !== "" ? Math.round(Number(legajo)) : null,
      order: "report_date.desc,hora.desc",
      limit: 5000
    };
  }

  async function loadData() {
    const token = await currentToken();
    if (!token) {
      showLogin();
      return;
    }
    showDash();
    const filters = readFilters();
    try {
      let rows;
      try {
        rows = await SUPAPI.getReports(token, filters);
      } catch (e) {
        if (e.status === 401) {
          clearSession();
          const t2 = await currentToken();
          if (!t2) throw e;
          rows = await SUPAPI.getReports(t2, filters);
        } else {
          throw e;
        }
      }
      // Fallback por activity_date si se aplica filtro desde UI (solo filtro local como antes, pero tratamos)
      let out = Array.isArray(rows) ? rows : [];
      // Aplicar filtros locales por activity_date si hay valores
      const fromAct = $("#fFrom").value;
      const toAct = $("#fTo").value;
      if (fromAct || toAct) {
        out = out.filter((r) => {
          const ad = actDate(r);
          if (ad === "—") return false;
          if (fromAct && ad < fromAct) return false;
          if (toAct && ad > toAct) return false;
          return true;
        });
      }
      render(out);
      if (!rows.length) toast("No hay partes para esos filtros.");
    } catch (e) {
      toast("Error al cargar: " + e.message, "warn");
    }
  }

  /* ---------- Tema ---------- */
  function applyTheme(theme) {
    document.body.classList.toggle("dark", theme === "dark");
    const btn = $("#btnTheme");
    if (btn) btn.textContent = theme === "dark" ? "☀️" : "🌙";
  }
  function toggleTheme() {
    const dark = !document.body.classList.contains("dark");
    localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
    applyTheme(dark ? "dark" : "light");
  }

  /* ---------- Eventos ---------- */
  function wire() {
    $("#loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      $("#loginMsg").textContent = "";
      const btn = $("#loginBtn");
      btn.disabled = true;
      btn.textContent = "Ingresando…";
      try {
        const data = await SUPAPI.signIn($("#email").value.trim(), $("#password").value);
        storeTokens(data);
        await loadData();
      } catch (err) {
        $("#loginMsg").textContent = "No se pudo ingresar: " + err.message;
      } finally {
        btn.disabled = false;
        btn.textContent = "Ingresar";
      }
    });

    $("#btnLogout").addEventListener("click", async () => {
      const s = getSession();
      if (s) await SUPAPI.signOut(s.access_token);
      clearSession();
      showLogin("Sesión cerrada.");
    });

    $("#btnReload").addEventListener("click", loadData);
    $("#btnExport").addEventListener("click", exportCsv);
    $("#btnApply").addEventListener("click", loadData);
    $("#btnTheme").addEventListener("click", toggleTheme);

    // Enter en los filtros aplica
    ["#fFrom", "#fTo", "#fSector", "#fTurno", "#fLegajo"].forEach((sel) =>
      $(sel).addEventListener("keydown", (e) => {
        if (e.key === "Enter") loadData();
      })
    );

    // Detalle de partes
    $("#reportsTable").addEventListener("click", (e) => {
      const btn = e.target.closest(".js-toggle");
      if (!btn) return;
      const row = document.getElementById(btn.dataset.target);
      if (!row) return;
      row.hidden = !row.hidden;
      btn.textContent = row.hidden ? "▶" : "▼";
    });
  }

  /* ---------- Init ---------- */
  function init() {
    applyTheme(localStorage.getItem(THEME_KEY) || "light");
    wire();
    if (!SUPAPI.enabled()) {
      showLogin("Supabase no está configurado. Completá config.js para usar el panel.");
      $("#loginBtn").disabled = true;
      return;
    }
    loadData();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
