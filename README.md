# conteo-sacos-web

Plataforma web del **Sistema de Conteo de Sacos mediante Visión Computacional** (MACROMEC J&S S.A.C.): recibe los lotes que cuenta el módulo de visión, los compara con el reporte del contratista y permite validarlos, documentarlos con evidencias fotográficas y llevar el inventario y las ventas de sacos conformes.

Proyecto de innovación SENATI. El módulo de visión (RF-DETR + DeepSORT) está en el repositorio `contador-sacos`.

## Módulos

| Módulo | Personal MACROMEC (`admin_macromec`) | Cliente (`cliente`) |
|---|---|---|
| Resumen, producción validada, producción diaria, cámaras, historial | ✅ | ✅ |
| Validación de lotes y clasificación manual (conformes / observados / defectuosos) | registra | consulta |
| Evidencias fotográficas desde el celular | sube y anula | ve las activas |
| Reportes del contratista y discrepancias (\|diferencia\| > 1 saco) | registra | consulta |
| Inventario de sacos conformes, ventas parciales, estado de WhatsApp | ✅ | — |
| Contar sacos por foto (RF-DETR) y registrar el resultado como lote | ✅ | — |
| Contar sacos en un video desde el panel (sin terminal) y registrar el resultado como lote | ✅ | — |
| Exportación CSV (historial completo, inventario, reportes) | ✅ | ✅ (lo que puede ver) |
| Usuarios: alta de cuentas, nombre y rol, contraseña nueva, desactivar / activar | ✅ | — |
| Mi cuenta: cambiar la contraseña propia (pide la actual) | ✅ | ✅ |

Los datos de prueba (`origen` que empieza por `prueba`) nunca se mezclan con los reales: el panel tiene vistas Reales / Prueba / Todos.

### Usuarios

- Solo el personal de MACROMEC crea cuentas, cambia nombre y rol, asigna una contraseña nueva a quien la olvidó y **desactiva** cuentas (no se borran: sus registros se conservan).
- Nadie puede desactivarse ni cambiarse el rol a sí mismo, y **siempre queda al menos un administrador activo** (se comprueba con bloqueo de filas en la transacción, sin carreras).
- Desactivar, cambiar el rol o cambiar la contraseña **cierra de inmediato** las sesiones abiertas de esa cuenta (`usuarios.sesion_version`, incluida en el JWT y comprobada en cada petición). Al cambiar la propia contraseña, la sesión actual sigue abierta y las demás se cierran.
- Contraseñas: mínimo 10 caracteres, máximo 72 bytes (límite de bcrypt), sin espacios al inicio o al final, no repetitivas, distintas del correo y de las contraseñas que fueron públicas. Correos sin distinguir mayúsculas.

### Contar por foto → lote

1. `POST /api/contar-foto`: el servidor cuenta la foto con RF-DETR y devuelve el resultado y un **comprobante firmado** (HMAC derivado de `JWT_SECRET`) con el total, la confianza, la huella SHA-256 de la foto y el usuario; vence a los 30 minutos.
2. `POST /api/contar-foto/registrar`: el navegador reenvía la misma foto con el comprobante y el tipo de dato (real → origen `foto`, prueba → `prueba_foto`). El servidor verifica firma, vigencia, usuario y huella, y en una sola transacción crea el lote **pendiente de validación** (fuente `foto_celular`) y guarda la foto como su **evidencia**. No vuelve a consultar el modelo.
3. El total nunca lo envía el navegador. La misma foto no crea dos lotes (`id_externo = foto_` + huella): un reintento devuelve el lote existente; con otro tipo de dato, 409.

### Contar por video → lote

