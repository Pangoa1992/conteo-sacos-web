# conteo-sacos-web

Módulo web (backend + frontend) del Sistema de Conteo de Sacos — MACROMEC.

## 🌐 Demo en vivo

**https://conteo-sacos-web.vercel.app**

## Estado actual

✅ **Funcionando en producción**, conectado a una base de datos real (PostgreSQL en Neon):
- El dashboard (`/`) muestra el conteo más reciente y el historial de registros reales.
- El endpoint `GET /api/conteo` devuelve datos reales de la base de datos (o datos simulados si `DATABASE_URL` no está configurada, útil para pruebas locales rápidas).
- El endpoint `POST /api/conteo` es el que usa el módulo de Python (`conteo-sacos-vision`) para enviar resultados de conteo — ya probado end-to-end.

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
3. El sistema dejará automáticamente el modo simulado y usará datos reales.

## Despliegue

Publicado en **Vercel**, conectado directamente al repositorio de GitHub — cada `git push` a `main` genera un nuevo despliegue automático.

## Pendiente

- [ ] Autenticación JWT (roles: personal MACROMEC vs. dueño de la fábrica)
- [ ] Validar `VISION_API_TOKEN` en `POST /api/conteo`
- [ ] Reemplazar detección simulada por modelo YOLOv8 real (`conteo-sacos-vision`)
- [ ] Vista del módulo de venta en el dashboard
- [ ] Gráficos de tendencia histórica (Fase 3)