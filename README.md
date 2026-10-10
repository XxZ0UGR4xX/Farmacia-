# Sistema Integral de Farmacia

Sistema web para administrar una farmacia: inventario por lotes con salida **FEFO**, caducidades,
compras, proveedores, punto de venta, pacientes, recetas, reportes y auditoría completa.

Está pensado para el doctor propietario, que necesita saber de un vistazo cómo está su farmacia.
La arquitectura admite desde el inicio más empleados, roles y **sucursales** sin reconstruir el sistema.

> **Estado:** Fases 1 a 7 de 11 completas (arquitectura, base de datos, autenticación,
> usuarios, roles, permisos, productos, catálogos, lotes, existencias, movimientos, proveedores,
> compras, punto de venta, ventas, devoluciones, caducidades y alertas).
> Ver [docs/FASES.md](docs/FASES.md).

## Tecnología

| Capa | Tecnología |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4, React Router, TanStack Query, React Hook Form + Zod |
| Backend | Node.js 22, Express 5, TypeScript, Zod |
| Base de datos | PostgreSQL 16 + Prisma 7 |
| Seguridad | Argon2id, JWT + refresh tokens rotativos (cookie httpOnly), CSRF, Helmet, rate limiting |
| Pruebas | Vitest, Supertest, Testing Library |
| Infraestructura | Docker, docker compose, nginx, GitHub Actions |

## Estructura

```
apps/api         API REST (Express + Prisma)
apps/web         Frontend (React)
packages/shared  Catálogo de permisos y roles compartido por frontend y backend
docs/            Arquitectura, base de datos y plan de fases
scripts/         Respaldos
```

Documentación técnica:
- [Arquitectura y seguridad](docs/ARQUITECTURA.md)
- [Base de datos y modelo entidad-relación](docs/BASE_DE_DATOS.md)
- [Plan por fases](docs/FASES.md)
- [Referencia de la API](docs/API.md)

## Instalación para desarrollo

### Requisitos

- Node.js 22 o superior
- PostgreSQL 16 o superior (instalado, o en Docker como se indica abajo)

### Pasos

```bash
# 1. Dependencias
npm install

# 2. Base de datos. Con PostgreSQL instalado (ajusta usuario y contraseña):
psql -U postgres -c "CREATE ROLE farmacia WITH LOGIN PASSWORD 'tu_password' CREATEDB;"
psql -U postgres -c "CREATE DATABASE farmacia OWNER farmacia;"
psql -U postgres -c "CREATE DATABASE farmacia_test OWNER farmacia;"   # para pruebas
#    O bien, con Docker:
docker run -d --name farmacia-db -p 5432:5432 -e POSTGRES_USER=farmacia \
  -e POSTGRES_PASSWORD=tu_password -e POSTGRES_DB=farmacia \
  -v farmacia_pg:/var/lib/postgresql/data postgres:16-alpine
docker exec farmacia-db createdb -U farmacia farmacia_test           # para pruebas

# 3. Variables de entorno
cp .env.example .env
#   - DATABASE_URL / TEST_DATABASE_URL con tu contraseña
#   - JWT_ACCESS_SECRET:  openssl rand -hex 32
#     (sin openssl: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
#   - SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD: cuenta del propietario
#   - SEED_DEMO_PASSWORD: contraseña de los usuarios de demostración (opcional)

# 4. Migraciones y datos iniciales
npm run db:deploy
npm run db:seed
npm run db:seed:demo   # opcional: usuarios, catálogo y lotes ficticios de demostración

# 5. Levantar API (http://localhost:4000) y frontend (http://localhost:5173)
npm run dev:api
npm run dev:web     # en otra terminal
```

Abre http://localhost:5173 e inicia sesión con la cuenta del propietario. Si no definiste
`SEED_OWNER_PASSWORD`, el seed generó una contraseña aleatoria y la mostró en consola.

En desarrollo, sin SMTP configurado, el enlace de "Recuperar contraseña" aparece en el log de la API.

## Despliegue con Docker

```bash
cp .env.example .env
# Define al menos: POSTGRES_PASSWORD, JWT_ACCESS_SECRET, APP_URL,
#                  SEED_OWNER_EMAIL y SEED_OWNER_PASSWORD

docker compose up -d --build
docker compose exec api node dist/seed.js     # sólo la primera vez
```

La aplicación queda en http://localhost:8080. La API aplica las migraciones pendientes al arrancar.

**Producción:** sirve la aplicación con **HTTPS**, por ejemplo detrás de Caddy, Traefik o
nginx con Let's Encrypt. Las cookies de sesión llevan el atributo `Secure`, así que fuera de
`localhost` el inicio de sesión requiere HTTPS. Si solo vas a probar en una red local por HTTP,
usa `COOKIE_SECURE=false`.

## Comandos

| Comando | Descripción |
|---|---|
| `npm run dev:api` / `npm run dev:web` | Servidores de desarrollo |
| `npm run typecheck` | Verificación de tipos de todos los paquetes |
| `npm test` | Pruebas de API (requiere `farmacia_test`) y frontend |
| `npm run build` | Build de producción |
| `npm run db:migrate` | Crear una migración nueva tras cambiar el esquema (desarrollo) |
| `npm run db:deploy` | Aplicar migraciones pendientes (producción) |
| `npm run db:seed` | Roles, permisos, sucursal, configuración y propietario |
| `npm run db:seed:demo` | Lo anterior + usuarios, catálogo y lotes ficticios de demostración (nunca en producción) |
| `./scripts/backup.sh [--docker]` | Respaldo de la base con rotación |

## Respaldos

```bash
./scripts/backup.sh            # instalación local (usa DATABASE_URL)
./scripts/backup.sh --docker   # base dentro de docker compose
```

Genera `backups/farmacia_AAAAMMDD_HHMMSS.dump` (base de datos) y `..._imagenes.tar.gz` (imágenes de
productos), verifica que el respaldo de la base se pueda leer y borra los respaldos
con más de `BACKUP_RETENTION_DAYS` días. Para programarlo a diario, mira el encabezado del script.
Guarda una copia **fuera del servidor**, porque los respaldos contienen datos sensibles.

## Seguridad

- Las contraseñas se guardan solo como hash Argon2id.
- Los secretos se configuran únicamente en variables de entorno. La API no arranca sin ellos y
  en producción rechaza el secreto de ejemplo.
- La base de datos impide stock negativo y la modificación o borrado de movimientos y auditoría.
- Los permisos se validan en el servidor en cada petición. El frontend solo oculta lo que no se puede usar.
- El sistema es una herramienta administrativa: **no determina ni sugiere tratamientos médicos**.

Detalle completo en [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md#6-seguridad-resumen).

### Dependencias con avisos de `npm audit`

Los tres avisos vienen de herramientas de compilación o de migración, no del código que atiende
peticiones. La "solución" que propone npm es bajar a Prisma 6, un cambio incompatible.

- `mysql2` llega como dependencia transitiva del CLI de Prisma. El sistema usa PostgreSQL y
  nunca carga ese controlador.
- `deepmerge-ts` lo usa el CLI de Prisma para combinar su propio archivo `prisma.config.ts`,
  nunca datos de usuarios.
- `esbuild`: el aviso afecta solo a su servidor de desarrollo en Windows, que este proyecto no usa.

Hay que revisarlos de nuevo al actualizar Prisma.
