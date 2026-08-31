library(dplyr)

liste_ref_sector = c("S1", "S11", "S12", "S13", "S14", "S15")
liste_exclus = c("B2A3N", "B4G", "D21X31")
# sous-secteurs des administrations publiques (S13) : le TEE les détaille
# déjà (pas besoin d'une autre source), mais ils sont tenus à l'écart de
# liste_ref_sector pour que seul le bloc ss_secteur ci-dessous (décomposition
# en sous-secteur) les voie — pas les autres blocs plus bas ("Lien ..."),
# pour rester une intégration "uniquement décomposition".
sous_secteurs_s13 = c("S1311", "S13111", "S13112", "S1312", "S1313", "S1314")

df = read.csv("data/DD_CNA_TEE_data.csv", sep = ";") %>%
    filter(TIME_PERIOD == 2024 & UNIT_MEASURE == "XDC" & REF_SECTOR %in% liste_ref_sector &
    COUNTERPART_AREA == "W0" & CONSOLIDATION == "N" & INSTR_ASSET == "_Z") %>%
    select(REF_SECTOR, TIME_PERIOD, OBS_VALUE, ACCOUNTING_ENTRY, STO, COUNTERPART_SECTOR) %>% distinct()

df_secteurs = read.csv("data/DD_CNA_TEE_data.csv", sep = ";") %>%
    filter(TIME_PERIOD == 2024 & UNIT_MEASURE == "XDC" & REF_SECTOR %in% c(liste_ref_sector, sous_secteurs_s13) &
    COUNTERPART_AREA == "W0" & CONSOLIDATION == "N" & INSTR_ASSET == "_Z") %>%
    select(REF_SECTOR, TIME_PERIOD, OBS_VALUE, ACCOUNTING_ENTRY, STO, COUNTERPART_SECTOR) %>% distinct()

# décomposition en sous-secteur, à n'importe quel niveau d'emboîtement de la
# nomenclature REF_SECTOR (ex. S1 = S11+S12+...+S15, et séparément
# S13 = S1311+S1313+S1314 — S1312 n'a pas de valeur propre en France, pas
# d'échelon "État fédéré") : le parent d'un secteur est le plus long préfixe
# RÉELLEMENT OBSERVÉ dans les données (trouve_parent_secteur), pas
# simplement son code privé de son dernier caractère : la nomenclature des
# sous-secteurs des administrations publiques saute des niveaux dans les
# codes réellement publiés ("S1311" existe, "S131" non).
trouve_parent_secteur = function(secteur, secteurs_observes) {
  candidats = secteurs_observes[secteurs_observes != secteur & startsWith(secteur, secteurs_observes)]
  if (length(candidats) == 0) return(NA_character_)
  candidats[which.max(nchar(candidats))]
}

secteurs_observes = unique(df_secteurs$REF_SECTOR)

parent_lookup_secteur = df_secteurs %>%
  select(ACCOUNTING_ENTRY, TIME_PERIOD, STO, REF_SECTOR, OBS_VALUE) %>%
  rename(parent = REF_SECTOR, parent_value = OBS_VALUE)

kids_secteur = df_secteurs %>%
  mutate(parent = sapply(REF_SECTOR, trouve_parent_secteur, secteurs_observes = secteurs_observes)) %>%
  filter(!is.na(parent)) %>%
  inner_join(parent_lookup_secteur, by = c("ACCOUNTING_ENTRY", "TIME_PERIOD", "STO", "parent"))

somme_ok = kids_secteur %>%
  group_by(ACCOUNTING_ENTRY, STO, TIME_PERIOD, parent, parent_value) %>%
  summarise(sum_OBS_VALUE = sum(OBS_VALUE, na.rm = TRUE), .groups = "drop") %>%
  filter(abs(sum_OBS_VALUE - parent_value) < 1 & !(STO %in% liste_exclus))

kids_valid = kids_secteur %>% semi_join(somme_ok, by = c("ACCOUNTING_ENTRY", "STO", "TIME_PERIOD", "parent")) %>%
  transmute(REF_SECTOR, TIME_PERIOD, ACCOUNTING_ENTRY, STO, signe = -1, parent)

parents_valid = somme_ok %>%
  transmute(REF_SECTOR = parent, TIME_PERIOD, ACCOUNTING_ENTRY, STO, signe = 1, parent)

ss_secteur = bind_rows(parents_valid, kids_valid) %>%
  mutate(formule = "Ventilation en sous-secteur") %>%
  group_by(ACCOUNTING_ENTRY, parent, TIME_PERIOD, STO) %>%
  mutate(id_formule = cur_group_id()) %>% ungroup() %>%
  arrange(id_formule, formule) %>% select(-parent)

