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

## Inventario (`/inventory`)

Todo es por sucursal (`X-Branch-Id`). El stock disponible es la suma de los lotes activos, sin
caducar y con cantidad. Las fechas (`expiresAt`, `from`, `to`) son `AAAA-MM-DD` y "hoy" se calcula
en `APP_TIMEZONE`.

| Método y ruta | Permiso | Descripción |
|---|---|---|
| `GET /inventory/stock` | `inventory.view` | Existencias por producto + `summary`. Filtros: `q`, `categoryId`, `stockStatus` (`OUT`, `LOW`, `OK`, `OVER`), `sort` (`name`, `stock`, `expiry`) |
| `GET /inventory/stock/export` | `inventory.view` | Mismo filtro, en CSV |
| `GET /inventory/products/:productId` | `inventory.view` | Todos los lotes del producto y sus últimos 20 movimientos |
| `GET /inventory/batches` | `inventory.view` | Lotes. Filtros: `q` (producto o número de lote), `productId`, `expiry` (`EXPIRED`, `CRITICAL`, `WARNING`, `OK`), `status` (`AVAILABLE`, `DEPLETED`, `QUARANTINE`, `ALL`) |
| `GET /inventory/movements` | `inventory.movements.view` | Bitácora. Filtros: `q`, `type` (uno o varios), `productId`, `batchId`, `userId`, `from`, `to` |
| `GET /inventory/movements/export` | `inventory.movements.view` | Mismo filtro, en CSV (máx. 50 000 filas) |
| `POST /inventory/entries` | `inventory.adjust` | Entrada a un lote: `productId`, `lotNumber`, `expiresAt`, `quantity`, `unitCost?`, `manufacturedAt?`, `type` (`INITIAL_STOCK` o `ADJUSTMENT_IN` con `reason`), `notes?` |
| `POST /inventory/adjustments` | `inventory.adjust` | Ajuste de un lote: `batchId`, `direction` (`IN`/`OUT`), `quantity`, `reason`, `notes` (obligatorio si `reason` es `OTHER`) |

Respuestas de error relevantes:
- `422` si la salida deja el lote en negativo (`details: { available, requested }`), o si al darle
  entrada el lote ya caducó, está en cuarentena o fue dado de baja.
- `409` si el número de lote ya existe para el producto con otra caducidad.

Los movimientos no tienen rutas de edición ni de borrado, y la base de datos lo impide con un trigger.
`unitCost` y `value` sólo se incluyen para quien puede ver costos.

## Proveedores (`/suppliers`)

| Método y ruta | Permiso | Descripción |
|---|---|---|
| `GET /suppliers` | `suppliers.view` | Lista con `stats` (compras, total, saldo por pagar, última compra). Filtros: `q`, `status` (`active`, `inactive`, `all`) |
| `GET /suppliers/options` | `purchases.create` | Proveedores activos para el formulario de compras |
| `GET /suppliers/:id` | `suppliers.view` | Detalle con `stats` |
| `POST /suppliers` | `suppliers.manage` | Alta. `tradeName` y `rfc` únicos (409) |
| `PATCH /suppliers/:id` | `suppliers.manage` | Edición parcial |
| `PATCH /suppliers/:id/status` | `suppliers.manage` | `{ isActive }`: desactivar o reactivar |

## Compras (`/purchases`)

Quien ve compras ve sus importes (es la factura con la que trabaja). Todos los importes los calcula el servidor.

