#!/usr/bin/env bash
# =============================================================================
# Respaldo de la base de datos (pg_dump en formato custom, comprimido) y de las
# imágenes de productos, con verificación y rotación.
#
# Uso:
#   ./scripts/backup.sh                 # instalación local (usa DATABASE_URL del .env)
#   ./scripts/backup.sh --docker        # base dentro de docker compose (no requiere PostgreSQL instalado)
#
# Variables (en .env):
#   BACKUP_DIR=./backups                # carpeta de respaldos
#   BACKUP_RETENTION_DAYS=30            # días que se conservan
#   ENV_FILE=/ruta/.env                 # otro archivo de variables (opcional)
#
# Programar diario:
#   Linux (cron, 2:30 am):
#     30 2 * * * cd /ruta/farmacia && ./scripts/backup.sh --docker >> backups/backup.log 2>&1
#   Windows: ver docs/DESPLIEGUE.md (Programador de tareas con Git Bash)
#
# Restaurar: ./scripts/restore.sh (ver ese archivo)
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

BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
[[ "$BACKUP_DIR" = /* ]] || BACKUP_DIR="$ROOT_DIR/${BACKUP_DIR#./}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
FILE="$BACKUP_DIR/farmacia_${TIMESTAMP}.dump"
DOCKER=false
[[ "${1:-}" == "--docker" ]] && DOCKER=true

compose() {
  local args=(-f "$ROOT_DIR/docker-compose.yml")
  [[ -f "$ENV_FILE" ]] && args+=(--env-file "$ENV_FILE")
  docker compose "${args[@]}" "$@"
}

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR" # Los respaldos contienen datos sensibles
umask 077

if $DOCKER; then
  # Las variables se expanden dentro del contenedor (comillas simples a propósito)
  # shellcheck disable=SC2016
  compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' >"$FILE"
  # Se verifica dentro del contenedor: el equipo no necesita PostgreSQL instalado
  compose exec -T db pg_restore --list <"$FILE" >/dev/null
else
  : "${DATABASE_URL:?DATABASE_URL no está definida}"
  # pg_dump no entiende el parámetro ?schema= de Prisma
  pg_dump "${DATABASE_URL%%\?*}" -Fc >"$FILE"
  pg_restore --list "$FILE" >/dev/null
fi
[[ -s "$FILE" ]] || { echo "El respaldo quedó vacío: $FILE" >&2; exit 1; }
echo "[$(date -Iseconds)] Respaldo creado y verificado: $FILE ($(du -h "$FILE" | cut -f1))"

# Imágenes de productos (si existen)
IMAGES="$BACKUP_DIR/farmacia_${TIMESTAMP}_imagenes.tar.gz"
if $DOCKER; then
  compose exec -T api tar -C /app/apps/api -czf - uploads >"$IMAGES"
else
  UPLOADS="${UPLOAD_DIR:-uploads}"
  [[ "$UPLOADS" = /* ]] || UPLOADS="$ROOT_DIR/apps/api/$UPLOADS"
  if [[ -d "$UPLOADS" ]]; then
    tar -C "$(dirname "$UPLOADS")" -czf "$IMAGES" "$(basename "$UPLOADS")"
  else
    IMAGES=""
  fi
fi
if [[ -n "$IMAGES" ]]; then
  tar -tzf "$IMAGES" >/dev/null
  echo "[$(date -Iseconds)] Imágenes respaldadas: $IMAGES ($(du -h "$IMAGES" | cut -f1))"
fi

# Rotación: eliminar respaldos más antiguos que RETENTION_DAYS
find "$BACKUP_DIR" \( -name 'farmacia_*.dump' -o -name 'farmacia_*_imagenes.tar.gz' \) -type f -mtime "+$RETENTION_DAYS" -print -delete |
  sed 's/^/Respaldo antiguo eliminado: /'