# décomposition en sous-catégorie, à n'importe quel niveau d'emboîtement de
# la nomenclature STO (ex. D4 = D41+D42+...+D45, et séparément
# D42 = D421+D422) : le "parent" d'un poste est son propre code privé de son
# dernier caractère (D421 -> D42 -> D4) ; un bloc n'est retenu que si ce
# parent existe bien comme poste observé et que la somme de ses enfants
# directs reconstitue sa valeur (tolérance < 1)
cd = df %>% filter(ACCOUNTING_ENTRY %in% c('C', 'D'))

parent_lookup = cd %>% select(ACCOUNTING_ENTRY, TIME_PERIOD, REF_SECTOR, STO, OBS_VALUE) %>%
   rename(parent = STO, parent_value = OBS_VALUE)

kids = cd %>% filter(nchar(STO) >= 3) %>%
   mutate(parent = substr(STO, 1, nchar(STO) - 1)) %>%
   inner_join(parent_lookup, by = c("ACCOUNTING_ENTRY", "TIME_PERIOD", "REF_SECTOR", "parent"))

somme_ok = kids %>%
   group_by(ACCOUNTING_ENTRY, TIME_PERIOD, REF_SECTOR, parent, parent_value) %>%
   summarise(sum_OBS_VALUE = sum(OBS_VALUE, na.rm = TRUE), .groups = "drop") %>%
   filter(abs(sum_OBS_VALUE - parent_value) < 1)

kids_valid = kids %>% semi_join(somme_ok, by = c("ACCOUNTING_ENTRY", "TIME_PERIOD", "REF_SECTOR", "parent")) %>%
   transmute(REF_SECTOR, TIME_PERIOD, ACCOUNTING_ENTRY, STO, signe = -1, parent)

parents_valid = somme_ok %>%
   transmute(REF_SECTOR, TIME_PERIOD, ACCOUNTING_ENTRY, STO = parent, signe = 1, parent)

ss_ventil = bind_rows(parents_valid, kids_valid) %>%
   mutate(formule = "Ventilation en sous-catégorie") %>%
   group_by(ACCOUNTING_ENTRY, parent, TIME_PERIOD, REF_SECTOR) %>%
   mutate(id_formule = cur_group_id()) %>% ungroup() %>%
   arrange(id_formule, formule) %>% select(-parent)

#B3G + B2G = B1GQ - D1_D -D2_D - D3_D
# La cible était historiquement B1G (valeur ajoutée), mais D2/D3 tels
# qu'enregistrés ici incluent les impôts/subventions sur les PRODUITS
# (D21/D31, rattachés au niveau de l'économie totale, pas par secteur) :
# la somme reconstitue en réalité B1GQ (le PIB, B1G + D21X31 — voir
# b1gq ci-dessous), pas B1G. B1GQ n'existe que pour S1 (PIB = concept
# d'économie totale) : cette identité n'est donc validée que pour S1.
# On ne retient un secteur que si les 6 postes sont présents et que la
# somme reconstitue B1GQ (tolérance < 1).
b2g_raw = df %>%
 filter(STO %in% c("B1GQ", "B2G", "B3G", "D1", "D2", "D3") & ACCOUNTING_ENTRY %in% c('B', 'D'))

b2g_ok = b2g_raw %>%
  filter(STO != "B1GQ") %>%
  group_by(REF_SECTOR) %>%
  summarise(n = n(), somme = sum(OBS_VALUE, na.rm = TRUE), .groups = "drop") %>%
  filter(n == 5) %>%
  inner_join(b2g_raw %>% filter(STO == "B1GQ") %>% select(REF_SECTOR, OBS_VALUE), by = "REF_SECTOR") %>%
  filter(abs(somme - OBS_VALUE) < 1)

b2g = b2g_raw %>%
  semi_join(b2g_ok, by = "REF_SECTOR") %>%
  mutate(signe = if_else(STO == "B1GQ", 1, -1)) %>%
  group_by(REF_SECTOR) %>%
  mutate(formule = "Lien PIB/excédent brut d'exploitation", id_formule = cur_group_id()) %>% ungroup() %>%
  select(-OBS_VALUE)

# B1GQ = B1G + D21X31 (PIB = valeur ajoutée + impôts nets des subventions
# sur les produits). D21X31 n'est enregistré que pour S1 : cette identité
# n'est donc, elle aussi, validée que pour S1.
b1gq_raw = df %>%
  filter(STO %in% c("B1GQ", "B1G", "D21X31"))

b1gq_ok = b1gq_raw %>%
  filter(STO %in% c("B1G", "D21X31")) %>%
  group_by(REF_SECTOR) %>%
  summarise(n = n(), somme = sum(OBS_VALUE, na.rm = TRUE), .groups = "drop") %>%
  filter(n == 2) %>%
  inner_join(b1gq_raw %>% filter(STO == "B1GQ") %>% select(REF_SECTOR, OBS_VALUE), by = "REF_SECTOR") %>%
  filter(abs(somme - OBS_VALUE) < 1)

