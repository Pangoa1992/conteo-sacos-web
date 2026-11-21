# Auditoría final del sistema — Conteo de Sacos MACROMEC

**Fecha:** 21/11/2026 · **Versión auditada:** `main` @ `e69603f` (publicada en Vercel + Neon)
**Alcance:**
- código fuente y API;
- seguridad;
- base de datos;
- dependencias;
- pruebas;
- interfaz (PC, celular y tema oscuro);
- despliegue;
- documentación.

**Método:** revisión del código, comprobaciones automáticas y pruebas de punta a punta contra el servidor local:
- `npm run verificar`;
- `npm audit`;
- recorrido de la interfaz con navegador automático (33 capturas);
- consultas a la base de datos;
- peticiones a la web publicada.

## 1. Resultado general

| Área | Nota | Estado |
|---|---|---|
| Funcionalidad | 9/10 | Completa: todos los módulos operan, incluida la consulta por mes |
| Seguridad | 9/10 | Sólida. Corregidos S1 y S2: 0 vulnerabilidades y cabeceras de protección |
| Base de datos | 9/10 | Integridad garantizada por restricciones y triggers |
| Calidad del código y pruebas | 9/10 | 140 pruebas automáticas y 72 casos de sistema, plan de pruebas actualizado |
| Interfaz y diseño | 8,5/10 | Sin errores, adaptable a celular. Se ve vacía sin datos del día |
| Despliegue | 9/10 | Publicado y verificado; migraciones al día |
| Documentación | 8,5/10 | README y plan de pruebas al día; falta actualizar el documento de tesis (sección 5) |
| **Global** | **9/10** | **Apto para presentar** |

No se encontraron defectos críticos ni pérdidas de datos.

## 2. Cifras del sistema (para el documento de tesis)

| Indicador | Valor |
|---|---|
| Líneas de código (aplicación) | ~12 700 (TypeScript/React) |
| Líneas de pruebas | ~1 200 |
| Rutas de la API | 30 |
| Módulos del panel | 14, agrupados en 8 secciones del menú |
| Tablas de la base de datos | 11 |
| Claves foráneas | 16 |
| Restricciones CHECK | 20 |
| Triggers | 14 (stock, ventas congeladas, evidencias sin borrado…) |
| Índices | 19 |
| Migraciones | 11 (0000–0010), aplicadas en local, demo y producción |
| Pruebas unitarias automáticas | 140 (12 archivos), todas aprobadas |
| Casos de prueba de sistema | 72 aprobados (58 del 14/11 + 14 del 21/11) |
| Commits en el repositorio | 54 |
| Confianza media del modelo (datos de demo) | 90,5 % |
| Exactitud por foto vs. conteo manual | 84,9 % (error medio 3,1 sacos; límite superior, ver 4.3) |

## 3. Lo que está bien (fortalezas para defender)

**Seguridad**
1. **Permisos en el servidor.** Las 30 rutas comprueban la sesión y el rol en el servidor, no solo ocultando botones. Las únicas rutas públicas son las previstas:
   - el login;
   - el webhook, protegido con la firma de Twilio;
   - `POST /api/conteo`, protegido con token y comparación en tiempo constante.
2. **Contraseñas y sesiones:**
   - contraseñas con bcrypt;
   - bloqueo tras 5 intentos fallidos;
   - sesión JWT en cookie `HttpOnly`;
   - revocación inmediata al desactivar una cuenta o cambiar su contraseña.
3. **Secretos.** Ningún secreto en el repositorio: `.env.local` nunca se subió (se verificó todo el historial de git).
4. **WhatsApp:**
   - firma de Twilio obligatoria;
   - lista blanca de números;
   - números enmascarados en registros y bitácora;
   - nunca informa ventas ni inventario.

**Datos y trazabilidad**

5. **Integridad en la base, no solo en el código:**
   - el total de la IA nunca se modifica;
   - las evidencias no se pueden borrar;
   - las ventas no superan el stock;
   - los datos de prueba nunca se mezclan con los reales.
6. **Trazabilidad completa:**
   - quién validó cada lote y cuándo;
   - historial de revisiones;
   - quién consultó por WhatsApp;
   - descargas de respaldo registradas.
7. **Idempotencia:** el mismo lote o la misma venta no se registran dos veces, aunque se reintente o se pulse dos veces.

**Observaciones del profesor y operación**

8. **Las observaciones del 20/11 están resueltas:**
   - módulos agrupados;
   - filtro por mes;
   - consulta de meses anteriores;
   - flujo de WhatsApp explicado y con trazabilidad.
9. **Interfaz:**
   - 0 errores de consola;
   - 0 desbordes horizontales;
   - ningún texto menor de 12 px;
   - funciona en celular y en tema oscuro.
