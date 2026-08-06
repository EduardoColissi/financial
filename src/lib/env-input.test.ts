import { describe, expect, it } from "vitest";
import { withoutBlanks } from "./env-input";

describe("withoutBlanks", () => {
  it("remove a chave de valor vazio em vez de deixar string vazia", () => {
    const out = withoutBlanks({ SINGLE_USER_ID: "" });
    expect("SINGLE_USER_ID" in out).toBe(false);
  });

  it("remove tambem valor so' com espaco", () => {
    const out = withoutBlanks({ CRON_SECRET: "   " });
    expect("CRON_SECRET" in out).toBe(false);
  });

  it("preserva valor real, inclusive com espaco nas pontas", () => {
    const out = withoutBlanks({ APP_TIMEZONE: "America/Sao_Paulo", A: " x " });
    expect(out.APP_TIMEZONE).toBe("America/Sao_Paulo");
    // Nao faz trim do que sobrou: alterar valor e' outra responsabilidade.
    expect(out.A).toBe(" x ");
  });

  it("nao inventa chave que nao existia", () => {
    expect(Object.keys(withoutBlanks({}))).toHaveLength(0);
  });
});
