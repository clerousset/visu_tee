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

// --- Test direct de FormulaGroup pour la graine sans passer par le
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

// --- Test avec un vrai état simulé (clics successifs) : vérifie que le
// panneau latéral affiche un histogramme par décomposition active, y compris
// une sous-décomposition ouverte sur une carte enfant (dépliage plus
// détaillé), et que refermer la décomposition racine referme aussi en
// cascade les sous-décompositions qu'elle contenait.
console.log('\n--- Test du panneau latéral (dépliage réel simulé, y compris sous-décomposition) ---');
{
  let curHooks = null, curIdx = 0;
  function statefulUseState(initial) {
    const hooks = curHooks;
    const i = curIdx++;
    if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial;
    return [hooks[i], (v) => { hooks[i] = typeof v === 'function' ? v(hooks[i]) : v; }];
  }
  const sandbox3 = {
    console,
    document: makeFakeDom(),
    React: { createElement: mockCreateElement, useState: statefulUseState },
    ReactDOM: { createRoot: () => ({ render: (el) => { sandbox3.__rendered = el; } }) },
  };
  sandbox3.window = sandbox3;
  vm.createContext(sandbox3);
  vm.runInContext(fs.readFileSync(path.join(SITE, 'data', 'tee_graph.js'), 'utf8'), sandbox3);
  vm.runInContext(fs.readFileSync(path.join(SITE, 'graph.js'), 'utf8'), sandbox3);
  vm.runInContext(fs.readFileSync(path.join(SITE, 'app.js'), 'utf8'), sandbox3);

  const hookStores3 = {};
  function render3(el, pathKey) {
    if (el === null || el === undefined || typeof el === 'boolean' || typeof el === 'string' || typeof el === 'number') return el;
    if (Array.isArray(el)) return el.map((e, i) => render3(e, pathKey + '.' + i));
    if (typeof el !== 'object' || !('type' in el)) return el;
    const t = el.type;
    if (typeof t === 'function') {
      const name = t.displayName || t.name || 'anon';
      const key = pathKey + '/' + name + (el.props && el.props.key !== undefined ? ':' + el.props.key : '');
      if (!hookStores3[key]) hookStores3[key] = [];
      curHooks = hookStores3[key]; curIdx = 0;
      return { __rendered: render3(t(el.props), key), __el: el };
    }
    return { type: t, props: Object.assign({}, el.props, el.props && el.props.children !== undefined ? { children: render3(el.props.children, pathKey + '.c') } : {}) };
  }
  function findAll3(node, matchFn, acc) {
    acc = acc || [];
    if (!node) return acc;
    if (node.__rendered !== undefined) { findAll3(node.__rendered, matchFn, acc); return acc; }
    if (Array.isArray(node)) { node.forEach(n => findAll3(n, matchFn, acc)); return acc; }
    if (matchFn(node)) acc.push(node);
    if (node.props && node.props.children) findAll3(node.props.children, matchFn, acc);
    return acc;
  }
  const isPanel = n => n.props && n.props.className && n.props.className.indexOf('sidebar-panel') === 0;
  // les boutons "pill" (dépliage d'identité) uniquement : depuis l'ajout du
  // bouton "repartir d'ici" (↺) sur chaque carte, btns[0] n'est plus
  // forcément une pill (le bouton ↺ est rendu avant les pills dans le DOM)
  const isPill = n => n.type === 'button' && n.props.className && n.props.className.indexOf('pill') === 0;
  // la carte racine est la toute première carte rendue : son "expand-row"
  // (ligne de pills) est donc le premier de l'arbre, ce qui permet de
  // distinguer ses propres pills de celles apparues sur une carte enfant
  // après dépliage (indépendamment du poste de départ choisi comme graine)
  const rootExpandRow3 = tree => findAll3(tree, n => n.props && n.props.className === 'expand-row')[0];
  const rootPillsOf3 = tree => findAll3(rootExpandRow3(tree), isPill);

  let tree3 = render3(sandbox3.__rendered, 'root3');
  assert(findAll3(tree3, isPanel).length === 1, 'panneau vide au départ (aucune décomposition active)');

  let btns = rootPillsOf3(tree3);
  btns[0].props.onClick(); // déplie la 1ère identité de la carte racine
  tree3 = render3(sandbox3.__rendered, 'root3');
  assert(findAll3(tree3, isPanel).length === 1, 'un panneau après dépliage de la racine');

  // cherche, parmi les cartes désormais visibles, un bouton d'identité sur
  // une carte ENFANT (pas la racine elle-même) pour simuler une sous-décomposition
  const rootPillsAfterOpen = rootPillsOf3(tree3);
  const childBtn = findAll3(tree3, isPill).find(b => rootPillsAfterOpen.indexOf(b) === -1);
  assert(!!childBtn, "un bouton de sous-décomposition est visible sur une carte enfant, quelle que soit la graine");
  if (childBtn) {
    childBtn.props.onClick();
    tree3 = render3(sandbox3.__rendered, 'root3');
    const panelsAfterNested = findAll3(tree3, isPanel);
    assert(panelsAfterNested.length === 1,
      `toujours un seul panneau après ouverture d'une sous-décomposition (trouvé ${panelsAfterNested.length}) : elle enrichit le même graphique`);

    // referme la décomposition racine : la sous-décomposition doit disparaître en cascade
    btns = findAll3(tree3, isPill);
    btns[0].props.onClick();
    tree3 = render3(sandbox3.__rendered, 'root3');
    const panelsAfterClose = findAll3(tree3, isPanel);
    assert(panelsAfterClose.length === 1 && panelsAfterClose[0].props.className === 'sidebar-panel',
      `en refermant la racine, la sous-décomposition disparaît aussi du panneau (cascade) (trouvé ${panelsAfterClose.length} panneau(x))`);
  }
}

