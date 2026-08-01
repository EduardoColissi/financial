import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { materializeMonth } from "../src/db/materialize";
import * as schema from "../src/db/schema";
import {
  ACCOUNTS,
  ASSETS,
  CARDS,
  CASHFLOW_HISTORY,
  CATEGORIES,
  CONTRIBUTION,
  EXPECTED_TOTALS,
  GOALS,
  GROUPS,
  INCOME,
  ONE_OFF_EXPENSES,
  RECURRING,
  SEGMENTS,
  SYSTEM_CATEGORIES,
} from "../src/db/seed-data";
import { cycleFor } from "../src/domain/card-cycle";
import { addMonths, firstDayOf, refMonth } from "../src/domain/period";
import { assertLocalOrExit, requireUrl } from "./_shared";

/**
 * Seed reproduzivel a partir do design.
 *
 * Idempotente: apaga o usuario do seed (cascade leva tudo junto) e reconstroi.
 * Ao final confere os totais — se o seed nao reproduzir os numeros do design,
 * nao ha' baseline para comparar a tela, e o passo falha.
 */

const SEED_EMAIL = "eu@meucaixa.local";
const MONTH = refMonth("2026-08");
const COMPETENCE = firstDayOf(MONTH);

/**
 * As despesas de agosto ocorrem entre 27/07 e 01/08 — e' o que o design mostra
 * (TX vai de 27/07 a 01/08) e todas contam em agosto. E' exatamente a distincao
 * entre `occurred_on` e `competence_month`.
 */
const CREDIT_DATE = "2026-07-20"; // dentro do ciclo 29/06-28/07, fatura vence 05/08
const CASH_DATE = "2026-08-01";
const FILLER_DATE = "2026-07-30";

