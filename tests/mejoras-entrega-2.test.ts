import { describe, expect, it } from "vitest";
import {
  esMesValido, etiquetaMes, mesesDisponibles, rangoMes, resumirPorMes, type FilaValidacionMensual,
} from "@/lib/produccion-validada";
import {
  contarEntradasNoValidas, interpretarComando, leerContactosAutorizados, leerNumerosAutorizados, mesConsultado, TEXTO_AYUDA,
} from "@/lib/whatsapp";
import { textoResultadoFoto } from "@/lib/whatsapp-foto";
import { estadoFoto } from "@/lib/bitacora-whatsapp";

// Observaciones de la entrega del 20/11/2026: consulta por mes y destino de los datos de WhatsApp.

const fila = (mes: string, estado: FilaValidacionMensual["estado"], totalSacos: number, esPrueba = false, conformes = 0): FilaValidacionMensual => ({
  mes, estado, esPrueba, registros: 1, totalSacos, sacosConformes: conformes, sacosObservados: 0, sacosDefectuosos: 0,
});

describe("Producción validada por mes", () => {
  it("valida y nombra los meses", () => {
    expect(esMesValido("2026-10")).toBe(true);
    expect(esMesValido("2026-13")).toBe(false);
    expect(esMesValido("2026-1")).toBe(false);
    expect(etiquetaMes("2026-10")).toBe("octubre 2026");
  });

  it("da el primer y último día del mes, también febrero bisiesto", () => {
    expect(rangoMes("2026-11")).toEqual({ desde: "2026-11-01", hasta: "2026-11-30" });
    expect(rangoMes("2028-02")).toEqual({ desde: "2028-02-01", hasta: "2028-02-29" });
    expect(rangoMes("2026-12")).toEqual({ desde: "2026-12-01", hasta: "2026-12-31" });
  });

  it("ofrece el mes actual y los meses con lotes de la vista, del más reciente al más antiguo", () => {
    const filas = [fila("2026-09", "aprobado", 10), fila("2026-10", "pendiente", 5), fila("2026-08", "aprobado", 3, true)];
    expect(mesesDisponibles(filas, "2026-11-21", (p) => !p)).toEqual(["2026-11", "2026-10", "2026-09"]);
    expect(mesesDisponibles(filas, "2026-11-21", (p) => p)).toEqual(["2026-11", "2026-08"]);
  });

  it("compara mes a mes sin mezclar reales con prueba", () => {
    const filas = [
      fila("2026-10", "aprobado", 100, false, 95), fila("2026-10", "pendiente", 20),
      fila("2026-11", "aprobado", 50, false, 50), fila("2026-11", "aprobado", 999, true, 999),
    ];
    const r = resumirPorMes(filas, (p) => !p);
    expect(r.map((m) => m.mes)).toEqual(["2026-11", "2026-10"]);
    expect(r[1].detectado.sacos).toBe(120);
    expect(r[1].porEstado.aprobado.sacos).toBe(100);
    expect(r[1].clasificacionAprobados.conformes).toBe(95);
    expect(r[0].detectado.sacos).toBe(50);
  });
});

describe("WhatsApp: comando «mes» para consultar meses anteriores", () => {
  it("reconoce el mes actual, un número, un nombre y el año", () => {
    expect(interpretarComando("mes")).toEqual({ tipo: "mes", mes: null, anio: null });
    expect(interpretarComando("Mes 10")).toEqual({ tipo: "mes", mes: 10, anio: null });
    expect(interpretarComando("mes 10/2025")).toEqual({ tipo: "mes", mes: 10, anio: 2025 });
    expect(interpretarComando("mes de octubre")).toEqual({ tipo: "mes", mes: 10, anio: null });
    expect(interpretarComando("Septiembre 2026")).toEqual({ tipo: "mes", mes: 9, anio: 2026 });
    expect(interpretarComando("octubre de 2025")).toEqual({ tipo: "mes", mes: 10, anio: 2025 });
    expect(interpretarComando("mes 13")).toEqual({ tipo: "mes_invalido" });
    expect(interpretarComando("mes pasado mañana")).toEqual({ tipo: "mes_invalido" });
  });

  it("los comandos anteriores no cambian", () => {
    expect(interpretarComando("hoy")).toEqual({ tipo: "hoy" });
    expect(interpretarComando("lote 12")).toEqual({ tipo: "lote", lote: 12 });
    expect(interpretarComando("buenas tardes")).toEqual({ tipo: "saludo" });
  });

  it("sin año usa este año, o el pasado si el mes aún no llega", () => {
    expect(mesConsultado({ mes: null, anio: null }, "2026-11-21")).toBe("2026-11");
    expect(mesConsultado({ mes: 10, anio: null }, "2026-11-21")).toBe("2026-10");
    expect(mesConsultado({ mes: 12, anio: null }, "2026-11-21")).toBe("2025-12");
    expect(mesConsultado({ mes: 3, anio: 2024 }, "2026-11-21")).toBe("2024-03");
  });

  it("la ayuda menciona el comando y que la foto queda en el panel", () => {
    expect(TEXTO_AYUDA).toContain("*mes*");
    expect(TEXTO_AYUDA).toContain("queda en el panel");
  });
});

describe("WhatsApp: quién lo usa (contactos con nombre)", () => {
  it("acepta «Nombre=+51…» y números solos", () => {
    const c = leerContactosAutorizados("Juan Pérez=+51987654321, +51 912-345-678; Ana=PE.1111111111111111");
    expect(c.get("+51987654321")).toBe("Juan Pérez");
    expect(c.get("+51912345678")).toBeNull();
    expect(c.get("PE.1111111111111111")).toBe("Ana");
    expect(leerNumerosAutorizados("Juan=+51987654321").has("+51987654321")).toBe(true);
  });

  it("cuenta como no válida una entrada con nombre pero sin número válido", () => {
    expect(contarEntradasNoValidas("Juan=123, Ana=+51987654321")).toBe(1);
  });

  it("limpia el nombre (sin etiquetas ni caracteres de control, máx. 60)", () => {
    const c = leerContactosAutorizados(`<b>Jefe</b>=+51987654321, ${"x".repeat(80)}=+51912345678`);
    expect(c.get("+51987654321")).toBe("bJefe/b");
    expect(c.get("+51912345678")).toHaveLength(60);
  });
});

describe("WhatsApp: adónde van las fotos", () => {
  it("con n.º de bandeja avisa que la foto quedó en el panel para registrarla", () => {
    const t = textoResultadoFoto({ total: 12, confianzaPromedio: 90 }, 1, 7);
    expect(t).toContain("Sacos contados: *12*");
    expect(t).toContain("n.º 7");
    expect(t).not.toContain("no se registra como lote");
  });

  it("estado de la foto en la bandeja", () => {
    expect(estadoFoto({ tieneFoto: true, conteoId: null, descartada: false })).toBe("pendiente");
    expect(estadoFoto({ tieneFoto: true, conteoId: 5, descartada: false })).toBe("registrada");
    expect(estadoFoto({ tieneFoto: true, conteoId: null, descartada: true })).toBe("descartada");
    expect(estadoFoto({ tieneFoto: false, conteoId: null, descartada: false })).toBe("sin_foto");
  });
});
