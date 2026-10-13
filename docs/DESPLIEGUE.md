# Guía de despliegue

Cómo instalar el sistema para uso real, publicarlo con HTTPS, respaldarlo cada día y
actualizarlo. Todo lo de esta guía se probó con Docker: instalación limpia, ventas, reportes,
exportación, HTTPS con Caddy, respaldo y restauración.

> Para probarlo en tu computadora con Node (modo desarrollo) ver el [README](../README.md).

## 1. Elige dónde instalarlo

| Opción | Cuándo conviene | HTTPS |
|---|---|---|
| **A. Un equipo en la farmacia** (Windows o Linux con Docker) | Una sucursal; las cajas y equipos están en la misma red | Recomendado con dominio (sección 4); en una red privada de confianza puede usarse HTTP |
| **B. Servidor en internet** (VPS Linux, p. ej. Ubuntu) | Varias sucursales, acceso desde fuera o no quieres depender de un equipo local | Obligatorio (sección 4) |

Requisitos mínimos: 2 GB de RAM, 10 GB libres, Docker (Docker Desktop en Windows o Docker Engine
24+ en Linux) y Git.

## 2. Instalación

```bash
git clone <url-del-repositorio> farmacia
cd farmacia
cp .env.example .env
```

Edita `.env` y completa **al menos**:

| Variable | Valor |
|---|---|
| `POSTGRES_PASSWORD` | Contraseña larga y aleatoria para la base de datos |
| `JWT_ACCESS_SECRET` | Secreto aleatorio de 64 caracteres: `openssl rand -hex 32` |
| `APP_URL` | Dirección con la que se abrirá el sistema, p. ej. `http://192.168.1.50:8080` o `https://farmacia.midominio.com` |
| `SEED_OWNER_EMAIL` | Correo del propietario |
| `SEED_OWNER_PASSWORD` | Su contraseña inicial (10+ caracteres con letras y números) |

> En Windows, `openssl` viene con Git: abre **Git Bash** y ejecuta `openssl rand -hex 32` dos
> veces (una para cada secreto).

Arranca y crea el propietario:

```bash
docker compose up -d --build
docker compose exec api node dist/seed.js     # sólo la primera vez
```

Abre `APP_URL` en el navegador y entra con el correo y la contraseña del propietario.

