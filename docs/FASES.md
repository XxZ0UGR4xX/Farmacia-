# Plan de desarrollo por fases

Cada fase termina con: compilación sin errores, pruebas en verde, revisión de errores y
verificación de que lo anterior sigue funcionando. No se avanza con errores críticos.

| Fase | Alcance | Estado |
|---|---|---|
| 1 | Arquitectura + base de datos + autenticación | ✅ Completa |
| 2 | Usuarios + roles + permisos (administración desde la UI) | ✅ Completa |
| 3 | Productos + categorías + laboratorios | ✅ Completa |
| 4 | Lotes + inventario + movimientos | ✅ Completa |
| 5 | Proveedores + compras | ✅ Completa |
| 6 | Punto de venta + ventas + devoluciones | ✅ Completa |
| 7 | Caducidades + alertas + notificaciones | ✅ Completa |
| 8 | Pacientes + recetas | ⏳ Siguiente |
| 9 | Reportes + dashboard (gráficas, exportación PDF/Excel/CSV) | Pendiente |
| 10 | Auditoría (UI) + configuración + seguridad + optimización | Pendiente |
| 11 | Pruebas + documentación + despliegue | Pendiente |

## Fase 7: entregado

**Caducidades** (`/inventario/caducidades`)
- Tarjetas de **caducados**, **críticos** (menos de 30 días) y **próximos** (30 a 90 días) con
  lotes, unidades, productos y valor al costo. Los límites se toman de la configuración `alerts.expiry`.
- Lista de lotes con existencia ordenada por caducidad; al tocar una tarjeta se filtra.
- **Dar de baja** un lote caducado directo desde la lista: abre el ajuste ya prellenado con todas
  sus unidades y el motivo "Producto caducado".
- Exportación a CSV. Incluye los lotes en cuarentena.

**Alertas automáticas**
- Se calculan a partir del estado real y se **concilian** con las activas: una condición nueva
  crea su alerta, una que sigue vigente sólo actualiza su texto (no vuelve a marcarse como no
  leída) y una que ya no aplica se cierra sola.
  - Agotado (urgente) y stock bajo, en productos activos con mínimo definido.
  - Lote caducado con existencia (urgente) y lote en ventana crítica.
  - Pago a proveedor por vencer (3 días antes) y vencido (urgente).
  - Pedido sin recibir después de 7 días.
  - Productos devueltos esperando revisión.
- La base de datos no permite dos alertas activas de la misma condición en una sucursal, y las
  revisiones simultáneas se serializan. Revisión periódica cada 10 minutos y, además, en cuanto
  una venta, compra, ajuste o devolución cambia los datos.

**Campana y centro de notificaciones** (`/notificaciones`)
- Contador de no leídas (rojo si hay urgentes), panel con las más importantes primero y clic que
  lleva a la pantalla del problema (ficha del producto, compra o devoluciones).
- Página con filtros por tipo, "sólo sin leer" y "marcar todo como leído". Lo leído es por usuario.
- **Cada quien ve sólo lo que le corresponde:** la cajera ve agotados y stock bajo; los pagos a
  proveedores sólo quien puede pagarlos; las caducidades quien las administra.

**Verificación**
- `npm run typecheck`: sin errores.
- `npm test`: 191 pruebas de API (6 nuevas: detección, conciliación, cierre, duplicados con
  revisiones simultáneas, visibilidad por rol, leídas por usuario y caducidades) y 64 de frontend (4 nuevas).
- Navegador real: campana con 16 alertas, clic que abre la ficha del lote caducado, centro de
  notificaciones, baja del lote caducado que cierra su alerta, cajera sólo con alertas de
  existencias y sin caducidades, aviso de devoluciones al farmacéutico y vista móvil. Sin errores en la consola.

## Fase 6: entregado

**Punto de venta** (`/ventas/punto-de-venta`)
- **Lector USB** (código + Enter), búsqueda por nombre sin acentos y **escáner con la cámara** del
  celular, tablet o webcam (la imagen se procesa en el navegador; no se guarda ni se envía). La
  librería de la cámara se descarga sólo al abrir el escáner.
