"""
Prépare les données du Tableau Économique d'Ensemble (TEE) pour le site
d'exploration par cartes (site/app.js).

Construit un graphe de valeurs : chaque nœud est une valeur observée
(secteur institutionnel x poste comptable x position C/D/B x année) et les
arêtes sont les identités comptables de data/formules_TEE.csv (définition
d'un solde, ventilation par sous-secteur, décomposition en sous-catégorie).

Le fichier formules_TEE.csv ne contient qu'un instantané pour l'année 2024
(généré par R/genere_formule_TEE.r) : les identités comptables qu'il décrit
sont considérées valables quelle que soit l'année (mêmes règles de calcul
des comptes nationaux), donc réutilisées telles quelles pour toutes les
années disponibles dans data/DD_CNA_TEE_data.csv.

Sortie : site/data/tee_graph.js (variable JS TEE_GRAPH), embarquée pour un
chargement sans serveur (file://).
"""
import csv
import json
import os
import sys

from sut_formulas import LIEN_SUT_FORMULAS

DATA_DIR = "data"
OUT_PATH = "site/data/tee_graph.js"

SECTEURS = ["S1", "S11", "S12", "S13", "S14", "S15"]

# priorité de détection de la "cible" d'une identité de type Définition (le
# solde que l'identité permet de calculer à partir des autres postes)
DEFINITION_TARGET_PRIORITY = ["B9", "B8G", "B6G", "B5G", "B1G"]

SEED = {"sector": "S1", "entry": "D", "sto": "D1"}


def load_metadata():
    labels = {"REF_SECTOR": {}, "STO": {}, "ACCOUNTING_ENTRY": {}}
    with open(f"{DATA_DIR}/DD_CNA_TEE_metadata.csv", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter=";", quotechar='"')
        for row in reader:
            var = row["COD_VAR"]
            if var in labels:
                labels[var][row["COD_MOD"]] = row["LIB_MOD"]
    return labels


def load_metadata_activite():
    labels = {}
    with open(f"{DATA_DIR}/DD_CNA_SUT_metadata.csv", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter=";", quotechar='"')
        for row in reader:
            if row["COD_VAR"] == "ACTIVITY":
                labels[row["COD_MOD"]] = row["LIB_MOD"]
    return labels


def add_missing_sto_labels(sto_labels):
    # DD_CNA_TEE_metadata.csv ne connaît pas les postes propres au SUT
    # (ex. TSPP, TSBP — voir LIEN_SUT_FORMULAS) : complète les libellés
    # manquants depuis DD_CNA_SUT_metadata.csv, sans écraser un libellé TEE
    # déjà présent.
    with open(f"{DATA_DIR}/DD_CNA_SUT_metadata.csv", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter=";", quotechar='"')
        for row in reader:
            if row["COD_VAR"] == "STO" and row["COD_MOD"] not in sto_labels:
                sto_labels[row["COD_MOD"]] = row["LIB_MOD"]


def add_missing_instrument_labels(sto_labels):
    # les classes d'instruments financiers (F1, F2, F51, ... — traitées
    # comme des postes, voir add_missing_f_instruments) ont leur libellé
    # sous COD_VAR == "INSTR_ASSET" dans DD_CNA_TEE_metadata.csv, pas
    # "STO" : complète sto_labels depuis là, sans écraser un libellé déjà
    # présent (le poste "F" lui-même a déjà le sien sous COD_VAR == "STO").
    with open(f"{DATA_DIR}/DD_CNA_TEE_metadata.csv", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter=";", quotechar='"')
        for row in reader:
            if row["COD_VAR"] == "INSTR_ASSET" and row["COD_MOD"] not in sto_labels:
                sto_labels[row["COD_MOD"]] = row["LIB_MOD"]


def add_missing_coicop_labels(sto_labels):
    # les fonctions de consommation COICOP (CP01, CP011, ... — traitées
    # comme des postes, voir add_missing_coicop_values) ont leur libellé
    # sous COD_VAR == "EXPENDITURE" dans
    # DD_CNA_CONSO_MENAGES_COICOP_metadata.csv.
    with open(f"{DATA_DIR}/DD_CNA_CONSO_MENAGES_COICOP_metadata.csv", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter=";", quotechar='"')
        for row in reader:
            if row["COD_VAR"] == "EXPENDITURE" and row["COD_MOD"] not in sto_labels:
                sto_labels[row["COD_MOD"]] = row["LIB_MOD"]


def load_formulas():
    # id_formule est ré-attribué à partir de 1 indépendamment pour chaque
    # bloc de calcul du script R (cur_group_id() par bloc) : il n'est donc
    # PAS unique globalement. On regroupe par (formule, id_formule).
    groups = {}  # "label|id" -> {"label": str, "members": [ {sector,entry,sto,signe} ]}
    with open(f"{DATA_DIR}/formules_TEE.csv", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter=",", quotechar='"')
        for row in reader:
            key = f"{row['formule']}|{row['id_formule']}"
            g = groups.setdefault(key, {"label": row["formule"], "members": []})
            g["members"].append({
                "sector": row["REF_SECTOR"],
                "entry": row["ACCOUNTING_ENTRY"],
                "sto": row["STO"],
                "signe": int(row["signe"]),
            })
    return groups


def detect_target(fid, group, labels):
    # la cible ne se déduit PAS du libellé de la formule (texte affiché,
    # librement renommable) mais de la structure de ses membres : pour une
    # ventilation, un critère explicite ; sinon (définitions de solde,
    # "Lien ..."), la cible est le membre "B" (position solde) qui
    # correspond à un poste de la liste de priorité, s'il y en a un.
    label = group["label"]
    members = group["members"]
    if label == "Ventilation en sous-secteur":
        for m in members:
            if m["sector"] == "S1":
                return m
        return members[0]
    if label == "Ventilation en sous-catégorie":
        return min(members, key=lambda m: len(m["sto"]))
    by_sto = {m["sto"]: m for m in members if m["entry"] == "B"}
    for candidate in DEFINITION_TARGET_PRIORITY:
        if candidate in by_sto:
            return by_sto[candidate]
    return members[0]


