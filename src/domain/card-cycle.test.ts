import { describe, expect, it } from "vitest";
import {
  bestPurchaseDay,
  type CardCycleConfig,
  cycleFor,
  cycleOfRefMonth,
  daysToClose,
  daysToCloseLabel,
  isInCycle,
  statementPhase,
} from "./card-cycle";
import { addDays, plainDate, refMonth } from "./period";

const d = plainDate;
const m = refMonth;

/** Os tres cartoes do design, com os valores exatos do mock (linhas 1077-1083). */
const NUBANK: CardCycleConfig = { closingDay: 28, dueDay: 5 };
const ITAU: CardCycleConfig = { closingDay: 2, dueDay: 10 };
const INTER: CardCycleConfig = { closingDay: 20, dueDay: 27 };

const HOJE = d("2026-08-01");

describe("melhor dia de compra", () => {
  it("e' derivado do fechamento, batendo com os tres cartoes do design", () => {
    // O mock guarda `melhor` como campo independente: 29, 3 e 21 — e em 3/3
    // e' exatamente fechamento + 1. Derivar impede que os dois divirjam.
    expect(bestPurchaseDay(NUBANK)).toBe(29);
    expect(bestPurchaseDay(ITAU)).toBe(3);
    expect(bestPurchaseDay(INTER)).toBe(21);
  });

  it("da a volta quando o fechamento e' no dia 31", () => {
    expect(bestPurchaseDay({ closingDay: 31, dueDay: 10 })).toBe(1);
  });

  it("respeita override de emissor atipico", () => {
    expect(bestPurchaseDay({ closingDay: 28, dueDay: 5, bestDayOverride: 2 })).toBe(2);
  });
});

describe("dias para fechar", () => {
  it("reproduz os tres cartoes do design em 01/08/2026", () => {
    expect(daysToClose(NUBANK, HOJE)).toBe(27);
    expect(daysToClose(ITAU, HOJE)).toBe(1);
    expect(daysToClose(INTER, HOJE)).toBe(19);
  });

  it("usa os rotulos do design", () => {
    expect(daysToCloseLabel(NUBANK, HOJE)).toBe("27 dias para fechar");
    expect(daysToCloseLabel(ITAU, HOJE)).toBe("fecha amanhã");
    expect(daysToCloseLabel(INTER, d("2026-08-20"))).toBe("fecha hoje");
  });

  /**
   * A formula do design e' `(fecha - hoje + 31) % 31` (linha 1330). Ela assume
   * que todo mes tem 31 dias e que o fechamento ainda nao passou.
   */
  const designFormula = (closingDay: number, today: number) => (closingDay - today + 31) % 31;

  it("DIVERGE da formula do design em mes de 30 dias, depois do fechamento", () => {
    // 29/04: o proximo fechamento e' 28/05, ou seja, 29 dias.
    const correto = daysToClose(NUBANK, d("2026-04-29"));
    expect(correto).toBe(29);
    expect(designFormula(28, 29)).toBe(30); // o design erraria por 1 dia
  });

  it("DIVERGE da formula do design quando o fechamento cai em fevereiro", () => {
    // Cartao que fecha dia 31: em fevereiro o fechamento e' 28.
    const fechaNo31: CardCycleConfig = { closingDay: 31, dueDay: 10 };
    const correto = daysToClose(fechaNo31, d("2026-02-01"));
    expect(correto).toBe(27);
    expect(designFormula(31, 1)).toBe(30); // o design erraria por 3 dias
  });

  it("zero no proprio dia do fechamento", () => {
    expect(daysToClose(NUBANK, d("2026-08-28"))).toBe(0);
  });
});

