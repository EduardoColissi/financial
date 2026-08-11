import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts, categories, creditCards, investmentSectors, transactions } from "@/db/schema";
import type { EntryLink } from "@/domain/entry-edit";
import { type Cents, cents } from "@/domain/money";
import { firstDayOf, type PlainDate, plainDate, type RefMonth } from "@/domain/period";
import { statusTone, type Tone, type TransactionStatus, txStatus } from "@/domain/status";
import type { AppContext } from "./context";
import { ensureMonthMaterialized } from "./materialize";

/**
 * Leituras das abas.
 *
 * Toda query filtra por `user_id` e por mes NO BANCO. O design filtra no
 * cliente (linha 1218) — o que so' funciona porque o mock tem 15 linhas.
 *
 * Os DTOs entregam centavos crus e enums; nenhuma string formatada nem cor
 * pronta cruza a fronteira. Formatacao e' responsabilidade do componente.
 */

export interface TransactionRow {
  id: string;
  occurredOn: PlainDate;
  description: string;
  amountCents: Cents;
  kind: "income" | "expense" | "investment_in" | "investment_out" | "transfer";
  method: string;
  categoryName: string | null;
  categoryColor: string | null;
  sourceName: string;
  installmentLabel: string | null;
  status: TransactionStatus;
  tone: Tone;
  onCredit: boolean;
  /** Ids crus, para o formulario de edicao abrir ja' preenchido. */
  categoryId: string | null;
  sectorId: string | null;
  accountId: string | null;
  cardId: string | null;
  /** O que depende desta linha — manda no que da' para editar e no que a
   * exclusao desfaz. Ver `domain/entry-edit`. */
  link: EntryLink;
}

export interface TransactionsFilter {
  q?: string;
  kind?: string;
  method?: string;
}

export interface TransactionsResult {
  rows: TransactionRow[];
  total: number;
  shown: number;
  incomeCents: Cents;
  outflowCents: Cents;
}

const METHOD_LABEL: Record<string, string> = {
  pix: "Pix",
  debit: "Débito",
  credit: "Crédito",
  boleto: "Boleto",
  cash: "Dinheiro",
  auto_debit: "Débito auto",
  transfer: "Transf.",
};

export function methodLabel(method: string): string {
  return METHOD_LABEL[method] ?? method;
}

/**
 * Traduz as subconsultas de vinculo no `EntryLink` do dominio.
 *
 * A ordem e' de exclusividade: uma linha que paga uma fatura nunca e' tambem a
 * quitacao de uma cobranca avulsa. Aporte nao entra — ele deixou de ser vinculo
 * quando o setor virou coluna do proprio lancamento, e hoje e' linha solta.
 */
function linkOf(r: {
  chargeName: string | null;
  chargeOnCard: boolean | null;
  statementCard: string | null;
  statementCharges: number;
}): EntryLink {
  if (r.chargeName) return { kind: "charge", label: r.chargeName, onCard: r.chargeOnCard === true };
  if (r.statementCard) {
    return {
      kind: "statement",
      label: r.statementCard,
      charges: Number(r.statementCharges ?? 0),
    };
  }
  return { kind: "none" };
}

