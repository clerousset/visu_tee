# Explorateur du Tableau Économique d'Ensemble (TEE)

Site d'exploration des comptes nationaux annuels français (INSEE) sous forme
de cartes : chaque carte représente une valeur observée (secteur
institutionnel x poste comptable x position ressource/emploi/solde x année).
Quand une valeur participe à une identité comptable (définition d'un solde,
ventilation par secteur, décomposition en sous-catégories), un bouton permet
de déplier les autres valeurs de cette identité sous forme de nouvelles
cartes reliées à la première.

Secteurs couverts : économie totale, sociétés non financières, sociétés
financières, administrations publiques, ménages, ISBLSM. Années : 1949–2024.
Les administrations publiques (S13) se déplient plus finement par
sous-secteur (administration centrale, locale, sécurité sociale — voir
« Comment ça marche » ci-dessous).

## Structure du dépôt

```
data/     données sources (SDMX INSEE) : DD_CNA_TEE_data.csv, métadonnées, formules_TEE.csv
R/        script R de référence (calcule les identités comptables de formules_TEE.csv)
scripts/  scripts Python de préparation des données pour le site
site/     site web statique (HTML/CSS/JS, React sans étape de build, aucun serveur requis)
tests/    tests de non-régression sans dépendance externe
helm/     chart Helm minimal pour déployer site/ (nginx) sur Kubernetes
Dockerfile  image nginx servant site/ (utilisée par le chart Helm)
```

## Ouvrir le site

Ouvrir `site/index.html` directement dans un navigateur (double-clic). Aucun
serveur n'est nécessaire : les données sont embarquées dans
`site/data/tee_graph.js`.

React et ReactDOM sont chargés depuis un CDN au premier affichage (avec
repli automatique sur 3 CDN différents en cas d'échec) : une connexion
internet est donc nécessaire à l'ouverture. Si un bandeau d'erreur apparaît,
c'est que les 3 CDN étaient inaccessibles (pare-feu, absence de connexion) —
vérifier la connexion et recharger la page.

## Comment ça marche

- On part d'une carte (par défaut : rémunération des salariés (emploi) —
  D1 — de l'économie totale, année la plus récente). Poste de départ et
  année sont modifiables en haut de page ; les autres secteurs restent
  accessibles en dépliant les identités de ventilation par secteur.
- Une barre de recherche en haut de page propose des agrégats (tous
  secteurs confondus) au fil de la frappe, insensible aux accents/à la
  casse (code, libellé, secteur ou position) ; cliquer une suggestion
  re-part directement sur cette carte, comme le bouton « repartir d'ici ».
- Un onglet « Formules » (à côté d'« Explorer ») liste tous les types
  d'identités comptables connus du site (`app.js::FORMULA_GROUPS`,
  regroupées par libellé, ventilations d'abord), chacun repliable ; chaque
  instance affiche l'équation avec ses signes +/− (comme sur une carte
  dépliée, `app.js::formulaInstanceEquation`) et propose un bouton « Aller
  à cette carte » qui re-part dessus et revient sur l'onglet « Explorer ».
- Chaque carte affiche en petit sa source (« Source : DD_CNA_TEE » ou
  « DD_CNA_SUT ») : la plupart des postes viennent du TEE, sauf les
  quelques-uns qui n'existent que dans le SUT (`TSPP`, `TSBP`) et toute
  valeur ventilée par activité (toujours du SUT). D'autres sources
  s'ajouteront ici au fil des besoins (voir `graph.js::sourceFor`,
  `payload.posteSource`).
- Un sélecteur « Unités » en haut de page propose trois modes :
  - « En niveau » (par défaut) : comportement historique.
  - « En delta (variation annuelle) » : chaque carte, équation et le
    panneau latéral affichent la variation de la valeur par rapport à
    l'année précédente plutôt que son niveau (codes de poste préfixés de
    « Δ »).
  - « En pourcentage / contributions » : la carte de départ affiche son
    propre taux de croissance annuel (delta / valeur de l'année
    précédente) ; toutes les autres cartes affichent leur contribution à
    CETTE croissance (leur propre delta rapporté à la valeur de l'année
    précédente de la carte de départ, pas à la leur — codes préfixés de
    « Δ% »). C'est la décomposition usuelle d'un taux de croissance en
    points de contribution par poste.

  Dans les deux derniers modes, l'identité comptable reste valable (la
  variation, ou la contribution, d'une somme est la somme des variations ou
  contributions de ses termes), donc les décompositions et le panneau
  latéral restent cohérents.
