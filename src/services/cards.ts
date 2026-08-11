import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { cardStatements, creditCards } from "@/db/schema";
import {
  bestPurchaseDay,
  closingLabel,
  cycleOfRefMonth,
  type StatementPhase,
  statementFigures,
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
 * Por decisao do usuario, aqui viram quatro numeros com semantica propria —
 * todos da MESMA fatura, a que vence no mes exibido:
 *   - a pagar agora  : o total dela, quando ja' fechou e nao foi paga
 *   - em formacao    : o que ja' caiu nela, enquanto o ciclo esta' aberto
 *   - previsto       : o que ainda vai cair ate' ela fechar
 *   - total          : formacao + previsto (o que esta fatura deve dar)
 *
 * "Da mesma fatura" e' a correcao central. Antes cada numero respondia por um
 * calendario diferente: `a pagar` olhava a fatura do mes, `formacao` e
 * `previsto` olhavam o ciclo aberto de HOJE (os mesmos valores em qualquer mes
 * que se navegasse), e as listas laterais olhavam o `ref_month` da cobranca,
 * ignorando a fatura em que ela cai. Num cartao que fecha dia 05, a assinatura
 * do dia 15 aparecia como "ainda vai cair" numa fatura fechada no dia 05.
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
  /** Tudo que esta fatura soma — e' o valor que o botao "Pagar fatura" propoe. */
  totalCents: Cents;
  /** Gasto e ainda nao pago, em qualquer fatura aberta. Nao depende do mes. */
  usedCents: Cents;
  availableCents: Cents;
  usagePercent: number;
  overUsed: boolean;

  closingDay: number;
  dueDay: number;
  bestDay: number;
  periodStart: PlainDate;
  /** Ultimo dia coberto — a vespera do fechamento, nao o dia dele. */
  periodEnd: PlainDate;
  closingOn: PlainDate;
  dueOn: PlainDate;
  closingLabel: string;
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

  /*
   * Uma query por cartao seria N+1; aqui tudo vem de uma vez e agrupa em
   * memoria.
   *
   * `item` unifica as duas coisas que compoem uma fatura — compras avulsas e
   * cobrancas de regra — numa lista so' de (fatura, data, valor). Sem isso cada
   * numero precisaria de duas somas paralelas, e foi assim que "em formacao"
   * acabou contando apenas as compras: a assinatura que ja' tinha caido no
   * ciclo nao entrava em soma nenhuma e sumia da tela.
   *
   * O pagamento da propria fatura fica de fora: `payStatement` grava um
   * `transfer` COM `statement_id`, que somado de volta dobraria o valor da
   * fatura depois de paga.
   */
  const agg = await db.execute<{
    card_id: string;
    posted: string;
    future: string;
    used: string;
  }>(sql`
    with item as (
      select t.statement_id,
             t.occurred_on as on_date,
             case when t.is_refund then -t.amount_cents else t.amount_cents end as cents
        from transactions t
       where t.user_id = ${ctx.userId}
         and t.statement_id is not null
         and t.source <> 'card_payment'
      union all
      select sc.statement_id, sc.due_date as on_date, sc.amount_cents as cents
        from scheduled_charges sc
       where sc.user_id = ${ctx.userId}
         and sc.statement_id is not null
         and sc.status <> 'skipped'
         -- So' a cobranca que AINDA nao caiu. A que caiu virou lancamento
         -- (db/materialize.postDueCharges) e ja' esta' contada acima; somar as
         -- duas pontas cobraria a assinatura em dobro na fatura.
         and sc.transaction_id is null
    )
    select c.id as card_id,
           coalesce(sum(i.cents) filter (
             where s.ref_month = ${ref} and i.on_date <= ${ctx.today}), 0)::text as posted,
           coalesce(sum(i.cents) filter (
             where s.ref_month = ${ref} and i.on_date > ${ctx.today}), 0)::text as future,
           -- Limite comprometido: o que ja' foi gasto e a fatura ainda nao
           -- quitou. E' propriedade do cartao HOJE, nao do mes na tela — o
           -- disponivel nao pode mudar porque o usuario navegou para outro mes.
           coalesce(sum(i.cents) filter (
             where s.status <> 'paid' and i.on_date <= ${ctx.today}), 0)::text as used
      from credit_cards c
      left join card_statements s on s.card_id = c.id and s.user_id = ${ctx.userId}
      left join item i on i.statement_id = s.id
     where c.user_id = ${ctx.userId}
     group by c.id
  `);

  const aggByCard = new Map(agg.rows.map((r) => [r.card_id, r]));

  /*
   * As duas listas laterais seguem a FATURA, nunca o `ref_month` da cobranca.
   *
   * Sao eixos diferentes: `sc.ref_month` e' o mes em que a assinatura e'
   * cobrada no cartao, e `st.ref_month` e' o mes em que a fatura vence. Num
   * cartao que fecha dia 05 eles so' coincidem para cobranca dos dias 1 a 5;
   * do dia 6 em diante a cobranca de agosto pertence a' fatura de setembro.
   */
  const inst = await db.execute<{
    card_id: string;
    id: string;
    name: string;
    sequence: number;
    total: number;
    amount_cents: string;
  }>(sql`
    select st.card_id, sc.id, rr.name, sc.sequence, rr.installments_total as total,
           sc.amount_cents::text
      from scheduled_charges sc
      join recurring_rules rr on rr.id = sc.rule_id
      join card_statements st on st.id = sc.statement_id
     where sc.user_id = ${ctx.userId} and st.ref_month = ${ref}
       and sc.status <> 'skipped' and rr.installments_total is not null
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
    select st.card_id, sc.id, rr.name, to_char(sc.due_date,'YYYY-MM-DD') as due_date,
           sc.amount_cents::text, cat.color
      from scheduled_charges sc
      join recurring_rules rr on rr.id = sc.rule_id
      join categories cat on cat.id = rr.category_id
      join card_statements st on st.id = sc.statement_id
     where sc.user_id = ${ctx.userId} and st.ref_month = ${ref}
       and sc.status <> 'skipped' and sc.due_date > ${ctx.today}
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

    const phase = statementPhase(cycle, ctx.today, paid);
    const figures = statementFigures(
      { postedCents: Number(a?.posted ?? 0), futureCents: Number(a?.future ?? 0) },
      phase
    );
    const used = Number(a?.used ?? 0);

    const cardInst = inst.rows
      .filter((r) => r.card_id === card.id)
      .map((r) => ({
        id: r.id,
        description: r.name,
        sequence: r.sequence,
        total: r.total,
        amountCents: cents(Number(r.amount_cents)),
      }));

    return {
      id: card.id,
      name: card.name,
      brand: card.brand,
      lastFour: card.lastFour,
      color: card.color,
      limitCents: cents(card.limitCents),

      toPayCents: cents(figures.toPayCents),
      formingCents: cents(figures.formingCents),
      forecastCents: cents(figures.forecastCents),
      totalCents: cents(figures.totalCents),
      usedCents: cents(Math.max(0, used)),
      availableCents: cents(Math.max(0, card.limitCents - used)),
      usagePercent: card.limitCents > 0 ? (used / card.limitCents) * 100 : 0,
      overUsed: card.limitCents > 0 && used / card.limitCents > 0.7,

      closingDay: card.closingDay,
      dueDay: card.dueDay,
      bestDay: bestPurchaseDay(config),
      periodStart: cycle.periodStart,
      periodEnd: cycle.periodEnd,
      closingOn: cycle.closingDate,
      dueOn: cycle.dueDate,
      closingLabel: closingLabel(cycle, ctx.today),
      phase,
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

  // "Em aberto" e' a fatura que fechou, tem valor e ninguem pagou. Contar
  // tambem as que ainda estao acumulando faria o aviso do topo anunciar faturas
  // a pagar que nao vencem neste mes — e somar R$ 0,00 delas.
  const open = views.filter((c) => c.phase === "fechada" && c.toPayCents > 0);
  return {
    cards: views,
    openCount: open.length,
    openTotalCents: cents(open.reduce<number>((acc, c) => acc + c.toPayCents, 0)),
  };
}
