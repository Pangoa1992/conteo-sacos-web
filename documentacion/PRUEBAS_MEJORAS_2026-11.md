# Pruebas de las mejoras de noviembre de 2026

Sistema de Conteo de Sacos de Zanahoria mediante Visión Computacional (MACROMEC).
Mejoras: conteo de sacos por foto enviada por WhatsApp, reportes PDF por módulo,
comprobante de venta (nota de venta interna) y datos de prueba.

Entorno de ensayo (13-14/11/2026): copia del sistema en una carpeta aparte, servidor
local en el puerto 3111 y base de datos de ensayo `conteo_sacos_mejoras` (copia de
la demo más los datos de prueba). La base real y la demo no se tocaron.

## 1. Pruebas automáticas (Vitest)

`npm run verificar` = verificación de tipos + lint + 122 pruebas unitarias: **todas pasan**.
Nuevas en esta entrega: `tests/whatsapp-foto.test.ts` (14) y `tests/pdf.test.ts` (8).

## 2. Casos de prueba

| N.° | Módulo | Caso | Entrada | Resultado esperado | Resultado obtenido |
|---|---|---|---|---|---|
| P-01 | WhatsApp | Ayuda del bot | «ayuda» desde un número autorizado | Lista de comandos que incluye enviar una foto | Correcto |
| P-02 | WhatsApp | Foto válida | Foto JPEG (Twilio y Roboflow simulados, 2 sacos y 1 objeto de otra clase) | Responde «Sacos contados: *2*» y la confianza promedio | Correcto |
| P-03 | WhatsApp | Foto grande | Imagen de 3200 × 2400 px | Se reduce a 1600 px (como el panel) antes de contar | Correcto (1600 × 1200) |
| P-04 | WhatsApp | Audio en lugar de foto | Nota de voz (audio/ogg) | «Solo puedo contar sacos en fotos» | Correcto |
| P-05 | WhatsApp | Archivo dañado | Bytes que no son una imagen | Pide reenviar la foto | Correcto |
| P-06 | WhatsApp | Falla la descarga de Twilio | Archivo inexistente (HTTP 401/404) | Mensaje controlado en menos de 15 s | Correcto (0,97 s) |
| P-07 | WhatsApp | Servicio de detección saturado | Roboflow responde HTTP 429 | Mensaje controlado, el webhook no cae | Correcto |
| P-08 | WhatsApp | Número no autorizado | Foto desde un número fuera de la lista | «Este número no está autorizado» y no se cuenta | Correcto |
| P-09 | WhatsApp | Mensaje sin firma de Twilio | POST sin X-Twilio-Signature | HTTP 403 | Correcto |
| P-10 | WhatsApp | URL ajena a Twilio | MediaUrl de otro dominio | No se descarga nada | Correcto |
| P-11 | Ventas | Comprobante de venta activa | Botón «Comprobante» | PDF A5 «NV-000048» con comprador, lote, cantidad, precio, importe, firmas y aviso «sin valor tributario» | Correcto |
| P-12 | Ventas | Comprobante de venta anulada | Botón «Comprobante» en una venta anulada | El PDF dice «VENTA ANULADA» y el motivo | Correcto |
| P-13 | Ventas | Reporte PDF | «Exportar PDF» | Stock de lotes y TODAS las ventas (no solo las 10 visibles) | Correcto (4 páginas) |
| P-14 | Inventario | Reporte PDF | «Exportar PDF» con los filtros activos | Tabla de lotes con los filtros aplicados | Correcto |
| P-15 | Contratistas | Reporte PDF | «Exportar PDF» | Resumen por contratista e historial de reportes | Correcto (5 páginas) |
| P-16 | Producción validada | Reporte PDF | «Exportar PDF» | Indicadores, estado de validación y clasificación | Correcto |
| P-17 | Historial | Reporte PDF | «Exportar PDF» | Tabla del historial de conteos | Correcto |
| P-18 | Todos | Errores en el navegador | Recorrer los 5 módulos y los 2 comprobantes | Sin errores en la consola | Correcto |
| P-19 | Datos de prueba | Carga en base de ensayo | `cargar_datos_prueba.sh conteo_sacos_mejoras` | 78 lotes, 62 reportes, 43 ventas (2 anuladas), con respaldo previo | Correcto |
| P-20 | Datos de prueba | Segunda carga | Ejecutarlo otra vez en la misma base | Se niega: los datos ya están cargados | Correcto |
| P-21 | Datos de prueba | Protección de la base real | `cargar_datos_prueba.sh conteo_sacos` | Se niega: la base no está marcada como de prueba | Correcto |
| P-22 | WhatsApp | Foto real en producción | Foto de sacos desde el celular autorizado al sistema publicado (Vercel, Twilio y Roboflow reales), 14/11/2026 | El bot responde la cantidad de sacos de la foto | Correcto: contó 9 de 9 sacos (conteo manual del usuario), confianza promedio 86.8 % |

## 3. Notas

- Las pruebas P-02, P-05 y P-07 usan servicios simulados; P-06, P-08 y P-09 se hicieron
  contra el servidor local con mensajes firmados como Twilio; P-22 es la prueba real
  de punta a punta en producción.
- Una sola foto no mide la exactitud del modelo; la exactitud por foto medida con
  conteo manual es la del informe de exactitud (84,9 %).
