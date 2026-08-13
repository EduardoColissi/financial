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
import { getCards } from "./cards";
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
   * Os tres compromissos do mes, cada um no seu recorte.
   *
   * ATENCAO: eles se sobrepoem de proposito e NAO devem ser somados. A
   * assinatura de cartao esta' dentro de `subscriptionsMonthCents` E dentro de
   * `cardsMonthCents` — sao a mesma despesa vista por dois angulos: "quanto
   * custam minhas assinaturas" e "quanto vou pagar de fatura". Somar os tres
   * cobraria a mesma Netflix duas vezes.
   */
  billsMonthCents: Cents;
  subscriptionsMonthCents: Cents;
  cardsMonthCents: Cents;
  /**
   * Quando o dono registrou algo pela ultima vez.
   *
   * E' o marco de conferencia do extrato: "a partir de que dia e hora preciso
   * olhar o banco para lancar o que falta". Por isso conta lancamento, conta a
   * pagar e assinatura — tudo que e' registro de dinheiro —, e NAO conta o que a
   * aplicacao gerou sozinha ao abrir um mes (ver a query em `getOverview`).
   *
   * Cadastro de estrutura — conta bancaria, cartao, categoria — fica de fora:
   * mexer na configuracao nao adianta a conferencia do extrato.
   */
  lastEntryAt: Date | null;
}

export async function getOverview(ctx: AppContext, month: RefMonth): Promise<OverviewData> {
  await ensureMonthMaterialized(ctx, month);
  const ref = firstDayOf(month);

  // `getCards` entra aqui pelo mesmo motivo de `getTransactions`: o total das
  // faturas ja' existe calculado na aba Cartoes, com todas as regras de ciclo,
  // estorno e cobranca-que-virou-lancamento. Refazer a soma aqui seria a segunda
  // verdade sobre o mesmo numero — o painel divergiria da aba de origem.
  const [tx, cat, cards] = await Promise.all([
    getTransactions(ctx, month),
    getCategories(ctx, month),
    getCards(ctx, month),
  ]);

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

  // ── compromissos do mes, por tipo ─────────────────────────────────────────
  // `bill` vence numa conta ou boleto, `subscription` cai na fatura do cartao —
  // e' o eixo do MEIO, nao "fixa x parcelada" (ver schema/enums.recurrenceKind).
  //
  // A soma segue `sc.ref_month`, o mes em que a cobranca CAI, e nao o mes da
  // fatura: a pergunta aqui e' "quanto de assinatura eu tenho neste mes", nao
  // "quanto vou pagar de fatura" — essa e' `cardsMonthCents`, que segue a fatura
  // justamente porque e' o mes em que o dinheiro sai.
  //
  // `skipped` fica de fora porque nao vai ser cobrada. A variavel sem estimativa
  // nasce zerada e entra somando nada ate' alguem digitar o valor — melhor que
  // sumir da conta.
  const compromissos = await db.execute<{ kind: string; total: string }>(sql`
    select rr.kind, coalesce(sum(sc.amount_cents), 0)::text as total
      from scheduled_charges sc
      join recurring_rules rr on rr.id = sc.rule_id
     where sc.user_id = ${ctx.userId}
       and sc.ref_month = ${ref}
       and sc.status <> 'skipped'
     group by rr.kind
  `);
  const porTipo = new Map(compromissos.rows.map((r) => [r.kind, Number(r.total)]));

  // Ultimo lancamento: olha TODOS os meses, nao so' o aberto. Perguntar "quando
  // lancei pela ultima vez" e receber "nunca" so' porque o mes visitado esta'
  // vazio seria resposta errada.
  //
  // So' entra o que o DONO registrou. `postDueCharges` (db/materialize) roda a
  // cada abertura de mes e converte cobranca vencida em lancamento; esses nascem
  // com `created_at = agora` e faziam o KPI marcar o horario do LOGIN — a
  // pergunta "ate' onde ja' lancei?" respondida com "agora mesmo", sempre.
  //
  // `external_id` e' o que separa maquina de gente: so' `postDueCharges` o
  // preenche (`charge:<id>`), e todo lancamento vindo de acao humana o deixa
  // nulo. Filtrar por `source` NAO serviria — marcar uma conta agendada como
  // paga (services/payments) tambem grava `source = 'recurring'`, e essa e' uma
  // acao do dono que precisa contar.
  //
  // Cadastrar assinatura ou conta a pagar tambem conta: a assinatura no cartao
  // so' vira lancamento quando a cobranca cai, entao sem `recurring_rules` o
  // marco ignoraria justamente o registro que o dono acabou de fazer.
  const ultimo = await db.execute<{ at: string | null }>(sql`
    select greatest(
             (select max(created_at) from transactions
               where user_id = ${ctx.userId} and external_id is null),
             (select max(created_at) from recurring_rules where user_id = ${ctx.userId})
           )::text as at
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
    billsMonthCents: cents(porTipo.get("bill") ?? 0),
    subscriptionsMonthCents: cents(porTipo.get("subscription") ?? 0),
    // `totalCents`, nao `openTotalCents`: este ultimo so' conta fatura FECHADA e
    // nao paga, para o aviso do topo da aba Cartoes. Aqui a pergunta e' quanto a
    // fatura do mes soma — incluindo a que ainda esta' em formacao e a ja' paga.
    cardsMonthCents: cents(cards.cards.reduce<number>((a, c) => a + c.totalCents, 0)),
  };
}

export { getCategories, refMonth };
