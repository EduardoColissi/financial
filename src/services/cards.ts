import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { cardStatements, creditCards } from "@/db/schema";
import {
  bestPurchaseDay,
  cycleOfRefMonth,
  daysToCloseLabel,
  type StatementPhase,
  statementPhase,
} from "@/domain/card-cycle";
import { type Cents, cents } from "@/domain/money";
import { firstDayOf, type PlainDate, plainDate, type RefMonth } from "@/domain/period";
import type { AppContext } from "./context";
import { ensureMonthMaterialized } from "./materialize";

/**
 * Cartoes de credito.
 *
 * A "fatura estimada" do design soma a fatura FECHADA de um ciclo com as
 * previsoes do ciclo SEGUINTE (`est = fechado + prev`, linha 1315). Sao numeros
 * de periodos diferentes; somados nao significam nada.
 *
 * Por decisao do usuario, aqui viram quatro numeros com semantica propria:
 *   - a pagar agora  : a fatura que fechou e vence neste mes
 *   - em formacao    : o que ja' caiu no ciclo aberto
 *   - previsto       : o que ainda vai cair ate' o fechamento
 *   - estimada       : formacao + previsto (o que a proxima fatura deve dar)
 */

export interface InstallmentRow {
  id: string;
  description: string;
  sequence: number;
  total: number;
  amountCents: Cents;
}

export interface UpcomingRow {
  id: string;
  name: string;
  dueDate: PlainDate;
  amountCents: Cents;
  color: string;
}

export interface CardView {
  id: string;
  name: string;
  brand: string;
  lastFour: string | null;
  color: string;
  limitCents: Cents;

  toPayCents: Cents;
  formingCents: Cents;
  forecastCents: Cents;
  estimatedCents: Cents;
  availableCents: Cents;
  usagePercent: number;
  overUsed: boolean;

  closingDay: number;
  dueDay: number;
  bestDay: number;
  closingOn: PlainDate;
  dueOn: PlainDate;
  daysToCloseLabel: string;
  phase: StatementPhase;
  paid: boolean;
  statementId: string | null;

  installments: InstallmentRow[];
  installmentMonthlyCents: Cents;
  installmentRemainingCents: Cents;
  upcoming: UpcomingRow[];
}

export interface CardsResult {
  cards: CardView[];
  openCount: number;
  openTotalCents: Cents;
}

