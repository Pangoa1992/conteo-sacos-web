export type ConteoResumido = {
  id: number;
  cantidadSacos: number;
  creadoEn: string;
  esPrueba: boolean;
};

/** Muestra contra qué conteo se va a registrar un reporte o una venta. */
export function ConteoObjetivo({ conteo }: { conteo?: ConteoResumido }) {
  if (!conteo) {
    return <p className="objetivo objetivo-vacio">No hay ningún conteo disponible en la vista actual.</p>;
  }
  return (
    <p className={`objetivo ${conteo.esPrueba ? "objetivo-prueba" : ""}`}>
      Se registrará sobre el conteo <strong>#{conteo.id}</strong>: {conteo.cantidadSacos.toLocaleString("es-PE")} sacos ·{" "}
      {new Date(conteo.creadoEn).toLocaleString("es-PE")}
      {conteo.esPrueba && (
        <>
          {" "}<span className="badge badge-prueba">Prueba</span> — es un dato de prueba, no una detección real.
        </>
      )}
    </p>
  );
}
