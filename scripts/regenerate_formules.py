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
    by_sector = [r for r in df if r["REF_SECTOR"] != "S1"]
    sums = {}
    for r in by_sector:
        k = (r["ACCOUNTING_ENTRY"], r["STO"])
        sums[k] = sums.get(k, 0.0) + (r["OBS_VALUE"] or 0.0)

    s1_rows = {(r["ACCOUNTING_ENTRY"], r["STO"]): r for r in df if r["REF_SECTOR"] == "S1"}

    valid_keys = set()
    for k, total in sums.items():
        s1 = s1_rows.get(k)
        if s1 is None or s1["OBS_VALUE"] is None:
            continue
        if abs(total - s1["OBS_VALUE"]) < 1 and s1["STO"] not in LISTE_EXCLUS:
            valid_keys.add(k)

    get_id = new_id_sequence()
    out = []
    for r in df:
        k = (r["ACCOUNTING_ENTRY"], r["STO"])
        if k not in valid_keys:
            continue
        out.append({
            "REF_SECTOR": r["REF_SECTOR"], "TIME_PERIOD": r["TIME_PERIOD"],
            "ACCOUNTING_ENTRY": r["ACCOUNTING_ENTRY"], "STO": r["STO"],
            "signe": 1 if r["REF_SECTOR"] == "S1" else -1,
            "formule": "Ventilation en sous-secteur",
            "id_formule": get_id(k),
        })
    return out


def build_ss_ventil(df):
    cd = [r for r in df if r["ACCOUNTING_ENTRY"] in ("C", "D")]
    children = [r for r in cd if len(r["STO"]) == 3]
    parents = {
        (r["ACCOUNTING_ENTRY"], r["TIME_PERIOD"], r["REF_SECTOR"], r["STO"]): r
        for r in cd if len(r["STO"]) == 2
    }

    sums = {}
    for r in children:
        parent = r["STO"][:2]
        k = (r["ACCOUNTING_ENTRY"], r["TIME_PERIOD"], r["REF_SECTOR"], parent)
        sums[k] = sums.get(k, 0.0) + (r["OBS_VALUE"] or 0.0)

    valid_keys = set()
    for k, total in sums.items():
        p = parents.get(k)
        if p is None or p["OBS_VALUE"] is None:
            continue
        if abs(total - p["OBS_VALUE"]) < 1:
            valid_keys.add((k[0], k[2], k[3]))  # (entry, sector, parent) — sans TIME_PERIOD, comme le semi_join R

    get_id = new_id_sequence()
    out = []
    for r in cd:
        if len(r["STO"]) > 3:
            continue
        parent = r["STO"][:2]
        vk = (r["ACCOUNTING_ENTRY"], r["REF_SECTOR"], parent)
        if vk not in valid_keys:
            continue
        out.append({
            "REF_SECTOR": r["REF_SECTOR"], "TIME_PERIOD": r["TIME_PERIOD"],
            "ACCOUNTING_ENTRY": r["ACCOUNTING_ENTRY"], "STO": r["STO"],
            "signe": 1 if len(r["STO"]) == 2 else -1,
            "formule": "Ventilation en sous-catégorie",
            "id_formule": get_id((r["ACCOUNTING_ENTRY"], parent, r["TIME_PERIOD"], r["REF_SECTOR"])),
        })
    return out


def build_ere(df):
    # B1G = B2G + B3G + D1_D + D2_D + D3_D  (signe : B1G=+1, tout le reste -1)
    rows = [r for r in df if r["STO"] in {"B1G", "B2G", "B3G", "D1", "D2", "D3"} and r["ACCOUNTING_ENTRY"] in ("B", "D")]
    get_id = new_id_sequence()
    return [{
        "REF_SECTOR": r["REF_SECTOR"], "TIME_PERIOD": r["TIME_PERIOD"],
        "ACCOUNTING_ENTRY": r["ACCOUNTING_ENTRY"], "STO": r["STO"],
        "signe": 1 if r["STO"] == "B1G" else -1,
        "formule": "Définition ERE",
        "id_formule": get_id(r["REF_SECTOR"]),
    } for r in rows]


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
        "formule": "Définition B5G",
        "id_formule": get_id(r["REF_SECTOR"]),
    } for r in rows]


def main():
    df = load_df()

    ss_secteur = build_ss_secteur(df)
    ss_ventil = build_ss_ventil(df)
    b2g = build_ere(df)
    b5g = build_b5g(df)
    b6g = build_signe_target_or_D(df, {"B6G", "B5G", "D6", "D7"}, "B6G", "Définition B6G")
    b8g = build_signe_target_or_D(df, {"B8G", "B6G", "P3", "D8"}, "B8G", "Définition B8G")
    b9g = build_signe_target_or_D(df, {"B9", "B8G", "P5", "D9R", "D9P", "NP"}, "B9", "Lien B9 B8")

    all_rows = b9g + b8g + b6g + b5g + b2g + ss_ventil + ss_secteur

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
