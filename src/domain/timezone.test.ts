import { describe, expect, it } from "vitest";

/**
 * Guarda de configuracao, nao de feature.
 *
 * A Vercel roda em UTC. O bug mais provavel deste projeto e' de fronteira de
 * mes: `new Date()` as 21h30 de Brasilia no dia 31 devolve o dia 1 do mes
 * seguinte. Se a suite rodar no fuso local, ela passa e a producao quebra.
 *
 * Se este teste falhar, o `env.TZ` do vitest.config.ts foi mexido.
 */
describe("ambiente de teste", () => {
  it("roda em UTC", () => {
    expect(new Date().getTimezoneOffset()).toBe(0);
  });

  it("interpreta data sem hora como UTC, nao como local", () => {
    // Em UTC-3 isto voltaria 2026-07-31T21:00 e o `getUTCDate()` daria 31.
    expect(new Date("2026-08-01").getUTCDate()).toBe(1);
  });
});
