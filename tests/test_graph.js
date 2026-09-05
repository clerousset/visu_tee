// Test de la logique pure de graph.js (sans DOM, sans React).
// Lancer depuis la racine du dépôt : node tests/test_graph.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SITE = path.join(__dirname, '..', 'site');
const sandbox = { console, window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(SITE, 'data', 'tee_graph.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(SITE, 'graph.js'), 'utf8'), sandbox);

const D = vm.runInContext('TEE_GRAPH', sandbox);
const Lib = vm.runInContext('window.TeeGraphLib', sandbox);
const G = Lib.makeGraph(D);

let failures = 0;
function assert(cond, msg) {
  if (!cond) { console.error('ÉCHEC:', msg); failures++; }
  else console.log('OK:', msg);
}

// 1) la graine (B9, S1, 2024) existe et a une valeur plausible
const seedVal = G.getValue('S1', 'B', 'B9', '2024');
assert(seedVal !== null, 'valeur B9/S1/2024 présente');
assert(Math.abs(seedVal) < 500000, 'valeur B9/S1/2024 dans une plage plausible (< 500 Md€ en millions)');

// 2) la graine participe à au moins une formule
const formulas = G.getFormulasFor('S1', 'B', 'B9');
assert(formulas.length >= 2, `B9/S1 participe à >=2 formules (trouvé ${formulas.length})`);

// 3) expansion de la définition de B9 et vérification de l'identité comptable pour 2024
// (le libellé brut du script R pour cette identité est "Lien épargne/capacité ou besoin
// de financement", pas "Définition ...")
const defB9 = formulas.find(f => f.label !== 'Ventilation en sous-secteur');
assert(!!defB9, 'une formule de définition existe pour B9');
if (defB9) {
  const exp = G.expandFormula(defB9.id, 'S1', 'B', 'B9', '2024');
  assert(exp && exp.others.length >= 3, 'expansion de la définition de B9 renvoie plusieurs membres');
  const reconstructed = exp.others.reduce((acc, m) => acc + (m.value === null ? 0 : m.effectiveSign * m.value), 0);
  const diff = Math.abs(reconstructed - seedVal);
  assert(diff < 5, `identité comptable B9 = Σ(termes) à 2024 (écart=${diff.toFixed(2)})`);

  const check = G.checkIdentity(defB9.id, '2024');
  assert(check !== null && Math.abs(check) < 5, `checkIdentity ≈ 0 pour la définition de B9 en 2024 (valeur=${check})`);

  // les soldes (entry === 'B') doivent apparaître en premier
  const entries = exp.others.map(m => m.entry);
  const firstNonB = entries.findIndex(e => e !== 'B');
  const lastB = entries.lastIndexOf('B');
  assert(
    firstNonB === -1 || lastB === -1 || lastB < firstNonB,
    `les membres "B" (soldes) apparaissent avant les autres dans l'expansion (ordre observé: ${entries.join(',')})`
  );
  assert(exp.others[0].entry === 'B', `le premier membre déplié est un solde (trouvé entry=${exp.others[0].entry})`);

  // un enfant de cette formule doit lui-même lister la formule parente
  // parmi les siennes (c'est ce que l'UI doit filtrer via excludeFormulaId,
  // pour ne pas proposer de replier trivialement "vers le parent")
  const child = exp.others[0];
  const childFormulas = G.getFormulasFor(child.sector, child.entry, child.sto);
  assert(
    childFormulas.some(f => f.id === defB9.id),
    `l'enfant ${child.sto} référence bien la formule parente (à filtrer côté UI)`
  );
  const filtered = childFormulas.filter(f => f.id !== defB9.id);
  assert(filtered.length === childFormulas.length - 1, "le filtre par excludeFormulaId retire exactement la formule parente");
}

// 4) formule de ventilation par secteur : la somme des sous-secteurs ≈ le total
const ventil = formulas.find(f => f.label === 'Ventilation en sous-secteur');
assert(!!ventil, 'une formule de ventilation par secteur existe pour B9');
if (ventil) {
  const exp = G.expandFormula(ventil.id, 'S1', 'B', 'B9', '2024');
  const missing = exp.others.filter(m => m.value === null).length;
  assert(missing === 0, 'tous les sous-secteurs ont une valeur en 2024 pour B9');
  const reconstructed = exp.others.reduce((acc, m) => acc + (m.value === null ? 0 : m.effectiveSign * m.value), 0);
  const diff = Math.abs(reconstructed - seedVal);
  assert(diff < 5, `identité comptable B9 = Σ(secteurs) à 2024 (écart=${diff.toFixed(2)})`);
}

// 4bis) une ventilation ne se propose que depuis sa carte cible (celle qui
// SE décompose) : un membre non-cible (ex. un sous-secteur) ne doit plus la
// lister du tout — pas seulement filtrée côté UI via excludeFormulaId, qui
// ne couvrait que le lien direct parent -> enfant.
if (ventil) {
  const child = G.expandFormula(ventil.id, 'S1', 'B', 'B9', '2024').others[0];
  const childFormulas2 = G.getFormulasFor(child.sector, child.entry, child.sto, '2024');
  assert(!childFormulas2.some(f => f.id === ventil.id),
    `un membre non-cible (${child.sector}) de "Ventilation en sous-secteur" ne la reliste plus du tout`);
}

// 4ter) régression : une ventilation par secteur (ex. S1 -> S11) suivie
// d'une ventilation en sous-catégorie DANS S11 (ex. D1 -> D11) ne doit pas
// faire réapparaître "Ventilation en sous-secteur" (pour D11 cette fois) sur
// le petit-enfant S11/D11 — ce serait une autre façon de remonter vers S1,
// simplement atteinte par un chemin différent (bug corrigé : le filtre ne
// portait avant que sur l'identité exacte qui a produit la carte, pas sur
// toute ventilation du même type plus bas dans l'arbre).
{
  const seedFormulas2 = G.getFormulasFor(D.seed.sector, D.seed.entry, D.seed.sto, '2024');
  const secteurF = seedFormulas2.find(f => f.label === 'Ventilation en sous-secteur');
  assert(!!secteurF, 'la graine propose une ventilation par secteur');
  if (secteurF) {
    // évite S13 : depuis l'intégration de l'APU, S13 a sa propre
    // ventilation en sous-secteur (vers S1311/S1313/S1314 — voir
    // load_apu_formulas), donc un de ses postes peut légitimement proposer
    // "Ventilation en sous-secteur" sans que ce soit un retour vers S1 —
    // un autre secteur (ex. S11) garde le test ciblé sur le vrai bug visé.
    const s11 = G.expandFormula(secteurF.id, D.seed.sector, D.seed.entry, D.seed.sto, '2024').others
      .find(m => m.sector !== D.seed.sector && m.sector !== 'S13');
    assert(!!s11, 'la ventilation par secteur de la graine a un membre dans un autre secteur (hors S13)');
    if (s11) {
      const s11Formulas = G.getFormulasFor(s11.sector, s11.entry, s11.sto, '2024');
      const s11CatF = s11Formulas.find(f => f.label === 'Ventilation en sous-catégorie');
      assert(!!s11CatF, `${s11.sto}/${s11.sector} propose sa propre ventilation en sous-catégorie`);
      if (s11CatF) {
        const grandchild = G.expandFormula(s11CatF.id, s11.sector, s11.entry, s11.sto, '2024').others[0];
        const gcFormulas = G.getFormulasFor(grandchild.sector, grandchild.entry, grandchild.sto, '2024');
        assert(!gcFormulas.some(f => f.label === 'Ventilation en sous-secteur'),
          `le petit-enfant ${grandchild.sto}/${grandchild.sector} (atteint par sous-catégorie après un sous-secteur) ` +
          `ne propose pas "Ventilation en sous-secteur" (remonterait vers ${D.seed.sector})`);
      }
    }
  }
}

// 5) robustesse sur une année plus ancienne (moins de garantie, juste sanity check)
const val1980 = G.getValue('S1', 'B', 'B9', '1980');
if (val1980 !== null && defB9) {
  const exp = G.expandFormula(defB9.id, 'S1', 'B', 'B9', '1980');
  const missing = exp.others.filter(m => m.value === null).length;
  console.log(`Info 1980 : ${missing} terme(s) manquant(s) sur ${exp.others.length} pour la définition de B9`);
}

// 6) série annuelle + géométrie du sparkline (pour l'icône au survol)
const s = G.series('S1', 'B', 'B9');
assert(s.length > 40, `série B9/S1 a un historique long (${s.length} points)`);
assert(s.every((p, i) => i === 0 || p.year > s[i - 1].year), 'série triée par année croissante');

const geom = Lib.sparklineGeometry(s, { width: 240, height: 84, pad: 10 });
assert(!!geom, 'sparklineGeometry retourne une géométrie pour une série non vide');
if (geom) {
  assert(geom.points.split(' ').length === s.length, 'un point de coordonnées par observation');
  const last = s[s.length - 1];
  const x = geom.xFor(last.year), y = geom.yFor(last.value);
  assert(x >= 0 && x <= geom.width, `xFor(dernière année) dans les bornes du graphique (x=${x.toFixed(1)})`);
  assert(y >= 0 && y <= geom.height, `yFor(dernière valeur) dans les bornes du graphique (y=${y.toFixed(1)})`);
}
assert(Lib.sparklineGeometry([]) === null, 'sparklineGeometry(série vide) renvoie null');

// 7) histogramme empilé divergent (panneau latéral) pour la définition de B9
if (defB9) {
  const exp = G.expandFormula(defB9.id, 'S1', 'B', 'B9', '2024');
  const bar = Lib.stackedBarGeometry(exp.others, { width: 70, height: 260, pad: 4 });
  assert(bar.segments.length === exp.others.length, 'un segment par membre de la formule');
  assert(Math.abs(bar.total - (bar.posSum + bar.negSum)) < 1e-6, 'total = somme des contributions positives et négatives');
  const diffTotal = Math.abs(bar.total - seedVal);
  assert(diffTotal < 5, `le total de l'histogramme empilé ≈ la valeur de B9/S1/2024 (écart=${diffTotal.toFixed(2)})`);
  bar.segments.forEach(s => {
    assert(s.y0 >= -0.01 && s.y0 <= bar.height + 0.01 && s.y1 >= -0.01 && s.y1 <= bar.height + 0.01,
      `segment ${s.sto} dans les bornes verticales du graphique (y0=${s.y0.toFixed(1)}, y1=${s.y1.toFixed(1)})`);
  });
  assert(bar.missing === 0, "aucun membre manquant pour l'histogramme empilé de B9/2024");
}
const emptyBar = Lib.stackedBarGeometry([], { height: 260 });
assert(emptyBar.segments.length === 0 && emptyBar.total === 0, 'stackedBarGeometry([]) renvoie une géométrie vide cohérente');

// 8) unité "delta" (variation par rapport à l'année précédente) : menu
// "Unités" de l'UI. getValue/series/expandFormula prennent un `unit`
// optionnel ('delta') ; par linéarité, l'identité comptable reste vraie
// sur les deltas (delta d'une somme = somme des deltas).
{
  const level2024 = G.getValue('S1', 'B', 'B9', '2024');
  const level2023 = G.getValue('S1', 'B', 'B9', '2023');
  const delta2024 = G.getValue('S1', 'B', 'B9', '2024', undefined, 'delta');
  assert(level2024 !== null && level2023 !== null, 'B9/S1 a une valeur en niveau pour 2023 et 2024');
  assert(delta2024 !== null && Math.abs(delta2024 - (level2024 - level2023)) < 1e-9,
    `getValue(..., 'delta') = niveau(année) - niveau(année-1) (delta=${delta2024}, attendu=${level2024 - level2023})`);

  // pas d'année précédente disponible : delta null (comme une valeur en
  // niveau manquante), sans lever d'exception
  const firstYear = String(YEARS_MIN());
  function YEARS_MIN() {
    // première année disponible pour B9/S1 (déduite de la série, pas d'une
    // hypothèse sur le millésime de départ des données)
    const s = G.series('S1', 'B', 'B9');
    return s[0].year;
  }
  const deltaFirstYear = G.getValue('S1', 'B', 'B9', firstYear, undefined, 'delta');
  assert(deltaFirstYear === null, `getValue(..., 'delta') est null pour la première année disponible (${firstYear}, pas d'année précédente)`);

  // série en delta : un point de moins que la série en niveau (le premier
  // point n'a pas d'année précédente), et chaque valeur = niveau(y) - niveau(y-1)
  const levelSeries = G.series('S1', 'B', 'B9');
  const deltaSeries = G.series('S1', 'B', 'B9', 'delta');
  assert(deltaSeries.length === levelSeries.length - 1,
    `série delta a un point de moins que la série en niveau (delta=${deltaSeries.length}, niveau=${levelSeries.length})`);
  const lastLevel = levelSeries[levelSeries.length - 1];
  const prevLevel = levelSeries[levelSeries.length - 2];
  const lastDelta = deltaSeries[deltaSeries.length - 1];
  assert(lastDelta.year === lastLevel.year && Math.abs(lastDelta.value - (lastLevel.value - prevLevel.value)) < 1e-9,
    'dernier point de la série delta = dernier niveau - niveau précédent');

  // l'identité comptable reste vraie sur les deltas (linéarité)
  if (defB9) {
    const expDelta = G.expandFormula(defB9.id, 'S1', 'B', 'B9', '2024', undefined, 'delta');
    assert(expDelta && expDelta.others.every(m => m.value !== null), 'expansion en delta de la définition de B9 a toutes ses valeurs en 2024');
    if (expDelta) {
      const reconstructedDelta = expDelta.others.reduce((acc, m) => acc + m.effectiveSign * m.value, 0);
      const diffDelta = Math.abs(reconstructedDelta - delta2024);
      assert(diffDelta < 5, `identité comptable en delta : Δ(B9) = Σ(Δ termes) à 2024 (écart=${diffDelta.toFixed(2)})`);
    }
  }
}

// 9) unité "pct" (menu "Unités") : taux de croissance annuel pour la carte
// de départ, contribution à CETTE croissance (même dénominateur, la valeur
// N-1 de la carte de départ) pour les autres — voir graph.js::getValue.
{
  const pctRoot = { sector: 'S1', entry: 'B', sto: 'B9', activity: undefined };
  const level2024 = G.getValue('S1', 'B', 'B9', '2024');
  const level2023 = G.getValue('S1', 'B', 'B9', '2023');
  const pct2024 = G.getValue('S1', 'B', 'B9', '2024', undefined, 'pct', pctRoot);
  const expectedPct = ((level2024 - level2023) / level2023) * 100;
  assert(pct2024 !== null && Math.abs(pct2024 - expectedPct) < 1e-9,
    `getValue(..., 'pct', pctRoot=lui-même) = taux de croissance usuel (pct=${pct2024}, attendu=${expectedPct})`);

  // sans pctRoot (dénominateur manquant), ou avec un pctRoot dont la valeur
  // N-1 est indisponible : null plutôt qu'une exception
  assert(G.getValue('S1', 'B', 'B9', '2024', undefined, 'pct') === null,
    "getValue(..., 'pct') sans pctRoot renvoie null");
  assert(G.getValue('S1', 'B', 'B9', '2024', undefined, 'pct', { sector: 'S1', entry: 'B', sto: 'B9999' }) === null,
    "getValue(..., 'pct') avec un pctRoot dont la valeur N-1 est indisponible renvoie null");

  // l'identité comptable reste vraie sur les contributions en % (linéarité,
  // même démonstration que pour le delta, mais rapportée à la même base) :
  // Σ effectiveSign_i * contribution_i = taux de croissance de la racine
  if (defB9) {
    const expPct = G.expandFormula(defB9.id, 'S1', 'B', 'B9', '2024', undefined, 'pct', pctRoot);
    assert(expPct && expPct.others.every(m => m.value !== null), 'expansion en pct de la définition de B9 a toutes ses valeurs en 2024');
    if (expPct) {
      const reconstructedPct = expPct.others.reduce((acc, m) => acc + m.effectiveSign * m.value, 0);
      const diffPct = Math.abs(reconstructedPct - pct2024);
      assert(diffPct < 0.01, `identité comptable en pct : croissance(B9) = Σ(contributions) à 2024 (écart=${diffPct.toFixed(4)} point)`);

      // vérifie qu'un membre non-racine est bien rapporté à la base de la
      // racine (pctRoot), pas à sa propre valeur précédente : sa contribution
      // = son propre delta / valeur N-1 de B9 (pas de lui-même)
      const member = expPct.others[0];
      const memberLevelCur = G.getValue(member.sector, member.entry, member.sto, '2024', member.activity);
      const memberLevelPrev = G.getValue(member.sector, member.entry, member.sto, '2023', member.activity);
      const expectedContribution = ((memberLevelCur - memberLevelPrev) / level2023) * 100;
      assert(Math.abs(member.value - expectedContribution) < 1e-6,
        `contribution du membre ${member.sto} = son propre delta / valeur N-1 de la racine (trouvé=${member.value}, attendu=${expectedContribution})`);
    }
  }
}

// 7) membre décalé d'une année (yearOffset) : "Lien patrimoine/flux,
// réévaluations et autres changements de volume" (LE_N(N) = LE_N(N-1) +
// F(N) + K7(N) + KA(N)) est la seule identité du graphe où un membre porte
// sur une AUTRE année que la cible — vérifie que le moteur la résout
// correctement (valeur au bon décalage, pas de confusion entre la cible et
// le membre "année précédente" qui partage pourtant le même poste).
{
  const patrimoineFid = Object.keys(D.formulas).find(fid => D.formulas[fid].label.indexOf('Lien patrimoine/flux') === 0);
  assert(!!patrimoineFid, 'au moins une identité "Lien patrimoine/flux..." existe dans le graphe');
  if (patrimoineFid) {
    const f = D.formulas[patrimoineFid];
    const target = f.target;
    const years = f.years;
    const year = years[Math.floor(years.length / 2)]; // une année vérifiée, pas la première (a besoin de N-1)
    const exp = G.expandFormula(patrimoineFid, target.sector, target.entry, target.sto, year);
    assert(!!exp, `expandFormula résout "${patrimoineFid}" depuis sa cible`);
    if (exp) {
      const shifted = exp.others.find(m => m.yearOffset && m.yearOffset !== 0);
      assert(!!shifted, 'un membre de l\'identité porte un yearOffset non nul (le terme "année précédente")');
      if (shifted) {
        assert(shifted.sto === target.sto,
          `le membre décalé porte sur le même poste que la cible (${shifted.sto} === ${target.sto})`);
        const directValue = G.getValue(target.sector, target.entry, target.sto, String(+year + shifted.yearOffset));
        assert(shifted.value === directValue,
          `la valeur du membre décalé (${shifted.value}) est bien celle de l'année ${+year + shifted.yearOffset} (${directValue}), pas celle de ${year}`);
        // le membre décalé ne doit JAMAIS être confondu avec la cible :
        // sameMember() les distingue par yearOffset malgré le même poste
        const notShifted = exp.others.filter(m => m.sto === target.sto && (m.yearOffset || 0) === 0);
        assert(notShifted.length === 0,
          'aucun autre membre "même poste, même année que la cible" ne fuite dans le dépliage (la cible elle-même est exclue)');
      }
      const reconstructed = exp.others.reduce((acc, m) => acc + (m.value === null ? NaN : m.effectiveSign * m.value), 0);
      const rootVal = G.getValue(target.sector, target.entry, target.sto, year);
      const diff = Math.abs(reconstructed - rootVal);
      assert(diff < 1, `identité comptable avec membre décalé : cible = Σ(termes, dont un décalé) à ${year} (écart=${diff.toFixed(2)})`);
    }
  }
}

// 8) "Lien ressources/emplois avec le reste du monde" (D1_C(S1) + RM_D1_D
// == D1_D(S1) + RM_D1_C, où RM_* est la part "reste du monde"
// (COUNTERPART_AREA "W1") des ressources/emplois de l'économie totale) :
// vérifie que l'identité existe, se résout des deux côtés (C et D), et
// qu'aucun fid n'est dupliqué dans l'index (régression : la même identité
// avait été indexée deux fois par poste RM_*, une par position C/D chargée,
// ce qui faisait apparaître deux fois la même pill sur la carte).
{
  const worldRowFid = Object.keys(D.formulas).find(fid => D.formulas[fid].label === 'Lien ressources/emplois avec le reste du monde' && fid.endsWith('|S1-D1'));
  assert(!!worldRowFid, 'une identité "Lien ressources/emplois avec le reste du monde" existe pour D1');
  if (worldRowFid) {
    const f = D.formulas[worldRowFid];
    assert(f.members.length === 4, `l'identité a 4 membres (D1_C, D1_D, RM_D1_C, RM_D1_D) (trouvé ${f.members.length})`);
    assert(f.members.some(m => m.sto === 'RM_D1' && m.entry === 'C') && f.members.some(m => m.sto === 'RM_D1' && m.entry === 'D'),
      'les membres "reste du monde" (RM_D1) sont présents en ressource ET en emploi');

    const year = f.years[f.years.length - 1];
    const exp = G.expandFormula(worldRowFid, 'S1', 'D', 'D1', year);
    assert(!!exp, `expandFormula résout "${worldRowFid}" depuis D1_D`);
    if (exp) {
      const reconstructed = exp.others.reduce((acc, m) => acc + (m.value === null ? NaN : m.effectiveSign * m.value), 0);
      const rootVal = G.getValue('S1', 'D', 'D1', year);
      const diff = Math.abs(reconstructed - rootVal);
      assert(diff < 1, `identité monde/reste du monde : D1_D = Σ(termes) à ${year} (écart=${diff.toFixed(2)})`);
    }

    // régression : chaque fid n'apparaît qu'une fois par entrée d'index,
    // même pour un poste RM_* chargé en position C et D
    const idxKey = 'S1|D|RM_D1';
    const ids = D.index[idxKey] || [];
    const occurrences = ids.filter(id => id === worldRowFid).length;
    assert(occurrences === 1, `l'identité n'apparaît qu'une fois dans l'index de ${idxKey} (trouvé ${occurrences})`);
  }
}

// 9) "Ventilation en région" (D1(S1) == Σ REG_<région>_D1 sur les 14 régions
// de scripts/prepare_data.py::REGION_CODES) : vérifie que l'identité existe
// pour D1, qu'elle a bien 15 membres (la cible + 14 régions), et qu'elle se
// reconstitue à la valeur de la cible.
{
  const regionFid = Object.keys(D.formulas).find(fid => D.formulas[fid].label === 'Ventilation en région' && fid.endsWith('|S1-D-D1'));
  assert(!!regionFid, 'une identité "Ventilation en région" existe pour D1 (position D)');
  if (regionFid) {
    const f = D.formulas[regionFid];
    assert(f.members.length === 15, `l'identité a 15 membres (cible + 14 régions) (trouvé ${f.members.length})`);
    assert(f.members.filter(m => m.sto.indexOf('REG_') === 0).length === 14,
      'les 14 membres régionaux portent un poste préfixé "REG_"');

    const year = f.years[f.years.length - 1];
    const exp = G.expandFormula(regionFid, 'S1', 'D', 'D1', year);
    assert(!!exp, `expandFormula résout "${regionFid}" depuis D1`);
    if (exp) {
      const reconstructed = exp.others.reduce((acc, m) => acc + (m.value === null ? NaN : m.effectiveSign * m.value), 0);
      const rootVal = G.getValue('S1', 'D', 'D1', year);
      const diff = Math.abs(reconstructed - rootVal);
      assert(diff < 1, `ventilation en région : D1 = Σ(régions) à ${year} (écart=${diff.toFixed(2)})`);
    }
  }
}

console.log(failures === 0 ? '\nTous les contrôles sont passés.' : `\n${failures} contrôle(s) en échec.`);
process.exit(failures === 0 ? 0 : 1);