- Carrito con cantidades limitadas a la existencia disponible, aviso de productos sin existencia,
  descuentos por partida (sólo con permiso) y total con IVA desglosado.
- Cobro en **efectivo** (con billetes rápidos y cambio), **tarjeta**, **transferencia** o **mixto**.
- Productos con receta: la venta no se cobra hasta confirmar "Revisé la receta médica".
- Atajos: `F2` buscar, `F9` cobrar. El carrito sobrevive a una recarga accidental de la página.
- **Ticket** para impresora térmica de 80 mm con los datos de la farmacia, folio, cajero, productos,
  IVA, forma de pago y cambio.

**Reglas del cobro (en el servidor)**
- Precios, IVA y totales salen del catálogo: el navegador no puede fijar un precio. Si un precio
  cambió mientras se capturaba la venta, el cobro se rechaza y el carrito se actualiza.
- Cada partida se surte con **FEFO** y cada lote usado deja su movimiento "Venta"; todo en una
  transacción con los lotes bloqueados. Dos ventas simultáneas no venden más de lo que hay.
- **No se cobra dos veces:** cada cobro lleva un identificador; un doble clic o un reintento por
  falla de red devuelve la misma venta.
- Los pagos deben sumar exactamente el total; sólo el efectivo da cambio.
- Nunca se venden lotes caducados, en cuarentena ni productos inactivos.

**Historial y corte** (`/ventas/historial`)
- Corte del día (o del periodo): número de ventas, total, ticket promedio, devoluciones, desglose
  por forma de pago y el efectivo que debe haber en caja.
- Sin permiso de reportes, cada quien ve sus propias ventas (su corte); un folio exacto se puede
  buscar en toda la sucursal para hacer una devolución.
- Detalle con los lotes de los que salió cada producto, pagos, devoluciones y reimpresión del ticket.
  El costo y la utilidad sólo los ve quien puede ver costos.

**Cancelación y devoluciones** (`/ventas/devoluciones`)
- **Cancelar** (permiso sensible) regresa las unidades a los mismos lotes de los que salieron.
- **Devolución** parcial o total con motivo y forma de reembolso. El reembolso es proporcional a lo
  cobrado (incluye el descuento) y la suma de devoluciones nunca pasa de lo cobrado.
- Lo devuelto queda **en revisión**: no se vuelve a vender hasta que alguien con permiso de
  inventario lo revisa y decide regresarlo al lote o desecharlo. Un lote caducado sólo se desecha.
- El cajero consulta ventas y devoluciones pero no cancela ni devuelve.
- Todo queda en auditoría: venta (con los productos con receta), cancelación, devolución y revisión.

**Datos de demostración:** 50 ventas de los últimos 30 días (4 de hoy) a nombre de la cajera, el
farmacéutico y el propietario, surtidas con FEFO en orden cronológico, con 2 cancelaciones y 2
devoluciones (una en revisión). Se conservan los casos de inventario de la Fase 4 (lote caducado y
productos con stock bajo). La carga inicial de demostración ahora queda fechada cuando llegó cada lote.

**Verificación**
- `npm run typecheck`: sin errores.
- `npm test`: 185 pruebas de API (15 nuevas: FEFO, caducados, precio del servidor, pagos, descuentos,
  receta, reintentos, ventas simultáneas, cancelación, devoluciones y revisión) y 60 de frontend (7 nuevas).
- En una base nueva con los datos de demostración, el historial de cada lote cuadra: 0 saltos en 160 movimientos.
- Navegador real: venta con lector y búsqueda, cambio, ticket impreso, producto con receta, límite
  de existencia, escáner sin cámara con mensaje claro, corte de la cajera, devolución y revisión por
  el farmacéutico, cancelación por el propietario, FEFO y vista móvil. Sin errores en la consola.

## Fase 5: entregado

