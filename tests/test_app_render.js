// Test de rendu "à blanc" de site/app.js : simule juste assez de React et du
// DOM pour exécuter les fonctions composants (App, CardNode, Card,
// FormulaGroup) sans navigateur, et vérifie qu'elles ne lèvent pas d'erreur
// et produisent une structure d'éléments cohérente.
// Lancer depuis la racine du dépôt : node tests/test_app_render.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SITE = path.join(__dirname, '..', 'site');

let hookCalls = 0;
function mockCreateElement(type, props, ...rest) {
  const children = rest.length === 0 ? undefined : rest.length === 1 ? rest[0] : rest;
  return { type, props: Object.assign({}, props, children !== undefined ? { children } : {}) };
}
function mockUseState(initial) {
  hookCalls++;
  return [initial, function () {}];
}

const renderedTypeCounts = {};
function walk(el, depth) {
  if (el === null || el === undefined || typeof el === 'boolean') return;
  if (typeof el === 'string' || typeof el === 'number') return;
  if (Array.isArray(el)) { el.forEach(e => walk(e, depth)); return; }
  if (typeof el !== 'object' || !('type' in el)) return;
  const t = el.type;
  const name = typeof t === 'function' ? (t.displayName || t.name || 'anonymous') : t;
  renderedTypeCounts[name] = (renderedTypeCounts[name] || 0) + 1;
  if (typeof t === 'function') {
    const out = t(el.props);
    walk(out, depth + 1);
    return;
  }
  walk(el.props && el.props.children, depth);
}

const fakeElRegistry = {};
function makeFakeDom() {
  return {
    getElementById(id) {
      return fakeElRegistry[id] || (fakeElRegistry[id] = { id });
    },
  };
}

const sandbox = {
  console,
  document: makeFakeDom(),
  React: { createElement: mockCreateElement, useState: mockUseState },
  ReactDOM: { createRoot: () => ({ render: (el) => { sandbox.__rendered = el; } }) },
};
sandbox.window = sandbox; // comme dans un vrai navigateur, window === global
vm.createContext(sandbox);

vm.runInContext(fs.readFileSync(path.join(SITE, 'data', 'tee_graph.js'), 'utf8'), sandbox, { filename: 'tee_graph.js' });
vm.runInContext(fs.readFileSync(path.join(SITE, 'graph.js'), 'utf8'), sandbox, { filename: 'graph.js' });

let failures = 0;
function assert(cond, msg) {
  if (!cond) { console.error('ÉCHEC:', msg); failures++; }
  else console.log('OK:', msg);
}

try {
  vm.runInContext(fs.readFileSync(path.join(SITE, 'app.js'), 'utf8'), sandbox, { filename: 'app.js' });
  assert(true, "app.js s'exécute sans lever d'erreur (montage initial de <App/>)");
} catch (e) {
  console.error(e);
  assert(false, "app.js s'exécute sans lever d'erreur : " + e.message);
  process.exit(1);
}

assert(!!sandbox.__rendered, 'ReactDOM.createRoot(...).render(...) a bien été appelé');

walk(sandbox.__rendered, 0);
console.log('Types rendus (rendu initial, formules repliées) :', renderedTypeCounts);
assert(renderedTypeCounts.App === 1, 'le composant App a été rendu');
assert(renderedTypeCounts.CardNode >= 1, 'au moins un CardNode a été rendu (la carte racine)');
assert(renderedTypeCounts.Card >= 1, 'au moins une Card a été rendue');

// --- Test direct de FormulaGroup pour la graine (B9, S1) sans passer par le
// cycle useState (qui est mocké en no-op), pour vérifier le dépliage lui-même.
const D = vm.runInContext('TEE_GRAPH', sandbox);
const G = vm.runInContext('TeeGraphLib', sandbox).makeGraph(D);
const FormulaGroupSrc = fs.readFileSync(path.join(SITE, 'app.js'), 'utf8');
// FormulaGroup n'est pas exposée globalement (IIFE) : on la retrouve en
// parcourant l'arbre déjà rendu n'est pas possible pour un composant non
// affiché par défaut (repliée). On revalide donc la logique d'expansion via
// graph.js directement (déjà couvert par test_graph.js), et on vérifie ici
// qu'au moins une formule est bien détectée pour la graine, condition
// nécessaire pour que les boutons de dépliage apparaissent dans l'UI.
const seedFormulas = G.getFormulasFor(D.seed.sector, D.seed.entry, D.seed.sto);
assert(seedFormulas.length >= 2, `la graine (${D.seed.sto}/${D.seed.sector}) propose au moins 2 identités à déplier`);

// --- Test de robustesse : simule "toutes les formules dépliées" sur chaque
// carte (via un Proxy renvoyant true pour n'importe quel id de formule) pour
// vérifier que le dépliage récursif ne lève pas d'erreur, avec un plafond de
// profondeur (le graphe comptable contient des cycles logiques - un secteur
// renvoie vers le total, qui peut redéployer vers un autre secteur, etc. - ce
// qui est normal et attendu à l'usage réel, un humain ne dépliant qu'à la main).
console.log('\n--- Test de robustesse (dépliage simulé en profondeur) ---');
const MAX_DEPTH = 6;
let deepRenderError = null;
let deepNodeCount = 0;
try {
  const sandbox2 = {
    console,
    document: makeFakeDom(),
    React: {
      createElement: mockCreateElement,
      useState: (initial) => {
        if (typeof initial === 'object' && initial !== null && !Array.isArray(initial)) {
          return [new Proxy({}, { get: () => true }), function () {}];
        }
        return [initial, function () {}];
      },
    },
    ReactDOM: { createRoot: () => ({ render: (el) => { sandbox2.__rendered = el; } }) },
  };
  sandbox2.window = sandbox2;
  vm.createContext(sandbox2);
  vm.runInContext(fs.readFileSync(path.join(SITE, 'data', 'tee_graph.js'), 'utf8'), sandbox2);
  vm.runInContext(fs.readFileSync(path.join(SITE, 'graph.js'), 'utf8'), sandbox2);
  vm.runInContext(fs.readFileSync(path.join(SITE, 'app.js'), 'utf8'), sandbox2);

  function walkCapped(el, depth) {
    if (depth > MAX_DEPTH) return;
    if (el === null || el === undefined || typeof el === 'boolean') return;
    if (typeof el === 'string' || typeof el === 'number') return;
    if (Array.isArray(el)) { el.forEach(e => walkCapped(e, depth)); return; }
    if (typeof el !== 'object' || !('type' in el)) return;
    deepNodeCount++;
    const t = el.type;
    if (typeof t === 'function') {
      const out = t(el.props);
      walkCapped(out, depth + 1);
      return;
    }
    walkCapped(el.props && el.props.children, depth);
  }
  walkCapped(sandbox2.__rendered, 0);
} catch (e) {
  deepRenderError = e;
}
assert(!deepRenderError, 'dépliage récursif simulé (profondeur <= ' + MAX_DEPTH + ') sans exception' + (deepRenderError ? ' : ' + deepRenderError.stack : ''));
console.log('Nœuds visités en dépliage simulé :', deepNodeCount);

console.log(failures === 0 ? '\nTous les contrôles sont passés.' : `\n${failures} contrôle(s) en échec.`);
process.exit(failures === 0 ? 0 : 1);
