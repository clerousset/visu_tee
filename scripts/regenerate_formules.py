"""
Portage Python de R/genere_formule_TEE.r, pour régénérer data/formules_TEE.csv
sans dépendre d'une installation de R (non disponible dans cet environnement).

Reproduit fidèlement la logique du script R (mêmes filtres, mêmes jointures
de validation numérique `abs(somme - valeur) < 1`, mêmes règles de signe).
Le seul écart assumé : les identifiants `id_formule` ne reproduisent pas
exactement la numérotation de `cur_group_id()` de dplyr (non nécessaire :
scripts/prepare_data.py regroupe par (formule, id_formule) sans se soucier
de la valeur numérique elle-même, seule l'unicité par bloc compte).

À relancer si data/DD_CNA_TEE_data.csv change, ou si R/genere_formule_TEE.r
est modifié (à répercuter manuellement ici).
"""
import csv
import itertools

DATA_DIR = "data"
SRC = f"{DATA_DIR}/DD_CNA_TEE_data.csv"
OUT = f"{DATA_DIR}/formules_TEE.csv"

LISTE_REF_SECTOR = {"S1", "S11", "S12", "S13", "S14", "S15"}
LISTE_EXCLUS = {"B2A3N", "B4G", "D21X31"}


def load_df():
    rows = []
    with open(SRC, encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter=";", quotechar='"')
        for r in reader:
            if r["TIME_PERIOD"] != "2024":
                continue
            if r["UNIT_MEASURE"] != "XDC":
                continue
            if r["REF_SECTOR"] not in LISTE_REF_SECTOR:
                continue
            if r["COUNTERPART_AREA"] != "W0":
                continue
            if r["CONSOLIDATION"] != "N":
                continue
            if r["INSTR_ASSET"] != "_Z":
                continue
            val = r["OBS_VALUE"]
            rows.append({
                "REF_SECTOR": r["REF_SECTOR"],
                "TIME_PERIOD": r["TIME_PERIOD"],
                "OBS_VALUE": float(val) if val else None,
                "ACCOUNTING_ENTRY": r["ACCOUNTING_ENTRY"],
                "STO": r["STO"],
                "COUNTERPART_SECTOR": r["COUNTERPART_SECTOR"],
            })
    # distinct() sur (REF_SECTOR,TIME_PERIOD,OBS_VALUE,ACCOUNTING_ENTRY,STO,COUNTERPART_SECTOR)
    seen = set()
    df = []
    for r in rows:
        key = (r["REF_SECTOR"], r["TIME_PERIOD"], r["OBS_VALUE"], r["ACCOUNTING_ENTRY"], r["STO"], r["COUNTERPART_SECTOR"])
        if key in seen:
            continue
        seen.add(key)
        df.append(r)
    return df


def new_id_sequence():
    """Retourne une fonction qui attribue un entier croissant à chaque
    nouvelle clé de groupe rencontrée (équivalent fonctionnel de
    cur_group_id(), sans reproduire l'ordre exact de tri de dplyr)."""
    mapping = {}
    counter = itertools.count(1)

    def get(key):
        if key not in mapping:
            mapping[key] = next(counter)
        return mapping[key]
    return get


def build_ss_secteur(df):
    # décomposition en sous-secteur, à n'importe quel niveau d'emboîtement
    # de la nomenclature REF_SECTOR (ex. S1 = S11+S12+...+S15, et
    # séparément S13 = S131+S132 si de tels codes sont un jour présents
    # dans les données) : même principe que build_ss_ventil, mais appliqué
    # à REF_SECTOR plutôt qu'à STO — le "parent" d'un secteur est son
    # propre code privé de son dernier caractère (S131 -> S13 -> S1) ; un
    # bloc n'est retenu que si ce parent existe bien comme secteur observé,
    # que la somme de ses enfants directs reconstitue sa valeur (tolérance
    # < 1), et que le poste n'est pas dans LISTE_EXCLUS. Avec le jeu de
    # secteurs actuel (S1, S11..S15), ceci redonne exactement l'ancienne
    # décomposition à un seul niveau (S11..S15 sont tous enfants directs de S1).
    by_key = {(r["ACCOUNTING_ENTRY"], r["STO"], r["TIME_PERIOD"], r["REF_SECTOR"]): r for r in df}

    children_by_parent = {}
    for r in df:
        sector = r["REF_SECTOR"]
        if len(sector) < 3:
            continue
        parent = sector[:-1]
        k = (r["ACCOUNTING_ENTRY"], r["STO"], r["TIME_PERIOD"], parent)
        if k not in by_key:
            continue
        children_by_parent.setdefault(k, []).append(r)

    get_id = new_id_sequence()
    out = []
    for k, kids in children_by_parent.items():
        entry, sto, time_period, parent = k
        if sto in LISTE_EXCLUS:
            continue
        parent_row = by_key[k]
        if parent_row["OBS_VALUE"] is None:
            continue
        total = sum((c["OBS_VALUE"] or 0.0) for c in kids)
        if abs(total - parent_row["OBS_VALUE"]) >= 1:
            continue
        fid = get_id(k)
        out.append({
            "REF_SECTOR": parent, "TIME_PERIOD": time_period,
            "ACCOUNTING_ENTRY": entry, "STO": sto,
            "signe": 1, "formule": "Ventilation en sous-secteur", "id_formule": fid,
        })
        for c in kids:
            out.append({
                "REF_SECTOR": c["REF_SECTOR"], "TIME_PERIOD": time_period,
                "ACCOUNTING_ENTRY": entry, "STO": sto,
                "signe": -1, "formule": "Ventilation en sous-secteur", "id_formule": fid,
            })
    return out


