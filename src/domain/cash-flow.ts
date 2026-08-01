import { type Cents, cents } from "./money";

/**
 * O que move o caixa e o que nao move.
 *
 * Esta e' a regra que o design escreve em prosa ("rendimento e' reinvestido e
 * NAO entra no fluxo do mes") mas nao codifica em lugar nenhum. Aqui ela e' uma
 * matriz unica, e todo agregado do sistema passa por ela — nao existe segunda
 * implementacao em componente ou query.
 */

export type TransactionKind =
  | "income"
  | "expense"
  | "investment_in"
  | "investment_out"
  | "transfer";

/** Para onde a transferencia aponta. Pagamento de fatura e' `statement`. */
export type TransferTarget = "account" | "statement";

export interface CashFlowInput {
  kind: TransactionKind;
  /** A despesa foi no cartao de credito? */
  onCredit: boolean;
  transferTarget?: TransferTarget | null;
  /** Estorno/devolucao: inverte o sinal sem virar receita. */
  isRefund?: boolean;
}

export interface CashEffect {
  /** Mexe no saldo somado das contas? */
  affectsCash: boolean;
  /** +1 entra, -1 sai, 0 neutro. */
  sign: -1 | 0 | 1;
  /** Conta como despesa do mes (competencia)? */
  countsAsExpense: boolean;
  /** Conta como receita do mes? */
  countsAsIncome: boolean;
  /** Conta como aporte do mes? (linha propria no KPI, nao e' despesa) */
  countsAsContribution: boolean;
}

const NEUTRAL: CashEffect = {
  affectsCash: false,
  sign: 0,
  countsAsExpense: false,
  countsAsIncome: false,
  countsAsContribution: false,
};

/**
 * A matriz. Sete linhas, uma por combinacao possivel.
 *
 * O caso que mais confunde: despesa no credito NAO sai do caixa no ato, mas
 * CONTA como despesa do mes — porque o usuario decidiu competencia pelo mes da
 * compra. Quem tira o dinheiro do caixa e' o pagamento da fatura, uma vez so',
 * e esse pagamento nao e' despesa (senao o gasto seria contado duas vezes).
 */
export function cashEffect(input: CashFlowInput): CashEffect {
  const refund = input.isRefund === true;

  switch (input.kind) {
    case "income":
      return {
        affectsCash: true,
        sign: refund ? -1 : 1,
        countsAsExpense: false,
        countsAsIncome: true,
        countsAsContribution: false,
      };

    case "expense":
      return {
        // No credito o dinheiro so' sai quando a fatura e' paga.
        affectsCash: !input.onCredit,
        sign: input.onCredit ? 0 : refund ? 1 : -1,
        countsAsExpense: true,
        countsAsIncome: false,
        countsAsContribution: false,
      };

    case "investment_out":
      // Aporte: sai do caixa e entra na carteira. Nao e' despesa.
      return {
        affectsCash: true,
        sign: -1,
        countsAsExpense: false,
        countsAsIncome: false,
        countsAsContribution: true,
      };

    case "investment_in":
      // Resgate: volta para o caixa. Nao e' receita do mes.
      return {
        affectsCash: true,
        sign: 1,
        countsAsExpense: false,
        countsAsIncome: false,
        countsAsContribution: false,
      };

    case "transfer":
      // Pagamento de fatura tira do caixa; transferencia entre contas proprias
      // apenas move saldo de um lugar para outro e some no total.
      return input.transferTarget === "statement"
        ? { ...NEUTRAL, affectsCash: true, sign: -1 }
        : NEUTRAL;

    default: {
      const exhaustive: never = input.kind;
      throw new Error(`Tipo de lancamento desconhecido: ${String(exhaustive)}`);
    }
  }
}

/** Quanto este lancamento move no caixa (com sinal). */
export function cashDelta(input: CashFlowInput, amount: Cents): Cents {
  const effect = cashEffect(input);
  return cents(effect.affectsCash ? amount * effect.sign : 0);
}

export interface MonthTotals {
  incomeCents: Cents;
  expenseCents: Cents;
  contributionCents: Cents;
  /** receitas − despesas − aporte */
  freeCents: Cents;
}

export interface MonthEntry extends CashFlowInput {
  amountCents: Cents;
}

/**
 * Agregado do mes. Uma unica passagem, usando a matriz.
 *
 * Nenhum valor de rendimento, dividendo ou valorizacao chega aqui: eles nao sao
 * `transactions`, vivem em `investment_flows`/`investment_valuations`. E' assim
 * que a regra "rendimento fora do caixa" fica garantida por construcao e nao
 * por disciplina.
 */
export function monthTotals(entries: readonly MonthEntry[]): MonthTotals {
  let income = 0;
  let expense = 0;
  let contribution = 0;

  for (const entry of entries) {
    const effect = cashEffect(entry);
    const signed = entry.isRefund === true ? -entry.amountCents : entry.amountCents;
    if (effect.countsAsIncome) income += signed;
    if (effect.countsAsExpense) expense += signed;
    if (effect.countsAsContribution) contribution += entry.amountCents;
  }

  return {
    incomeCents: cents(income),
    expenseCents: cents(expense),
    contributionCents: cents(contribution),
    freeCents: cents(income - expense - contribution),
  };
}
