# Referencia de la API

Base: `/api/v1`. Todas las respuestas son JSON.

- **Autenticación:** header `Authorization: Bearer <accessToken>`, salvo los endpoints públicos de `auth`.
- **Errores:** `{ "error": { "code", "message", "details?" } }`. Los errores de validación incluyen
  `details: [{ path, message }]` por campo.
- **Listas paginadas:** `?page=1&pageSize=20` (máx. 100) → `{ data: [...], meta: { page, pageSize, total, totalPages } }`.

| Código HTTP | `code` | Significado |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Datos inválidos |
| 401 | `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `INVALID_TOKEN`, `INVALID_CREDENTIALS` | Sin sesión válida |
| 403 | `FORBIDDEN`, `CSRF_INVALID`, `ACCOUNT_INACTIVE` | Sin permiso |
| 404 | `NOT_FOUND` | No existe |
| 409 | `CONFLICT` | Duplicado (p.ej. correo ya registrado) |
| 422 | `BUSINESS_RULE` | Viola una regla de negocio (p.ej. desactivarse a sí mismo) |
| 423 | `ACCOUNT_LOCKED` | Cuenta bloqueada por intentos fallidos |
| 429 | `RATE_LIMITED` | Demasiadas solicitudes |

## Autenticación (`/auth`)

| Método y ruta | Acceso | Descripción |
|---|---|---|
| `POST /auth/login` | Público | `{ email, password, rememberMe }` → access token + perfil; fija cookies `rt` y `csrf_token` |
| `POST /auth/refresh` | Cookie + `X-CSRF-Token` | Rota el refresh token y emite un nuevo access token |
| `POST /auth/logout` | Cookie + `X-CSRF-Token` | Revoca la sesión |
| `POST /auth/forgot-password` | Público | `{ email }` → respuesta genérica; envía enlace por correo |
| `POST /auth/reset-password` | Público | `{ token, password }` → cierra todas las sesiones |
| `GET /auth/me` | Sesión | Perfil, rol, permisos y sucursales |
| `POST /auth/change-password` | Sesión | `{ currentPassword, newPassword }` → cierra las otras sesiones |

## Usuarios (`/users`)

| Método y ruta | Permiso | Descripción |
|---|---|---|
| `GET /users` | `users.view` | Lista. Filtros: `q` (nombre/correo), `roleId`, `status` (`ACTIVE`/`INACTIVE`) |
| `GET /users/:id` | `users.view` | Detalle + `activeSessions` |
| `POST /users` | `users.manage` | Alta. `temporaryPassword` opcional; si se omite se genera. Responde `{ user, temporaryPassword }` |
| `PATCH /users/:id` | `users.manage` | Edición parcial: datos, `roleId`, `branchIds`, `defaultBranchId` |
| `POST /users/:id/deactivate` | `users.manage` | Desactiva y cierra sus sesiones |
| `POST /users/:id/activate` | `users.manage` | Reactiva |
| `POST /users/:id/reset-password` | `users.manage` | Contraseña temporal + cierre de sesiones + cambio obligatorio |
| `POST /users/:id/unlock` | `users.manage` | Quita el bloqueo por intentos fallidos |
| `POST /users/:id/revoke-sessions` | `users.manage` | Cierra todas sus sesiones |

Reglas: no se puede administrar a un usuario con un rol que el actor no podría otorgar; nadie
cambia su propio rol, se desactiva o restablece su propia contraseña por esta vía; siempre queda
al menos un propietario activo.

## Roles y permisos

| Método y ruta | Permiso | Descripción |
|---|---|---|
| `GET /roles` | `users.view` | Roles con permisos y número de usuarios |
| `GET /roles/:id` | `users.view` | Detalle |
| `POST /roles` | `roles.manage` | `{ name, description?, permissions[] }` → rol personalizado |
| `PATCH /roles/:id` | `roles.manage` | Edición parcial. El rol Propietario es inmutable |
| `DELETE /roles/:id` | `roles.manage` | Sólo roles personalizados sin usuarios asignados |
| `GET /permissions` | `users.view` | Catálogo agrupado por módulo, con permisos sensibles marcados |

Regla: nadie otorga permisos que no tiene (respuesta 403 con `details.missing`), ni modifica su propio rol.

## Sucursales

| Método y ruta | Permiso | Descripción |
|---|---|---|
| `GET /branches` | `users.view` | Sucursales activas |

## Sistema

| Método y ruta | Acceso | Descripción |
|---|---|---|
| `GET /api/health` | Público | Estado de la API y de la base de datos |
