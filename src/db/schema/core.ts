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
import { accountType, categoryKind } from "./enums";

/**
 * `user_id NOT NULL` esta' em TODAS as tabelas de dominio, inclusive nas filhas
 * que ja' poderiam chegar la' por JOIN. E' redundancia deliberada: autorizacao
 * vira uma condicao so' em qualquer query, e habilitar RLS depois nao exige
 * reescrever nada. Hoje ha' um unico usuario; isso nao muda o desenho.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("America/Sao_Paulo"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Conta corrente, dinheiro em especie ou corretora.
 *
 * NAO existe coluna `balance`: o saldo e' derivado de `openingBalanceCents` mais
 * os lancamentos posteriores. Guardar saldo abriria a porta para ele divergir
 * dos lancamentos, que e' o pior tipo de bug num app de financas — silencioso e
 * so' descoberto na conciliacao.
 */
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: accountType("type").notNull(),
    tag: text("tag"),
    initials: text("initials").notNull(),
    color: text("color").notNull(),
    openingBalanceCents: integer("opening_balance_cents").notNull().default(0),
    openingBalanceOn: date("opening_balance_on").notNull(),
    includeInCashTotal: boolean("include_in_cash_total").notNull().default(true),
    sortOrder: smallint("sort_order").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("accounts_user_name_uq").on(t.userId, sql`lower(${t.name})`),
    index("accounts_user_idx").on(t.userId, t.sortOrder),
  ]
);

export const creditCards = pgTable(
  "credit_cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    brand: text("brand").notNull(),
    lastFour: text("last_four"),
    limitCents: integer("limit_cents").notNull(),
    closingDay: smallint("closing_day").notNull(),
    dueDay: smallint("due_day").notNull(),
    /** Nulo = derivar como fechamento + 1. Ver domain/card-cycle. */
    bestDayOverride: smallint("best_day_override"),
    defaultPaymentAccountId: uuid("default_payment_account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),
    color: text("color").notNull(),
    sortOrder: smallint("sort_order").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("cards_user_name_uq").on(t.userId, sql`lower(${t.name})`),
    check("cards_closing_day_ck", sql`${t.closingDay} between 1 and 31`),
    check("cards_due_day_ck", sql`${t.dueDay} between 1 and 31`),
    check(
      "cards_best_day_ck",
      sql`${t.bestDayOverride} is null or ${t.bestDayOverride} between 1 and 31`
    ),
    check("cards_limit_ck", sql`${t.limitCents} >= 0`),
  ]
);

export const categoryGroups = pgTable(
  "category_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull(),
    sortOrder: smallint("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("cat_groups_user_name_uq").on(t.userId, sql`lower(${t.name})`)]
);

/**
 * A cor da categoria e' DADO, nao token de design: o usuario escolhe na paleta
 * de 8 cores ao criar a categoria.
 *
 * `monthlyBudgetCents` e' o orcamento padrao. O acompanhamento mes a mes fica em
 * `category_budgets`, porque orcamento muda ao longo do ano.
 */
export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    groupId: uuid("group_id").references(() => categoryGroups.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    color: text("color").notNull(),
    kind: categoryKind("kind").notNull().default("expense"),
    monthlyBudgetCents: integer("monthly_budget_cents"),
    /** Categorias do sistema (Renda, Aporte) nao podem ser apagadas. */
    isSystem: boolean("is_system").notNull().default(false),
    sortOrder: smallint("sort_order").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    // O design rejeita duplicata comparando toLowerCase() no cliente (linha
    // 1510), mas nada impede no dado. Aqui o banco garante.
    uniqueIndex("categories_user_name_uq").on(t.userId, sql`lower(${t.name})`),
    index("categories_user_kind_idx").on(t.userId, t.kind),
    // Só despesa pertence a grupo (Essencial / Qualidade de vida / Desenvolvimento).
    check("categories_group_ck", sql`(${t.kind} = 'expense') = (${t.groupId} is not null)`),
    check(
      "categories_budget_ck",
      sql`${t.monthlyBudgetCents} is null or ${t.monthlyBudgetCents} >= 0`
    ),
  ]
);
