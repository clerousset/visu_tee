"""
Prépare les données du Tableau Économique d'Ensemble (TEE) / séquence des
comptes par secteur institutionnel pour le site de visualisation.

Lit data/DD_CNA_TEE_data.csv (source SDMX INSEE) et data/DD_CNA_TEE_metadata.csv,
filtre sur les mêmes critères que R/genere_formule_TEE.r (unité en euros courants,
zone France, non consolidé, hors instrument financier détaillé), puis construit
un fichier JS statique (site/data/tee_data.js) embarquant :
  - les 8 soldes de la séquence des comptes par secteur x année
  - le détail des principaux flux (ressources/emplois) par étape
  - les libellés français des secteurs et des opérations

Sortie : site/data/tee_data.js (variable JS TEE_DATA), pour un chargement
sans serveur (ouverture directe du site en local, file://).

Volontairement écrit sans dépendance externe (pas de pandas) : lecture en
streaming avec le module csv standard, pour rester rapide sur de gros fichiers.
"""
import csv
import json
import os
import sys

DATA_DIR = "data"
OUT_PATH = "site/data/tee_data.js"

SECTEURS = ["S1", "S11", "S12", "S13", "S14", "S15"]

SOLDES = {"B1G", "B2G", "B3G", "B2A3G", "B5G", "B6G", "B8G", "B9"}

FLUX_DETAIL = [
    ("D1", "D"), ("D2", "D"), ("D3", "D"),
    ("D1", "C"), ("D2", "C"), ("D3", "C"),
    ("D4", "D"), ("D4", "C"),
    ("D6", "D"), ("D6", "C"),
    ("D7", "D"), ("D7", "C"),
    ("P3", "D"),
    ("D8", "D"), ("D8", "C"),
    ("P5", "D"),
    ("D9P", "D"), ("D9R", "C"),
    ("NP", "D"),
]
FLUX_KEYS = {f"{sto}_{entry}" for sto, entry in FLUX_DETAIL}
NEEDED_STO = SOLDES | {sto for sto, _ in FLUX_DETAIL}

STATUS_PRIORITY = {"D": 0, "SD": 1, "PROV": 2}


def load_metadata():
    labels = {"REF_SECTOR": {}, "STO": {}}
    with open(f"{DATA_DIR}/DD_CNA_TEE_metadata.csv", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter=";", quotechar='"')
        for row in reader:
            var = row["COD_VAR"]
            if var in labels:
                labels[var][row["COD_MOD"]] = row["LIB_MOD"]
    return labels


def load_and_aggregate(src_csv):
    # clé -> (prio_statut, valeur)  ; clé = (REF_SECTOR, ACCOUNTING_ENTRY, STO, TIME_PERIOD)
    best = {}
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
            if sec not in SECTEURS:
                continue
            sto = row["STO"]
            if sto not in NEEDED_STO:
                continue
            val = row["OBS_VALUE"]
            if not val:
                continue
            entry = row["ACCOUNTING_ENTRY"]
            key = (sec, entry, sto, row["TIME_PERIOD"])
            prio = STATUS_PRIORITY.get(row["OBS_STATUS_FR"], 9)
            cur = best.get(key)
            if cur is None or prio < cur[0]:
                best[key] = (prio, round(float(val), 1))
    return best


def build_dataset(best):
    balances = {sec: {} for sec in SECTEURS}
    detail = {sec: {} for sec in SECTEURS}
    for (sec, entry, sto, year), (_, val) in best.items():
        if entry == "B" and sto in SOLDES:
            balances[sec].setdefault(year, {})[sto] = val
        key = f"{sto}_{entry}"
        if key in FLUX_KEYS:
            detail[sec].setdefault(year, {})[key] = val
    return balances, detail


def main():
    src_data = sys.argv[1] if len(sys.argv) > 1 else f"{DATA_DIR}/DD_CNA_TEE_data.csv"
    labels = load_metadata()
    best = load_and_aggregate(src_data)
    balances, detail = build_dataset(best)

    payload = {
        "unit": "Millions d'euros courants",
        "secteurs": SECTEURS,
        "labelsSecteur": {s: labels["REF_SECTOR"].get(s, s) for s in SECTEURS},
        "labelsSto": labels["STO"],
        "balances": balances,
        "detail": detail,
    }

    os.makedirs("site/data", exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        f.write("// Fichier généré par scripts/prepare_data.py — ne pas éditer à la main.\n")
        f.write("const TEE_DATA = ")
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")

    n_years = sum(len(v) for v in balances.values())
    print(f"OK — {OUT_PATH} généré, {n_years} couples secteur/année avec au moins un solde.")


if __name__ == "__main__":
    main()
