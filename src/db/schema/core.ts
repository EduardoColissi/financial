import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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
  /**
   * `sub` do Google — o identificador estavel da conta.
   *
   * Nulo ate' o primeiro login; gravado ali e exigido de todos os seguintes. O
   * e-mail sozinho nao serve de identidade: o dono pode troca-lo, e endereco de
   * dominio proprio pode ser reatribuido a outra pessoa. O `sub` nunca muda e
   * nunca e' reaproveitado.
   */
  googleSub: text("google_sub").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Conta corrente, dinheiro em especie ou corretora.
 *
 * NAO ha' saldo por conta. No envelope mensal o dinheiro e' um so': a conta
 * registra ONDE ele entrou, para controle, mas o caixa e' usado em conjunto.
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
    /**
     * De quem e' a conta. Texto livre, nao enum.
     *
     * Como receita EXIGE conta (ver `tx_target_ck`), o titular daqui responde
     * "quanto entrou de cada um" por join — sem coluna equivalente em
     * `transactions`, que seria o mesmo dado em dois lugares, livre para
     * divergir. Texto e nao enum porque a lista de pessoas de uma casa muda sem
     * pedir licenca, e cada mudanca viraria migration.
     */
    holder: text("holder"),
    /*
     * Aqui viviam `opening_balance_cents` e `opening_balance_on`.
     *
     * Sairam com o modelo de envelope mensal: nao existe saldo corrente por
     * conta. O mes comeca do zero e recebe o que sobrou do anterior; a conta e'
     * rotulo de ONDE o dinheiro entrou, nao um pote com saldo proprio. Dinheiro
     * que ja' existia quando o app comecou entra como receita do primeiro mes.
     */
    includeInCashTotal: boolean("include_in_cash_total").notNull().default(true),
    sortOrder: smallint("sort_order").notNull().default(0),
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
    /** De quem e' o cartao. Mesma razao de `accounts.holder`. */
    holder: text("holder"),
    limitCents: integer("limit_cents").notNull(),
    closingDay: smallint("closing_day").notNull(),
    dueDay: smallint("due_day").notNull(),
    /** Nulo = derivar como fechamento + 1. Ver domain/card-cycle. */
    bestDayOverride: smallint("best_day_override"),
    /*
     * Aqui vivia `default_payment_account_id`.
     *
     * Saiu com o envelope mensal: o dinheiro e' um so'. A conta registra ONDE
     * ele entrou, nao de qual pote a fatura sai — perguntar isso seria fingir
     * uma separacao que nao existe.
     */
    color: text("color").notNull(),
    sortOrder: smallint("sort_order").notNull().default(0),
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

/*
 * Aqui vivia `category_groups` — "Essencial", "Qualidade de vida",
 * "Desenvolvimento" — e despesa era OBRIGADA a pertencer a um deles.
 *
 * Saiu: o agrupamento que o dono quer e' por CATEGORIA, no grafico. Um nivel
 * intermediario que ninguem preenche e' cadastro a mais para o mesmo resultado.
 */

/**
 * A cor da categoria e' DADO, nao token de design: o usuario escolhe na paleta
 * de 8 cores ao criar a categoria.
 *
 * `kind` separa gasto de receita: "Alimentação" e' `expense`, "Salário Edu" e'
 * `income`. Sao o mesmo cadastro com formularios um pouco diferentes — so'
 * despesa tem orcamento.
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
    name: text("name").notNull(),
    color: text("color").notNull(),
    kind: categoryKind("kind").notNull().default("expense"),
    monthlyBudgetCents: integer("monthly_budget_cents"),
    /** Categorias do sistema (Renda, Aporte) nao podem ser apagadas. */
    isSystem: boolean("is_system").notNull().default(false),
    sortOrder: smallint("sort_order").notNull().default(0),
  },
  (t) => [
    // O design rejeita duplicata comparando toLowerCase() no cliente (linha
    // 1510), mas nada impede no dado. Aqui o banco garante.
    uniqueIndex("categories_user_name_uq").on(t.userId, sql`lower(${t.name})`),
    index("categories_user_kind_idx").on(t.userId, t.kind),
    check(
      "categories_budget_ck",
      sql`${t.monthlyBudgetCents} is null or ${t.monthlyBudgetCents} >= 0`
    ),
  ]
);
