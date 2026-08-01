import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts, categories, categoryGroups, creditCards, transactions } from "@/db/schema";
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
      categoryName: categories.name,
      categoryColor: categories.color,
      accountName: accounts.name,
      cardName: creditCards.name,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(creditCards, eq(creditCards.id, transactions.cardId))
    .where(and(eq(transactions.userId, ctx.userId), eq(transactions.competenceMonth, ref)))
    .orderBy(desc(transactions.occurredOn), desc(transactions.createdAt));

  const all: TransactionRow[] = rows.map((r) => {
    const onCredit = r.cardId != null;
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
  groupName: string;
  spentCents: Cents;
  budgetCents: Cents | null;
  count: number;
  avgCents: Cents;
  shareOfTotal: number;
  dominantMethod: string | null;
}

export interface GroupStat {
  id: string;
  name: string;
  color: string;
  spentCents: Cents;
  categories: CategoryStat[];
}

export interface CategoriesResult {
  groups: GroupStat[];
  categories: CategoryStat[];
  totalCents: Cents;
  transactionCount: number;
}

export async function getCategories(ctx: AppContext, month: RefMonth): Promise<CategoriesResult> {
  await ensureMonthMaterialized(ctx, month);
  const ref = firstDayOf(month);

  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      color: categories.color,
      budgetCents: categories.monthlyBudgetCents,
      groupId: categoryGroups.id,
      groupName: categoryGroups.name,
      groupColor: categoryGroups.color,
      groupOrder: categoryGroups.sortOrder,
      spent: sql<string>`coalesce(sum(case when ${transactions.isRefund} then -${transactions.amountCents} else ${transactions.amountCents} end), 0)::text`,
      count: sql<string>`count(${transactions.id})::text`,
      method: sql<string | null>`mode() within group (order by ${transactions.method})`,
    })
    .from(categories)
    .leftJoin(categoryGroups, eq(categoryGroups.id, categories.groupId))
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
      categoryGroups.id,
      categoryGroups.name,
      categoryGroups.color,
      categoryGroups.sortOrder
    )
    .orderBy(asc(categoryGroups.sortOrder), asc(categories.sortOrder));

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
      groupName: r.groupName ?? "—",
      spentCents: cents(spent),
      budgetCents: r.budgetCents != null ? cents(r.budgetCents) : null,
      count,
      avgCents: cents(count > 0 ? Math.round(spent / count) : 0),
      shareOfTotal: total > 0 ? (spent / total) * 100 : 0,
      dominantMethod: r.method ? methodLabel(r.method) : null,
    };
  });

  const groupMap = new Map<string, GroupStat>();
  for (const r of rows) {
    if (!r.groupId) continue;
    if (!groupMap.has(r.groupId)) {
      groupMap.set(r.groupId, {
        id: r.groupId,
        name: r.groupName ?? "—",
        color: r.groupColor ?? "var(--fg-mut)",
        spentCents: cents(0),
        categories: [],
      });
    }
    const group = groupMap.get(r.groupId);
    const stat = stats.find((s) => s.id === r.id);
    if (group && stat) {
      group.categories.push(stat);
      group.spentCents = cents(group.spentCents + stat.spentCents);
    }
  }

  for (const group of groupMap.values()) {
    group.categories.sort((a, b) => b.spentCents - a.spentCents);
  }

  return {
    groups: [...groupMap.values()],
    categories: [...stats].sort((a, b) => b.spentCents - a.spentCents),
    totalCents: cents(total),
    transactionCount: txCount,
  };
}

// ── saldos em conta ──────────────────────────────────────────────────────────

export interface AccountBalance {
  id: string;
  name: string;
  type: string;
  tag: string | null;
  initials: string;
  color: string;
  balanceCents: Cents;
}

export async function getAccountBalances(
  ctx: AppContext
): Promise<{ accounts: AccountBalance[]; totalCents: Cents }> {
  const rows = await db
    .select()
    .from(accounts)
    .where(eq(accounts.userId, ctx.userId))
    .orderBy(asc(accounts.sortOrder));

  const visible = rows.filter((a) => a.includeInCashTotal && a.archivedAt == null);
  const list: AccountBalance[] = visible.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    tag: a.tag,
    initials: a.initials,
    color: a.color,
    balanceCents: cents(a.openingBalanceCents),
  }));

  return {
    accounts: list,
    totalCents: cents(list.reduce<number>((acc, a) => acc + a.balanceCents, 0)),
  };
}
