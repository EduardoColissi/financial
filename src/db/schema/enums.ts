import { pgEnum } from "drizzle-orm/pg-core";

export const accountType = pgEnum("account_type", ["checking", "cash", "brokerage"]);

export const categoryKind = pgEnum("category_kind", ["expense", "income", "investment"]);

/**
 * `transfer` cobre dois casos: mover dinheiro entre contas proprias e pagar a
 * fatura do cartao. O segundo e' o unico momento em que dinheiro de cartao sai
 * do caixa.
 */
export const transactionKind = pgEnum("transaction_kind", [
  "income",
  "expense",
  "investment_in",
  "investment_out",
  "transfer",
]);

export const paymentMethod = pgEnum("payment_method", [
  "pix",
  "debit",
  "credit",
  "boleto",
  "cash",
  "auto_debit",
  "transfer",
]);

/** De onde o lancamento veio. `import` existe para a futura carga de extrato. */
export const transactionSource = pgEnum("transaction_source", [
  "manual",
  "recurring",
  "card_payment",
  "import",
]);

/**
 * `bill` vence numa conta ou boleto; `subscription` cai na fatura de um cartao.
 * A distincao NAO e' "fixa x parcelada" — o design mistura os dois eixos, e ha'
 * parcela em boleto ("Curso de inglês") que quebra qualquer modelo em que
 * parcela implique cartao.
 */
export const recurrenceKind = pgEnum("recurrence_kind", ["bill", "subscription"]);

export const occurrenceStatus = pgEnum("occurrence_status", ["pending", "paid", "skipped"]);

export const statementStatus = pgEnum("statement_status", ["open", "closed", "paid"]);

export const investmentFlowKind = pgEnum("investment_flow_kind", [
  "contribution",
  "withdrawal",
  "dividend",
  "fee",
  "adjustment",
]);

export const goalSourceMode = pgEnum("goal_source_mode", [
  "manual",
  "linked_segment",
  "linked_assets",
]);
