// Visualisation de la séquence des comptes (Tableau Économique d'Ensemble)
// des comptes nationaux annuels INSEE. Données pré-calculées dans
// data/tee_data.js (variable TEE_DATA) par scripts/prepare_data.py.

(function () {
  const D = TEE_DATA;
  const YEARS = (() => {
    const s = new Set();
    D.secteurs.forEach(sec => Object.keys(D.balances[sec] || {}).forEach(y => s.add(+y)));
    return [...s].sort((a, b) => a - b);
  })();
  const MIN_YEAR = YEARS[0];
  const MAX_YEAR = YEARS[YEARS.length - 1];

  const STEPS = [
    { key: 'B1G', name: 'Valeur ajoutée brute', compte: 'Compte de production', total: true },
    { key: 'B2A3G', name: 'EBE + revenu mixte brut', compte: "Compte d'exploitation", total: false },
    { key: 'B5G', name: 'Solde des revenus primaires', compte: "Compte d'affectation des revenus primaires", total: false },
    { key: 'B6G', name: 'Revenu disponible brut', compte: 'Compte de distribution secondaire du revenu', total: false },
    { key: 'B8G', name: 'Épargne brute', compte: "Compte d'utilisation du revenu", total: false },
    { key: 'B9', name: 'Capacité (+) / besoin (-) de financement', compte: 'Compte de capital', total: true },
  ];

  const SOLDE_OPTIONS = [
    { key: 'B1G', label: 'Valeur ajoutée brute (B1G)' },
    { key: 'B2A3G', label: 'EBE + revenu mixte brut (B2A3G)' },
    { key: 'B5G', label: 'Solde des revenus primaires (B5G)' },
    { key: 'B6G', label: 'Revenu disponible brut (B6G)' },
    { key: 'B8G', label: 'Épargne brute (B8G)' },
    { key: 'B9', label: 'Capacité / besoin de financement (B9)' },
  ];

  const SECTOR_COLORS = {
    S1: '#5b8def', S11: '#7ee0c3', S12: '#ffb454', S13: '#ff6b9c', S14: '#c98bff', S15: '#5bd1d1',
  };

  const state = { sector: 'S1', year: MAX_YEAR, solde: 'B9', compareAll: false };

  const fmt = (v) => {
    if (v === null || v === undefined || Number.isNaN(v)) return '—';
    const md = v / 1000;
    return md.toLocaleString('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + ' Md€';
  };
  const fmtSigned = (v) => (v > 0 ? '+' : '') + fmt(v);

  function getBalance(sector, year, key) {
    const b = (D.balances[sector] || {})[year];
    if (!b) return null;
    if (key === 'B2A3G' && b.B2A3G === undefined) {
      if (b.B2G !== undefined && b.B3G !== undefined) return b.B2G + b.B3G;
      return null;
    }
    return b[key] !== undefined ? b[key] : null;
  }

  // ---------- UI: onglets secteur ----------
  const sectorTabs = document.getElementById('sectorTabs');
  D.secteurs.forEach(sec => {
    const btn = document.createElement('button');
    btn.textContent = D.labelsSecteur[sec] || sec;
    btn.dataset.sector = sec;
    if (sec === state.sector) btn.classList.add('active');
    btn.addEventListener('click', () => {
      state.sector = sec;
      [...sectorTabs.children].forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderAll();
    });
    sectorTabs.appendChild(btn);
  });

  // ---------- UI: année ----------
  const yearSlider = document.getElementById('yearSlider');
  const yearValue = document.getElementById('yearValue');
  yearSlider.min = MIN_YEAR;
  yearSlider.max = MAX_YEAR;
  yearSlider.value = state.year;
  yearValue.textContent = state.year;

  function setYear(y) {
    y = Math.max(MIN_YEAR, Math.min(MAX_YEAR, y));
    state.year = y;
    yearSlider.value = y;
    yearValue.textContent = y;
    renderAll();
  }
  yearSlider.addEventListener('input', () => setYear(+yearSlider.value));
  document.getElementById('yearPrev').addEventListener('click', () => setYear(state.year - 1));
  document.getElementById('yearNext').addEventListener('click', () => setYear(state.year + 1));

  // ---------- UI: sélecteur de solde (évolution + comparaison) ----------
  const soldeSelect = document.getElementById('soldeSelect');
  SOLDE_OPTIONS.forEach(opt => {
    const o = document.createElement('option');
    o.value = opt.key; o.textContent = opt.label;
    if (opt.key === state.solde) o.selected = true;
    soldeSelect.appendChild(o);
  });
  soldeSelect.addEventListener('change', () => { state.solde = soldeSelect.value; renderEvolution(); renderComparison(); });

  const compareCheckbox = document.getElementById('compareAll');
  compareCheckbox.addEventListener('change', () => { state.compareAll = compareCheckbox.checked; renderEvolution(); });

  // ---------- Chart: cascade (waterfall) ----------
  let waterfallChart = null;
  function renderWaterfall() {
    const labels = STEPS.map(s => s.total ? s.name : s.compte);
    const values = STEPS.map(s => getBalance(state.sector, state.year, s.key));

    const bars = [];
    const colors = [];
    let prev = 0;
    for (let i = 0; i < STEPS.length; i++) {
      const v = values[i];
      if (v === null) { bars.push([0, 0]); colors.push(getCss('--border')); prev = 0; continue; }
      if (STEPS[i].total) {
        bars.push([0, v]);
        colors.push(getCss('--total'));
      } else {
        const from = prev, to = v;
        bars.push([Math.min(from, to), Math.max(from, to)]);
        colors.push(to >= from ? getCss('--pos') : getCss('--neg'));
      }
      prev = v;
    }

    const ctx = document.getElementById('waterfallCanvas');
    const data = {
      labels,
      datasets: [{
        data: bars,
        backgroundColor: colors,
        borderRadius: 4,
        barPercentage: 0.55,
      }],
    };
    const opts = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = values[ctx.dataIndex];
              if (v === null) return 'Donnée indisponible';
              return STEPS[ctx.dataIndex].name + ' : ' + fmt(v);
            },
          },
        },
      },
      scales: {
        x: { ticks: { color: '#9aa0ac', font: { size: 10.5 } }, grid: { color: '#2a2f3a' } },
        y: {
          ticks: { color: '#9aa0ac', callback: (v) => (v / 1000).toLocaleString('fr-FR') },
          grid: { color: '#2a2f3a' },
        },
      },
    };

    if (waterfallChart) { waterfallChart.data = data; waterfallChart.options = opts; waterfallChart.update(); }
    else waterfallChart = new Chart(ctx, { type: 'bar', data, options: opts });

    // tableau des soldes
    const tbody = document.querySelector('#soldeTable tbody');
    tbody.innerHTML = '';
    STEPS.forEach((s, i) => {
      const v = values[i];
      const tr = document.createElement('tr');
      const cls = v === null ? '' : (v >= 0 ? 'pos' : 'neg');
      tr.innerHTML = `<td>${s.name}<br><span style="color:var(--text-dim);font-size:11px">${s.key}</span></td>
        <td class="num ${cls}">${fmt(v)}</td>`;
      tbody.appendChild(tr);
    });

    // en-tête synthèse
    const b9 = getBalance(state.sector, state.year, 'B9');
    document.getElementById('headlineValue').textContent = fmt(b9);
    document.getElementById('headlineValue').className = 'headline-num ' + (b9 >= 0 ? 'pos' : 'neg');
  }
  function getCss(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  // ---------- Chart: évolution ----------
  let evolutionChart = null;
  function renderEvolution() {
    const ctx = document.getElementById('evolutionCanvas');
    let datasets;
    if (state.compareAll) {
      datasets = D.secteurs.map(sec => ({
        label: D.labelsSecteur[sec],
        data: YEARS.map(y => {
          const v = getBalance(sec, String(y), state.solde);
          return v === null ? null : v / 1000;
        }),
        borderColor: SECTOR_COLORS[sec],
        backgroundColor: SECTOR_COLORS[sec],
        borderWidth: sec === state.sector ? 3 : 1.5,
        pointRadius: 0,
        tension: 0.15,
        spanGaps: true,
      }));
    } else {
      datasets = [{
        label: D.labelsSecteur[state.sector],
        data: YEARS.map(y => {
          const v = getBalance(state.sector, String(y), state.solde);
          return v === null ? null : v / 1000;
        }),
        borderColor: SECTOR_COLORS[state.sector],
        backgroundColor: SECTOR_COLORS[state.sector] + '33',
        borderWidth: 2.5,
        pointRadius: 0,
        tension: 0.15,
        fill: true,
        spanGaps: true,
      }];
    }

    const data = { labels: YEARS, datasets };
    const opts = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: state.compareAll, labels: { color: '#e8eaed', boxWidth: 12, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label} : ${ctx.parsed.y.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Md€`,
          },
        },
      },
      scales: {
        x: { ticks: { color: '#9aa0ac', maxTicksLimit: 14 }, grid: { display: false } },
        y: { ticks: { color: '#9aa0ac' }, grid: { color: '#2a2f3a' } },
      },
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
    };

    if (evolutionChart) { evolutionChart.data = data; evolutionChart.options = opts; evolutionChart.update(); }
    else evolutionChart = new Chart(ctx, { type: 'line', data, options: opts });
  }

  // ---------- Chart: comparaison sectorielle ----------
  let comparisonChart = null;
  function renderComparison() {
    const ctx = document.getElementById('comparisonCanvas');
    const secteurs = D.secteurs;
    const values = secteurs.map(sec => {
      const v = getBalance(sec, String(state.year), state.solde);
      return v === null ? null : v / 1000;
    });
    const data = {
      labels: secteurs.map(s => D.labelsSecteur[s]),
      datasets: [{
        data: values,
        backgroundColor: secteurs.map(s => SECTOR_COLORS[s]),
        borderRadius: 5,
        barPercentage: 0.6,
      }],
    };
    const opts = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => (ctx.parsed.y ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' Md€' } },
      },
      scales: {
        x: { ticks: { color: '#9aa0ac', font: { size: 10.5 } }, grid: { display: false } },
        y: { ticks: { color: '#9aa0ac' }, grid: { color: '#2a2f3a' } },
      },
    };
    if (comparisonChart) { comparisonChart.data = data; comparisonChart.options = opts; comparisonChart.update(); }
    else comparisonChart = new Chart(ctx, { type: 'bar', data, options: opts });
    document.getElementById('compYear').textContent = state.year;
  }

  function renderAll() {
    renderWaterfall();
    renderEvolution();
    renderComparison();
  }

  renderAll();
})();
