# Plan de desarrollo por fases

Cada fase termina con: compilación sin errores, pruebas en verde, revisión de errores y
verificación de que lo anterior sigue funcionando. No se avanza con errores críticos.

| Fase | Alcance | Estado |
|---|---|---|
| 1 | Arquitectura + base de datos + autenticación | ✅ Completa |
| 2 | Usuarios + roles + permisos (administración desde la UI) | ⏳ Siguiente |
| 3 | Productos + categorías + laboratorios | Pendiente |
| 4 | Lotes + inventario + movimientos | Pendiente |
| 5 | Proveedores + compras | Pendiente |
| 6 | Punto de venta + ventas + devoluciones | Pendiente |
| 7 | Caducidades + alertas + notificaciones | Pendiente |
| 8 | Pacientes + recetas | Pendiente |
| 9 | Reportes + dashboard (gráficas, exportación PDF/Excel/CSV) | Pendiente |
| 10 | Auditoría (UI) + configuración + seguridad + optimización | Pendiente |
| 11 | Pruebas + documentación + despliegue | Pendiente |

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