- Si la valeur affichée participe à une ou plusieurs identités comptables,
  des boutons apparaissent sous la carte, avec le libellé brut de
  `formules_TEE.csv` (ex. « Lien B9 B8 », « Ventilation en sous-secteur »).
- Cliquer sur un bouton déplie les autres postes de cette identité, avec un
  badge +/- indiquant s'ils s'ajoutent ou se retranchent pour reconstituer
  la valeur de départ, et l'équation correspondante affichée en toutes
  lettres. Chaque nouvelle carte peut à son tour être dépliée.
- Une ventilation (sous-secteur, sous-catégorie, activité) ne se propose que
  « vers le bas » : seule la carte qui SE décompose peut la déplier, jamais
  un poste apparu comme l'un de ses membres (qui la redéplierait « vers le
  haut », vers le parent et ses frères) — y compris après avoir changé de
  dimension de décomposition en cours de route (ex. secteur puis
  sous-catégorie). Une identité de type « Lien ... » (définition d'un solde)
  n'a pas cette restriction : elle reste proposée dans les deux sens.
- Chaque carte porte un petit bouton « ⌖ » (« repartir d'ici ») : cliquer
  dessus en fait la nouvelle racine de l'exploration (y compris si elle est
  dans un autre secteur, atteint via une ventilation par secteur), et
  abandonne la décomposition en cours pour repartir à zéro depuis cette
  carte.
- Tant qu'au moins une identité est dépliée (sur la carte de départ ou sur
  une de ses cartes enfants), un panneau latéral à droite affiche un
  histogramme empilé divergent par identité active : chaque membre apporte
  sa contribution, dans sa propre couleur (positive vers le haut, négative
  vers le bas) autour d'un zéro central, avec une légende et le total
  reconstitué en bas. Déplier une sous-décomposition sur une carte enfant
  ajoute son propre panneau, marqué « niveau 2 », etc. ; refermer une
  identité referme aussi, en cascade, toutes les sous-décompositions
  ouvertes en dessous.

Les identités comptables proviennent de `data/formules_TEE.csv`, calculées
par `R/genere_formule_TEE.r` pour l'année 2024 uniquement ; le site applique
ces mêmes identités (year-invariantes par construction des comptes
nationaux) à toutes les années disponibles. Pour des années anciennes,
certains postes détaillés peuvent être indisponibles.

- « Ventilation en sous-secteur » se propose à n'importe quel niveau
  d'emboîtement de la nomenclature des secteurs, pas seulement S1 -> ses 5
  sous-secteurs : les administrations publiques (S13) se décomposent ainsi
  en administration centrale/locale/sécurité sociale (S1311/S1313/S1314),
  et l'administration centrale elle-même en État / organismes divers
  (S13111/S13112) — voir `regenerate_formules.py::build_ss_secteur` (le
  parent d'un secteur est le plus long préfixe réellement observé dans les
  données, la nomenclature sautant des niveaux : « S1311 » existe, « S131 »
  non).

- Pour quelques postes (production, valeur ajoutée, rémunération des
  salariés, FBCF, ...) de l'économie totale, un bouton supplémentaire
  « Ventilation en activité » déplie le poste par section d'activité NACE
  Rev.2 (agriculture, industrie, construction, ...), à partir du Tableau des
  ressources et emplois (SUT). Ce bouton n'est numériquement vérifié que pour
  les années où le total du SUT concorde avec la valeur du TEE (les deux
  sources ne sont pas toujours au même millésime) — en pratique 1978–2022.
- Le SUT fournit aussi quelques identités générales au niveau agrégé (total
  des emplois en prix d'acquisition, formation de capital, valeur ajoutée —
  voir `scripts/sut_formulas.py::LIEN_SUT_FORMULAS`) : elles apparaissent
  comme des boutons de définition ordinaires, y compris pour deux postes qui
  n'existent que dans le SUT (`TSPP`, total des emplois en prix
  d'acquisition ; `TSBP`, en prix de base — ce dernier n'a en pratique
  jamais de décomposition qui concorde avec les données).