def load_values(src_csv, needed_keys):
    # needed_keys: set of (sector, entry, sto)
    values = {}  # sector -> entry -> sto -> year -> value
    status_priority = {"D": 0, "SD": 1, "PROV": 2}
    best_status = {}  # (sector,entry,sto,year) -> priority already stored
    with open(src_csv, encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter=";", quotechar='"')
        for row in reader:
            if row["UNIT_MEASURE"] != "XDC":
                continue
            if row["COUNTERPART_AREA"] != "W0":
                continue
            if row["CONSOLIDATION"] != "N":
                continue
            if row["INSTR_ASSET"] != "_Z":
                continue
            if row["TRANSFORMATION"] != "N":
                continue
            sec = row["REF_SECTOR"]
            entry = row["ACCOUNTING_ENTRY"]
            sto = row["STO"]
            key3 = (sec, entry, sto)
            if key3 not in needed_keys:
                continue
            val = row["OBS_VALUE"]
            if not val:
                continue
            year = row["TIME_PERIOD"]
            prio = status_priority.get(row["OBS_STATUS_FR"], 9)
            k4 = (sec, entry, sto, year)
            cur = best_status.get(k4)
            if cur is not None and cur <= prio:
                continue
            best_status[k4] = prio
            values.setdefault(sec, {}).setdefault(entry, {}).setdefault(sto, {})[year] = round(float(val), 1)
    return values


def load_sut(src_csv=None):
    # Tableau des ressources et emplois (SUT) : même traitement que
    # load_values() (filtre + sélection de colonnes) pour un fichier source
    # aux dimensions différentes (ACTIVITY x PRODUCT, classification CPA, en
    # plus de REF_SECTOR/ACCOUNTING_ENTRY/STO). Pas de CONSOLIDATION ni de
    # TRANSFORMATION dans ce fichier ; PRICES == "V" joue le rôle
    # équivalent (valeur courante, par opposition aux volumes chaînés "L").
    # Ne construit pour l'instant qu'une liste de lignes filtrées et
    # dédupliquées : pas encore intégré à la sortie site/data/tee_graph.js.
    src_csv = src_csv or f"{DATA_DIR}/DD_CNA_SUT_data.csv"
    cols = ["REF_SECTOR", "ACCOUNTING_ENTRY", "STO", "ACTIVITY", "PRODUCT", "TIME_PERIOD", "OBS_VALUE"]
    rows = []
    seen = set()
    with open(src_csv, encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter=";", quotechar='"')
        for r in reader:
            if r["UNIT_MEASURE"] != "XDC":
                continue
            if r["COUNTERPART_AREA"] != "W0":
                continue
            if r["INSTR_ASSET"] != "_Z":
                continue
            if r["PRICES"] != "V":
                continue
            if r["REF_SECTOR"] not in SECTEURS:
                continue
            val = r["OBS_VALUE"]
            if not val:
                continue
            row = {c: r[c] for c in cols}
            row["OBS_VALUE"] = float(val)
            key = tuple(row[c] for c in cols)
            if key in seen:
                continue
            seen.add(key)
            rows.append(row)
    return rows


def activite_target_keys():
    # (sector,entry,sto) des cibles de "Ventilation en activité" (le membre
    # ACTIVITY == "_T" de chaque bloc), pour s'assurer que load_values() les
    # couvre même si aucune formule TEE ne les référence par ailleurs. Filtre
    # sur le libellé "formule" : formules_SUT.csv contient aussi d'autres
    # identités (voir scripts/regenerate_formules_sut.py, LIEN_SUT_FORMULAS)
    # qui ciblent parfois le même (secteur, position, poste) qu'une
    # "Ventilation en activité" (ex. B1G, D1) sans en être une — à ignorer ici.
    keys = set()
    with open(f"{DATA_DIR}/formules_SUT.csv", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter=",", quotechar='"')
        for row in reader:
            if row["formule"] == "Ventilation en activité" and row["ACTIVITY"] == "_T":
                keys.add((row["REF_SECTOR"], row["ACCOUNTING_ENTRY"], row["STO"]))
    return keys


