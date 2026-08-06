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
const defB9 = formulas.find(f => f.label.startsWith('Définition'));
assert(!!defB9, 'une formule de définition existe pour B9');
if (defB9) {
  const exp = G.expandFormula(defB9.id, 'S1', 'B', 'B9', '2024');
  assert(exp && exp.others.length >= 3, 'expansion de la définition de B9 renvoie plusieurs membres');
  const reconstructed = exp.others.reduce((acc, m) => acc + (m.value === null ? 0 : m.effectiveSign * m.value), 0);
  const diff = Math.abs(reconstructed - seedVal);
  assert(diff < 5, `identité comptable B9 = Σ(termes) à 2024 (écart=${diff.toFixed(2)})`);

  const check = G.checkIdentity(defB9.id, '2024');
  assert(check !== null && Math.abs(check) < 5, `checkIdentity ≈ 0 pour la définition de B9 en 2024 (valeur=${check})`);
}

// 4) formule de ventilation par secteur : la somme des sous-secteurs ≈ le total
const ventil = formulas.find(f => f.label.startsWith('Ventilation par secteur'));
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

console.log(failures === 0 ? '\nTous les contrôles sont passés.' : `\n${failures} contrôle(s) en échec.`);
process.exit(failures === 0 ? 0 : 1);
