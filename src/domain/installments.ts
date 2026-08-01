import { widthPercent } from "./math";
import { type Cents, cents, multiplyCents } from "./money";
import { addMonths, monthsBetween, type RefMonth } from "./period";

/**
 * Parcelamento e recorrencia.
 *
 * O numero da parcela corrente NUNCA e' armazenado: ele e' derivado de
 * `firstRefMonth` e do mes que se esta' olhando. Isso torna a geracao funcional
 * — gerar novembro sem ter gerado outubro produz o mesmo resultado — e e' o que
 * permite a materializacao de mes ser idempotente.
 */

export interface RecurringRuleLike {
  firstRefMonth: RefMonth;
  /** Nulo = assinatura sem fim previsto. */
  installmentsTotal?: number | null;
  endRefMonth?: RefMonth | null;
  pausedAt?: unknown | null;
  archivedAt?: unknown | null;
}

/** 1-based. Fevereiro de uma regra que comecou em janeiro e' a parcela 2. */
export function sequenceFor(firstRefMonth: RefMonth, ref: RefMonth): number {
  return monthsBetween(firstRefMonth, ref) + 1;
}

/** A regra produz cobranca neste mes? */
export function isActiveIn(rule: RecurringRuleLike, ref: RefMonth): boolean {
  if (rule.archivedAt != null || rule.pausedAt != null) return false;
  const seq = sequenceFor(rule.firstRefMonth, ref);
  if (seq < 1) return false;
  if (rule.installmentsTotal != null && seq > rule.installmentsTotal) return false;
  if (rule.endRefMonth != null && ref > rule.endRefMonth) return false;
  return true;
}

/** Mes da ultima parcela, para regras com fim previsto. */
export function lastRefMonthOf(rule: RecurringRuleLike): RefMonth | null {
  if (rule.installmentsTotal != null) {
    return addMonths(rule.firstRefMonth, rule.installmentsTotal - 1);
  }
  return rule.endRefMonth ?? null;
}

/**
 * "Faltam X" — INCLUINDO a parcela corrente.
 *
 * E' a formula da aba Assinaturas do design (linha 1295: `valor * (pt-pa+1)`).
 * Responde "quanto ainda vou desembolsar a partir de agora, contando esta".
 */
export function remainingIncludingCurrent(amount: Cents, sequence: number, total: number): Cents {
  const left = Math.max(0, total - sequence + 1);
  return multiplyCents(amount, left);
}

/**
 * "A vencer" — EXCLUINDO a parcela corrente.
 *
 * E' a formula da aba Cartoes do design (linha 1317: `p.v * (p.pt-p.p)`).
 * Responde "quanto ainda vai cair em faturas futuras".
 *
 * As duas convivem de proposito: o design usa ambas, com rotulos diferentes, e
 * unificar mudaria numeros que o usuario ja' entende. Manter as duas nomeadas
 * evita que alguem "corrija" uma achando que a outra esta' errada.
 */
export function remainingAfterCurrent(amount: Cents, sequence: number, total: number): Cents {
  const left = Math.max(0, total - sequence);
  return multiplyCents(amount, left);
}

/** Progresso do parcelamento, 0..100, pronto para virar largura de barra. */
export function installmentProgress(sequence: number, total: number): number {
  return widthPercent(sequence, total);
}

/** "5 de 10" */
export function installmentLabel(sequence: number, total: number): string {
  return `${sequence} de ${total}`;
}

/** Total ainda em aberto de um conjunto de parcelamentos. */
export function totalRemaining(
  items: readonly { amountCents: Cents; sequence: number; total: number }[],
  mode: "including-current" | "after-current" = "including-current"
): Cents {
  const fn = mode === "including-current" ? remainingIncludingCurrent : remainingAfterCurrent;
  return cents(items.reduce((acc, i) => acc + fn(i.amountCents, i.sequence, i.total), 0));
}
