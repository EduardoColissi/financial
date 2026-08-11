import "server-only";
import { sql } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db/client";
import {
  emergencyTarget,
  essentialAverage,
  type MonthCash,
  type MonthFlow,
  runMonths,
} from "@/domain/cash";
import { type Cents, cents } from "@/domain/money";
import { addMonths, firstDayOf, monthsBetween, type RefMonth, refMonth } from "@/domain/period";
import type { AppContext } from "./context";
import { ensureMonthMaterialized } from "./materialize";

/**
 * Os dois numeros do topo: EM CONTA e SOBRA, no modelo de envelope mensal.
 *
 * Casca fina. A regra — o que entra, o que sai, o que atravessa o mes — mora em
 * `domain/cash`, puro e testado. Aqui so' se montam os fluxos de cada mes e se
 * roda a corrente.
 *
 * A corrente e' necessaria porque a sobra e' DERIVADA, nunca gravada: para
 * saber com quanto setembro abre e' preciso fechar agosto, e para fechar agosto
 * e' preciso o que veio de julho. Guardar o fechamento seria mais rapido e
 * abriria a porta para o numero divergir dos lancamentos.
 */

/** Ate' onde a corrente volta. Alem disso o custo nao paga o ganho. */
const MAX_MESES = 24;

type LinhaMes = Record<string, string>;

/**
 * Tudo por COMPETENCIA, num unico SELECT por mes.
 *
 * Pagar em setembro a conta de agosto conta em AGOSTO — e' por isso que
 * `payCharge` grava `competence_month` da cobranca, e nao a data do pagamento.
 * Sem isso o valor sairia duas vezes: da sobra de agosto e do caixa de setembro.
 */
async function flowsFrom(ctx: AppContext, primeiro: RefMonth, ultimo: RefMonth) {
  const { rows } = await db.execute<LinhaMes>(sql`
    with meses as (
      select generate_series(
        ${firstDayOf(primeiro)}::date,
        ${firstDayOf(ultimo)}::date,
        interval '1 month'
      )::date as ref
    )
    select
      to_char(m.ref, 'YYYY-MM-DD') as ref,

      -- Recebido de verdade. Salario prometido nao e' dinheiro.
      (select coalesce(sum(t.amount_cents), 0) from transactions t
        where t.user_id = ${ctx.userId} and t.competence_month = m.ref
          and t.kind = 'income' and t.settled_on is not null and not t.is_refund)::text as income,

      -- Saiu do caixa: despesa liquidada, aporte e pagamento de fatura.
      (select coalesce(sum(t.amount_cents), 0) from transactions t
        where t.user_id = ${ctx.userId} and t.competence_month = m.ref
          and t.kind in ('expense','investment_out','transfer')
          and t.settled_on is not null and not t.is_refund
          and t.card_id is null)::text as paid_out,

      -- Falta pagar. As tres origens nao podem se sobrepor: cobranca que cai em
      -- fatura ja' esta' dentro do total do cartao, dai o filtro por statement_id.
      ((select coalesce(sum(t.amount_cents), 0) from transactions t
         where t.user_id = ${ctx.userId} and t.competence_month = m.ref
           and t.account_id is not null and t.settled_on is null and not t.is_refund
           and t.kind in ('expense','investment_out'))
       + (select coalesce(sum(sc.amount_cents), 0) from scheduled_charges sc
           where sc.user_id = ${ctx.userId} and sc.ref_month = m.ref
             and sc.status = 'pending' and sc.statement_id is null)
       + (select coalesce(sum(
             coalesce(st.closed_total_cents,
               -- Mesma conta de payments.statementTotal e da aba Cartoes: o
               -- estorno ABATE em vez de ser ignorado, e o lancamento do
               -- proprio pagamento nao entra. Somar so' os nao-estorno inflava
               -- a fatura pendente pelo valor de tudo que foi devolvido.
               (select coalesce(sum(
                   case when t2.is_refund then -t2.amount_cents else t2.amount_cents end), 0)
                  from transactions t2
                 where t2.statement_id = st.id and t2.source <> 'card_payment')
               + (select coalesce(sum(sc2.amount_cents),0) from scheduled_charges sc2
                   where sc2.statement_id = st.id and sc2.status <> 'skipped'
                     -- A cobranca que ja' caiu virou lancamento e esta' na soma
                     -- de cima; contar as duas dobraria a fatura pendente.
                     and sc2.transaction_id is null))
           ), 0) from card_statements st
           where st.user_id = ${ctx.userId} and st.ref_month = m.ref and st.status <> 'paid')
      )::text as pending,

      -- Aportado no mes. Vem do LANCAMENTO, que e' onde o aporte mora desde que
      -- o setor virou coluna dele — a tabela de contribuicoes nao existe mais.
      (select coalesce(sum(t.amount_cents), 0) from transactions t
        where t.user_id = ${ctx.userId} and t.competence_month = m.ref
          and t.kind = 'investment_out' and not t.is_refund)::text as contributed,

      (select coalesce(sum(sc.amount_cents), 0) from scheduled_charges sc
         join recurring_rules rr on rr.id = sc.rule_id
        where sc.user_id = ${ctx.userId} and sc.ref_month = m.ref
          and rr.essential and sc.status <> 'skipped')::text as essential

      from meses m
     order by m.ref
  `);

  return rows;
}

