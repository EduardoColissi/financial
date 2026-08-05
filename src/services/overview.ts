import "server-only";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { recurringRules, scheduledCharges } from "@/db/schema";
import { type Cents, cents } from "@/domain/money";
import {
  addDays,
  addMonths,
  firstDayOf,
  monthShortLabel,
  type PlainDate,
  plainDate,
  type RefMonth,
  refMonth,
} from "@/domain/period";
import type { AppContext } from "./context";
import { ensureMonthMaterialized } from "./materialize";
import { getCategories, getTransactions } from "./queries";

/**
 * Agregados da visao geral.
 *
 * Reusa `getTransactions` e `getCategories` em vez de reimplementar as somas —
 * duas verdades sobre o mesmo numero e' exatamente o que faz o painel divergir
 * das abas de origem.
 */

export interface MonthPoint {
  key: string;
  label: string;
  incomeCents: Cents;
  expenseCents: Cents;
  contributionCents: Cents;
  balanceCents: Cents;
}

export interface DueRow {
  id: string;
  name: string;
  dueDate: PlainDate;
  amountCents: Cents;
  categoryName: string;
  fixed: boolean;
}

export interface OverviewData {
  incomeCents: Cents;
  expenseCents: Cents;
  contributionCents: Cents;
  freeCents: Cents;
  categoryCount: number;
  flow: MonthPoint[];
  due7: DueRow[];
  due7TotalCents: Cents;
  /**
   * Quando o ultimo LANCAMENTO foi registrado — nao cadastro.
   *
   * Serve para saber se o painel esta' em dia. Cadastrar um cartao nao e' o
   * mesmo que lancar um gasto: contar cadastro aqui daria a sensacao de estar
   * em dia justamente em quem so' mexeu na configuracao.
   */
  lastEntryAt: Date | null;
}

export async function getOverview(ctx: AppContext, month: RefMonth): Promise<OverviewData> {
  await ensureMonthMaterialized(ctx, month);
  const ref = firstDayOf(month);

  const [tx, cat] = await Promise.all([getTransactions(ctx, month), getCategories(ctx, month)]);

  const income = tx.rows
    .filter((t) => t.kind === "income")
    .reduce<number>((a, t) => a + t.amountCents, 0);
  const contribution = tx.rows
    .filter((t) => t.kind === "investment_out")
    .reduce<number>((a, t) => a + t.amountCents, 0);
  const expense = cat.totalCents;

  // ── fluxo de 6 meses ──────────────────────────────────────────────────────
  // Meses historicos vem do snapshot congelado; o mes corrente e' calculado.
  const from = firstDayOf(addMonths(month, -5));
  const snaps = await db.execute<{
    ref_month: string;
    income_cents: string;
    expense_cents: string;
    contribution_cents: string;
  }>(sql`
    select to_char(ref_month, 'YYYY-MM-DD') as ref_month,
           income_cents::text, expense_cents::text, contribution_cents::text
      from monthly_cashflow_snapshots
     where user_id = ${ctx.userId} and ref_month between ${from} and ${ref}
     order by ref_month
  `);

  const snapByMonth = new Map(snaps.rows.map((r) => [r.ref_month.slice(0, 7), r]));
  const flow: MonthPoint[] = [];
  for (let i = -5; i <= 0; i++) {
    const m = addMonths(month, i);
    const snap = snapByMonth.get(m);
    const inc = i === 0 ? income : Number(snap?.income_cents ?? 0);
    const exp = i === 0 ? expense : Number(snap?.expense_cents ?? 0);
    const con = i === 0 ? contribution : Number(snap?.contribution_cents ?? 0);
    flow.push({
      key: m,
      label: monthShortLabel(m),
      incomeCents: cents(inc),
      expenseCents: cents(exp),
      contributionCents: cents(con),
      balanceCents: cents(inc - exp - con),
    });
  }

  // ── vence em 7 dias ───────────────────────────────────────────────────────
  const horizon = addDays(ctx.today, 7);
  const dueRows = await db
    .select({
      id: scheduledCharges.id,
      dueDate: scheduledCharges.dueDate,
      amountCents: scheduledCharges.amountCents,
      name: recurringRules.name,
      isVariable: recurringRules.isVariable,
      categoryId: recurringRules.categoryId,
    })
    .from(scheduledCharges)
    .innerJoin(recurringRules, eq(recurringRules.id, scheduledCharges.ruleId))
    .where(
      and(
        eq(scheduledCharges.userId, ctx.userId),
        eq(scheduledCharges.status, "pending"),
        gte(scheduledCharges.dueDate, ctx.today),
        lte(scheduledCharges.dueDate, horizon)
      )
    )
    .orderBy(asc(scheduledCharges.dueDate));

  const catById = new Map(cat.categories.map((c) => [c.id, c.name]));
  const due7: DueRow[] = dueRows.map((r) => ({
    id: r.id,
    name: r.name,
    dueDate: plainDate(r.dueDate),
    amountCents: cents(r.amountCents),
    categoryName: catById.get(r.categoryId) ?? "—",
    fixed: !r.isVariable,
  }));

  // Ultimo lancamento: olha TODOS os meses, nao so' o aberto. Perguntar "quando
  // lancei pela ultima vez" e receber "nunca" so' porque o mes visitado esta'
  // vazio seria resposta errada.
  const ultimo = await db.execute<{ at: string | null }>(sql`
    select max(created_at)::text as at from transactions where user_id = ${ctx.userId}
  `);
  const lastEntryAt = ultimo.rows[0]?.at ? new Date(ultimo.rows[0].at) : null;

  // A carteira saiu junto com a aba de investimentos. `freeCents` continua
  // sendo receita − despesa − aporte; a conta de "sobra" que o dono descreveu
  // (em conta − pendente) entra na fase do motor.
  return {
    lastEntryAt,
    incomeCents: cents(income),
    expenseCents: expense,
    contributionCents: cents(contribution),
    freeCents: cents(income - expense - contribution),
    categoryCount: cat.categories.length,
    flow,
    due7,
    due7TotalCents: cents(due7.reduce<number>((a, d) => a + d.amountCents, 0)),
  };
}

export { getCategories, refMonth };