10. **Respaldo** completo en ZIP con huellas SHA-256, sin contraseñas.

## 4. Hallazgos y recomendaciones

### 4.1 Seguridad (✅ corregido el 21/11/2026)

| # | Hallazgo | Severidad | Recomendación |
|---|---|---|---|
| S1 | `npm audit`: 3 avisos de **Next.js 15.5.28** (incluye postcss) y **fflate 0.8.2** | Media | ✅ Actualizados `next@15.5.29` y `fflate@0.8.3`, y `postcss@8.5.32` forzado con `overrides`. `npm audit`: **0 vulnerabilidades**. |
| S2 | La web publicada solo envía la cabecera HSTS | Baja–media | ✅ Agregadas en `next.config.mjs`: `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy` y `Permissions-Policy`. |

### 4.2 Funcionalidad y mantenimiento (pueden quedar como trabajo futuro)

| # | Hallazgo | Severidad | Recomendación |
|---|---|---|---|
| F1 | Las fotos de WhatsApp se guardan en la base sin plazo de borrado (~200–400 KB cada una). Neon gratuito tiene 0,5 GB. | Baja | Definir una retención, por ejemplo borrar a los 90 días las fotos descartadas. Mencionarlo como trabajo futuro. |
| F2 | «Uso en los últimos 30 días» de WhatsApp se calcula sobre los últimos 100 mensajes | Baja | Con más de 100 mensajes al mes la cifra se queda corta. Calcularla en la base. |
| F3 | Comentarios del código que mencionan «Next 14» (`app/api/conteo/resumen/route.ts`, `next.config.mjs`) | Cosmética | ✅ Corregido. |

### 4.3 Limitaciones que conviene declarar en la tesis (honestidad metodológica)

| # | Limitación | Cómo presentarla |
|---|---|---|
| L1 | La exactitud por foto (84,9 %) se midió con fotos que también se usaron para entrenar el modelo | Es un **límite superior**. Trabajo futuro: validar con fotos nuevas. |
| L2 | No hay cámara fija instalada en planta | El sistema está listo para recibirla (`POST /api/conteo`). Se probó con videos y fotos grabados. |
| L3 | WhatsApp usa el Sandbox de Twilio | Exige `join` cada 72 h. En operación real se necesita un remitente aprobado de WhatsApp Business. |
| L4 | El modelo detecta una sola clase («Saco») | La calidad (conforme / observado / defectuoso) la clasifica una persona. Es una decisión de diseño. |
| L5 | El seguimiento por video no usa descriptor de apariencia | Puede fallar con giros de cámara. Ya está documentado en el README. |

### 4.4 Presentación

| # | Hallazgo | Recomendación |
|---|---|---|
| P1 | Con datos de laboratorio el panel se ve «a medias» | Presentar con `conteo_sacos_demo` (100 lotes, la mayoría validados). |
| P2 | «Producción de hoy» y «Últimos 7 días» salen en 0, porque los datos de demo terminan el 13/11 | Registrar 2 o 3 lotes por foto el día de la presentación. |
| P3 | La bitácora de WhatsApp está vacía | Enviar 2 o 3 mensajes y una foto antes de exponer. |

## 5. Correcciones a la documentación

| Documento | Qué corregir |
|---|---|
| `PLAN_DE_PRUEBAS_SISTEMA.md` | ✅ Actualizado: 140 pruebas unitarias, casos PS-59 a PS-72 y nota sobre «Contar por video». |
| `README.md`, sección Seguridad | ✅ Actualizado: 0 vulnerabilidades y cabeceras de seguridad. |
| Documento de tesis (Arquitectura / Capítulo de resultados) | Usar las cifras de la sección 2: 11 tablas, 16 FK, 20 CHECK, 14 triggers, 30 rutas, 140 pruebas. Describir el **menú agrupado** y la **consulta por mes**. Incluir el **diagrama del flujo de WhatsApp** de `RESPUESTA_OBSERVACIONES_2026-11-20.md`. |
| Documento de tesis (Limitaciones y trabajo futuro) | Incluir L1–L5 y F1. |
| Capturas de pantalla del documento | Rehacerlas con la versión nueva: el menú cambió de 14 a 8 opciones. Las capturas antiguas ya no coinciden con el sistema. |

## 6. Conclusión

El sistema cumple los requisitos funcionales y las observaciones del docente. Está publicado y verificado en producción y tiene una base de seguridad e integridad de datos por encima de lo habitual en un proyecto académico:
- permisos en el servidor;
- restricciones en la base de datos;
- trazabilidad completa;
- 140 pruebas automáticas.

Los parches de seguridad (S1, S2) y la documentación técnica ya están corregidos. Solo falta:
- actualizar el documento de tesis (sección 5);
- preparar los datos del día para la demostración.

**Veredicto: apto para presentar y entregar.**
