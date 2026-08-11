import { describe, expect, it } from "vitest";
import {
  bestPurchaseDay,
  type CardCycleConfig,
  closingLabel,
  cycleFor,
  cycleOfRefMonth,
  daysToClose,
  isInCycle,
  statementFigures,
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
  /**
   * O mock do design guarda `melhor` como campo independente — 29, 3 e 21, ou
   * seja, fechamento + 1. Aquilo valia enquanto a compra do dia do fechamento
   * ainda entrava na fatura que fechava; nao vale mais. Hoje o proprio dia do
   * fechamento ja' abre o ciclo seguinte, e ele E' o melhor dia: apontar o
   * seguinte jogaria fora um dia inteiro de prazo.
   */
  it("e' o proprio dia do fechamento", () => {
    expect(bestPurchaseDay(NUBANK)).toBe(28);
    expect(bestPurchaseDay(ITAU)).toBe(2);
    expect(bestPurchaseDay(INTER)).toBe(20);
  });

  it("nao da mais a volta no fim do mes", () => {
    // Era 1 quando o melhor dia era fechamento + 1. Fechando dia 31, o melhor
    // dia e' 31 — e em fevereiro o clamp do calendario resolve.
    expect(bestPurchaseDay({ closingDay: 31, dueDay: 10 })).toBe(31);
  });

  it("respeita override de emissor atipico", () => {
    expect(bestPurchaseDay({ closingDay: 28, dueDay: 5, bestDayOverride: 2 })).toBe(2);
  });
});

describe("dias para fechar", () => {
  /** O ciclo aberto e' aquele em que uma compra de hoje cairia. */
  const aberto = (config: CardCycleConfig, today: ReturnType<typeof d>) => cycleFor(config, today);

  it("reproduz os tres cartoes do design em 01/08/2026", () => {
    expect(daysToClose(aberto(NUBANK, HOJE), HOJE)).toBe(27);
    expect(daysToClose(aberto(ITAU, HOJE), HOJE)).toBe(1);
    expect(daysToClose(aberto(INTER, HOJE), HOJE)).toBe(19);
  });

  it("usa os rotulos do design", () => {
    expect(closingLabel(aberto(NUBANK, HOJE), HOJE)).toBe("27 dias para fechar");
    expect(closingLabel(aberto(ITAU, HOJE), HOJE)).toBe("fecha amanhã");

    // "fecha hoje" e' do ciclo que fecha hoje — que em 20/08 ja' NAO e' o ciclo
    // aberto: uma compra de hoje cai no proximo.
    const vinte = d("2026-08-20");
    expect(closingLabel(cycleFor(INTER, d("2026-08-19")), vinte)).toBe("fecha hoje");
    expect(closingLabel(aberto(INTER, vinte), vinte)).toBe("31 dias para fechar");
  });

  /**
   * O ciclo do mes exibido pode ja' ter fechado — e' o caso da fatura de agosto
   * vista em 08/08 num cartao que fecha dia 05. Antes o rotulo respondia pelo
   * proximo fechamento e anunciava "28 dias para fechar" numa fatura fechada.
   */
  it("diz que fechou quando o ciclo exibido ja' passou", () => {
    const fecha05: CardCycleConfig = { closingDay: 5, dueDay: 12 };
    const agosto = cycleOfRefMonth(fecha05, m("2026-08"));
    expect(agosto.closingDate).toBe("2026-08-05");
    expect(closingLabel(agosto, d("2026-08-08"))).toBe("fechou em 05/08");
    // A fatura de setembro, vista do mesmo dia, ainda esta' acumulando.
    expect(closingLabel(cycleOfRefMonth(fecha05, m("2026-09")), d("2026-08-08"))).toBe(
      "28 dias para fechar"
    );
  });

  /**
   * A formula do design e' `(fecha - hoje + 31) % 31` (linha 1330). Ela assume
   * que todo mes tem 31 dias e que o fechamento ainda nao passou.
   */
  const designFormula = (closingDay: number, today: number) => (closingDay - today + 31) % 31;

  it("DIVERGE da formula do design em mes de 30 dias, depois do fechamento", () => {
    // 29/04: o proximo fechamento e' 28/05, ou seja, 29 dias.
    const hoje = d("2026-04-29");
    expect(daysToClose(aberto(NUBANK, hoje), hoje)).toBe(29);
    expect(designFormula(28, 29)).toBe(30); // o design erraria por 1 dia
  });

  it("DIVERGE da formula do design quando o fechamento cai em fevereiro", () => {
    // Cartao que fecha dia 31: em fevereiro o fechamento e' 28.
    const fechaNo31: CardCycleConfig = { closingDay: 31, dueDay: 10 };
    const hoje = d("2026-02-01");
    expect(daysToClose(aberto(fechaNo31, hoje), hoje)).toBe(27);
    expect(designFormula(31, 1)).toBe(30); // o design erraria por 3 dias
  });

  it("no dia do fechamento, quem marca zero e' o ciclo que fecha — nao o aberto", () => {
    const fechamento = d("2026-08-28");
    expect(daysToClose(cycleFor(NUBANK, d("2026-08-27")), fechamento)).toBe(0);
    // A compra de hoje ja' e' da proxima fatura, que fecha so' em 28/09.
    expect(daysToClose(aberto(NUBANK, fechamento), fechamento)).toBe(31);
  });
});