export async function getCards(ctx: AppContext, month: RefMonth): Promise<CardsResult> {
  await ensureMonthMaterialized(ctx, month);
  const ref = firstDayOf(month);

  const cards = await db
    .select()
    .from(creditCards)
    .where(eq(creditCards.userId, ctx.userId))
    .orderBy(asc(creditCards.sortOrder));

  const statements = await db
    .select()
    .from(cardStatements)
    .where(and(eq(cardStatements.userId, ctx.userId), eq(cardStatements.refMonth, ref)));

  const stByCard = new Map(statements.map((st) => [st.cardId, st]));

  // Uma query por cartao seria N+1; aqui tudo vem de uma vez e agrupa em memoria.
  const agg = await db.execute<{
    card_id: string;
    to_pay: string;
    forming: string;
    forecast: string;
  }>(sql`
    with st as (
      select id, card_id, period_start, period_end
        from card_statements
       where user_id = ${ctx.userId} and ref_month = ${ref}
    ),
    nextst as (
      -- O ciclo que ainda esta' aberto: o que fecha depois de hoje.
      select distinct on (card_id) id, card_id, period_start, period_end
        from card_statements
       where user_id = ${ctx.userId} and period_end >= ${ctx.today}
       order by card_id, period_end asc
    )
    select c.id as card_id,
           coalesce((select sum(t.amount_cents) from transactions t
                      where t.user_id = ${ctx.userId}
                        and t.statement_id = (select id from st where st.card_id = c.id)), 0)::text as to_pay,
           coalesce((select sum(t.amount_cents) from transactions t
                      join nextst n on n.id = t.statement_id
                     where t.user_id = ${ctx.userId} and n.card_id = c.id
                       and t.occurred_on <= ${ctx.today}), 0)::text as forming,
           coalesce((select sum(sc.amount_cents) from scheduled_charges sc
                      join nextst n on n.id = sc.statement_id
                     where sc.user_id = ${ctx.userId} and n.card_id = c.id
                       and sc.due_date > ${ctx.today}), 0)::text as forecast
      from credit_cards c
     where c.user_id = ${ctx.userId}
  `);

  const aggByCard = new Map(agg.rows.map((r) => [r.card_id, r]));

  // Parcelamentos em curso e recorrentes ainda por cair, por cartao.
  const inst = await db.execute<{
    card_id: string;
    id: string;
    name: string;
    sequence: number;
    total: number;
    amount_cents: string;
  }>(sql`
    select rr.card_id, sc.id, rr.name, sc.sequence, rr.installments_total as total,
           sc.amount_cents::text
      from scheduled_charges sc
      join recurring_rules rr on rr.id = sc.rule_id
     where sc.user_id = ${ctx.userId} and sc.ref_month = ${ref}
       and rr.card_id is not null and rr.installments_total is not null
     order by rr.name
  `);

  const upcoming = await db.execute<{
    card_id: string;
    id: string;
    name: string;
    due_date: string;
    amount_cents: string;
    color: string;
  }>(sql`
    select rr.card_id, sc.id, rr.name, to_char(sc.due_date,'YYYY-MM-DD') as due_date,
           sc.amount_cents::text, cat.color
      from scheduled_charges sc
      join recurring_rules rr on rr.id = sc.rule_id
      join categories cat on cat.id = rr.category_id
     where sc.user_id = ${ctx.userId} and sc.ref_month = ${ref}
       and rr.card_id is not null and sc.due_date > ${ctx.today}
     order by sc.due_date
  `);

  const views: CardView[] = cards.map((card) => {
    const config = {
      closingDay: card.closingDay,
      dueDay: card.dueDay,
      bestDayOverride: card.bestDayOverride,
    };
    const cycle = cycleOfRefMonth(config, month);
    const st = stByCard.get(card.id);
    const a = aggByCard.get(card.id);
    const paid = st?.status === "paid";

    const toPay = Number(a?.to_pay ?? 0);
    const forming = Number(a?.forming ?? 0);
    const forecast = Number(a?.forecast ?? 0);
    const estimated = forming + forecast;

    const cardInst = inst.rows
      .filter((r) => r.card_id === card.id)
      .map((r) => ({
        id: r.id,
        description: r.name,
        sequence: r.sequence,
        total: r.total,
        amountCents: cents(Number(r.amount_cents)),
      }));

    // Comprometido do limite = o que precisa pagar + o que ja' esta' rodando.
    const committed = toPay + estimated;

    return {
      id: card.id,
      name: card.name,
      brand: card.brand,
      lastFour: card.lastFour,
      color: card.color,
      limitCents: cents(card.limitCents),

      toPayCents: cents(toPay),
      formingCents: cents(forming),
      forecastCents: cents(forecast),
      estimatedCents: cents(estimated),
      availableCents: cents(Math.max(0, card.limitCents - committed)),
      usagePercent: card.limitCents > 0 ? (committed / card.limitCents) * 100 : 0,
      overUsed: card.limitCents > 0 && committed / card.limitCents > 0.7,

      closingDay: card.closingDay,
      dueDay: card.dueDay,
      bestDay: bestPurchaseDay(config),
      closingOn: cycle.periodEnd,
      dueOn: cycle.dueDate,
      daysToCloseLabel: daysToCloseLabel(config, ctx.today),
      phase: statementPhase(cycle, ctx.today, paid),
      paid,
      statementId: st?.id ?? null,

      installments: cardInst,
      installmentMonthlyCents: cents(cardInst.reduce<number>((acc, i) => acc + i.amountCents, 0)),
      // "a vencer": exclui a parcela corrente (formula da aba Cartoes do design).
      installmentRemainingCents: cents(
        cardInst.reduce<number>((acc, i) => acc + i.amountCents * (i.total - i.sequence), 0)
      ),
      upcoming: upcoming.rows
        .filter((r) => r.card_id === card.id)
        .map((r) => ({
          id: r.id,
          name: r.name,
          dueDate: plainDate(r.due_date),
          amountCents: cents(Number(r.amount_cents)),
          color: r.color,
        })),
    };
  });

  const open = views.filter((c) => !c.paid);
  return {
    cards: views,
    openCount: open.length,
    openTotalCents: cents(open.reduce<number>((acc, c) => acc + c.toPayCents, 0)),
  };
}
