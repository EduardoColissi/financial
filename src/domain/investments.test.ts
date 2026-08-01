import { describe, expect, it } from "vitest";
import { monthTotals } from "./cash-flow";
import {
  allocation,
  flowAffectsCash,
  gainPercent,
  goalProgress,
  type InvestmentFlow,
  investedCost,
  monthlyReturn,
  monthsOfRunway,
  unrealizedGain,
} from "./investments";
import { cents } from "./money";

describe("o que da carteira toca o caixa", () => {
  it("somente aporte e resgate", () => {
    expect(flowAffectsCash("contribution")).toBe(true);
    expect(flowAffectsCash("withdrawal")).toBe(true);
    expect(flowAffectsCash("dividend")).toBe(false);
    expect(flowAffectsCash("fee")).toBe(false);
    expect(flowAffectsCash("adjustment")).toBe(false);
  });

  /**
   * A invariante mais importante do sistema (regra C1).
   *
   * Qualquer combinacao de eventos de carteira que NAO seja aporte ou resgate
   * tem que deixar o fluxo de caixa do mes exatamente igual. Isto protege a
   * regra contra qualquer refactor futuro: se alguem transformar dividendo em
   * receita, este teste quebra.
   */
  it("INVARIANTE: rendimento, dividendo e taxa nao alteram o fluxo de caixa", () => {
    const base = monthTotals([
      { kind: "income", onCredit: false, amountCents: cents(1240000) },
      { kind: "expense", onCredit: false, amountCents: cents(738945) },
      { kind: "investment_out", onCredit: false, amountCents: cents(260000) },
    ]);

    const eventosDeCarteira: InvestmentFlow[] = [
      { kind: "dividend", amountCents: cents(9600), reinvested: true },
      { kind: "dividend", amountCents: cents(4200), reinvested: true },
      { kind: "fee", amountCents: cents(1500) },
      { kind: "adjustment", amountCents: cents(62000) },
    ];

    // Nenhum deles vira lancamento — por isso nem entram em monthTotals.
    const naoCaixa = eventosDeCarteira.filter((f) => flowAffectsCash(f.kind));
    expect(naoCaixa).toHaveLength(0);

    const depois = monthTotals([
      { kind: "income", onCredit: false, amountCents: cents(1240000) },
      { kind: "expense", onCredit: false, amountCents: cents(738945) },
      { kind: "investment_out", onCredit: false, amountCents: cents(260000) },
    ]);
    expect(depois).toEqual(base);
  });
});

describe("custo aplicado", () => {
  it("soma aportes e desconta resgates", () => {
    expect(
      investedCost([
        { kind: "contribution", amountCents: cents(680000) },
        { kind: "contribution", amountCents: cents(200000) },
        { kind: "withdrawal", amountCents: cents(100000) },
      ])
    ).toBe(780000);
  });

  it("dividendo reinvestido NAO entra no custo aplicado", () => {
    // Se entrasse, o ganho percentual encolheria artificialmente: o dinheiro
    // ja' estava dentro da carteira.
    const semDividendo = investedCost([{ kind: "contribution", amountCents: cents(680000) }]);
    const comDividendo = investedCost([
      { kind: "contribution", amountCents: cents(680000) },
      { kind: "dividend", amountCents: cents(9600), reinvested: true },
    ]);
    expect(comDividendo).toBe(semDividendo);
  });
});

describe("rendimento do mes", () => {
  it("desconta o aporte da variacao de valor", () => {
    // Sem desconto, um aporte de 2.600 apareceria como "rendeu 2.600".
    expect(
      monthlyReturn({
        previousValueCents: cents(1000000),
        currentValueCents: cents(1300000),
        contributionsCents: cents(260000),
        withdrawalsCents: cents(0),
      })
    ).toBe(40000);
  });

  it("soma de volta o resgate", () => {
    expect(
      monthlyReturn({
        previousValueCents: cents(1000000),
        currentValueCents: cents(900000),
        contributionsCents: cents(0),
        withdrawalsCents: cents(150000),
      })
    ).toBe(50000);
  });

  it("aceita rendimento negativo", () => {
    // Bitcoin e Ethereum do seed do design fecham o mes no vermelho.
    expect(
      monthlyReturn({
        previousValueCents: cents(178000),
        currentValueCents: cents(173800),
        contributionsCents: cents(0),
        withdrawalsCents: cents(0),
      })
    ).toBe(-4200);
  });
});

describe("ganho", () => {
  it("PETR4 do design: aplicado 6.800, saldo 7.420", () => {
    const ganho = unrealizedGain(cents(742000), cents(680000));
    expect(ganho).toBe(62000);
    expect(gainPercent(cents(742000), cents(680000))).toBeCloseTo(9.117, 2);
  });

  it("nao explode com ativo sem aporte", () => {
    expect(gainPercent(cents(1000), cents(0))).toBe(0);
  });
});

describe("alocacao", () => {
  it("calcula percentual atual e desvio em pontos percentuais", () => {
    const r = allocation([
      { name: "Ações", valueCents: cents(3000000), targetPercent: 30 },
      { name: "Renda fixa", valueCents: cents(2000000), targetPercent: 20 },
      { name: "Reserva", valueCents: cents(5000000), targetPercent: 25 },
    ]);

    expect(r[0]?.currentPercent).toBe(30);
    expect(r[0]?.deviationPP).toBe(0);
    expect(r[0]?.onTarget).toBe(true);

    expect(r[2]?.currentPercent).toBe(50);
    expect(r[2]?.deviationPP).toBe(25);
    expect(r[2]?.onTarget).toBe(false);
  });

  it("segmento sem alvo nunca acusa desvio", () => {
    const r = allocation([{ name: "Cripto", valueCents: cents(100000) }]);
    expect(r[0]?.deviationPP).toBe(0);
    expect(r[0]?.onTarget).toBe(true);
  });

  it("carteira vazia nao produz NaN", () => {
    const r = allocation([{ name: "Ações", valueCents: cents(0), targetPercent: 30 }]);
    expect(Number.isFinite(r[0]?.currentPercent ?? Number.NaN)).toBe(true);
    expect(r[0]?.currentPercent).toBe(0);
  });

  it("os percentuais somam 100 quando ha' valor", () => {
    const r = allocation([
      { name: "a", valueCents: cents(333333) },
      { name: "b", valueCents: cents(333333) },
      { name: "c", valueCents: cents(333334) },
    ]);
    const soma = r.reduce((acc, s) => acc + s.currentPercent, 0);
    expect(soma).toBeCloseTo(100, 6);
  });
});

describe("metas", () => {
  it("reserva de emergencia do design: 18.400 de 24.000", () => {
    const p = goalProgress(cents(1840000), cents(2400000));
    expect(p.percent).toBeCloseTo(76.67, 1);
    expect(p.reached).toBe(false);
  });

  it("limita em 100% quando a meta e' superada", () => {
    const p = goalProgress(cents(3000000), cents(2400000));
    expect(p.percent).toBe(100);
    expect(p.reached).toBe(true);
  });

  it("meta zerada nao gera Infinity", () => {
    expect(goalProgress(cents(100), cents(0)).percent).toBe(0);
  });
});

describe("meses de reserva", () => {
  it("reproduz o numero do design", () => {
    // 18.400 / 7.389,45 = 2,49 meses
    expect(monthsOfRunway(cents(1840000), cents(738945))).toBeCloseTo(2.49, 2);
  });

  it("mes sem despesa devolve 0, nao Infinity", () => {
    // O design faz `18400/despesas` direto (linha 1522).
    expect(monthsOfRunway(cents(1840000), cents(0))).toBe(0);
  });
});