**Proveedores** (`/compras/proveedores`)
- Alta y edición con nombre comercial, razón social, RFC (validado y único), contacto, teléfono,
  correo, días de crédito y condiciones de pago.
- Lista con número de compras, fecha de la última y **saldo por pagar** de cada proveedor.
- No se eliminan: se desactivan (su historial se conserva) y un proveedor desactivado no admite compras nuevas.

**Compras** (`/compras/nueva`, `/compras/historial`)
- Captura de la factura: proveedor, folio de factura, fecha, forma de pago y productos con lote,
  caducidad, cantidad, costo unitario sin IVA y descuento. Subtotal, IVA y total se calculan en vivo
  y **el servidor los recalcula** (los importes que manda el navegador se ignoran).
- **Lector de código de barras:** al escanear se agrega el producto y el cursor pasa a su lote.
- Avisos al capturar: lote que caduca en menos de 30 días y costo que iguala o supera el precio de venta.
- **Dos formas de registrar:**
  - *Guardar y recibir mercancía* (la factura llegó con la mercancía): ingresa los lotes al inventario.
  - *Guardar como pendiente* (un pedido): el lote y la caducidad se capturan cuando llega.
- **Recibir** usa el mismo núcleo de inventario de la Fase 4 (bloqueo por lote, movimiento
  "Entrada por compra" ligado a la compra) y actualiza el **último costo** de cada producto.
  Si una partida falla (por ejemplo, un lote que ya existe con otra caducidad), no se ingresa
  nada y el error se marca en su renglón.
- **Pagos:** de contado queda pagada al recibir; a crédito vence según los días del proveedor.
  Pagos parciales con forma de pago y referencia, sin exceder el saldo. Compras vencidas resaltadas.
- **Cancelar:** un pedido se cancela sin tocar el inventario; una compra recibida retira lo que
  ingresó, sólo si esas unidades siguen en sus lotes. No se cancela una compra con pagos.
- Historial con resumen (por recibir, saldo por pagar, vencidas, recibido en el mes), búsqueda por
  folio, factura o proveedor y filtros por estado y pago. En Movimientos, cada entrada por compra
  enlaza a su compra.

**Reglas de seguridad e integridad**
- Recibir, pagar y cancelar bloquean la compra (`FOR UPDATE`): dos recepciones simultáneas ingresan
  la mercancía una sola vez. Se verificó: sin el bloqueo, la prueba falla.
- En la base de datos: no se paga más que el total y una partida recibida siempre tiene lote y caducidad.
- La factura no se puede registrar dos veces para el mismo proveedor.
- Permisos separados: registrar compras, recibir mercancía, pagar a proveedores y cancelar. El
  almacenista recibe pero no paga (la compra de contado queda "Por pagar" para quien administra).
  El farmacéutico consulta; el cajero no ve compras.
- Todo queda en auditoría: alta, edición, recepción (con los cambios de costo), pagos, cancelación
  con su motivo y los cambios de proveedores.
- **"Hoy" lo define el servidor** con la zona horaria de la farmacia (`GET /settings/clock`): un
  equipo con la hora o la zona mal configurada no puede registrar fechas "futuras" ni rechazar las válidas.

**Datos de demostración:** 10 proveedores ficticios (RFC con prefijo `DMO`) y 20 compras: recibidas de
contado y a crédito, una vencida, una con pago parcial, pedidos pendientes y una cancelada.

**Verificación**
- `npm run typecheck`: sin errores.
- `npm test`: 170 pruebas de API (16 nuevas, incluida la de concurrencia) y 53 de frontend (6 nuevas).
- Navegador real: resumen y filtro de vencidas, compra con búsqueda y lector, aviso de caducidad
  próxima, recepción con lotes en inventario, pedido pendiente completado y recibido, pago parcial,
  cancelación, alta y desactivación de proveedor, almacenista sin pagos, farmacéutico en consulta,
  cajero sin acceso y vista móvil. Sin errores en la consola.

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
