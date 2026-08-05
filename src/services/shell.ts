import "server-only";
import { sql } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db/client";
import type { Cents } from "@/domain/money";
import { firstDayOf, type RefMonth } from "@/domain/period";
import { getCashView } from "./cash";
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
  /** Dinheiro disponivel. Hoje = saldo de abertura; vira derivado na fase 2. */
  cashCents: Cents;
}

export const getShellData = cache(async (ctx: AppContext, month: RefMonth): Promise<ShellData> => {
  await ensureMonthMaterialized(ctx, month);

  const ref = firstDayOf(month);

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
        where user_id = ${ctx.userId} and kind = 'expense')::text as categories
  `);

  const r = rows[0] ?? {};
  const n = (key: string) => Number(r[key] ?? 0);

  // O MESMO numero do cartao "Em conta" da visao geral. Nao ha' segunda conta
  // aqui de proposito: enquanto a barra somava so' o saldo de abertura, a mesma
  // tela mostrava dois valores com o mesmo rotulo. `getCashView` e' `cache()`,
  // entao layout e pagina compartilham a leitura no mesmo request.
  const caixa = await getCashView(ctx, month);

  return {
    transactionsCount: n("tx_count"),
    openBillsCount: n("open_bills"),
    upcomingChargesCount: n("upcoming"),
    openStatementsCount: n("open_statements"),
    statementsCount: n("statements"),
    categoriesCount: n("categories"),
    cashCents: caixa.cashCents,
  };
});
