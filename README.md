# Visualisation du Tableau Économique d'Ensemble (TEE)

Site de visualisation de la séquence des comptes des comptes nationaux
annuels français (INSEE), par secteur institutionnel (économie totale,
sociétés non financières, sociétés financières, administrations publiques,
ménages, ISBLSM), de 1949 à 2024.

## Structure du dépôt

```
data/     données sources (SDMX INSEE) : DD_CNA_TEE_data.csv, métadonnées, formules
R/        script R d'origine (validation des identités comptables)
scripts/  scripts Python de préparation des données pour le site
site/     site web statique (HTML/CSS/JS, aucun serveur requis)
tests/    test de non-régression sur la logique du site (sans dépendance)
```

## Ouvrir le site

Ouvrir `site/index.html` directement dans un navigateur (double-clic). Aucun
serveur n'est nécessaire : les données sont embarquées dans
`site/data/tee_data.js`.

La bibliothèque de graphiques (Chart.js) est chargée depuis un CDN au premier
affichage (avec repli automatique sur 3 CDN différents en cas d'échec) : une
connexion internet est donc nécessaire à l'ouverture. Si le message « Chart is
not defined » ou un bandeau d'erreur apparaît, c'est que les 3 CDN étaient
inaccessibles (pare-feu, absence de connexion) — vérifier la connexion et
recharger la page. Pour un usage garanti hors-ligne, télécharger
`chart.umd.min.js` (version 4.4.4) depuis https://www.chartjs.org, le placer
dans `site/vendor/chart.umd.min.js`, et remplacer dans `site/index.html` le
tableau d'URLs CDN par `['vendor/chart.umd.min.js']`.

Le site présente, pour le secteur et l'année sélectionnés :
- la **séquence des comptes** sous forme de cascade (valeur ajoutée brute →
  EBE/revenu mixte → solde des revenus primaires → revenu disponible brut →
  épargne brute → capacité/besoin de financement) ;
- l'**évolution** d'un solde choisi dans le temps, pour un secteur ou en
  comparaison des 6 secteurs ;
- une **comparaison sectorielle** pour l'année sélectionnée.

## Régénérer les données

Si `data/DD_CNA_TEE_data.csv` est mis à jour (nouvel export INSEE), régénérer
le fichier de données du site :

```
python3 scripts/prepare_data.py
```

Cela recrée `site/data/tee_data.js` à partir des fichiers CSV du dossier
`data/`. Le script ne dépend que de la bibliothèque standard Python (aucune
installation requise).

## Tests

```
node tests/test_app.js
```

Exécute `site/app.js` dans un environnement simulé (sans navigateur réel) et
vérifie qu'aucune erreur ne survient, que les 3 graphiques attendus sont bien
construits, et que les valeurs sont dans une plage plausible.

## Source des données

INSEE, comptes nationaux annuels (base 2020), table SDMX `DD_CNA_TEE`.
Valeurs en euros courants, France, non consolidé, zone de contrepartie
« Monde » (W0), hors ventilation par instrument financier.