def load_activite_formulas(tee_values):
    # Ventilation par activité (SUT, voir scripts/regenerate_formules_sut.py) :
    # n'est proposée dans l'UI que pour les (secteur, position, poste, année)
    # où le total du SUT (ACTIVITY == "_T") concorde avec la valeur TEE du
    # même poste à la même année (écart < 1) — les deux sources ne sont pas
    # toujours au même millésime, et l'équation affichée serait sinon
    # incohérente avec la valeur de la carte TEE qu'on prétend décomposer.
    # Le membre cible n'a pas d'"activity" propre : c'est le poste TEE
    # ordinaire (même valeur, déjà dans tee_values), pas une valeur SUT
    # distincte — seuls les membres enfants (une section NACE chacun)
    # portent une valeur SUT, stockée à part dans activity_values.
    #
    # formules_SUT.csv contient un bloc distinct par (secteur,poste,ANNÉE) —
    # comme pour le TEE, la STRUCTURE de la ventilation (quelles activités la
    # composent) est invariante par construction des comptes nationaux ; on
    # regroupe donc tous les blocs validés d'un même poste en UNE SEULE
    # identité, avec la liste des années où elle est effectivement valide
    # (`years`) : sinon chaque année validée ajouterait son propre bouton
    # "Ventilation en activité" en double sur la même carte (getFormulasFor
    # filtre ensuite sur `years` pour l'année sélectionnée).
    sut_rows = load_sut()
    sut_lookup = {}  # (sector,entry,sto,activity,year) -> value, PRODUCT == "_T" uniquement
    for r in sut_rows:
        if r["PRODUCT"] != "_T":
            continue
        sut_lookup[(r["REF_SECTOR"], r["ACCOUNTING_ENTRY"], r["STO"], r["ACTIVITY"], r["TIME_PERIOD"])] = r["OBS_VALUE"]

    groups = {}
    with open(f"{DATA_DIR}/formules_SUT.csv", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter=",", quotechar='"')
        for row in reader:
            # formules_SUT.csv contient aussi d'autres identités que la
            # ventilation par activité (voir regenerate_formules_sut.py,
            # LIEN_SUT_FORMULAS) : hors sujet ici, à ignorer.
            if row["formule"] != "Ventilation en activité":
                continue
            key = f"{row['formule']}|{row['id_formule']}"
            groups.setdefault(key, []).append(row)

    # (sector,entry,sto) -> { years:set, target_signe:int, activities:{code:signe} }
    by_sto = {}
    activity_values = {}  # sector -> entry -> sto -> activity -> year -> value
    for rows in groups.values():
        target_row = next(r for r in rows if r["ACTIVITY"] == "_T")
        sec, entry, sto, year = (
            target_row["REF_SECTOR"], target_row["ACCOUNTING_ENTRY"],
            target_row["STO"], target_row["TIME_PERIOD"],
        )
        tee_val = (((tee_values.get(sec) or {}).get(entry) or {}).get(sto) or {}).get(year)
        if tee_val is None:
            continue
        sut_val = sut_lookup.get((sec, entry, sto, "_T", year))
        if sut_val is None or abs(sut_val - tee_val) >= 1:
            continue

        block = by_sto.setdefault((sec, entry, sto), {
            "years": set(), "target_signe": int(target_row["signe"]), "activities": {},
        })
        block["years"].add(year)
        for row in rows:
            activity = row["ACTIVITY"]
            if activity == "_T":
                continue
            block["activities"][activity] = int(row["signe"])
            sv = sut_lookup.get((sec, entry, sto, activity, year))
            if sv is None:
                continue
            by_activity = activity_values.setdefault(sec, {}).setdefault(entry, {}).setdefault(sto, {}).setdefault(activity, {})
            by_activity[year] = sv

    formulas = {}
    for (sec, entry, sto), block in by_sto.items():
        if len(block["activities"]) < 2:
            continue
        target_member = {"sector": sec, "entry": entry, "sto": sto, "signe": block["target_signe"]}
        members = [target_member] + [
            {"sector": sec, "entry": entry, "sto": sto, "activity": activity, "signe": signe}
            for activity, signe in sorted(block["activities"].items())
        ]
        fid = f"Ventilation en activité|{sec}-{entry}-{sto}"
        formulas[fid] = {
            "label": "Ventilation en activité",
            "target": target_member,
            "members": members,
            "years": sorted(block["years"]),
        }

    return formulas, activity_values


def _max_loaded_year(values):
    # borne commune à tous les add_missing_*(values) qui complètent `values`
    # depuis une source secondaire (SUT, APU implicite via le TEE, F,
    # COICOP...) : ne jamais étendre l'axe des années au-delà de ce que
    # couvre déjà le TEE. YEARS (site/app.js) prend le max sur toutes les
    # séries chargées pour choisir l'année par défaut ; une source
    # secondaire a régulièrement une année de plus que le TEE (ex. TSBP,
    # COICOP en 2025) sans aucune contrepartie — l'ajouter décalerait
    # l'année par défaut du site vers une année où la graine (D1/S1) n'a
    # pas de valeur, même si l'identité qui l'utilise ne concorde jamais.
    return max(
        (int(y) for sec_d in values.values() for sto_d in sec_d.values() for years in sto_d.values() for y in years),
        default=None,
    )


def add_missing_sut_values(values):
    # certains postes de LIEN_SUT_FORMULAS (ex. TSPP, TSBP) n'existent pas
    # dans le TEE (DD_CNA_TEE_data.csv), seulement dans le SUT — on les
    # ajoute à `values` au niveau agrégé (PRODUCT == "_T", ACTIVITY == "_T")
    # pour qu'ils puissent avoir une carte comme un poste TEE ordinaire. Ne
    # complète que les (entry, sto) totalement absents de `values` : ne
    # touche jamais un poste déjà chargé depuis le TEE (source primaire),
    # pour ne pas changer le comportement des cartes existantes.
    # Retourne les (sector, entry, sto) effectivement complétés depuis le
    # SUT, pour affichage de la source sur la carte (voir main()).
    added = set()
    have = {(entry, sto) for sec_d in values.values() for entry, sto_d in sec_d.items() for sto in sto_d}
    # ne pas non plus étendre l'axe des années au-delà de ce que couvre déjà
    # le TEE (voir _max_loaded_year)
    max_year = _max_loaded_year(values)
    needed = set()
    for label, target, members in LIEN_SUT_FORMULAS:
        needed.add(target)
        needed.update((entry, sto) for entry, sto, _ in members)
    missing = needed - have
    if not missing:
        return added
    for r in load_sut():
        if r["PRODUCT"] != "_T" or r["ACTIVITY"] != "_T":
            continue
        key = (r["ACCOUNTING_ENTRY"], r["STO"])
        if key not in missing:
            continue
        if max_year is not None and int(r["TIME_PERIOD"]) > max_year:
            continue
        values.setdefault(r["REF_SECTOR"], {}).setdefault(r["ACCOUNTING_ENTRY"], {}).setdefault(r["STO"], {})[r["TIME_PERIOD"]] = round(r["OBS_VALUE"], 1)
        added.add((r["REF_SECTOR"], r["ACCOUNTING_ENTRY"], r["STO"]))
    return added


# B9FX9 = B9F - B9 : écart entre la capacité/besoin de financement mesuré
# par les comptes financiers (B9F) et par les comptes non-financiers (B9) —
# l'"écart statistique" entre ces deux approches indépendantes du même
# concept. Contrairement aux identités TEE "structurelles" (vraies par
# construction, seulement limitées par la disponibilité des données),
# celle-ci est un écart de mesure réellement sujet à révision : validée
# 1996-2020 pour les 6 secteurs, mais pas pour 2021 (4/6) ni 2022-2023
# (0/6, données encore provisoires) — d'où load_generic_formulas plutôt
# qu'un bloc figé à une année de référence comme dans regenerate_formules.py.
B9FX9_FORMULA = [
    ("Lien écart statistique/soldes financier et non-financier", ("_Z", "B9FX9"),
        [("B", "B9F", 1), ("B", "B9", -1)]),
]

