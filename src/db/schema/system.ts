import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { categories, users } from "./core";

/**
 * Orcamento por categoria e por mes.
 *
 * `categories.monthly_budget_cents` guarda o padrao; esta tabela guarda o valor
 * de um mes especifico, porque orcamento muda ao longo do ano (dezembro nao e'
 * como fevereiro). Sem linha aqui, vale o padrao da categoria.
 */
export const categoryBudgets = pgTable(
  "category_budgets",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    refMonth: date("ref_month").notNull(),
    amountCents: integer("amount_cents").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.categoryId, t.refMonth] }),
    index("budgets_user_month_idx").on(t.userId, t.refMonth),
    check("budgets_amount_ck", sql`${t.amountCents} >= 0`),
    check("budgets_ref_ck", sql`extract(day from ${t.refMonth}) = 1`),
  ]
);

/**
 * Cache de agregados do mes.
 *
 * `frozen = false` significa "e' cache, pode recomputar" — nunca fonte da
 * verdade, entao nao pode divergir em silencio. `frozen = true` fica reservado
 * a meses historicos carregados sem lancamento (o grafico de 6 meses do design
 * traz mar-jul assim).
 */
export const monthlyCashflowSnapshots = pgTable(
  "monthly_cashflow_snapshots",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    refMonth: date("ref_month").notNull(),
    incomeCents: integer("income_cents").notNull().default(0),
    expenseCents: integer("expense_cents").notNull().default(0),
    contributionCents: integer("contribution_cents").notNull().default(0),
    withdrawalCents: integer("withdrawal_cents").notNull().default(0),
    cashBalanceEndCents: integer("cash_balance_end_cents"),
    investmentValueEndCents: integer("investment_value_end_cents"),
    netWorthEndCents: integer("net_worth_end_cents"),
    frozen: boolean("frozen").notNull().default(false),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.refMonth] }),
    check("snap_ref_ck", sql`extract(day from ${t.refMonth}) = 1`),
  ]
);

/**
 * Preferencias e travas de navegacao temporal.
 *
 * `startRefMonth` impede materializar 2019 se o usuario segurar o botao de mes
 * anterior; `maxFutureMonths` faz o mesmo no outro sentido.
 */
export const appSettings = pgTable("app_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  startRefMonth: date("start_ref_month").notNull(),
  maxFutureMonths: smallint("max_future_months").notNull().default(24),
  hideValuesDefault: boolean("hide_values_default").notNull().default(false),
});

/*
 * Aqui vivia `login_attempts`, o limite de 5 tentativas por IP do gate de
 * passphrase. Saiu junto com a senha: no login pelo Google nao ha' segredo
 * nosso para adivinhar — quem aguenta forca bruta contra a conta e' o Google.
 */

/**
 * Trilha de auditoria das mutacoes de dinheiro.
 *
 * O plano Hobby da Vercel guarda logs de runtime por apenas 1 hora — um erro de
 * valor descoberto no dia seguinte seria indebugavel. Gravar no proprio banco
 * custa quase nada e resolve.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id"),
    beforeCents: integer("before_cents"),
    afterCents: integer("after_cents"),
    detail: text("detail"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_user_time_idx").on(t.userId, t.occurredAt)]
);