describe("em qual fatura a compra cai", () => {
  it("compra depois do fechamento vai para o ciclo seguinte", () => {
    // Achado 9 do plano: as compras de 29/07 e 31/07 no Nubank aparecem no
    // design dentro da fatura ja' fechada, mas o fechamento foi em 28/07.
    const ciclo = cycleFor(NUBANK, d("2026-07-31"));
    expect(ciclo.closingDate).toBe("2026-08-28");
    expect(ciclo.dueDate).toBe("2026-09-05");
    expect(ciclo.refMonth).toBe("2026-09");
  });

  /**
   * O caso que o dono trouxe: cartao que fecha dia 05, compra em 05/08. A
   * fatura que fecha nesse dia ja' esta' fechada para gasto novo — o valor vai
   * para a que fecha em 05/09 e e' paga em 12/09.
   */
  it("compra no proprio dia do fechamento ja' e' da fatura seguinte", () => {
    const ciclo = cycleFor(NUBANK, d("2026-07-28"));
    expect(ciclo.closingDate).toBe("2026-08-28");
    expect(ciclo.dueDate).toBe("2026-09-05");
    expect(ciclo.refMonth).toBe("2026-09");
  });

  it("a vespera do fechamento e' o ultimo dia que ainda entra", () => {
    const ciclo = cycleFor(NUBANK, d("2026-07-27"));
    expect(ciclo.closingDate).toBe("2026-07-28");
    expect(ciclo.periodEnd).toBe("2026-07-27");
    expect(ciclo.dueDate).toBe("2026-08-05");
  });

  it("compra antes do fechamento entra na fatura corrente", () => {
    const ciclo = cycleFor(NUBANK, d("2026-07-10"));
    expect(ciclo.periodStart).toBe("2026-06-28");
    expect(ciclo.periodEnd).toBe("2026-07-27");
    expect(ciclo.closingDate).toBe("2026-07-28");
    expect(ciclo.dueDate).toBe("2026-08-05");
  });

  it("vence no mesmo mes quando o vencimento vem depois do fechamento", () => {
    // Itau fecha dia 2 e vence dia 10: mesmo mes.
    const ciclo = cycleFor(ITAU, d("2026-08-01"));
    expect(ciclo.closingDate).toBe("2026-08-02");
    expect(ciclo.dueDate).toBe("2026-08-10");
    expect(ciclo.refMonth).toBe("2026-08");
  });

  it("o periodo e' continuo: o fechamento anterior abre o ciclo seguinte", () => {
    const julho = cycleFor(NUBANK, d("2026-07-10"));
    const agosto = cycleFor(NUBANK, d("2026-08-10"));
    expect(julho.closingDate).toBe("2026-07-28");
    expect(julho.periodEnd).toBe("2026-07-27");
    // O dia 28/07 fecha julho e ja' e' o primeiro dia de agosto na fatura.
    expect(agosto.periodStart).toBe("2026-07-28");
  });

  it("nao deixa buraco nem sobreposicao ao longo de um ano", () => {
    // Toda data de 2026, em qualquer um dos tres cartoes, tem que cair em
    // exatamente um ciclo — e o ciclo tem que ser estavel (idempotente).
    for (const config of [NUBANK, ITAU, INTER]) {
      for (let i = 0; i < 365; i++) {
        const date = addDays(d("2026-01-01"), i);
        const ciclo = cycleFor(config, date);
        expect(isInCycle(ciclo, date)).toBe(true);
        // A vespera do fechamento ainda pertence a este ciclo.
        expect(cycleFor(config, ciclo.periodEnd).closingDate).toBe(ciclo.closingDate);
        // E o dia do fechamento ja' abre o proximo.
        const seguinte = cycleFor(config, ciclo.closingDate);
        expect(seguinte.periodStart).toBe(ciclo.closingDate);
        expect(seguinte.closingDate).not.toBe(ciclo.closingDate);
      }
    }
  });

  it("fevereiro: cartao que fecha 31 fecha no ultimo dia do mes", () => {
    const fechaNo31: CardCycleConfig = { closingDay: 31, dueDay: 10 };
    const ciclo = cycleFor(fechaNo31, d("2026-02-15"));
    expect(ciclo.closingDate).toBe("2026-02-28");
    expect(ciclo.dueDate).toBe("2026-03-10");
  });
});

