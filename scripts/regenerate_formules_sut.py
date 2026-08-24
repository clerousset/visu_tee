"""
Génère data/formules_SUT.csv : identités comptables de ventilation par
activité (branche) du Tableau des ressources et emplois (SUT), sur le même
principe de validation numérique que scripts/regenerate_formules.py pour le
TEE (somme des composantes ≈ valeur du total, tolérance < 1).

À relancer si data/DD_CNA_SUT_data.csv change.
"""
import csv
import itertools

from prepare_data import load_sut

# sections NACE Rev.2 (A à U) : le niveau le plus agrégé de la nomenclature
# d'activité, hors code "_T" (total) lui-même
LETTERS_NACE = set("ABCDEFGHIJKLMNOPQRSTU")

OUT = "data/formules_SUT.csv"


def new_id_sequence():
    mapping = {}
    counter = itertools.count(1)

    def get(key):
        if key not in mapping:
            mapping[key] = next(counter)
        return mapping[key]
    return get


def build_ss_activite(rows):
    # pour un même (secteur, position, poste, produit, année), le total
    # (ACTIVITY == "_T") doit être reconstitué par la somme des sections
    # NACE Rev.2 (A à U) présentes. Cette identité n'est validée en pratique
    # que pour l'économie totale (S1) et le produit agrégé (_T), sur les
    # postes qui se décomposent naturellement par activité (production,
    # valeur ajoutée, rémunération des salariés, FBCF, ...) : les autres
    # combinaisons ne passent pas la validation numérique et sont ignorées.
    by_key = {}
    for r in rows:
        k = (r["REF_SECTOR"], r["ACCOUNTING_ENTRY"], r["STO"], r["PRODUCT"], r["TIME_PERIOD"])
        by_key.setdefault(k, {})[r["ACTIVITY"]] = r["OBS_VALUE"]

    get_id = new_id_sequence()
    out = []
    for k, by_activity in by_key.items():
        total = by_activity.get("_T")
        if total is None:
            continue
        children = {a: v for a, v in by_activity.items() if a in LETTERS_NACE}
        if not children:
            continue
        if abs(sum(children.values()) - total) >= 1:
            continue
        sector, entry, sto, product, year = k
        fid = get_id(k)
        out.append({
            "REF_SECTOR": sector, "TIME_PERIOD": year, "ACCOUNTING_ENTRY": entry,
            "STO": sto, "PRODUCT": product, "ACTIVITY": "_T",
            "signe": 1, "formule": "Ventilation en activité", "id_formule": fid,
        })
        for activity in sorted(children):
            out.append({
                "REF_SECTOR": sector, "TIME_PERIOD": year, "ACCOUNTING_ENTRY": entry,
                "STO": sto, "PRODUCT": product, "ACTIVITY": activity,
                "signe": -1, "formule": "Ventilation en activité", "id_formule": fid,
            })
    return out


def main():
    rows = load_sut()
    formula_rows = build_ss_activite(rows)

    with open(OUT, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f, quoting=csv.QUOTE_NONNUMERIC)
        writer.writerow(["REF_SECTOR", "TIME_PERIOD", "ACCOUNTING_ENTRY", "STO", "PRODUCT", "ACTIVITY", "signe", "formule", "id_formule"])
        for r in formula_rows:
            writer.writerow([
                r["REF_SECTOR"], int(r["TIME_PERIOD"]), r["ACCOUNTING_ENTRY"], r["STO"], r["PRODUCT"], r["ACTIVITY"],
                int(r["signe"]), r["formule"], int(r["id_formule"]),
            ])

    n_blocks = len(set(r["id_formule"] for r in formula_rows))
    print(f"OK — {OUT} régénéré : {len(formula_rows)} lignes, {n_blocks} identités.")


if __name__ == "__main__":
    main()
