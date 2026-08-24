# CLAUDE.md

Contexte pour Claude Code sur ce dépôt. Voir aussi `README.md` (structure du
dépôt, comment ouvrir le site, comment régénérer les données).

## Projet

Site d'exploration interactive du Tableau Économique d'Ensemble (TEE,
comptes nationaux annuels INSEE) : chaque carte représente une valeur
observée (secteur institutionnel × poste comptable × ressource/emploi/solde
× année). Quand une valeur participe à une identité comptable, on peut
déplier les autres membres de cette identité sous forme de nouvelles cartes,
récursivement. Un panneau latéral affiche un histogramme empilé des
contributions pour chaque identité actuellement dépliée, à n'importe quelle
profondeur.

Les demandes de l'utilisateur arrivent une par une, en français, souvent
très courtes ("à droite de la page un barplot stacked...", "une couleur
différente par contribution"). Chacune doit être implémentée, testée et
committée avant de passer à la suivante — pas de gros refactor non demandé.

## Contraintes d'environnement (important, contre-intuitif)

- **npm est entièrement bloqué** (403 sur registry.npmjs.org, testé pour
  jsdom, chart.js, react, canva...). N'essaie même pas d'installer un
  package npm. React/ReactDOM sont chargés en UMD depuis un CDN
  (cdnjs → jsdelivr → unpkg en repli) directement dans `site/index.html`.
- **Pas de JSX ni de build step.** Tout `site/app.js` est écrit avec
  `React.createElement` aliasé `const h = React.createElement`. Reste
  cohérent avec ce style si tu ajoutes des composants.
- **Locks git sur ce dossier (montage fuse Windows) :** `rm`/`unlink` sur un
  `.git/*.lock` échoue avec `Operation not permitted`, mais
  `os.rename()` en Python fonctionne. Avant tout `git add`/`commit`, si une
  commande git échoue avec "Unable to create .git/index.lock", renomme le
  fichier :
  ```python
  import os, glob
  for f in glob.glob('.git/*.lock'):
      os.rename(f, f + '.stale')
  ```
  Les warnings "unable to unlink .git/objects/xx/tmp_obj_..." pendant un
  commit sont inoffensifs et n'empêchent pas le commit de réussir — vérifie
  avec `git log --oneline -1` plutôt que de te fier au flot de warnings.
  Parfois il faut refaire `git add -A` juste avant le commit si un essai
  précédent a échoué (le staging peut se perdre entre deux tentatives).

## Tests (sans dépendance externe)

```
node tests/test_graph.js        # logique pure (lookup, expansion de formules, géométrie SVG) — sans DOM
node tests/test_app_render.js   # rendu des composants React avec un React + DOM minimalistes simulés
```

Ces harnais utilisent le module `vm` de Node pour exécuter `graph.js` /
`app.js` dans un contexte sandboxé avec `React.createElement` et
`React.useState` mockés à la main (pas de jsdom, bloqué par npm). Si tu
ajoutes un composant qui a besoin d'un vrai état (clics simulés, pas juste
un rendu statique), voir le mock `statefulUseState` déjà présent dans
`test_app_render.js` (section "panneau latéral") comme modèle : il faut que
`useState` retourne un état qui persiste entre deux appels de rendu, keyé
par un chemin unique dans l'arbre de composants — sinon les closures des
handlers `onClick` capturent le mauvais tableau de hooks.

À chaque modification de `site/graph.js` ou `site/app.js`, relance les deux
suites avant de committer.

## Architecture de `site/app.js`

- `graph.js` (pur, sans DOM, testable seul) expose `TeeGraphLib` :
  `makeGraph(D)` (lookup/expansion de formules), `sparklineGeometry`,
  `stackedBarGeometry`. Toute nouvelle logique de calcul (géométrie SVG,
  agrégations) doit aller ici, pas dans `app.js`, pour rester testable sans
  DOM.
- `app.js` : composants React. Point important — l'état de dépliage
  (`expandedTree`) est **entièrement piloté depuis `App()`**, pas en
  `useState` local dans `CardNode`. Chaque carte est identifiée par un
  `path` unique (ex. `root>F12>S11|D|D7`) qui encode toute la branche de
  dépliage parent. Ça permet à `handleToggle()` de refermer une sous-arborescence
  entière d'un coup (préfixe de `path`) quand on replie une identité — ne
  reviens pas à un `useState` local par carte, ça casse la fermeture en
  cascade des sous-décompositions dans le panneau latéral.