export async function getTransactions(
  ctx: AppContext,
  month: RefMonth,
  filter: TransactionsFilter = {}
): Promise<TransactionsResult> {
  await ensureMonthMaterialized(ctx, month);
  const ref = firstDayOf(month);

  const rows = await db
    .select({
      id: transactions.id,
      occurredOn: transactions.occurredOn,
      description: transactions.description,
      amountCents: transactions.amountCents,
      kind: transactions.kind,
      method: transactions.method,
      settledOn: transactions.settledOn,
      installmentSeq: transactions.installmentSeq,
      installmentTotal: transactions.installmentTotal,
      cardId: transactions.cardId,
      categoryId: transactions.categoryId,
      sectorId: transactions.sectorId,
      accountId: transactions.accountId,
      // Aporte nao tem categoria: o setor ocupa a mesma coluna da tabela, com o
      // mesmo pontinho colorido. Sao dois cadastros, uma coluna so' na tela.
      categoryName: sql<string | null>`coalesce(${categories.name}, ${investmentSectors.name})`,
      categoryColor: sql<string | null>`coalesce(${categories.color}, ${investmentSectors.color})`,
      accountName: accounts.name,
      cardName: creditCards.name,

      /*
       * Os vinculos vem como subconsulta correlacionada, nao como `leftJoin`.
       * Um join com `scheduled_charges` duplicaria a LINHA caso houvesse duas
       * cobrancas apontando para o mesmo lancamento — e um lancamento repetido
       * na lista seria lido como dinheiro gasto duas vezes.
       */
      chargeName: sql<string | null>`(
        select r.name from scheduled_charges sc
          join recurring_rules r on r.id = sc.rule_id
         where sc.transaction_id = ${transactions.id} limit 1)`,
      // Cobranca de cartao e cobranca em conta desfazem de jeitos opostos, e a
      // tela precisa dizer qual dos dois antes de o botao ser clicado.
      chargeOnCard: sql<boolean | null>`(
        select r.card_id is not null from scheduled_charges sc
          join recurring_rules r on r.id = sc.rule_id
         where sc.transaction_id = ${transactions.id} limit 1)`,
      statementCard: sql<string | null>`(
        select c.name from card_statements st
          join credit_cards c on c.id = st.card_id
         where st.payment_transaction_id = ${transactions.id} limit 1)`,
      statementCharges: sql<number>`(
        select count(*)::int from scheduled_charges sc
         where sc.statement_id = (select st.id from card_statements st
                                   where st.payment_transaction_id = ${transactions.id} limit 1))`,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(creditCards, eq(creditCards.id, transactions.cardId))
    .leftJoin(investmentSectors, eq(investmentSectors.id, transactions.sectorId))
    .where(and(eq(transactions.userId, ctx.userId), eq(transactions.competenceMonth, ref)))
    .orderBy(desc(transactions.occurredOn), desc(transactions.createdAt));

  const all: TransactionRow[] = rows.map((r) => {
    const onCredit = r.cardId != null;
    const link = linkOf(r);
    const status = txStatus({
      kind: r.kind,
      onCredit,
      settledOn: r.settledOn ? plainDate(r.settledOn) : null,
      installmentTotal: r.installmentTotal,
    });
    return {
      id: r.id,
      occurredOn: plainDate(r.occurredOn),
      description: r.description,
      amountCents: cents(r.amountCents),
      kind: r.kind,
      method: r.method,
      categoryName: r.categoryName,
      categoryColor: r.categoryColor,
      sourceName: r.cardName ?? r.accountName ?? "—",
      installmentLabel:
        r.installmentSeq && r.installmentTotal ? `${r.installmentSeq}/${r.installmentTotal}` : null,
      status,
      tone: statusTone(status),
      onCredit,
      categoryId: r.categoryId,
      sectorId: r.sectorId,
      accountId: r.accountId,
      cardId: r.cardId,
      link,
    };
  });

  const q = (filter.q ?? "").trim().toLowerCase();
  const filtered = all.filter((t) => {
    if (filter.kind && filter.kind !== "todos") {
      if (filter.kind === "receita" && t.kind !== "income") return false;
      if (filter.kind === "despesa" && t.kind !== "expense") return false;
      if (filter.kind === "aporte" && t.kind !== "investment_out") return false;
    }
    if (filter.method && filter.method !== "todos" && t.method !== filter.method) return false;
    if (q) {
      const haystack = `${t.description} ${t.categoryName ?? ""} ${t.sourceName}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const income = filtered
    .filter((t) => t.kind === "income")
    .reduce<number>((a, t) => a + t.amountCents, 0);
  const outflow = filtered
    .filter((t) => t.kind !== "income")
    .reduce<number>((a, t) => a + t.amountCents, 0);

  return {
    rows: filtered,
    total: all.length,
    shown: filtered.length,
    incomeCents: cents(income),
    outflowCents: cents(outflow),
  };
}

// ── categorias ───────────────────────────────────────────────────────────────

export interface CategoryStat {
  id: string;
  name: string;
  color: string;
  spentCents: Cents;
  budgetCents: Cents | null;
  count: number;
  avgCents: Cents;
  shareOfTotal: number;
  dominantMethod: string | null;
}

export interface CategoriesResult {
  categories: CategoryStat[];
  totalCents: Cents;
  transactionCount: number;
}

/**
 * Gasto do mes por categoria.
 *
 * Sem nivel de grupo: o agrupamento que interessa e' o proprio grafico, que
 * separa as despesas por categoria. Um nivel intermediario era cadastro a mais
 * para o mesmo resultado.
 *
 * `leftJoin` e nao `innerJoin`: categoria sem lancamento no mes precisa
 * aparecer com zero, senao ela some da tela justamente no mes em que o dono
 * quer conferir que nao gastou nada nela.
 */
export async function getCategories(ctx: AppContext, month: RefMonth): Promise<CategoriesResult> {
  await ensureMonthMaterialized(ctx, month);
  const ref = firstDayOf(month);

  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      color: categories.color,
      budgetCents: categories.monthlyBudgetCents,
      spent: sql<string>`coalesce(sum(case when ${transactions.isRefund} then -${transactions.amountCents} else ${transactions.amountCents} end), 0)::text`,
      count: sql<string>`count(${transactions.id})::text`,
      method: sql<string | null>`mode() within group (order by ${transactions.method})`,
    })
    .from(categories)
    .leftJoin(
      transactions,
      and(
        eq(transactions.categoryId, categories.id),
        eq(transactions.competenceMonth, ref),
        eq(transactions.kind, "expense")
      )
    )
    .where(and(eq(categories.userId, ctx.userId), eq(categories.kind, "expense")))
    .groupBy(
      categories.id,
      categories.name,
      categories.color,
      categories.monthlyBudgetCents,
      categories.sortOrder
    )
    .orderBy(asc(categories.sortOrder));

  const total = rows.reduce<number>((a, r) => a + Number(r.spent), 0);
  let txCount = 0;

  const stats: CategoryStat[] = rows.map((r) => {
    const spent = Number(r.spent);
    const count = Number(r.count);
    txCount += count;
    return {
      id: r.id,
      name: r.name,
      color: r.color,
      spentCents: cents(spent),
      budgetCents: r.budgetCents != null ? cents(r.budgetCents) : null,
      count,
      avgCents: cents(count > 0 ? Math.round(spent / count) : 0),
      shareOfTotal: total > 0 ? (spent / total) * 100 : 0,
      dominantMethod: r.method ? methodLabel(r.method) : null,
    };
  });

  return {
    categories: [...stats].sort((a, b) => b.spentCents - a.spentCents),
    totalCents: cents(total),
    transactionCount: txCount,
  };
}