export interface CashView extends MonthCash {
  /** Quanto custa existir por mes, em media. */
  costOfLivingCents: Cents;
  /** Seis meses do custo de vida — a meta da reserva de emergencia. */
  emergencyTargetCents: Cents;
  /** O mes anterior fechou com sobra que nunca foi aportada? */
  previousUninvestedCents: Cents;
}

export const getCashView = cache(async (ctx: AppContext, month: RefMonth): Promise<CashView> => {
  await ensureMonthMaterialized(ctx, month);

  // A corrente comeca no mes de inicio da instalacao, limitada por `MAX_MESES`:
  // meses anteriores a ele nao tem lancamento nenhum e so' custariam consulta.
  const inicio = refMonth(ctx.startRefMonth);
  const distancia = monthsBetween(inicio, month);
  const primeiro = distancia > MAX_MESES ? addMonths(month, -MAX_MESES) : inicio;

  // Mes anterior ao pedido tambem entra: e' dele que sai o carregado.
  const linhas = await flowsFrom(ctx, primeiro, month);

  const flows: MonthFlow[] = linhas.map((l) => ({
    incomeCents: cents(Number(l.income ?? 0)),
    paidOutCents: cents(Number(l.paid_out ?? 0)),
    pendingCents: cents(Number(l.pending ?? 0)),
    contributedCents: cents(Number(l.contributed ?? 0)),
  }));

  const meses = runMonths(flows);
  const atual = meses.at(-1);
  const anterior = meses.length > 1 ? meses.at(-2) : undefined;

  const custo = essentialAverage(linhas.map((l) => cents(Number(l.essential ?? 0))));

  const vazio: MonthCash = {
    carriedCents: cents(0),
    cashCents: cents(0),
    pendingCents: cents(0),
    leftoverCents: cents(0),
    contributedCents: cents(0),
    carryToNextCents: cents(0),
    settled: true,
  };

  return {
    ...(atual ?? vazio),
    costOfLivingCents: custo,
    emergencyTargetCents: emergencyTarget(custo),
    // O aviso que o dono pediu: mes passado fechou com sobra e nao aportou nada.
    // Aportar SAI do caixa, entao um mes com sobra e sem aporte e' dinheiro
    // parado — e' isso que o painel precisa cutucar.
    previousUninvestedCents:
      anterior && anterior.leftoverCents > 0 && anterior.contributedCents === 0
        ? anterior.leftoverCents
        : cents(0),
  };
});
