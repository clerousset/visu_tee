library(dplyr)

liste_ref_sector = c("S1", "S11", "S12", "S13", "S14", "S15")
liste_exclus = c("B2A3N", "B4G", "D21X31")
df = read.csv("data/DD_CNA_TEE_data.csv", sep = ";") %>% 
    filter(TIME_PERIOD == 2024 & UNIT_MEASURE == "XDC" & REF_SECTOR %in% liste_ref_sector &
    COUNTERPART_AREA == "W0" & CONSOLIDATION == "N" & INSTR_ASSET == "_Z") %>%
    select(REF_SECTOR, TIME_PERIOD, OBS_VALUE, ACCOUNTING_ENTRY, STO, COUNTERPART_SECTOR) %>% distinct()

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

#B3G + B2G = B1G - D1_D -D2_D - D3_D

b2g = df %>%
 filter(STO %in% c("B1G", "B2G", "B3G", "D1", "D2", "D3") & ACCOUNTING_ENTRY %in% c('B', 'D')) %>%
   mutate(signe = if_else(STO == "B1G", 1, -1)) %>%
   group_by(REF_SECTOR) %>% 
   #summarise(ok = sum(signe * OBS_VALUE))
  mutate(formule = "Définition ERE", id_formule = cur_group_id()) %>% ungroup() %>%
   select(-OBS_VALUE)

#B5G = B2G + B3G - D4_D + D4_C + D1_C + D2_C + D3_C

b5g = df %>%
 filter(STO %in% c("B5G", "B2G", "B3G", "D4") | (STO %in% c("D1", "D2", "D3") & ACCOUNTING_ENTRY == 'C'))  %>%
   mutate(signe = if_else(STO == "B5G" |  ACCOUNTING_ENTRY == 'D', 1, -1)) %>%
   group_by(REF_SECTOR) %>% 
  # summarise(ok = sum(signe * OBS_VALUE))
  mutate(formule = "Définition B5G", id_formule = cur_group_id()) %>% ungroup() %>%
   select(-OBS_VALUE)

#B6G = B5G - D6_D -D7_D + D6_C + D7_D

b6g = df %>%
 filter(STO %in% c("B6G", "B5G", "D6", "D7"))  %>%
   mutate(signe = if_else(STO == "B6G" |  ACCOUNTING_ENTRY == 'D', 1, -1)) %>%
   group_by(REF_SECTOR) %>% 
   #summarise(ok = sum(signe * OBS_VALUE))
  mutate(formule = "Définition B6G", id_formule = cur_group_id()) %>% ungroup() %>%
   select(-OBS_VALUE)

 #  B8G = B6G - P3 -D8_D + D8_C

b8g = df %>%
 filter(STO %in% c("B8G", "B6G", "P3", "D8"))  %>%
   mutate(signe = if_else(STO == "B8G" |  ACCOUNTING_ENTRY == 'D', 1, -1)) %>%
   group_by(REF_SECTOR) %>% 
  # summarise(ok = sum(signe * OBS_VALUE))
  mutate(formule = "Définition B8G", id_formule = cur_group_id()) %>% ungroup() %>%
   select(-OBS_VALUE)   

 #  B9 = B8G - P5 - D9_D + D9_C -NP

 b9g = df %>% 
   filter(STO %in% c("B9", "B8G", "P5", "D9R", "D9P", "NP"))  %>%
   mutate(signe = if_else(STO == "B9" |  ACCOUNTING_ENTRY == 'D', 1, -1)) %>%
   group_by(REF_SECTOR) %>% 
   #summarise(ok = sum(signe * OBS_VALUE))
   mutate(formule = "Lien B9 B8", id_formule = cur_group_id()) %>% ungroup() %>%
   select(-OBS_VALUE)     

rbind(b9g, b8g, b6g, b5g, b2g, ss_ventil, ss_secteur) %>%
   select(REF_SECTOR, TIME_PERIOD, ACCOUNTING_ENTRY, STO, signe, formule, id_formule) %>%
   write.csv("data/formules_TEE.csv", row.names = FALSE)


