import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { materializeMonth } from "../src/db/materialize";
import * as schema from "../src/db/schema";
import {
  ACCOUNTS,
  CARDS,
  CASHFLOW_HISTORY,
  CATEGORIES,
  CONTRIBUTION,
  EXPECTED_TOTALS,
  INCOME,
  ONE_OFF_EXPENSES,
  RECURRING,
  SECTORS,
  SYSTEM_CATEGORIES,
} from "../src/db/seed-data";
import { cycleFor } from "../src/domain/card-cycle";
import { addMonths, clampDay, firstDayOf, monthOf, todayInTimeZone } from "../src/domain/period";
import { assertLocalOrExit, requireUrl } from "./_shared";

/**
 * Seed reproduzivel a partir do design.
 *
 * Idempotente: apaga o usuario do seed (cascade leva tudo junto) e reconstroi.
 * Ao final confere os totais — se o seed nao reproduzir os numeros do design,
 * nao ha' baseline para comparar a tela, e o passo falha.
 *
 * Ancorado no MES CORRENTE, nao em agosto/2026. O app le' o relogio de verdade,
 * entao um seed cravado numa data fixa produziria um painel cujo "mes atual"
 * esta' vazio — e cujos vencimentos ja' passaram todos. Tudo aqui e' relativo a
 * `MONTH`: e' o que mantem os numeros do design validos em qualquer mes.
 */

/**
 * Endereco proprio do seed. NUNCA o `GOOGLE_ALLOWED_EMAIL`.
 *
 * Este script e' destrutivo: apaga o usuario deste e-mail (cascade leva contas,
 * cartoes e lancamentos junto) e reconstroi. Ele roda sozinho no `pnpm e2e`.
 *
 * Ja' esteve apontado para o e-mail real do dono, e o efeito foi exatamente o
 * previsivel: uma rodada de teste apagou uma conta cadastrada a mao e derrubou
 * a sessao. O usuario do seed e o usuario de verdade tem que ser linhas
 * diferentes, para a suite nunca alcancar o que foi cadastrado pela tela.
 */
const SEED_EMAIL = "seed@meucaixa.local";
const SEED_TZ = "America/Sao_Paulo";

const MONTH = monthOf(todayInTimeZone(SEED_TZ));
const PREV_MONTH = addMonths(MONTH, -1);
const COMPETENCE = firstDayOf(MONTH);

/**
 * Onde a instalacao "comeca": limite para tras da navegacao de mes e mes do
 * aporte historico da carteira. Sete meses cobrem as cinco barras do grafico de
 * fluxo com folga.
 */
const HISTORY_START = addMonths(MONTH, -7);

/**
 * As despesas do mes ocorrem entre o fim do mes passado e o dia 1 — e' o que o
 * design mostra (TX vai de 27/07 a 01/08) e todas contam no mes corrente. E'
 * exatamente a distincao entre `occurred_on` e `competence_month`.
 */
// Dia 20 do mes passado: cai na fatura que vence NESTE mes em todo cartao do
// seed. Nos que fecham 28 e 02 por estar antes do fechamento; no que fecha 20
// porque a compra do proprio dia do fechamento ja' pertence ao ciclo seguinte.
// A relacao vale em qualquer mes — `cycleFor` compara dia do mes com
// `closingDay`.
const CREDIT_DATE = clampDay(PREV_MONTH, 20);
const CASH_DATE = COMPETENCE;
// `clampDay`, nao dia 30 cru: fevereiro nao tem dia 30 e `plainDate` recusaria.
const FILLER_DATE = clampDay(PREV_MONTH, 30);

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
      .values({ email: SEED_EMAIL, name: "Eduardo", timezone: SEED_TZ })
      .returning();
    if (!user) throw new Error("falhou ao criar usuario");
    const userId = user.id;

    await db.insert(schema.appSettings).values({
      userId,
      startRefMonth: firstDayOf(HISTORY_START),
      maxFutureMonths: 24,
    });

    // ── categorias ─────────────────────────────────────────────────────────
    const categoryIds = new Map<string, string>();
    for (const [i, c] of CATEGORIES.entries()) {
      const [row] = await db
        .insert(schema.categories)
        .values({
          userId,
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

    // ── setores de investimento ────────────────────────────────────────────
    const sectorIds = new Map<string, string>();
    for (const [i, sector] of SECTORS.entries()) {
      const [row] = await db
        .insert(schema.investmentSectors)
        .values({
          userId,
          name: sector.name,
          color: sector.color,
          sharePercent: sector.sharePercent,
          targetCents: "targetCents" in sector ? sector.targetCents : null,
          annualTargetCents: sector.annualTargetCents,
          isEmergencyFund: sector.isEmergencyFund,
          sortOrder: i,
        })
        .returning();
      if (row) sectorIds.set(sector.name, row.id);
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
        firstRefMonth: firstDayOf(addMonths(MONTH, r.firstMonthOffset)),
        installmentsTotal: "installments" in r ? r.installments : null,
      });
    }

    // ── materializa os meses usando o MESMO codigo da aplicacao ────────────
    for (let i = -5; i <= 1; i++) {
      await materializeMonth(db, { userId, today: todayInTimeZone(SEED_TZ) }, addMonths(MONTH, i));
    }

    // ── lancamentos do mes corrente ────────────────────────────────────────
    const renda = categoryIds.get("Renda") ?? "";

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
      // Aporte aponta para SETOR, nunca para categoria — e o CHECK
      // `tx_category_ck` recusa a linha se as duas coisas vierem juntas.
      sectorId: sectorIds.get(CONTRIBUTION.sector),
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
    }

    // Aluguel: unica conta que ja' venceu, no dia 1.
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

    /**
     * Complemento por categoria.
     *
     * As 15 transacoes do design nao somam os `real` das categorias (achado 5):
     * os agregados batem entre si, o detalhe nao. Sem fechar a diferenca aqui,
     * a tela nunca bate com o design e o QA nao tem baseline.
     *
     * O gasto ja' lancado vem do BANCO, nao de um contador em memoria: parte
     * dele nao passa por este script. As assinaturas e parcelas do cartao que ja'
     * cairam viram lancamento dentro da materializacao (`postDueCharges`), e um
     * contador que so' somasse o que o seed insere as ignoraria — cada categoria
     * fecharia acima do `real` do design, e o total do mes estouraria junto.
     */
    const gasto = await db.execute<{ category_id: string; total: string }>(sql`
      select category_id, sum(amount_cents)::text as total
        from transactions
       where user_id = ${userId} and competence_month = ${COMPETENCE}
         and kind = 'expense' and category_id is not null
       group by category_id
    `);
    const spentByCategory = new Map(gasto.rows.map((r) => [r.category_id, Number(r.total)]));

    for (const c of CATEGORIES) {
      const diff = c.realCents - (spentByCategory.get(categoryIds.get(c.name) ?? "") ?? 0);
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
        refMonth: firstDayOf(addMonths(MONTH, h.monthOffset)),
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

  // "aplicado" e "carteira" sairam junto com a aba de investimentos: nao ha'
  // mais `investment_flows` nem `investment_valuations` para conferir.

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
