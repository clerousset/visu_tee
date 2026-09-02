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

  // unité "pct" (menu "Unités") : croissance annuelle pour la carte de
  // départ, contribution à cette croissance (en points) pour les autres —
  // même formule (Δ/valeur précédente de la carte de départ), voir
  // graph.js::getValue
  function fmtPct(v) {
    if (v === null || v === undefined) return '—';
    return v.toLocaleString('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + ' %';
  }
  function fmtValue(v, unit) { return unit === 'pct' ? fmtPct(v) : fmtMd(v); }

  function lowerFirst(str) { return str ? str.charAt(0).toLowerCase() + str.slice(1) : str; }

  // affiché sur le pill et l'équation d'une identité non vérifiée pour
  // l'année courante (champ `years`, voir graph.js::isFormulaVerified) :
  // on la propose quand même plutôt que la masquer, pour ne pas donner
  // l'impression qu'elle n'existe pas.
  const UNVERIFIED_MESSAGE = 'Formule non vérifiée dans les données pour cette année.';

  // palette catégorielle pour distinguer chaque contribution de l'histogramme
  // empilé (une couleur par membre, indépendante du signe)
  const STACK_PALETTE = [
    '#5b8def', '#ff8a5c', '#7ee0c3', '#e6c94f', '#c98bf0',
    '#ff6b9d', '#4fd18b', '#f0a04b', '#6bc9ff', '#d17ee0',
  ];
  function colorForIndex(i) { return STACK_PALETTE[i % STACK_PALETTE.length]; }
  const OTHER_COLOR = '#6b7280'; // gris neutre pour le regroupement "Autres"
  const MAX_SIDEBAR_SEGMENTS = 8; // au-delà, les plus petites contributions sont regroupées

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

  // postes proposés dans le sélecteur de départ : pas seulement les soldes
  // (B), aussi les ressources/emplois (C/D) — groupés par position, dans
  // l'ordre où on les rencontre en lisant un compte (solde, puis ressources,
  // puis emplois)
  const ROOT_ENTRY_ORDER = ['B', 'C', 'D'];
  function rootStoOptions(sector) {
    const bySector = D.values[sector] || {};
    const options = [];
    ROOT_ENTRY_ORDER.forEach(entry => {
      Object.keys(bySector[entry] || {}).sort().forEach(sto => options.push({ entry, sto }));
    });
    return options;
  }

  // tous les agrégats proposables (tous secteurs confondus), pour la barre
  // de recherche en haut de page : calculé une seule fois, D.values ne
  // change pas en cours d'exécution
  const ALL_POSTE_OPTIONS = (() => {
    const options = [];
    (D.secteurs || []).forEach(sector => {
      const bySector = D.values[sector] || {};
      ROOT_ENTRY_ORDER.forEach(entry => {
        Object.keys(bySector[entry] || {}).sort().forEach(sto => options.push({ sector, entry, sto }));
      });
    });
    return options;
  })();

  // catalogue des identités connues, groupées par libellé (onglet
  // "Formules") : calculé une seule fois, comme ALL_POSTE_OPTIONS. La cible
  // d'une formule sert de point d'entrée pour "aller à cette carte" ; les
  // ventilations passent avant les liens (même ordre que getFormulasFor).
  const FORMULA_GROUPS = (() => {
    const byLabel = {};
    Object.keys(D.formulas).forEach(fid => {
      const f = D.formulas[fid];
      const target = f.target || f.members[0];
      (byLabel[f.label] = byLabel[f.label] || []).push({
        id: fid,
        sector: target.sector,
        entry: target.entry,
        sto: target.sto,
        activity: target.activity || null,
        size: f.members.length,
        years: f.years || null,
      });
    });
    return Object.keys(byLabel)
      .map(label => ({
        label,
        instances: byLabel[label].sort((a, b) => (a.sector + '|' + a.sto).localeCompare(b.sector + '|' + b.sto)),
      }))
      .sort((a, b) => (a.label.indexOf('Ventilation') === 0 ? 0 : 1) - (b.label.indexOf('Ventilation') === 0 ? 0 : 1)
        || a.label.localeCompare(b.label));
  })();

  // recherche insensible à la casse/aux accents (ex. "impots" doit trouver
  // "impôts") sur le code, le libellé du poste, le secteur et la position
  function normalize(str) {
    let out = '';
    for (const ch of (str || '').normalize('NFD')) {
      const code = ch.codePointAt(0);
      if (code >= 0x0300 && code <= 0x036f) continue; // marque diacritique combinante
      out += ch;
    }
    return out.toLowerCase();
  }
  function posteSearchText(o) {
    return normalize([o.sto, G.stoLabel(o.sto), G.sectorLabel(o.sector), G.entryLabel(o.entry)].join(' '));
  }

  // ---------- Icône + mini-graphique au survol (série annuelle complète) ----------
  function SeriesHover({ sector, entry, sto, year, unit }) {
    const s = G.series(sector, entry, sto, unit);
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
  function Card({ sector, entry, sto, year, value, effectiveSign, hasFormulas, activity, unit, isRoot, pctRoot, onSetRoot }) {
    const signClass = value === null ? '' : value >= 0 ? 'pos' : 'neg';
    const isDelta = unit === 'delta';
    const isPct = unit === 'pct';
    const meaningText = lowerFirst(G.stoLabel(sto));
    // les valeurs ventilées par activité (SUT) n'ont pas de série annuelle
    // embarquée sous cette forme, et l'unité "pct" n'a pas d'historique
    // calculé (seulement l'année sélectionnée) : pas de mini-graphique
    // pour ces cartes
    const seriesHover = (activity || isPct) ? null : h(SeriesHover, { key: 'series', sector, entry, sto, year, unit });
    const activityPhrase = activity ? ', dans l’activité ' + lowerFirst(G.activityLabel(activity)) : '';
    // en "pct", la carte de départ affiche son propre taux de croissance,
    // les autres cartes leur contribution à CETTE croissance (voir
    // graph.js::getValue) : la phrase le précise pour éviter toute confusion
    const rootMeaningText = pctRoot ? lowerFirst(G.stoLabel(pctRoot.sto)) : meaningText;
    const quantityPhrase = isPct
      ? (isRoot ? 'de croissance de ' + meaningText : 'de contribution de ' + meaningText + ' à la croissance de ' + rootMeaningText)
      : isDelta ? 'de variation de ' + meaningText : 'de ' + meaningText;
    const yearPhrase = (isDelta || isPct) ? 'entre ' + (year - 1) + ' et ' + year : 'de ' + year;

    const sentence = h('p', { className: 'card-sentence', key: 'sentence' }, [
      h('strong', { className: 'card-value ' + signClass, key: 'val' }, fmtValue(value, unit)),
      ' ',
      seriesHover,
      ' ' + quantityPhrase + ' ' + yearPhrase,
      ' pour ' + sectorPhrase(sector) + activityPhrase + '.' + (hasFormulas ? ' Ils peuvent se décomposer :' : ''),
    ]);

    const codePrefix = isPct ? 'Δ%' : isDelta ? 'Δ' : '';
    const children = [
      h('div', { className: 'card-top', key: 'top' }, [
        h('span', { className: 'card-sto', key: 'sto' }, codePrefix + sto),
        activity ? h('span', { className: 'card-activity-badge', key: 'act', title: G.activityLabel(activity) }, activity) : null,
        h('span', { className: 'card-entry-badge entry-' + entry, key: 'entry' }, G.entryLabel(entry)),
        h('button', {
          className: 'card-root-btn', key: 'root',
          title: 'Repartir d’ici : nouvelle décomposition à partir de cette carte',
          onClick: () => onSetRoot({ sector, entry, sto, activity }),
        }, '↺'),
      ]),
      sentence,
      h('div', { className: 'card-source', key: 'source', title: 'Source des données de cette carte' },
        'Source : ' + G.sourceFor(sector, entry, sto, activity)),
    ];
    if (effectiveSign !== undefined) {
      children.push(
        h('div', { className: 'sign-badge ' + (effectiveSign > 0 ? 'pos' : 'neg'), key: 'sign' },
          effectiveSign > 0 ? '+' : '−')
      );
    }
    return h('div', { className: 'card' }, children);
  }

  // libellé complet d'un terme (poste + secteur si différent de la carte
  // d'origine), utilisé comme bulle explicative au survol d'un terme abrégé
  // `year` : nécessaire pour résoudre l'année effective d'un membre décalé
  // (m.yearOffset, ex. -1 = année précédente — voir "Lien patrimoine/flux
  // ..." et graph.js::expandFormula) en toutes lettres dans la bulle.
  function termFullLabel(m, sector, year) {
    const label = lowerFirst(G.stoLabel(m.sto));
    const withSector = m.sector !== sector ? label + ' pour ' + sectorPhrase(m.sector) : label;
    const withActivity = m.activity ? withSector + ' — ' + lowerFirst(G.activityLabel(m.activity)) : withSector;
    return m.yearOffset ? withActivity + ' (' + (year + m.yearOffset) + ')' : withActivity;
  }

  // équation en toutes lettres (libellés complets, pas les codes STO), pour
  // la bulle affichée au survol d'un bouton de dépliage, avant même de cliquer
  function formulaPreviewText(exp, sector, sto, entry, unit, year) {
    const parts = exp.others.map(m => {
      const sign = m.effectiveSign > 0 ? '+' : '−';
      return sign + ' ' + termFullLabel(m, sector, year);
    });
    const lhs = (unit === 'delta' ? 'variation de ' : '') + lowerFirst(G.stoLabel(sto));
    return lhs + ' = ' + parts.join(' ');
  }

  // ---------- Groupe de formule déplié (équation + cartes enfants) ----------
  // `path` identifie de façon unique la carte parente dans l'arbre de
  // dépliage (ex. "root>F12>S11|D|D7") ; les cartes enfants héritent d'un
  // chemin qui préfixe le leur, ce qui permet à handleToggle() de retrouver
  // et refermer toute une branche d'un coup (voir plus bas).
  function FormulaGroup({ sector, entry, sto, year, formulaId, depth, path, expandedTree, onToggle, activity, unit, pctRoot, onSetRoot }) {
    const exp = G.expandFormula(formulaId, sector, entry, sto, year, activity, unit, pctRoot);
    if (!exp) return null;
    // en delta/pct, chaque terme de l'équation est lui-même une variation :
    // le préfixe le rappelle sur le code abrégé (ex. "ΔD9R_C", "Δ%D9R_C")
    const codePrefix = unit === 'pct' ? 'Δ%' : unit === 'delta' ? 'Δ' : '';
    // chaque terme est une bulle explicative individuelle (title) : le code
    // abrégé (ex. "D9R_C") reste affiché, mais survoler révèle son libellé complet
    const eqNodes = [
      h('span', {
        key: 'lhs', className: 'formula-eq-term',
        title: lowerFirst(G.stoLabel(sto)) + (activity ? ' — ' + lowerFirst(G.activityLabel(activity)) : ''),
      }, codePrefix + stoWithEntry(sto, entry) + (activity ? ' [' + activity + ']' : '')),
      ' = ',
    ];
    exp.others.forEach((m, i) => {
      if (i > 0) eqNodes.push(' ');
      const sign = m.effectiveSign > 0 ? '+' : '−';
      const sectorTag = m.sector !== sector ? ' (' + m.sector + ')' : '';
      const activityTag = m.activity ? ' [' + m.activity + ']' : '';
      const yearTag = m.yearOffset ? ' (' + (year + m.yearOffset) + ')' : '';
      eqNodes.push(h('span', {
        key: i, className: 'formula-eq-term', title: termFullLabel(m, sector, year),
      }, sign + ' ' + codePrefix + stoWithEntry(m.sto, m.entry) + sectorTag + activityTag + yearTag));
    });
    return h('div', { className: 'formula-group' }, [
      h('div', { className: 'formula-eq', key: 'eq' }, eqNodes),
      !exp.verified ? h('div', { className: 'formula-warning', key: 'warn' }, '⚠ ' + UNVERIFIED_MESSAGE) : null,
      h('div', { className: 'formula-children', key: 'ch' },
        exp.others.map(m => {
          // un membre décalé (yearOffset) déplie une carte à SA propre
          // année (ex. "LE_N (2019)" sous une carte 2020) — la phrase de
          // cette carte affichera d'elle-même cette année, ce qui suffit à
          // signaler le décalage sans badge dédié ; toute décomposition
          // ultérieure sur cette carte hérite naturellement de son année.
          const childYear = year + (m.yearOffset || 0);
          const childSuffix = m.sector + '|' + m.entry + '|' + m.sto + (m.activity ? '@' + m.activity : '') + (m.yearOffset ? '#' + m.yearOffset : '');
          return h(CardNode, {
            key: childSuffix,
            sector: m.sector,
            entry: m.entry,
            sto: m.sto,
            activity: m.activity || undefined,
            year: childYear,
            effectiveSign: m.effectiveSign,
            depth: depth + 1,
            excludeFormulaId: formulaId,
            path: path + '>' + formulaId + '>' + childSuffix,
            expandedTree,
            onToggle,
            unit,
            pctRoot,
            onSetRoot,
          });
        })
      ),
    ]);
  }

  // ---------- Nœud carte + boutons de dépliage (récursif) ----------
  // L'état "quelles identités sont dépliées" est entièrement piloté depuis
  // App (expandedTree), pas en useState local : ainsi, replier une identité
  // referme automatiquement (et proprement, dans le panneau latéral) toutes
  // les sous-décompositions ouvertes en dessous, sans état local à nettoyer.
  function CardNode({ sector, entry, sto, year, effectiveSign, depth, excludeFormulaId, path, expandedTree, onToggle, activity, unit, pctRoot, onSetRoot }) {
    const value = G.getValue(sector, entry, sto, year, activity, unit, pctRoot);
    // on ne repropose pas la formule qui a généré cette carte (évite un
    // dépliage trivial "vers le parent" juste après avoir déplié celui-ci)
    const formulas = G.getFormulasFor(sector, entry, sto, year, activity).filter(f => f.id !== excludeFormulaId);
    const active = (expandedTree[path] && expandedTree[path].active) || {};

    const pills = formulas.length === 0 ? null : h(
      'div', { className: 'expand-row' },
      formulas.map(f => {
        // bulle explicative : l'équation en toutes lettres, visible avant
        // même de cliquer sur le bouton pour déplier l'identité
        const exp = G.expandFormula(f.id, sector, entry, sto, year, activity, unit, pctRoot);
        const preview = exp ? formulaPreviewText(exp, sector, sto, entry, unit, year) : undefined;
        const title = f.verified ? preview : [preview, '⚠ ' + UNVERIFIED_MESSAGE].filter(Boolean).join('\n');
        return h('button', {
          key: f.id,
          className: 'pill' + (active[f.id] ? ' active' : '') + (f.verified ? '' : ' pill-unverified'),
          title,
          onClick: () => onToggle(path, { sector, entry, sto, activity, depth: depth || 0 }, f.id),
        }, (active[f.id] ? '▾ ' : '▸ ') + f.label + ' (' + (f.size - 1) + ')' + (f.verified ? '' : ' ⚠'));
      })
    );

    const groups = Object.keys(active)
      .filter(id => active[id])
      .map(id => h(FormulaGroup, {
        key: id, sector, entry, sto, year, activity, formulaId: id, depth: depth || 0, path, expandedTree, onToggle, unit, pctRoot, onSetRoot,
      }));

    return h('div', { className: 'card-node' }, [
      h(Card, { key: 'card', sector, entry, sto, year, value, effectiveSign, hasFormulas: formulas.length > 0, activity, unit, isRoot: (depth || 0) === 0, pctRoot, onSetRoot }),
      pills,
      groups.length ? h('div', { className: 'groups-stack', key: 'groups' }, groups) : null,
    ]);
  }

  // ---------- Panneau latéral : un seul histogramme empilé ----------
  // Au lieu d'un panneau par identité dépliée, on aplatit tout l'arbre de
  // dépliage en une seule liste de contributions "feuilles" (les postes
  // affichés sans décomposition active), chacune pondérée par le produit
  // des signes effectifs le long de son chemin depuis la carte de départ.
  // Ainsi, déplier une nouvelle identité ne fait que remplacer, dans le même
  // graphique, la contribution du poste concerné par ses propres membres.
  // Si plusieurs identités alternatives sont ouvertes sur un même poste, on
  // n'en retient qu'une (la première) pour garder un seul graphe cohérent.
  function collectLeaves(sector, entry, sto, year, path, expandedTree, effectiveSign, depth, activity, unit, pctRoot) {
    const active = (expandedTree[path] && expandedTree[path].active) || {};
    const activeIds = Object.keys(active).filter(id => active[id]);
    if (activeIds.length === 0) {
      return [{ sector, entry, sto, activity: activity || null, effectiveSign, value: G.getValue(sector, entry, sto, year, activity, unit, pctRoot), depth }];
    }
    const exp = G.expandFormula(activeIds[0], sector, entry, sto, year, activity, unit, pctRoot);
    if (!exp) {
      return [{ sector, entry, sto, activity: activity || null, effectiveSign, value: G.getValue(sector, entry, sto, year, activity, unit, pctRoot), depth }];
    }
    const childPrefix = path + '>' + activeIds[0] + '>';
    const leaves = [];
    exp.others.forEach(m => {
      const childPath = childPrefix + m.sector + '|' + m.entry + '|' + m.sto + (m.activity ? '@' + m.activity : '');
      leaves.push(...collectLeaves(
        m.sector, m.entry, m.sto, year, childPath, expandedTree,
        effectiveSign * m.effectiveSign, depth + 1, m.activity, unit, pctRoot
      ));
    });
    return leaves;
  }

  // regroupe les contributions les plus faibles (en valeur absolue) dans une
  // entrée "Autres" quand il y a trop de postes pour rester lisible ; les
  // termes indisponibles (valeur nulle) restent à part, comptés dans
  // bar.missing par stackedBarGeometry
  function groupSmallContributions(leaves, max) {
    const withValue = leaves.filter(l => l.value !== null && l.value !== undefined);
    const missing = leaves.filter(l => l.value === null || l.value === undefined);
    if (withValue.length <= max) return leaves;
    const ranked = withValue.slice().sort((a, b) =>
      Math.abs(b.effectiveSign * b.value) - Math.abs(a.effectiveSign * a.value));
    const kept = ranked.slice(0, max - 1);
    const rest = ranked.slice(max - 1);
    const restSum = rest.reduce((acc, l) => acc + l.effectiveSign * l.value, 0);
    const other = {
      sector: null, entry: null, sto: null, effectiveSign: 1, value: restSum,
      isOther: true, otherCount: rest.length,
    };
    return kept.concat(missing, [other]);
  }

  function segmentLabel(s, sector, unit) {
    if (s.isOther) return 'Autres (' + s.otherCount + ' poste' + (s.otherCount > 1 ? 's' : '') + ')';
    const codePrefix = unit === 'pct' ? 'Δ%' : unit === 'delta' ? 'Δ' : '';
    const base = codePrefix + stoWithEntry(s.sto, s.entry) + (s.sector !== sector ? ' (' + s.sector + ')' : '');
    return s.activity ? base + ' [' + s.activity + ']' : base;
  }

  function Sidebar({ sector, entry, sto, year, expandedTree, unit, pctRoot }) {
    const leaves = collectLeaves(sector, entry, sto, year, 'root', expandedTree, 1, 0, undefined, unit, pctRoot);
    if (leaves.length <= 1) {
      return h('aside', { className: 'sidebar' }, [
        h('div', { className: 'sidebar-panel', key: 'empty' }, [
          h('div', { className: 'sidebar-title', key: 't' }, 'Décomposition'),
          h('div', { className: 'sidebar-empty', key: 'e' },
            'Dépliez une identité comptable (sur la carte de départ ou sur une de ses cartes dépliées) pour voir ici la contribution de chaque poste. Chaque nouveau niveau de détail vient enrichir ce même graphique.'),
        ]),
      ]);
    }

    const codePrefix = unit === 'pct' ? 'Δ%' : unit === 'delta' ? 'Δ' : '';
    const rootValue = G.getValue(sector, entry, sto, year, undefined, unit, pctRoot);
    const grouped = groupSmallContributions(leaves, MAX_SIDEBAR_SEGMENTS);
    const bar = TeeGraphLib.stackedBarGeometry(grouped, { width: 64, height: 320, pad: 4 });

    let paletteIdx = 0;
    const colors = bar.segments.map(s => s.isOther ? OTHER_COLOR : colorForIndex(paletteIdx++));

    const rects = bar.segments.map((s, i) =>
      h('rect', {
        key: i,
        x: 0,
        width: bar.width,
        y: Math.min(s.y0, s.y1),
        height: Math.max(1, Math.abs(s.y1 - s.y0)),
        className: 'stack-seg',
        style: { fill: colors[i] },
      }, [
        h('title', { key: 'tt' }, segmentLabel(s, sector, unit) + ' : ' + fmtValue(s.contribution, unit)),
      ])
    );

    const legend = bar.segments.map((s, i) =>
      h('div', { className: 'legend-item', key: i }, [
        h('span', { className: 'legend-swatch', key: 'sw', style: { background: colors[i] } }),
        h('span', { className: 'legend-label', key: 'lb' }, segmentLabel(s, sector, unit)),
        h('span', { className: 'legend-value', key: 'val' }, fmtValue(s.contribution, unit)),
      ])
    );

    return h('aside', { className: 'sidebar' }, [
      h('div', { className: 'sidebar-panel', key: 'panel' }, [
        h('div', { className: 'sidebar-title', key: 't' },
          'Décomposition de ' + codePrefix + stoWithEntry(sto, entry) + (sector !== D.seed.sector ? ' (' + sector + ')' : '')),
        h('div', { className: 'stacked-bar-row', key: 'row' }, [
          h('svg', {
            key: 'svg', viewBox: '0 0 ' + bar.width + ' ' + bar.height,
            width: bar.width, height: bar.height, className: 'stacked-bar-svg',
          }, rects.concat([
            // dessinée après (donc au-dessus) des segments : sinon, comme les
            // barres partent toujours exactement de zéro, elle serait
            // systématiquement recouverte et invisible
            h('line', { key: 'zero', x1: 0, x2: bar.width, y1: bar.zeroY, y2: bar.zeroY, className: 'stack-zero' }),
          ])),
          h('div', { className: 'stacked-bar-legend', key: 'legend' }, legend),
        ]),
        h('div', { className: 'stacked-bar-total', key: 'total' },
          codePrefix + stoWithEntry(sto, entry) + ' = ' + fmtValue(bar.total, unit) +
          (rootValue !== null ? ' (carte : ' + fmtValue(rootValue, unit) + ')' : '')
        ),
        bar.missing > 0
          ? h('div', { className: 'stacked-bar-note', key: 'note' }, bar.missing + ' terme(s) indisponible(s) pour ' + year)
          : null,
      ]),
    ]);
  }

  // barre de recherche (tous secteurs confondus) proposant des agrégats au
  // fil de la frappe ; sélectionner une suggestion re-racine l'application
  // dessus (même effet que "repartir d'ici", voir onSelect) et vide la
  // recherche pour la suivante — ce n'est pas un affichage persistant du
  // poste courant, juste un outil de saut rapide
  function PosteSearch({ onSelect }) {
    const [query, setQuery] = React.useState('');
    const q = normalize(query);
    const suggestions = q ? ALL_POSTE_OPTIONS.filter(o => posteSearchText(o).indexOf(q) !== -1).slice(0, 20) : [];
    return h('div', { className: 'poste-search' }, [
      h('input', {
        key: 'input',
        type: 'text',
        className: 'poste-search-input',
        placeholder: 'Rechercher un agrégat (ex. PIB, D1, valeur ajoutée, impôts...)',
        value: query,
        onChange: (e) => setQuery(e.target.value),
      }),
      suggestions.length > 0
        ? h('ul', { className: 'poste-search-suggestions', key: 'list' },
          suggestions.map(o => h('li', {
            key: o.sector + '|' + o.entry + '|' + o.sto,
            className: 'poste-search-item',
            onClick: () => { onSelect(o); setQuery(''); },
          }, o.sto + ' — ' + lowerFirst(G.stoLabel(o.sto)) + ' (' + G.sectorLabel(o.sector) + ', ' + lowerFirst(G.entryLabel(o.entry)) + ')')))
        : null,
    ]);
  }

  // ---------- Catalogue des identités connues (onglet "Formules") ----------
  // Remplace la zone cartes+panneau (pas un ajout dessus) : une liste de
  // tous les types d'identités (FORMULA_GROUPS), chacun repliable, avec un
  // bouton par instance pour repartir dessus dans l'onglet "Explorer"
  // (comme "repartir d'ici" sur une carte).
  function FormulasCatalog({ onGoTo }) {
    const [expanded, setExpanded] = React.useState({});
    const totalInstances = FORMULA_GROUPS.reduce((acc, g) => acc + g.instances.length, 0);
    return h('div', { className: 'formulas-catalog' }, [
      h('p', { className: 'formulas-catalog-intro', key: 'intro' },
        FORMULA_GROUPS.length + ' type' + (FORMULA_GROUPS.length > 1 ? 's' : '') + ' d’identité' +
        (FORMULA_GROUPS.length > 1 ? 's' : '') + ' comptable' + (FORMULA_GROUPS.length > 1 ? 's' : '') +
        ', ' + totalInstances + ' au total.'),
      ...FORMULA_GROUPS.map(g => {
        const isOpen = !!expanded[g.label];
        return h('div', { className: 'formula-group-card', key: g.label }, [
          h('button', {
            className: 'formula-group-header',
            key: 'header',
            onClick: () => setExpanded(prev => Object.assign({}, prev, { [g.label]: !prev[g.label] })),
          }, (isOpen ? '▾ ' : '▸ ') + g.label + ' (' + g.instances.length + ')'),
          isOpen ? h('ul', { className: 'formula-instance-list', key: 'list' },
            g.instances.map(inst => h('li', { className: 'formula-instance-item', key: inst.id }, [
              h('span', { className: 'formula-instance-desc', key: 'desc' },
                inst.sto + (inst.activity ? ' [' + inst.activity + ']' : '') + ' — ' + G.sectorLabel(inst.sector) +
                ' (' + lowerFirst(G.entryLabel(inst.entry)) + ', ' + inst.size + ' membres' +
                (inst.years ? ', ' + inst.years[0] + '–' + inst.years[inst.years.length - 1] : '') + ')'),
              h('button', {
                className: 'formula-instance-goto', key: 'go',
                onClick: () => onGoTo({ sector: inst.sector, entry: inst.entry, sto: inst.sto, activity: inst.activity || undefined }),
              }, 'Aller à cette carte →'),
            ]))
          ) : null,
        ]);
      }),
    ]);
  }

  // ---------- Application ----------
  function App() {
    // 'explorer' (comportement historique, cartes+panneau) ou 'formulas'
    // (catalogue des identités connues, voir FormulasCatalog) — remplace la
    // zone principale, les sélecteurs du haut restent visibles dans les
    // deux cas (inutilisés mais sans effet indésirable sur "formulas").
    const [activeTab, setActiveTab] = React.useState('explorer');
    // la racine était jusque-là toujours dans le secteur de la graine (S1) :
    // rootSector devient un état pour que "repartir d'ici" (bouton sur
    // chaque carte) puisse re-raciner sur une carte d'un AUTRE secteur
    // (rencontrée en dépliant une ventilation par secteur, par exemple)
    const [rootSector, setRootSector] = React.useState(D.seed.sector);
    const [rootEntry, setRootEntry] = React.useState(D.seed.entry);
    const [sto, setSto] = React.useState(D.seed.sto);
    const [rootActivity, setRootActivity] = React.useState(undefined);
    const [year, setYear] = React.useState(DEFAULT_YEAR);
    // 'level' (comportement historique), 'delta' (variation par rapport à
    // l'année précédente) ou 'pct' (cette variation en % de croissance pour
    // la carte de départ, en points de contribution à cette croissance pour
    // les autres) ; se propage à toutes les valeurs affichées (cartes,
    // équations, panneau latéral) via graph.js::getValue/series/expandFormula
    const [unit, setUnit] = React.useState('level');
    // dénominateur commun de l'unité "pct" : le poste de départ courant,
    // recalculé à chaque rendu (bon marché, pas de useMemo nécessaire ici)
    const pctRoot = { sector: rootSector, entry: rootEntry, sto, activity: rootActivity };
    // arbre complet des décompositions actives, à n'importe quelle
    // profondeur : { [path]: { sector, entry, sto, depth, active: {formulaId: bool} } }
    // `path` encode la branche complète (voir FormulaGroup/CardNode), ce qui
    // permet de refermer toute une sous-branche d'un coup.
    const [expandedTree, setExpandedTree] = React.useState({});

    function handleToggle(path, info, formulaId) {
      setExpandedTree(prev => {
        const next = Object.assign({}, prev);
        const node = next[path] || { sector: info.sector, entry: info.entry, sto: info.sto, activity: info.activity, depth: info.depth, active: {} };
        const willOpen = !node.active[formulaId];
        // une seule pill active par carte : ouvrir celle-ci referme toutes
        // les autres déjà actives sur la même carte (et purge, comme pour
        // une fermeture normale, leur sous-décomposition éventuelle)
        Object.keys(node.active).forEach(id => {
          if (id !== formulaId && node.active[id]) {
            const otherPrefix = path + '>' + id + '>';
            Object.keys(next).forEach(k => { if (k.indexOf(otherPrefix) === 0) delete next[k]; });
          }
        });
        next[path] = Object.assign({}, node, { active: willOpen ? { [formulaId]: true } : {} });
        if (!willOpen) {
          // on replie : purge toute la sous-décomposition ouverte en dessous
          const prefix = path + '>' + formulaId + '>';
          Object.keys(next).forEach(k => { if (k.indexOf(prefix) === 0) delete next[k]; });
        }
        return next;
      });
    }

    // "repartir d'ici" (bouton sur chaque carte, y compris la racine elle-
    // même) : la carte cliquée devient la nouvelle racine et toute
    // décomposition en cours est abandonnée, comme un nouveau départ
    function handleSetRoot({ sector, entry, sto: newSto, activity }) {
      setRootSector(sector);
      setRootEntry(entry);
      setSto(newSto);
      setRootActivity(activity || undefined);
      setExpandedTree({});
    }

    const stoOptions = rootStoOptions(rootSector);

    return h('div', { className: 'app-wrap' }, [
      h('div', { className: 'controls', key: 'controls' }, [
        h(PosteSearch, { key: 'search', onSelect: handleSetRoot }),
        h('div', { className: 'row-controls', key: 'row' }, [
          h('label', { key: 'l1', className: 'inline-label' }, [
            'Poste de départ' + (rootSector !== D.seed.sector ? ' (' + G.sectorLabel(rootSector) + ')' : '') + ' ',
            h('select', {
              value: rootEntry + '|' + sto,
              onChange: (e) => {
                const [entry, code] = e.target.value.split('|');
                setRootEntry(entry); setSto(code); setRootActivity(undefined); setExpandedTree({});
              },
            }, stoOptions.map(o => h('option', { key: o.entry + '|' + o.sto, value: o.entry + '|' + o.sto },
              o.sto + ' — ' + lowerFirst(G.stoLabel(o.sto)) + ' (' + lowerFirst(G.entryLabel(o.entry)) + ')'))),
          ]),
          h('label', { key: 'l2', className: 'inline-label' }, [
            'Année ',
            h('select', {
              value: year,
              onChange: (e) => setYear(+e.target.value),
            }, YEARS.map(y => h('option', { key: y, value: y }, y))),
          ]),
          h('label', { key: 'l3', className: 'inline-label' }, [
            'Unités ',
            h('select', {
              value: unit,
              onChange: (e) => setUnit(e.target.value),
            }, [
              h('option', { key: 'level', value: 'level' }, 'En niveau'),
              h('option', { key: 'delta', value: 'delta' }, 'En delta (variation annuelle)'),
              h('option', { key: 'pct', value: 'pct' }, 'En pourcentage / contributions'),
            ]),
          ]),
        ]),
        h('div', { className: 'tab-row', key: 'tabs' }, [
          h('button', {
            key: 'explorer', className: 'tab-btn' + (activeTab === 'explorer' ? ' active' : ''),
            onClick: () => setActiveTab('explorer'),
          }, 'Explorer'),
          h('button', {
            key: 'formulas', className: 'tab-btn' + (activeTab === 'formulas' ? ' active' : ''),
            onClick: () => setActiveTab('formulas'),
          }, 'Formules (' + FORMULA_GROUPS.length + ')'),
        ]),
      ]),
      activeTab === 'formulas'
        ? h(FormulasCatalog, {
          key: 'catalog',
          onGoTo: (poste) => { handleSetRoot(poste); setActiveTab('explorer'); },
        })
        : h('div', { className: 'layout', key: 'layout' }, [
          h('main', { key: 'main' }, [
            h(CardNode, {
              key: rootSector + '|' + rootEntry + '|' + sto + (rootActivity ? '@' + rootActivity : ''),
              sector: rootSector, entry: rootEntry, sto, activity: rootActivity, year, depth: 0,
              path: 'root', expandedTree, onToggle: handleToggle, unit, pctRoot, onSetRoot: handleSetRoot,
            }),
          ]),
          h(Sidebar, { key: 'sidebar', sector: rootSector, entry: rootEntry, sto, year, expandedTree, unit, pctRoot }),
        ]),
      h('p', { className: 'footnote', key: 'foot' },
        "Source : INSEE, comptes nationaux annuels (base 2020), fichiers Melodi DD_CNA_TEE et DD_CNA_SUT. Les identités comptables sont calculées pour 2024 puis appliquées à toutes les années disponibles ; pour des années anciennes, certains termes peuvent être indisponibles."
      ),
    ]);
  }

  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(h(App));
})();