- Le TEE lui-même fournit une identité du même genre, purement interne cette
  fois : `B9FX9 = B9F - B9`, l'écart statistique entre la capacité/besoin de
  financement mesuré par les comptes financiers (B9F) et non-financiers
  (B9) — voir `scripts/prepare_data.py::B9FX9_FORMULA`. Vérifiée 1996-2020
  (2021 pour la plupart des secteurs), pas au-delà (données encore
  provisoires) : c'est un écart de mesure réellement sujet à révision, pas
  une identité comptable vraie par construction comme les autres.
- Et une identité vraie par construction (`B9F_FORMULA`) : `B9F` lui-même se
  reconstitue comme la différence entre les flux d'actifs et de passifs
  financiers (poste `F`, décomposé en emploi/ressource) — vérifiée à 100%
  partout où `B9F` est publié (1996-2023 ; `F` n'a pas de variante « total »
  standard `INSTR_ASSET == "_Z"` comme les autres postes, son total porte le
  code `INSTR_ASSET == "F"` lui-même, chargé séparément par
  `add_missing_f_instruments`).
- Ce même poste `F` se déplie aussi par classe d'instrument financier
  (numéraire et dépôts, titres de créance, crédits, actions, ...), à
  n'importe quel niveau d'emboîtement — ex. `F = F1+...+F8`, puis
  `F5 = F51+F52`, puis `F51 = F511+F512+F519` — via un bouton « Ventilation
  en instrument financier », même principe que « Ventilation en
  sous-secteur »/« en sous-catégorie » (y compris la règle de ne se proposer
  que depuis la carte cible). Voir `load_nested_code_formulas` : les codes
  `INSTR_ASSET` (F1, F51, ...) sont traités comme des postes à part entière
  (aucun autre poste STO ne commence par « F »), validée par
  secteur/position/année comme B9F/B9FX9 ci-dessus.