# B9F = F(emploi) - F(ressource) : le solde des flux financiers (B9F) tel
# que reconstitué à partir des flux d'actifs et passifs financiers eux-mêmes
# (STO "F", "Flux d'actifs ou passifs") — vérifié à 100% (168/168
# combinaisons secteur×année, écart nul partout où B9F est publié). F n'a
# pas de variante INSTR_ASSET == "_Z" comme les autres postes : son
# "total" (toutes classes d'actifs confondues) porte le code INSTR_ASSET
# == "F" lui-même (voir add_missing_f_instruments, qui la charge
# séparément — load_values() exclut tout INSTR_ASSET != "_Z").
B9F_FORMULA = [
    ("Lien solde des flux financiers/flux d'actifs et passifs financiers", ("B", "B9F"),
        [("D", "F", 1), ("C", "F", -1)]),
]


def add_missing_f_instruments(values, src_csv):
    # F (Flux d'actifs ou passifs) et toutes ses classes d'instruments —
    # INSTR_ASSET != "_Z" : F1, F2, F21, F22, F29, ..., F5, F51, F511, ...
    # emboîtées comme les codes STO (voir load_nested_code_formulas) —
    # ne sont jamais chargées par load_values() (qui ne garde que
    # INSTR_ASSET == "_Z"). Chargées ici séparément, mêmes filtres que
    # load_values() sauf sur INSTR_ASSET ; stockées comme si INSTR_ASSET
    # était lui-même le poste (STO), sans risque de collision : "F" est le
    # seul poste STO commençant par "F" dans les données. Restreint à
    # SECTEURS (comme load_values()), pour ne pas charger des sous-secteurs
    # financiers exotiques (S12K64...) sans autre carte pour les rejoindre.
    # Retourne les (secteur, position, code instrument) effectivement
    # ajoutés : le triplet complet pour marquer la source affichée sur la
    # carte (voir main()), le code seul (via un set(codes)) suffit à
    # load_nested_code_formulas pour savoir lesquels de
    # values[secteur][position] sont des instruments et pas un poste
    # ordinaire.
    added_codes = set()
    max_year = _max_loaded_year(values)
    with open(src_csv, encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter=";", quotechar='"')
        for row in reader:
            if row["STO"] != "F" or row["INSTR_ASSET"] == "_Z":
                continue
            if row["REF_SECTOR"] not in SECTEURS:
                continue
            if row["UNIT_MEASURE"] != "XDC":
                continue
            if row["COUNTERPART_AREA"] != "W0":
                continue
            if row["CONSOLIDATION"] != "N":
                continue
            if row["TRANSFORMATION"] != "N":
                continue
            sec, entry, instr, year = row["REF_SECTOR"], row["ACCOUNTING_ENTRY"], row["INSTR_ASSET"], row["TIME_PERIOD"]
            if max_year is not None and int(year) > max_year:
                continue
            val = row["OBS_VALUE"]
            if not val:
                continue
            bucket = values.setdefault(sec, {}).setdefault(entry, {}).setdefault(instr, {})
            if year not in bucket:
                bucket[year] = round(float(val), 1)
            added_codes.add((sec, entry, instr))
    return added_codes


DATA_CONSO_COICOP = f"{DATA_DIR}/DD_CNA_CONSO_MENAGES_COICOP_data.csv"


def add_missing_coicop_values(values, src_csv=None):
    # dépense de consommation des ménages (poste P31) par fonction
    # (nomenclature COICOP, EXPENDITURE != "_Z" : CP01, CP011, CP0111, ...
    # emboîtés comme les codes STO, voir load_nested_code_formulas et
    # P31_COICOP_TOP_FORMULA). Fichier séparé du TEE
    # (DD_CNA_CONSO_MENAGES_COICOP_data.csv) : COUNTERPART_AREA == "W2" et
    # PRODUCT == "_T" sont nécessaires ici (plusieurs lignes concurrentes
    # sinon, dont des lignes de correction spécifiques comme
    # CP_CANTINE_REVENU) — TEE/SUT/APU utilisaient COUNTERPART_AREA == "W0",
    # mais ce fichier n'a pas de ventilation COICOP à W0. Stockées comme si
    # EXPENDITURE était lui-même le poste (STO), sans risque de collision
    # (aucun poste STO ne commence par "CP"). Restreint à SECTEURS.
    added_codes = set()
    src_csv = src_csv or DATA_CONSO_COICOP
    max_year = _max_loaded_year(values)
    with open(src_csv, encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter=";", quotechar='"')
        for row in reader:
            if row["STO"] != "P31" or row["EXPENDITURE"] == "_Z":
                continue
            if row["REF_SECTOR"] not in SECTEURS:
                continue
            if row["UNIT_MEASURE"] != "XDC":
                continue
            if row["PRICES"] != "V":
                continue
            if row["COUNTERPART_AREA"] != "W2":
                continue
            if row["PRODUCT"] != "_T":
                continue
            sec, entry, code, year = row["REF_SECTOR"], row["ACCOUNTING_ENTRY"], row["EXPENDITURE"], row["TIME_PERIOD"]
            if max_year is not None and int(year) > max_year:
                continue
            val = row["OBS_VALUE"]
            if not val:
                continue
            bucket = values.setdefault(sec, {}).setdefault(entry, {}).setdefault(code, {})
            if year not in bucket:
                bucket[year] = round(float(val), 1)
            added_codes.add((sec, entry, code))
    return added_codes


