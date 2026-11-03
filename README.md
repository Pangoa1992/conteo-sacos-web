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
| Exportación CSV (historial completo, inventario, reportes) | ✅ | ✅ (lo que puede ver) |

Los datos de prueba (`origen` que empieza por `prueba`) nunca se mezclan con los reales: el panel tiene vistas Reales / Prueba / Todos.

### Contar por foto → lote

1. `POST /api/contar-foto`: el servidor cuenta la foto con RF-DETR y devuelve el resultado y un **comprobante firmado** (HMAC derivado de `JWT_SECRET`) con el total, la confianza, la huella SHA-256 de la foto y el usuario; vence a los 30 minutos.
2. `POST /api/contar-foto/registrar`: el navegador reenvía la misma foto con el comprobante y el tipo de dato (real → origen `foto`, prueba → `prueba_foto`). El servidor verifica firma, vigencia, usuario y huella, y en una sola transacción crea el lote **pendiente de validación** (fuente `foto_celular`) y guarda la foto como su **evidencia**. No vuelve a consultar el modelo.
3. El total nunca lo envía el navegador. La misma foto no crea dos lotes (`id_externo = foto_` + huella): un reintento devuelve el lote existente; con otro tipo de dato, 409.

## Arquitectura

- **Next.js 15 (App Router) + React 19 + TypeScript**: páginas y API REST en el mismo proyecto.
- **PostgreSQL** con **Drizzle ORM**: 8 tablas, 12 claves foráneas, restricciones CHECK y 14 triggers (stock, ventas históricas congeladas, evidencias sin borrado). Migraciones en `db/migrations` (0000–0006).
- **Módulo de visión (Python)** → `POST /api/conteo` con token, idempotente por `id_externo`.
- **Roboflow Serverless** (RF-DETR) para Contar por foto, solo desde el servidor.
- **Twilio** (WhatsApp) mediante webhook firmado.

## Seguridad

- Sesión **JWT HS256** (7 días) en cookie `HttpOnly`, `SameSite=Lax` y `Secure` (única excepción: la demostración local por HTTP en red privada, que exige una variable y una base de demostración); sin `JWT_SECRET` (≥ 32 caracteres) no se emiten ni aceptan sesiones.
- Contraseñas con **bcrypt**; nunca en texto plano.
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
| `GET /api/conteo` (`?formato=csv`), `GET /api/conteo/resumen` | Historial e indicadores |
| `POST /api/conteo` | Registro de lotes desde el módulo de visión (token) |
| `PATCH/GET /api/conteo/:id/validacion` | Validación y su historial |
| `/api/conteo/:id/evidencias`, `/api/evidencias/:id/anular`, `/api/evidencias/:id/imagen` | Evidencias |
| `/api/reportes-contratista`, `/api/reportes-contratista/lotes` | Reportes del contratista |
| `GET /api/inventario`, `/api/ventas`, `/api/ventas/:id/anular` | Inventario y ventas |
| `GET/POST /api/contar-foto`, `POST /api/contar-foto/registrar` | Contar sacos por foto y registrar el lote |
| `POST /api/whatsapp/webhook`, `GET /api/whatsapp/estado` | WhatsApp |

## Estado del despliegue

- La versión descrita aquí funciona en **entorno local y de demostración** (rama `cierre/dashboard-macromec-fases-1-4`).
- La publicación en Vercel (`main`) corresponde a una **versión anterior con datos simulados** y solo las migraciones 0000–0001; desplegar esta versión requiere aplicar las migraciones 0002–0006 en la base de producción y configurar las variables nuevas.

## Limitaciones conocidas

- El conteo automático se ha probado con videos y fotografías grabados; la **exactitud frente a un conteo manual está pendiente de validación** y no hay cámara fija instalada en planta.
- WhatsApp está implementado y probado con simulaciones firmadas, pero el servicio de Twilio no está conectado.
- El modelo detecta una sola clase («Saco»); la calidad la clasifica una persona.
- `/api/dev/seed-usuarios` es solo para desarrollo (deshabilitado en producción y sin `DEV_SEED_SECRET`).
