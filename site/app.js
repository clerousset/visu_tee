// Explorateur du Tableau Économique d'Ensemble : chaque carte représente une
// valeur observée (secteur x poste x position comptable x année). Si cette
// valeur participe à une identité comptable (data/formules_TEE.csv), des
// boutons permettent de déplier les autres valeurs de cette identité.
// Écrit sans JSX (React.createElement direct) pour ne dépendre d'aucun outil
// de compilation : voir graph.js pour la logique de lookup / expansion.
(function () {
  const h = React.createElement;
  const G = TeeGraphLib.makeGraph(TEE_GRAPH);
  const D = TEE_GRAPH;

  const YEARS = (() => {
    const s = new Set();
    Object.values(D.values).forEach(byEntry =>
      Object.values(byEntry).forEach(bySto =>
        Object.values(bySto).forEach(byYear => Object.keys(byYear).forEach(y => s.add(+y)))
      )
    );
    return [...s].sort((a, b) => a - b);
  })();
  const DEFAULT_YEAR = YEARS[YEARS.length - 1];

  function fmtMd(v) {
    if (v === null || v === undefined) return '—';
    return (v / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + ' Md€';
  }

  function lowerFirst(str) { return str ? str.charAt(0).toLowerCase() + str.slice(1) : str; }

  // palette catégorielle pour distinguer chaque contribution de l'histogramme
  // empilé (une couleur par membre, indépendante du signe)
  const STACK_PALETTE = [
    '#5b8def', '#ff8a5c', '#7ee0c3', '#e6c94f', '#c98bf0',
    '#ff6b9d', '#4fd18b', '#f0a04b', '#6bc9ff', '#d17ee0',
  ];
  function colorForIndex(i) { return STACK_PALETTE[i % STACK_PALETTE.length]; }

  // suffixe le code STO par sa position (_C / _D) quand elle est ambiguë :
  // un même poste (ex. D7) peut apparaître à la fois en ressource et en
  // emploi dans une même identité, d'où "D7_C" vs "D7_D"
  function stoWithEntry(sto, entry) {
    return (entry === 'C' || entry === 'D') ? sto + '_' + entry : sto;
  }

  // article + libellé corrects pour "pour {sector}" en français (les 6
  // secteurs sont fixes, donc autant écrire l'accord une bonne fois)
  const SECTOR_PHRASE = {
    S1: 'l’économie totale',
    S11: 'les sociétés non financières',
    S12: 'les sociétés financières',
    S13: 'les administrations publiques',
    S14: 'les ménages',
    S15: 'les institutions sans but lucratif au service des ménages',
  };
  function sectorPhrase(sector) { return SECTOR_PHRASE[sector] || lowerFirst(G.sectorLabel(sector)); }

  function rootStoOptions(sector) {
    const bySto = (D.values[sector] || {}).B || {};
    return Object.keys(bySto).sort();
  }

  // ---------- Icône + mini-graphique au survol (série annuelle complète) ----------
  function SeriesHover({ sector, entry, sto, year }) {
    const s = G.series(sector, entry, sto);
    if (s.length < 2) return null; // pas assez de points pour un graphique utile
    const geom = TeeGraphLib.sparklineGeometry(s, { width: 240, height: 84, pad: 10 });
    const current = s.find(p => p.year === year);
    const dot = current ? h('circle', {
      key: 'dot', cx: geom.xFor(current.year), cy: geom.yFor(current.value), r: 3, className: 'spark-dot',
    }) : null;
    const zero = geom.zeroY !== null ? h('line', {
      key: 'zero', x1: 0, x2: geom.width, y1: geom.zeroY, y2: geom.zeroY, className: 'spark-zero',
    }) : null;

    return h('span', { className: 'series-hover' }, [
      h('svg', { key: 'icon', className: 'series-icon', viewBox: '0 0 16 16', 'aria-hidden': 'true' }, [
        h('polyline', { key: 'p', points: '1,13 5,8 8,10.5 11,4 15,7', className: 'series-icon-line' }),
      ]),
      h('div', { className: 'series-popover', key: 'pop' }, [
        h('div', { className: 'series-popover-title', key: 'title' },
          G.stoLabel(sto) + ' — ' + G.sectorLabel(sector) + ' (' + geom.minYear + '–' + geom.maxYear + ')'
        ),
        h('svg', { key: 'chart', viewBox: '0 0 ' + geom.width + ' ' + geom.height, className: 'series-chart' }, [
          zero,
          h('polyline', { key: 'line', points: geom.points, className: 'spark-line' }),
          dot,
        ]),
        h('div', { className: 'series-popover-range', key: 'range' }, [
          h('span', { key: 'min' }, 'min ' + fmtMd(geom.minV)),
          h('span', { key: 'max' }, 'max ' + fmtMd(geom.maxV)),
        ]),
      ]),
    ]);
  }

  // ---------- Carte ----------
  function Card({ sector, entry, sto, year, value, effectiveSign, hasFormulas }) {
    const signClass = value === null ? '' : value >= 0 ? 'pos' : 'neg';
    const meaningText = lowerFirst(G.stoLabel(sto));

    const sentence = h('p', { className: 'card-sentence', key: 'sentence' }, [
      'Les ',
      h('strong', { className: 'card-value ' + signClass, key: 'val' }, fmtMd(value)),
      ' ',
      h(SeriesHover, { key: 'series', sector, entry, sto, year }),
      ' de ' + meaningText + ' de ' + year,
      ' pour ' + sectorPhrase(sector) + (hasFormulas ? ' peuvent se décomposer :' : '.'),
    ]);

    const children = [
      h('div', { className: 'card-top', key: 'top' }, [
        h('span', { className: 'card-sto', key: 'sto' }, sto),
        h('span', { className: 'card-entry-badge entry-' + entry, key: 'entry' }, G.entryLabel(entry)),
      ]),
      sentence,
    ];
    if (effectiveSign !== undefined) {
      children.push(
        h('div', { className: 'sign-badge ' + (effectiveSign > 0 ? 'pos' : 'neg'), key: 'sign' },
          effectiveSign > 0 ? '+' : '−')
      );
    }
    return h('div', { className: 'card' }, children);
  }

  // ---------- Groupe de formule déplié (équation + cartes enfants) ----------
  function FormulaGroup({ sector, entry, sto, year, formulaId, depth }) {
    const exp = G.expandFormula(formulaId, sector, entry, sto, year);
    if (!exp) return null;
    const eqParts = exp.others.map(m => {
      const sign = m.effectiveSign > 0 ? '+' : '−';
      const sectorTag = m.sector !== sector ? ' (' + m.sector + ')' : '';
      return sign + ' ' + stoWithEntry(m.sto, m.entry) + sectorTag;
    });
    return h('div', { className: 'formula-group' }, [
      h('div', { className: 'formula-eq', key: 'eq' }, stoWithEntry(sto, entry) + ' = ' + eqParts.join(' ')),
      h('div', { className: 'formula-children', key: 'ch' },
        exp.others.map(m =>
          h(CardNode, {
            key: m.sector + '|' + m.entry + '|' + m.sto,
            sector: m.sector,
            entry: m.entry,
            sto: m.sto,
            year,
            effectiveSign: m.effectiveSign,
            depth: depth + 1,
            excludeFormulaId: formulaId,
          })
        )
      ),
    ]);
  }

  // ---------- Nœud carte + boutons de dépliage (récursif) ----------
  function CardNode({ sector, entry, sto, year, effectiveSign, depth, excludeFormulaId, onExpandedChange }) {
    const [expanded, setExpanded] = React.useState({});
    const value = G.getValue(sector, entry, sto, year);
    // on ne repropose pas la formule qui a généré cette carte (évite un
    // dépliage trivial "vers le parent" juste après avoir déplié celui-ci)
    const formulas = G.getFormulasFor(sector, entry, sto).filter(f => f.id !== excludeFormulaId);

    function toggle(id) {
      setExpanded(prev => {
        const next = { ...prev, [id]: !prev[id] };
        if (onExpandedChange) onExpandedChange(next);
        return next;
      });
    }

    const pills = formulas.length === 0 ? null : h(
      'div', { className: 'expand-row' },
      formulas.map(f =>
        h('button', {
          key: f.id,
          className: 'pill' + (expanded[f.id] ? ' active' : ''),
          onClick: () => toggle(f.id),
        }, (expanded[f.id] ? '▾ ' : '▸ ') + f.label + ' (' + f.size + ')')
      )
    );

    const groups = Object.keys(expanded)
      .filter(id => expanded[id])
      .map(id => h(FormulaGroup, { key: id, sector, entry, sto, year, formulaId: id, depth: depth || 0 }));

    return h('div', { className: 'card-node' }, [
      h(Card, { key: 'card', sector, entry, sto, year, value, effectiveSign, hasFormulas: formulas.length > 0 }),
      pills,
      groups.length ? h('div', { className: 'groups-stack', key: 'groups' }, groups) : null,
    ]);
  }

  // ---------- Panneau latéral : histogramme empilé des contributions ----------
  function StackedBarPanel({ sector, sto, year, formulaId }) {
    const exp = G.expandFormula(formulaId, sector, 'B', sto, year);
    if (!exp) return null;
    const bar = TeeGraphLib.stackedBarGeometry(exp.others, { width: 64, height: 240, pad: 4 });
    const rootValue = G.getValue(sector, 'B', sto, year);
    const f = D.formulas[formulaId];

    const rects = bar.segments.map((s, i) =>
      h('rect', {
        key: s.sector + '|' + s.entry + '|' + s.sto,
        x: 0,
        width: bar.width,
        y: Math.min(s.y0, s.y1),
        height: Math.max(1, Math.abs(s.y1 - s.y0)),
        className: 'stack-seg',
        style: { fill: colorForIndex(i) },
      }, [
        h('title', { key: 'tt' },
          stoWithEntry(s.sto, s.entry) + (s.sector !== sector ? ' (' + s.sector + ')' : '') + ' : ' + fmtMd(s.contribution)
        ),
      ])
    );

    const legend = bar.segments.map((s, i) =>
      h('div', { className: 'legend-item', key: s.sector + '|' + s.entry + '|' + s.sto }, [
        h('span', { className: 'legend-swatch', key: 'sw', style: { background: colorForIndex(i) } }),
        h('span', { className: 'legend-label', key: 'lb' },
          stoWithEntry(s.sto, s.entry) + (s.sector !== sector ? ' (' + s.sector + ')' : '')),
        h('span', { className: 'legend-value', key: 'val' }, fmtMd(s.contribution)),
      ])
    );

    return h('div', { className: 'sidebar-panel' }, [
      h('div', { className: 'sidebar-title', key: 't' }, f ? f.label : formulaId),
      h('div', { className: 'stacked-bar-row', key: 'row' }, [
        h('svg', {
          key: 'svg', viewBox: '0 0 ' + bar.width + ' ' + bar.height,
          width: bar.width, height: bar.height, className: 'stacked-bar-svg',
        }, [
          h('line', { key: 'zero', x1: 0, x2: bar.width, y1: bar.zeroY, y2: bar.zeroY, className: 'stack-zero' }),
        ].concat(rects)),
        h('div', { className: 'stacked-bar-legend', key: 'legend' }, legend),
      ]),
      h('div', { className: 'stacked-bar-total', key: 'total' },
        stoWithEntry(sto, 'B') + ' = ' + fmtMd(bar.total) +
        (rootValue !== null ? ' (carte : ' + fmtMd(rootValue) + ')' : '')
      ),
      bar.missing > 0
        ? h('div', { className: 'stacked-bar-note', key: 'note' }, bar.missing + ' terme(s) indisponible(s) pour ' + year)
        : null,
    ]);
  }

  function Sidebar({ sector, sto, year, rootExpanded }) {
    const activeIds = Object.keys(rootExpanded).filter(id => rootExpanded[id]);
    if (activeIds.length === 0) {
      return h('aside', { className: 'sidebar' }, [
        h('div', { className: 'sidebar-panel', key: 'empty' }, [
          h('div', { className: 'sidebar-title', key: 't' }, 'Décomposition'),
          h('div', { className: 'sidebar-empty', key: 'e' },
            'Dépliez une identité comptable sur la carte de départ pour voir ici la contribution de chaque poste.'),
        ]),
      ]);
    }
    return h('aside', { className: 'sidebar' },
      activeIds.map(id => h(StackedBarPanel, { key: id, sector, sto, year, formulaId: id }))
    );
  }

  // ---------- Application ----------
  function App() {
    const sector = D.seed.sector;
    const [sto, setSto] = React.useState(D.seed.sto);
    const [year, setYear] = React.useState(DEFAULT_YEAR);
    // décompositions actives sur la carte de départ, pour le panneau latéral
    const [rootExpanded, setRootExpanded] = React.useState({});

    const stoOptions = rootStoOptions(sector);

    return h('div', { className: 'app-wrap' }, [
      h('div', { className: 'controls', key: 'controls' }, [
        h('div', { className: 'row-controls', key: 'row' }, [
          h('label', { key: 'l1', className: 'inline-label' }, [
            'Solde de départ ',
            h('select', {
              value: sto,
              onChange: (e) => { setSto(e.target.value); setRootExpanded({}); },
            }, stoOptions.map(code => h('option', { key: code, value: code }, code + ' — ' + G.stoLabel(code)))),
          ]),
          h('label', { key: 'l2', className: 'inline-label' }, [
            'Année ',
            h('select', {
              value: year,
              onChange: (e) => setYear(+e.target.value),
            }, YEARS.map(y => h('option', { key: y, value: y }, y))),
          ]),
        ]),
      ]),
      h('div', { className: 'layout', key: 'layout' }, [
        h('main', { key: 'main' }, [
          h(CardNode, {
            key: sector + '|B|' + sto, sector, entry: 'B', sto, year, depth: 0,
            onExpandedChange: setRootExpanded,
          }),
        ]),
        h(Sidebar, { key: 'sidebar', sector, sto, year, rootExpanded }),
      ]),
      h('p', { className: 'footnote', key: 'foot' },
        "Source : INSEE, comptes nationaux annuels (base 2020), série SDMX DD_CNA_TEE. Les identités comptables (data/formules_TEE.csv) sont calculées pour 2024 puis appliquées à toutes les années disponibles ; pour des années anciennes, certains termes peuvent être indisponibles."
      ),
    ]);
  }

  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(h(App));
})();