- **No cargues los datos de demostración en producción** (`db:seed:demo` es sólo para pruebas).
- La API aplica las migraciones al arrancar y la base de datos no se publica fuera de Docker.
- Configura el **correo** (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`) para que funcione
  "¿Olvidaste tu contraseña?". Sin correo, un administrador restablece contraseñas desde
  **Usuarios**, pero **nadie más puede restablecer la del propietario**: guárdala en un lugar seguro.

### Equipo en la farmacia (opción A) sin dominio

- Da al equipo una **IP fija** en el router y usa `APP_URL=http://IP:8080`.
- Las cookies de sesión exigen HTTPS. Para usar HTTP **sólo dentro de una red privada de
  confianza** agrega `COOKIE_SECURE=false`. En cuanto el sistema deba usarse desde fuera de la
  farmacia, usa un dominio con HTTPS (sección 4).
- En Windows, configura Docker Desktop para **iniciar con Windows** y evita que el equipo se
  suspenda.

## 3. Primeros pasos dentro del sistema

1. **Configuración:** datos de la farmacia y fiscales (salen en el ticket), margen predeterminado,
   IVA y días de alerta de caducidad.
2. **Usuarios:** crea a cada empleado con su rol (cada quien su propia cuenta).
3. **Inventario → Productos:** categorías, laboratorios y productos.
4. **Compras** o **Registrar entrada:** existencias iniciales con lote y caducidad.

## 4. HTTPS con dominio propio

El archivo `docker-compose.yml` incluye **Caddy**, que obtiene y renueva solo el certificado de
Let's Encrypt.

1. Compra o usa un dominio y crea un registro **A** (p. ej. `farmacia.midominio.com`) que apunte a
   la IP pública del servidor.
2. Abre los puertos **80 y 443** en el firewall (y en el router, si el servidor está en la farmacia).
3. En `.env`:
   ```ini
   DOMAIN=farmacia.midominio.com
   APP_URL=https://farmacia.midominio.com
   WEB_PORT=127.0.0.1:8080    # el puerto sin cifrar queda sólo dentro del servidor
   ```
4. Arranca con el perfil `https`:
   ```bash
   docker compose --profile https up -d --build
   ```

Comprobado en pruebas: HTTP/2, redirección automática de `http://` a `https://`, cabecera HSTS y
la IP real de cada usuario en la auditoría (Caddy envía la API directo, sin pasar por nginx).

## 5. Respaldos diarios

`scripts/backup.sh` respalda la base de datos (formato comprimido de PostgreSQL) y las imágenes de
los productos, **verifica** que el respaldo se pueda leer y borra los de más de
`BACKUP_RETENTION_DAYS` días (30 por omisión). Los archivos quedan en `backups/` con permisos sólo
para el dueño del equipo.

```bash
./scripts/backup.sh --docker
# backups/farmacia_20261012_023000.dump
# backups/farmacia_20261012_023000_imagenes.tar.gz
```

### Programarlo

**Linux** (cron, todos los días a las 2:30 am):

```cron
30 2 * * * cd /ruta/farmacia && ./scripts/backup.sh --docker >> backups/backup.log 2>&1
```

**Windows** (Programador de tareas, con Git Bash):

1. *Programador de tareas → Crear tarea básica →* diaria, 2:30 am.
2. Acción *Iniciar un programa*:
   - Programa: `C:\Program Files\Git\bin\bash.exe`
   - Argumentos: `-lc "cd /c/ruta/farmacia && ./scripts/backup.sh --docker >> backups/backup.log 2>&1"`
3. Docker Desktop debe estar abierto a esa hora (la sesión de Windows iniciada).

### Guárdalos fuera del equipo

Un respaldo en el mismo disco no sirve si el disco falla o roban el equipo. Copia la carpeta
`backups/` **cada día** a otro lugar: un disco externo que se guarde fuera de la farmacia o una
nube. Los respaldos contienen datos de pacientes: **cífralos** antes de subirlos (p. ej. con
7-Zip y contraseña AES-256, o `gpg --symmetric`).

### Restaurar

```bash
./scripts/restore.sh --docker backups/farmacia_20261012_023000.dump
```

Pide escribir `RESTAURAR`, detiene la API, reemplaza la base de datos (y las imágenes, si el
archivo `_imagenes.tar.gz` está junto al `.dump`) y vuelve a iniciarla. Las reglas que protegen
la bitácora y los movimientos de inventario se restauran con la base.

**Prueba la restauración una vez al mes** en un equipo de pruebas: un respaldo que nunca se ha
restaurado no es un respaldo comprobado.

> Sin Docker (instalación con Node): `./scripts/backup.sh` y `./scripts/restore.sh <archivo>` usan
> `DATABASE_URL` del `.env` y requieren las herramientas de PostgreSQL (`pg_dump`, `pg_restore`).

## 6. Actualizar a una versión nueva

```bash
./scripts/backup.sh --docker                  # siempre antes de actualizar
git pull
docker compose up -d --build                  # (agrega --profile https si lo usas)
docker compose exec api node dist/seed.js     # registra permisos nuevos; no toca tus datos ni tus roles
```

Las migraciones de la base se aplican solas al arrancar la API.

## 7. Mantenimiento

| Qué | Cómo |
|---|---|
| Estado de los servicios | `docker compose ps` (la API debe decir `healthy`) |
| Registro de errores | `docker compose logs --tail 200 api` |
| Salud de la API | `https://tu-dominio/api/health` → `{"status":"ok"}` |
| Espacio en disco | Revisa que los respaldos no llenen el disco |
| Seguridad | **Auditoría → Sólo eventos de seguridad**, cada semana |
| Cerrar las sesiones de alguien (celular perdido, salida de un empleado) | **Usuarios → Cerrar sus sesiones**; si deja la farmacia, además **Desactivar** |

## 8. Lista de verificación antes de abrir

- [ ] `.env` con secretos propios (nunca los de ejemplo) y fuera de cualquier repositorio
- [ ] HTTPS activo (o, en red local, decisión consciente de usar HTTP)
- [ ] Sin datos de demostración; contraseña del propietario guardada en lugar seguro
- [ ] Correo configurado para recuperar contraseñas
- [ ] Respaldo diario programado **y** copia fuera del equipo
- [ ] Una restauración de prueba hecha
- [ ] Cada empleado con su propia cuenta y el rol mínimo que necesita
- [ ] Datos de la farmacia, IVA, margen y alertas revisados en **Configuración**

## 9. Solución de problemas

| Síntoma | Causa probable |
|---|---|
| El inicio de sesión "no hace nada" o regresa al formulario | Se entra por HTTP con `COOKIE_SECURE=true`: usa HTTPS o, sólo en red privada, `COOKIE_SECURE=false` |
| `port is already allocated` | Otro programa usa el puerto: cambia `WEB_PORT` en `.env` |
| Caddy no obtiene el certificado | El dominio no apunta a la IP del servidor o los puertos 80/443 están cerrados |
| "Demasiados intentos" | Protección contra ataques: espera 15 minutos |
| La API no queda `healthy` | `docker compose logs api`: casi siempre es `.env` incompleto (`POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET`) |
