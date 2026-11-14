# Datos de prueba

Llenan una base de datos de **prueba o demostración** con registros en todos los módulos,
para hacer demostraciones y pruebas sin datos reales.

```bash
bash datos-prueba/cargar_datos_prueba.sh conteo_sacos_demo
```

- Solo funciona en bases cuyo comentario empieza por «SOLO DATOS DE» (las de prueba y la demo).
  En la base real se niega.
- Antes de cargar guarda un volcado en `datos-prueba/respaldos/` (no se sube a git).
- Se puede ejecutar una sola vez por base: si los datos ya están, se niega.
- Todos los lotes tienen origen `prueba_*`: el panel los marca como prueba y el modo DEMO
  de WhatsApp sigue funcionando.

| Módulo | Qué se carga |
|---|---|
| Conteos | 78 lotes de 2 cámaras (14/10 al 13/11/2026), 10 lotes «Contar por foto» y 1 «Contar por video» |
| Validación | Aprobados, observados (con motivo), rechazados y pendientes, con su historial |
| Contratistas | 72 reportes de 3 contratistas; la mayoría coincide y algunos tienen discrepancia |
| Ventas | 43 ventas a 4 compradores, 2 anuladas con motivo |
| Evidencias | La foto de cada lote «por foto», un fotograma del video y 3 fotos de lotes de cámara (1 anulada) |
| Usuarios | Supervisora (administradora), dueño de la fábrica (cliente) y un ex operador desactivado |

Los usuarios de prueba usan la contraseña `Prueba-MACROMEC-2026`. Solo existen en las bases
de prueba y demo, nunca en producción.

Los lotes «Contar por foto» usan las 10 fotos reales de la prueba de exactitud
(`D:\PROYECTO\PRUEBA_EXACTITUD`, fuera del repositorio): la IA da el conteo del lote y el
contratista reporta el conteo manual, así que las discrepancias son reales. Otras carpetas:
variables `CARPETA_EXACTITUD` y `CARPETA_DETECTOR`.
