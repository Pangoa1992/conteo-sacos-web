import { describe, expect, it } from "vitest";
import {
  contarEntradasNoValidas, enmascararNumero, interpretarComando, leerNumerosAutorizados, limitarRespuesta, marcarDemo, normalizarNumero, ETIQUETA_DEMO,
} from "@/lib/whatsapp";
import { estadoConfiguracionWhatsapp } from "@/lib/estado-whatsapp";
import { leerFiltrosHistorial, parametrosHistorial } from "@/lib/historial";
import { leerFiltrosReportes, normalizarContratista, parametrosFiltrosReportes } from "@/lib/reportes-contratista";

describe("Comandos de WhatsApp", () => {
  it("reconoce los comandos por la primera palabra, sin tildes ni mayúsculas", () => {
    expect(interpretarComando("Último")).toEqual({ tipo: "ultimo" });
    expect(interpretarComando("¿HOY?")).toEqual({ tipo: "hoy" });
    expect(interpretarComando("semana")).toEqual({ tipo: "semana" });
    expect(interpretarComando("Discrepancia")).toEqual({ tipo: "discrepancias" });
    expect(interpretarComando("menú")).toEqual({ tipo: "ayuda" });
  });

  it("interpreta «lote N» y rechaza números no válidos", () => {
    expect(interpretarComando("lote 123")).toEqual({ tipo: "lote", lote: 123 });
    expect(interpretarComando("Lote N° 45")).toEqual({ tipo: "lote", lote: 45 });
    expect(interpretarComando("lote 0")).toEqual({ tipo: "lote_invalido" });
    expect(interpretarComando("lote abc")).toEqual({ tipo: "lote_invalido" });
  });

  it("una pregunta libre sobre sacos responde el último lote; lo demás, la ayuda", () => {
    expect(interpretarComando("¿cuántos sacos van?")).toEqual({ tipo: "ultimo" });
    expect(interpretarComando("buenas tardes")).toEqual({ tipo: "saludo" });
  });
});

describe("Números autorizados de WhatsApp", () => {
  it("normaliza el formato internacional y descarta entradas mal escritas", () => {
    expect(normalizarNumero("whatsapp:+51 987 654 321")).toBe("+51987654321");
    expect(normalizarNumero("987654321")).toBeNull();
    const lista = leerNumerosAutorizados("+51987654321, +51 912-345-678; 123");
    expect([...lista]).toEqual(["+51987654321", "+51912345678"]);
    expect(contarEntradasNoValidas("+51987654321, 123,")).toBe(1);
  });

  it("acepta el identificador privado de WhatsApp («PE.…») en lugar del teléfono, comparado exacto", () => {
    expect(normalizarNumero("whatsapp:PE.1111111111111111")).toBe("PE.1111111111111111");
    expect(normalizarNumero(" PE.1111111111111111 ")).toBe("PE.1111111111111111");
    expect(normalizarNumero("pe.1111111111111111")).toBeNull();
    expect(normalizarNumero("PE.123")).toBeNull();
    expect(normalizarNumero("PE.11111 11111111111")).toBeNull();
    const lista = leerNumerosAutorizados("+51987654321, PE.1111111111111111");
    expect([...lista]).toEqual(["+51987654321", "PE.1111111111111111"]);
    expect(lista.has(normalizarNumero("whatsapp:PE.1111111111111111")!)).toBe(true);
    expect(lista.has(normalizarNumero("whatsapp:PE.1111111111111112")!)).toBe(false);
    expect(contarEntradasNoValidas("PE.1111111111111111, PE.1")).toBe(1);
  });

  it("lista vacía = nadie recibe datos", () => {
    expect(leerNumerosAutorizados(undefined).size).toBe(0);
    expect(leerNumerosAutorizados("").size).toBe(0);
  });

  it("los números nunca se registran completos", () => {
    expect(enmascararNumero("+51987654321")).toBe("+51•••••••21");
    expect(enmascararNumero("basura")).toBe("(número no válido)");
    expect(enmascararNumero("whatsapp:PE.1111111111111111")).toBe("PE.•••11");
  });
});

describe("Respuestas de WhatsApp", () => {
  it("respetan el límite de 1.600 caracteres de Twilio", () => {
    const largo = Array.from({ length: 200 }, (_, i) => `Lote ${i}: 26 sacos`).join("\n");
    const r = limitarRespuesta(largo);
    expect(r.length).toBeLessThanOrEqual(1600);
    expect(r.endsWith("…")).toBe(true);
  });

  it("en modo de demostración cada respuesta lleva la etiqueta de datos de prueba", () => {
    expect(marcarDemo("Último lote: 26 sacos")).toContain(ETIQUETA_DEMO);
  });

  it("el estado del panel no expone el token: solo indica si está configurado", () => {
    const e = estadoConfiguracionWhatsapp({ TWILIO_AUTH_TOKEN: "secreto", TWILIO_WEBHOOK_URL: "http://inseguro", WHATSAPP_NUMEROS_AUTORIZADOS: "+51987654321,x" });
    expect(e).toEqual({ webhookHabilitado: true, urlPublica: "no_https", numerosAutorizados: 1, entradasNoValidas: 1 });
    expect(JSON.stringify(e)).not.toContain("secreto");
    expect(estadoConfiguracionWhatsapp({}).webhookHabilitado).toBe(false);
  });
});

describe("Filtros del historial (pantalla y CSV usan los mismos)", () => {
  it("lee, valida y vuelve a escribir los filtros sin perder información", () => {
    const r = leerFiltrosHistorial(new URLSearchParams("tipo=todos&camara=poza&desde=2026-10-01&discrepancias=1&validacion=aprobado"));
    expect(r).toHaveProperty("filtros");
    if (!("filtros" in r)) return;
    expect(parametrosHistorial(r.filtros).toString()).toBe("tipo=todos&camara=poza&desde=2026-10-01&discrepancias=1&validacion=aprobado");
  });

  it("rechaza valores fuera de la lista permitida", () => {
    expect(leerFiltrosHistorial(new URLSearchParams("tipo=produccion"))).toHaveProperty("errores");
    expect(leerFiltrosHistorial(new URLSearchParams("validacion=borrado"))).toHaveProperty("errores");
    expect(leerFiltrosHistorial(new URLSearchParams("camara=" + "x".repeat(101)))).toHaveProperty("errores");
  });
});

describe("Filtros de reportes del contratista", () => {
  it("normaliza el nombre y distingue «sin nombre» (-) de «todos» (vacío)", () => {
    expect(normalizarContratista("  CARLOS ")).toBe("carlos");
    const sinNombre = leerFiltrosReportes(new URLSearchParams("contratista=-"));
    expect(sinNombre).toHaveProperty("filtros.contratista", "");
    const todos = leerFiltrosReportes(new URLSearchParams("contratista="));
    expect(todos).toHaveProperty("filtros.contratista", null);
    if ("filtros" in sinNombre) expect(parametrosFiltrosReportes(sinNombre.filtros).get("contratista")).toBe("-");
  });

  it("el lote debe ser un número positivo", () => {
    expect(leerFiltrosReportes(new URLSearchParams("lote=12"))).toHaveProperty("filtros.lote", 12);
    expect(leerFiltrosReportes(new URLSearchParams("lote=-1"))).toHaveProperty("errores");
  });
});
