# Plan de desarrollo por fases

Cada fase termina con: compilación sin errores, pruebas en verde, revisión de errores y
verificación de que lo anterior sigue funcionando. No se avanza con errores críticos.

| Fase | Alcance | Estado |
|---|---|---|
| 1 | Arquitectura + base de datos + autenticación | ✅ Completa |
| 2 | Usuarios + roles + permisos (administración desde la UI) | ✅ Completa |
| 3 | Productos + categorías + laboratorios | ✅ Completa |
| 4 | Lotes + inventario + movimientos | ✅ Completa |
| 5 | Proveedores + compras | ⏳ Siguiente |
| 6 | Punto de venta + ventas + devoluciones | Pendiente |
| 7 | Caducidades + alertas + notificaciones | Pendiente |
| 8 | Pacientes + recetas | Pendiente |
| 9 | Reportes + dashboard (gráficas, exportación PDF/Excel/CSV) | Pendiente |
| 10 | Auditoría (UI) + configuración + seguridad + optimización | Pendiente |
| 11 | Pruebas + documentación + despliegue | Pendiente |

## Fase 4: entregado

**Existencias** (`/inventario/existencias`)
- Stock disponible por producto **calculado siempre desde sus lotes**: sólo cuenta lo que está
  activo, sin caducar y con cantidad. Lo caducado y lo que está en cuarentena se muestra aparte.
- Tarjetas de resumen: productos con existencia, agotados, stock bajo, unidades caducadas y valor
  del inventario (este último sólo para quien puede ver costos). "Agotados" y "Stock bajo" filtran la lista.
- Búsqueda sin acentos, filtro por categoría y orden por nombre, menor existencia o caducidad más próxima.
- Exportación a CSV (abre bien en Excel, con acentos).

**Ficha de inventario por producto**
- Todos sus lotes con cantidad, caducidad (días restantes y clasificación), costo y estado.
- Marca **"Se vende primero"** en el lote que saldrá en la próxima venta (FEFO: el que caduca antes;
  los caducados y en cuarentena no cuentan) y **"Caducado: dar de baja"** en los vencidos con existencia.
- Últimos 20 movimientos y enlace al historial completo del producto.
- En celular se muestra como tarjetas con un botón "Ajustar o contar", pensado para hacer el
  conteo frente al anaquel.

**Entradas y ajustes**
- **Registrar entrada:** carga inicial o ajuste positivo de un lote. Si el lote ya existe se suma a él;
  si existe con otra caducidad se rechaza (un mismo lote no puede tener dos caducidades).
  No se aceptan lotes ya caducados.
- **Ajustar lote:** salida (daño, caducidad, robo o extravío, uso interno, corrección, error de
  captura, devolución u otro), entrada o **conteo físico** (se captura lo contado y el sistema
  calcula la diferencia). Siempre se muestra "antes → después" antes de confirmar.
- **El motivo es obligatorio** y, si es "Otro", también la explicación. La baja por caducidad,
  daño o robo queda con su propio tipo de movimiento para los reportes.

**Lotes** (`/inventario/lotes`) y **Movimientos** (`/inventario/movimientos`)
- Lotes filtrables por caducidad (caducados, críticos < 30 días, próximos 30–90, normales; los
  límites se toman de la configuración) y por estado.
- Bitácora de movimientos con quién, cuándo, cuánto (antes, cambio, después), tipo y motivo.
  Filtros por producto, tipo y rango de fechas; exportación a CSV de hasta 50 000 movimientos.
- Los movimientos **no se pueden editar ni borrar**: una corrección es un nuevo ajuste.

**Reglas de seguridad e integridad**
- Todo cambio de stock pasa por un único módulo (`inventory.core.ts`) que **bloquea el lote**
  (`SELECT … FOR UPDATE`) dentro de una transacción y registra el movimiento en la misma
  transacción. Dos personas ajustando el mismo lote al mismo tiempo no pueden dejarlo negativo.
  Esto se verificó: sin el bloqueo, la prueba de concurrencia falla; con él, pasa.
- La base de datos vuelve a impedir stock negativo y movimientos alterados (`CHECK` y triggers de la Fase 1).
- La asignación **FEFO** para ventas ya está lista (se usará en el punto de venta de la Fase 6).
- Cada entrada y ajuste queda en auditoría con cantidad anterior, cambio y nueva.
- Un lote de otra sucursal se trata como inexistente.
- El cajero consulta existencias y lotes, pero no ve costos ni valor, no registra entradas ni
  ajustes, y no ve la bitácora de movimientos.