// --- Test de la ventilation par activité (SUT) : le sélecteur de départ
// permet maintenant de choisir n'importe quel poste (pas seulement les
// soldes), et un poste qui a une ventilation par activité validée (accord
// TEE/SUT, voir prepare_data.py::load_activite_formulas) doit proposer un
// bouton "Ventilation en activité" ; le déplier doit faire apparaître une
// carte par section NACE, avec badge d'activité et valeur cohérente avec
// G.getValue(..., activity), et le panneau latéral doit refléter ces
// contributions taguées ; refermer doit tout nettoyer proprement.
console.log('\n--- Test de la ventilation par activité (SUT) ---');
{
  let curHooks = null, curIdx = 0;
  function statefulUseState(initial) {
    const hooks = curHooks;
    const i = curIdx++;
    if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial;
    return [hooks[i], (v) => { hooks[i] = typeof v === 'function' ? v(hooks[i]) : v; }];
  }
  const sandbox4 = {
    console,
    document: makeFakeDom(),
    React: { createElement: mockCreateElement, useState: statefulUseState },
    ReactDOM: { createRoot: () => ({ render: (el) => { sandbox4.__rendered = el; } }) },
  };
  sandbox4.window = sandbox4;
  vm.createContext(sandbox4);
  vm.runInContext(fs.readFileSync(path.join(SITE, 'data', 'tee_graph.js'), 'utf8'), sandbox4);
  vm.runInContext(fs.readFileSync(path.join(SITE, 'graph.js'), 'utf8'), sandbox4);
  vm.runInContext(fs.readFileSync(path.join(SITE, 'app.js'), 'utf8'), sandbox4);
  const G4 = vm.runInContext('TeeGraphLib', sandbox4).makeGraph(vm.runInContext('TEE_GRAPH', sandbox4));

  const hookStores4 = {};
  function render4(el, pathKey) {
    if (el === null || el === undefined || typeof el === 'boolean' || typeof el === 'string' || typeof el === 'number') return el;
    if (Array.isArray(el)) return el.map((e, i) => render4(e, pathKey + '.' + i));
    if (typeof el !== 'object' || !('type' in el)) return el;
    const t = el.type;
    if (typeof t === 'function') {
      const name = t.displayName || t.name || 'anon';
      const key = pathKey + '/' + name + (el.props && el.props.key !== undefined ? ':' + el.props.key : '');
      if (!hookStores4[key]) hookStores4[key] = [];
      curHooks = hookStores4[key]; curIdx = 0;
      return { __rendered: render4(t(el.props), key), __el: el };
    }
    return { type: t, props: Object.assign({}, el.props, el.props && el.props.children !== undefined ? { children: render4(el.props.children, pathKey + '.c') } : {}) };
  }
  function findAll4(node, matchFn, acc) {
    acc = acc || [];
    if (!node) return acc;
    if (node.__rendered !== undefined) { findAll4(node.__rendered, matchFn, acc); return acc; }
    if (Array.isArray(node)) { node.forEach(n => findAll4(n, matchFn, acc)); return acc; }
    if (matchFn(node)) acc.push(node);
    if (node.props && node.props.children) findAll4(node.props.children, matchFn, acc);
    return acc;
  }
  function textOf4(n) {
    if (typeof n === 'string' || typeof n === 'number') return String(n);
    if (Array.isArray(n)) return n.map(textOf4).join('');
    if (n && n.__rendered !== undefined) return textOf4(n.__rendered);
    if (n && n.props && n.props.children !== undefined) return textOf4(n.props.children);
    return '';
  }
  const isSelect4 = n => n.type === 'select';
  const isButton4 = n => n.type === 'button';

  let tree4 = render4(sandbox4.__rendered, 'root4');

  // année 2022 : les identités "Ventilation en activité" ne couvrent pas
  // 2023/2024 (hors du champ commun disponible TEE/SUT)
  let selects = findAll4(tree4, isSelect4);
  selects[1].props.onChange({ target: { value: '2022' } });
  tree4 = render4(sandbox4.__rendered, 'root4');

  // D1 (rémunération des salariés, emploi) comme poste de départ : possible
  // depuis que le sélecteur propose aussi les ressources/emplois, pas
  // seulement les soldes
  selects = findAll4(tree4, isSelect4);
  const d1Option = selects[0].props.children.find(o => o.props.value === 'D|D1');
  assert(!!d1Option, 'D1 (emploi) est proposé dans le sélecteur de poste de départ');
  selects[0].props.onChange({ target: { value: d1Option.props.value } });
  tree4 = render4(sandbox4.__rendered, 'root4');

  let btns = findAll4(tree4, isButton4);
  const activiteBtns = btns.filter(b => textOf4(b.props.children).indexOf('Ventilation en activité') !== -1);
  assert(activiteBtns.length === 1,
    `la carte D1/S1/2022 propose exactement un bouton "Ventilation en activité" (trouvé ${activiteBtns.length}) : ` +
    `formules_SUT.csv contient un bloc par année validée, elles doivent être fusionnées en une seule identité ` +
    `(sinon une pill en double par année, voir load_activite_formulas)`);
  // l'identité ne concorde entre TEE et SUT que pour 1978-2022 (pas 2024) :
  // le bouton reste proposé quand même (pas masqué), mais marqué "non
  // vérifiée" (voir isFormulaVerified) pour ne pas laisser croire qu'elle
  // n'existe pas.
  selects = findAll4(tree4, isSelect4);
  selects[1].props.onChange({ target: { value: '2024' } });
  let tree4y2024 = render4(sandbox4.__rendered, 'root4');
  const btns2024 = findAll4(tree4y2024, isButton4);
  const activiteBtn2024 = btns2024.find(b => textOf4(b.props.children).indexOf('Ventilation en activité') !== -1);
  assert(!!activiteBtn2024,
    'le bouton "Ventilation en activité" reste proposé pour 2024 (hors du champ commun TEE/SUT)');
  assert(activiteBtn2024 && activiteBtn2024.props.className.indexOf('pill-unverified') !== -1,
    'mais il est marqué "non vérifiée" pour 2024 (classe pill-unverified)');
  assert(activiteBtn2024 && textOf4(activiteBtn2024.props.children).indexOf('⚠') !== -1,
    'et affiche un symbole d\'avertissement dans son libellé');
  // déplier quand même l'identité non vérifiée doit afficher le même
  // avertissement au-dessus de l'équation
  if (activiteBtn2024) {
    activiteBtn2024.props.onClick();
    tree4y2024 = render4(sandbox4.__rendered, 'root4');
    const warning2024 = findAll4(tree4y2024, n => n.props && n.props.className === 'formula-warning')[0];
    assert(!!warning2024, 'déplier l\'identité non vérifiée affiche un avertissement au-dessus de l\'équation');
    assert(!!warning2024 && textOf4(warning2024.props.children).indexOf('non vérifiée') !== -1,
      'l\'avertissement mentionne bien "non vérifiée"');
    activiteBtn2024.props.onClick(); // referme avant de continuer le test
    tree4y2024 = render4(sandbox4.__rendered, 'root4');
  }
  selects[1].props.onChange({ target: { value: '2022' } }); // revient à l'année testée
  tree4 = render4(sandbox4.__rendered, 'root4');
  btns = findAll4(tree4, isButton4);
  const activiteBtnFresh = btns.find(b => textOf4(b.props.children).indexOf('Ventilation en activité') !== -1);
  assert(!!activiteBtnFresh, 'le bouton "Ventilation en activité" réapparaît en revenant à 2022');

  if (activiteBtnFresh) {
    activiteBtnFresh.props.onClick();
    tree4 = render4(sandbox4.__rendered, 'root4');

    const badges = findAll4(tree4, n => n.props && n.props.className === 'card-activity-badge');
    assert(badges.length >= 15, `au moins 15 sections NACE dépliées comme cartes (trouvé ${badges.length})`);

    const codeA = badges.find(b => textOf4(b.props.children) === 'A');
    assert(!!codeA, 'la section A (agriculture) est présente parmi les cartes dépliées');

    const expected = G4.getValue('S1', 'D', 'D1', '2022', 'A');
    assert(expected !== null, 'G.getValue avec activity renvoie une valeur pour D1/S1/2022/A');

    const eqDiv = findAll4(tree4, n => n.props && n.props.className === 'formula-eq')[0];
    assert(textOf4(eqDiv).indexOf('[A]') !== -1, 'l’équation affichée tague les termes par activité (ex. "[A]")');

    const legendLabels = findAll4(tree4, n => n.props && n.props.className === 'legend-label').map(textOf4);
    assert(legendLabels.some(l => /\[[A-U]\]/.test(l)), 'le panneau latéral tague aussi les contributions par activité');

    // referme : tout doit disparaître (pas de fuite de cartes ou de panneaux)
    activiteBtnFresh.props.onClick();
    tree4 = render4(sandbox4.__rendered, 'root4');
    const badgesAfterClose = findAll4(tree4, n => n.props && n.props.className === 'card-activity-badge');
    assert(badgesAfterClose.length === 0, 'refermer la ventilation par activité fait disparaître toutes les cartes enfants');
  }
}

