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

⚠️ El **número de sacos** que se muestra todavía es simulado (aleatorio), porque el modelo de detección real (YOLOv8) está pendiente de fotos/video reales de la fábrica para poder entrenarse/adaptarse.

## Cómo correrlo localmente

```bash
npm install
npm run dev
```

Abrir http://localhost:3000

## Configurar base de datos (PostgreSQL)

1. Copiar `.env.example` a `.env.local` y completar todas las variables obligatorias
   (`DATABASE_URL`, `JWT_SECRET`, `VISION_API_TOKEN`; `TWILIO_AUTH_TOKEN` para WhatsApp).
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

## Despliegue

Publicado en **Vercel**, conectado directamente al repositorio de GitHub — cada `git push` a `main` genera un nuevo despliegue automático.

## Pendiente

- [x] Validar `VISION_API_TOKEN` en `POST /api/conteo` (obligatorio; sin él responde 503)
- [ ] Reemplazar `/api/dev/seed-usuarios` por un panel real de gestión de usuarios (o eliminarlo) antes de usar el sistema con datos reales
- [ ] Reemplazar detección simulada por modelo YOLOv8 real (`conteo-sacos-vision`)
- [ ] Chatbot de WhatsApp para consultas remotas (Fase 2 — bloqueado hasta tener acceso a WhatsApp Business API)
- [ ] Gráficos de tendencia histórica (Fase 3)