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
    # le TEE : YEARS (site/app.js) prend le max sur toutes les séries
    # chargées pour choisir l'année par défaut, et TSBP par exemple a une
    # année 2025 en SUT sans aucune contrepartie TEE — l'ajouter décalerait
    # l'année par défaut du site vers une année où la graine (D1/S1) n'a pas
    # de valeur, même si l'identité qui l'utilise ne concorde jamais.
    max_year = max(
        (int(y) for sec_d in values.values() for sto_d in sec_d.values() for years in sto_d.values() for y in years),
        default=None,
    )
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


def load_lien_sut_formulas(values):
    # identités générales du SUT au niveau agrégé (voir sut_formulas.py) :
    # la structure (quels postes la composent) est invariante par secteur et
    # par année par construction des comptes nationaux, mais sa
    # disponibilité effective varie — revalidée ici directement sur `values`
    # (déjà complété par add_missing_sut_values), plutôt que réutiliser le
    # calcul déjà fait pour data/formules_SUT.csv, pour garantir l'accord
    # avec ce qui est réellement affiché (cf. load_activite_formulas : "les
    # deux sources ne sont pas toujours au même millésime").
    formulas = {}
    index_extra = {}  # "sector|entry|sto" -> [fid,...]
    for label, target, members in LIEN_SUT_FORMULAS:
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
    lien_formulas, lien_index = load_lien_sut_formulas(values)
    formulas.update(lien_formulas)
    for idxkey, ids in lien_index.items():
        index.setdefault(idxkey, []).extend(ids)

    # source des données affichée en petit sur chaque carte (site/app.js,
    # graph.js::sourceFor) : "DD_CNA_TEE" par défaut (non stockée), sauf
    # exception explicite ici — pour l'instant seulement les quelques
    # postes complétés depuis le SUT (sut_added). D'autres sources futures
    # s'ajouteront de la même façon.
    poste_source = {f"{sec}|{entry}|{sto}": "DD_CNA_SUT" for sec, entry, sto in sut_added}

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
