import { and, eq, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { cycleFor, cycleOfRefMonth } from "@/domain/card-cycle";
import { isActiveIn, sequenceFor } from "@/domain/installments";
import { clampDay, firstDayOf, plainDate, type RefMonth, refMonth } from "@/domain/period";
import type * as schema from "./schema";
import { cardStatements, creditCards, recurringRules, scheduledCharges } from "./schema";

/**
 * Materializacao de mes.
 *
 * Ao abrir um mes, cria as faturas de cada cartao e as ocorrencias das regras
 * ativas. Roda sob demanda, nao por cron: o plano Hobby da Vercel permite
 * apenas um job diario, entao nada pode depender dele para funcionar.
 *
 * Idempotencia em tres camadas, de fora para dentro:
 *   1. advisory lock transacional — dois renders simultaneos nao duplicam
 *      trabalho nem se enroscam no update final;
 *   2. `ON CONFLICT DO NOTHING` — reabrir o mes e' no-op;
 *   3. UNIQUE no banco — mesmo com codigo errado, duplicata e' impossivel.
 *
 * A terceira e' a que realmente importa: as duas primeiras sao otimizacao, a
 * ultima e' garantia.
 *
 * Recebe a conexao por parametro em vez de importar o cliente: assim o seed e
 * os testes de integracao usam exatamente o mesmo codigo que a aplicacao. Sem
 * isso seria preciso reimplementar a geracao no seed — duas verdades sobre a
 * mesma regra.
 */

export type Database = NodePgDatabase<typeof schema>;

export interface MaterializeTarget {
  userId: string;
}

export interface MaterializeResult {
  statementsCreated: number;
  chargesCreated: number;
}

function lockKey(userId: string, month: RefMonth): string {
  return `mat:${userId}:${month}`;
}

export async function materializeMonth(
  db: Database,
  target: MaterializeTarget,
  month: RefMonth
): Promise<MaterializeResult> {
  return db.transaction(async (tx) => {
    // Libera no commit. Precisa estar na MESMA transacao dos inserts.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey(target.userId, month)}))`);

    const statementsCreated = await buildStatements(tx as Database, target, month);
    const chargesCreated = await buildCharges(tx as Database, target, month);
    await linkChargesToStatements(tx as Database, target);

    return { statementsCreated, chargesCreated };
  });
}

/** Cria a fatura de cada cartao ativo cujo vencimento cai neste mes. */
async function buildStatements(
  db: Database,
  target: MaterializeTarget,
  month: RefMonth
): Promise<number> {
  const cards = await db.select().from(creditCards).where(eq(creditCards.userId, target.userId));

  if (cards.length === 0) return 0;

  const values = cards.map((card) => {
    const cycle = cycleOfRefMonth(
      { closingDay: card.closingDay, dueDay: card.dueDay, bestDayOverride: card.bestDayOverride },
      month
    );
    return {
      userId: target.userId,
      cardId: card.id,
      refMonth: firstDayOf(month),
      periodStart: cycle.periodStart,
      periodEnd: cycle.periodEnd,
      dueDate: cycle.dueDate,
    };
  });

  const inserted = await db
    .insert(cardStatements)
    .values(values)
    .onConflictDoNothing({ target: [cardStatements.cardId, cardStatements.refMonth] })
    .returning({ id: cardStatements.id });

  return inserted.length;
}

/** Cria a ocorrencia de cada regra viva neste mes. */
async function buildCharges(
  db: Database,
  target: MaterializeTarget,
  month: RefMonth
): Promise<number> {
  const rules = await db
    .select()
    .from(recurringRules)
    .where(and(eq(recurringRules.userId, target.userId), isNull(recurringRules.archivedAt)));

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
        userId: target.userId,
        ruleId: rule.id,
        refMonth: firstDayOf(month),
        // Derivada de firstRefMonth, nunca contada a partir do que ja' existe:
        // gerar novembro sem ter gerado outubro produz o numero certo.
        sequence: rule.installmentsTotal != null ? sequenceFor(first, month) : null,
        dueDate: clampDay(month, rule.dueDay),
        amountCents: rule.isVariable ? (rule.estimatedCents ?? 0) : (rule.amountCents ?? 0),
      };
    });

  if (values.length === 0) return 0;

  const inserted = await db
    .insert(scheduledCharges)
    .values(values)
    .onConflictDoNothing({ target: [scheduledCharges.ruleId, scheduledCharges.refMonth] })
    .returning({ id: scheduledCharges.id });

  return inserted.length;
}

