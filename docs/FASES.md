# Plan de desarrollo por fases

Cada fase termina con: compilación sin errores, pruebas en verde, revisión de errores y
verificación de que lo anterior sigue funcionando. No se avanza con errores críticos.

| Fase | Alcance | Estado |
|---|---|---|
| 1 | Arquitectura + base de datos + autenticación | ✅ Completa |
| 2 | Usuarios + roles + permisos (administración desde la UI) | ✅ Completa |
| 3 | Productos + categorías + laboratorios | ✅ Completa |
| 4 | Lotes + inventario + movimientos | ⏳ Siguiente |
| 5 | Proveedores + compras | Pendiente |
| 6 | Punto de venta + ventas + devoluciones | Pendiente |
| 7 | Caducidades + alertas + notificaciones | Pendiente |
| 8 | Pacientes + recetas | Pendiente |
| 9 | Reportes + dashboard (gráficas, exportación PDF/Excel/CSV) | Pendiente |
| 10 | Auditoría (UI) + configuración + seguridad + optimización | Pendiente |
| 11 | Pruebas + documentación + despliegue | Pendiente |

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
- Existencias por sucursal calculadas desde los lotes disponibles (se alimentan en la Fase 4).

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
