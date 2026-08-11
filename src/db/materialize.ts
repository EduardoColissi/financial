import { and, eq, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { cycleFor, cycleOfRefMonth } from "@/domain/card-cycle";
import { isActiveIn, sequenceFor } from "@/domain/installments";
import {
  clampDay,
  firstDayOf,
  type PlainDate,
  plainDate,
  type RefMonth,
  refMonth,
} from "@/domain/period";
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
  /**
   * Hoje, no fuso do usuario. E' o que separa a cobranca que JA' caiu na fatura
   * da que ainda vai cair — e so' a que caiu vira lancamento.
   */
  today: PlainDate;
}

export interface MaterializeResult {
  statementsCreated: number;
  chargesCreated: number;
  entriesPosted: number;
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
    const entriesPosted = await postDueCharges(tx as Database, target);

    return { statementsCreated, chargesCreated, entriesPosted };
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
  // Só o dono: religar cobranca a fatura nao depende de que dia e' hoje, e o
  // script de reparo chama isto sem ter um relogio por perto.
  target: Pick<MaterializeTarget, "userId">
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

/**
 * Transforma em LANCAMENTO a cobranca de cartao que ja' caiu.
 *
 * Sem isto a assinatura e a parcela no cartao viviam so' em `scheduled_charges`:
 * entravam no total da fatura e sumiam de todo o resto. Nao contavam para a
 * categoria, nao apareciam na lista de lancamentos e nao somavam na despesa do
 * mes — nem quando a fatura era paga, porque o pagamento e' um `transfer` sem
 * categoria. Uma Netflix lancada em setembro simplesmente nao existia para o
 * orcamento, em mes nenhum.
 *
 * A compra avulsa no credito sempre gravou lancamento (ver
 * `services/entries.createSingleTransaction`); a cobranca de regra passa a
 * gravar o mesmo, pelo mesmo motivo e com os mesmos campos. A cobranca segue
 * sendo a AGENDA — quando ela cai, quanto vai ser, de que regra veio —, e o
 * lancamento passa a ser o dinheiro.
 *
 * Nasce quando a cobranca cai (`due_date <= hoje`), nao quando ela e' gerada: o
 * que ainda vai ser cobrado e' previsao, e previsao inflaria o gasto do mes.
 *
 * Competencia e' o mes da FATURA, nao o da cobranca — a mesma regra da compra no
 * credito. A WellHub cobrada em 06/08 num cartao que fecha dia 05 so' e' paga em
 * 12/09: cobrar de agosto tirava o valor de um mes em que nada saiu do caixa, e
 * o mes do pagamento nao via o gasto. Por isso `st.ref_month`, e nao
 * `sc.ref_month` — a cobranca continua indexada pelo mes em que cai, o dinheiro
 * pesa no mes em que sai.
 *
 * Varre TODOS os meses, nao so' o recem-materializado, pelo motivo de
 * `linkChargesToStatements`: e' o que resgata a cobranca que caiu num mes que
 * ninguem abriu.
 *
 * Idempotencia: `external_id = 'charge:<id>'` sob o UNIQUE `tx_external_uq`.
 * Duas materializacoes simultaneas de meses diferentes competem pela mesma
 * cobranca; o indice — nao o `where` — e' o que garante um lancamento so'.
 */
export async function postDueCharges(db: Database, target: MaterializeTarget): Promise<number> {
  /*
   * Uma instrucao so': o `returning` do insert alimenta o vinculo.
   *
   * Em duas, o lancamento poderia existir com a cobranca ainda apontando para o
   * nada — e a passagem seguinte, vendo `transaction_id is null`, tentaria criar
   * tudo de novo. E' a mesma cobranca contada duas vezes na fatura, que e'
   * exatamente o defeito que este codigo existe para evitar.
   */
  const ligadas = await db.execute<{ id: string }>(sql`
    with novo as (
      insert into transactions (
        user_id, kind, occurred_on, competence_month, description, amount_cents,
        category_id, method, card_id, statement_id,
        installment_seq, installment_total, source, external_id
      )
      select sc.user_id,
             'expense',
             sc.due_date,
             st.ref_month,
             rr.name,
             sc.amount_cents,
             rr.category_id,
             -- tx_card_method_ck casa cartao com o meio "credito"; a regra pode
             -- ter sido cadastrada com outro meio, e o banco recusaria a linha.
             'credit',
             rr.card_id,
             sc.statement_id,
             -- Os dois juntos ou nenhum, e a sequencia dentro do total: e' o que
             -- tx_installment_ck exige. Dado torto vira lancamento sem rotulo de
             -- parcela em vez de derrubar a materializacao inteira.
             case when sc.sequence between 1 and rr.installments_total
                  then sc.sequence end,
             case when sc.sequence between 1 and rr.installments_total
                  then rr.installments_total end,
             'recurring',
             'charge:' || sc.id
        from scheduled_charges sc
        join recurring_rules rr on rr.id = sc.rule_id
        join card_statements st on st.id = sc.statement_id
       where sc.user_id = ${target.userId}
         and rr.card_id is not null
         and sc.statement_id is not null
         and sc.transaction_id is null
         and sc.status <> 'skipped'
         and sc.due_date <= ${target.today}
         -- tx_amount_ck exige valor positivo. Cobranca variavel sem estimativa
         -- nasce zerada e continua so' na agenda ate' alguem digitar o valor.
         and sc.amount_cents > 0
      on conflict do nothing
      returning id, external_id
    )
    update scheduled_charges sc
       set transaction_id = novo.id
      from novo
     where novo.external_id = 'charge:' || sc.id
       and sc.user_id = ${target.userId}
    returning sc.id
  `);

  return ligadas.rows.length;
}
