// Complemento de los datos de prueba (se ejecuta después de cargar_datos_prueba.sql, desde cargar_datos_prueba.sh):
//   · 3 usuarios de prueba: un administrador, un cliente (dueño de la fábrica) y un ex operador DESACTIVADO;
//   · 10 lotes «Contar por foto» (origen prueba_foto) con la foto como evidencia y el conteo manual como reporte del
//     contratista (las 10 fotos reales de la prueba de exactitud: así las discrepancias son reales);
//   · 1 lote «Contar por video» (origen prueba_video) con un fotograma como evidencia;
//   · evidencias en 3 lotes de cámara, una de ellas anulada con motivo.
// Las fotos NO están en el repositorio: se leen de la carpeta indicada (por defecto D:\PROYECTO\PRUEBA_EXACTITUD).
//
// Uso: node cargar_complementos.cjs <base_de_datos> [carpeta_prueba_exactitud] [carpeta_detector]
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const WEB = path.resolve(__dirname, "..");
const req = (m) => require(path.join(WEB, "node_modules", m));
const postgres = req("postgres"), sharp = req("sharp"), bcrypt = req("bcryptjs");

const [BD, EXACTITUD = "D:/PROYECTO/PRUEBA_EXACTITUD", DETECTOR = "D:/PROYECTO/contador-sacos"] = process.argv.slice(2);
if (!/^[a-z0-9_]+$/.test(BD || "")) { console.error("Uso: node cargar_complementos.cjs <base_de_datos>"); process.exit(2); }
// Contraseña de los usuarios de PRUEBA (solo existen en bases de prueba; nunca en producción).
const CLAVE_PRUEBA = "Prueba-MACROMEC-2026";

const env = Object.fromEntries(fs.readFileSync(path.join(WEB, ".env.local"), "utf8").split(/\r?\n/)
  .filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const url = new URL(env.DATABASE_URL);
if (!["localhost", "127.0.0.1"].includes(url.hostname)) { console.error("Solo se admite la base local."); process.exit(1); }
url.pathname = "/" + BD;
const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });

