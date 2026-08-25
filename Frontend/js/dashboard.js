/**
 * dashboard.js — Tableau de bord des performances du chatbot
 * Récupère /metrics et /metrics/history et met à jour le DOM.
 */

const Dashboard = (() => {

  let tlChart    = null;
  let autoTimer  = null;
  let isLoaded   = false;

  function el(id) { return document.getElementById(id); }

  // ── Formatage ────────────────────────────────────────────────
  function ms(v) {
    if (v >= 1000) return (v / 1000).toFixed(1) + "s";
    return Math.round(v) + "ms";
  }

  function colorClass(rate) {
    if (rate >= 95) return "good";
    if (rate >= 80) return "warn";
    return "bad";
  }

  function rtColor(rt) {
    if (rt < 1000) return "#1baf7a";
    if (rt < 3000) return "#2a78d6";
    if (rt < 5000) return "#eda100";
    return "#e34948";
  }

  // ── Statut connexion ─────────────────────────────────────────
  function setConnStatus(ok, msg) {
    const dot  = el("dashDot");
    const text = el("dashStatusText");
    if (dot)  dot.className = "status-dot " + (ok ? "" : "error");
    if (text) text.textContent = msg;
  }

  // ── Chargement principal ─────────────────────────────────────
  async function load() {
    setConnStatus(false, "Chargement…");
    try {
      const [summary, history] = await Promise.all([
        API.getMetrics(),
        API.getMetricsHistory(30),
      ]);

      setConnStatus(true, "Connecté");
      const lu = el("dashLastUpdate");
      if (lu) lu.textContent = "Mis à jour " + new Date().toLocaleTimeString("fr-FR");

      renderKPIs(summary);
      renderDistribution(summary);
      renderTimeline(summary.timeline || []);
      renderHistory(history || []);
      isLoaded = true;

    } catch (err) {
      setConnStatus(false, "Erreur : " + err.message);
      console.error("[Dashboard]", err);
    }
  }

  // ── KPI grid ───────────────────────────────────────────────────
  function renderKPIs(s) {
    const grid = el("kpiGrid");
    if (!grid) return;

    const cards = [
      { label: "Total requêtes",   value: s.total_requests, sub: "" },
      { label: "Taux de succès",   value: s.success_rate + "%", sub: s.total_errors + " erreur(s)", cls: colorClass(s.success_rate) },
      { label: "Temps moyen",      value: ms(s.rt_avg), sub: ms(s.rt_min) + " — " + ms(s.rt_max) },
      { label: "P90 / P99",        value: ms(s.rt_p90), sub: "P99 " + ms(s.rt_p99) },
      { label: "Tokens / sec",     value: s.tps_avg + " t/s", sub: "" },
      { label: "Tokens total",     value: s.tokens_total.toLocaleString("fr-FR"), sub: "" },
      { label: "Score RAG moyen",  value: s.rag_score_avg || "—", sub: s.rag_used_rate + "% avec RAG" },
      { label: "Longueur rép.",    value: s.response_len_avg, sub: "caractères" },
    ];

    grid.innerHTML = cards.map(c => `
      <div class="kpi">
        <div class="kpi-label">${c.label}</div>
        <div class="kpi-value ${c.cls || ""}">${c.value}</div>
        ${c.sub ? `<div class="kpi-sub">${c.sub}</div>` : ""}
      </div>
    `).join("");
  }

  // ── Distribution des temps ────────────────────────────────────
  function renderDistribution(s) {
    const container = el("distBars");
    if (!container) return;

    const d = s.rt_distribution || {};
    const total = Math.max(
      (d["<1s"] || 0) + (d["1-3s"] || 0) + (d["3-5s"] || 0) + (d[">5s"] || 0), 1
    );

    const rows = [
      { label: "<1s",  count: d["<1s"]  || 0, color: "#1baf7a" },
      { label: "1-3s", count: d["1-3s"] || 0, color: "#2a78d6" },
      { label: "3-5s", count: d["3-5s"] || 0, color: "#eda100" },
      { label: ">5s",  count: d[">5s"]  || 0, color: "#e34948" },
    ];

    container.innerHTML = rows.map(r => `
      <div class="dist-row">
        <span class="dist-label">${r.label}</span>
        <div class="dist-track">
          <div class="dist-fill" style="background:${r.color};width:${Math.round(r.count/total*100)}%"></div>
        </div>
        <span class="dist-val">${r.count}</span>
      </div>
    `).join("");

    const pctRow = el("percentileRow");
    if (pctRow) {
      pctRow.innerHTML = `
        <div class="pct-item"><div class="pct-label">P50</div><div class="pct-value">${ms(s.rt_p50)}</div></div>
        <div class="pct-item"><div class="pct-label">P90</div><div class="pct-value">${ms(s.rt_p90)}</div></div>
        <div class="pct-item"><div class="pct-label">P99</div><div class="pct-value">${ms(s.rt_p99)}</div></div>
      `;
    }
  }

  // ── Timeline (Chart.js) ───────────────────────────────────────
  function renderTimeline(tl) {
    const canvas = el("timelineChart");
    if (!canvas || typeof Chart === "undefined") return;

    const labels = tl.map(t => t.t);
    const data   = tl.map(t => Math.round(t.rt));
    const colors = tl.map(t => t.ok ? "#2a78d6" : "#e34948");

    if (tlChart) { tlChart.destroy(); tlChart = null; }

    tlChart = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: "Temps de réponse (ms)",
          data,
          backgroundColor: colors,
          borderRadius: 4,
          borderSkipped: "bottom",
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => ms(ctx.parsed.y) } },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: "#898781", font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
          },
          y: {
            grid: { color: "rgba(128,128,128,0.15)" },
            ticks: { color: "#898781", font: { size: 10 }, callback: (v) => ms(v) },
            beginAtZero: true,
          },
        },
      },
    });
  }

  // ── Tableau historique ────────────────────────────────────────
  function renderHistory(hist) {
    const tbody = el("historyBody");
    if (!tbody) return;

    if (!hist || hist.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-muted);font-size:13px">Aucune requête enregistrée</td></tr>`;
      return;
    }

    tbody.innerHTML = hist.map(m => `
      <tr>
        <td>${m.t}</td>
        <td style="color:${rtColor(m.rt_ms)}">${ms(m.rt_ms)}</td>
        <td>${ms(m.ttfb_ms)}</td>
        <td>${m.tokens}</td>
        <td>${m.tps}</td>
        <td>${m.rag_chunks}</td>
        <td>${m.rag_score > 0 ? m.rag_score : "—"}</td>
        <td><span class="metric-badge ${m.success ? "ok" : "err"}">${m.success ? "OK" : "ERR"}</span></td>
      </tr>
    `).join("");
  }

  // ── Auto-refresh ───────────────────────────────────────────────
  function toggleAuto() {
    const checkbox = el("autoRefresh");
    const on = checkbox ? checkbox.checked : false;
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    if (on) autoTimer = setInterval(load, 10000);
  }

  // ── Bind événements (appelé une fois au démarrage) ──────────────
  function bindEvents() {
    const refreshBtn = el("refreshMetricsBtn");
    if (refreshBtn) refreshBtn.addEventListener("click", load);
  }

  // ── API publique ─────────────────────────────────────────────
  return {
    load,
    toggleAuto,
    bindEvents,
    isLoaded: () => isLoaded,
  };

})();

document.addEventListener("DOMContentLoaded", () => {
  Dashboard.bindEvents();
});