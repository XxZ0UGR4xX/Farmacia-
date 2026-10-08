# Arquitectura del Sistema Integral de Farmacia

## 1. Análisis de requerimientos

### 1.1 Prioridades (en orden)

1. **Seguridad**: autenticación robusta, autorización por permisos y protección de datos de pacientes.
2. **Inventario correcto**: el stock nunca puede quedar negativo ni cambiar sin un movimiento.
3. **Trazabilidad**: cada cambio queda registrado con usuario, fecha, IP y motivo. No se puede borrar.
4. **Facilidad de uso**: el usuario principal es un doctor, no un técnico.
5. **Escalabilidad**: varios usuarios, roles y **sucursales** sin reconstruir el sistema.
6. **Diseño profesional**: blanco, verde, azul y neutros.

### 1.2 Decisiones clave derivadas del análisis

| Requerimiento | Decisión |
|---|---|
| Stock por lotes, FEFO | El stock vive **solo en `product_batches`** (por sucursal). El stock de un producto es la suma de sus lotes. No hay un campo de stock suelto que se pueda desincronizar. |
| Stock nunca negativo | Validación en el servicio **y** `CHECK (quantity >= 0)` en la base de datos. |
| No modificar stock sin movimiento | Solo el `InventoryService` modifica lotes, siempre en la misma transacción en la que inserta el movimiento. |
| Historial inmutable | Triggers de PostgreSQL bloquean `UPDATE` y `DELETE` en `inventory_movements` y `audit_logs`. Ni un error de código puede alterarlos. |
| Sucursales a futuro | Existe la tabla `branches` desde el día 1. Lotes, movimientos, ventas, compras y la configuración de stock mínimo/máximo están ligados a una sucursal. Hoy se crea solo la "Matriz". |
| Muchos usuarios y roles | Roles con permisos granulares (`products.view`, `inventory.adjust`, ...). El rol **OWNER** (propietario) tiene acceso total, incluso a permisos agregados en el futuro. |
| Datos de pacientes | Módulo protegido por permisos propios (`patients.view`), con acceso auditado. El sistema **no** sugiere tratamientos: solo registra. |
| Ventas concurrentes | Las ventas bloquean las filas de los lotes (`SELECT ... FOR UPDATE`) dentro de la transacción. Así dos cajas no pueden vender la misma última unidad. |
| Dinero | `DECIMAL` en base de datos (nunca `float`). |

### 1.3 Supuestos (ajustables)

- País: México (RFC, IVA). Los medicamentos suelen tener IVA 0 % y otros productos 16 %, así que la tasa de impuesto es **por producto**.
- Las cantidades se manejan en **unidades enteras** de la presentación (cajas, frascos, piezas).
- Moneda por defecto: MXN (configurable).
- El envío de correos (recuperar contraseña) usa SMTP si se configura. En desarrollo el enlace se muestra en el log del servidor.

## 2. Arquitectura general

```
┌─────────────────────────────┐
│  Frontend (React + Vite)    │  SPA: TypeScript, Tailwind, React Router, TanStack Query
└──────────────┬──────────────┘
               │ HTTPS  /api/v1   (JWT de acceso en header + refresh token en cookie httpOnly)
┌──────────────▼──────────────┐
│  API REST (Express 5 + TS)  │  Rutas → Middlewares (auth, permisos, rate limit, CSRF)
│                             │        → Controladores (delgados: validan DTO con Zod)
│                             │        → Servicios (lógica de negocio y transacciones)
└──────────────┬──────────────┘
               │ Prisma ORM (consultas parametrizadas)
┌──────────────▼──────────────┐
│  PostgreSQL 16              │  Constraints, índices, triggers de inmutabilidad
└─────────────────────────────┘
```

### Capas del backend

| Capa | Responsabilidad | No debe |
|---|---|---|
| **Routes** | Declarar endpoints y qué middlewares aplican (auth, permiso requerido). | Tener lógica. |
| **Controllers** | Leer la petición, validar el DTO con Zod y llamar al servicio. Dar formato a la respuesta. | Acceder a Prisma directamente. |
| **Services** | Reglas de negocio, transacciones, auditoría y notificaciones. | Conocer `req`/`res` de Express. |
| **Prisma / DB** | Persistencia. | — |
| **Middlewares** | Autenticación, autorización, rate limiting, CSRF, contexto de petición y manejo centralizado de errores. | — |

## 3. Estructura de carpetas