- Le panneau latéral (`Sidebar`/`StackedBarPanel`) affiche un histogramme
  par entrée active de `expandedTree`, à n'importe quelle profondeur (pas
  seulement la carte racine).

## Données

- `data/formules_TEE.csv` : identités comptables, calculées par
  `R/genere_formule_TEE.r` pour l'année 2024 uniquement puis appliquées à
  toutes les années (les identités sont invariantes par construction des
  comptes nationaux). `id_formule` est **local à chaque bloc de calcul R**
  (`cur_group_id()` par bloc), donc **pas unique globalement** — toujours
  grouper par la clé composite `f"{formule}|{id_formule}"`
  (voir `scripts/prepare_data.py::load_formulas`).
- `scripts/regenerate_formules.py` est un portage Python pur de
  `R/genere_formule_TEE.r` (pas besoin de R installé). Si le `.r` est
  modifié, répercuter manuellement le changement dans ce portage, ou
  régénérer directement avec R et ignorer le portage.
- `scripts/prepare_data.py` lit `formules_TEE.csv` + les CSV INSEE et
  génère `site/data/tee_graph.js` (données embarquées, pas de serveur).
- Convention de signe : pour un membre d'origine K (signe `s_K` dans la
  formule) et un autre membre M (signe `s_M`), le signe effectif relatif à
  K est `effectiveSign = -s_K * s_M`, et `V_K = Σ effectiveSign(M) * V_M`.

## Ventilation par activité (SUT)

Second pipeline de données, greffé sur le premier : `data/DD_CNA_SUT_data.csv`
(Tableau des ressources et emplois, dimensions ACTIVITY x PRODUCT en plus de
REF_SECTOR/ACCOUNTING_ENTRY/STO) permet de décomposer certains postes par
section NACE Rev.2 (A à U) — `scripts/regenerate_formules_sut.py` détecte
cette identité (ACTIVITY == "_T" = Σ des sections) et écrit
`data/formules_SUT.csv`. `prepare_data.py::load_activite_formulas` ne
retient une identité que si le total SUT concorde avec la valeur TEE du même
poste à la même année (écart < 1) — sinon l'équation affichée serait
incohérente avec la carte qu'elle prétend décomposer (les deux sources ne
sont pas toujours au même millésime). En pratique : économie totale (S1) et
produit agrégé (`_T`) uniquement, sur 8 postes (P1, P2, B1G, D1, D11, P51C,
P52, B2A3N), années 1978-2022 (pas 2023/2024 : hors du champ commun).

Représentation dans le graphe : le membre "cible" (ACTIVITY == "_T") d'une
telle formule n'a **pas** d'`activity` propre — c'est le poste TEE ordinaire
(même valeur, déjà dans `values`), pas une valeur SUT distincte. Seuls les
membres "feuille" (une section NACE chacun) portent `activity`, avec leur
valeur dans un arbre séparé `activityValues[sector][entry][sto][activity][year]`
(jamais dans `values`). Ces membres-feuille ne sont **volontairement pas
indexés** (`D.index`) : sinon une carte "D1 pour l'activité A" se
re-proposerait elle-même la même ventilation. `graph.js` (`keyOf`,
`getValue`, `getFormulasFor`, `expandFormula`) prend un paramètre `activity`
optionnel partout, backward-compatible (`undefined` = comportement TEE
inchangé) ; `app.js` le fait suivre de bout en bout (`Card`/`CardNode`/
`FormulaGroup`/`collectLeaves`), y compris dans l'encodage de `path`
(`sector|entry|sto@activity`) pour garder chaque branche unique dans
`expandedTree`.

## Workflow attendu

1. Implémenter la demande.
2. Lancer `node tests/test_graph.js` et `node tests/test_app_render.js`.
3. Si le changement touche au rendu interactif (clics, état), écrire une
   vérification manuelle avec un mock `useState` stateful (voir plus haut)
   avant de considérer que c'est fini — un rendu statique qui ne plante pas
   ne prouve pas que l'interaction fonctionne.
4. Mettre à jour `README.md` si le changement affecte le fonctionnement
   décrit dedans.
5. Committer avec un message en français, descriptif, dans le style des
   commits existants (`git log --oneline` pour le ton).
