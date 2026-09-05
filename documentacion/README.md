# Documentación del Proyecto de Tesis — Sistema de Conteo de Sacos

Proyecto de Innovación (SENATI) desarrollado para **MACROMEC J&S S.A.C.**, en el marco
de la Formación Práctica en Empresa (área CTO / Tecnología y Sistemas).

Esta carpeta tiene dos partes, para que cualquiera que entre entienda rápido
**qué se pide** y **qué se ha avanzado**:

## 📂 01-Guia-del-Profesor

Documentos que comparte el profesor (Juan Manuel Requena Muñoz) como guía del curso
"Elaboración de Proyectos de Innovación y Mejora". Definen el formato y la estructura
que debe seguir el informe técnico final:

| Archivo | Qué es |
|---|---|
| `CGEU-241_Plantilla_PIMC.pdf` | Plantilla oficial del informe (8 capítulos, formato APA, Times New Roman 12pt) |
| `CGEU-122_TRABAJOFINAL.DOCX` | Misma plantilla, otro código de formulario (idéntica en contenido) |
| `Ejemplo01__Informe_Técnico_Cap_4.docx` | Ejemplo real de otro alumno — Capítulo IV (Propuesta Técnica), primera parte |
| `Ejemplo02__Informe_Técnico_Cap_4_Ejemplo.docx` | Ejemplo real de otro alumno — Capítulo IV, segunda parte (arquitectura de software, casos de uso, diagramas) |

**Cómo se trabaja con esto:** cada semana el profesor revisa un capítulo o sección del
informe. Se envía un avance, el profesor lo devuelve **"observado"** (con correcciones)
o **"correcto"**. Los Ejemplo01/02 muestran el nivel de detalle esperado, especialmente
para el Capítulo IV (arquitectura, casos de uso, diagramas de actividad, modelado de datos).

## 📂 02-Avance-del-Proyecto

Lo que el equipo ya ha desarrollado, tanto en documentación como en la definición técnica
del sistema:

| Archivo | Qué es | Estado |
|---|---|---|
| `PIMC_Capitulo_I_Macromec.docx` | Informe oficial, Capítulo I (Generalidades de la empresa, organigrama, modelo de negocio) | ✅ Enviado, observaciones levantadas |
| `Levantamiento_Observaciones_Capitulo_I.docx` | Respuesta a las 5 observaciones del asesor sobre la ficha inicial (organigrama, problema, título) | ✅ Enviado |
| `Arquitectura_de_Software.docx` | Arquitectura del sistema en el formato exacto que pide el profesor (a. Tipo de arquitectura, b. Plataforma, c. Herramientas, d. Base de datos) | ✅ Corregido según observación |
| `Plan_de_Trabajo_Proyecto.docx` | Resumen para Juan Alva (CTO): stack técnico, arquitectura, roadmap por fases, pendientes | Para revisión interna con MACROMEC |
| `Estructura_del_Proyecto.docx` | Detalle técnico ampliado: requisitos no funcionales, roadmap, estructura de carpetas | Referencia técnica |
| `Arquitectura_Sistema.png` | Diagrama visual de la arquitectura completa, con módulos actuales y futuros | Referencia visual |
| `README_Repositorios_GitHub.md` | Explica el contenido de los repositorios de código | Ver también los repos abajo |

## 💻 Código del sistema (GitHub)

El desarrollo real del sistema está en dos repositorios separados:

- **[conteo-sacos-web](https://github.com/Pangoa1992/conteo-sacos-web)** — Dashboard y backend (Next.js + PostgreSQL). Ya funciona conectado a una base de datos real (Neon), mostrando conteos de prueba.
- **[conteo-sacos-vision](https://github.com/Pangoa1992/conteo-sacos-vision)** — Módulo de visión computarizada (Python). Soporta fotos, video o cámara en vivo; la detección todavía es simulada mientras no haya fotos/video reales para entrenar el modelo.

Ambos módulos ya se probaron **conectados entre sí de punta a punta** (Python → API → base de datos real → dashboard).

## 🗺️ Cómo se está trabajando (resumen del flujo)

1. El profesor pide avances por capítulo (Cap. I ya enviado, Cap. II pendiente).
2. Cada envío se corrige según las observaciones que devuelve.
3. En paralelo, se desarrolla el sistema real (código en GitHub), coordinando con Juan Alva
   (CTO de MACROMEC) qué recursos facilita la empresa (cámara, WhatsApp Business, servidor).
4. El sistema se irá completando por fases: primero el núcleo (conteo + dashboard), luego
   los módulos que resuelven el problema real (WhatsApp, alertas), y por último mejoras
   (reportes con IA, integración con Odoo).
5. Sustentación en diciembre — el profesor confirmó que basta con mostrar el funcionamiento
   mediante imágenes/video, no es obligatorio ejecutarlo en vivo con cámara real.

## ✅ Pendientes actuales

- [ ] Fotos/video reales de la fábrica (las tomadas en la visita al lavadero — Juan las entrega el lunes)
- [ ] Definir modelo de detección real (reemplazar la simulación en `conteo-sacos-vision`)
- [ ] Confirmar con Juan: cámara de vigilancia, WhatsApp Business API, hosting definitivo
- [ ] Preguntas de Capítulo II del profesor (en espera)
