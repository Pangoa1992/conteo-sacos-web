# Sistema de Conteo de Sacos mediante Visión Computacional

Proyecto de Innovación (Tesis SENATI) desarrollado para **MACROMEC J&S S.A.C.**, en el marco de las prácticas del área de **CTO / Tecnología y Sistemas**.

## 📌 Descripción del problema

MACROMEC brinda soluciones de automatización industrial y desarrollo de software/IoT a clientes del sector agroindustrial. Uno de sus clientes, una **fábrica de lavado de zanahorias**, actualmente realiza el conteo de sacos de forma manual (observando cámaras de videovigilancia y mediante el reporte verbal de los contratistas que arman los sacos), lo que genera:

- Errores de conteo por fatiga o distracción del personal.
- Falta de un registro digital trazable para fines de venta.
- Demoras en la disponibilidad de información para la toma de decisiones comerciales.
- Imposibilidad del dueño de verificar el conteo de forma remota (no desea estar presente en la fábrica).

**Objetivo del proyecto:** desarrollar un sistema que automatice y verifique el conteo de sacos mediante visión computarizada, con un dashboard web de consulta remota.

## 🏢 Empresa y equipo

| Rol | Persona |
|---|---|
| CEO / Gerencia General | Ing. Jhonny Omar Chacón Colonio |
| CTO / Tecnología y Sistemas (área responsable) | Ing. Juan Alva |
| Practicante — backend / visión / autor de tesis | Willy Pasminio |
| Practicante | Álvaro Díaz |
| Practicante | Mayerly Galarza |

**Modalidad del proyecto:** Innovación (primera vez que se implementa este tipo de sistema en la empresa).

## 🏗️ Arquitectura

Arquitectura Cliente–Servidor con dos módulos independientes comunicados mediante API REST (HTTP/JSON):

```
Cámara IP (fábrica)
      │
      ▼
Módulo de Visión Computarizada (Python + OpenCV / YOLOv8)
      │  API REST (HTTP/JSON)
      ▼
Backend (Next.js API) ──► Base de Datos (PostgreSQL / Drizzle ORM)
      │
      ▼
Frontend Web (Next.js Dashboard)
      │
      ▼
Usuarios: Personal MACROMEC · Dueño de la fábrica (acceso remoto)
```

Diagrama completo: ver `Arquitectura_Sistema.png` / documento `Arquitectura_de_Software.docx`.

### Patrón dentro del módulo web
Se aplica **MVC (Modelo–Vista–Controlador)**:
- **Modelo:** acceso a la base de datos (conteos, ventas, usuarios).
- **Vista:** dashboard que consume el usuario desde el navegador.
- **Controlador:** lógica que recibe los resultados enviados por el módulo de visión.

## 🛠️ Stack tecnológico

| Componente | Tecnología | Justificación |
|---|---|---|
| Visión computarizada | Python + OpenCV + YOLOv8 | Estándar de la industria para conteo/detección de objetos en video en tiempo real |
| Frontend + Backend | Next.js + TypeScript | Ya usado por el equipo en el sistema de asistencia por QR (reduce curva de aprendizaje y riesgo) |
| ORM | Drizzle ORM | Mismo ORM del proyecto anterior; consultas tipadas |
| Base de datos | PostgreSQL | Relacional, robusta, con experiencia previa del equipo |
| Comunicación entre módulos | API REST (HTTP/JSON) | Desacopla visión y web, permite escalar cada uno por separado |
| Autenticación (planeado) | JWT | Diferenciar acceso: personal MACROMEC vs. dueño de fábrica |
| Contenedores (planeado) | Docker | Despliegue consistente de cada módulo |
| CI (planeado) | Git + GitHub Actions | Mismo flujo que el proyecto QR (ramas por integrante, PRs) |

## 📁 Estructura de carpetas

```
conteo-sacos-vision/        (módulo Python)
  ├─ src/
  │   ├─ captura.py         (conexión a cámara IP)
  │   ├─ deteccion.py       (modelo de detección/conteo)
  │   └─ api_cliente.py     (envío de resultados al backend)
  ├─ modelos/               (modelo entrenado, pesos)
  └─ requirements.txt

conteo-sacos-web/           (módulo Next.js)
  ├─ app/                   (rutas y páginas)
  ├─ db/                    (esquema Drizzle, migraciones)
  ├─ api/                   (endpoints: conteo, ventas, autenticación)
  └─ components/            (interfaz: dashboard, reportes)
```

## 🗺️ Roadmap por fases

| Fase | Alcance | Prioridad |
|---|---|---|
| **Fase 1 — Núcleo del sistema** | Conteo automatizado de sacos, dashboard en tiempo real, registro para módulo de venta | 🔴 Alta — obligatorio para sustentar |
| **Fase 2 — Resolver el problema real** | Chatbot de WhatsApp para consulta remota del dueño; alertas automáticas cuando el conteo no coincide con lo reportado por contratistas | 🔴 Alta |
| **Fase 3 — Valor agregado** | Reportes automáticos con IA generativa (resumen diario); analítica y proyección de tendencias | 🟡 Media |
| **Fase 4 — Expansión (fuera de alcance de esta tesis)** | Integración con Odoo de MACROMEC; soporte multi-producto y multi-fábrica; control de calidad visual | ⚪ Baja — visión a futuro |

## ✅ Estado actual

- [x] Capítulo I del informe (generalidades, organigrama, modelo de negocio) — enviado, observaciones levantadas
- [x] Problema, título tentativo y modalidad (Innovación) validados
- [x] Stack técnico definido
- [x] Arquitectura de software redactada (formato a-b-c-d)
- [ ] Capítulo II del informe (en espera de preguntas del asesor)
- [ ] Desarrollo del módulo de visión computarizada
- [ ] Desarrollo del módulo web (backend + frontend)
- [ ] Grabación de video real en la fábrica para desarrollo y demo
- [ ] Casos de uso y diagramas de actividad (Capítulo IV)
- [ ] Modelado de datos / diccionario de datos (Capítulo IV)

## 🔲 Pendientes por definir / necesidades del equipo

- [ ] **Cámara IP de prueba** (propia o de la fábrica) para grabar video real de desarrollo y demo
- [ ] **Confirmar con el asesor**: ¿la demo de sustentación acepta video ya grabado en vez de conexión en vivo? *(el profesor ya indicó que solo se requieren imágenes/video, no es obligatorio en vivo)*
- [ ] **WhatsApp Business API** (o similar) para el chatbot y las alertas — definir cuenta/número a usar
- [ ] **Hosting/servidor** definitivo para backend y base de datos (servidor propio de MACROMEC vs. Neon/Vercel como en el proyecto QR)
- [ ] Modelo específico de detección: ¿entrenar desde cero o adaptar un modelo preentrenado?
- [ ] Conseguir sacos reales (aunque sean pocos) para pruebas del modelo de detección

## 📄 Documentos de referencia

- `PIMC_Capitulo_I_Macromec.docx` — Informe oficial, formato SENATI
- `Plan_de_Trabajo_Proyecto.docx` — Resumen para revisión con Juan Alva (CTO)
- `Arquitectura_de_Software.docx` — Arquitectura en formato a-b-c-d
- `Arquitectura_Sistema.png` — Diagrama visual de arquitectura
- `Estructura_del_Proyecto.docx` — Detalle técnico ampliado (requisitos no funcionales, roadmap)

---
*Proyecto desarrollado como parte de la Formación Práctica en Empresa — SENATI, carrera Ingeniería de Software con IA.*
