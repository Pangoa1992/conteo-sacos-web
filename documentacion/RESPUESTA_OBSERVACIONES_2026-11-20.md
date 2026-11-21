# Respuesta a las observaciones de la revisión del 20/11/2026

**Proyecto:** Sistema de Conteo de Sacos mediante Visión Computacional — MACROMEC J&S S.A.C.
**Entrega:** 21/11/2026

| # | Observación del docente | Qué se cambió | Dónde se ve |
|---|---|---|---|
| 1 | Unir los módulos que se relacionan | El menú pasó de **14 opciones sueltas a 8 grupos**. Los módulos relacionados quedan juntos y se eligen con pestañas. | Barra lateral y pestañas sobre cada módulo |
| 2 | Filtro de búsqueda por mes en Producción validada | Nuevo periodo **«Por mes»** con selector de mes, y la tabla **«Comparación mes a mes»**. El botón «Ver lotes del mes» abre el historial con ese mes. | Producción → Producción validada |
| 3 | Consultar meses anteriores | El **historial** tiene un selector **Mes** y ahora pide los lotes de ese periodo al servidor. Antes solo mostraba los 200 lotes más recientes. Por WhatsApp se agregó el comando **`mes`**. | Lotes y contratistas → Historial · WhatsApp |
| 4 | WhatsApp: ¿quién lo recibe, quién lo usa, adónde van los datos que se suben? | El módulo explica el flujo completo. Se agregó una **bitácora** de todos los mensajes y una **bandeja de fotos**: el personal registra cada foto como lote o la descarta. | WhatsApp |

## 1. Módulos agrupados

| Menú | Pestañas |
|---|---|
| Resumen | Indicadores · Cámaras y fuentes |
| Producción | Producción validada · Producción diaria |
| Lotes y contratistas | Historial de lotes · Reportes del contratista |
| Registrar conteo | Por foto · Por video |
| Inventario y ventas | Inventario · Ventas |
| WhatsApp | Estado, bitácora y fotos recibidas |
| Administración | Usuarios · Respaldo |
| Mi cuenta | Cambio de contraseña |

## 2 y 3. Consulta por mes

- **Producción validada → Por mes:** se elige el mes (p. ej. *octubre 2026*). Para ese mes se ven el total detectado por la IA, la producción validada, los sacos conformes, los pendientes y la clasificación. El PDF se exporta con el nombre del mes.
- **Comparación mes a mes:** una fila por mes con lotes, sacos detectados, producción validada, % validado, conformes y lotes pendientes.
- **Historial → Mes:** trae del servidor **todos los lotes de ese mes**, aunque sean antiguos. Si el mes tiene más de 200 lotes, el sistema lo avisa y el CSV los exporta todos.
- **WhatsApp:** `mes` (mes en curso), `mes 10`, `mes 10/2025`, `mes octubre` u `octubre 2025`. La respuesta trae los lotes, los sacos, la validación y el detalle por semana.

## 4. WhatsApp: flujo de los datos

```
Celular autorizado ──► WhatsApp ──► Twilio ──(firma digital)──► Servidor del sistema
                                                                      │
                          ┌───────────────────────────────────────────┤
                          ▼                                           ▼
             Consulta (hoy, semana, mes, lote)           Foto de sacos → IA (RF-DETR) cuenta
             se responde con datos de PostgreSQL         se responde el total
                          │                                           │
                          ▼                                           ▼
              Bitácora: quién, cuándo, qué pidió        Bandeja «Fotos recibidas» del panel
                                                                      │
                                                       el personal la revisa ─┬─► Registrar como lote
                                                                              │   (pendiente de validar,
                                                                              │    foto como evidencia)
                                                                              └─► Descartar
```

- **¿Quién lo usa?** Solo los celulares que MACROMEC autoriza en el servidor, por ejemplo la supervisora, el jefe de planta o el cliente. Cada número puede llevar un nombre (`Supervisora=+51…`) para saber quién consultó. A los demás números se les responde «no autorizado» y el intento queda anotado.
- **¿Quién lo recibe?** Twilio, el proveedor de la API de WhatsApp. Reenvía cada mensaje al servidor con una firma digital, y el servidor rechaza todo lo que no esté firmado.
- **¿De dónde sale la respuesta?** De la misma base de datos del panel y con las mismas reglas: solo lotes reales y en hora de Lima. Nunca se informan ventas ni inventario.
- **¿Adónde van los datos?**
  - Cada mensaje queda en la **bitácora** del panel: fecha, quién (nombre y número enmascarado, p. ej. `+51•••••••34`), qué pidió, el resultado y qué pasó con los datos.
  - Las fotos con sacos quedan guardadas, sin metadatos ni GPS, en la **bandeja**. El personal decide si cada una se registra como lote o se descarta.
  - Ninguna foto entra a la producción sin revisión. La bitácora también se incluye en el respaldo ZIP.

## Verificación

- 140 pruebas automáticas aprobadas (13 nuevas para la consulta por mes, el comando `mes`, los contactos con nombre y el destino de las fotos), más typecheck, lint y compilación de producción.
- Prueba de punta a punta contra el servidor local, con 14 comprobaciones:
  - resumen mensual e historial de octubre;
  - mensaje de WhatsApp firmado con el comando `mes 10`;
  - rechazo de un número no autorizado;
  - bitácora sin el número completo;
  - foto de la bandeja registrada como lote pendiente con su evidencia, sin duplicarse con un segundo clic;
  - el rol cliente no puede ver la bitácora.
