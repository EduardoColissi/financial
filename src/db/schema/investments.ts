import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./core";
import { goalSourceMode, investmentFlowKind } from "./enums";
import { transactions } from "./transactions";

export const investmentSegments = pgTable(
  "investment_segments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull(),
    /** Alocacao alvo em %. Nulo = sem alvo definido. */
    targetPercent: numeric("target_percent", { precision: 5, scale: 2 }),
    sortOrder: smallint("sort_order").notNull().default(0),
  },
  (t) => [
    uniqueIndex("segments_user_name_uq").on(t.userId, sql`lower(${t.name})`),
    check(
      "segments_target_ck",
      sql`${t.targetPercent} is null or (${t.targetPercent} >= 0 and ${t.targetPercent} <= 100)`
    ),
  ]
);

export const investmentAssets = pgTable(
  "investment_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    segmentId: uuid("segment_id")
      .notNull()
      .references(() => investmentSegments.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    ticker: text("ticker"),
    detail: text("detail"),
    custodian: text("custodian"),
    colorOverride: text("color_override"),
    sortOrder: smallint("sort_order").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("assets_user_name_uq").on(t.userId, sql`lower(${t.name})`),
    index("assets_user_segment_idx").on(t.userId, t.segmentId),
  ]
);

/**
 * Movimento na carteira.
 *
 * `flows_cash_link_ck` e' a regra C1 gravada no banco: dividendo, taxa e ajuste
 * NAO podem ter lancamento associado. Ou seja, e' fisicamente impossivel um
 * provento reinvestido virar receita do mes — nao depende de disciplina do
 * codigo de aplicacao.
 */
export const investmentFlows = pgTable(
  "investment_flows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => investmentAssets.id, { onDelete: "cascade" }),
    kind: investmentFlowKind("kind").notNull(),
    occurredOn: date("occurred_on").notNull(),
    refMonth: date("ref_month").notNull(),
    amountCents: integer("amount_cents").notNull(),
    quantity: numeric("quantity", { precision: 20, scale: 8 }),
    /** Provento reinvestido permanece na carteira e nao toca o caixa. */
    reinvested: boolean("reinvested").notNull().default(true),
    transactionId: uuid("transaction_id").references(() => transactions.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
  },
  (t) => [
    index("flows_user_asset_month_idx").on(t.userId, t.assetId, t.refMonth),
    index("flows_user_month_idx").on(t.userId, t.refMonth),
    check("flows_amount_ck", sql`${t.amountCents} > 0`),
    check("flows_ref_ck", sql`extract(day from ${t.refMonth}) = 1`),
    // Regra C1, imposta pelo banco.
    check(
      "flows_cash_link_ck",
      sql`${t.kind} in ('contribution','withdrawal') or ${t.transactionId} is null`
    ),
  ]
);

/**
 * Valor de mercado por ativo por mes.
 *
 * O design guarda `saldo`/`mes`/`prov` como colunas do ativo, o que so' descreve
 * "o mes atual" — navegar para julho mostraria o rendimento de agosto. Com o
 * historico aqui, o rendimento de qualquer mes e' reconstruivel.
 */
export const investmentValuations = pgTable(
  "investment_valuations",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => investmentAssets.id, { onDelete: "cascade" }),
    refMonth: date("ref_month").notNull(),
    marketValueCents: integer("market_value_cents").notNull(),
    measuredOn: date("measured_on").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.assetId, t.refMonth] }),
    index("valuations_user_month_idx").on(t.userId, t.refMonth),
    check("valuations_value_ck", sql`${t.marketValueCents} >= 0`),
    check("valuations_ref_ck", sql`extract(day from ${t.refMonth}) = 1`),
  ]
);

/**
 * Meta / caixinha.
 *
 * A "Reserva de emergência" do design (R$ 18.400) e' exatamente a soma dos dois
 * ativos do segmento "Reserva · caixinhas". Modelar meta so' como valor manual
 * faria o usuario digitar o mesmo numero em dois lugares e ve-los divergir com
 * o tempo — dai' os tres modos de origem.
 */
export const goals = pgTable(
  "goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull(),
    targetCents: integer("target_cents").notNull(),
    sourceMode: goalSourceMode("source_mode").notNull().default("manual"),
    manualAmountCents: integer("manual_amount_cents"),
    linkedSegmentId: uuid("linked_segment_id").references(() => investmentSegments.id, {
      onDelete: "set null",
    }),
    /** Texto livre do design ("6 meses de custo", "meta out/2027"). */
    deadlineLabel: text("deadline_label"),
    deadlineOn: date("deadline_on"),
    sortOrder: smallint("sort_order").notNull().default(0),
  },
  (t) => [
    index("goals_user_idx").on(t.userId, t.sortOrder),
    check("goals_target_ck", sql`${t.targetCents} > 0`),
    check(
      "goals_source_ck",
      sql`(${t.sourceMode} = 'manual'         and ${t.manualAmountCents} is not null) or
          (${t.sourceMode} = 'linked_segment' and ${t.linkedSegmentId}   is not null) or
          (${t.sourceMode} = 'linked_assets')`
    ),
  ]
);

export const goalAssets = pgTable(
  "goal_assets",
  {
    goalId: uuid("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => investmentAssets.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.goalId, t.assetId] })]
);