def build_ss_ventil(df):
    # décomposition en sous-catégorie, à n'importe quel niveau d'emboîtement
    # de la nomenclature STO (ex. D4 = D41+D42+...+D45, et séparément
    # D42 = D421+D422) : pour chaque poste, son "parent" est son propre code
    # privé de son dernier caractère (D421 -> D42 -> D4) ; un bloc n'est
    # retenu que si ce parent existe bien comme poste observé et que la
    # somme de ses enfants directs reconstitue sa valeur (tolérance < 1)
    cd = [r for r in df if r["ACCOUNTING_ENTRY"] in ("C", "D")]
    by_key = {(r["ACCOUNTING_ENTRY"], r["TIME_PERIOD"], r["REF_SECTOR"], r["STO"]): r for r in cd}

    children_by_parent = {}
    for r in cd:
        sto = r["STO"]
        if len(sto) < 3:
            continue
        parent = sto[:-1]
        k = (r["ACCOUNTING_ENTRY"], r["TIME_PERIOD"], r["REF_SECTOR"], parent)
        if k not in by_key:
            continue
        children_by_parent.setdefault(k, []).append(r)

    get_id = new_id_sequence()
    out = []
    for k, kids in children_by_parent.items():
        entry, time_period, sector, parent = k
        parent_row = by_key[k]
        if parent_row["OBS_VALUE"] is None:
            continue
        total = sum((c["OBS_VALUE"] or 0.0) for c in kids)
        if abs(total - parent_row["OBS_VALUE"]) >= 1:
            continue
        fid = get_id((entry, parent, time_period, sector))
        out.append({
            "REF_SECTOR": sector, "TIME_PERIOD": time_period,
            "ACCOUNTING_ENTRY": entry, "STO": parent,
            "signe": 1, "formule": "Ventilation en sous-catégorie", "id_formule": fid,
        })
        for c in kids:
            out.append({
                "REF_SECTOR": sector, "TIME_PERIOD": time_period,
                "ACCOUNTING_ENTRY": entry, "STO": c["STO"],
                "signe": -1, "formule": "Ventilation en sous-catégorie", "id_formule": fid,
            })
    return out


def build_ebe(df):
    # B1GQ = B2G + B3G + D1_D + D2_D + D3_D  (signe : B1GQ=+1, tout le reste -1)
    # La cible était historiquement B1G (valeur ajoutée), mais D2/D3 tels
    # qu'enregistrés ici incluent les impôts/subventions sur les PRODUITS
    # (D21/D31, rattachés au niveau de l'économie totale, pas par secteur) :
    # la somme reconstitue en réalité B1GQ (le PIB, B1G + D21X31 — voir
    # build_b1gq), pas B1G. B1GQ n'existe que pour S1 (PIB = concept
    # d'économie totale) : cette identité ne sera donc validée que pour S1.
    # On ne retient un secteur que si les 6 postes sont présents et que la
    # somme reconstitue B1GQ (tolérance < 1, comme build_ss_secteur/build_ss_ventil).
    sto_set = {"B1GQ", "B2G", "B3G", "D1", "D2", "D3"}
    rows = [r for r in df if r["STO"] in sto_set and r["ACCOUNTING_ENTRY"] in ("B", "D")]
    by_sector = {}
    for r in rows:
        by_sector.setdefault(r["REF_SECTOR"], {})[r["STO"]] = r

    get_id = new_id_sequence()
    out = []
    for sector, by_sto in by_sector.items():
        if sto_set - by_sto.keys():
            continue
        values = {sto: by_sto[sto]["OBS_VALUE"] for sto in sto_set}
        if any(v is None for v in values.values()):
            continue
        total = values["B2G"] + values["B3G"] + values["D1"] + values["D2"] + values["D3"]
        if abs(total - values["B1GQ"]) >= 1:
            continue
        fid = get_id(sector)
        for r in by_sto.values():
            out.append({
                "REF_SECTOR": r["REF_SECTOR"], "TIME_PERIOD": r["TIME_PERIOD"],
                "ACCOUNTING_ENTRY": r["ACCOUNTING_ENTRY"], "STO": r["STO"],
                "signe": 1 if r["STO"] == "B1GQ" else -1,
                "formule": "Lien PIB/excédent brut d'exploitation",
                "id_formule": fid,
            })
    return out


