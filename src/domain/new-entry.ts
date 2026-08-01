import { type CashEffect, cashEffect, type TransactionKind } from "./cash-flow";
import { brl, type Cents, splitInstallments, sumCents } from "./money";
import {
  addMonths,
  monthLabel,
  monthOf,
  type PlainDate,
  partsOfDate,
  type RefMonth,
} from "./period";
import { type TransactionStatus, txStatus } from "./status";

/**
 * O que o modal de novo lancamento produz.
 *
 * Este modulo e' puro de proposito: a previa que o usuario le' enquanto digita e
 * a persistencia que roda no servidor chamam EXATAMENTE as mesmas funcoes. No
 * design as duas coisas divergem — a previa calcula `nvVal / nvParc` em float
 * (linha 1538) e o "salvar" monta o objeto por outro caminho, entao o numero
 * prometido nao e' o numero gravado.
 */

/** Vocabulario do usuario. O enum do banco (`transaction_kind`) e' outro. */
export type EntryType = "despesa" | "receita" | "aporte";

export type EntryMethod = "pix" | "debit" | "credit" | "boleto" | "cash" | "transfer";

export const ENTRY_TYPES: ReadonlyArray<{ value: EntryType; label: string }> = [
  { value: "despesa", label: "Despesa" },
  { value: "receita", label: "Receita" },
  { value: "aporte", label: "Aporte" },
];

export const METHOD_LABELS: Readonly<Record<EntryMethod, string>> = {
  pix: "Pix",
  debit: "Débito",
  credit: "Crédito",
  boleto: "Boleto",
  cash: "Dinheiro",
  transfer: "Transferência",
};

/**
 * Meios validos por tipo.
 *
 * Nao e' preferencia de UI: os CHECKs `tx_target_ck` e `tx_card_method_ck`
 * tornam receita e aporte no credito fisicamente impossiveis. Oferecer a opcao
 * so' produziria um erro do banco depois de o usuario preencher o formulario
 * inteiro. O design oferece os cinco meios para os tres tipos.
 */
export function methodsFor(type: EntryType): readonly EntryMethod[] {
  switch (type) {
    case "despesa":
      return ["pix", "debit", "credit", "boleto", "cash"];
    case "receita":
      return ["pix", "transfer", "boleto", "cash"];
    case "aporte":
      return ["pix", "transfer", "debit"];
  }
}

/**
 * Parcelar so' faz sentido onde existe credito concedido.
 *
 * Boleto entra porque o proprio design tem uma parcela em boleto (o "Curso de
 * inglês"), que e' justamente o caso que quebra o modelo "parcela ⇒ cartao".
 */
export function allowsInstallments(type: EntryType, method: EntryMethod): boolean {
  return type === "despesa" && (method === "credit" || method === "boleto");
}

export function kindOf(type: EntryType): TransactionKind {
  switch (type) {
    case "despesa":
      return "expense";
    case "receita":
      return "income";
    case "aporte":
      return "investment_out";
  }
}

/** O tipo pede categoria de qual natureza. */
export function categoryKindOf(type: EntryType): "expense" | "income" | "investment" {
  switch (type) {
    case "despesa":
      return "expense";
    case "receita":
      return "income";
    case "aporte":
      return "investment";
  }
}

export interface EntryInput {
  type: EntryType;
  amountCents: Cents;
  method: EntryMethod;
  /** O alvo escolhido e' um cartao de credito? */
  onCredit: boolean;
  occurredOn: PlainDate;
  /** 1 = a' vista. */
  installments: number;
  /** Toggle "repetir todo mes". Ignorado quando ha' parcelamento. */
  repeats: boolean;
}

/**
 * Em que forma o lancamento e' gravado.
 *
 * `installment-rule` e `recurring-rule` NAO viram N transacoes soltas: viram uma
 * regra e as ocorrencias derivadas dela. E' o achado 1 do plano — no design a
 * mesma obrigacao aparece em ate' tres lugares e seria contada tres vezes.
 */
export type EntryShape = "transaction" | "installment-rule" | "recurring-rule";

export interface EntryPlan {
  shape: EntryShape;
  kind: TransactionKind;
  competenceMonth: RefMonth;
  /** Valor de cada parcela, na ordem. Um item so' quando e' a' vista. */
  schedule: Cents[];
  /** Dia do mes em que cada ocorrencia cai. */
  dueDay: number;
  firstRefMonth: RefMonth;
  /** Ultimo mes com cobranca. Nulo em recorrencia sem fim previsto. */
  lastRefMonth: RefMonth | null;
  /** O dinheiro sai/entra no ato? No credito, nunca: sai no pagamento da fatura. */
  settlesOnPurchase: boolean;
  effect: CashEffect;
  status: TransactionStatus;
}

