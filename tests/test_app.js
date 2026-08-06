// Harnais de test minimal (sans dépendance externe) : simule assez du DOM et
// de Chart.js pour exécuter site/app.js dans Node et détecter les erreurs
// runtime, ainsi que quelques contrôles de cohérence sur les données.
// Lancer depuis la racine du dépôt : node tests/test_app.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SITE = path.join(__dirname, '..', 'site');

function makeEl(tag) {
  const el = {
    tagName: tag, children: [], style: {}, dataset: {}, classList: {
      _set: new Set(),
      add(c) { this._set.add(c); }, remove(c) { this._set.delete(c); },
      contains(c) { return this._set.has(c); },
    },
    listeners: {},
    _text: '', _html: '',
    addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
    appendChild(child) { this.children.push(child); return child; },
    querySelectorAll() { return []; },
    querySelector() { return makeEl('tbody'); },
    getContext() { return {}; },
  };
  Object.defineProperty(el, 'textContent', { get() { return this._text; }, set(v) { this._text = String(v); } });
  Object.defineProperty(el, 'innerHTML', { get() { return this._html; }, set(v) { this._html = String(v); } });
  Object.defineProperty(el, 'className', { get() { return [...this.classList._set].join(' '); }, set(v) { this.classList._set = new Set(String(v).split(' ').filter(Boolean)); } });
  return el;
}

const registry = {};
function el(id) { if (!registry[id]) registry[id] = makeEl('div'); return registry[id]; }

const fakeDocument = {
  getElementById(id) { return el(id); },
  createElement(tag) { return makeEl(tag); },
  querySelector(sel) { return makeEl('tbody'); },
  documentElement: { },
};

let chartInstances = [];
class FakeChart {
  constructor(ctx, config) { this.ctx = ctx; this.config = config; this.data = config.data; this.options = config.options; chartInstances.push(this); }
  update() {}
  destroy() {}
}

const sandbox = {
  console,
  document: fakeDocument,
  window: {},
  getComputedStyle: () => ({ getPropertyValue: () => '#000000' }),
  Chart: FakeChart,
};
vm.createContext(sandbox);

const dataSrc = fs.readFileSync(path.join(SITE, 'data', 'tee_data.js'), 'utf8');
vm.runInContext(dataSrc, sandbox, { filename: 'tee_data.js' });

const appSrc = fs.readFileSync(path.join(SITE, 'app.js'), 'utf8');
try {
  vm.runInContext(appSrc, sandbox, { filename: 'app.js' });
  console.log('app.js exécuté sans erreur.');
} catch (e) {
  console.error('ERREUR pendant exécution app.js:', e);
  process.exit(1);
}

console.log('Nombre de graphiques créés (Chart):', chartInstances.length);
chartInstances.forEach((c, i) => {
  const type = c.config.type;
  const nLabels = c.data.labels ? c.data.labels.length : '?';
  const nDatasets = c.data.datasets.length;
  console.log(`  #${i}: type=${type} labels=${nLabels} datasets=${nDatasets}`);
  c.data.datasets.forEach((ds, j) => {
    const bad = (ds.data || []).some(v => {
      if (Array.isArray(v)) return v.some(x => x !== null && typeof x !== 'number');
      return v !== null && typeof v !== 'number';
    });
    if (bad) console.error(`   dataset ${j} contient une valeur non numérique inattendue`);
  });
});

// Vérifications de cohérence sur les données elles-mêmes
const D = vm.runInContext('TEE_DATA', sandbox);
let issues = 0;
for (const sec of D.secteurs) {
  const years = Object.keys(D.balances[sec] || {});
  if (years.length === 0) { console.error('Aucune donnée pour', sec); issues++; }
}
const b9_2024_S1 = D.balances.S1['2024'].B9;
console.log('B9 France entière 2024 (Md€):', (b9_2024_S1 / 1000).toFixed(1));
if (Math.abs(b9_2024_S1) > 500000) { console.error('Valeur B9 suspecte (hors échelle plausible)'); issues++; }

console.log(issues === 0 ? 'Contrôles de cohérence : OK' : `Contrôles de cohérence : ${issues} problème(s)`);
