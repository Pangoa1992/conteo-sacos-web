import { describe, expect, it } from "vitest";
import { BLOQUEO_LOGIN_MS, MAXIMO_INTENTOS_LOGIN, mensajeBloqueo, restanteBloqueo, trasFallo } from "@/lib/limite-login";

const AHORA = Date.UTC(2026, 10, 5, 18, 0, 0);

describe("Límite de intentos de inicio de sesión", () => {
  it("los primeros fallos solo suman", () => {
    expect(trasFallo(0, AHORA)).toEqual({ intentosFallidos: 1, bloqueadoHasta: null });
    expect(trasFallo(MAXIMO_INTENTOS_LOGIN - 2, AHORA)).toEqual({ intentosFallidos: MAXIMO_INTENTOS_LOGIN - 1, bloqueadoHasta: null });
  });

  it("el 5.º fallo bloquea 15 minutos y reinicia el contador", () => {
    const r = trasFallo(MAXIMO_INTENTOS_LOGIN - 1, AHORA);
    expect(r.intentosFallidos).toBe(0);
    expect(r.bloqueadoHasta?.getTime()).toBe(AHORA + BLOQUEO_LOGIN_MS);
    expect(BLOQUEO_LOGIN_MS).toBe(15 * 60 * 1000);
  });

  it("calcula lo que falta del bloqueo", () => {
    expect(restanteBloqueo(null, AHORA)).toBe(0);
    expect(restanteBloqueo(new Date(AHORA - 1), AHORA)).toBe(0);
    expect(restanteBloqueo(new Date(AHORA + 90_000), AHORA)).toBe(90_000);
  });

  it("el mensaje indica los minutos que faltan, redondeados hacia arriba", () => {
    expect(mensajeBloqueo(BLOQUEO_LOGIN_MS)).toMatch(/15 minutos/);
    expect(mensajeBloqueo(61_000)).toMatch(/2 minutos/);
    expect(mensajeBloqueo(1_000)).toMatch(/1 minuto o/);
  });
});
