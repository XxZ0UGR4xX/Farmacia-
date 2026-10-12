# Seguridad

Resumen de cómo protege el sistema el acceso, la información de pacientes y la integridad del
inventario. Cada control indica dónde vive y cómo se comprueba. La revisión de la Fase 10 se hizo
sobre el código y se automatizó en pruebas para que no se pierda con cambios futuros.

## 1. Acceso

| Control | Detalle |
|---|---|
| Contraseñas | Argon2id (`apps/api/src/lib/crypto.ts`). Mínimo 10 caracteres con letras y números (`packages/shared/src/password-policy.ts`). Nunca se guardan ni se registran en claro |
| Primer ingreso | Los usuarios de demostración y los creados por un administrador deben cambiar su contraseña al entrar |
| Bloqueo por intentos | 5 intentos fallidos bloquean la cuenta 15 minutos (`LOGIN_MAX_ATTEMPTS`, `LOGIN_LOCK_MINUTES`) |
| Límite de peticiones | Inicio de sesión: 10 por IP + correo y 50 por IP cada 15 min; recuperación de contraseña: 5 por hora; API general: 600 por minuto |
| Sesión | Token de acceso de 15 minutos **sólo en memoria** del navegador (no en `localStorage`). La renovación usa una cookie `httpOnly`, `SameSite=Strict` y `Secure` en producción, más un token CSRF de doble envío |
| Robo de sesión | Los tokens de renovación rotan en cada uso; si uno ya usado se vuelve a presentar, se revoca la sesión completa (también para quien lo robó) y se audita `AUTH_TOKEN_REUSE` |
| Recuperación | Enlace de un solo uso, con vigencia de 30 minutos, guardado como hash |

## 2. Permisos

- Control de acceso por **rol y permiso**, verificado **en el servidor** en cada ruta
  (`authorize(...)`); la interfaz sólo oculta lo que el usuario no puede usar.
- **Prueba automática** (`tests/integration/route-security.test.ts`): lee todas las rutas declaradas
  en el código (más de 100) y comprueba que ninguna responda sin sesión, salvo las públicas de
  autenticación. Un token falso o manipulado recibe 401.
- Anti-escalamiento: nadie puede otorgar un rol con permisos que él mismo no tiene; sólo el
  propietario administra roles.
- Sucursales: la cabecera `X-Branch-Id` se valida contra las sucursales asignadas al usuario.
- Datos financieros (costos, utilidad, compras en reportes) sólo con `reports.financial`: sin ese
  permiso esos campos no salen del servidor, ni en pantalla ni en archivos exportados.
- Cada acceso negado queda en la auditoría (`ACCESS_DENIED`, con el permiso que faltó).

## 3. Información de pacientes

- El sistema es **herramienta administrativa y de registro**: no sugiere, calcula ni determina
  tratamientos (aviso visible en pacientes y recetas).
- Listados con datos mínimos y teléfono enmascarado; cada consulta de un expediente o receta queda
  auditada (`PATIENT_VIEW`, `PRESCRIPTION_VIEW`).
- La auditoría guarda *qué campos* cambiaron de un paciente, no sus valores; nunca nombres ni
  medicamentos.
- El registro del servidor no guarda lo que se busca en pacientes y recetas.
- Los datos de demostración son **ficticios** (`@paciente-demo.local`, teléfonos `55 0000…`).

## 4. Integridad

| Qué | Cómo |
|---|---|
| Movimientos de inventario | Inmutables: la base de datos rechaza `UPDATE`, `DELETE` y `TRUNCATE` (triggers). Toda existencia cambia por movimientos, con `quantity_after = before + change` verificado por `CHECK` |
| Auditoría | Inmutable con los mismos triggers. La interfaz de auditoría es de sólo lectura y exportarla también queda registrado (`AUDIT_EXPORT`) |
| Recetas | Inmutables; sólo se anulan con motivo (`prescriptions.void`) y no si ya surtieron una venta |
| Concurrencia | Lotes, ventas y compras se bloquean (`SELECT … FOR UPDATE`) al vender, recibir, pagar, cancelar o devolver: dos cajas no venden la misma unidad |
| Totales | El servidor calcula precios, IVA y totales; la base de datos verifica `total = subtotal + IVA` |
| Configuración | Cada cambio queda auditado con el valor anterior y el nuevo |

## 5. Entradas y salidas

- Toda entrada se valida con Zod (tipos, longitudes, formatos, rangos). Las consultas SQL usan
  parámetros (Prisma); no existe SQL armado con texto del usuario.
- Imágenes de productos: sólo JPEG, PNG o WebP; se vuelven a codificar con `sharp` (descarta datos
  ocultos y archivos que no son imágenes) con límite de tamaño y de píxeles.
- **CSV:** un texto que empieza con `= + - @` se antepone con `'` para que Excel no lo ejecute.
- **Excel (.xlsx):** el generador propio escribe todo texto como texto en línea: nunca como fórmula.
- Errores: el cliente recibe un mensaje y un código, nunca la traza interna ni rutas del servidor.

## 6. Servidor y navegador

- API: Helmet con CSP `default-src 'none'`, sin `X-Powered-By`, CORS sólo para los orígenes
  configurados, `trust proxy` explícito.
- Web (nginx): CSP estricta (sólo recursos propios), `X-Frame-Options: DENY`, `nosniff`,
  `Referrer-Policy`, `Permissions-Policy` (cámara sólo para el lector de códigos).
- Producción sin mapas de código fuente (`build.sourcemap: false`) y nginx rechaza cualquier `.map`.
- Secretos sólo en variables de entorno, validadas al arrancar (el secreto JWT debe tener al menos
  32 caracteres). El repositorio sólo contiene `.env.example` con valores de ejemplo.

## 7. Dependencias

- `npm audit --omit=dev`: **0 vulnerabilidades** en lo que corre en producción.
  - El CLI de Prisma traía `mysql2` y `deepmerge-ts` con avisos; se fijaron versiones corregidas
    con `overrides` en `package.json` (`mysql2` 3.24.4, `deepmerge-ts` 8.0.2). El sistema usa
    PostgreSQL, así que `mysql2` ni siquiera se carga.
- Herramientas de desarrollo: queda un aviso **bajo** de `esbuild` (lectura de archivos con *su*
  servidor de desarrollo en Windows). El proyecto no usa ese servidor: `tsup` sólo compila y Vite
  usa su propio servidor. Se actualizará cuando `tsup` admita la versión corregida.

## 8. Operación (ver guía de despliegue)

- Publicar sólo con **HTTPS** (`COOKIE_SECURE=true`).
- Respaldos diarios cifrados de la base de datos, con prueba de restauración.
- Cambiar las contraseñas de demostración (el sistema lo exige) o no cargar datos de demostración
  en producción.
- Revisar en **Auditoría → Sólo eventos de seguridad** los intentos fallidos, bloqueos y accesos
  negados.
