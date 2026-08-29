"""
Génère data/formules_SUT.csv : identités comptables du Tableau des
ressources et emplois (SUT), sur le même principe de validation numérique
que scripts/regenerate_formules.py pour le TEE (somme des composantes ≈
valeur du total, tolérance < 1). Deux familles d'identités :
- ventilation par activité (branche) : build_ss_activite ;
- identités générales au niveau agrégé (économie totale S1..S15, produit
  _T) transcrites de R/etude.r : build_lien_sut / LIEN_SUT_FORMULAS.

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


def build_lien_sut(rows, label, target, members):
    # identité comptable générale (hors ventilation par activité) : la
    # cible (entry, sto) doit être égale à la somme signée des membres,
    # au niveau agrégé (ACTIVITY == "_T", PRODUCT == "_T") — même principe
    # de validation numérique que build_ss_activite (tolérance < 1). Chaque
    # membre est fourni avec son signe "affiché" dans l'équation (+1 pour
    # un terme ajouté, -1 pour un terme soustrait) ; la colonne signe
    # stockée est son opposé (cf. convention de signe du README/CLAUDE.md :
    # effectiveSign = -s_cible * s_membre, avec s_cible == 1).
    by_key = {}
    for r in rows:
        if r["ACTIVITY"] != "_T" or r["PRODUCT"] != "_T":
            continue
        k = (r["REF_SECTOR"], r["TIME_PERIOD"])
        by_key.setdefault(k, {})[(r["ACCOUNTING_ENTRY"], r["STO"])] = r["OBS_VALUE"]

    get_id = new_id_sequence()
    out = []
    for k, vals in by_key.items():
        target_val = vals.get(target)
        if target_val is None:
            continue
        member_vals = []
        for (entry, sto, signe_affiche) in members:
            v = vals.get((entry, sto))
            if v is None:
                member_vals = None
                break
            member_vals.append(signe_affiche * v)
        if member_vals is None:
            continue
        if abs(target_val - sum(member_vals)) >= 1:
            continue
        sector, year = k
        fid = get_id(k)
        out.append({
            "REF_SECTOR": sector, "TIME_PERIOD": year, "ACCOUNTING_ENTRY": target[0],
            "STO": target[1], "PRODUCT": "_T", "ACTIVITY": "_T",
            "signe": 1, "formule": label, "id_formule": fid,
        })
        for (entry, sto, signe_affiche) in members:
            out.append({
                "REF_SECTOR": sector, "TIME_PERIOD": year, "ACCOUNTING_ENTRY": entry,
                "STO": sto, "PRODUCT": "_T", "ACTIVITY": "_T",
                "signe": -signe_affiche, "formule": label, "id_formule": fid,
            })
    return out


# identités comptables générales du SUT (économie totale S1..S15, produit
# agrégé _T), transcrites de R/etude.r : (label, cible (entry, sto),
# [(entry, sto, signe affiché dans l'équation), ...])
LIEN_SUT_FORMULAS = [
    ("Lien total des ressources (prix de base)", ("C", "TSBP"),
        [("C", "P1", 1), ("C", "P7", 1)]),
    ("Lien total des emplois (prix d'acquisition/prix de base)", ("C", "TSPP"),
        [("C", "TSBP", 1), ("D", "D21", 1), ("D", "D31", 1)]),
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


def main():
    rows = load_sut()
    formula_rows = build_ss_activite(rows)
    for label, target, members in LIEN_SUT_FORMULAS:
        formula_rows += build_lien_sut(rows, label, target, members)

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