export function planEntry(input: EntryInput): EntryPlan {
  const kind = kindOf(input.type);
  const competenceMonth = monthOf(input.occurredOn);
  const installments = Math.max(1, Math.trunc(input.installments));
  const parcelado = installments > 1;
  // Parcelamento manda: quem parcela em 10x ja' esta' repetindo por 10 meses, e
  // ligar o toggle junto criaria uma segunda regra para a mesma obrigacao.
  const repeats = !parcelado && input.repeats;

  const shape: EntryShape = parcelado
    ? "installment-rule"
    : repeats
      ? "recurring-rule"
      : "transaction";

  return {
    shape,
    kind,
    competenceMonth,
    schedule: parcelado ? splitInstallments(input.amountCents, installments) : [input.amountCents],
    dueDay: partsOfDate(input.occurredOn).day,
    firstRefMonth: competenceMonth,
    lastRefMonth: parcelado ? addMonths(competenceMonth, installments - 1) : null,
    settlesOnPurchase: !input.onCredit,
    effect: cashEffect({ kind, onCredit: input.onCredit }),
    status: txStatus({
      kind,
      onCredit: input.onCredit,
      settledOn: input.onCredit ? null : input.occurredOn,
      installmentTotal: parcelado ? installments : null,
    }),
  };
}

// ── previa ───────────────────────────────────────────────────────────────────

export interface EntryLabels {
  categoryName: string | null;
  methodLabel: string;
  targetName: string | null;
}

/**
 * "3× de R$ 33,33 (1ª de R$ 33,34) = R$ 100,00 · Alimentação · Crédito · Nubank"
 *
 * O resto vai para a primeira parcela e a previa DIZ isso. O design promete
 * "3× R$ 33,33" e grava outro valor — R$ 100 em 3x simplesmente nao fecha
 * (achado 12).
 */
export function scheduleLabel(schedule: readonly Cents[]): string {
  const first = schedule[0];
  if (first === undefined) return "";
  if (schedule.length === 1) return brl(first);

  const rest = schedule[1];
  const total = sumCents(schedule);
  if (rest === undefined || first === rest) {
    return `${schedule.length}× de ${brl(first)} = ${brl(total)}`;
  }
  return `${schedule.length}× de ${brl(rest)} (1ª de ${brl(first)}) = ${brl(total)}`;
}

/** Linha de previa do modal. Vazia quando ainda nao ha' valor. */
export function previewOf(plan: EntryPlan, labels: EntryLabels): string {
  const parts = [scheduleLabel(plan.schedule)];
  if (labels.categoryName) parts.push(labels.categoryName);
  parts.push(labels.methodLabel);
  if (labels.targetName) parts.push(labels.targetName);

  if (plan.shape === "installment-rule" && plan.lastRefMonth) {
    parts.push(`até ${monthLabel(plan.lastRefMonth).toLowerCase()}`);
  }
  if (plan.shape === "recurring-rule") parts.push("repete todo mês");

  return parts.join(" · ");
}

/**
 * A frase do rodape: o que acontece com o dinheiro.
 *
 * Existe porque as consequencias nao sao obvias — uma compra no credito conta
 * como despesa do mes mas nao tira nada do caixa hoje, e um aporte sai do caixa
 * sem ser despesa.
 */
export function effectHint(plan: EntryPlan, labels: EntryLabels): string {
  const where = labels.categoryName ? ` de ${labels.categoryName}` : "";

  if (plan.shape !== "transaction") {
    const destino = plan.effect.affectsCash ? "nas contas a pagar" : "na fatura do cartão";
    return plan.shape === "installment-rule"
      ? `vira um parcelamento e aparece ${destino}, uma parcela por mês`
      : `vira uma recorrência e aparece ${destino} todo mês`;
  }

  switch (plan.kind) {
    case "expense":
      return plan.effect.affectsCash
        ? `sai do caixa hoje e entra no orçamento${where}`
        : `entra no orçamento${where} e no gasto de ${monthLabel(plan.competenceMonth).toLowerCase()}; do caixa só sai quando a fatura for paga`;
    case "income":
      return `soma às receitas de ${monthLabel(plan.competenceMonth).toLowerCase()}`;
    default:
      return "sai do caixa e entra na carteira — aporte não é despesa";
  }
}
