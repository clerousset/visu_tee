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

DATA_DIR = "data"
OUT_PATH = "site/data/tee_graph.js"

SECTEURS = ["S1", "S11", "S12", "S13", "S14", "S15"]

# priorité de détection de la "cible" d'une identité de type Définition (le
# solde que l'identité permet de calculer à partir des autres postes)
DEFINITION_TARGET_PRIORITY = ["B9", "B8G", "B6G", "B5G", "B1G"]

SEED = {"sector": "S1", "entry": "B", "sto": "B9"}


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
    # couvre même si aucune formule TEE ne les référence par ailleurs.
    keys = set()
    with open(f"{DATA_DIR}/formules_SUT.csv", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter=",", quotechar='"')
        for row in reader:
            if row["ACTIVITY"] == "_T":
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
            key = f"{row['formule']}|{row['id_formule']}"
            groups.setdefault(key, []).append(row)

    formulas = {}
    activity_values = {}  # sector -> entry -> sto -> activity -> year -> value
    for fid, rows in groups.items():
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

        members = []
        target_member = None
        for row in rows:
            activity = row["ACTIVITY"]
            if activity == "_T":
                target_member = {"sector": sec, "entry": entry, "sto": sto, "signe": int(row["signe"])}
                members.append(target_member)
                continue
            sv = sut_lookup.get((sec, entry, sto, activity, year))
            if sv is None:
                continue
            members.append({"sector": sec, "entry": entry, "sto": sto, "activity": activity, "signe": int(row["signe"])})
            by_activity = activity_values.setdefault(sec, {}).setdefault(entry, {}).setdefault(sto, {}).setdefault(activity, {})
            by_activity[year] = sv

        if len(members) < 2:
            continue
        formulas[fid] = {"label": target_row["formule"], "target": target_member, "members": members}

    return formulas, activity_values


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

    payload = {
        "unit": "Millions d'euros courants",
        "seed": SEED,
        "secteurs": SECTEURS,
        "labelsSecteur": {s: labels["REF_SECTOR"].get(s, s) for s in SECTEURS},
        "labelsSto": labels["STO"],
        "labelsEntry": labels["ACCOUNTING_ENTRY"],
        "labelsActivity": load_metadata_activite(),
        "formulas": formulas,
        "index": index,
        "values": values,
        "activityValues": activity_values,
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
    print(f"OK — {OUT_PATH} généré : {n_formulas} identités comptables "
          f"(dont {n_activite} ventilations par activité), {n_keys} postes (secteur x poste x position) suivis.")


if __name__ == "__main__":
    main()
