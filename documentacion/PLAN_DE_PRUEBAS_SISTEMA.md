# Plan y resultados de pruebas del sistema

Sistema de Conteo de Sacos de Zanahoria mediante Visión Computacional (MACROMEC).
Ejecutado el 14/11/2026.

## 1. Objetivo

Comprobar que cada módulo del sistema cumple su función, rechaza los datos incorrectos y
protege la información (permisos, firmas y reglas de la base de datos), con datos de prueba
que representan la operación real.

## 2. Alcance y tipos de prueba

| Tipo de prueba | Qué comprueba | Casos | Resultado |
|---|---|---|---|
| Unitarias (Vitest) | Reglas de negocio sin servidor: ventas, inventario, validación, usuarios, WhatsApp, PDF, foto, video | 122 | 122 pasan |
| De sistema (caja negra) | Cada módulo a través de su API, contra el servidor compilado y una base de ensayo | 54 | 54 pasan |
| De interfaz (Chrome) | Botones «Exportar PDF» de 5 módulos y comprobantes de venta, sin errores en la consola | 9 | 9 pasan |
| Real en producción | Foto de sacos enviada por WhatsApp al sistema publicado (Twilio y Roboflow reales) | 1 | 9 de 9 sacos, confianza 86.8 % |

## 3. Entorno

- Servidor: versión compilada (`next build` + `next start`), igual a la publicada.
- Base de datos de ensayo `conteo_sacos_ensayo_datos`: copia de la demo con los datos de prueba
  completos (`datos-prueba/`): 100 lotes, 19 evidencias, 5 usuarios, 49 ventas y 82 reportes.
  Las pruebas no escribieron en la base real ni en la demo.
- Servicios externos: Twilio simulado con mensajes firmados con la clave real; Roboflow real en
  el caso de «Contar por foto» (1 consulta).
- Evidencias de la ejecución: `D:\RESPALDOS_MACROMEC\herramientas_pruebas\sistema_completo\ejecucion_2026-11-14_132125`.

## 4. Casos de prueba del sistema

