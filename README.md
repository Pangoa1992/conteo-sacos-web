# conteo-sacos-web

Módulo web (backend + frontend) del Sistema de Conteo de Sacos — MACROMEC.

## 🌐 Demo en vivo

**https://conteo-sacos-web.vercel.app**

Cuentas de prueba:
- `admin@macromec.com` / `macromec2026` — Personal MACROMEC (ve todo, incluido el módulo de venta)
- `dueno@fabrica.com` / `fabrica2026` — Dueño de la fábrica (solo ve el conteo y su historial)

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

1. Copiar `.env.example` a `.env.local` y completar `DATABASE_URL` (usamos Neon, gratis).
2. Generar y aplicar las migraciones:
```bash
   npm run db:generate
   npm run db:migrate
```
3. Crear los usuarios de prueba visitando `http://localhost:3000/api/dev/seed-usuarios`.

## Despliegue

Publicado en **Vercel**, conectado directamente al repositorio de GitHub — cada `git push` a `main` genera un nuevo despliegue automático.

## Pendiente

- [ ] Validar `VISION_API_TOKEN` en `POST /api/conteo` (por ahora cualquiera podría enviar conteos falsos)
- [ ] Reemplazar `/api/dev/seed-usuarios` por un panel real de gestión de usuarios (o eliminarlo) antes de usar el sistema con datos reales
- [ ] Reemplazar detección simulada por modelo YOLOv8 real (`conteo-sacos-vision`)
- [ ] Chatbot de WhatsApp para consultas remotas (Fase 2 — bloqueado hasta tener acceso a WhatsApp Business API)
- [ ] Gráficos de tendencia histórica (Fase 3)