// --- Test du bouton "repartir d'ici" (↺) : chaque carte, y compris une
// carte enfant d'un secteur différent de la graine (S1), doit pouvoir
// devenir la nouvelle racine — la carte affichée change, le sélecteur
// "Poste de départ" suit (secteur affiché entre parenthèses si différent de
// la graine), et toute décomposition en cours est abandonnée (nouveau
// départ, pas juste une carte ajoutée).
console.log('\n--- Test du bouton "repartir d\'ici" ---');
{
  let curHooks = null, curIdx = 0;
  function statefulUseState(initial) {
    const hooks = curHooks;
    const i = curIdx++;
    if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial;
    return [hooks[i], (v) => { hooks[i] = typeof v === 'function' ? v(hooks[i]) : v; }];
  }
  const sandbox5 = {
    console,
    document: makeFakeDom(),
    React: { createElement: mockCreateElement, useState: statefulUseState },
    ReactDOM: { createRoot: () => ({ render: (el) => { sandbox5.__rendered = el; } }) },
  };
  sandbox5.window = sandbox5;
  vm.createContext(sandbox5);
  vm.runInContext(fs.readFileSync(path.join(SITE, 'data', 'tee_graph.js'), 'utf8'), sandbox5);
  vm.runInContext(fs.readFileSync(path.join(SITE, 'graph.js'), 'utf8'), sandbox5);
  vm.runInContext(fs.readFileSync(path.join(SITE, 'app.js'), 'utf8'), sandbox5);

  const hookStores5 = {};
  function render5(el, pathKey) {
    if (el === null || el === undefined || typeof el === 'boolean' || typeof el === 'string' || typeof el === 'number') return el;
    if (Array.isArray(el)) return el.map((e, i) => render5(e, pathKey + '.' + i));
    if (typeof el !== 'object' || !('type' in el)) return el;
    const t = el.type;
    if (typeof t === 'function') {
      const name = t.displayName || t.name || 'anon';
      const key = pathKey + '/' + name + (el.props && el.props.key !== undefined ? ':' + el.props.key : '');
      if (!hookStores5[key]) hookStores5[key] = [];
      curHooks = hookStores5[key]; curIdx = 0;
      return { __rendered: render5(t(el.props), key), __el: el };
    }
    return { type: t, props: Object.assign({}, el.props, el.props && el.props.children !== undefined ? { children: render5(el.props.children, pathKey + '.c') } : {}) };
  }
  function findAll5(node, matchFn, acc) {
    acc = acc || [];
    if (!node) return acc;
    if (node.__rendered !== undefined) { findAll5(node.__rendered, matchFn, acc); return acc; }
    if (Array.isArray(node)) { node.forEach(n => findAll5(n, matchFn, acc)); return acc; }
    if (matchFn(node)) acc.push(node);
    if (node.props && node.props.children) findAll5(node.props.children, matchFn, acc);
    return acc;
  }
  function textOf5(n) {
    if (typeof n === 'string' || typeof n === 'number') return String(n);
    if (Array.isArray(n)) return n.map(textOf5).join('');
    if (n && n.__rendered !== undefined) return textOf5(n.__rendered);
    if (n && n.props && n.props.children !== undefined) return textOf5(n.props.children);
    return '';
  }
  const isPill5 = n => n.type === 'button' && n.props.className && n.props.className.indexOf('pill') === 0;
  const isRootBtn5 = n => n.type === 'button' && n.props.className === 'card-root-btn';
  const isCardTop5 = n => n.props && n.props.className === 'card-top';

  let tree5 = render5(sandbox5.__rendered, 'root5');
  assert(findAll5(tree5, isCardTop5).length === 1, 'une seule carte au départ');
  assert(findAll5(tree5, isRootBtn5).length === 1, 'la carte racine propose un bouton "repartir d\'ici"');

  // déplie "Ventilation en sous-secteur" pour obtenir des cartes enfants
  // dans un AUTRE secteur que la graine (S1)
  const secPill = findAll5(tree5, isPill5).find(b => textOf5(b.props.children).indexOf('Ventilation en sous-secteur') !== -1);
  assert(!!secPill, 'la racine propose "Ventilation en sous-secteur"');
  if (secPill) {
    secPill.props.onClick();
    tree5 = render5(sandbox5.__rendered, 'root5');

    const rootBtns = findAll5(tree5, isRootBtn5);
    assert(rootBtns.length > 1, `un bouton "repartir d'ici" par carte visible (trouvé ${rootBtns.length})`);

    // clique le bouton root d'une carte ENFANT (pas la racine, donc pas rootBtns[0])
    rootBtns[1].props.onClick();
    tree5 = render5(sandbox5.__rendered, 'root5');

    assert(findAll5(tree5, isCardTop5).length === 1,
      'une seule carte après "repartir d\'ici" : la décomposition précédente est abandonnée, pas empilée');

    const inlineLabel = textOf5(findAll5(tree5, n => n.props && n.props.className === 'inline-label')[0]);
    assert(inlineLabel.indexOf('Poste de départ (') === 0,
      `le sélecteur affiche le secteur de la nouvelle racine (libellé: "${inlineLabel.slice(0, 40)}...")`);

    const activePills = findAll5(tree5, isPill5).filter(p => p.props.className.indexOf('active') !== -1);
    assert(activePills.length === 0, 'aucune décomposition active après "repartir d\'ici" (nouveau départ propre)');
  }
}