# P31 = CP01 + ... + CP15/CP16 : la liste des divisions COICOP de premier
# niveau ("CPnn") ne se déduit pas de "P31" par troncature (contrairement
# aux niveaux plus fins, voir load_nested_code_formulas) — deux variantes
# candidates, car CP16 se comporte différemment selon le secteur : pour S1
# (économie totale) c'est une vraie 16e division, incluse dans le total ;
# pour S14 (ménages) le même code porte une valeur négative qui n'est PAS
# un composant du total (probablement une correction spécifique aux
# ménages) — l'inclure y fait diverger la somme de plusieurs milliers
# d'euros. Chaque variante n'est retenue, comme d'habitude, que si elle
# concorde numériquement (voir load_generic_formulas) : dans les faits,
# seule une des deux valide pour un secteur donné.
_CP_TOP_CODES_15 = [f"CP{n:02d}" for n in range(1, 16)]
_CP_TOP_CODES_16 = [f"CP{n:02d}" for n in range(1, 17)]
P31_COICOP_TOP_FORMULA = [
    ("Ventilation par fonction de consommation (COICOP)", ("D", "P31"),
        [("D", c, 1) for c in _CP_TOP_CODES_15]),
    ("Ventilation par fonction de consommation (COICOP)", ("D", "P31"),
        [("D", c, 1) for c in _CP_TOP_CODES_16]),
]


def load_nested_code_formulas(values, codes, label, entries=("D", "C")):
    # décomposition d'un poste par une nomenclature dont les codes
    # s'emboîtent par simple troncature du dernier caractère (contrairement
    # à celle des sous-secteurs des administrations publiques, qui saute
    # des niveaux — voir find_sector_parent dans regenerate_formules.py) :
    # même principe que build_ss_ventil (TEE, nomenclature STO), pour une
    # nomenclature qui n'est PAS elle-même le poste STO (ex. INSTR_ASSET
    # pour le poste F — voir add_missing_f_instruments — ou EXPENDITURE
    # pour le poste P31 — voir add_missing_coicop_values), dont les codes
    # sont donc traités comme des postes à part entière. Validée par
    # (secteur, position, année) directement sur `values`, comme
    # B9F_FORMULA/B9FX9_FORMULA (les postes très détaillés ne sont pas
    # toujours publiés pour toutes les années/tous les secteurs).
    formulas = {}
    index_extra = {}
    for sector in SECTEURS:
        for entry in entries:
            series_by_code = {c: (((values.get(sector) or {}).get(entry) or {}).get(c) or {}) for c in codes}
            for parent in codes:
                children = [c for c in codes if c != parent and c[:-1] == parent]
                if not children:
                    continue
                parent_series = series_by_code[parent]
                valid_years = []
                for year, parent_val in parent_series.items():
                    child_vals = []
                    ok = True
                    for c in children:
                        v = series_by_code[c].get(year)
                        if v is None:
                            ok = False
                            break
                        child_vals.append(v)
                    if ok and abs(parent_val - sum(child_vals)) < 1:
                        valid_years.append(year)
                if not valid_years:
                    continue
                fid = f"{label}|{sector}-{entry}-{parent}"
                member_dicts = [{"sector": sector, "entry": entry, "sto": parent, "signe": 1}]
                for c in sorted(children):
                    member_dicts.append({"sector": sector, "entry": entry, "sto": c, "signe": -1})
                formulas[fid] = {
                    "label": label,
                    "target": member_dicts[0],
                    "members": member_dicts,
                    "years": sorted(valid_years),
                }
                for m in member_dicts:
                    idxkey = f"{m['sector']}|{m['entry']}|{m['sto']}"
                    index_extra.setdefault(idxkey, []).append(fid)
    return formulas, index_extra


def load_generic_formulas(values, formula_specs):
    # identités "à plat" (pas de dimension activité, un seul membre cible)
    # dont la structure est invariante par secteur et par année par
    # construction des comptes nationaux, mais dont la disponibilité ou la
    # concordance effective varie — revalidées ici directement sur `values`
    # (déjà complété par add_missing_sut_values pour LIEN_SUT_FORMULAS),
    # plutôt que réutiliser un calcul déjà fait ailleurs (ex.
    # data/formules_SUT.csv), pour garantir l'accord avec ce qui est
    # réellement affiché (cf. load_activite_formulas : "les deux sources ne
    # sont pas toujours au même millésime"). Partagée par LIEN_SUT_FORMULAS
    # (sut_formulas.py) et B9FX9_FORMULA (ci-dessus).
    formulas = {}
    index_extra = {}  # "sector|entry|sto" -> [fid,...]
    for label, target, members in formula_specs:
        t_entry, t_sto = target
        for sector in SECTEURS:
            target_series = (((values.get(sector) or {}).get(t_entry) or {}).get(t_sto) or {})
            valid_years = []
            for year, target_val in target_series.items():
                total = 0.0
                ok = True
                for (entry, sto, signe_affiche) in members:
                    v = (((values.get(sector) or {}).get(entry) or {}).get(sto) or {}).get(year)
                    if v is None:
                        ok = False
                        break
                    total += signe_affiche * v
                if ok and abs(target_val - total) < 1:
                    valid_years.append(year)
            if not valid_years:
                continue
            fid = f"{label}|{sector}"
            member_dicts = [{"sector": sector, "entry": t_entry, "sto": t_sto, "signe": 1}]
            for (entry, sto, signe_affiche) in members:
                member_dicts.append({"sector": sector, "entry": entry, "sto": sto, "signe": -signe_affiche})
            formulas[fid] = {
                "label": label,
                "target": member_dicts[0],
                "members": member_dicts,
                "years": sorted(valid_years),
            }
            for m in member_dicts:
                idxkey = f"{m['sector']}|{m['entry']}|{m['sto']}"
                index_extra.setdefault(idxkey, []).append(fid)
    return formulas, index_extra


