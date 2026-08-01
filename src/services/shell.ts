import "server-only";
import { sql } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db/client";
import { type Cents, cents } from "@/domain/money";
import { addMonths, firstDayOf, type RefMonth } from "@/domain/period";
import type { AppContext } from "./context";
import { ensureMonthMaterialized } from "./materialize";

/**
 * Dados do shell: badges da navegacao e patrimonio.
 *
 * Roda em todo request do layout, entao e' uma unica query agregada em vez de
 * sete contagens separadas.
 */
export interface ShellData {
  transactionsCount: number;
  openBillsCount: number;
  upcomingChargesCount: number;
  openStatementsCount: number;
  statementsCount: number;
  categoriesCount: number;
  netWorthCents: Cents;
  monthReturnCents: Cents;
  monthReturnPercent: number;
}

export const getShellData = cache(async (ctx: AppContext, month: RefMonth): Promise<ShellData> => {
  await ensureMonthMaterialized(ctx, month);

  const ref = firstDayOf(month);
  const prevRef = firstDayOf(addMonths(month, -1));

  const { rows } = await db.execute<Record<string, string>>(sql`
    select
      (select count(*) from transactions
        where user_id = ${ctx.userId} and competence_month = ${ref})::text as tx_count,

      -- Contas em conta/boleto ainda em aberto: e' o badge ambar do design.
      (select count(*) from scheduled_charges sc
         join recurring_rules rr on rr.id = sc.rule_id
        where sc.user_id = ${ctx.userId} and sc.ref_month = ${ref}
          and sc.status = 'pending' and rr.card_id is null)::text as open_bills,

      -- Assinaturas que ainda vao cair na fatura (due_date > hoje).
      (select count(*) from scheduled_charges sc
         join recurring_rules rr on rr.id = sc.rule_id
        where sc.user_id = ${ctx.userId} and sc.ref_month = ${ref}
          and sc.status = 'pending' and rr.card_id is not null
          and sc.due_date > ${ctx.today})::text as upcoming,

      (select count(*) from card_statements
        where user_id = ${ctx.userId} and ref_month = ${ref} and status <> 'paid')::text as open_statements,
      (select count(*) from card_statements
        where user_id = ${ctx.userId} and ref_month = ${ref})::text as statements,

      (select count(*) from categories
        where user_id = ${ctx.userId} and kind = 'expense' and archived_at is null)::text as categories,

      -- Patrimonio = caixa + carteira.
      (select coalesce(sum(opening_balance_cents), 0) from accounts
        where user_id = ${ctx.userId} and archived_at is null and include_in_cash_total)::text as cash,
      (select coalesce(sum(market_value_cents), 0) from investment_valuations
        where user_id = ${ctx.userId} and ref_month = ${ref})::text as portfolio,
      (select coalesce(sum(market_value_cents), 0) from investment_valuations
        where user_id = ${ctx.userId} and ref_month = ${prevRef})::text as portfolio_prev,

      -- Aportes do mes: precisam sair do rendimento, senao aporte vira "ganho".
      (select coalesce(sum(amount_cents), 0) from investment_flows
        where user_id = ${ctx.userId} and ref_month = ${ref} and kind = 'contribution')::text as contributions,
      (select coalesce(sum(amount_cents), 0) from investment_flows
        where user_id = ${ctx.userId} and ref_month = ${ref} and kind = 'withdrawal')::text as withdrawals
  `);

  const r = rows[0] ?? {};
  const n = (key: string) => Number(r[key] ?? 0);

  const portfolio = n("portfolio");
  const portfolioPrev = n("portfolio_prev");
  // Regra C1: variacao de valor menos o que entrou, mais o que saiu.
  const monthReturn =
    portfolioPrev > 0 ? portfolio - portfolioPrev - n("contributions") + n("withdrawals") : 0;

  return {
    transactionsCount: n("tx_count"),
    openBillsCount: n("open_bills"),
    upcomingChargesCount: n("upcoming"),
    openStatementsCount: n("open_statements"),
    statementsCount: n("statements"),
    categoriesCount: n("categories"),
    netWorthCents: cents(n("cash") + portfolio),
    monthReturnCents: cents(monthReturn),
    monthReturnPercent: portfolio > 0 ? (monthReturn / portfolio) * 100 : 0,
  };
});
