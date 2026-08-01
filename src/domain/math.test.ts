import { describe, expect, it } from "vitest";
import { clamp01, safePercent, safeRatio, widthPercent } from "./math";

describe("safeRatio", () => {
  it("divide normalmente", () => {
    expect(safeRatio(1, 2)).toBe(0.5);
  });

  it("nao explode com denominador zero", () => {
    expect(safeRatio(10, 0)).toBe(0);
    expect(safeRatio(0, 0)).toBe(0);
    expect(safeRatio(10, 0, 1)).toBe(1);
  });

  it("nao propaga NaN nem Infinity", () => {
    expect(safeRatio(Number.NaN, 2)).toBe(0);
    expect(safeRatio(2, Number.NaN)).toBe(0);
    expect(safeRatio(Number.POSITIVE_INFINITY, 2)).toBe(0);
  });
});

describe("widthPercent — o que vai virar largura de CSS", () => {
  it("converte para 0..100", () => {
    expect(widthPercent(1, 4)).toBe(25);
    expect(widthPercent(3, 3)).toBe(100);
  });

  it("nunca passa de 100 nem fica negativo", () => {
    expect(widthPercent(10, 2)).toBe(100);
    expect(widthPercent(-5, 2)).toBe(0);
  });

  it("os seis casos do design que produziriam NaN", () => {
    // donut: c.real / despesas com mes sem despesa
    expect(widthPercent(0, 0)).toBe(0);
    // uso de limite: fechado / estimado com fatura zerada
    expect(widthPercent(0, 0)).toBe(0);
    // rendimento: x.mes / x.saldo com ativo zerado
    expect(widthPercent(148, 0)).toBe(0);
    // ganho: x.saldo / x.aplicado com aplicado zerado
    expect(widthPercent(100, 0)).toBe(0);
    // contas pagas: pagas / billTotal sem contas no mes
    expect(widthPercent(0, 0)).toBe(0);
    // reserva: 18400 / despesas com mes sem despesa
    expect(safeRatio(1840000, 0)).toBe(0);
  });

  it("toda largura gerada e' um numero finito", () => {
    const casos: Array<[number, number]> = [
      [0, 0],
      [1, 0],
      [-1, 0],
      [Number.NaN, 5],
      [5, Number.NaN],
    ];
    for (const [n, dn] of casos) {
      const w = widthPercent(n, dn);
      expect(Number.isFinite(w)).toBe(true);
      expect(`${w}%`).not.toContain("NaN");
    }
  });
});

describe("clamp01", () => {
  it("limita a 0..1", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
  });
});

describe("safePercent", () => {
  it("usa o fallback em escala percentual", () => {
    expect(safePercent(1, 4)).toBe(25);
    expect(safePercent(1, 0)).toBe(0);
    expect(safePercent(1, 0, 100)).toBe(100);
  });
});