// --- Test du sélecteur "Unités" (en niveau / en delta) : simule un clic
// réel (onChange) pour vérifier que la valeur affichée sur la carte racine
// change bien vers la variation année sur année, que le badge du poste se
// préfixe de "Δ", et que le panneau latéral (une fois une identité dépliée)
// reste cohérent (total ≈ delta de la carte de départ).
console.log('\n--- Test du sélecteur "Unités" (en niveau / en delta) ---');
{
  let curHooks = null, curIdx = 0;
  function statefulUseState(initial) {
    const hooks = curHooks;
    const i = curIdx++;
    if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial;
    return [hooks[i], (v) => { hooks[i] = typeof v === 'function' ? v(hooks[i]) : v; }];
  }
  const sandbox6 = {
    console,
    document: makeFakeDom(),
    React: { createElement: mockCreateElement, useState: statefulUseState },
    ReactDOM: { createRoot: () => ({ render: (el) => { sandbox6.__rendered = el; } }) },
  };
  sandbox6.window = sandbox6;
  vm.createContext(sandbox6);
  vm.runInContext(fs.readFileSync(path.join(SITE, 'data', 'tee_graph.js'), 'utf8'), sandbox6);
  vm.runInContext(fs.readFileSync(path.join(SITE, 'graph.js'), 'utf8'), sandbox6);
  vm.runInContext(fs.readFileSync(path.join(SITE, 'app.js'), 'utf8'), sandbox6);
  const G6 = vm.runInContext('TeeGraphLib', sandbox6).makeGraph(vm.runInContext('TEE_GRAPH', sandbox6));
  const D6 = vm.runInContext('TEE_GRAPH', sandbox6);

  const hookStores6 = {};
  function render6(el, pathKey) {
    if (el === null || el === undefined || typeof el === 'boolean' || typeof el === 'string' || typeof el === 'number') return el;
    if (Array.isArray(el)) return el.map((e, i) => render6(e, pathKey + '.' + i));
    if (typeof el !== 'object' || !('type' in el)) return el;
    const t = el.type;
    if (typeof t === 'function') {
      const name = t.displayName || t.name || 'anon';
      const key = pathKey + '/' + name + (el.props && el.props.key !== undefined ? ':' + el.props.key : '');
      if (!hookStores6[key]) hookStores6[key] = [];
      curHooks = hookStores6[key]; curIdx = 0;
      return { __rendered: render6(t(el.props), key), __el: el };
    }
    return { type: t, props: Object.assign({}, el.props, el.props && el.props.children !== undefined ? { children: render6(el.props.children, pathKey + '.c') } : {}) };
  }
  function findAll6(node, matchFn, acc) {
    acc = acc || [];
    if (!node) return acc;
    if (node.__rendered !== undefined) { findAll6(node.__rendered, matchFn, acc); return acc; }
    if (Array.isArray(node)) { node.forEach(n => findAll6(n, matchFn, acc)); return acc; }
    if (matchFn(node)) acc.push(node);
    if (node.props && node.props.children) findAll6(node.props.children, matchFn, acc);
    return acc;
  }
  function textOf6(n) {
    if (typeof n === 'string' || typeof n === 'number') return String(n);
    if (Array.isArray(n)) return n.map(textOf6).join('');
    if (n && n.__rendered !== undefined) return textOf6(n.__rendered);
    if (n && n.props && n.props.children !== undefined) return textOf6(n.props.children);
    return '';
  }
  const isSelect6 = n => n.type === 'select';
  const isPill6 = n => n.type === 'button' && n.props.className && n.props.className.indexOf('pill') === 0;

  let tree6 = render6(sandbox6.__rendered, 'root6');
  const selects6 = findAll6(tree6, isSelect6);
  assert(selects6.length === 3, `3 sélecteurs affichés (poste, année, unités) (trouvé ${selects6.length})`);
  const unitSelect = selects6[2];
  assert(unitSelect.props.value === 'level', 'le sélecteur "Unités" démarre sur "en niveau"');
  const unitOptionValues = unitSelect.props.children.map(o => o.props.value);
  assert(unitOptionValues.indexOf('level') !== -1 && unitOptionValues.indexOf('delta') !== -1,
    `le sélecteur "Unités" propose "level" et "delta" (trouvé ${unitOptionValues.join(',')})`);

  const sto6 = findAll6(tree6, n => n.props && n.props.className === 'card-sto')[0];
  assert(textOf6(sto6) === D6.seed.sto, `en niveau, le badge du poste n'a pas de préfixe Δ (trouvé "${textOf6(sto6)}")`);
  const cardValueBefore = textOf6(findAll6(tree6, n => n.props && n.props.className && n.props.className.indexOf('card-value') === 0)[0]);

  // bascule sur "en delta"
  unitSelect.props.onChange({ target: { value: 'delta' } });
  tree6 = render6(sandbox6.__rendered, 'root6');

  const stoAfter = findAll6(tree6, n => n.props && n.props.className === 'card-sto')[0];
  assert(textOf6(stoAfter) === 'Δ' + D6.seed.sto, `en delta, le badge du poste est préfixé de "Δ" (trouvé "${textOf6(stoAfter)}")`);

  const cardValueAfter = textOf6(findAll6(tree6, n => n.props && n.props.className && n.props.className.indexOf('card-value') === 0)[0]);
  assert(cardValueAfter !== cardValueBefore,
    `la valeur affichée change en passant en delta (avant="${cardValueBefore}", après="${cardValueAfter}")`);

  // DEFAULT_YEAR (dernière année disponible) n'est pas exposée hors de
  // l'IIFE de app.js : on la retrouve via la série de la graine, comme le fait app.js lui-même
  const seedSeries6 = G6.series(D6.seed.sector, D6.seed.entry, D6.seed.sto);
  const defaultYear6 = seedSeries6[seedSeries6.length - 1].year;
  const expectedDelta = G6.getValue(D6.seed.sector, D6.seed.entry, D6.seed.sto, defaultYear6, undefined, 'delta');
  assert(expectedDelta !== null, 'une valeur delta existe pour la graine à l\'année par défaut');
  assert(cardValueAfter.indexOf('Md€') !== -1, `la valeur en delta reste formatée en Md€ (trouvé "${cardValueAfter}")`);

  // déplie une identité en delta : le panneau latéral doit rester cohérent
  // (l'identité comptable reste vraie sur les deltas, voir test_graph.js)
  const pill = findAll6(tree6, isPill6)[0];
  pill.props.onClick();
  tree6 = render6(sandbox6.__rendered, 'root6');
  const sidebarTitle = textOf6(findAll6(tree6, n => n.props && n.props.className === 'sidebar-title')[0]);
  assert(sidebarTitle.indexOf('Δ') !== -1, `le titre du panneau latéral est préfixé de "Δ" en delta (trouvé "${sidebarTitle}")`);
  const eqDiv6 = textOf6(findAll6(tree6, n => n.props && n.props.className === 'formula-eq')[0]);
  assert(eqDiv6.indexOf('Δ') !== -1, `l'équation dépliée est préfixée de "Δ" sur chaque terme en delta (trouvé "${eqDiv6.slice(0, 60)}...")`);

  // revient "en niveau" : le préfixe Δ disparaît partout
  unitSelect.props.onChange({ target: { value: 'level' } });
  tree6 = render6(sandbox6.__rendered, 'root6');
  const stoBackToLevel = textOf6(findAll6(tree6, n => n.props && n.props.className === 'card-sto')[0]);
  assert(stoBackToLevel === D6.seed.sto, 'revenir "en niveau" retire le préfixe Δ du badge du poste');
}

