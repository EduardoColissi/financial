import type { TransactionKind } from "./cash-flow";
import { isSameOrBefore, type PlainDate } from "./period";

/**
 * Status e' DERIVADO, nunca coluna.
 *
 * O design guarda `status` como string solta em cada lancamento do mock, o que
 * permite um lancamento pago com `settled_on` nulo, ou uma compra no credito
 * marcada como "pago". Aqui o estado sai dos fatos.
 */

export type TransactionStatus =
  | "pago"
  | "recebido"
  | "aplicado"
  | "resgatado"
  | "na fatura"
  | "parcelado"
  | "em aberto";

/** Tom visual. A cor concreta e' decidida pelos tokens, nao aqui. */
export type Tone = "ok" | "warn" | "neutral" | "info";

export interface TransactionStatusInput {
  kind: TransactionKind;
  onCredit: boolean;
  /** Data em que o dinheiro efetivamente entrou/saiu. Nulo = ainda nao. */
  settledOn?: PlainDate | null;
  installmentTotal?: number | null;
}

export function txStatus(input: TransactionStatusInput): TransactionStatus {
  if (input.onCredit) {
    // No credito o dinheiro nao saiu: o que existe e' posicao na fatura.
    return input.installmentTotal != null && input.installmentTotal > 1 ? "parcelado" : "na fatura";
  }

  if (input.settledOn == null) return "em aberto";

  switch (input.kind) {
    case "income":
      return "recebido";
    case "investment_out":
      return "aplicado";
    case "investment_in":
      return "resgatado";
    default:
      return "pago";
  }
}

export function statusTone(status: TransactionStatus): Tone {
  switch (status) {
    case "pago":
    case "recebido":
    case "aplicado":
    case "resgatado":
      return "ok";
    case "em aberto":
      return "warn";
    case "parcelado":
      return "info";
    default:
      return "neutral";
  }
}

// ── cobrancas agendadas ──────────────────────────────────────────────────────

export type ChargePhase = "paga" | "na fatura" | "prevista" | "vencida";

export interface ChargePhaseInput {
  dueDate: PlainDate;
  paid: boolean;
  /** Cobranca no cartao entra na fatura; em conta/boleto, vence. */
  onCredit: boolean;
}

/**
 * Regra C4: a cobranca entra na fatura no dia do faturamento.
 *
 * Deliberadamente calculada na leitura, nunca materializada como flag: o valor
 * muda sozinho a' meia-noite, e o plano Hobby da Vercel so' permite um cron
 * diario — uma coluna `is_posted` ficaria errada por ate' 24 horas.
 */
export function chargePhase(input: ChargePhaseInput, today: PlainDate): ChargePhase {
  if (input.paid) return "paga";
  if (isSameOrBefore(input.dueDate, today)) {
    return input.onCredit ? "na fatura" : "vencida";
  }
  return "prevista";
}

export function chargePhaseTone(phase: ChargePhase): Tone {
  switch (phase) {
    case "paga":
      return "ok";
    case "vencida":
      return "warn";
    case "prevista":
      return "warn";
    default:
      return "neutral";
  }
}