describe("em qual fatura a compra cai", () => {
  it("compra depois do fechamento vai para o ciclo seguinte", () => {
    // Achado 9 do plano: as compras de 29/07 e 31/07 no Nubank aparecem no
    // design dentro da fatura ja' fechada, mas o fechamento foi em 28/07.
    const ciclo = cycleFor(NUBANK, d("2026-07-31"));
    expect(ciclo.periodEnd).toBe("2026-08-28");
    expect(ciclo.dueDate).toBe("2026-09-05");
    expect(ciclo.refMonth).toBe("2026-09");
  });

  it("compra no proprio dia do fechamento ainda entra na fatura que fecha", () => {
    const ciclo = cycleFor(NUBANK, d("2026-07-28"));
    expect(ciclo.periodEnd).toBe("2026-07-28");
    expect(ciclo.dueDate).toBe("2026-08-05");
    expect(ciclo.refMonth).toBe("2026-08");
  });

  it("compra antes do fechamento entra na fatura corrente", () => {
    const ciclo = cycleFor(NUBANK, d("2026-07-10"));
    expect(ciclo.periodStart).toBe("2026-06-29");
    expect(ciclo.periodEnd).toBe("2026-07-28");
    expect(ciclo.dueDate).toBe("2026-08-05");
  });

  it("vence no mesmo mes quando o vencimento vem depois do fechamento", () => {
    // Itau fecha dia 2 e vence dia 10: mesmo mes.
    const ciclo = cycleFor(ITAU, d("2026-08-01"));
    expect(ciclo.periodEnd).toBe("2026-08-02");
    expect(ciclo.dueDate).toBe("2026-08-10");
    expect(ciclo.refMonth).toBe("2026-08");
  });

  it("o periodo e' continuo: o inicio e' o dia seguinte ao fechamento anterior", () => {
    const julho = cycleFor(NUBANK, d("2026-07-10"));
    const agosto = cycleFor(NUBANK, d("2026-08-10"));
    expect(agosto.periodStart).toBe("2026-07-29");
    expect(julho.periodEnd).toBe("2026-07-28");
  });

  it("nao deixa buraco nem sobreposicao ao longo de um ano", () => {
    // Toda data de 2026, em qualquer um dos tres cartoes, tem que cair em
    // exatamente um ciclo — e o ciclo tem que ser estavel (idempotente).
    for (const config of [NUBANK, ITAU, INTER]) {
      for (let i = 0; i < 365; i++) {
        const date = addDays(d("2026-01-01"), i);
        const ciclo = cycleFor(config, date);
        expect(isInCycle(ciclo, date)).toBe(true);
        // A data de fechamento pertence ao proprio ciclo que fecha.
        expect(cycleFor(config, ciclo.periodEnd).periodEnd).toBe(ciclo.periodEnd);
        // O dia seguinte ao fechamento ja' e' o proximo ciclo.
        const seguinte = cycleFor(config, addDays(ciclo.periodEnd, 1));
        expect(seguinte.periodStart).toBe(addDays(ciclo.periodEnd, 1));
      }
    }
  });

  it("fevereiro: cartao que fecha 31 fecha no ultimo dia do mes", () => {
    const fechaNo31: CardCycleConfig = { closingDay: 31, dueDay: 10 };
    const ciclo = cycleFor(fechaNo31, d("2026-02-15"));
    expect(ciclo.periodEnd).toBe("2026-02-28");
    expect(ciclo.dueDate).toBe("2026-03-10");
  });
});

describe("ciclo a partir do mes de referencia", () => {
  it("e' o inverso de cycleFor", () => {
    const porCompra = cycleFor(NUBANK, d("2026-07-31"));
    const porMes = cycleOfRefMonth(NUBANK, m("2026-09"));
    expect(porMes.periodEnd).toBe(porCompra.periodEnd);
    expect(porMes.dueDate).toBe(porCompra.dueDate);
    expect(porMes.periodStart).toBe(porCompra.periodStart);
  });

  it("funciona para cartao que vence no mes do fechamento", () => {
    const ciclo = cycleOfRefMonth(ITAU, m("2026-08"));
    expect(ciclo.periodEnd).toBe("2026-08-02");
    expect(ciclo.dueDate).toBe("2026-08-10");
  });
});

describe("fase da fatura", () => {
  it("aberta enquanto nao fechou", () => {
    const ciclo = cycleOfRefMonth(NUBANK, m("2026-09"));
    expect(statementPhase(ciclo, d("2026-08-10"), false)).toBe("aberta");
  });

  it("fechada depois do fechamento e antes do pagamento", () => {
    const ciclo = cycleOfRefMonth(NUBANK, m("2026-08"));
    expect(statementPhase(ciclo, d("2026-08-01"), false)).toBe("fechada");
  });

  it("paga vence qualquer outra fase", () => {
    const ciclo = cycleOfRefMonth(NUBANK, m("2026-08"));
    expect(statementPhase(ciclo, d("2026-08-01"), true)).toBe("paga");
  });
});