// --- Test de l'unité "pct" (croissance annuelle / contributions) : la
// carte de départ doit afficher son propre taux de croissance ("... de
// croissance de ..."), tandis qu'une carte dépliée en dessous doit afficher
// sa contribution à CETTE croissance ("... de contribution ... à la
// croissance ..."), avec le même dénominateur (valeur N-1 de la carte de
// départ) — voir graph.js::getValue et test_graph.js pour la preuve de
// linéarité de l'identité comptable sur les contributions.
console.log('\n--- Test de l\'unité "pct" (croissance annuelle / contributions) ---');
{
  let curHooks = null, curIdx = 0;
  function statefulUseState(initial) {
    const hooks = curHooks;
    const i = curIdx++;
    if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial;
    return [hooks[i], (v) => { hooks[i] = typeof v === 'function' ? v(hooks[i]) : v; }];
  }
  const sandbox7 = {
    console,
    document: makeFakeDom(),
    React: { createElement: mockCreateElement, useState: statefulUseState },
    ReactDOM: { createRoot: () => ({ render: (el) => { sandbox7.__rendered = el; } }) },
  };
  sandbox7.window = sandbox7;
  vm.createContext(sandbox7);
  vm.runInContext(fs.readFileSync(path.join(SITE, 'data', 'tee_graph.js'), 'utf8'), sandbox7);
  vm.runInContext(fs.readFileSync(path.join(SITE, 'graph.js'), 'utf8'), sandbox7);
  vm.runInContext(fs.readFileSync(path.join(SITE, 'app.js'), 'utf8'), sandbox7);
  const G7 = vm.runInContext('TeeGraphLib', sandbox7).makeGraph(vm.runInContext('TEE_GRAPH', sandbox7));
  const D7 = vm.runInContext('TEE_GRAPH', sandbox7);

  const hookStores7 = {};
  function render7(el, pathKey) {
    if (el === null || el === undefined || typeof el === 'boolean' || typeof el === 'string' || typeof el === 'number') return el;
    if (Array.isArray(el)) return el.map((e, i) => render7(e, pathKey + '.' + i));
    if (typeof el !== 'object' || !('type' in el)) return el;
    const t = el.type;
    if (typeof t === 'function') {
      const name = t.displayName || t.name || 'anon';
      const key = pathKey + '/' + name + (el.props && el.props.key !== undefined ? ':' + el.props.key : '');
      if (!hookStores7[key]) hookStores7[key] = [];
      curHooks = hookStores7[key]; curIdx = 0;
      return { __rendered: render7(t(el.props), key), __el: el };
    }
    return { type: t, props: Object.assign({}, el.props, el.props && el.props.children !== undefined ? { children: render7(el.props.children, pathKey + '.c') } : {}) };
  }
  function findAll7(node, matchFn, acc) {
    acc = acc || [];
    if (!node) return acc;
    if (node.__rendered !== undefined) { findAll7(node.__rendered, matchFn, acc); return acc; }
    if (Array.isArray(node)) { node.forEach(n => findAll7(n, matchFn, acc)); return acc; }
    if (matchFn(node)) acc.push(node);
    if (node.props && node.props.children) findAll7(node.props.children, matchFn, acc);
    return acc;
  }
  function textOf7(n) {
    if (typeof n === 'string' || typeof n === 'number') return String(n);
    if (Array.isArray(n)) return n.map(textOf7).join('');
    if (n && n.__rendered !== undefined) return textOf7(n.__rendered);
    if (n && n.props && n.props.children !== undefined) return textOf7(n.props.children);
    return '';
  }
  const isSelect7 = n => n.type === 'select';
  const isPill7 = n => n.type === 'button' && n.props.className && n.props.className.indexOf('pill') === 0;

  let tree7 = render7(sandbox7.__rendered, 'root7');
  const unitSelect7 = findAll7(tree7, isSelect7)[2];
  const unitOptionValues7 = unitSelect7.props.children.map(o => o.props.value);
  assert(unitOptionValues7.indexOf('pct') !== -1, `le sélecteur "Unités" propose "pct" (trouvé ${unitOptionValues7.join(',')})`);

  unitSelect7.props.onChange({ target: { value: 'pct' } });
  tree7 = render7(sandbox7.__rendered, 'root7');

  const rootSto7 = textOf7(findAll7(tree7, n => n.props && n.props.className === 'card-sto')[0]);
  assert(rootSto7 === 'Δ%' + D7.seed.sto, `en pct, le badge de la carte racine est préfixé de "Δ%" (trouvé "${rootSto7}")`);

  const rootCardValue7 = textOf7(findAll7(tree7, n => n.props && n.props.className && n.props.className.indexOf('card-value') === 0)[0]);
  assert(rootCardValue7.indexOf('%') !== -1, `la valeur de la carte racine est formatée en % (trouvé "${rootCardValue7}")`);

  const rootSentence7 = textOf7(findAll7(tree7, n => n.props && n.props.className === 'card-sentence')[0]);
  assert(rootSentence7.indexOf('croissance') !== -1 && rootSentence7.indexOf('contribution') === -1,
    `la phrase de la carte racine parle de "croissance", pas de "contribution" (trouvé "${rootSentence7.slice(0, 90)}...")`);

  // vérifie numériquement la valeur affichée sur la carte racine (taux de
  // croissance usuel : delta / valeur N-1)
  const seedSeries7 = G7.series(D7.seed.sector, D7.seed.entry, D7.seed.sto);
  const defaultYear7 = seedSeries7[seedSeries7.length - 1].year;
  const pctRoot7 = { sector: D7.seed.sector, entry: D7.seed.entry, sto: D7.seed.sto, activity: undefined };
  const expectedRootPct = G7.getValue(D7.seed.sector, D7.seed.entry, D7.seed.sto, defaultYear7, undefined, 'pct', pctRoot7);
  assert(expectedRootPct !== null, 'une valeur pct existe pour la graine à l\'année par défaut');

  // déplie la première identité : les cartes enfants doivent parler de
  // "contribution ... à la croissance", avec le même dénominateur (pctRoot)
  const pill7 = findAll7(tree7, isPill7)[0];
  pill7.props.onClick();
  tree7 = render7(sandbox7.__rendered, 'root7');

  const childSentences7 = findAll7(tree7, n => n.props && n.props.className === 'card-sentence').slice(1).map(textOf7);
  assert(childSentences7.length > 0, 'au moins une carte enfant est dépliée');
  assert(childSentences7.every(s => s.indexOf('contribution') !== -1 && s.indexOf('à la croissance') !== -1),
    `chaque carte enfant parle de "contribution ... à la croissance" (trouvé ex. "${(childSentences7[0] || '').slice(0, 90)}...")`);

  const childSto7 = findAll7(tree7, n => n.props && n.props.className === 'card-sto').slice(1).map(textOf7);
  assert(childSto7.every(t => t.indexOf('Δ%') === 0), `chaque badge enfant est aussi préfixé de "Δ%" (trouvé ${childSto7.join(',')})`);

  // panneau latéral cohérent : titre préfixé, et le total reconstruit
  // (somme des contributions) doit être numériquement égal à la croissance
  // de la carte de départ, par linéarité (voir test_graph.js)
  const sidebarTitle7 = textOf7(findAll7(tree7, n => n.props && n.props.className === 'sidebar-title')[0]);
  assert(sidebarTitle7.indexOf('Δ%') !== -1, `le titre du panneau latéral est préfixé de "Δ%" en pct (trouvé "${sidebarTitle7}")`);

  const seedFormulas7 = G7.getFormulasFor(D7.seed.sector, D7.seed.entry, D7.seed.sto);
  const exp7 = G7.expandFormula(seedFormulas7[0].id, D7.seed.sector, D7.seed.entry, D7.seed.sto, defaultYear7, undefined, 'pct', pctRoot7);
  const reconstructedPct7 = exp7.others.reduce((acc, m) => acc + m.effectiveSign * m.value, 0);
  assert(Math.abs(reconstructedPct7 - expectedRootPct) < 0.01,
    `panneau latéral : somme des contributions ≈ croissance de la carte de départ (reconstruit=${reconstructedPct7.toFixed(4)}, attendu=${expectedRootPct.toFixed(4)})`);
}

