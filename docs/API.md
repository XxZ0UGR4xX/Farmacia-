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

## Productos

La sucursal de trabajo se toma del header `X-Branch-Id` (validado contra las sucursales del
usuario) o de su sucursal predeterminada. Existencias y parámetros de inventario son por sucursal.

| Método y ruta | Permiso | Descripción |
|---|---|---|
| `GET /products` | `products.view` | Lista. Filtros: `q` (sin acentos, varias palabras, código o SKU), `categoryId`, `laboratoryId`, `status`, `requiresPrescription`, `sort` (`name`, `price_asc`, `price_desc`, `recent`) |
| `GET /products/:id` | `products.view` | Ficha con `stock`, `stockStatus` (`OUT`/`LOW`/`OK`) e `inventory` de la sucursal |
| `GET /products/barcode/:code` | `products.view` | Búsqueda exacta por código de barras (lector) |
| `POST /products` | `products.create` | Alta. `sku` opcional (se genera `MED-000001`); `minStock` toma el valor de la configuración si se omite |
| `PATCH /products/:id` | `products.edit` | Edición parcial. Cambiar `salePrice`, `purchasePrice` o `taxRate` requiere además `products.change_price` |
| `DELETE /products/:id` | `products.delete` | Baja lógica; 422 si tiene existencias |
| `POST /products/:id/image` | `products.edit` | `multipart/form-data`, campo `image` (JPG/PNG/WebP, máx. 5 MB) → `{ imageUrl }` |
| `DELETE /products/:id/image` | `products.edit` | Quita la imagen |

`purchasePrice` y `margin` sólo se incluyen para quien tiene `products.create`, `products.edit`
o `reports.financial`. Los montos viajan como números con 2 decimales.

## Categorías y laboratorios

| Método y ruta | Permiso | Descripción |
|---|---|---|
| `GET /categories`, `GET /laboratories` | `products.view` | Lista con `productCount` |
| `POST /categories`, `POST /laboratories` | `catalogs.manage` | Alta (reactiva un nombre dado de baja) |
| `PATCH /categories/:id`, `PATCH /laboratories/:id` | `catalogs.manage` | Edición |
| `DELETE /categories/:id`, `DELETE /laboratories/:id` | `catalogs.manage` | Baja lógica; 422 si algún producto lo usa |

## Configuración

| Método y ruta | Permiso | Descripción |
|---|---|---|
| `GET /settings/defaults` | `products.view` | IVA (`pricesIncludeTax`), margen y stock mínimo predeterminados, moneda |

## Sucursales

| Método y ruta | Permiso | Descripción |
|---|---|---|
| `GET /branches` | `users.view` | Sucursales activas |

## Sistema

| Método y ruta | Acceso | Descripción |
|---|---|---|
| `GET /api/health` | Público | Estado de la API y de la base de datos |
| `GET /api/uploads/products/:archivo` | Público | Imágenes de productos (nombres impredecibles, sin listado) |