| N.° | Módulo | Caso | Entrada | Resultado esperado | Resultado obtenido | Estado |
|---|---|---|---|---|---|---|
| PS-01 | Acceso | Inicio de sesión del administrador | correo y contraseña correctos | 200 y cookie de sesión | 200 | Aprobado |
| PS-02 | Acceso | Contraseña incorrecta | contraseña equivocada | 401 «Credenciales incorrectas» | 401 Credenciales incorrectas | Aprobado |
| PS-03 | Acceso | Cuenta desactivada | ex operador (activo = false) con su contraseña correcta | No puede iniciar sesión | 403 Esta cuenta está desactivada. Consulte al administrador de MACROMEC. | Aprobado |
| PS-04 | Acceso | Inicio de sesión del cliente (dueño) | usuario con rol cliente | 200 | 200 | Aprobado |
| PS-05 | Acceso | Panel sin sesión | abrir / sin cookie | Redirige al inicio de sesión | 307 → http://localhost:3112/login | Aprobado |
| PS-06 | Acceso | API sin sesión | GET /api/inventario sin cookie | 401 | 401 | Aprobado |
| PS-07 | Acceso | Permisos por rol | el cliente pide el inventario (solo personal MACROMEC) | 403 | 403 | Aprobado |
| PS-08 | Acceso | Permisos por rol | el cliente pide la lista de usuarios | 403 | 403 | Aprobado |
| PS-09 | Acceso | Sesión vigente | GET /api/auth/me con la cookie | Devuelve el usuario y su rol | 200 | Aprobado |
| PS-10 | Conteos | Registro de un lote desde el detector | POST /api/conteo con token y 37 sacos | 201 y lote pendiente de validación | 201 lote #104 | Aprobado |
| PS-11 | Conteos | Reintento del mismo lote (idempotencia) | mismo idExterno y mismos datos | 200 «duplicado», sin crear otro lote | 200 | Aprobado |
| PS-12 | Conteos | Mismo idExterno con otros datos | idExterno repetido y 40 sacos | 409 conflicto | 409 | Aprobado |
| PS-13 | Conteos | Registro sin token | POST /api/conteo sin Authorization | 401 | 401 | Aprobado |
| PS-14 | Conteos | Cantidad inválida | cantidadSacos = -5 | 400 datos inválidos | 400 | Aprobado |
| PS-15 | Conteos | Historial de conteos | GET /api/conteo | 200 con los lotes | 200 | Aprobado |
| PS-16 | Conteos | Exportar historial a CSV | GET /api/conteo?formato=csv | Archivo CSV | 200 text/csv; charset=utf-8 | Aprobado |
| PS-17 | Validación | Clasificación que no suma el total | aprobar 37 sacos como 30 + 2 + 1 | 400 rechazado | 400 Validación incoherente | Aprobado |
| PS-18 | Validación | Observar sin motivo | estado observado sin observación | 400 pide el motivo | 400 Validación incoherente | Aprobado |
| PS-19 | Validación | Aprobar con clasificación correcta | 34 conformes + 2 observados + 1 defectuoso = 37 | 200 y lote aprobado | 200 | Aprobado |
| PS-20 | Validación | Cambio simultáneo de otro usuario | estadoEsperado «pendiente» cuando ya está aprobado | 409 conflicto | 409 | Aprobado |
| PS-21 | Validación | Historial de revisiones | consultar validaciones_conteo del lote | Queda 1 revisión registrada | 1 | Aprobado |
| PS-22 | Evidencias | Subir una foto de evidencia | JPEG de 640 × 480 | 201 evidencia guardada | 201 | Aprobado |
| PS-23 | Evidencias | Archivo que no es imagen | texto con extensión .jpg | 400 rechazado | 400 El archivo no es una imagen JPEG. | Aprobado |
| PS-24 | Evidencias | Anular sin motivo | motivo vacío | 400 | 400 | Aprobado |
| PS-25 | Evidencias | Anular con motivo | motivo escrito | 200 y la evidencia se conserva anulada | 200 | Aprobado |
| PS-26 | Evidencias | Borrar una evidencia directamente en la BD | DELETE en evidencias | La base de datos lo impide y la evidencia sigue | rechazado por la base de datos; evidencia presente: sí | Aprobado |
| PS-27 | Inventario | Resumen de inventario | GET /api/inventario | 200 y totales coherentes (disponible = conformes − vendidos) | 200 coherente=true | Aprobado |
| PS-28 | Inventario | Exportar inventario a CSV | formato=csv | Archivo CSV | 200 | Aprobado |
| PS-29 | Inventario | Filtro de fecha inválido | desde=2026-13-45 | 400 | 400 | Aprobado |
| PS-30 | Ventas | Registrar una venta parcial | 20 de 34 conformes a S/ 27.50 | 201 e importe S/ 550.00 calculado por el servidor | 201 importe 550.00 | Aprobado |
| PS-31 | Ventas | Doble clic (misma clave) | misma claveIdempotencia | No crea otra venta | 200 duplicado=true | Aprobado |
| PS-32 | Ventas | Vender más de lo disponible | 15 sacos cuando quedan 14 | Rechazada por stock insuficiente | 409 Stock insuficiente: el lote #104 tiene 14 sacos conformes disponibles. | Aprobado |
| PS-33 | Ventas | Vender de un lote no aprobado | lote #9 pendiente | Rechazada | 409 Solo se venden sacos conformes de lotes aprobados. | Aprobado |
| PS-34 | Ventas | Precio con 3 decimales | S/ 10.555 | 400 | 400 | Aprobado |
| PS-35 | Ventas | Anular una venta | motivo escrito | 200 y los 20 sacos vuelven al stock (34 disponibles) | 200 disponibles 34 | Aprobado |
| PS-36 | Contratistas | Registrar reporte del contratista | 40 sacos reportados frente a 37 de la IA | 201 y diferencia +3 (discrepancia) | 201 | Aprobado |
| PS-37 | Contratistas | Cantidad reportada negativa | -1 | 400 | 400 | Aprobado |
| PS-38 | Contratistas | Resumen y discrepancias | GET /api/reportes-contratista | 200 con el resumen por contratista | 200 | Aprobado |
| PS-39 | Usuarios | Crear un usuario | nombre, correo, rol cliente y contraseña | 201 | 201 | Aprobado |
| PS-40 | Usuarios | Correo repetido | mismo correo | 409 | 409 | Aprobado |
| PS-41 | Usuarios | Contraseña débil | contraseña «123» | 400 | 400 La contraseña debe tener al menos 10 caracteres. | Aprobado |
| PS-42 | Usuarios | Desactivar cuenta con sesión abierta | desactivar al usuario recién creado | Su sesión deja de valer (/api/auth/me devuelve usuario null) | login 200 · desactivar 200 · después: usuario null (sesión cerrada) | Aprobado |
| PS-43 | Usuarios | Bloqueo tras 5 intentos fallidos | 6 contraseñas equivocadas y luego la correcta | La cuenta queda bloqueada 15 minutos | 429 → correcta 429 Demasiados intentos fallidos. Por seguridad, la cuenta queda bloqueada; intente de nuevo en 15 minutos o pida al administrador una contraseña nueva. | Aprobado |
| PS-44 | WhatsApp | Comando «ayuda» | mensaje firmado desde número autorizado | Lista de comandos (incluye la foto) | Hola 👋 Soy el asistente de Conteo de Sacos — MACROMEC. Esc | Aprobado |
| PS-45 | WhatsApp | Comando «hoy» | «hoy» | Responde la producción del día (o que no hay datos reales) | 📊 Hoy 14/11/2026 (hora de Lima) todavía no hay conteos reales. | Aprobado |
| PS-46 | WhatsApp | Comando mal escrito | «lote abc» | Explica cómo escribirlo | Indique el número del lote, por ejemplo: *lote 123*. | Aprobado |
| PS-47 | WhatsApp | Número no autorizado | +51 900 000 001 | No entrega datos | Este número no está autorizado para consultar la producción. | Aprobado |
| PS-48 | WhatsApp | Mensaje sin firma de Twilio | sin X-Twilio-Signature | 403 | 403 | Aprobado |
| PS-49 | WhatsApp | Envía un audio en vez de foto | nota de voz | Indica que solo cuenta fotos | Solo puedo contar sacos en *fotos* (JPEG o PNG). Los audios, | Aprobado |
| PS-50 | Contar por foto | Disponibilidad del servicio | GET /api/contar-foto | Disponible con el modelo RF-DETR | 200 willy-urzch/carrot-sack-counter-1-rfdetr-small-t1 | Aprobado |
| PS-51 | Contar por foto | Permiso del cliente | el cliente consulta el servicio | 403 | 403 | Aprobado |
| PS-52 | Contar por foto | Contar una foto real (Roboflow real) | WhatsApp Image 2026-09-09 at 12.14.02 PM.jpeg (conteo manual: 13) | Devuelve el total de sacos y la confianza | 200 total 13 · confianza 88.16 % | Aprobado |
| PS-53 | Panel | Resumen del panel | GET /api/conteo/resumen | 200 | 200 | Aprobado |
| PS-54 | Panel | Estado de WhatsApp en el panel | GET /api/whatsapp/estado | 200 sin revelar secretos | 200 | Aprobado |

