import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db/client";
import { cardStatements, creditCards, recurringRules, scheduledCharges } from "@/db/schema";
import { cycleOfRefMonth } from "@/domain/card-cycle";
import { isActiveIn, sequenceFor } from "@/domain/installments";
import { clampDay, firstDayOf, monthsBetween, type RefMonth, refMonth } from "@/domain/period";
import type { AppContext } from "./context";

/**
 * Materializacao de mes.
 *
 * Ao abrir um mes, cria as faturas de cada cartao e as ocorrencias das regras
 * ativas. Roda sob demanda, nao por cron: o plano Hobby da Vercel permite
 * apenas um job diario, entao nada pode depender dele para funcionar.
 *
 * Idempotencia em quatro camadas, de fora para dentro:
 *   1. `React.cache` — uma chamada por render, mesmo com varios componentes
 *      pedindo o mesmo mes;
 *   2. advisory lock transacional — dois renders simultaneos nao duplicam
 *      trabalho nem se enroscam no update final;
 *   3. `ON CONFLICT DO NOTHING` — reabrir o mes e' no-op;
 *   4. UNIQUE no banco — mesmo com codigo errado, duplicata e' impossivel.
 *
 * A quarta camada e' a que realmente importa: as tres primeiras sao otimizacao,
 * a ultima e' garantia.
 */

/** Chave estavel do lock. Um por (usuario, mes). */
function lockKey(userId: string, month: RefMonth): string {
  return `mat:${userId}:${month}`;
}

export interface MaterializeResult {
  statementsCreated: number;
  chargesCreated: number;
  skipped: boolean;
}

export const ensureMonthMaterialized = cache(
  async (ctx: AppContext, month: RefMonth): Promise<MaterializeResult> => {
    const empty: MaterializeResult = {
      statementsCreated: 0,
      chargesCreated: 0,
      skipped: true,
    };

    // Travas de navegacao: sem elas, segurar o botao de mes anterior
    // materializaria anos de faturas vazias.
    if (month < ctx.startRefMonth) return empty;
    if (monthsBetween(currentMonthOf(ctx), month) > ctx.maxFutureMonths) return empty;

    return db.transaction(async (tx) => {
      // Libera no commit. Precisa estar na MESMA transacao dos inserts.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey(ctx.userId, month)}))`);

      const statementsCreated = await buildStatementsFor(tx, ctx, month);
      const chargesCreated = await buildChargesFor(tx, ctx, month);
      await linkChargesToStatements(tx, ctx, month);

      return { statementsCreated, chargesCreated, skipped: false };
    });
  }
);

function currentMonthOf(ctx: AppContext): RefMonth {
  return refMonth(ctx.today.slice(0, 7));
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Cria a fatura de cada cartao ativo cujo vencimento cai neste mes. */
async function buildStatementsFor(tx: Tx, ctx: AppContext, month: RefMonth): Promise<number> {
  const cards = await tx
    .select()
    .from(creditCards)
    .where(and(eq(creditCards.userId, ctx.userId), isNull(creditCards.archivedAt)));

  if (cards.length === 0) return 0;

  const values = cards.map((card) => {
    const cycle = cycleOfRefMonth(
      {
        closingDay: card.closingDay,
        dueDay: card.dueDay,
        bestDayOverride: card.bestDayOverride,
      },
      month
    );
    return {
      userId: ctx.userId,
      cardId: card.id,
      refMonth: firstDayOf(month),
      periodStart: cycle.periodStart,
      periodEnd: cycle.periodEnd,
      dueDate: cycle.dueDate,
    };
  });

  const inserted = await tx
    .insert(cardStatements)
    .values(values)
    .onConflictDoNothing({ target: [cardStatements.cardId, cardStatements.refMonth] })
    .returning({ id: cardStatements.id });

  return inserted.length;
}

/** Cria a ocorrencia de cada regra viva neste mes. */
async function buildChargesFor(tx: Tx, ctx: AppContext, month: RefMonth): Promise<number> {
  const rules = await tx
    .select()
    .from(recurringRules)
    .where(and(eq(recurringRules.userId, ctx.userId), isNull(recurringRules.archivedAt)));

  const values = rules
    .filter((rule) =>
      isActiveIn(
        {
          firstRefMonth: refMonth(rule.firstRefMonth.slice(0, 7)),
          installmentsTotal: rule.installmentsTotal,
          endRefMonth: rule.endRefMonth ? refMonth(rule.endRefMonth.slice(0, 7)) : null,
          pausedAt: rule.pausedAt,
          archivedAt: rule.archivedAt,
        },
        month
      )
    )
    .map((rule) => {
      const first = refMonth(rule.firstRefMonth.slice(0, 7));
      return {
        userId: ctx.userId,
        ruleId: rule.id,
        refMonth: firstDayOf(month),
        // Derivada, nunca contada a partir do que ja' existe.
        sequence: rule.installmentsTotal != null ? sequenceFor(first, month) : null,
        dueDate: clampDay(month, rule.dueDay),
        amountCents: rule.isVariable ? (rule.estimatedCents ?? 0) : (rule.amountCents ?? 0),
      };
    });

  if (values.length === 0) return 0;

  const inserted = await tx
    .insert(scheduledCharges)
    .values(values)
    .onConflictDoNothing({ target: [scheduledCharges.ruleId, scheduledCharges.refMonth] })
    .returning({ id: scheduledCharges.id });

  return inserted.length;
}

/**
 * Liga cada cobranca de cartao a' fatura do ciclo em que ela cai.
 *
 * Feito em SQL, num update so', porque depende das duas insercoes anteriores —
 * e' exatamente por isso que a transacao precisa ser interativa.
 */
async function linkChargesToStatements(tx: Tx, ctx: AppContext, month: RefMonth): Promise<void> {
  await tx.execute(sql`
    update scheduled_charges sc
       set statement_id = st.id
      from recurring_rules rr
      join card_statements st
        on st.card_id = rr.card_id
       and st.user_id = rr.user_id
     where sc.rule_id = rr.id
       and sc.user_id = ${ctx.userId}
       and sc.ref_month = ${firstDayOf(month)}
       and rr.card_id is not null
       and sc.statement_id is distinct from st.id
       and sc.due_date between st.period_start and st.period_end
  `);
}