/** Foto como la guarda el panel: orientación aplicada, sin metadatos, ≤ 1600 px, JPEG; miniatura 320 px. */
async function procesar(archivo) {
  const { data: imagen, info } = await sharp(fs.readFileSync(archivo)).rotate()
    .resize(1600, 1600, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  const miniatura = await sharp(imagen).resize(320, 320, { fit: "inside" }).jpeg({ quality: 70, mozjpeg: true }).toBuffer();
  return { imagen, miniatura, ancho: info.width, alto: info.height, sha256: crypto.createHash("sha256").update(imagen).digest("hex") };
}

async function evidencia(tx, conteoId, archivo, descripcion, subidoPor, subidoEn) {
  const f = await procesar(archivo);
  const [e] = await tx`insert into evidencias (conteo_id, descripcion, sha256, mime, bytes, ancho, alto, bytes_miniatura, tomada_en, subido_por, subido_en)
    values (${conteoId}, ${descripcion}, ${f.sha256}, 'image/jpeg', ${f.imagen.length}, ${f.ancho}, ${f.alto}, ${f.miniatura.length}, ${subidoEn}, ${subidoPor}, ${subidoEn})
    returning id`;
  await tx`insert into evidencias_contenido (evidencia_id, imagen, miniatura) values (${e.id}, ${f.imagen}, ${f.miniatura})`;
  return e.id;
}

/** Fecha en UTC a partir de la hora de Lima (UTC-5). */
const lima = (dia, hora) => new Date(`${dia}T${hora}:00-05:00`);
const masHoras = (d, h) => new Date(d.getTime() + h * 3600_000);

(async () => {
  try {
    const [bd] = await sql`select coalesce(shobj_description(oid, 'pg_database'), '') as c from pg_database where datname = current_database()`;
    if (!bd.c.startsWith("SOLO DATOS DE")) throw new Error("La base no está marcada como de prueba/demostración.");
    const [ya] = await sql`select count(*)::int as n from conteos where id_externo like 'seed\\_foto\\_%'`;
    if (ya.n > 0) throw new Error("Los complementos ya están cargados en esta base (id_externo seed_foto_*).");
    const filas = fs.readFileSync(path.join(EXACTITUD, "resultados_por_foto.csv"), "utf8").replace(/^\uFEFF/, "").trim().split(/\r?\n/).slice(1)
      .map((l) => l.match(/("[^"]*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "")))
      .map(([n, archivo, manual, ia, , , , conf]) => ({ n, archivo, manual: +manual, ia: +ia, conf: Number(conf.replace(",", ".")) }));
    if (filas.length !== 10) throw new Error(`Se esperaban 10 fotos en resultados_por_foto.csv y hay ${filas.length}.`);

    const resumen = await sql.begin(async (tx) => {
      const [admin] = await tx`select id from usuarios where rol = 'admin_macromec' order by id limit 1`;
      // ---- Usuarios ----
      const hash = await bcrypt.hash(CLAVE_PRUEBA, 10);
      const usuarios = [
        ["Supervisora de planta (prueba)", "supervisora.prueba@macromec.local", "admin_macromec", true],
        ["Dueño de la fábrica (prueba)", "dueno.prueba@macromec.local", "cliente", true],
        ["Ex operador (prueba, desactivado)", "ex.operador.prueba@macromec.local", "cliente", false],
      ];
      let nuevosUsuarios = 0;
      for (const [nombre, correo, rol, activo] of usuarios) {
        const r = await tx`insert into usuarios (nombre, correo, password_hash, rol, activo, sesion_version, creado_en)
          values (${nombre}, ${correo}, ${hash}, ${rol}, ${activo}, ${activo ? 0 : 1}, ${lima("2026-10-12", "08:00")})
          on conflict (correo) do nothing returning id`;
        nuevosUsuarios += r.length;
      }
      const [supervisora] = await tx`select id from usuarios where correo = 'supervisora.prueba@macromec.local'`;

      // ---- 10 lotes «Contar por foto» ----
      const contratistas = ["Contratista Quispe", "Contratista Huamán", "Contratista Rojas"];
      let fotos = 0;
      for (const [i, f] of filas.entries()) {
        const dia = `2026-11-${String(3 + i).padStart(2, "0")}`;
        const contado = lima(dia, "15:30");
        // Aprobado si la IA coincide con el conteo manual o difiere en 1; observado si el contratista reporta
        // bastante más (sacos del fondo que la IA no vio); las 2 últimas quedan pendientes.
        const dif = f.manual - f.ia;
        const estado = i >= 8 ? "pendiente" : Math.abs(dif) <= 1 ? "aprobado" : "observado";
        const obs = estado === "observado" ? `El contratista reporta ${f.manual} sacos: la foto no muestra completos los sacos del fondo; se recuenta en planta.` : null;
        const [c] = await tx`insert into conteos (cantidad_sacos, origen, fuente_camara, confianza_promedio, id_externo, contado_en, creado_en,
            estado_validacion, sacos_conformes, sacos_observados, sacos_defectuosos, validado_por, validado_en, observacion_validacion)
          values (${f.ia}, 'prueba_foto', 'foto_celular', ${f.conf}, ${"seed_foto_" + f.n}, ${contado}, ${masHoras(contado, 0.05)},
            ${estado}, ${estado === "pendiente" ? null : f.ia}, ${estado === "pendiente" ? null : 0}, ${estado === "pendiente" ? null : 0},
            ${estado === "pendiente" ? null : supervisora.id}, ${estado === "pendiente" ? null : masHoras(contado, 2)}, ${obs})
          returning id`;
        if (estado !== "pendiente") {
          await tx`insert into validaciones_conteo (conteo_id, estado_anterior, estado, sacos_conformes, sacos_observados, sacos_defectuosos, observacion, usuario_id, creado_en)
            values (${c.id}, 'pendiente', ${estado}, ${f.ia}, 0, 0, ${obs}, ${supervisora.id}, ${masHoras(contado, 2)})`;
        }
        await tx`insert into reportes_contratista (cantidad_reportada, nombre_contratista, conteo_id, creado_en)
          values (${f.manual}, ${contratistas[i % 3]}, ${c.id}, ${masHoras(contado, 1)})`;
        const archivo = path.join(EXACTITUD, "fotos_originales", f.archivo);
        await evidencia(tx, c.id, archivo, `Foto del lote tomada con el celular y contada con «Contar por foto» (${f.ia} sacos)`, admin.id, contado);
        fotos++;
      }

      // ---- 1 lote «Contar por video» ----
      const contadoVideo = lima("2026-11-12", "10:20");
      const [v] = await tx`insert into conteos (cantidad_sacos, origen, fuente_camara, confianza_promedio, id_externo, contado_en, creado_en)
        values (8, 'prueba_video', 'video_panel', 93.25, 'seed_video_01', ${contadoVideo}, ${masHoras(contadoVideo, 0.1)}) returning id`;
      await evidencia(tx, v.id, path.join(DETECTOR, "frame_real_05s.jpg"),
        "Fotograma del video analizado con «Contar por video»: 8 sacos cruzaron la línea de conteo", admin.id, contadoVideo);

      // ---- Evidencias en lotes de cámara (la última se anula) ----
      const lotesCamara = await tx`select id, contado_en from conteos where id_externo like 'seed\\_2026%' and estado_validacion = 'aprobado' order by contado_en desc limit 3`;
      const frames = ["frame_real_02s.jpg", "frame_real_08s.jpg", "prueba_lavadero.jpeg"];
      let anulada = null;
      for (const [i, l] of lotesCamara.entries()) {
        const id = await evidencia(tx, l.id, path.join(DETECTOR, frames[i]), i === 2 ? "Fila de sacos antes de cargar (foto movida)" : "Fila de sacos lista para despacho", supervisora.id, masHoras(l.contado_en, 1));
        if (i === 2) anulada = id;
      }
      if (anulada) {
        await tx`update evidencias set anulada_en = now(), anulada_por = ${admin.id}, motivo_anulacion = 'Foto movida: no se distinguen los sacos; se reemplazará por otra.' where id = ${anulada}`;
      }
      return { nuevosUsuarios, fotos, evidenciasCamara: lotesCamara.length };
    });
    console.log(`Complementos cargados en ${BD}: ${resumen.nuevosUsuarios} usuarios de prueba, ${resumen.fotos} lotes por foto con su evidencia, ` +
      `1 lote por video, ${resumen.evidenciasCamara} evidencias en lotes de cámara (1 anulada).`);
  } catch (err) {
    console.error("No se cargaron los complementos:", err.message);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
})();