describe("ciclo a partir do mes de referencia", () => {
  it("e' o inverso de cycleFor", () => {
    const porCompra = cycleFor(NUBANK, d("2026-07-31"));
    const porMes = cycleOfRefMonth(NUBANK, m("2026-09"));
    expect(porMes.closingDate).toBe(porCompra.closingDate);
    expect(porMes.periodEnd).toBe(porCompra.periodEnd);
    expect(porMes.dueDate).toBe(porCompra.dueDate);
    expect(porMes.periodStart).toBe(porCompra.periodStart);
  });

  it("funciona para cartao que vence no mes do fechamento", () => {
    const ciclo = cycleOfRefMonth(ITAU, m("2026-08"));
    expect(ciclo.closingDate).toBe("2026-08-02");
    expect(ciclo.periodEnd).toBe("2026-08-01");
    expect(ciclo.dueDate).toBe("2026-08-10");
  });
});

describe("os quatro numeros do painel", () => {
  /**
   * O cartao do caso real: fecha dia 05, vence dia 12. Duas assinaturas em
   * agosto — uma cobrada dia 6 (R$ 381,10) e outra dia 15 (R$ 34,90) —, vistas
   * em 08/08. As duas caem depois do fechamento, entao as duas pertencem a'
   * fatura de SETEMBRO.
   */
  const CROMA: CardCycleConfig = { closingDay: 5, dueDay: 12 };
  const HOJE_08 = d("2026-08-08");

  const fatura = (mes: string) => cycleOfRefMonth(CROMA, m(mes));
  const fase = (mes: string, paid = false) => statementPhase(fatura(mes), HOJE_08, paid);

  it("a fatura de agosto ja' fechou e nao recebe mais nada", () => {
    expect(fatura("2026-08").closingDate).toBe("2026-08-05");
    expect(fatura("2026-08").periodEnd).toBe("2026-08-04");
    expect(fase("2026-08")).toBe("fechada");

    // Nenhuma das duas assinaturas cai aqui: 06/08 e 15/08 sao posteriores ao
    // fechamento. A tela chegou a listar a do dia 15 como "ainda vai cair"
    // nesta fatura, tres dias depois de ela ter fechado.
    const f = statementFigures({ postedCents: 0, futureCents: 0 }, fase("2026-08"));
    expect(f).toEqual({ toPayCents: 0, formingCents: 0, forecastCents: 0, totalCents: 0 });
  });

  it("ja' esta' fechada no PROPRIO dia do fechamento", () => {
    // Em 05/08 ninguem mais consegue pendurar gasto na fatura que fecha nesse
    // dia — quem gasta em 05/08 cai na de setembro.
    expect(statementPhase(fatura("2026-08"), d("2026-08-05"), false)).toBe("fechada");
    expect(cycleFor(CROMA, d("2026-08-05")).refMonth).toBe("2026-09");
  });

  it("a de setembro esta' aberta e recebe tudo que veio do dia 05 em diante", () => {
    const setembro = fatura("2026-09");
    expect(setembro.periodStart).toBe("2026-08-05");
    expect(setembro.periodEnd).toBe("2026-09-04");
    expect(setembro.closingDate).toBe("2026-09-05");
    expect(setembro.dueDate).toBe("2026-09-12");
    expect(fase("2026-09")).toBe("aberta");

    // WellHub (06/08) ja' caiu; Paramount+ (15/08) ainda vai cair.
    const f = statementFigures({ postedCents: 38110, futureCents: 3490 }, fase("2026-09"));
    expect(f.formingCents).toBe(38110);
    expect(f.forecastCents).toBe(3490);
    expect(f.totalCents).toBe(41600);
    // Aberta nao e' divida: so' se paga o que fechou.
    expect(f.toPayCents).toBe(0);
  });

  it("o que estava em formacao vira a pagar quando o ciclo fecha", () => {
    const depois = statementFigures(
      { postedCents: 41600, futureCents: 0 },
      statementPhase(fatura("2026-09"), d("2026-09-06"), false)
    );
    expect(depois.toPayCents).toBe(41600);
    expect(depois.formingCents).toBe(0);
    expect(depois.forecastCents).toBe(0);
    expect(depois.totalCents).toBe(41600);
  });

  it("fatura paga nao cobra de novo, mas continua somando o que teve", () => {
    const f = statementFigures({ postedCents: 41600, futureCents: 0 }, fase("2026-09", true));
    expect(f.toPayCents).toBe(0);
    expect(f.totalCents).toBe(41600);
  });

  it("estorno derruba o total da fatura", () => {
    // O estorno chega como valor negativo em `postedCents`.
    const f = statementFigures({ postedCents: 38110 - 3490, futureCents: 0 }, fase("2026-09"));
    expect(f.totalCents).toBe(34620);
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
