import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts, categories, creditCards, users } from "./core";
import { paymentMethod, statementStatus, transactionKind, transactionSource } from "./enums";

/**
 * Lancamento. A unidade de movimento do sistema.
 *
 * Nao ha' coluna `status`: ele e' derivado de `settledOn`, `cardId` e `kind`
 * (ver domain/status). O mock guarda status como string solta, o que permite
 * uma compra no credito marcada como "pago" enquanto o dinheiro nao saiu.
 *
 * `occurredOn` e' quando aconteceu; `competenceMonth` e' a que mes o gasto
 * pertence. Por decisao do usuario, compra no credito tem competencia no mes da
 * COMPRA, nao no da fatura — mas a coluna e' editavel caso a caso.
 */
export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: transactionKind("kind").notNull(),
    occurredOn: date("occurred_on").notNull(),
    competenceMonth: date("competence_month").notNull(),
    description: text("description").notNull(),
    amountCents: integer("amount_cents").notNull(),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "restrict" }),
    method: paymentMethod("method").notNull(),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "restrict" }),
    cardId: uuid("card_id").references(() => creditCards.id, { onDelete: "restrict" }),
    transferAccountId: uuid("transfer_account_id").references((): AnyPgColumn => accounts.id, {
      onDelete: "restrict",
    }),
    /** Congelado no insert: se o dia de fechamento mudar depois, a fatura em que
     * a compra caiu nao pode mudar retroativamente. */
    statementId: uuid("statement_id").references((): AnyPgColumn => cardStatements.id, {
      onDelete: "set null",
    }),
    installmentSeq: smallint("installment_seq"),
    installmentTotal: smallint("installment_total"),
    /** Estorno: reduz a despesa em vez de virar receita. */
    isRefund: boolean("is_refund").notNull().default(false),
    /** Quando o dinheiro efetivamente entrou/saiu. Nulo = ainda em aberto. */
    settledOn: date("settled_on"),
    notes: text("notes"),
    source: transactionSource("source").notNull().default("manual"),
    /** Chave de idempotencia. Existe desde ja' para a futura importacao de
     * extrato: sem ela, reimportar o mesmo arquivo duplica tudo. */
    externalId: text("external_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tx_user_competence_idx").on(t.userId, t.competenceMonth),
    index("tx_user_account_date_idx").on(t.userId, t.accountId, t.occurredOn),
    index("tx_user_statement_idx").on(t.userId, t.statementId),
    index("tx_user_category_month_idx").on(t.userId, t.categoryId, t.competenceMonth),
    uniqueIndex("tx_external_uq")
      .on(t.userId, t.source, t.externalId)
      .where(sql`${t.externalId} is not null`),

    // Valor sempre positivo: a direcao vem de `kind`, nunca do sinal.
    check("tx_amount_ck", sql`${t.amountCents} > 0 and ${t.amountCents} < 2000000000`),
    // Competencia e' sempre o primeiro dia do mes — e' a chave temporal.
    check("tx_competence_ck", sql`extract(day from ${t.competenceMonth}) = 1`),
    check(
      "tx_installment_ck",
      sql`(${t.installmentSeq} is null) = (${t.installmentTotal} is null)
          and (${t.installmentSeq} is null or ${t.installmentSeq} between 1 and ${t.installmentTotal})`
    ),
    // Transferencia nao tem categoria; todo o resto tem.
    check("tx_category_ck", sql`(${t.kind} = 'transfer') = (${t.categoryId} is null)`),
    // Cartao e metodo credito andam juntos, sempre.
    check("tx_card_method_ck", sql`(${t.cardId} is not null) = (${t.method} = 'credit')`),
    // Cada tipo exige exatamente um destino coerente.
    check(
      "tx_target_ck",
      sql`case ${t.kind}
            when 'expense'        then (${t.cardId} is not null) <> (${t.accountId} is not null)
            when 'income'         then ${t.accountId} is not null and ${t.cardId} is null
            when 'investment_out' then ${t.accountId} is not null and ${t.cardId} is null
            when 'investment_in'  then ${t.accountId} is not null and ${t.cardId} is null
            when 'transfer'       then ${t.accountId} is not null
                                      and (${t.transferAccountId} is not null or ${t.statementId} is not null)
          end`
    ),
  ]
);

/**
 * Fatura de cartao.
 *
 * `refMonth` e' o mes do VENCIMENTO — e' assim que o usuario fala ("a fatura de
 * setembro"). O periodo coberto (`periodStart`..`periodEnd`) costuma comecar no
 * mes anterior.
 *
 * `closedTotalCents` congela o valor no fechamento: editar uma compra antiga nao
 * pode mudar o total de uma fatura ja' fechada.
 */
export const cardStatements = pgTable(
  "card_statements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    cardId: uuid("card_id")
      .notNull()
      .references(() => creditCards.id, { onDelete: "cascade" }),
    refMonth: date("ref_month").notNull(),
    periodStart: date("period_start").notNull(),
    /** Data de fechamento. Compras ate' aqui, inclusive, entram nesta fatura. */
    periodEnd: date("period_end").notNull(),
    dueDate: date("due_date").notNull(),
    status: statementStatus("status").notNull().default("open"),
    closedTotalCents: integer("closed_total_cents"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    paidOn: date("paid_on"),
    paidAmountCents: integer("paid_amount_cents"),
    paymentTransactionId: uuid("payment_transaction_id").references(
      (): AnyPgColumn => transactions.id,
      { onDelete: "set null" }
    ),
  },
  (t) => [
    // Uma fatura por cartao por mes. Base da idempotencia da materializacao.
    uniqueIndex("statements_card_month_uq").on(t.cardId, t.refMonth),
    index("statements_user_due_idx").on(t.userId, t.dueDate),
    check("statements_period_ck", sql`${t.periodEnd} >= ${t.periodStart}`),
    check("statements_ref_ck", sql`extract(day from ${t.refMonth}) = 1`),
    check("statements_paid_ck", sql`(${t.status} = 'paid') = (${t.paidOn} is not null)`),
    check(
      "statements_amounts_ck",
      sql`(${t.closedTotalCents} is null or ${t.closedTotalCents} >= 0)
          and (${t.paidAmountCents} is null or ${t.paidAmountCents} >= 0)`
    ),
  ]
);