/**
 * Liga cada cobranca de cartao a' fatura do ciclo em que ela cai.
 *
 * Duas coisas acontecem aqui, nesta ordem, e nenhuma pode faltar:
 *
 *  1. a fatura do ciclo precisa EXISTIR. Uma assinatura cobrada depois do
 *     fechamento cai na fatura do mes SEGUINTE — num cartao que fecha dia 05,
 *     qualquer cobranca do dia 06 em diante. Essa fatura so' era criada quando
 *     alguem abria aquele mes na tela, entao o vinculo por data nao achava nada
 *     e a cobranca nascia orfa. Como cada materializacao olhava apenas as
 *     cobrancas do proprio mes, ninguem voltava para resgata-la: ela sumia do
 *     total da fatura para sempre, e a fatura era paga a menos;
 *  2. o vinculo em si, por data.
 *
 * O passo 1 usa `cycleFor`, o MESMO caminho das compras avulsas em
 * `services/entries.statementIdFor`. Assinatura e compra passam a cair na
 * fatura pela mesma regra, em vez de por dois codigos que podiam divergir.
 *
 * Varre as orfas de QUALQUER mes, nao so' as do mes recem-gerado: e' o que cura
 * as que ficaram para tras. Uma cobranca ja' ligada nunca e' remexida — o
 * vinculo e' congelado, como o das compras.
 */
export async function linkChargesToStatements(
  db: Database,
  target: MaterializeTarget
): Promise<void> {
  const orphans = await db
    .select({
      cardId: creditCards.id,
      dueDate: scheduledCharges.dueDate,
      closingDay: creditCards.closingDay,
      dueDay: creditCards.dueDay,
      bestDayOverride: creditCards.bestDayOverride,
    })
    .from(scheduledCharges)
    .innerJoin(recurringRules, eq(recurringRules.id, scheduledCharges.ruleId))
    .innerJoin(creditCards, eq(creditCards.id, recurringRules.cardId))
    .where(and(eq(scheduledCharges.userId, target.userId), isNull(scheduledCharges.statementId)));

  if (orphans.length === 0) return;

  // Uma fatura por (cartao, mes de vencimento) — varias cobrancas do mesmo
  // ciclo pedem a MESMA fatura, e `values()` com duplicata interna passaria por
  // cima do `ON CONFLICT`, que so' enxerga o que ja' esta' gravado.
  const wanted = new Map<string, typeof cardStatements.$inferInsert>();
  for (const charge of orphans) {
    const cycle = cycleFor(
      {
        closingDay: charge.closingDay,
        dueDay: charge.dueDay,
        bestDayOverride: charge.bestDayOverride,
      },
      plainDate(charge.dueDate)
    );
    wanted.set(`${charge.cardId}:${cycle.refMonth}`, {
      userId: target.userId,
      cardId: charge.cardId,
      refMonth: firstDayOf(cycle.refMonth),
      periodStart: cycle.periodStart,
      periodEnd: cycle.periodEnd,
      dueDate: cycle.dueDate,
    });
  }

  await db
    .insert(cardStatements)
    .values([...wanted.values()])
    .onConflictDoNothing({ target: [cardStatements.cardId, cardStatements.refMonth] });

  await db.execute(sql`
    update scheduled_charges sc
       set statement_id = st.id
      from recurring_rules rr
      join card_statements st
        on st.card_id = rr.card_id
       and st.user_id = rr.user_id
     where sc.rule_id = rr.id
       and sc.user_id = ${target.userId}
       and sc.statement_id is null
       and rr.card_id is not null
       and sc.due_date between st.period_start and st.period_end
  `);
}