1. El video **no se sube**: el navegador lo abre localmente, toma un fotograma cada 1/6 s (como el detector: 1 de cada 5 a 30 fps; hasta 120 s por análisis = 721 consultas) y envía cada uno, reducido a 1280 px, a `POST /api/contar-video/fotograma`, con 3 en paralelo. El servidor detecta los sacos con el mismo RF-DETR y devuelve las cajas con una **firma** (HMAC derivado de `JWT_SECRET`) que las ata a la sesión de análisis, al número de fotograma, a la huella del fotograma y al usuario.
2. `lib/conteo-video.ts` (código compartido) sigue cada saco y cuenta los que cruzan la línea en la dirección elegida, con las reglas del detector Python: inferencia cada 5 fotogramas, detecciones de al menos el 14 % del alto, confirmación tras 3 detecciones, cruce medido solo con cajas detectadas y conteo diferido del saco que cruza siendo tentativo. En lugar del descriptor de apariencia de DeepSORT estima el desplazamiento común de la toma (cámara o faja), con penalidad a los cambios bruscos, y empareja por IoU y cercanía. Además, un saco que vuelve a cruzar después de cruzar en sentido contrario no se cuenta de nuevo.
3. `POST /api/contar-video/registrar` recibe las firmas, la línea y la dirección, un fotograma como evidencia y el tipo de dato (origen `video` o `prueba_video`, fuente `video_panel`). Verifica todas las firmas, que no falten fotogramas ni estén desordenados y que la evidencia sea uno de ellos, **vuelve a contar en el servidor** y crea el lote pendiente con su evidencia en una transacción. La misma sesión no crea dos lotes.
4. Con las 73 detecciones reales grabadas del video de prueba (13 s), el seguimiento cuenta 9 sacos (inspección visual: unos 9; detector con DeepSORT: 8). Con el video real y Roboflow real (05/11/2026, 79 consultas, 15 s de análisis) el panel contó 8.

## Arquitectura

- **Next.js 15 (App Router) + React 19 + TypeScript**: páginas y API REST en el mismo proyecto.
- **PostgreSQL** con **Drizzle ORM**: 8 tablas, 12 claves foráneas, restricciones CHECK y 14 triggers (stock, ventas históricas congeladas, evidencias sin borrado). Migraciones en `db/migrations` (0000–0007).
- **Módulo de visión (Python)** → `POST /api/conteo` con token, idempotente por `id_externo`.
- **Roboflow Serverless** (RF-DETR) para Contar por foto y por video, solo desde el servidor.
- **Twilio** (WhatsApp) mediante webhook firmado.

## Seguridad

- Sesión **JWT HS256** (7 días) en cookie `HttpOnly`, `SameSite=Lax` y `Secure` (única excepción: la demostración local por HTTP en red privada, que exige una variable y una base de demostración); sin `JWT_SECRET` (≥ 32 caracteres) no se emiten ni aceptan sesiones.
- Contraseñas con **bcrypt**; nunca en texto plano ni en las respuestas de la API.
- Cada ruta de la API comprueba en la base que la cuenta siga **activa** y que la sesión no se haya revocado (`lib/sesion-servidor.ts`); el middleware solo verifica la firma del token. Una cuenta desactivada recibe 401 en la siguiente petición.
- **Permisos por rol comprobados en el servidor** en cada ruta de la API (401 sin sesión, 403 sin permiso), no solo ocultando botones.
- `POST /api/conteo` exige `VISION_API_TOKEN` (comparación en tiempo constante); sin token configurado responde 503.
- Webhook de WhatsApp: firma `X-Twilio-Signature` obligatoria y lista blanca de números; los números se registran enmascarados.
- Validación de entradas en servidor y en base de datos (CHECK y triggers); idempotencia en lotes y ventas.
- Fotos: solo JPEG ≤ 1,5 MB y ≤ 1600 px, re-codificadas sin metadatos (EXIF/GPS) y con huella SHA-256.
- CSV protegido contra inyección de fórmulas en Excel.
- Secretos solo en variables de entorno (`.env.local`, nunca en el repositorio); claves de servicios externos nunca llegan al navegador.
- Conexión a PostgreSQL con límites de tiempo (conexión 10 s, consulta 15 s, transacción abandonada 15 s): un fallo de la base devuelve un error en lugar de dejar la aplicación esperando.
- Los registros de errores de la base muestran solo el mensaje de PostgreSQL, nunca la consulta ni sus parámetros (`lib/errores-bd.ts`).
- Dependencias revisadas con `npm audit` (03/11/2026): quedan 2 avisos de `postcss`, incluido dentro de Next.js 15, que solo procesa el CSS propio del proyecto al compilar y no recibe datos de usuarios; su corrección exige Next.js 16 (riesgo aceptado y documentado).

## Requisitos

- Node.js 20 o superior (probado con 24), npm.
- PostgreSQL 16+ (local con Docker: `docker-compose.yml`, puerto 5433).

## Instalación local

```bash
npm install
cp .env.example .env.local        # completar las variables (ver comentarios del archivo)
docker compose --env-file .env.local up -d   # PostgreSQL local
# drizzle-kit no lee .env.local: exportar DATABASE_URL antes de migrar
npm run db:migrate
npm run dev                        # http://localhost:3000
```