async function main() {
  const url = requireUrl("direct");
  assertLocalOrExit(url, "db:seed (apaga e recria os dados do seed)");

  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool, { schema });

  try {
    // ── limpeza idempotente ────────────────────────────────────────────────
    await db.delete(schema.users).where(eq(schema.users.email, SEED_EMAIL));

    const [user] = await db
      .insert(schema.users)
      .values({ email: SEED_EMAIL, name: "Eduardo", timezone: "America/Sao_Paulo" })
      .returning();
    if (!user) throw new Error("falhou ao criar usuario");
    const userId = user.id;

    await db.insert(schema.appSettings).values({
      userId,
      startRefMonth: firstDayOf(refMonth("2026-01")),
      maxFutureMonths: 24,
    });

    // ── grupos e categorias ────────────────────────────────────────────────
    const groupIds = new Map<string, string>();
    for (const g of GROUPS) {
      const [row] = await db
        .insert(schema.categoryGroups)
        .values({ userId, name: g.name, color: g.color, sortOrder: g.sortOrder })
        .returning();
      if (row) groupIds.set(g.name, row.id);
    }

    const categoryIds = new Map<string, string>();
    for (const [i, c] of CATEGORIES.entries()) {
      const [row] = await db
        .insert(schema.categories)
        .values({
          userId,
          groupId: groupIds.get(c.group),
          name: c.name,
          color: c.color,
          kind: "expense",
          monthlyBudgetCents: c.budgetCents,
          sortOrder: i,
        })
        .returning();
      if (row) categoryIds.set(c.name, row.id);
    }
    for (const c of SYSTEM_CATEGORIES) {
      const [row] = await db
        .insert(schema.categories)
        .values({ userId, name: c.name, color: c.color, kind: c.kind, isSystem: true })
        .returning();
      if (row) categoryIds.set(c.name, row.id);
    }

    // ── contas e cartoes ───────────────────────────────────────────────────
    const accountIds = new Map<string, string>();
    for (const [i, a] of ACCOUNTS.entries()) {
      const [row] = await db
        .insert(schema.accounts)
        .values({
          userId,
          name: a.name,
          type: a.type,
          tag: a.tag,
          initials: a.initials,
          color: a.color,
          openingBalanceCents: a.balanceCents,
          openingBalanceOn: "2026-08-01",
          includeInCashTotal: a.includeInCashTotal,
          sortOrder: i,
        })
        .returning();
      if (row) accountIds.set(a.name, row.id);
    }

    const cardIds = new Map<string, string>();
    for (const [i, c] of CARDS.entries()) {
      const [row] = await db
        .insert(schema.creditCards)
        .values({
          userId,
          name: c.name,
          brand: c.brand,
          lastFour: c.lastFour,
          limitCents: c.limitCents,
          closingDay: c.closingDay,
          dueDay: c.dueDay,
          color: c.color,
          sortOrder: i,
        })
        .returning();
      if (row) cardIds.set(c.name, row.id);
    }

    // ── regras de recorrencia (ja' deduplicadas) ───────────────────────────
    for (const r of RECURRING) {
      const isVariable = "isVariable" in r && r.isVariable === true;
      await db.insert(schema.recurringRules).values({
        userId,
        kind: r.kind,
        name: r.name,
        categoryId: categoryIds.get(r.category) ?? "",
        method: "card" in r && r.card ? "credit" : ((r as { method: string }).method as never),
        accountId: "account" in r && r.account ? accountIds.get(r.account) : null,
        cardId: "card" in r && r.card ? cardIds.get(r.card) : null,
        dueDay: r.dueDay,
        amountCents: isVariable ? null : ((r as { amountCents?: number }).amountCents ?? null),
        isVariable,
        estimatedCents: isVariable ? (r as { estimatedCents: number }).estimatedCents : null,
        autopay: r.autopay,
        firstRefMonth: firstDayOf(refMonth(r.firstMonth)),
        installmentsTotal: "installments" in r ? r.installments : null,
      });
    }

    // ── investimentos ──────────────────────────────────────────────────────
    const segmentIds = new Map<string, string>();
    for (const [i, s] of SEGMENTS.entries()) {
      const [row] = await db
        .insert(schema.investmentSegments)
        .values({
          userId,
          name: s.name,
          color: s.color,
          targetPercent: String(s.targetPercent),
          sortOrder: i,
        })
        .returning();
      if (row) segmentIds.set(s.name, row.id);
    }

    const assetIds = new Map<string, string>();
    for (const [i, a] of ASSETS.entries()) {
      const [row] = await db
        .insert(schema.investmentAssets)
        .values({
          userId,
          segmentId: segmentIds.get(a.segment) ?? "",
          name: a.name,
          ticker: "ticker" in a ? a.ticker : null,
          detail: a.detail,
          sortOrder: i,
        })
        .returning();
      if (!row) continue;
      assetIds.set(a.name, row.id);

      // Aporte historico (custo aplicado) e valor de mercado atual.
      await db.insert(schema.investmentFlows).values({
        userId,
        assetId: row.id,
        kind: "contribution",
        occurredOn: "2026-01-15",
        refMonth: firstDayOf(refMonth("2026-01")),
        amountCents: a.investedCents,
      });

      // Valor do mes anterior, para o rendimento de agosto ser reconstruivel.
      await db.insert(schema.investmentValuations).values([
        {
          userId,
          assetId: row.id,
          refMonth: firstDayOf(refMonth("2026-07")),
          marketValueCents: a.valueCents - a.monthCents,
          measuredOn: "2026-07-31",
        },
        {
          userId,
          assetId: row.id,
          refMonth: COMPETENCE,
          marketValueCents: a.valueCents,
          measuredOn: "2026-08-01",
        },
      ]);

      // Proventos: reinvestidos, sem lancamento associado — a regra C1 esta'
      // gravada no CHECK flows_cash_link_ck, entao um transaction_id aqui seria
      // recusado pelo banco.
      if (a.dividendCents > 0) {
        await db.insert(schema.investmentFlows).values({
          userId,
          assetId: row.id,
          kind: "dividend",
          occurredOn: "2026-08-01",
          refMonth: COMPETENCE,
          amountCents: a.dividendCents,
          reinvested: true,
        });
      }
    }

    for (const [i, g] of GOALS.entries()) {
      await db.insert(schema.goals).values({
        userId,
        name: g.name,
        color: g.color,
        targetCents: g.targetCents,
        sourceMode: g.sourceMode,
        manualAmountCents: "manualAmountCents" in g ? g.manualAmountCents : null,
        linkedSegmentId: "linkedSegment" in g ? (segmentIds.get(g.linkedSegment) ?? null) : null,
        deadlineLabel: g.deadlineLabel,
        sortOrder: i,
      });
    }

    // ── materializa os meses usando o MESMO codigo da aplicacao ────────────
    for (let i = -5; i <= 1; i++) {
      await materializeMonth(db, { userId }, addMonths(MONTH, i));
    }

    // ── lancamentos de agosto ──────────────────────────────────────────────
    const renda = categoryIds.get("Renda") ?? "";
    const aporte = categoryIds.get("Aporte") ?? "";

    for (const income of INCOME) {
      await db.insert(schema.transactions).values({
        userId,
        kind: "income",
        occurredOn: CASH_DATE,
        competenceMonth: COMPETENCE,
        description: income.description,
        amountCents: income.amountCents,
        categoryId: renda,
        method: "pix",
        accountId: accountIds.get(income.account),
        settledOn: CASH_DATE,
      });
    }

    await db.insert(schema.transactions).values({
      userId,
      kind: "investment_out",
      occurredOn: CASH_DATE,
      competenceMonth: COMPETENCE,
      description: CONTRIBUTION.description,
      amountCents: CONTRIBUTION.amountCents,
      categoryId: aporte,
      method: "transfer",
      accountId: accountIds.get(CONTRIBUTION.account),
      settledOn: CASH_DATE,
    });

    /** Resolve a fatura em que uma compra no credito cai. */
    const statementFor = async (cardName: string, date: string) => {
      const card = CARDS.find((c) => c.name === cardName);
      if (!card) return null;
      const cycle = cycleFor({ closingDay: card.closingDay, dueDay: card.dueDay }, date as never);
      const row = await db.query.cardStatements.findFirst({
        where: (t, { and: a, eq: e }) =>
          a(e(t.cardId, cardIds.get(cardName) ?? ""), e(t.refMonth, firstDayOf(cycle.refMonth))),
      });
      return row?.id ?? null;
    };

    const spentByCategory = new Map<string, number>();
    const addSpent = (cat: string, cents: number) =>
      spentByCategory.set(cat, (spentByCategory.get(cat) ?? 0) + cents);

    for (const e of ONE_OFF_EXPENSES) {
      const onCredit = "card" in e && e.card;
      const date = onCredit ? CREDIT_DATE : CASH_DATE;
      await db.insert(schema.transactions).values({
        userId,
        kind: "expense",
        occurredOn: date,
        competenceMonth: COMPETENCE,
        description: e.description,
        amountCents: e.amountCents,
        categoryId: categoryIds.get(e.category),
        method: e.method as never,
        accountId: onCredit ? null : accountIds.get((e as { account: string }).account),
        cardId: onCredit ? cardIds.get(e.card) : null,
        statementId: onCredit ? await statementFor(e.card, date) : null,
        settledOn: onCredit ? null : date,
      });
      addSpent(e.category, e.amountCents);
    }

    // Aluguel: unica conta que ja' venceu em 01/08.
    await db.insert(schema.transactions).values({
      userId,
      kind: "expense",
      occurredOn: CASH_DATE,
      competenceMonth: COMPETENCE,
      description: "Aluguel apartamento",
      amountCents: 220000,
      categoryId: categoryIds.get("Moradia"),
      method: "pix",
      accountId: accountIds.get("Nubank · Conta"),
      settledOn: CASH_DATE,
      source: "recurring",
    });
    addSpent("Moradia", 220000);

    /**
     * Complemento por categoria.
     *
     * As 15 transacoes do design nao somam os `real` das categorias (achado 5):
     * os agregados batem entre si, o detalhe nao. Sem fechar a diferenca aqui,
     * a tela nunca bate com o design e o QA nao tem baseline.
     */
    for (const c of CATEGORIES) {
      const diff = c.realCents - (spentByCategory.get(c.name) ?? 0);
      if (diff <= 0) continue;
      await db.insert(schema.transactions).values({
        userId,
        kind: "expense",
        occurredOn: FILLER_DATE,
        competenceMonth: COMPETENCE,
        description: `Diversos · ${c.name}`,
        amountCents: diff,
        categoryId: categoryIds.get(c.name),
        method: "debit",
        accountId: accountIds.get("Nubank · Conta"),
        settledOn: FILLER_DATE,
      });
    }

    // ── historico do grafico de 6 meses ────────────────────────────────────
    for (const h of CASHFLOW_HISTORY) {
      await db.insert(schema.monthlyCashflowSnapshots).values({
        userId,
        refMonth: firstDayOf(refMonth(h.month)),
        incomeCents: h.incomeCents,
        expenseCents: h.expenseCents,
        contributionCents: h.contributionCents,
        // Meses historicos sem lancamento: congelados, nao sao cache.
        frozen: true,
      });
    }

    await verify(db, userId);
    console.log(`\nSINGLE_USER_ID=${userId}`);
  } finally {
    await pool.end();
  }
}

