# Sert le site statique (site/) via nginx. Aucune étape de build : les
# données sont déjà embarquées dans site/data/tee_graph.js (voir
# scripts/prepare_data.py). data/ (sources CSV, R/, scripts/) n'est pas
# nécessaire à l'exécution et n'est pas copié dans l'image.
FROM nginx:1.27-alpine
COPY site/ /usr/share/nginx/html/
EXPOSE 80
