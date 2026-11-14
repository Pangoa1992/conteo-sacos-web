#!/usr/bin/env bash
# Carga los datos de prueba (cargar_datos_prueba.sql) en una base de datos de PRUEBA o DEMOSTRACIÓN
# del contenedor local macromec-postgres.
#
#   bash datos-prueba/cargar_datos_prueba.sh conteo_sacos_demo
#
# Se niega si la base no tiene el comentario «SOLO DATOS DE ...» (las de prueba y demo lo tienen;
# la real conteo_sacos no), así nunca toca datos reales. Antes de cargar guarda un volcado de la base
# en datos-prueba/respaldos/ (no se sube a git).
set -euo pipefail
BD="${1:-}"
CONTENEDOR="${CONTENEDOR_PG:-macromec-postgres}"
DIR=$(cd "$(dirname "$0")" && pwd)
[ -n "$BD" ] || { echo "Uso: $0 <base_de_datos_de_prueba>"; exit 2; }
case "$BD" in *[!a-z0-9_]*) echo "Nombre de base no válido: $BD"; exit 2;; esac

comentario=$(docker exec "$CONTENEDOR" psql -U macromec -d postgres -Atc \
  "select coalesce(shobj_description(oid,'pg_database'),'') from pg_database where datname='$BD'")
case "$comentario" in
  "SOLO DATOS DE"*) ;;
  *) echo "La base «$BD» no existe o no está marcada como de prueba/demostración: no se carga nada."; exit 1;;
esac

mkdir -p "$DIR/respaldos"
respaldo="$DIR/respaldos/${BD}_antes_datos_prueba_$(date +%Y%m%d_%H%M%S).sql"
docker exec "$CONTENEDOR" pg_dump -U macromec -d "$BD" --no-owner > "$respaldo"
echo "Respaldo previo: $respaldo"

docker exec -i "$CONTENEDOR" psql -U macromec -d "$BD" -q -P pager=off < "$DIR/cargar_datos_prueba.sql"
echo "Datos de prueba cargados en $BD."
