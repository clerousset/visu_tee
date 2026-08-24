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

- On part d'une carte (par défaut : capacité/besoin de financement — B9 —
  de l'économie totale, année la plus récente). Poste de départ et année
  sont modifiables en haut de page ; les autres secteurs restent
  accessibles en dépliant les identités de ventilation par secteur.
- Si la valeur affichée participe à une ou plusieurs identités comptables,
  des boutons apparaissent sous la carte, avec le libellé brut de
  `formules_TEE.csv` (ex. « Lien B9 B8 », « Ventilation en sous-secteur »).
- Cliquer sur un bouton déplie les autres postes de cette identité, avec un
  badge +/- indiquant s'ils s'ajoutent ou se retranchent pour reconstituer
  la valeur de départ, et l'équation correspondante affichée en toutes
  lettres. Chaque nouvelle carte peut à son tour être dépliée.
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

- Pour quelques postes (production, valeur ajoutée, rémunération des
  salariés, FBCF, ...) de l'économie totale, un bouton supplémentaire
  « Ventilation en activité » déplie le poste par section d'activité NACE
  Rev.2 (agriculture, industrie, construction, ...), à partir du Tableau des
  ressources et emplois (SUT). Ce bouton n'apparaît que pour les années où
  le total du SUT concorde avec la valeur du TEE (les deux sources ne sont
  pas toujours au même millésime) — en pratique 1978–2022.

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
`data/formules_SUT.csv` (identité de ventilation par activité) avant
`prepare_data.py` :

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
« Monde » (W0), hors ventilation par instrument financier.