DATA_PATRIMOINE = f"{DATA_DIR}/DD_CNA_PATRIMOINE_data.csv"
# les 4 postes du bilan patrimonial dont on a besoin (voir
# load_patrimoine_reconciliation_formulas) ; "F" (flux) existe déjà comme
# poste dans le TEE avec une valeur légèrement différente (autre table,
# même grandeur) — d'où le préfixe "PAT_" pour éviter toute collision.
PATRIMOINE_STOS = ["LE_N", "F", "K7_ACTIFS_TOTAL", "KA_ACTIFS_TOTAL"]


def patrimoine_pseudo_sto(sto, instr):
    return f"PAT_{sto}_{instr}"


def add_missing_patrimoine_values(values, src_csv=None):
    # bilan patrimonial (poste LE_N, "Patrimoine en fin d'année") et sa
    # réconciliation avec les flux (F), les réévaluations
    # (K7_ACTIFS_TOTAL) et les autres changements de volume et ajustements
    # (KA_ACTIFS_TOTAL) — voir load_patrimoine_reconciliation_formulas.
    # Fichier séparé du TEE (DD_CNA_PATRIMOINE_data.csv), avec la même
    # dimension INSTR_ASSET emboîtée que le poste F du TEE (voir
    # add_missing_f_instruments), traitée ici pareil (le code devient le
    # poste), mais préfixé par patrimoine_pseudo_sto (voir PATRIMOINE_STOS).
    # Restreint à SECTEURS.
    src_csv = src_csv or DATA_PATRIMOINE
    stos = set(PATRIMOINE_STOS)
    added = set()
    max_year = _max_loaded_year(values)
    with open(src_csv, encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter=";", quotechar='"')
        for row in reader:
            if row["STO"] not in stos:
                continue
            if row["REF_SECTOR"] not in SECTEURS:
                continue
            if row["UNIT_MEASURE"] != "XDC":
                continue
            if row["PRICES"] != "V":
                continue
            if row["COUNTERPART_AREA"] != "W0":
                continue
            if row["MATURITY"] != "_Z":
                continue
            sec, entry, year = row["REF_SECTOR"], row["ACCOUNTING_ENTRY"], row["TIME_PERIOD"]
            if max_year is not None and int(year) > max_year:
                continue
            val = row["OBS_VALUE"]
            if not val:
                continue
            code = patrimoine_pseudo_sto(row["STO"], row["INSTR_ASSET"])
            bucket = values.setdefault(sec, {}).setdefault(entry, {}).setdefault(code, {})
            if year not in bucket:
                bucket[year] = round(float(val), 1)
            added.add((sec, entry, code))
    return added


def add_missing_patrimoine_labels(sto_labels, codes):
    # libellé composite "libellé du poste — libellé de l'instrument" pour
    # chaque pseudo-poste PAT_{sto}_{instrument} (voir
    # add_missing_patrimoine_values), à partir du libellé du poste
    # (DD_CNA_PATRIMOINE_metadata.csv — "F" a déjà le sien depuis le TEE)
    # et de celui de l'instrument (déjà complété par
    # add_missing_instrument_labels). Le cas agrégé (instrument "F",
    # "toutes classes") garde juste le libellé du poste.
    base_labels = {}
    with open(f"{DATA_DIR}/DD_CNA_PATRIMOINE_metadata.csv", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter=";", quotechar='"')
        for row in reader:
            if row["COD_VAR"] == "STO":
                base_labels.setdefault(row["COD_MOD"], row["LIB_MOD"])
                if row["COD_MOD"] not in sto_labels:
                    sto_labels[row["COD_MOD"]] = row["LIB_MOD"]

    for code in codes:
        if code in sto_labels:
            continue
        sto = next((s for s in PATRIMOINE_STOS if code.startswith(f"PAT_{s}_")), None)
        if sto is None:
            continue
        instr = code[len(f"PAT_{sto}_"):]
        sto_label = base_labels.get(sto, sto)
        sto_labels[code] = sto_label if instr == "F" else f"{sto_label} — {sto_labels.get(instr, instr)}"


def load_patrimoine_reconciliation_formulas(values, codes):
    # LE_N(N) = LE_N(N-1) + F(N) + K7_ACTIFS_TOTAL(N) + KA_ACTIFS_TOTAL(N) :
    # la position patrimoniale de clôture d'une année est celle de l'année
    # précédente, plus les flux financiers, les réévaluations et les
    # autres changements de volume de l'année (vérifié avant d'implémenter :
    # 3828/4020 combinaisons secteur×instrument×position×année concordent
    # exactement, le reste à de l'arrondi près). Première identité où un
    # membre porte sur une AUTRE année que la cible (yearOffset, voir
    # graph.js::expandFormula) : LE_N apparaît deux fois dans `members`,
    # une fois comme cible (yearOffset implicite 0) et une fois comme
    # membre décalé (yearOffset -1) — sameMember() les distingue par ce
    # décalage, sans quoi le second serait confondu avec la cible et
    # disparaîtrait du dépliage.
    label = "Lien patrimoine/flux, réévaluations et autres changements de volume"
    formulas = {}
    index_extra = {}
    le_n_prefix = "PAT_LE_N_"
    le_n_codes = sorted(c for c in codes if c.startswith(le_n_prefix))
    for sector in SECTEURS:
        for entry in ("D", "C"):
            for le_n_code in le_n_codes:
                instr = le_n_code[len(le_n_prefix):]
                f_code = patrimoine_pseudo_sto("F", instr)
                k7_code = patrimoine_pseudo_sto("K7_ACTIFS_TOTAL", instr)
                ka_code = patrimoine_pseudo_sto("KA_ACTIFS_TOTAL", instr)
                by_entry = values.get(sector) or {}
                le_n_series = ((by_entry.get(entry) or {}).get(le_n_code)) or {}
                f_series = ((by_entry.get(entry) or {}).get(f_code)) or {}
                k7_series = ((by_entry.get(entry) or {}).get(k7_code)) or {}
                ka_series = ((by_entry.get(entry) or {}).get(ka_code)) or {}
                if not le_n_series:
                    continue
                valid_years = []
                for year, target_val in le_n_series.items():
                    prev_val = le_n_series.get(str(int(year) - 1))
                    fv, k7v, kav = f_series.get(year), k7_series.get(year), ka_series.get(year)
                    if prev_val is None or fv is None or k7v is None or kav is None:
                        continue
                    if abs(target_val - (prev_val + fv + k7v + kav)) < 1:
                        valid_years.append(year)
                if not valid_years:
                    continue
                fid = f"{label}|{sector}-{entry}-{instr}"
                member_dicts = [
                    {"sector": sector, "entry": entry, "sto": le_n_code, "signe": 1},
                    {"sector": sector, "entry": entry, "sto": le_n_code, "signe": -1, "yearOffset": -1},
                    {"sector": sector, "entry": entry, "sto": f_code, "signe": -1},
                    {"sector": sector, "entry": entry, "sto": k7_code, "signe": -1},
                    {"sector": sector, "entry": entry, "sto": ka_code, "signe": -1},
                ]
                formulas[fid] = {
                    "label": label,
                    "target": member_dicts[0],
                    "members": member_dicts,
                    "years": sorted(valid_years),
                }
                seen_idx = set()
                for m in member_dicts:
                    idxkey = f"{m['sector']}|{m['entry']}|{m['sto']}"
                    if idxkey in seen_idx:
                        continue
                    seen_idx.add(idxkey)
                    index_extra.setdefault(idxkey, []).append(fid)
    return formulas, index_extra