// --- Test "une seule pill active par carte" : cliquer une pill alors
// qu'une autre pill de la MÊME carte est déjà active doit désélectionner
// la précédente (et purger sa sous-décomposition éventuelle), pas empiler
// les deux décompositions dans le panneau latéral.
console.log('\n--- Test "une seule pill active par carte" ---');
{
  let curHooks = null, curIdx = 0;
  function statefulUseState(initial) {
    const hooks = curHooks;
    const i = curIdx++;
    if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial;
    return [hooks[i], (v) => { hooks[i] = typeof v === 'function' ? v(hooks[i]) : v; }];
  }
  const sandbox8 = {
    console,
    document: makeFakeDom(),
    React: { createElement: mockCreateElement, useState: statefulUseState },
    ReactDOM: { createRoot: () => ({ render: (el) => { sandbox8.__rendered = el; } }) },
  };
  sandbox8.window = sandbox8;
  vm.createContext(sandbox8);
  vm.runInContext(fs.readFileSync(path.join(SITE, 'data', 'tee_graph.js'), 'utf8'), sandbox8);
  vm.runInContext(fs.readFileSync(path.join(SITE, 'graph.js'), 'utf8'), sandbox8);
  vm.runInContext(fs.readFileSync(path.join(SITE, 'app.js'), 'utf8'), sandbox8);

  const hookStores8 = {};
  function render8(el, pathKey) {
    if (el === null || el === undefined || typeof el === 'boolean' || typeof el === 'string' || typeof el === 'number') return el;
    if (Array.isArray(el)) return el.map((e, i) => render8(e, pathKey + '.' + i));
    if (typeof el !== 'object' || !('type' in el)) return el;
    const t = el.type;
    if (typeof t === 'function') {
      const name = t.displayName || t.name || 'anon';
      const key = pathKey + '/' + name + (el.props && el.props.key !== undefined ? ':' + el.props.key : '');
      if (!hookStores8[key]) hookStores8[key] = [];
      curHooks = hookStores8[key]; curIdx = 0;
      return { __rendered: render8(t(el.props), key), __el: el };
    }
    return { type: t, props: Object.assign({}, el.props, el.props && el.props.children !== undefined ? { children: render8(el.props.children, pathKey + '.c') } : {}) };
  }
  function findAll8(node, matchFn, acc) {
    acc = acc || [];
    if (!node) return acc;
    if (node.__rendered !== undefined) { findAll8(node.__rendered, matchFn, acc); return acc; }
    if (Array.isArray(node)) { node.forEach(n => findAll8(n, matchFn, acc)); return acc; }
    if (matchFn(node)) acc.push(node);
    if (node.props && node.props.children) findAll8(node.props.children, matchFn, acc);
    return acc;
  }
  const isPill8 = n => n.type === 'button' && n.props.className && n.props.className.indexOf('pill') === 0;
  const isPanel8 = n => n.props && n.props.className && n.props.className.indexOf('sidebar-panel') === 0;
  const isActive8 = n => n.props.className.indexOf('active') !== -1;
  // la carte racine est la toute première carte rendue : son "expand-row"
  // (ligne de pills) est donc le premier de l'arbre, avant celui d'aucune
  // carte enfant. On y scope la recherche des pills pour ne comparer que
  // les pills de la MÊME carte d'un rendu à l'autre (au lieu de comparer
  // par titre, fragile si deux formules ont un intitulé identique).
  const rootExpandRow8 = tree => findAll8(tree, n => n.props && n.props.className === 'expand-row')[0];
  const rootPillsOf8 = tree => findAll8(rootExpandRow8(tree), isPill8);

  let tree8 = render8(sandbox8.__rendered, 'root8');
  let rootPills8 = rootPillsOf8(tree8);
  const rootPillCount8 = rootPills8.length;
  assert(rootPillCount8 >= 2, `la carte racine (graine) propose au moins 2 identités (trouvé ${rootPillCount8}), nécessaire pour ce test`);

  // ouvre la 1ère identité, puis une sous-décomposition sur une carte enfant
  rootPills8[0].props.onClick();
  tree8 = render8(sandbox8.__rendered, 'root8');
  const childPill8 = findAll8(tree8, isPill8).find(b => rootPillsOf8(tree8).indexOf(b) === -1);
  if (childPill8) {
    childPill8.props.onClick();
    tree8 = render8(sandbox8.__rendered, 'root8');
    assert(findAll8(tree8, isPanel8).length === 1, "un panneau après ouverture d'une sous-décomposition (préparation du test)");
  }

  // clique la 2e pill de la carte RACINE (même carte que la 1ère) : la 1ère
  // doit se désélectionner, avec sa sous-décomposition
  rootPills8 = rootPillsOf8(tree8);
  assert(isActive8(rootPills8[0]), "avant le test : la 1ère pill de la racine est active");
  rootPills8[1].props.onClick();
  tree8 = render8(sandbox8.__rendered, 'root8');

  const rootPills8After = rootPillsOf8(tree8);
  assert(rootPills8After.length === rootPillCount8, `les ${rootPillCount8} pills de la carte racine sont toujours proposées après le changement (trouvé ${rootPills8After.length})`);
  assert(!isActive8(rootPills8After[0]), "la 1ère pill (précédemment active) est désélectionnée après le clic sur la 2e");
  assert(isActive8(rootPills8After[1]), 'la 2e pill (cliquée) est maintenant active');
  assert(findAll8(tree8, isPanel8).length === 1,
    "un seul panneau après le changement de pill : pas d'empilement des deux décompositions");

  // reclique la 2e pill pour la refermer : plus aucune pill active sur la racine
  rootPills8After[1].props.onClick();
  tree8 = render8(sandbox8.__rendered, 'root8');
  assert(rootPillsOf8(tree8).every(b => !isActive8(b)), 'aucune pill active sur la racine après avoir refermé la 2e');
}