| Método y ruta | Permiso | Descripción |
|---|---|---|
| `GET /purchases` | `purchases.view` | Lista + `summary` (por recibir, saldo, vencidas, recibido en el mes). Filtros: `q` (folio `C-000012`, factura o proveedor), `supplierId`, `status`, `paymentStatus`, `overdue=true`, `from`, `to` |
| `GET /purchases/:id` | `purchases.view` | Detalle con partidas, pagos y quién capturó y recibió |
| `POST /purchases` | `purchases.create` | Alta: `supplierId`, `invoiceNumber?`, `purchaseDate`, `paymentMethod`, `paymentDueDate?`, `notes?`, `items[]` (`productId`, `lotNumber?`, `expiresAt?`, `quantity`, `unitCost`, `discount?`, `taxRate?`) y `receive` (requiere además `purchases.receive`) |
| `PUT /purchases/:id` | `purchases.create` | Reemplaza un pedido pendiente sin pagos |
| `POST /purchases/:id/receive` | `purchases.receive` | Ingresa la mercancía: crea o suma lotes (`PURCHASE_ENTRY`) y actualiza el último costo |
| `POST /purchases/:id/payments` | `purchases.pay` | `{ amount, method, reference?, paidAt? }`; no excede el saldo |
| `POST /purchases/:id/cancel` | `purchases.cancel` | `{ reason }`. Si estaba recibida, retira lo ingresado (422 si ya salieron unidades o si tiene pagos) |

Errores por partida: `details[].path` como `items.1.expiresAt` y el mensaje empieza con "Partida 2:".

## Ventas (`/sales`) y devoluciones (`/returns`)

| Método y ruta | Permiso | Descripción |
|---|---|---|
| `POST /sales` | `sales.create` | Cobro: `items[]` (`productId`, `quantity`, `discount?` con `sales.discount`), `payments[]` (`method`, `amount`, `received?` sólo efectivo, `reference?`), `prescriptionChecked`, `expectedTotal?`, `clientRequestId?` |
| `GET /sales` | `sales.view` | Lista + `summary` (corte por forma de pago y reembolsos) + `scope` (`own` sin `reports.view`). Filtros: `q` (folio `V-000012` o producto), `from`, `to`, `status`, `paymentMethod`, `userId` |
| `GET /sales/:id` | `sales.view` | Detalle con lotes, pagos, devoluciones y `header` del ticket. `costTotal`/`profit` sólo para quien ve costos |
| `POST /sales/:id/cancel` | `sales.cancel` | `{ reason }`. Regresa las unidades a sus lotes (`SALE_CANCELLATION`). 422 si tiene devoluciones |
| `POST /sales/:id/returns` | `returns.create` | `{ reason, refundMethod, items[]: { saleItemId, quantity, disposition } }`. `disposition` por omisión `QUARANTINE`; `RESTOCKED` requiere `inventory.adjust` |
| `GET /returns` | `returns.view` | Devoluciones + `summary.pendingItems`. Filtros: `q`, `pending=true` |
| `POST /returns/:id/items/:itemId/review` | `inventory.adjust` | `{ decision: RESTOCK \| DISCARD, notes? }` para lo que quedó en revisión |

Respuestas relevantes del cobro:
- `422` con `details[].path` `items.N.quantity` cuando no alcanza la existencia (`available`), o `items.N.productId` si falta confirmar la receta.
- `409` si `expectedTotal` no coincide con el total calculado (cambió un precio).
- Un `clientRequestId` repetido devuelve la venta original con `201` (no cobra dos veces).

## Configuración

| Método y ruta | Permiso | Descripción |
|---|---|---|
| `GET /settings/defaults` | `products.view` | IVA (`pricesIncludeTax`), margen y stock mínimo predeterminados, moneda |
| `GET /settings/clock` | Sesión iniciada | `{ today, timeZone }`: la fecha de la farmacia, para que la interfaz no dependa del reloj del equipo |

## Sucursales

| Método y ruta | Permiso | Descripción |
|---|---|---|
| `GET /branches` | `users.view` | Sucursales activas |

## Sistema

| Método y ruta | Acceso | Descripción |
|---|---|---|
| `GET /api/health` | Público | Estado de la API y de la base de datos |
| `GET /api/uploads/products/:archivo` | Público | Imágenes de productos (nombres impredecibles, sin listado) |