def main():
    src_data = sys.argv[1] if len(sys.argv) > 1 else f"{DATA_DIR}/DD_CNA_TEE_data.csv"
    labels = load_metadata()
    formulas_raw = load_formulas()

    formulas = {}
    index = {}  # "sector|entry|sto" -> [id_formule,...]
    needed_keys = set()
    for fid, g in formulas_raw.items():
        # dédoublonnage défensif : la source contient parfois des lignes
        # dupliquées (COUNTERPART_SECTOR distinct dans la donnée d'origine,
        # colonne ensuite retirée par le script R) qui produisent le même
        # triplet (secteur, position, poste) plusieurs fois dans un groupe.
        seen = set()
        uniq_members = []
        for m in g["members"]:
            k = (m["sector"], m["entry"], m["sto"])
            if k in seen:
                continue
            seen.add(k)
            uniq_members.append(m)
        g["members"] = uniq_members

        target = detect_target(fid, g, labels)
        formulas[fid] = {
            "label": g["label"],
            "target": target,
            "members": g["members"],
        }
        for m in g["members"]:
            needed_keys.add((m["sector"], m["entry"], m["sto"]))
            idxkey = f"{m['sector']}|{m['entry']}|{m['sto']}"
            index.setdefault(idxkey, []).append(fid)

    # s'assurer que la valeur de départ (graine) est bien couverte même si
    # elle n'appartenait à aucune formule (par prudence)
    needed_keys.add((SEED["sector"], SEED["entry"], SEED["sto"]))
    # de même pour les cibles de "Ventilation en activité" (voir plus bas) :
    # doivent être couvertes par values même si aucune formule TEE ne les
    # référence par ailleurs, pour que le test d'accord TEE/SUT soit possible
    needed_keys |= activite_target_keys()
    # et pour les postes des identités SUT générales (LIEN_SUT_FORMULAS) :
    # priorité au TEE (source primaire) quand il les couvre déjà — certains
    # (ex. P7, P6) n'étaient chargés par aucune formule TEE existante et
    # auraient sinon été à tort complétés depuis le SUT par
    # add_missing_sut_values, qui ne doit combler que ce qui manque
    # réellement au TEE (TSPP, TSBP).
    lien_sut_keys = set()
    for label, target, members in LIEN_SUT_FORMULAS:
        lien_sut_keys.add(target)
        lien_sut_keys.update((entry, sto) for entry, sto, _ in members)
    needed_keys |= {(sector, entry, sto) for sector in SECTEURS for entry, sto in lien_sut_keys}
    # et pour B9F/B9FX9 (voir B9FX9_FORMULA) : ni l'un ni l'autre n'est
    # référencé par une formule TEE existante. B9FX9 est enregistré avec
    # ACCOUNTING_ENTRY == "_Z" (pas "B" comme B9/B9F) : ce n'est pas un
    # poste ressource/emploi/solde, mais un écart de mesure.
    needed_keys |= {(sector, "B", "B9F") for sector in SECTEURS}
    needed_keys |= {(sector, "_Z", "B9FX9") for sector in SECTEURS}

    values = load_values(src_data, needed_keys)

    # ventilation par activité (SUT) : n'ajoute une identité que pour les
    # (secteur, poste, année) où elle concorde avec la valeur TEE (voir
    # load_activite_formulas) ; les membres "feuille" (une activité chacun)
    # ne sont volontairement pas indexés, pour ne pas se re-proposer eux-mêmes
    activite_formulas, activity_values = load_activite_formulas(values)
    for fid, g in activite_formulas.items():
        formulas[fid] = g
        for m in g["members"]:
            if m.get("activity"):
                continue
            idxkey = f"{m['sector']}|{m['entry']}|{m['sto']}"
            index.setdefault(idxkey, []).append(fid)

    # identités générales du SUT (voir sut_formulas.py) : quelques postes
    # (TSPP, TSBP) n'existent pas dans le TEE, on les complète depuis le SUT
    # avant de revalider/câbler ces identités.
    sut_added = add_missing_sut_values(values)
    add_missing_sto_labels(labels["STO"])
    lien_formulas, lien_index = load_generic_formulas(values, LIEN_SUT_FORMULAS)
    formulas.update(lien_formulas)
    for idxkey, ids in lien_index.items():
        index.setdefault(idxkey, []).extend(ids)

    # B9FX9 = B9F - B9 (voir B9FX9_FORMULA) : même mécanisme, pas de source
    # à compléter (B9F/B9FX9 viennent déjà du TEE, voir needed_keys plus haut).
    # B9F = F(D) - F(C) (voir B9F_FORMULA) et la décomposition de F par
    # instrument (voir load_nested_code_formulas) : F et ses classes
    # d'instruments ne sont chargés par aucun autre mécanisme,
    # add_missing_f_instruments les complète depuis le TEE avant de
    # valider/câbler ces identités. P31 (dépense de consommation des
    # ménages) est déjà chargé depuis le TEE ; sa décomposition par
    # fonction (COICOP, P31_COICOP_TOP_FORMULA) vient d'un fichier séparé
    # (add_missing_coicop_values).
    instrument_added = add_missing_f_instruments(values, src_data)
    add_missing_instrument_labels(labels["STO"])
    coicop_added = add_missing_coicop_values(values)
    add_missing_coicop_labels(labels["STO"])
    # bilan patrimonial (LE_N) et sa réconciliation avec les flux,
    # réévaluations et autres changements de volume (voir
    # load_patrimoine_reconciliation_formulas) : chargé après les autres
    # add_missing_* pour que _max_loaded_year reflète déjà tout ce qui a
    # été complété jusqu'ici.
    patrimoine_added = add_missing_patrimoine_values(values)
    patrimoine_codes = {c for _, _, c in patrimoine_added}
    add_missing_patrimoine_labels(labels["STO"], patrimoine_codes)
    tee_generic_formulas, tee_generic_index = load_generic_formulas(
        values, B9FX9_FORMULA + B9F_FORMULA + P31_COICOP_TOP_FORMULA)
    formulas.update(tee_generic_formulas)
    for idxkey, ids in tee_generic_index.items():
        index.setdefault(idxkey, []).extend(ids)

    f_instrument_formulas, f_instrument_index = load_nested_code_formulas(
        values, {c for _, _, c in instrument_added}, "Ventilation en instrument financier")
    formulas.update(f_instrument_formulas)
    for idxkey, ids in f_instrument_index.items():
        index.setdefault(idxkey, []).extend(ids)

    coicop_formulas, coicop_index = load_nested_code_formulas(
        values, {c for _, _, c in coicop_added}, "Ventilation par fonction de consommation (COICOP)", entries=("D",))
    formulas.update(coicop_formulas)
    for idxkey, ids in coicop_index.items():
        index.setdefault(idxkey, []).extend(ids)

    patrimoine_instr_formulas, patrimoine_instr_index = load_nested_code_formulas(
        values, patrimoine_codes, "Ventilation en instrument financier (patrimoine)")
    formulas.update(patrimoine_instr_formulas)
    for idxkey, ids in patrimoine_instr_index.items():
        index.setdefault(idxkey, []).extend(ids)

    patrimoine_reco_formulas, patrimoine_reco_index = load_patrimoine_reconciliation_formulas(
        values, patrimoine_codes)
    formulas.update(patrimoine_reco_formulas)
    for idxkey, ids in patrimoine_reco_index.items():
        index.setdefault(idxkey, []).extend(ids)

    # source des données affichée en petit sur chaque carte (site/app.js,
    # graph.js::sourceFor) : "DD_CNA_TEE" par défaut (non stockée), sauf
    # exception explicite ici. instrument_added (classes d'instruments
    # financiers) n'a pas d'entrée : ce sont toujours des lignes de
    # DD_CNA_TEE_data.csv (juste une autre valeur d'INSTR_ASSET), donc la
    # source par défaut reste correcte. coicop_added vient en revanche d'un
    # fichier entièrement différent. D'autres sources futures s'ajouteront
    # de la même façon.
    poste_source = {f"{sec}|{entry}|{sto}": "DD_CNA_SUT" for sec, entry, sto in sut_added}
    poste_source.update({f"{sec}|{entry}|{sto}": "DD_CNA_CONSO_MENAGES_COICOP" for sec, entry, sto in coicop_added})
    poste_source.update({f"{sec}|{entry}|{sto}": "DD_CNA_PATRIMOINE" for sec, entry, sto in patrimoine_added})

    # secteurs réellement utilisés : au-delà des 6 de SECTEURS, la
    # décomposition en sous-secteur des administrations publiques (voir
    # build_ss_secteur/SOUS_SECTEURS_S13 dans regenerate_formules.py)
    # introduit S1311, S13111, S13112, S1312, S1313, S1314 — leurs libellés
    # existent déjà dans DD_CNA_TEE_metadata.csv, juste pas dans SECTEURS.
    # inclut aussi les secteurs référencés uniquement comme membre d'une
    # formule mais sans valeur propre (ex. S1312 : pas d'échelon "État
    # fédéré" en France, la carte affiche "—" mais a quand même besoin d'un
    # libellé de secteur dans sa phrase)
    all_secteurs = sorted(
        set(SECTEURS) | set(values.keys())
        | {m["sector"] for g in formulas.values() for m in g["members"]}
    )

    payload = {
        "unit": "Millions d'euros courants",
        "seed": SEED,
        "secteurs": all_secteurs,
        "labelsSecteur": {s: labels["REF_SECTOR"].get(s, s) for s in all_secteurs},
        "labelsSto": labels["STO"],
        "labelsEntry": labels["ACCOUNTING_ENTRY"],
        "labelsActivity": load_metadata_activite(),
        "formulas": formulas,
        "index": index,
        "values": values,
        "activityValues": activity_values,
        "posteSource": poste_source,
    }

    os.makedirs("site/data", exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        f.write("// Fichier généré par scripts/prepare_data.py — ne pas éditer à la main.\n")
        f.write("const TEE_GRAPH = ")
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")

    n_keys = len(needed_keys)
    n_formulas = len(formulas)
    n_activite = len(activite_formulas)
    n_lien_sut = len(lien_formulas)
    print(f"OK — {OUT_PATH} généré : {n_formulas} identités comptables "
          f"(dont {n_activite} ventilations par activité, {n_lien_sut} identités SUT générales), "
          f"{n_keys} postes (secteur x poste x position) suivis.")


if __name__ == "__main__":
    main()
