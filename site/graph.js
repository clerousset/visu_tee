// Logique pure (sans DOM) d'exploration du graphe de valeurs du TEE.
// Séparée de app.js pour rester testable directement avec Node (tests/test_graph.js).
(function (root) {
  function keyOf(sector, entry, sto) { return sector + '|' + entry + '|' + sto; }

  function makeGraph(D) {
    function getValue(sector, entry, sto, year) {
      const v = ((D.values[sector] || {})[entry] || {})[sto];
      if (!v) return null;
      const val = v[String(year)];
      return val === undefined ? null : val;
    }

    function stoLabel(sto) { return D.labelsSto[sto] || sto; }
    function sectorLabel(sector) { return D.labelsSecteur[sector] || sector; }
    function entryLabel(entry) { return D.labelsEntry[entry] || entry; }

    function availableYears(sector, entry, sto) {
      const v = ((D.values[sector] || {})[entry] || {})[sto];
      if (!v) return [];
      return Object.keys(v).sort((a, b) => +a - +b);
    }

    // série annuelle complète d'un poste, triée par année croissante,
    // pour affichage en mini-graphique (sparkline)
    function series(sector, entry, sto) {
      const v = ((D.values[sector] || {})[entry] || {})[sto];
      if (!v) return [];
      return Object.keys(v)
        .map(y => ({ year: +y, value: v[y] }))
        .sort((a, b) => a.year - b.year);
    }

    // formules auxquelles participe le poste (sector,entry,sto), avec un
    // court résumé (libellé + nombre de membres)
    function getFormulasFor(sector, entry, sto) {
      const ids = D.index[keyOf(sector, entry, sto)] || [];
      return ids.map(id => ({ id, label: D.formulas[id].label, size: D.formulas[id].members.length }));
    }

    // Calcule, pour une formule donnée et un poste d'origine (qui doit être
    // membre de cette formule), les autres membres avec leur "signe effectif"
    // relatif à l'origine : origin = Σ effectiveSign_j * value_j
    function expandFormula(id, originSector, originEntry, originSto, year) {
      const f = D.formulas[id];
      if (!f) return null;
      const originMember = f.members.find(
        m => m.sector === originSector && m.entry === originEntry && m.sto === originSto
      );
      if (!originMember) return null;
      const originSigne = originMember.signe;
      const others = f.members
        .filter(m => !(m.sector === originSector && m.entry === originEntry && m.sto === originSto))
        .map(m => ({
          sector: m.sector,
          entry: m.entry,
          sto: m.sto,
          signe: m.signe,
          effectiveSign: -originSigne * m.signe,
          value: getValue(m.sector, m.entry, m.sto, year),
        }));
      // les soldes (position "B") passent toujours en premier à l'affichage
      // (tri stable : l'ordre relatif du reste, tel que dans formules_TEE.csv,
      // est conservé)
      others.sort((a, b) => (a.entry === 'B' ? 0 : 1) - (b.entry === 'B' ? 0 : 1));
      return { id, label: f.label, originSigne, others };
    }

    // vérifie (à titre informatif) que Σ signe*valeur ≈ 0 pour une formule à
    // une année donnée ; retourne null si des valeurs manquent
    function checkIdentity(id, year) {
      const f = D.formulas[id];
      let sum = 0;
      for (const m of f.members) {
        const v = getValue(m.sector, m.entry, m.sto, year);
        if (v === null) return null;
        sum += m.signe * v;
      }
      return sum;
    }

    return {
      data: D,
      keyOf, getValue, stoLabel, sectorLabel, entryLabel, availableYears, series,
      getFormulasFor, expandFormula, checkIdentity,
    };
  }

  // Calcule la géométrie (points SVG, échelles) d'un mini-graphique en
  // ligne pour une série {year,value}[] triée par année. Pure fonction,
  // sans DOM, réutilisable telle quelle dans app.js et testable directement.
  function sparklineGeometry(seriesArr, opts) {
    opts = opts || {};
    const width = opts.width || 220;
    const height = opts.height || 70;
    const pad = opts.pad !== undefined ? opts.pad : 6;
    if (!seriesArr || seriesArr.length === 0) return null;

    const values = seriesArr.map(p => p.value);
    const minV = Math.min(...values);
    const maxV = Math.max(...values);
    const minYear = seriesArr[0].year;
    const maxYear = seriesArr[seriesArr.length - 1].year;
    const spanV = (maxV - minV) || 1;
    const spanYear = (maxYear - minYear) || 1;

    function xFor(year) { return pad + ((year - minYear) / spanYear) * (width - 2 * pad); }
    function yFor(value) { return height - pad - ((value - minV) / spanV) * (height - 2 * pad); }

    const points = seriesArr.map(p => xFor(p.year).toFixed(1) + ',' + yFor(p.value).toFixed(1)).join(' ');
    const zeroY = (minV <= 0 && maxV >= 0) ? yFor(0) : null;

    return { points, width, height, minV, maxV, minYear, maxYear, xFor, yFor, zeroY };
  }

  // Géométrie d'un histogramme empilé divergent (autour d'un zéro central) :
  // les contributions positives s'empilent vers le haut, les négatives vers
  // le bas, pour visualiser comment les membres d'une identité comptable
  // reconstituent le poste d'origine. `others` est le tableau renvoyé par
  // expandFormula() (chaque membre porte déjà effectiveSign + value).
  // Pure fonction, sans DOM, testable directement.
  function stackedBarGeometry(others, opts) {
    opts = opts || {};
    const width = opts.width || 70;
    const height = opts.height || 260;
    const pad = opts.pad !== undefined ? opts.pad : 4;

    const contributions = (others || [])
      .filter(m => m.value !== null && m.value !== undefined)
      .map(m => Object.assign({}, m, { contribution: m.effectiveSign * m.value }));

    const posSum = contributions.filter(c => c.contribution > 0).reduce((a, c) => a + c.contribution, 0);
    const negSum = contributions.filter(c => c.contribution < 0).reduce((a, c) => a + c.contribution, 0); // <= 0
    const total = posSum + negSum;
    const maxAbs = Math.max(posSum, -negSum, 1);

    const zeroY = height / 2;
    const scale = (height / 2 - pad) / maxAbs;

    let cumPos = 0;
    let cumNeg = 0;
    const segments = contributions.map(c => {
      let y0, y1;
      if (c.contribution >= 0) {
        y0 = zeroY - cumPos * scale;
        cumPos += c.contribution;
        y1 = zeroY - cumPos * scale;
      } else {
        y0 = zeroY - cumNeg * scale;
        cumNeg += c.contribution;
        y1 = zeroY - cumNeg * scale;
      }
      return {
        sector: c.sector, entry: c.entry, sto: c.sto,
        contribution: c.contribution, positive: c.contribution >= 0,
        y0, y1,
      };
    });

    return { segments, zeroY, width, height, total, posSum, negSum, missing: (others || []).length - contributions.length };
  }

  const api = { makeGraph, keyOf, sparklineGeometry, stackedBarGeometry };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.TeeGraphLib = api;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : null));