```
farmacia/
├── apps/
│   ├── api/                         # Backend Node.js + Express + Prisma
│   │   ├── prisma/
│   │   │   ├── schema.prisma        # Modelo de datos completo
│   │   │   ├── migrations/          # Migraciones SQL versionadas
│   │   │   └── seed/                # Seeders (catálogos, roles, datos ficticios)
│   │   ├── src/
│   │   │   ├── config/              # Carga y validación de variables de entorno
│   │   │   ├── lib/                 # Prisma client, logger, crypto, mailer
│   │   │   ├── middlewares/         # authenticate, authorize, csrf, rate-limit, errors
│   │   │   ├── shared/              # Errores, utilidades HTTP, tipos comunes
│   │   │   ├── modules/             # Un directorio por módulo de negocio
│   │   │   │   ├── auth/            # *.routes.ts, *.controller.ts, *.service.ts, *.schemas.ts
│   │   │   │   ├── audit/
│   │   │   │   ├── users/           # (Fase 2)
│   │   │   │   ├── products/        # (Fase 3) ...
│   │   │   ├── app.ts               # Construcción de la app Express (testeable)
│   │   │   └── server.ts            # Arranque del servidor
│   │   ├── tests/                   # Pruebas unitarias e integración (Vitest + Supertest)
│   │   └── Dockerfile
│   └── web/                         # Frontend React
│       ├── src/
│       │   ├── api/                 # Cliente HTTP (refresh automático, CSRF)
│       │   ├── auth/                # AuthProvider, rutas protegidas, permisos
│       │   ├── components/
│       │   │   ├── ui/              # Botones, inputs, tarjetas, badges (reutilizables)
│       │   │   └── layout/          # Sidebar, Topbar, AppLayout
│       │   ├── features/            # Páginas por módulo (auth, dashboard, inventory, ...)
│       │   ├── lib/                 # Utilidades (formato de moneda, fechas)
│       │   ├── router.tsx
│       │   └── main.tsx
│       ├── nginx.conf
│       └── Dockerfile
├── packages/
│   └── shared/                      # Código compartido FE/BE: catálogo de permisos y roles
├── docs/                            # Documentación técnica
├── scripts/                         # Backups y utilidades de operación
├── docker-compose.yml
├── .env.example
└── README.md
```

## 4. Autenticación y sesiones

- **Contraseñas**: hash con **Argon2id**. Nunca se guardan ni se registran en texto plano.
- **Access token**: JWT firmado (HS256) de vida corta (15 min). Se guarda **solo en memoria** del navegador (no en `localStorage`), lo que reduce el impacto de un XSS.
- **Refresh token**: valor aleatorio de 256 bits en una **cookie httpOnly, SameSite=Strict y Secure** (en producción). En la base de datos solo se guarda su hash SHA-256.
  - **Rotación**: cada uso emite un nuevo refresh token e invalida el anterior.
  - **Detección de reutilización**: si se presenta un token ya rotado (posible robo), se revoca toda la sesión.
  - **"Recordarme"**: con la casilla marcada, la cookie persiste 30 días. Sin marcarla, es cookie de sesión y expira en 12 horas.
- **Sesiones** (`user_sessions`): cada login crea una sesión. Cerrar sesión la revoca y el access token deja de ser aceptado de inmediato.
- **CSRF**: los endpoints que usan la cookie (`/auth/refresh` y `/auth/logout`) exigen el patrón *double submit*: el header `X-CSRF-Token` debe coincidir con la cookie `csrf_token`. El resto de la API usa `Authorization: Bearer`, que no es vulnerable a CSRF.
- **Fuerza bruta**: rate limiting por IP y por correo, más bloqueo temporal de la cuenta tras 5 intentos fallidos.
- **Recuperar contraseña**: token aleatorio de un solo uso que expira en 30 min y se guarda como hash. La respuesta es siempre genérica para no revelar qué correos existen. Al restablecer la contraseña se revocan todas las sesiones.

## 5. Autorización

- Cada usuario tiene **un rol**. Cada rol tiene **N permisos** (`role_permissions`).
- El middleware `authorize('inventory.adjust')` protege cada endpoint.
- El rol `OWNER` pasa todas las verificaciones (regla 11).
- El catálogo de permisos vive en `packages/shared`. Backend y frontend usan exactamente las mismas claves: el frontend oculta lo que no se puede usar y el backend lo bloquea de verdad.
- Los usuarios tienen acceso a una o varias sucursales (`user_branches`), listo para el escenario multi-sucursal.

## 6. Seguridad (resumen)

| Amenaza | Mitigación |
|---|---|
| SQL Injection | Prisma usa consultas parametrizadas. No se concatena SQL con datos del usuario. |
| XSS | React escapa la salida por defecto. Cabeceras CSP vía Helmet. Access token fuera de `localStorage`. |
| CSRF | SameSite=Strict + double submit token en endpoints con cookie. |
| Fuerza bruta | `express-rate-limit` + bloqueo de cuenta. |
| Robo de sesión | Refresh tokens rotativos con detección de reutilización. Sesiones revocables. |
| Datos inválidos | Validación con Zod en cada endpoint y constraints en la base de datos. |
| Fugas de información | Errores 500 genéricos. Los detalles solo van al log del servidor. |
| Secretos | Solo en variables de entorno (`.env`, nunca versionado). La app no arranca si faltan. |
| Pérdida de datos | Script de respaldo `pg_dump` con rotación (`scripts/backup.sh`). |

## 7. Escalabilidad

- **Sucursales**: todo dato operativo tiene `branch_id`. Para abrir una nueva sucursal basta con crear el registro y asignar usuarios.
- **Más usuarios**: los roles y permisos son datos, no código. Se pueden crear roles personalizados.
- **Más instancias de API**: la caché de sesiones está aislada en un módulo y puede moverse a Redis sin tocar la lógica.
- **Docker**: `docker-compose.yml` levanta PostgreSQL, la API y el frontend (nginx).
