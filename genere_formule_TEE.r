library(dplyr)

liste_ref_sector = c("S1", "S11", "S12", "S13", "S14", "S15")
liste_exclus = c("B2A3N", "B4G", "D21X31")
df = read.csv("DD_CNA_TEE_data.csv", sep = ";") %>% 
    filter(TIME_PERIOD == 2024 & UNIT_MEASURE == "XDC" & REF_SECTOR %in% liste_ref_sector &
    COUNTERPART_AREA == "W0" & CONSOLIDATION == "N" & INSTR_ASSET == "_Z") %>%
    select(REF_SECTOR, TIME_PERIOD, OBS_VALUE, ACCOUNTING_ENTRY, STO, COUNTERPART_SECTOR) %>% distinct()


df %>% filter(STO == "D2")

somme_ok = df %>% filter(REF_SECTOR != "S1") %>% 
    group_by(ACCOUNTING_ENTRY, STO) %>% summarise(sum_OBS_VALUE = sum(OBS_VALUE, na.rm = TRUE), .groups = "drop") %>%
    left_join(df %>% filter(REF_SECTOR == "S1"), by = c("ACCOUNTING_ENTRY", "STO")) %>% 
    filter(abs(sum_OBS_VALUE - OBS_VALUE) < 1 & !(STO %in% liste_exclus))

 ss_secteur = df %>% semi_join(somme_ok, by = c("ACCOUNTING_ENTRY", "STO")) %>%
    select(-OBS_VALUE) %>%
   mutate(signe = if_else(REF_SECTOR == "S1", 1, -1),
        formule = "Ventilation en sous-secteur") %>%
   group_by(ACCOUNTING_ENTRY, STO, TIME_PERIOD) %>%
   mutate(id_formule = cur_group_id()) %>% ungroup() %>%
   arrange(id_formule, formule)

somme_ok = df %>% filter(ACCOUNTING_ENTRY %in% c('C', 'D')) %>%
   mutate(taille = nchar(STO)) %>% filter(taille == 3) %>%
   mutate(parent = substring(STO, 1, 2)) %>%
   group_by(ACCOUNTING_ENTRY, TIME_PERIOD, REF_SECTOR, parent) %>%
   summarise(sum_OBS_VALUE = sum(OBS_VALUE, na.rm = TRUE), .groups = "drop") %>%
   left_join(df %>% filter(ACCOUNTING_ENTRY %in% c('C', 'D'))  %>%
    mutate(taille = nchar(STO)) %>% filter(taille == 2) %>% rename(parent = STO),
     by = c("ACCOUNTING_ENTRY", "TIME_PERIOD", "REF_SECTOR", "parent")) %>% 
    filter(abs(sum_OBS_VALUE - OBS_VALUE) < 1)

ss_ventil = df %>% filter(ACCOUNTING_ENTRY %in% c('C', 'D')) %>%
   mutate(taille = nchar(STO)) %>% filter(taille <= 3) %>% 
   mutate(parent = substr(STO, 1, 2)) %>% 
   semi_join(somme_ok, by = c("ACCOUNTING_ENTRY", "REF_SECTOR", "parent")) %>%
    select(-OBS_VALUE) %>% 
   mutate(signe = if_else(nchar(STO) == 2, 1, -1),
        formule = "Ventilation en sous-catégorie") %>%
   group_by(ACCOUNTING_ENTRY, parent, TIME_PERIOD, REF_SECTOR) %>%
   mutate(id_formule = cur_group_id()) %>% ungroup() %>%
   arrange(id_formule, formule) %>% select(-taille, -parent)

B3G + B2G = B1G - D1_D -D2_D - D3_D

b2g = df %>%
 filter(STO %in% c("B1G", "B2G", "B3G", "D1", "D2", "D3") & ACCOUNTING_ENTRY %in% c('B', 'D')) %>%
   mutate(signe = if_else(STO == "B1G", 1, -1)) %>%
   group_by(REF_SECTOR) %>% 
   #summarise(ok = sum(signe * OBS_VALUE))
  mutate(formule = "Définition ERE", id_formule = cur_group_id()) %>% ungroup() %>%
   select(-OBS_VALUE)