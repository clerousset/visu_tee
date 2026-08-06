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


def is_definition_label(label):
    # "Lien B9 B8" est une identité de définition comme les autres (elle
    # relie B9 à B8G + ses composantes), simplement nommée différemment
    # dans le script R.
    return label.startswith("Définition") or label == "Lien B9 B8"


def detect_target(fid, group, labels):
    label = group["label"]
    members = group["members"]
    if is_definition_label(label):
        by_sto = {m["sto"]: m for m in members if m["entry"] == "B"}
        for candidate in DEFINITION_TARGET_PRIORITY:
            if candidate in by_sto:
                return by_sto[candidate]
        return members[0]
    if label == "Ventilation en sous-secteur":
        for m in members:
            if m["sector"] == "S1":
                return m
        return members[0]
    if label == "Ventilation en sous-catégorie":
        return min(members, key=lambda m: len(m["sto"]))
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

    values = load_values(src_data, needed_keys)

    payload = {
        "unit": "Millions d'euros courants",
        "seed": SEED,
        "secteurs": SECTEURS,
        "labelsSecteur": {s: labels["REF_SECTOR"].get(s, s) for s in SECTEURS},
        "labelsSto": labels["STO"],
        "labelsEntry": labels["ACCOUNTING_ENTRY"],
        "formulas": formulas,
        "index": index,
        "values": values,
    }

    os.makedirs("site/data", exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        f.write("// Fichier généré par scripts/prepare_data.py — ne pas éditer à la main.\n")
        f.write("const TEE_GRAPH = ")
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")

    n_keys = len(needed_keys)
    n_formulas = len(formulas)
    print(f"OK — {OUT_PATH} généré : {n_formulas} identités comptables, {n_keys} postes (secteur x poste x position) suivis.")


if __name__ == "__main__":
    main()
