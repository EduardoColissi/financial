import { sql } from "drizzle-orm";
import {
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
import { occurrenceStatus, paymentMethod, recurrenceKind } from "./enums";
import { cardStatements, transactions } from "./transactions";

/**
 * Regra de recorrencia — a obrigacao, nao a cobranca.
 *
 * O design espalha a MESMA obrigacao por ate' tres lugares: "Notebook Dell"
 * aparece em TX (parcelado 5/10), em RECS (dia 27) e em CARDS[].parcelas.
 * Modelar aquilo ao pe' da letra geraria lancamento triplo. Aqui existe uma
 * regra por obrigacao real, e tudo o mais e' derivado dela.
 *
 * `bill` x `subscription` distingue o MEIO (conta/boleto x cartao), nao
 * "fixa x parcelada" — sao eixos independentes, e o mock tem as 4 combinacoes
 * (o "Curso de inglês" e' parcela em boleto).
 *
 * A parcela corrente NAO e' coluna: sai de `firstRefMonth` (ver
 * domain/installments). E' isso que torna a geracao funcional e idempotente.
 */
export const recurringRules = pgTable(
  "recurring_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: recurrenceKind("kind").notNull(),
    name: text("name").notNull(),
    // `cascade` pelo mesmo motivo de `transactions`: apagar a conta, o cartao ou
    // a categoria apaga a regra que dependia deles, e as cobrancas geradas caem
    // junto pelo cascade de `scheduled_charges`.
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    method: paymentMethod("method").notNull(),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "cascade" }),
    cardId: uuid("card_id").references(() => creditCards.id, { onDelete: "cascade" }),
    dueDay: smallint("due_day").notNull(),
    amountCents: integer("amount_cents"),
    /** Conta de consumo (luz, agua, gas): o valor muda todo mes. */
    isVariable: boolean("is_variable").notNull().default(false),
    estimatedCents: integer("estimated_cents"),
    /*
     * Aqui vivia `autopay`.
     *
     * Ele so' pintava um rotulo: nenhuma conta era quitada sozinha, e continuava
     * exigindo o mesmo clique em "Pagar". Duas palavras diferentes para o mesmo
     * estado — e a que dizia "automático" era a mentirosa.
     */
    /**
     * Entra no custo de vida.
     *
     * Aluguel, luz e plano de saude entram; Netflix nao. A distincao nao e'
     * cosmetica: e' a base da reserva de emergencia, que precisa cobrir seis
     * meses do que NAO da' para cortar. Somar streaming ali inflaria a meta e
     * faria o dono guardar dinheiro para manter assinatura em crise.
     */
    essential: boolean("essential").notNull().default(false),
    firstRefMonth: date("first_ref_month").notNull(),
    /** Nulo = assinatura sem fim previsto. */
    installmentsTotal: smallint("installments_total"),
    endRefMonth: date("end_ref_month"),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /** Lancamento que originou a regra (toggle "repete todo mes" no modal). */
    sourceTransactionId: uuid("source_transaction_id").references(() => transactions.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("rules_user_live_idx").on(t.userId, t.archivedAt, t.pausedAt),
    // Cobranca cai numa conta OU num cartao, nunca nos dois nem em nenhum.
    check("rules_target_ck", sql`(${t.accountId} is not null) <> (${t.cardId} is not null)`),
    check("rules_due_day_ck", sql`${t.dueDay} between 1 and 31`),
    // Valor fixo exige valor; valor variavel exige que ele seja nulo.
    check(
      "rules_amount_ck",
      sql`(${t.isVariable} and ${t.amountCents} is null)
          or (not ${t.isVariable} and ${t.amountCents} is not null and ${t.amountCents} > 0)`
    ),
    check("rules_estimated_ck", sql`${t.estimatedCents} is null or ${t.estimatedCents} >= 0`),
    check("rules_inst_ck", sql`${t.installmentsTotal} is null or ${t.installmentsTotal} >= 1`),
    check("rules_first_ck", sql`extract(day from ${t.firstRefMonth}) = 1`),
    check("rules_end_ck", sql`${t.endRefMonth} is null or extract(day from ${t.endRefMonth}) = 1`),
  ]
);

/**
 * Cobranca agendada — a ocorrencia mensal de uma regra.
 *
 * Materializada sob demanda ao abrir o mes (ver services/materialize). O plano
 * Hobby da Vercel so' permite um cron diario, entao nada pode depender de job:
 * a geracao e' preguicosa e idempotente, e o cron e' apenas cinto de seguranca.
 *
 * NAO existe flag `is_posted` ("ja' caiu na fatura"): esse valor muda sozinho a'
 * meia-noite e ficaria errado por ate' 24 horas. E' calculado na leitura, a
 * partir de `dueDate` (ver domain/status.chargePhase).
 */
export const scheduledCharges = pgTable(
  "scheduled_charges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => recurringRules.id, { onDelete: "cascade" }),
    refMonth: date("ref_month").notNull(),
    /** Numero da parcela, quando a regra e' parcelada. Derivado, gravado por conveniencia de leitura. */
    sequence: smallint("sequence"),
    dueDate: date("due_date").notNull(),
    amountCents: integer("amount_cents").notNull(),
    /**
     * O usuario digitou o valor real (conta de luz do mes).
     *
     * Sem esta flag, a proxima abertura do mes sobrescreveria o que ele digitou
     * com a estimativa da regra.
     */
    amountOverridden: boolean("amount_overridden").notNull().default(false),
    status: occurrenceStatus("status").notNull().default("pending"),
    paidOn: date("paid_on"),
    transactionId: uuid("transaction_id").references(() => transactions.id, {
      onDelete: "set null",
    }),
    statementId: uuid("statement_id").references(() => cardStatements.id, {
      onDelete: "set null",
    }),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // A garantia de idempotencia mora aqui: mesmo com codigo errado, o banco
    // impede duas ocorrencias da mesma regra no mesmo mes.
    uniqueIndex("occ_rule_month_uq").on(t.ruleId, t.refMonth),
    index("occ_user_month_status_idx").on(t.userId, t.refMonth, t.status),
    index("occ_user_due_idx").on(t.userId, t.dueDate),
    index("occ_statement_idx").on(t.statementId),
    check("occ_paid_ck", sql`(${t.status} = 'paid') = (${t.paidOn} is not null)`),
    check("occ_ref_ck", sql`extract(day from ${t.refMonth}) = 1`),
    check("occ_amount_ck", sql`${t.amountCents} >= 0`),
    check("occ_sequence_ck", sql`${t.sequence} is null or ${t.sequence} >= 1`),
  ]
);
