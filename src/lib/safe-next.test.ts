import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("destino pos-login", () => {
  it("aceita caminho interno", () => {
    expect(safeNext("/2026-08/cartoes")).toBe("/2026-08/cartoes");
    expect(safeNext("/2026-08?novo=1")).toBe("/2026-08?novo=1");
  });

  it("recusa host externo em todas as formas conhecidas", () => {
    for (const hostil of [
      "https://exemplo.invalid/roubo",
      "//exemplo.invalid/roubo",
      "/\\exemplo.invalid",
      "/caminho\\..\\..",
      "http://exemplo.invalid",
      "javascript:alert(1)",
    ]) {
      expect(safeNext(hostil), hostil).toBe("/");
    }
  });

  it("cai na raiz quando nao ha' destino", () => {
    expect(safeNext(undefined)).toBe("/");
    expect(safeNext(null)).toBe("/");
    expect(safeNext("")).toBe("/");
  });
});
