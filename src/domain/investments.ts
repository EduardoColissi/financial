import { safePercent } from "./math";
import { type Cents, cents } from "./money";

/**
 * Carteira de investimentos.
 *
 * Regra C1, a mais importante do sistema: valorizacao, dividendo e aluguel
 * ficam DENTRO da carteira e sao reinvestidos. Nao sao receita do mes. O caixa
 * so' e' tocado por aporte (saida) e resgate (entrada).
 *
 * Consequencia pratica que o design nao modela: um dividendo reinvestido NAO e'
 * um aporte. Trata-lo como aporte inflaria o custo aplicado e faria o ganho
 * percentual encolher artificialmente — o dinheiro ja' estava dentro.
 */

export type InvestmentFlowKind = "contribution" | "withdrawal" | "dividend" | "fee" | "adjustment";

export interface InvestmentFlow {
  kind: InvestmentFlowKind;
  amountCents: Cents;
  /** Proventos reinvestidos permanecem na carteira. */
  reinvested?: boolean;
}

/** Apenas estes dois movimentam o caixa. */
export function flowAffectsCash(kind: InvestmentFlowKind): boolean {
  return kind === "contribution" || kind === "withdrawal";
}

/**
 * Custo aplicado: o quanto do proprio bolso entrou, liquido de resgates.
 *
 * Dividendos e ajustes ficam de fora por construcao.
 */
export function investedCost(flows: readonly InvestmentFlow[]): Cents {
  let total = 0;
  for (const flow of flows) {
    if (flow.kind === "contribution") total += flow.amountCents;
    else if (flow.kind === "withdrawal") total -= flow.amountCents;
  }
  return cents(total);
}

export interface MonthlyReturnInput {
  /** Valor de mercado no fim do mes anterior. */
  previousValueCents: Cents;
  /** Valor de mercado no fim deste mes. */
  currentValueCents: Cents;
  contributionsCents: Cents;
  withdrawalsCents: Cents;
}

/**
 * Rendimento do mes.
 *
 * Variacao do valor de mercado descontando o que entrou e somando o que saiu —
 * senao um aporte de R$ 2.600 apareceria como "rendeu R$ 2.600".
 */
export function monthlyReturn(input: MonthlyReturnInput): Cents {
  return cents(
    input.currentValueCents -
      input.previousValueCents -
      input.contributionsCents +
      input.withdrawalsCents
  );
}

/** Ganho acumulado: valor de mercado menos o que foi aplicado. */
export function unrealizedGain(currentValueCents: Cents, investedCents: Cents): Cents {
  return cents(currentValueCents - investedCents);
}

/** Ganho em %, seguro quando nada foi aplicado ainda. */
export function gainPercent(currentValueCents: Cents, investedCents: Cents): number {
  return safePercent(currentValueCents - investedCents, investedCents);
}

// ── alocacao ─────────────────────────────────────────────────────────────────

export interface SegmentAllocation {
  name: string;
  valueCents: Cents;
  /** Percentual alvo (0..100). Nulo = sem alvo definido. */
  targetPercent?: number | null;
}

export interface AllocationResult extends SegmentAllocation {
  currentPercent: number;
  /** Desvio em pontos percentuais: positivo = acima do alvo. */
  deviationPP: number;
  /** Abaixo de 2 pp o design trata como "no alvo". */
  onTarget: boolean;
}

export function allocation(segments: readonly SegmentAllocation[]): AllocationResult[] {
  const total = segments.reduce<number>((acc, s) => acc + s.valueCents, 0);

  return segments.map((segment) => {
    const currentPercent = safePercent(segment.valueCents, total);
    const target = segment.targetPercent ?? null;
    const deviationPP = target == null ? 0 : currentPercent - target;
    return {
      ...segment,
      currentPercent,
      deviationPP,
      onTarget: target == null || Math.abs(deviationPP) < 2,
    };
  });
}

// ── metas ────────────────────────────────────────────────────────────────────

export interface GoalProgress {
  currentCents: Cents;
  targetCents: Cents;
  percent: number;
  reached: boolean;
}

export function goalProgress(currentCents: Cents, targetCents: Cents): GoalProgress {
  const percent = safePercent(currentCents, targetCents);
  return {
    currentCents,
    targetCents,
    percent: Math.min(100, Math.max(0, percent)),
    reached: currentCents >= targetCents,
  };
}

/**
 * Quantos meses de custo a reserva cobre.
 *
 * O design calcula `18400 / despesas` direto (linha 1522) e devolve `Infinity`
 * num mes sem despesa.
 */
export function monthsOfRunway(reserveCents: Cents, monthlyExpenseCents: Cents): number {
  if (monthlyExpenseCents <= 0) return 0;
  return reserveCents / monthlyExpenseCents;
}
