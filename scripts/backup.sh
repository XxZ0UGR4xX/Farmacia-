#!/usr/bin/env bash
# =============================================================================
# Respaldo de la base de datos (pg_dump en formato custom, comprimido).
#
# Uso:
#   ./scripts/backup.sh                 # usa DATABASE_URL del .env (instalación local)
#   ./scripts/backup.sh --docker        # respalda el contenedor "db" de docker compose
#
# Programar diario (cron, 2:30 am):
#   30 2 * * * cd /ruta/farmacia && ./scripts/backup.sh --docker >> backups/backup.log 2>&1
#
# Restaurar (¡reemplaza los datos actuales!):
#   pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" backups/farmacia_AAAAMMDD_HHMMSS.dump
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
fi

BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
FILE="$BACKUP_DIR/farmacia_${TIMESTAMP}.dump"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR" # Los respaldos contienen datos sensibles

if [[ "${1:-}" == "--docker" ]]; then
  docker compose -f "$ROOT_DIR/docker-compose.yml" exec -T db \
    pg_dump -U "${POSTGRES_USER:-farmacia}" -d "${POSTGRES_DB:-farmacia}" -Fc >"$FILE"
else
  : "${DATABASE_URL:?DATABASE_URL no está definida}"
  # pg_dump no entiende el parámetro ?schema= de Prisma
  pg_dump "${DATABASE_URL%%\?*}" -Fc >"$FILE"
fi

chmod 600 "$FILE"
# Verificar que el respaldo sea legible
pg_restore --list "$FILE" >/dev/null
echo "[$(date -Iseconds)] Respaldo creado: $FILE ($(du -h "$FILE" | cut -f1))"

# Rotación: eliminar respaldos más antiguos que RETENTION_DAYS
find "$BACKUP_DIR" -name 'farmacia_*.dump' -type f -mtime "+$RETENTION_DAYS" -print -delete |
  sed 's/^/Respaldo antiguo eliminado: /'
