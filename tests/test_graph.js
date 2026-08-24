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

console.log(failures === 0 ? '\nTous les contrôles sont passés.' : `\n${failures} contrôle(s) en échec.`);
process.exit(failures === 0 ? 0 : 1);
