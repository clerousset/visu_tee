"""
Identités comptables générales du SUT au niveau agrégé (économie totale
S1..S15, produit _T), transcrites de R/etude.r. Module partagé par :
- scripts/regenerate_formules_sut.py (génère data/formules_SUT.csv, validé
  à partir des données SUT brutes) ;
- scripts/prepare_data.py (câble ces identités dans site/data/tee_graph.js,
  revalidées à partir des valeurs effectivement chargées — voir
  load_lien_sut_formulas — pour éviter tout écart avec ce qui est affiché).

Format de chaque entrée : (label, cible (entry, sto), membres
[(entry, sto, signe affiché dans l'équation), ...]).
"""

# sections NACE Rev.2 (A à U) : le niveau le plus agrégé de la nomenclature
# d'activité du SUT, hors code "_T" (total) lui-même. Partagé par
# regenerate_formules_sut.py (Ventilation en activité) et prepare_data.py
# (LIEN_SUT_FORMULAS_ACTIVITE ci-dessous).
LETTERS_NACE = set("ABCDEFGHIJKLMNOPQRSTU")

LIEN_SUT_FORMULAS = [
    ("Lien total des ressources (prix de base)", ("C", "TSBP"),
        [("C", "P1", 1), ("C", "P7", 1)]),
    ("Lien total des emplois (prix d'acquisition/prix de base)", ("C", "TSPP"),
        [("C", "P1", 1), ("C", "P7", 1), ("D", "D21", 1), ("D", "D31", 1)]),
    ("Décomposition du total des emplois (prix d'acquisition)", ("C", "TSPP"),
        [("D", "P2", 1), ("D", "P3", 1), ("D", "P5", 1), ("D", "P6", 1)]),
    ("Décomposition de la formation de capital (P5)", ("D", "P5"),
        [("D", "P51G", 1), ("D", "P53", 1), ("D", "P52", 1)]),
    ("Lien valeur ajoutée/production-consommations intermédiaires", ("B", "B1G"),
        [("C", "P1", 1), ("D", "P2", -1)]),
    ("Lien valeur ajoutée/rémunérations et excédent brut d'exploitation", ("B", "B1G"),
        [("B", "B2A3G", 1), ("D", "D1", 1), ("D", "D29", 1), ("D", "D39", 1)]),
    ("Lien impôts nets des subventions sur les produits", ("C", "D21X31"),
        [("C", "D21", 1), ("C", "D31", 1)]),
]

# Comme LIEN_SUT_FORMULAS, mais vérifiée aussi section NACE par section NACE
# (ACTIVITY dans LETTERS_NACE, pas seulement l'agrégat "_T") : contrairement
# à "Ventilation en activité" (qui décompose UN poste en ses sections),
# ceci relie plusieurs postes SUT ENTRE EUX à une même section NACE (même
# principe comptable qu'au niveau agrégé, revérifié indépendamment pour
# chaque section). Seule "Lien valeur ajoutée/rémunérations..." est
# concernée pour l'instant : B1G, B2A3G, D1, D29, D39 sont les seuls postes
# SUT de LIEN_SUT_FORMULAS à avoir une vraie ventilation par activité dans
# les données (voir DD_CNA_SUT_data.csv) — les autres (TSBP, TSPP, P1, P7,
# P2, P3, P5, ...) n'existent qu'à ACTIVITY == "_T".
LIEN_SUT_FORMULAS_ACTIVITE = [
    ("Lien valeur ajoutée/rémunérations et excédent brut d'exploitation", ("B", "B1G"),
        [("B", "B2A3G", 1), ("D", "D1", 1), ("D", "D29", 1), ("D", "D39", 1)]),
]