def build_b1gq(df):
    # B1GQ = B1G + D21X31  (PIB = valeur ajoutée + impôts nets des
    # subventions sur les produits). D21X31 n'est enregistré que pour S1
    # (concept d'économie totale) : cette identité n'est donc validée que
    # pour S1, comme build_ebe désormais rattaché à B1GQ.
    sto_set = {"B1GQ", "B1G", "D21X31"}
    rows = [r for r in df if r["STO"] in sto_set]
    by_sector = {}
    for r in rows:
        by_sector.setdefault(r["REF_SECTOR"], {})[r["STO"]] = r

    get_id = new_id_sequence()
    out = []
    for sector, by_sto in by_sector.items():
        if sto_set - by_sto.keys():
            continue
        values = {sto: by_sto[sto]["OBS_VALUE"] for sto in sto_set}
        if any(v is None for v in values.values()):
            continue
        if abs((values["B1G"] + values["D21X31"]) - values["B1GQ"]) >= 1:
            continue
        fid = get_id(sector)
        for r in by_sto.values():
            out.append({
                "REF_SECTOR": r["REF_SECTOR"], "TIME_PERIOD": r["TIME_PERIOD"],
                "ACCOUNTING_ENTRY": r["ACCOUNTING_ENTRY"], "STO": r["STO"],
                "signe": 1 if r["STO"] == "B1GQ" else -1,
                "formule": "Lien PIB/valeur ajoutée",
                "id_formule": fid,
            })
    return out


def build_signe_target_or_D(df, sto_set, target_sto, label, extra_filter=None):
    # motif commun à B5G, B6G, B8G, B9 : signe = +1 si STO==target OU entry=='D', sinon -1
    rows = [r for r in df if r["STO"] in sto_set]
    if extra_filter:
        rows = [r for r in rows if extra_filter(r)]
    get_id = new_id_sequence()
    return [{
        "REF_SECTOR": r["REF_SECTOR"], "TIME_PERIOD": r["TIME_PERIOD"],
        "ACCOUNTING_ENTRY": r["ACCOUNTING_ENTRY"], "STO": r["STO"],
        "signe": 1 if (r["STO"] == target_sto or r["ACCOUNTING_ENTRY"] == "D") else -1,
        "formule": label,
        "id_formule": get_id(r["REF_SECTOR"]),
    } for r in rows]


def build_b5g(df):
    rows = [
        r for r in df
        if r["STO"] in {"B5G", "B2G", "B3G", "D4"}
        or (r["STO"] in {"D1", "D2", "D3"} and r["ACCOUNTING_ENTRY"] == "C")
    ]
    get_id = new_id_sequence()
    return [{
        "REF_SECTOR": r["REF_SECTOR"], "TIME_PERIOD": r["TIME_PERIOD"],
        "ACCOUNTING_ENTRY": r["ACCOUNTING_ENTRY"], "STO": r["STO"],
        "signe": 1 if (r["STO"] == "B5G" or r["ACCOUNTING_ENTRY"] == "D") else -1,
        "formule": "Lien solde des revenus primaires/excédent brut d'exploitation",
        "id_formule": get_id(r["REF_SECTOR"]),
    } for r in rows]


def main():
    df = load_df()

    ss_secteur = build_ss_secteur(df)
    ss_ventil = build_ss_ventil(df)
    b1gq = build_b1gq(df)
    b2g = build_ebe(df)
    b5g = build_b5g(df)
    b6g = build_signe_target_or_D(df, {"B6G", "B5G", "D6", "D7"}, "B6G", "Lien revenu disponible/solde revenus primaires")
    b8g = build_signe_target_or_D(df, {"B8G", "B6G", "P3", "D8"}, "B8G", "Lien solde revenus primaires/épargne")
    b9g = build_signe_target_or_D(df, {"B9", "B8G", "P5", "D9R", "D9P", "NP"}, "B9", "Lien épargne/capacité ou besoin de financement")

    all_rows = b9g + b8g + b6g + b5g + b2g + b1gq + ss_ventil + ss_secteur

    # Même convention de guillemets que write.csv() en R : les colonnes
    # texte sont entre guillemets, les colonnes numériques ne le sont pas.
    with open(OUT, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f, quoting=csv.QUOTE_NONNUMERIC)
        writer.writerow(["REF_SECTOR", "TIME_PERIOD", "ACCOUNTING_ENTRY", "STO", "signe", "formule", "id_formule"])
        for r in all_rows:
            writer.writerow([
                r["REF_SECTOR"], int(r["TIME_PERIOD"]), r["ACCOUNTING_ENTRY"], r["STO"],
                int(r["signe"]), r["formule"], int(r["id_formule"]),
            ])
    print(f"OK — {OUT} régénéré : {len(all_rows)} lignes.")


if __name__ == "__main__":
    main()