## 5. Resumen por módulo

| Módulo | Casos | Aprobados |
|---|---|---|
| Acceso | 9 | 9 |
| Conteos | 7 | 7 |
| Validación | 5 | 5 |
| Evidencias | 5 | 5 |
| Inventario | 3 | 3 |
| Ventas | 6 | 6 |
| Contratistas | 3 | 3 |
| Usuarios | 5 | 5 |
| WhatsApp | 6 | 6 |
| Contar por foto | 3 | 3 |
| Panel | 2 | 2 |
| **Total** | **54** | **54** |
| Interfaz: reportes PDF y comprobantes | 9 | 9 |

## 6. Incidencias

- No se encontraron defectos en el sistema.
- En la primera ejecución, 2 casos (PS-26 y PS-42) salieron fallidos por errores del script de
  prueba, no del sistema: la base de datos sí rechazó el borrado de la evidencia y la cuenta
  desactivada sí perdió su sesión (`/api/auth/me` responde `usuario: null`). Se corrigió el
  script y la segunda ejecución aprobó los 54 casos.

## 7. Conclusión

Los 54 casos de sistema, las 122 pruebas unitarias, las 9 pruebas de interfaz y la prueba
real por WhatsApp resultaron aprobados. El sistema valida los datos de entrada, respeta los
permisos por rol, impide duplicados (conteos y ventas), conserva el historial (evidencias y
ventas anuladas no se borran) y mantiene coherente el inventario (disponible = conformes −
vendidos).

La exactitud del modelo de visión se mide aparte, con conteo manual: 84,9 % por foto
(informe de exactitud). En esta ejecución, la foto real de prueba dio 13 sacos frente a 13 del
conteo manual.