Usuarios de desarrollo (solo local, definidos en `DEV_*` de `.env.local`):

```bash
curl -X POST http://localhost:3000/api/dev/seed-usuarios -H "X-Dev-Seed-Secret: $DEV_SEED_SECRET"
```

## Calidad

| Comando | Qué comprueba |
|---|---|
| `npm run typecheck` | Tipos de TypeScript en todo el proyecto |
| `npm run lint` | ESLint con las reglas oficiales de Next.js (React, hooks, TypeScript) |
| `npm test` | Pruebas unitarias (Vitest) de las reglas de negocio y de seguridad en `tests/` |
| `npm run verificar` | Las tres anteriores |

Las pruebas de integración (API con base de datos, interfaz en Chrome, capturas) se ejecutan con las herramientas de `D:\RESPALDOS_MACROMEC\herramientas_pruebas` sobre bases de datos de ensayo, y cada ejecución deja su evidencia con huellas SHA-256.

## API principal

| Ruta | Uso |
|---|---|
| `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` | Sesión |
| `POST /api/auth/cambiar-password` | Cambiar la contraseña propia |
| `GET/POST /api/usuarios`, `PATCH /api/usuarios/:id`, `POST /api/usuarios/:id/password` | Usuarios (solo administrador) |
| `GET /api/conteo` (`?formato=csv`), `GET /api/conteo/resumen` | Historial e indicadores |
| `POST /api/conteo` | Registro de lotes desde el módulo de visión (token) |
| `PATCH/GET /api/conteo/:id/validacion` | Validación y su historial |
| `/api/conteo/:id/evidencias`, `/api/evidencias/:id/anular`, `/api/evidencias/:id/imagen` | Evidencias |
| `/api/reportes-contratista`, `/api/reportes-contratista/lotes` | Reportes del contratista |
| `GET /api/inventario`, `/api/ventas`, `/api/ventas/:id/anular` | Inventario y ventas |
| `GET/POST /api/contar-foto`, `POST /api/contar-foto/registrar` | Contar sacos por foto y registrar el lote |
| `POST /api/contar-video/fotograma`, `POST /api/contar-video/registrar` | Contar sacos en un video y registrar el lote |
| `POST /api/whatsapp/webhook`, `GET /api/whatsapp/estado` | WhatsApp |

## Estado del despliegue

- Publicada en **Vercel** (rama `main`, https://conteo-sacos-web.vercel.app) con **Neon** (PostgreSQL 18) desde el 04/11/2026; la base de producción tiene aplicadas las migraciones 0000–0007. «Contar por video» se publicó el 05/11/2026.
- Desarrollo y demostración: servidor local con PostgreSQL en Docker y la base `conteo_sacos_demo` (scripts de `D:\RESPALDOS_MACROMEC\demo`).
- Pendiente para operar en planta: cámara fija, apuntar el detector a la API publicada (`MACROMEC_API_URL` y `VISION_API_TOKEN` de producción) y el webhook de Twilio a la URL de Vercel.

## Limitaciones conocidas

- El conteo automático se ha probado con videos y fotografías grabados; no hay cámara fija instalada en planta.
- Exactitud del conteo por foto frente a un conteo manual a ciegas (10 fotos, todos los sacos visibles): 84,9 % por foto, error absoluto medio 3,1 sacos, con tendencia a contar de menos los sacos del fondo. Esas fotos se usaron en el entrenamiento, así que es un límite superior: falta repetir la prueba con fotos nuevas.
- WhatsApp se probó con el Sandbox real de Twilio (04/11/2026, modo DEMO, firma verificada). WhatsApp puede enviar un identificador privado (`whatsapp:PE.…`) en lugar del teléfono: en ese caso se autoriza ese identificador en `WHATSAPP_NUMEROS_AUTORIZADOS`. El Sandbox exige reenviar `join <código>` cada 72 horas; para uso continuo hace falta un remitente de WhatsApp aprobado.
- El modelo detecta una sola clase («Saco»); la calidad la clasifica una persona.
- Contar por video consume una consulta al modelo por cada fotograma analizado (6 por segundo de video) y depende de que el navegador pueda decodificar el archivo (MP4 H.264 o WebM). Su seguimiento no usa descriptor de apariencia: en tomas con giros de cámara puede contar de más o de menos (en el video de prueba, un posible conteo falso durante el giro de regreso).
- `/api/dev/seed-usuarios` es solo para desarrollo (deshabilitado en producción y sin `DEV_SEED_SECRET`).
