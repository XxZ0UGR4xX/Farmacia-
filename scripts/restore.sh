#!/usr/bin/env bash
# =============================================================================
# Restaura un respaldo creado por scripts/backup.sh. ¡REEMPLAZA los datos actuales!
#
# Uso:
#   ./scripts/restore.sh --docker backups/farmacia_AAAAMMDD_HHMMSS.dump
#   ./scripts/restore.sh backups/farmacia_AAAAMMDD_HHMMSS.dump          # instalación local
#   Agrega --yes para no pedir confirmación (sólo en pruebas automatizadas).
#
# Si junto al .dump existe el archivo ..._imagenes.tar.gz, también restaura las imágenes.
# Con --docker detiene la API mientras restaura y la vuelve a iniciar al terminar.
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

DOCKER=false
YES=false
FILE=""
for arg in "$@"; do
  case "$arg" in
    --docker) DOCKER=true ;;
    --yes) YES=true ;;
    *) FILE="$arg" ;;
  esac
done
[[ -n "$FILE" && -f "$FILE" ]] || { echo "Indica el archivo .dump a restaurar" >&2; exit 1; }
IMAGES="${FILE%.dump}_imagenes.tar.gz"

compose() {
  local args=(-f "$ROOT_DIR/docker-compose.yml")
  [[ -f "$ENV_FILE" ]] && args+=(--env-file "$ENV_FILE")
  docker compose "${args[@]}" "$@"
}

echo "Se reemplazarán TODOS los datos actuales por los del respaldo:"
echo "  $FILE"
[[ -f "$IMAGES" ]] && echo "  $IMAGES"
if ! $YES; then
  read -r -p 'Escribe RESTAURAR para continuar: ' answer
  [[ "$answer" == "RESTAURAR" ]] || { echo "Cancelado."; exit 1; }
fi

if $DOCKER; then
  # Antes de tocar nada se comprueba que el archivo sea un respaldo válido
  compose exec -T db pg_restore --list <"$FILE" >/dev/null
  compose stop api
  trap 'compose start api >/dev/null' EXIT
  # Las variables se expanden dentro del contenedor (comillas simples a propósito)
  # shellcheck disable=SC2016
  compose exec -T db sh -c 'dropdb -U "$POSTGRES_USER" --if-exists --force "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
  # shellcheck disable=SC2016
  compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error' <"$FILE"
  if [[ -f "$IMAGES" ]]; then
    # La API está detenida: las imágenes se copian con un contenedor temporal sobre el mismo volumen
    # (se quita la carpeta superior del archivo: sirve aunque el respaldo venga de otra instalación)
    compose run --rm --no-deps -T --entrypoint sh api -c 'rm -rf /app/apps/api/uploads/* && tar -C /app/apps/api/uploads --strip-components=1 -xzf -' <"$IMAGES"
  fi
else
  : "${DATABASE_URL:?DATABASE_URL no está definida}"
  pg_restore --list "$FILE" >/dev/null
  pg_restore --clean --if-exists --no-owner --exit-on-error -d "${DATABASE_URL%%\?*}" "$FILE"
  if [[ -f "$IMAGES" ]]; then
    UPLOADS="${UPLOAD_DIR:-uploads}"
    [[ "$UPLOADS" = /* ]] || UPLOADS="$ROOT_DIR/apps/api/$UPLOADS"
    mkdir -p "$UPLOADS"
    rm -rf "${UPLOADS:?}"/*
    tar -C "$UPLOADS" --strip-components=1 -xzf "$IMAGES"
  fi
fi
echo "[$(date -Iseconds)] Restauración terminada."