- Las exportaciones CSV neutralizan fórmulas (un texto que empieza con `=`, `+`, `-` o `@` no se
  ejecuta en Excel).
- "Hoy" se calcula en la zona horaria de la farmacia (`APP_TIMEZONE`, por defecto
  `America/Mexico_City`), así un lote no "caduca" antes de tiempo por la hora del servidor.

**Datos de demostración:** `npm run db:seed:demo` agrega 20 lotes ficticios con su movimiento de
carga inicial, entre ellos casos útiles para probar: un lote caducado, lotes críticos y productos
con stock bajo.

**Verificación**
- `npm run typecheck`: sin errores.
- `npm test`: 154 pruebas de API (28 nuevas, incluida la de concurrencia) y 47 de frontend (9 nuevas).
- Navegador real: resumen y filtro de stock bajo, lote FEFO marcado, salida por daño, conteo físico,
  entrada de lote nuevo, baja de lote caducado, exportación de movimientos, lotes críticos, cajero
  sin costos ni movimientos y vista móvil. Sin errores en la consola.

## Fase 3: entregado

**Productos** (`/inventario/productos`)
- Lista con búsqueda **sin acentos y por varias palabras** ("acido" encuentra "Ácido fólico";
  "para 500" encuentra "Paracetamol 500 mg"), por código de barras y por SKU.
- **Lector de código de barras USB:** al escanear en el buscador (código + Enter) se abre el producto.
  En el formulario, el Enter del lector no envía el formulario por accidente.
- Filtros por categoría, laboratorio, estado y receta; orden por nombre, precio o fecha.
- Ficha completa: identificación, clasificación y presentación, precio con IVA por producto,
  parámetros de inventario por sucursal (mínimo, máximo, ubicación), control (receta, retiene
  receta, estado), información de referencia e imagen.
- **Margen en vivo** (utilidad por unidad, % sobre costo y sobre venta), aviso si el precio queda
  por debajo del costo y botón "Sugerir precio" con el margen predeterminado de la configuración.
- SKU automático (`MED-000001`), con secuencia en la base de datos.
- Existencias por sucursal calculadas desde los lotes disponibles.

**Categorías y laboratorios** (pestañas en Productos)
- Alta, edición y baja lógica; nombre único sin distinguir mayúsculas; un nombre dado de baja
  se reactiva en lugar de duplicarse; no se elimina si algún producto lo usa.

**Reglas de seguridad**
- El **costo y el margen** sólo los ve quien puede crear/editar productos o ver reportes
  financieros. Un cajero ve el precio de venta, no lo que costó.
- **Cambiar precios** (venta, costo o IVA) requiere `products.change_price` y se audita aparte
  (`PRODUCT_PRICE_CHANGE` con valor anterior y nuevo). El farmacéutico edita productos, pero no precios.
- Eliminar es baja lógica (el historial se conserva), libera el código de barras y **se bloquea si
  hay existencias**.
- **Imágenes:** sólo JPG/PNG/WebP de hasta 5 MB. Se re-codifican a WebP de máx. 800 px, sin
  metadatos (EXIF/GPS). Un archivo que no es imagen se rechaza aunque diga serlo. Los nombres
  de archivo son impredecibles. Se incluyen en `scripts/backup.sh`.
- La sucursal de trabajo se valida contra las sucursales del usuario (`X-Branch-Id`), lista para
  multi-sucursal.

**Datos de demostración:** `npm run db:seed:demo` agrega 10 categorías, 10 laboratorios ficticios
y 30 medicamentos con nombre genérico (sin marcas comerciales reales). Los códigos de barras usan
EAN-13 del rango interno 200, así que no coinciden con productos reales.

**Verificación**
- `npm run typecheck`: sin errores.
- `npm test`: 126 pruebas de API (39 nuevas) y 38 de frontend (8 nuevas).
- Navegador real: búsqueda sin acentos, escaneo que abre la ficha, cambio de precio, alta con
  precio sugerido e imagen, categorías, cajero en modo consulta sin costos y vista móvil.

## Fase 2: entregado

