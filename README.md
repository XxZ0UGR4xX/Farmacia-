# Sistema Integral de Farmacia

Sistema web para administrar una farmacia: inventario por lotes con salida **FEFO**, caducidades,
compras, proveedores, punto de venta, pacientes, recetas, reportes y auditoría completa.

Está pensado para el doctor propietario, que necesita saber de un vistazo cómo está su farmacia.
La arquitectura admite desde el inicio más empleados, roles y **sucursales** sin reconstruir el sistema.

> **Estado:** las 11 fases están completas: usuarios, roles y permisos; productos y catálogos;
> lotes, existencias y movimientos; proveedores y compras; punto de venta, ventas y devoluciones;
> caducidades y alertas; pacientes y recetas; dashboard y reportes (Excel, CSV y PDF); auditoría,
> configuración y sucursales; pruebas, manual y guía de despliegue con HTTPS y respaldos.
> Ver [docs/FASES.md](docs/FASES.md).

**Para usar el sistema:** [Manual de usuario](docs/MANUAL_DE_USUARIO.md) ·
**Para instalarlo en la farmacia o en un servidor:** [Guía de despliegue](docs/DESPLIEGUE.md)

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
docs/            Manual, despliegue, arquitectura, base de datos, API, seguridad y fases
deploy/          Configuración de HTTPS (Caddy)
scripts/         Respaldo y restauración
```

Documentación:
- [Manual de usuario](docs/MANUAL_DE_USUARIO.md)
- [Guía de despliegue: instalación, HTTPS, respaldos y actualizaciones](docs/DESPLIEGUE.md)
- [Arquitectura y seguridad](docs/ARQUITECTURA.md)
- [Base de datos y modelo entidad-relación](docs/BASE_DE_DATOS.md)
- [Plan por fases](docs/FASES.md)
- [Referencia de la API](docs/API.md)
- [Seguridad](docs/SEGURIDAD.md)

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

### Actualizar una instalación existente

```bash
git pull
npm install         # también aplica las versiones corregidas de dependencias (overrides)
npm run db:deploy   # aplica las migraciones nuevas
npm run db:seed     # registra permisos nuevos (no modifica tus roles personalizados ni tus datos)
```

## Despliegue con Docker

```bash
cp .env.example .env
# Define al menos: POSTGRES_PASSWORD, JWT_ACCESS_SECRET, APP_URL,
#                  SEED_OWNER_EMAIL y SEED_OWNER_PASSWORD

docker compose up -d --build
docker compose exec api node dist/seed.js     # sólo la primera vez
```

La aplicación queda en http://localhost:8080. La API aplica las migraciones pendientes al arrancar.

**Producción con HTTPS:** con un dominio que apunte al servidor, define `DOMAIN` y
`APP_URL=https://…` en `.env` y arranca con `docker compose --profile https up -d --build`:
Caddy obtiene y renueva el certificado de Let's Encrypt. Las cookies de sesión llevan el
atributo `Secure`, así que fuera de `localhost` el inicio de sesión requiere HTTPS (en una red
local privada se puede usar `COOKIE_SECURE=false`). Paso a paso en
[docs/DESPLIEGUE.md](docs/DESPLIEGUE.md).

## Comandos

| Comando | Descripción |
|---|---|
| `npm run dev:api` / `npm run dev:web` | Servidores de desarrollo |
| `npm run typecheck` | Verificación de tipos de todos los paquetes |
| `npm test` | Pruebas de API (requiere `farmacia_test`) y frontend |
| `npm run test:e2e` | Pruebas de punta a punta en navegador (requiere `E2E_DATABASE_URL`, ver abajo) |
| `npm run build` | Build de producción |
| `npm run db:migrate` | Crear una migración nueva tras cambiar el esquema (desarrollo) |
| `npm run db:deploy` | Aplicar migraciones pendientes (producción) |
| `npm run db:seed` | Roles, permisos, sucursal, configuración y propietario |
| `npm run db:seed:demo` | Lo anterior + usuarios, catálogo y lotes ficticios de demostración (nunca en producción) |
| `./scripts/backup.sh [--docker]` | Respaldo verificado de la base y las imágenes, con rotación |
| `./scripts/restore.sh [--docker] <archivo.dump>` | Restaura un respaldo (pide confirmación) |

## Pruebas

| Tipo | Qué cubre | Cómo |
|---|---|---|
| API (Vitest + Supertest) | 236 pruebas: reglas de negocio, permisos, concurrencia, reportes, seguridad de todas las rutas | `npm test` (base `TEST_DATABASE_URL`) |
| Frontend (Vitest + Testing Library) | 81 pruebas de pantallas y componentes | `npm test` |
| De punta a punta (Playwright) | 10 flujos completos en Chromium: ventas, recetas, compras, inventario, reportes, configuración y auditoría | `npm run test:e2e` |

Para las pruebas de punta a punta crea una base exclusiva (su nombre debe contener `e2e`) e
instala el navegador una vez:

```bash
psql -U postgres -c "CREATE DATABASE farmacia_e2e OWNER farmacia;"
npx playwright install chromium
E2E_DATABASE_URL=postgresql://farmacia:tu_password@localhost:5432/farmacia_e2e npm run test:e2e
```

La prueba levanta sola la API (puerto 4100) y la interfaz (4174), aplica las migraciones y carga
los datos de demostración.

## Respaldos

```bash
./scripts/backup.sh            # instalación local (usa DATABASE_URL)
./scripts/backup.sh --docker   # base dentro de docker compose
```

Genera `backups/farmacia_AAAAMMDD_HHMMSS.dump` (base de datos) y `..._imagenes.tar.gz` (imágenes de
productos), verifica que ambos se puedan leer y borra los respaldos con más de
`BACKUP_RETENTION_DAYS` días. En modo `--docker` no hace falta tener PostgreSQL instalado.
`./scripts/restore.sh` los restaura. Cómo programarlos a diario (Linux y Windows) y guardarlos
**fuera del servidor**, cifrados: [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md#5-respaldos-diarios).

## Seguridad

- Las contraseñas se guardan solo como hash Argon2id.
- Los secretos se configuran únicamente en variables de entorno. La API no arranca sin ellos y
  en producción rechaza el secreto de ejemplo.
- La base de datos impide stock negativo y la modificación o borrado de movimientos y auditoría.
- Los permisos se validan en el servidor en cada petición. El frontend solo oculta lo que no se puede usar.
- El sistema es una herramienta administrativa: **no determina ni sugiere tratamientos médicos**.

Detalle completo en [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md#6-seguridad-resumen).

### Dependencias

`npm audit --omit=dev` reporta **0 vulnerabilidades** en lo que corre en producción. El CLI de
Prisma traía versiones con avisos de `mysql2` y `deepmerge-ts`; se fijaron versiones corregidas
con `overrides` en `package.json`. Queda un aviso **bajo** de `esbuild` que sólo afecta a *su*
servidor de desarrollo en Windows, que este proyecto no usa. Detalle en
[docs/SEGURIDAD.md](docs/SEGURIDAD.md#7-dependencias).
