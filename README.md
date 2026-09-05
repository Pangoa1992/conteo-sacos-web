# conteo-sacos-web

Módulo web (backend + frontend) del Sistema de Conteo de Sacos — MACROMEC.

## Estado actual

✅ Funciona **hoy mismo en modo simulado**, sin necesidad de base de datos ni cámara real:
- El dashboard (`/`) muestra un conteo simulado y un historial de ejemplo.
- El endpoint `GET /api/conteo` responde con datos mock si `DATABASE_URL` no está configurada.
- El endpoint `POST /api/conteo` es el que usará el módulo de Python (`conteo-sacos-vision`) para enviar resultados reales cuando esté lista la cámara.

## Cómo correrlo

```bash
npm install
npm run dev
```

Abrir http://localhost:3000

## Cuando ya haya base de datos (PostgreSQL)

1. Copiar `.env.example` a `.env.local` y completar `DATABASE_URL`.
2. Generar y aplicar las migraciones:
   ```bash
   npm run db:generate
   npm run db:migrate
   ```
3. El sistema dejará automáticamente el modo simulado y usará datos reales.

## Pendiente

- [ ] Autenticación JWT (roles: personal MACROMEC vs. dueño de la fábrica)
- [ ] Validar `VISION_API_TOKEN` en `POST /api/conteo`
- [ ] Conectar con el módulo de visión real (`conteo-sacos-vision`)
- [ ] Gráficos de tendencia histórica (Fase 3)