- La dépense de consommation des ménages (`P31`) se déplie de la même façon
  par fonction de consommation (nomenclature COICOP — alimentation,
  logement, santé, ...), depuis un fichier séparé,
  `data/DD_CNA_CONSO_MENAGES_COICOP_data.csv` : `P31 = CP01+...+CP15` (ou
  `+CP16` selon le secteur — `CP16`, « Solde territorial », n'est un vrai
  composant du total que pour l'économie totale S1, pas pour les ménages
  S14 seuls, voir `P31_COICOP_TOP_FORMULA`), puis chaque division se déplie
  à son tour (`CP01 = CP011+CP012+CP013`, etc.) via
  `load_nested_code_formulas`. Ce fichier n'a de ventilation qu'à
  `COUNTERPART_AREA == "W2"`, alors que le TEE (source de la carte `P31`
  elle-même) correspond à `COUNTERPART_AREA == "W0"` : les deux concordent
  pour S1, mais pas pour S14 — le bouton racine `P31 = CP01+...` n'apparaît
  donc que sur la carte S1 (chaque division continue de se déplier
  normalement pour tous les secteurs, S14 y compris, une fois qu'on y est).
- Le bilan patrimonial (poste `LE_N`, « Patrimoine en fin d'année », depuis
  `data/DD_CNA_PATRIMOINE_data.csv`) se réconcilie avec les flux qui
  expliquent sa variation d'une année sur l'autre :
  `LE_N(N) = LE_N(N-1) + <flux>(N) + K7_ACTIFS_TOTAL(N) + KA_ACTIFS_TOTAL(N)`
  (réévaluations, autres changements de volume et ajustements — K7/KA
  comptent pour 0 s'ils ne sont pas publiés pour cet instrument, plutôt que
  d'exclure l'année). `<flux>` dépend de la classe d'actif : pour un
  instrument financier (code `F...`) c'est `F` (flux financiers) ; pour un
  actif NON financier (immobilier, systèmes d'armes, stocks, ... code
  `N...`) c'est l'investissement brut moins la consommation de capital
  fixe, `P5(N) - P51C(N)` — `P5` seul ne concorde jamais (l'investissement
  brut ne suffit pas à expliquer la variation du stock, il faut retrancher
  l'usure du capital). C'est la seule identité du site où un membre porte
  sur une AUTRE année que la carte affichée : le terme « année précédente »
  ouvre une carte à sa propre année (visible dans sa phrase et taguée dans
  l'équation, ex. « PAT_LE_N_F (2005) »), via un décalage d'année par
  membre (`yearOffset`) dans `graph.js::expandFormula`/`sameMember`. `LE_N`
  se déplie aussi par classe d'instrument/actif, comme le poste `F` du TEE
  (bouton « Ventilation en instrument financier (patrimoine) »).
- Une identité qui n'est vérifiée que pour certaines années (les identités
  ci-dessus qui ne sont pas vraies par construction) reste proposée en
  dehors de ces années plutôt que masquée,
  mais avec un avertissement « ⚠ » sur le bouton et au-dessus de l'équation
  dépliée (« Formule non vérifiée dans les données pour cette année ») :
  mieux vaut la montrer avec ce garde-fou que la faire disparaître sans
  explication.

## Régénérer les données

Si `data/DD_CNA_TEE_data.csv` est mis à jour (nouvel export INSEE) :

```
python3 scripts/prepare_data.py
```

Cela recrée `site/data/tee_graph.js` à partir de `data/formules_TEE.csv` et
`data/DD_CNA_TEE_data.csv`, sans transformation supplémentaire — le fichier
`formules_TEE.csv` est la source de vérité pour les identités comptables.

Si `R/genere_formule_TEE.r` est modifié (nouvelle identité, correction), il
faut d'abord régénérer `data/formules_TEE.csv` en le relançant sous R, **ou**,
si R n'est pas disponible, en relançant son portage Python équivalent :

```
python3 scripts/regenerate_formules.py   # relit R/genere_formule_TEE.r en Python, écrit data/formules_TEE.csv
python3 scripts/prepare_data.py          # puis régénère le site à partir du csv mis à jour
```

`scripts/regenerate_formules.py` reproduit fidèlement la logique du script R
(mêmes filtres, mêmes jointures de validation) ; toute modification du `.r`
doit être répercutée manuellement dans ce fichier. Si le script R est
modifié différemment de ce que ce portage reproduit, il vaut mieux régénérer
`formules_TEE.csv` directement avec R et ignorer `regenerate_formules.py`.

Si `data/DD_CNA_SUT_data.csv` est mis à jour, régénérer aussi
`data/formules_SUT.csv` (ventilation par activité, et identités générales du
SUT au niveau agrégé — total/emplois en prix d'acquisition, formation de
capital, valeur ajoutée — voir `scripts/sut_formulas.py::LIEN_SUT_FORMULAS`,
partagé avec `prepare_data.py` qui câble ces mêmes identités dans le site)
avant `prepare_data.py` :

```
python3 scripts/regenerate_formules_sut.py   # écrit data/formules_SUT.csv
python3 scripts/prepare_data.py
```

## Tests

```
node tests/test_graph.js        # logique de lookup/expansion (sans DOM)
node tests/test_app_render.js   # rendu des composants React (DOM simulé)
```

`test_graph.js` vérifie notamment que les identités comptables se
reconstituent bien numériquement (écart quasi nul) pour l'année 2024, aussi
bien pour une définition de solde que pour une ventilation par secteur.
`test_app_render.js` exécute les composants de `site/app.js` avec un React
et un DOM minimalistes simulés (aucune dépendance externe requise, comme
`jsdom`, qui n'a pas pu être installée dans cet environnement) et inclut un
test de dépliage récursif en profondeur pour détecter d'éventuelles erreurs
de rendu.

## Déployer sur Kubernetes (Helm)

Le site n'a besoin que de `site/` (fichiers statiques, données déjà
embarquées) servi par nginx :

```
docker build -t visu-tee:latest .
helm install visu-tee helm/visu-tee --set image.repository=visu-tee --set image.tag=latest
```

Chart minimal (`helm/visu-tee/`) : Deployment + Service + Ingress optionnel
(`--set ingress.enabled=true --set ingress.host=...`). Voir
`helm/visu-tee/values.yaml` pour les options.

## Source des données

INSEE, comptes nationaux annuels (base 2020), table SDMX `DD_CNA_TEE`.
Valeurs en euros courants, France, non consolidé, zone de contrepartie
« Monde » (W0), hors ventilation par instrument financier (même
convention, mais `INSTR_ASSET` variable au lieu de `"_Z"`). La
ventilation de `P31` par fonction de consommation (COICOP) vient d'une
table séparée, `DD_CNA_CONSO_MENAGES_COICOP`, à `COUNTERPART_AREA == "W2"`
(voir « Comment ça marche » ci-dessus).