/** Confere que o seed reproduz os numeros do design. */
async function verify(db: ReturnType<typeof drizzle<typeof schema>>, userId: string) {
  const totals = await db.execute<{
    kind: string;
    total: string;
  }>(sql`
    select kind, sum(amount_cents)::text as total
      from transactions
     where user_id = ${userId} and competence_month = ${COMPETENCE}
     group by kind
  `);

  const by = new Map(totals.rows.map((r) => [r.kind, Number(r.total)]));
  const checks: Array<[string, number, number]> = [
    ["despesas", by.get("expense") ?? 0, EXPECTED_TOTALS.expenseCents],
    ["receitas", by.get("income") ?? 0, EXPECTED_TOTALS.incomeCents],
    ["aporte", by.get("investment_out") ?? 0, EXPECTED_TOTALS.contributionCents],
  ];

  const invested = await db.execute<{ total: string }>(sql`
    select coalesce(sum(amount_cents),0)::text as total from investment_flows
     where user_id = ${userId} and kind = 'contribution'
  `);
  checks.push(["aplicado", Number(invested.rows[0]?.total ?? 0), EXPECTED_TOTALS.investedCents]);

  const portfolio = await db.execute<{ total: string }>(sql`
    select coalesce(sum(market_value_cents),0)::text as total from investment_valuations
     where user_id = ${userId} and ref_month = ${COMPETENCE}
  `);
  checks.push(["carteira", Number(portfolio.rows[0]?.total ?? 0), EXPECTED_TOTALS.portfolioCents]);

  let failed = 0;
  const brl = (c: number) =>
    `R$ ${(c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

  console.log("\nConferindo contra o design:");
  for (const [label, actual, expected] of checks) {
    if (actual === expected) {
      console.log(`  ok: ${label} = ${brl(actual)}`);
    } else {
      console.error(`  ERRO: ${label} = ${brl(actual)}, esperado ${brl(expected)}`);
      failed++;
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} total(is) nao batem com o design.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
