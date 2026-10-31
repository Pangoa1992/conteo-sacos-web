# conteo-sacos-web

Módulo web (backend + frontend) del Sistema de Conteo de Sacos — MACROMEC.

## 🌐 Demo en vivo

**https://conteo-sacos-web.vercel.app**

Las credenciales de acceso se entregan de forma privada (no se publican en el repositorio).
Roles: `admin_macromec` (personal MACROMEC: ve todo, incluido contratistas y ventas) y
`cliente` (dueño de la fábrica: solo ve el conteo y su historial).

## Estado actual

✅ **Funcionando en producción**, conectado a una base de datos real (PostgreSQL en Neon):
- Login con autenticación JWT y roles diferenciados (personal MACROMEC vs. dueño de fábrica).
- Dashboard (`/`) con el conteo más reciente, historial de registros reales, y alertas visuales cuando hay discrepancia entre el conteo automático y el reporte del contratista.
- Módulo de venta (visible solo para personal MACROMEC): registra ventas a partir de un conteo y calcula el total automáticamente.
- `GET /api/conteo` — historial de conteos, con el reporte del contratista y si hay discrepancia.
- `POST /api/conteo` — usado por el módulo de Python (`conteo-sacos-vision`) para enviar resultados; ya probado end-to-end.
- `GET/POST /api/ventas` — listar y registrar ventas (requiere rol admin_macromec).
- `POST /api/reportes-contratista` — registra lo que el contratista dice haber armado, para comparar contra el conteo automático.

🔧 **Ampliación local, aún no desplegada (etapa 3B, migraciones 0005-0006)** — ventas parciales:
- `GET /api/ventas` — ventas parciales, stock por lote aprobado y, aparte, las ventas históricas (anteriores al control de validación, de solo lectura).
- `POST /api/ventas` — `{ conteoId, cantidadSacos, precioUnitario, comprador?, claveIdempotencia }`: vende sacos conformes de un lote aprobado; el importe lo calcula el servidor. La misma `claveIdempotencia` (UUID por operación) no crea una segunda venta.
- `PATCH /api/ventas/:id/anular` — `{ motivo }`: anula la venta y los sacos vuelven al stock.
- Todas requieren rol admin_macromec. Sustituyen al contrato anterior de `POST /api/ventas` (`{ conteoId, precioPorSaco }`, lote completo).

⚠️ El **número de sacos** que se muestra todavía es simulado (aleatorio), porque el modelo de detección real (YOLOv8) está pendiente de fotos/video reales de la fábrica para poder entrenarse/adaptarse.

## Cómo correrlo localmente

```bash
npm install
npm run dev
```

Abrir http://localhost:3000

## Configurar base de datos (PostgreSQL)

1. Copiar `.env.example` a `.env.local` y completar todas las variables obligatorias
   (`DATABASE_URL`, `JWT_SECRET`, `VISION_API_TOKEN`; `TWILIO_AUTH_TOKEN` y `WHATSAPP_NUMEROS_AUTORIZADOS` para WhatsApp).
   Para desarrollo local se puede levantar PostgreSQL en el puerto 5433 con
   `docker compose --env-file .env.local up -d` (ver `docker-compose.yml`).
2. Aplicar las migraciones (`drizzle-kit` no lee `.env.local`, hay que exportar `DATABASE_URL`):
```bash
   npm run db:migrate
```
3. Crear los usuarios de desarrollo (definidos en `DEV_*_CORREO` / `DEV_*_PASSWORD`),
   solo en local:
```bash
   curl -X POST http://localhost:3000/api/dev/seed-usuarios -H "X-Dev-Seed-Secret: $DEV_SEED_SECRET"
```

## Consultas por WhatsApp

El webhook `POST /api/whatsapp/webhook` (Twilio) exige la firma `X-Twilio-Signature` y solo responde a los números de
`WHATSAPP_NUMEROS_AUTORIZADOS` (formato internacional, separados por comas). Si la lista está vacía, nadie recibe datos.
Comandos (sin importar mayúsculas ni tildes): `ayuda`, `último`, `hoy`, `semana`, `discrepancias`, `lote 123`.
Solo informa datos reales (nunca de prueba) y nunca ventas ni inventario. Los números se registran enmascarados.

Modo DEMO (solo para la demostración local): responde con los lotes de prueba de `conteo_sacos_demo`, cada respuesta
marcada «🧪 DEMO · datos de prueba». Se activa únicamente con una variable que pone el script de la demostración
(nunca en `.env.local`, `.env.example` ni Vercel), con la BD local `conteo_sacos_demo` marcada como demostración y sin
ningún lote real; si falta cualquier condición, responde como siempre. Ver `lib/modo-demo-whatsapp.ts`.

El panel del administrador muestra el estado de la integración (`GET /api/whatsapp/estado`, solo administrador): webhook
habilitado, tipo de URL pública, cantidad de números autorizados, si hay conteos reales y si está en modo DEMO. Nunca
muestra el token, los números, la URL pública ni datos de la conexión.

## Despliegue

Publicado en **Vercel**, conectado directamente al repositorio de GitHub — cada `git push` a `main` genera un nuevo despliegue automático.

## Pendiente

- [x] Validar `VISION_API_TOKEN` en `POST /api/conteo` (obligatorio; sin él responde 503)
- [ ] Reemplazar `/api/dev/seed-usuarios` por un panel real de gestión de usuarios (o eliminarlo) antes de usar el sistema con datos reales
- [ ] Reemplazar detección simulada por modelo YOLOv8 real (`conteo-sacos-vision`)
- [ ] Chatbot de WhatsApp para consultas remotas (Fase 2 — bloqueado hasta tener acceso a WhatsApp Business API)
- [ ] Gráficos de tendencia histórica (Fase 3)