b1gq = b1gq_raw %>%
  semi_join(b1gq_ok, by = "REF_SECTOR") %>%
  mutate(signe = if_else(STO == "B1GQ", 1, -1)) %>%
  group_by(REF_SECTOR) %>%
  mutate(formule = "Lien PIB/valeur ajoutée", id_formule = cur_group_id()) %>% ungroup() %>%
  select(-OBS_VALUE)

# B2A3G = B2G + B3G (excédent brut d'exploitation et revenu mixte brut =
# excédent brut d'exploitation + revenu mixte brut). B3G (revenu mixte,
# propre aux entreprises individuelles) n'existe que pour S1 et S14
# (ménages) : ailleurs B2A3G == B2G directement (pas de composante mixte),
# donc cette identité n'est validée que là où B3G existe réellement comme
# poste distinct (tolérance < 1, comme les blocs précédents).
b2a3g_raw = df %>%
  filter(STO %in% c("B2A3G", "B2G", "B3G"))

b2a3g_ok = b2a3g_raw %>%
  filter(STO %in% c("B2G", "B3G")) %>%
  group_by(REF_SECTOR) %>%
  summarise(n = n(), somme = sum(OBS_VALUE, na.rm = TRUE), .groups = "drop") %>%
  filter(n == 2) %>%
  inner_join(b2a3g_raw %>% filter(STO == "B2A3G") %>% select(REF_SECTOR, OBS_VALUE), by = "REF_SECTOR") %>%
  filter(abs(somme - OBS_VALUE) < 1)

b2a3g = b2a3g_raw %>%
  semi_join(b2a3g_ok, by = "REF_SECTOR") %>%
  mutate(signe = if_else(STO == "B2A3G", 1, -1)) %>%
  group_by(REF_SECTOR) %>%
  mutate(formule = "Lien excédent brut d'exploitation et revenu mixte brut/excédent brut d'exploitation", id_formule = cur_group_id()) %>% ungroup() %>%
  select(-OBS_VALUE)

#B5G = B2G + B3G - D4_D + D4_C + D1_C + D2_C + D3_C

b5g = df %>%
 filter(STO %in% c("B5G", "B2G", "B3G", "D4") | (STO %in% c("D1", "D2", "D3") & ACCOUNTING_ENTRY == 'C'))  %>%
   mutate(signe = if_else(STO == "B5G" |  ACCOUNTING_ENTRY == 'D', 1, -1)) %>%
   group_by(REF_SECTOR) %>% 
  # summarise(ok = sum(signe * OBS_VALUE))
  mutate(formule = "Lien solde des revenus primaires/excédent brut d'exploitation", id_formule = cur_group_id()) %>% ungroup() %>%
   select(-OBS_VALUE)

#B6G = B5G - D6_D -D7_D + D6_C + D7_D

b6g = df %>%
 filter(STO %in% c("B6G", "B5G", "D6", "D7"))  %>%
   mutate(signe = if_else(STO == "B6G" |  ACCOUNTING_ENTRY == 'D', 1, -1)) %>%
   group_by(REF_SECTOR) %>% 
   #summarise(ok = sum(signe * OBS_VALUE))
  mutate(formule = "Lien revenu disponible/solde revenus primaires", id_formule = cur_group_id()) %>% ungroup() %>%
   select(-OBS_VALUE)

 #  B8G = B6G - P3 -D8_D + D8_C

b8g = df %>%
 filter(STO %in% c("B8G", "B6G", "P3", "D8"))  %>%
   mutate(signe = if_else(STO == "B8G" |  ACCOUNTING_ENTRY == 'D', 1, -1)) %>%
   group_by(REF_SECTOR) %>% 
  # summarise(ok = sum(signe * OBS_VALUE))
  mutate(formule = "Lien solde revenus primaires/épargne", id_formule = cur_group_id()) %>% ungroup() %>%
   select(-OBS_VALUE)   

 #  B9 = B8G - P5 - D9_D + D9_C -NP

 b9g = df %>% 
   filter(STO %in% c("B9", "B8G", "P5", "D9R", "D9P", "NP"))  %>%
   mutate(signe = if_else(STO == "B9" |  ACCOUNTING_ENTRY == 'D', 1, -1)) %>%
   group_by(REF_SECTOR) %>% 
   #summarise(ok = sum(signe * OBS_VALUE))
   mutate(formule = "Lien épargne/capacité ou besoin de financement", id_formule = cur_group_id()) %>% ungroup() %>%
   select(-OBS_VALUE)     

rbind(b9g, b8g, b6g, b5g, b2a3g, b2g, b1gq, ss_ventil, ss_secteur) %>%
   select(REF_SECTOR, TIME_PERIOD, ACCOUNTING_ENTRY, STO, signe, formule, id_formule) %>%
   write.csv("data/formules_TEE.csv", row.names = FALSE)


