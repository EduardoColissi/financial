import { describe, expect, it } from "vitest";
import { cents } from "./money";
import { plainDate } from "./period";
import { allocate, annualProgress, sectorProgress, sharesAreValid, somaFatias } from "./sectors";

const c = (n: number) => cents(n);
const setor = (id: string, sharePercent: number) => ({ id, sharePercent });
const soma = (a: Array<{ amountCents: number }>) => a.reduce((x, y) => x + y.amountCents, 0);

describe("allocate", () => {
  it("reparte pelas fatias", () => {
    const r = allocate(c(100000), [setor("a", 50), setor("b", 30), setor("c", 20)]);
    expect(r).toEqual([
      { id: "a", amountCents: 50000 },
      { id: "b", amountCents: 30000 },
      { id: "c", amountCents: 20000 },
    ]);
  });

  /**
   * O caso que justifica o modulo existir: 1/3 de R$ 1.000,00 nao e' exato.
   * Sem tratar o resto, some centavo em toda distribuicao.
   */
  it("nao perde centavo quando a divisao nao e' exata", () => {
    const total = 100000;
    const r = allocate(c(total), [setor("a", 33), setor("b", 33), setor("c", 34)]);
    expect(soma(r)).toBe(total);
  });

  it("o resto vai para a maior fatia", () => {
    const r = allocate(c(1000), [setor("a", 33), setor("b", 33), setor("c", 34)]);
    const porId = new Map(r.map((x) => [x.id, x.amountCents]));
    expect(soma(r)).toBe(1000);
    expect(porId.get("c")).toBeGreaterThanOrEqual(porId.get("a") ?? 0);
  });

  /**
   * Fatias que nao somam 100 sao respeitadas: 80% configurados significa que
   * 20% da sobra FICA em caixa. Normalizar seria decidir pelo dono.
   */
  it("nao normaliza fatias que somam menos de 100", () => {
    const r = allocate(c(100000), [setor("a", 50), setor("b", 30)]);
    expect(soma(r)).toBe(80000);
  });

  it("devolve zero para todo mundo quando nao ha' sobra", () => {
    const r = allocate(c(0), [setor("a", 50), setor("b", 50)]);
    expect(soma(r)).toBe(0);
    expect(r).toHaveLength(2);
  });

  it("sobra negativa nao vira aporte", () => {
    const r = allocate(c(-50000), [setor("a", 100)]);
    expect(soma(r)).toBe(0);
  });

  it("setor com fatia zero aparece com zero, nao some da lista", () => {
    const r = allocate(c(100000), [setor("a", 100), setor("b", 0)]);
    expect(r).toHaveLength(2);
    expect(r.find((x) => x.id === "b")?.amountCents).toBe(0);
  });

  it("sem setor nenhum devolve lista vazia", () => {
    expect(allocate(c(100000), [])).toEqual([]);
  });

  it("uma unica fatia de 100% leva tudo", () => {
    expect(allocate(c(123457), [setor("a", 100)])).toEqual([{ id: "a", amountCents: 123457 }]);
  });
});

describe("sharesAreValid", () => {
  it("aceita ate' 100", () => {
    expect(sharesAreValid([setor("a", 60), setor("b", 40)])).toBe(true);
    expect(sharesAreValid([setor("a", 60), setor("b", 20)])).toBe(true);
  });

  /** Prometeria mais dinheiro do que a sobra tem. */
  it("recusa acima de 100", () => {
    expect(sharesAreValid([setor("a", 60), setor("b", 50)])).toBe(false);
  });

  it("soma as fatias", () => {
    expect(somaFatias([setor("a", 60), setor("b", 25)])).toBe(85);
  });
});

describe("sectorProgress", () => {
  const hoje = plainDate("2026-08-04");

  it("calcula percentual e o que falta", () => {
    const p = sectorProgress(c(300000), c(1000000), hoje, null);
    expect(p.percent).toBe(30);
    expect(p.missingCents).toBe(700000);
    expect(p.reached).toBe(false);
    expect(p.monthsLeft).toBeNull();
    expect(p.neededPerMonthCents).toBeNull();
  });

  it("marca atingido e nao passa de 100%", () => {
    const p = sectorProgress(c(1200000), c(1000000), hoje, null);
    expect(p.percent).toBe(100);
    expect(p.missingCents).toBe(0);
    expect(p.reached).toBe(true);
  });

  it("divide o que falta pelos meses restantes", () => {
    // De agosto a dezembro/2026 sao 4 meses.
    const p = sectorProgress(c(0), c(400000), hoje, plainDate("2026-12-01"));
    expect(p.monthsLeft).toBe(4);
    expect(p.neededPerMonthCents).toBe(100000);
  });

  it("arredonda para cima o aporte necessario — faltar centavo nao serve", () => {
    const p = sectorProgress(c(0), c(100001), hoje, plainDate("2026-10-01"));
    expect(p.monthsLeft).toBe(2);
    expect(p.neededPerMonthCents).toBe(50001);
  });

  it("prazo vencido cobra tudo de uma vez", () => {
    const p = sectorProgress(c(10000), c(50000), hoje, plainDate("2026-07-01"));
    expect(p.monthsLeft).toBe(0);
    expect(p.neededPerMonthCents).toBe(40000);
  });

  /**
   * Meta zero nao e' "objetivo cumprido" — e' objetivo nao definido. Devolver
   * 100% encheria a barra e diria que esta' tudo certo.
   */
  it("meta zero nao vira barra cheia", () => {
    const p = sectorProgress(c(500000), c(0), hoje, null);
    expect(p.percent).toBe(0);
    expect(p.reached).toBe(false);
  });
});

describe("annualProgress", () => {
  it("mede o ritmo do ano, nao o objetivo de uma vida", () => {
    const a = annualProgress(c(300000), c(1200000));
    expect(a.percent).toBe(25);
    expect(a.missingCents).toBe(900000);
    expect(a.reached).toBe(false);
  });

  it("passar da meta nao passa de 100%", () => {
    const a = annualProgress(c(1500000), c(1200000));
    expect(a.percent).toBe(100);
    expect(a.missingCents).toBe(0);
    expect(a.reached).toBe(true);
  });

  /**
   * Meta anual nao definida e' o caso COMUM — nem todo setor tem objetivo de
   * ano. Devolver 100% encheria a barra de todos eles no primeiro render.
   */
  it("meta zero nao vira barra cheia", () => {
    const a = annualProgress(c(500000), c(0));
    expect(a.percent).toBe(0);
    expect(a.reached).toBe(false);
  });

  it("ano sem aporte nenhum fica em zero, e nao em negativo", () => {
    const a = annualProgress(c(0), c(1000000));
    expect(a.percent).toBe(0);
    expect(a.missingCents).toBe(1000000);
  });
});
