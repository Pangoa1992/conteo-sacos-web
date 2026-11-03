import { describe, expect, it } from "vitest";
import { erroresValidacion, esOrigenPrueba, fechaHoyPlanta, hayDiscrepancia } from "@/lib/conteos";
import { estadoRevision, hayDiscrepanciaDiferencia } from "@/lib/reportes-contratista";
import { porcentaje, resumirValidacion, type FilaValidacion } from "@/lib/produccion-validada";

describe("Datos reales frente a datos de prueba", () => {
  it("solo los orígenes que empiezan por «prueba» son de prueba", () => {
    expect(esOrigenPrueba("prueba_vision")).toBe(true);
    expect(esOrigenPrueba("PRUEBA_dev")).toBe(true);
    expect(esOrigenPrueba("vision_ip")).toBe(false);
    expect(esOrigenPrueba(null)).toBe(false);
  });
});

describe("Fecha de la planta (America/Lima)", () => {
  it("a las 20:00 de Lima sigue siendo el mismo día aunque en UTC ya sea el siguiente", () => {
    expect(fechaHoyPlanta(new Date("2026-11-04T01:00:00Z"))).toBe("2026-11-03");
    expect(fechaHoyPlanta(new Date("2026-11-04T05:00:00Z"))).toBe("2026-11-04");
  });
});

describe("Discrepancia IA frente al contratista (umbral |diferencia| > 1)", () => {
  it("una diferencia de 1 saco se tolera; desde 2 es discrepancia", () => {
    expect(hayDiscrepancia(26, 26)).toBe(false);
    expect(hayDiscrepancia(27, 26)).toBe(false);
    expect(hayDiscrepancia(24, 26)).toBe(true);
    expect(hayDiscrepancia(28, 26)).toBe(true);
    expect(hayDiscrepanciaDiferencia(-2)).toBe(true);
    expect(hayDiscrepanciaDiferencia(1)).toBe(false);
  });

  it("una discrepancia queda revisada cuando el lote se valida", () => {
    expect(estadoRevision(false, "pendiente")).toBeNull();
    expect(estadoRevision(true, "pendiente")).toBe("pendiente");
    expect(estadoRevision(true, "aprobado")).toBe("revisada");
    expect(estadoRevision(true, "rechazado")).toBe("revisada");
  });
});

describe("Reglas de validación de un lote", () => {
  const base = { observacion: "", cantidadSacos: 10, conDiscrepancia: false };
  const ok = { conformes: 8, observados: 1, defectuosos: 1 };

  it("aprueba si la clasificación manual suma el total", () => {
    expect(erroresValidacion({ ...base, estado: "aprobado", clasificacion: ok })).toEqual([]);
  });

  it("no aprueba sin clasificación ni con una suma distinta del total", () => {
    expect(erroresValidacion({ ...base, estado: "aprobado", clasificacion: null })).toHaveLength(1);
    expect(erroresValidacion({ ...base, estado: "aprobado", clasificacion: { ...ok, conformes: 9 } })[0]).toMatch(/suma 11 sacos/);
  });

  it("observar o rechazar exige el motivo; rechazar no lleva clasificación", () => {
    expect(erroresValidacion({ ...base, estado: "observado", clasificacion: null })).toEqual(["Indique el motivo en la observación."]);
    expect(erroresValidacion({ ...base, estado: "rechazado", clasificacion: ok, observacion: "x" })).toEqual(["Un conteo rechazado no lleva clasificación."]);
  });

  it("aprobar un lote con discrepancia exige justificarlo", () => {
    expect(erroresValidacion({ ...base, conDiscrepancia: true, estado: "aprobado", clasificacion: ok })).toHaveLength(1);
    expect(erroresValidacion({ ...base, conDiscrepancia: true, estado: "aprobado", clasificacion: ok, observacion: "Recontado en planta" })).toEqual([]);
  });
});

describe("Producción validada", () => {
  const filas: FilaValidacion[] = [
    { estado: "aprobado", esPrueba: false, registros: 2, totalSacos: 50, sacosConformes: 45, sacosObservados: 3, sacosDefectuosos: 2 },
    { estado: "pendiente", esPrueba: false, registros: 1, totalSacos: 20, sacosConformes: 0, sacosObservados: 0, sacosDefectuosos: 0 },
    { estado: "aprobado", esPrueba: true, registros: 5, totalSacos: 99, sacosConformes: 99, sacosObservados: 0, sacosDefectuosos: 0 },
  ];

  it("los datos de prueba no se suman a los reales", () => {
    const r = resumirValidacion(filas, (prueba) => !prueba);
    expect(r.detectado).toEqual({ registros: 3, sacos: 70 });
    expect(r.porEstado.aprobado.sacos).toBe(50);
    expect(r.clasificacionAprobados).toEqual({ conformes: 45, observados: 3, defectuosos: 2 });
  });

  it("sin total no muestra un 0 % engañoso", () => {
    expect(porcentaje(0, 0)).toBeNull();
    expect(porcentaje(45, 50)).toBe(90);
  });
});