**Usuarios** (`/usuarios`)
- Lista con búsqueda, filtros por rol y estado, y paginación. Tabla en escritorio, tarjetas en celular.
- Alta de usuarios con contraseña temporal generada (o definida por el administrador). Se muestra
  una sola vez y el usuario debe cambiarla en su primer inicio de sesión.
- Edición de datos, rol, sucursales y sucursal predeterminada, con bitácora de cambios campo por campo.
- Acciones: desactivar/reactivar, restablecer contraseña, desbloquear cuenta y cerrar sesiones.
- Cambios de rol, desactivaciones y cambios de permisos se aplican **de inmediato** a las sesiones abiertas.

**Roles y permisos** (`/usuarios/roles`)
- Tarjetas por rol con número de usuarios y de permisos.
- Editor con matriz de permisos agrupada por módulo, selección por módulo y permisos sensibles marcados.
- Roles personalizados: crear, editar y eliminar (sólo si no tienen usuarios asignados).
- El rol Propietario es inmutable; los roles del sistema se pueden ajustar pero no eliminar.

**Reglas de seguridad** (validadas en el servidor y reflejadas en la interfaz)
- **Anti-escalamiento:** nadie otorga un rol ni un permiso que no tiene, ni administra a un usuario
  con un rol superior al suyo. Un administrador no puede crear propietarios ni editar al propietario.
- Nadie puede cambiar su propio rol, desactivarse ni restablecer su propia contraseña desde la
  administración (para eso está "Mi perfil").
- Siempre debe quedar al menos un propietario activo.
- Toda acción queda en auditoría: alta, edición, (des)activación, restablecimiento, desbloqueo,
  cierre de sesiones, creación, edición y eliminación de roles, y cambios de permisos (añadidos/quitados).

**Datos de demostración:** `npm run db:seed:demo` crea 4 usuarios ficticios (administradora,
farmacéutico, cajera y almacenista) que, con el propietario, suman los 5 usuarios de prueba.
Se niega a ejecutarse en producción.

**Verificación**
- `npm run typecheck`: sin errores.
- `npm test`: 87 pruebas de API (36 nuevas de usuarios y roles) y 30 de frontend (11 nuevas).
- Navegador real: alta de usuario, cambio obligatorio de contraseña, menú limitado del cajero,
  administrador sin acceso al propietario, roles en sólo lectura para quien no los administra,
  rol personalizado y vista móvil.

## Fase 1: entregado

**Arquitectura**
- Monorepo con npm workspaces: `apps/api`, `apps/web` y `packages/shared` (permisos y roles
  compartidos entre frontend y backend).
- Capas: rutas → middlewares → controladores (DTOs validados con Zod) → servicios → Prisma.
- Manejo centralizado de errores con respuestas uniformes `{ error: { code, message, details } }`.

**Base de datos**
- Esquema completo para todas las fases (32 tablas), con sucursales desde el inicio.
- Migración de integridad: `CHECK` de stock no negativo, triggers de inmutabilidad e índice de búsqueda.
- Seeder: permisos, 6 roles del sistema, sucursal Matriz, configuración inicial y usuario propietario.

**Autenticación**
- Login con correo y contraseña, "Recordarme" y recuperación de contraseña por correo.
- Argon2id, JWT de acceso de 15 min en memoria y refresh token rotativo en cookie httpOnly.
- Detección de reutilización de tokens, sesiones revocables, cierre de sesión inmediato.
- CSRF (double submit), rate limiting, bloqueo de cuenta, Helmet y CORS restringido.
- Auditoría de inicios y cierres de sesión, intentos fallidos, bloqueos, recuperación,
  cambio de contraseña y accesos denegados.
- Middleware `authorize('permiso')` listo para todos los módulos.

**Frontend**
- Pantallas de inicio de sesión, recuperar y restablecer contraseña, y perfil con cambio de contraseña.
- Layout responsivo (sidebar fijo en escritorio, menú deslizable en celular), filtrado por permisos.
- Dashboard inicial y páginas de los módulos de fases posteriores.

**Infraestructura**
- Dockerfiles (API y nginx), `docker-compose.yml`, script de respaldos y CI en GitHub Actions.

**Verificación**
- `npm run typecheck`: sin errores (shared, api, web).
- `npm test`: 51 pruebas de API (unitarias + integración contra PostgreSQL) y 19 de frontend.
- Prueba en navegador real (Chromium): login, redirección, sesión restaurada al recargar,
  logout y vista móvil.
