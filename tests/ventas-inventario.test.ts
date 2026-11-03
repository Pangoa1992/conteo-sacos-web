import { describe, expect, it } from "vitest";
import {
  calcularImporte, centimosATexto, errorValidacionConVentas, esRechazoDeVentaEnBD, nuevaClaveIdempotencia, precioEnCentimos,
} from "@/lib/ventas";
import { celdaCsv, construirCsv, esFechaValida, estadoStock, leerFiltros } from "@/lib/inventario";
import { mensajeErrorBD } from "@/lib/errores-bd";
import { DrizzleQueryError } from "drizzle-orm/errors";

describe("Importes de ventas sin errores de coma flotante", () => {
  it("convierte precios a céntimos y rechaza más de 2 decimales, cero o negativos", () => {
    expect(precioEnCentimos(8.5)).toBe(850);
    expect(precioEnCentimos(0.1 + 0.2)).toBe(30); // 0.30000000000000004: tolera el error de coma flotante
    expect(precioEnCentimos(8.505)).toBeNull();
    expect(precioEnCentimos(0)).toBeNull();
    expect(precioEnCentimos(-3)).toBeNull();
    expect(precioEnCentimos(Number.NaN)).toBeNull();
  });

  it("calcula cantidad × precio exactamente y respeta el máximo de la columna", () => {
    expect(calcularImporte(26, 850)).toBe("221.00");
    expect(calcularImporte(3, 1001)).toBe("30.03");
    expect(calcularImporte(10 ** 9, 10 ** 6)).toBeNull();
    expect(centimosATexto(5)).toBe("0.05");
  });
});

describe("Ventas y validación del lote", () => {
  it("un lote con ventas activas no puede dejar de estar aprobado ni bajar sus conformes", () => {
    expect(errorValidacionConVentas(0, "rechazado", null)).toBeNull();
    expect(errorValidacionConVentas(5, "observado", null)).toMatch(/solo puede seguir aprobado/);
    expect(errorValidacionConVentas(5, "aprobado", 4)).toMatch(/no pueden ser menos de 5/);
    expect(errorValidacionConVentas(5, "aprobado", 5)).toBeNull();
  });

  it("genera claves de idempotencia UUID v4 únicas", () => {
    const a = nuevaClaveIdempotencia();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(nuevaClaveIdempotencia()).not.toBe(a);
  });

  it("reconoce el rechazo de los triggers de stock de PostgreSQL", () => {
    expect(esRechazoDeVentaEnBD(new Error("ERROR: venta: stock insuficiente en el lote 3"))).toBe("stock insuficiente en el lote 3");
    expect(esRechazoDeVentaEnBD(new Error("otra cosa"))).toBeNull();
  });

  it("lo reconoce también cuando drizzle envuelve el error (DrizzleQueryError, drizzle ≥ 0.44)", () => {
    const envuelto = new DrizzleQueryError("insert into ventas_lote ...", ["Comprador S.A.", 26], new Error("venta: stock insuficiente en el lote 3"));
    expect(esRechazoDeVentaEnBD(envuelto)).toBe("stock insuficiente en el lote 3");
  });
});

describe("Registros de errores de la base de datos", () => {
  it("registran solo el error original, nunca la consulta ni sus parámetros", () => {
    const envuelto = new DrizzleQueryError("select * from usuarios where correo = $1", ["admin@macromec.local"], new Error("connection refused"));
    expect(envuelto.message).toContain("admin@macromec.local"); // lo que se filtraría sin la protección
    expect(mensajeErrorBD(envuelto)).toBe("connection refused");
    expect(mensajeErrorBD(new Error("directo"))).toBe("directo");
    expect(mensajeErrorBD(42)).toBe("error desconocido");
  });
});

describe("Inventario", () => {
  it("estado de stock y fechas de calendario válidas", () => {
    expect(estadoStock(3)).toBe("con_stock");
    expect(estadoStock(0)).toBe("agotado");
    expect(esFechaValida("2026-02-28")).toBe(true);
    expect(esFechaValida("2026-02-30")).toBe(false);
    expect(esFechaValida("03/11/2026")).toBe(false);
  });

  it("valida los filtros recibidos por la URL", () => {
    expect(leerFiltros(new URLSearchParams("desde=2026-11-03&hasta=2026-11-01"))).toHaveProperty("errores");
    expect(leerFiltros(new URLSearchParams("stock=todo"))).toHaveProperty("errores");
    expect(leerFiltros(new URLSearchParams(""))).toEqual({ filtros: { desde: null, hasta: null, origen: null, stock: "todos", tipo: "real" } });
  });
});

describe("Exportación CSV segura para Excel", () => {
  it("neutraliza fórmulas (inyección CSV) y escapa comillas", () => {
    expect(celdaCsv("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(celdaCsv("+51999")).toBe("\"'+51999\"");
    expect(celdaCsv(-5)).toBe("\"-5\""); // los números negativos no se alteran
    expect(celdaCsv(null)).toBe("\"\"");
  });

  it("incluye BOM UTF-8 y fin de línea CRLF", () => {
    const csv = construirCsv([["Lote", "Sacos"], [1, 26]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe("\"Lote\",\"Sacos\"\r\n\"1\",\"26\"\r\n");
  });
});
