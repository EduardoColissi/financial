import { describe, expect, it } from "vitest";
import {
  absCents,
  addCents,
  brl,
  brl0,
  cents,
  compactK,
  fromReais,
  MASK,
  MoneyError,
  maxCents,
  multiplyCents,
  parseBRL,
  pct,
  pp,
  signedBrl,
  splitInstallments,
  subCents,
  sumCents,
  toReais,
  ZERO,
} from "./money";

describe("cents", () => {
  it("recusa nao-inteiro", () => {
    expect(() => cents(10.5)).toThrow(MoneyError);
  });

  it("recusa valor fora da faixa do integer do postgres", () => {
    expect(() => cents(3_000_000_000)).toThrow(MoneyError);
  });
});

describe("fromReais", () => {
  it("converte sem perder centavo", () => {
    expect(fromReais(2959.9)).toBe(295990);
    expect(fromReais(1186.42)).toBe(118642);
    expect(fromReais(0.1)).toBe(10);
  });

  it("nao sofre com a representacao binaria de float", () => {
    // 19.99 * 100 === 1998.9999999999998 em ponto flutuante.
    expect(fromReais(19.99)).toBe(1999);
    expect(fromReais(1.005)).toBe(101);
  });

  it("ida e volta preserva o valor", () => {
    for (const reais of [0, 0.01, 1, 12.34, 999.99, 12400, 7389.45]) {
      expect(toReais(fromReais(reais))).toBe(reais);
    }
  });
});

describe("splitInstallments", () => {
  it("distribui o resto na primeira parcela", () => {
    expect(splitInstallments(cents(10000), 3)).toEqual([3334, 3333, 3333]);
  });

  it("divide exato quando cabe", () => {
    expect(splitInstallments(cents(30000), 3)).toEqual([10000, 10000, 10000]);
  });

  it("aceita parcela unica", () => {
    expect(splitInstallments(cents(12345), 1)).toEqual([12345]);
  });

  it("INVARIANTE: a soma das parcelas e' sempre exatamente o total", () => {
    // E' isto que o design erra: `nvVal / nvParc` em float nao fecha.
    for (let total = 1; total <= 2000; total += 7) {
      for (let count = 1; count <= 12; count++) {
        const parts = splitInstallments(cents(total), count);
        expect(parts).toHaveLength(count);
        expect(sumCents(parts)).toBe(total);
      }
    }
  });

  it("preserva o sinal em valores negativos", () => {
    const parts = splitInstallments(cents(-10000), 3);
    expect(sumCents(parts)).toBe(-10000);
  });

  it("recusa contagem invalida", () => {
    expect(() => splitInstallments(cents(100), 0)).toThrow(MoneyError);
    expect(() => splitInstallments(cents(100), 2.5)).toThrow(MoneyError);
  });
});

describe("parseBRL", () => {
  it("le' o formato pt-BR completo", () => {
    expect(parseBRL("1.234,56")).toBe(123456);
    expect(parseBRL("R$ 1.234,56")).toBe(123456);
    expect(parseBRL("2.959,90")).toBe(295990);
    expect(parseBRL("1234,56")).toBe(123456);
  });

  it("trata ponto como milhar quando ha' virgula", () => {
    expect(parseBRL("1.000.000,00")).toBe(100000000);
  });

  it("trata ponto como decimal quando nao ha' virgula e cabe em 2 casas", () => {
    expect(parseBRL("1234.56")).toBe(123456);
    expect(parseBRL("99.9")).toBe(9990);
  });

  it("trata ponto como milhar quando tem 3 casas depois", () => {
    expect(parseBRL("1.234")).toBe(123400);
  });

  it("aceita negativo com hifen e com o glifo de menos", () => {
    expect(parseBRL("-10,00")).toBe(-1000);
    expect(parseBRL("−10,00")).toBe(-1000);
  });

  it("recusa entrada invalida", () => {
    expect(() => parseBRL("")).toThrow(MoneyError);
    expect(() => parseBRL("abc")).toThrow(MoneyError);
  });
});

describe("formatacao — deve bater string por string com o design", () => {
  it("brl", () => {
    expect(brl(cents(295990))).toBe("R$ 2.959,90");
    expect(brl(cents(1240000))).toBe("R$ 12.400,00");
    expect(brl(cents(738945))).toBe("R$ 7.389,45");
    expect(brl(cents(0))).toBe("R$ 0,00");
  });

  it("brl0", () => {
    expect(brl0(cents(295990))).toBe("R$ 2.960");
    expect(brl0(cents(1840000))).toBe("R$ 18.400");
  });

  it("pct com uma casa fixa", () => {
    expect(pct(23.87)).toBe("23,9%");
    expect(pct(100)).toBe("100,0%");
    expect(pct(0)).toBe("0,0%");
  });

  it("pp com sinal", () => {
    expect(pp(4.2)).toBe("+4,2 pp");
    expect(pp(-1.8)).toBe("−1,8 pp");
  });

  it("signedBrl usa o glifo de menos e a seta de aporte", () => {
    expect(signedBrl(cents(980000), "receita")).toBe("+ R$ 9.800,00");
    expect(signedBrl(cents(220000), "despesa")).toBe("− R$ 2.200,00");
    expect(signedBrl(cents(260000), "aporte")).toBe("↗ R$ 2.600,00");
  });

  it("compactK como no grafico de fluxo", () => {
    // mar/2026 do design: 11450 - 7420 - 2000 = 2030 -> "+2,0k"
    expect(compactK(cents(203000))).toBe("+2,0k");
    expect(compactK(cents(-45000))).toBe("−0,5k");
  });
});

describe("aritmetica", () => {
  it("soma mantendo o tipo", () => {
    expect(addCents(cents(100), cents(250))).toBe(350);
    expect(sumCents([cents(1), cents(2), cents(3)])).toBe(6);
    expect(sumCents([])).toBe(0);
  });

  it("subtrai, incluindo resultado negativo", () => {
    expect(subCents(cents(1000), cents(250))).toBe(750);
    expect(subCents(cents(100), cents(250))).toBe(-150);
  });

  it("valor absoluto e maximo", () => {
    expect(absCents(cents(-1500))).toBe(1500);
    expect(maxCents(cents(100), cents(250))).toBe(250);
    expect(maxCents(cents(-100), cents(-250))).toBe(-100);
  });

  it("multiplica so' por inteiro", () => {
    expect(multiplyCents(cents(38990), 10)).toBe(389900);
    expect(() => multiplyCents(cents(100), 1.5)).toThrow(MoneyError);
  });

  it("ZERO e' o neutro", () => {
    expect(ZERO).toBe(0);
    expect(addCents(cents(500), ZERO)).toBe(500);
  });

  it("MASK e' o que a UI mostra com valores ocultos", () => {
    expect(MASK).toBe("R$ ••••");
  });
});