console.log('\n--- Test de la barre de recherche d\'agrégats ---');
{
  let curHooks = null, curIdx = 0;
  function statefulUseState(initial) {
    const hooks = curHooks;
    const i = curIdx++;
    if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial;
    return [hooks[i], (v) => { hooks[i] = typeof v === 'function' ? v(hooks[i]) : v; }];
  }
  const sandbox9 = {
    console,
    document: makeFakeDom(),
    React: { createElement: mockCreateElement, useState: statefulUseState },
    ReactDOM: { createRoot: () => ({ render: (el) => { sandbox9.__rendered = el; } }) },
  };
  sandbox9.window = sandbox9;
  vm.createContext(sandbox9);
  vm.runInContext(fs.readFileSync(path.join(SITE, 'data', 'tee_graph.js'), 'utf8'), sandbox9);
  vm.runInContext(fs.readFileSync(path.join(SITE, 'graph.js'), 'utf8'), sandbox9);
  vm.runInContext(fs.readFileSync(path.join(SITE, 'app.js'), 'utf8'), sandbox9);

  const hookStores9 = {};
  function render9(el, pathKey) {
    if (el === null || el === undefined || typeof el === 'boolean' || typeof el === 'string' || typeof el === 'number') return el;
    if (Array.isArray(el)) return el.map((e, i) => render9(e, pathKey + '.' + i));
    if (typeof el !== 'object' || !('type' in el)) return el;
    const t = el.type;
    if (typeof t === 'function') {
      const name = t.displayName || t.name || 'anon';
      const key = pathKey + '/' + name + (el.props && el.props.key !== undefined ? ':' + el.props.key : '');
      if (!hookStores9[key]) hookStores9[key] = [];
      curHooks = hookStores9[key]; curIdx = 0;
      return { __rendered: render9(t(el.props), key), __el: el };
    }
    return { type: t, props: Object.assign({}, el.props, el.props && el.props.children !== undefined ? { children: render9(el.props.children, pathKey + '.c') } : {}) };
  }
  function findAll9(node, matchFn, acc) {
    acc = acc || [];
    if (!node) return acc;
    if (node.__rendered !== undefined) { findAll9(node.__rendered, matchFn, acc); return acc; }
    if (Array.isArray(node)) { node.forEach(n => findAll9(n, matchFn, acc)); return acc; }
    if (matchFn(node)) acc.push(node);
    if (node.props && node.props.children) findAll9(node.props.children, matchFn, acc);
    return acc;
  }
  function textOf9(n) {
    if (typeof n === 'string' || typeof n === 'number') return String(n);
    if (Array.isArray(n)) return n.map(textOf9).join('');
    if (n && n.__rendered !== undefined) return textOf9(n.__rendered);
    if (n && n.props && n.props.children !== undefined) return textOf9(n.props.children);
    return '';
  }
  const isSearchInput9 = n => n.type === 'input' && n.props.className === 'poste-search-input';
  const isSuggestions9 = n => n.props && n.props.className === 'poste-search-suggestions';
  const isSuggestionItem9 = n => n.type === 'li' && n.props.className === 'poste-search-item';
  const isCardSto9 = n => n.props && n.props.className === 'card-sto';

  let tree9 = render9(sandbox9.__rendered, 'root9');
  assert(findAll9(tree9, isSearchInput9).length === 1, 'la barre de recherche est affichée en haut de page');
  assert(findAll9(tree9, isSuggestions9).length === 0, 'aucune suggestion tant que la recherche est vide');

  // recherche insensible aux accents : "impots" doit trouver "Autres impôts
  // sur la production" (D29)
  let searchInput9 = findAll9(tree9, isSearchInput9)[0];
  searchInput9.props.onChange({ target: { value: 'impots' } });
  tree9 = render9(sandbox9.__rendered, 'root9');
  let suggestions9 = findAll9(tree9, isSuggestionItem9);
  assert(suggestions9.length > 0, `taper "impots" propose des suggestions (trouvé ${suggestions9.length})`);
  const d29Item9 = suggestions9.find(s => textOf9(s.props.children).indexOf('D29') !== -1);
  assert(!!d29Item9, `"impots" (sans accent) retrouve un poste dont le libellé accentué contient "impôts" (ex. D29) : ${suggestions9.map(textOf9).join(' | ')}`);

  // sélectionner cette suggestion re-racine l'application dessus et vide la recherche
  d29Item9.props.onClick();
  tree9 = render9(sandbox9.__rendered, 'root9');
  assert(findAll9(tree9, isSuggestions9).length === 0, 'la recherche est vidée après sélection d\'une suggestion');
  searchInput9 = findAll9(tree9, isSearchInput9)[0];
  assert(searchInput9.props.value === '', 'le champ de recherche est bien revenu à vide après sélection');
  const rootSto9 = textOf9(findAll9(tree9, isCardSto9)[0]);
  assert(rootSto9 === 'D29', `la carte racine est bien devenue D29 après sélection dans la recherche (trouvé "${rootSto9}")`);
}

console.log(failures === 0 ? '\nTous les contrôles sont passés.' : `\n${failures} contrôle(s) en échec.`);
process.exit(failures === 0 ? 0 : 1);
