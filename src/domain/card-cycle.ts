import {
  addDays,
  addMonths,
  clampDay,
  daysBetween,
  monthOf,
  type PlainDate,
  type RefMonth,
  shortDate,
} from "./period";

/**
 * Ciclo de fatura de cartao de credito.
 *
 * Regras (C2 do plano):
 *  - uma compra pertence ao ciclo que fecha no PRIMEIRO fechamento >= a data da
 *    compra;
 *  - a fatura vence no mesmo mes do fechamento se `dueDay > closingDay`, senao
 *    no mes seguinte;
 *  - o `refMonth` da fatura e' o mes do VENCIMENTO (e' assim que o usuario
 *    pensa: "a fatura de setembro");
 *  - o melhor dia de compra e' o dia seguinte ao fechamento — comprar ali da' o
 *    prazo maximo ate' o pagamento.
 */

export interface CardCycleConfig {
  /** Dia do mes em que a fatura fecha (1..31). */
  closingDay: number;
  /** Dia do mes em que a fatura vence (1..31). */
  dueDay: number;
  /** Alguns emissores nao usam fechamento+1. Nulo = derivar. */
  bestDayOverride?: number | null;
}

export interface CardCycle {
  /** Primeiro dia coberto pela fatura (dia seguinte ao fechamento anterior). */
  periodStart: PlainDate;
  /** Data de fechamento. Compras ate' aqui, inclusive, entram nesta fatura. */
  periodEnd: PlainDate;
  dueDate: PlainDate;
  /** Mes de referencia da fatura = mes do vencimento. */
  refMonth: RefMonth;
}

/** Data de fechamento do ciclo cujo fechamento cai no mes informado. */
function closingIn(month: RefMonth, closingDay: number): PlainDate {
  return clampDay(month, closingDay);
}

function dueFor(closing: PlainDate, config: CardCycleConfig): PlainDate {
  const closingMonth = monthOf(closing);
  // Vence ainda no mes do fechamento apenas se o dia de vencimento vier depois.
  const dueMonth = config.dueDay > config.closingDay ? closingMonth : addMonths(closingMonth, 1);
  return clampDay(dueMonth, config.dueDay);
}

/** O ciclo em que uma compra feita em `purchaseDate` sera' faturada. */
export function cycleFor(config: CardCycleConfig, purchaseDate: PlainDate): CardCycle {
  const monthOfPurchase = monthOf(purchaseDate);
  const thisMonthClosing = closingIn(monthOfPurchase, config.closingDay);

  // Compra no proprio dia do fechamento ainda entra nesta fatura.
  const periodEnd =
    purchaseDate <= thisMonthClosing
      ? thisMonthClosing
      : closingIn(addMonths(monthOfPurchase, 1), config.closingDay);

  const previousClosing = closingIn(addMonths(monthOf(periodEnd), -1), config.closingDay);
  const dueDate = dueFor(periodEnd, config);

  return {
    periodStart: addDays(previousClosing, 1),
    periodEnd,
    dueDate,
    refMonth: monthOf(dueDate),
  };
}

/** O ciclo cuja fatura vence no mes de referencia informado. */
export function cycleOfRefMonth(config: CardCycleConfig, ref: RefMonth): CardCycle {
  // Se vence no mes do fechamento, o fechamento e' no proprio mes; senao, no anterior.
  const closingMonth = config.dueDay > config.closingDay ? ref : addMonths(ref, -1);
  const periodEnd = closingIn(closingMonth, config.closingDay);
  const previousClosing = closingIn(addMonths(closingMonth, -1), config.closingDay);

  return {
    periodStart: addDays(previousClosing, 1),
    periodEnd,
    dueDate: clampDay(ref, config.dueDay),
    refMonth: ref,
  };
}

/**
 * Quantos dias faltam para ESTE ciclo fechar. Negativo se ja' fechou.
 *
 * Substitui `(fecha - hoje + 31) % 31` do design (linha 1330), que acerta por
 * coincidencia em agosto de 2026 e erra em meses de 30 ou 28 dias — e tambem
 * quando o dia de fechamento ja' passou.
 */
export function daysToClose(cycle: CardCycle, today: PlainDate): number {
  return daysBetween(today, cycle.periodEnd);
}

/**
 * Como descrever o fechamento deste ciclo, visto de `today`.
 *
 * Fala de um ciclo CONCRETO, nao do proximo fechamento do cartao. A versao
 * anterior recebia a configuracao do cartao e respondia sempre pelo ciclo
 * aberto, entao a tela de agosto anunciava "28 dias para fechar" para uma
 * fatura que fechara tres dias antes: o rotulo era do ciclo de setembro, ao
 * lado de numeros da fatura de agosto.
 */
export function closingLabel(cycle: CardCycle, today: PlainDate): string {
  const days = daysToClose(cycle, today);
  if (days < 0) return `fechou em ${shortDate(cycle.periodEnd)}`;
  if (days === 0) return "fecha hoje";
  if (days === 1) return "fecha amanhã";
  return `${days} dias para fechar`;
}

/**
 * Melhor dia de compra: o dia seguinte ao fechamento.
 *
 * Nos tres cartoes do design isto e' sempre `fechamento + 1`, mas o mock guarda
 * como campo independente — o que permite os dois valores divergirem em
 * silencio. Aqui e' derivado, com override apenas para emissores atipicos.
 */
export function bestPurchaseDay(config: CardCycleConfig): number {
  if (config.bestDayOverride != null) return config.bestDayOverride;
  return (config.closingDay % 31) + 1;
}

/** A compra cai dentro deste ciclo? */
export function isInCycle(cycle: CardCycle, date: PlainDate): boolean {
  return date >= cycle.periodStart && date <= cycle.periodEnd;
}

export type StatementPhase = "paga" | "fechada" | "aberta";

/**
 * Em que fase o ciclo esta', vista de `today`.
 *
 * "fechada" = ja' fechou e ainda nao foi paga (e' o que o usuario precisa pagar).
 * "aberta"  = ainda esta' acumulando compras.
 */
export function statementPhase(cycle: CardCycle, today: PlainDate, paid: boolean): StatementPhase {
  if (paid) return "paga";
  return today > cycle.periodEnd ? "fechada" : "aberta";
}

/** A fatura partida em duas: o que ja' caiu nela e o que ainda vai cair. */
export interface StatementSplit {
  postedCents: number;
  futureCents: number;
}

/** Os quatro numeros do painel do cartao. */
export interface StatementFigures {
  toPayCents: number;
  formingCents: number;
  forecastCents: number;
  totalCents: number;
}

/**
 * Os quatro numeros, todos da MESMA fatura, decididos pela fase dela.
 *
 * Sao excludentes de proposito: enquanto o ciclo corre, o valor mora em
 * "formacao" e "previsto" e nada e' devido — a fatura ainda esta' recebendo
 * compras. Quando ela fecha, os dois viram "a pagar" e param de existir: nao ha'
 * o que se formar numa fatura fechada.
 *
 * Antes cada numero respondia por um calendario diferente — "a pagar" pela
 * fatura do mes na tela, "formacao" e "previsto" pelo ciclo aberto de hoje —, e
 * navegar de agosto para setembro repetia os mesmos dois valores nos dois meses.
 */
export function statementFigures(split: StatementSplit, phase: StatementPhase): StatementFigures {
  const total = split.postedCents + split.futureCents;
  return {
    toPayCents: phase === "fechada" ? total : 0,
    formingCents: phase === "aberta" ? split.postedCents : 0,
    forecastCents: phase === "aberta" ? split.futureCents : 0,
    totalCents: total,
  };
}
