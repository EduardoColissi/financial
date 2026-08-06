import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  accounts,
  cardStatements,
  categories,
  creditCards,
  recurringRules,
  scheduledCharges,
  transactions,
} from "@/db/schema";
import type {
  AccountDraft,
  CardDraft,
  CategoryDraft,
  CategoryKind,
  RecurringDraft,
} from "@/domain/registry";
import { CATEGORY_KINDS, RegistryError } from "@/domain/registry";
import type { AppContext } from "./context";

/**
 * Cadastro de contas e cartoes.
 *
 * Exclusao e' DEFINITIVA e cascateia. Nao ha' arquivamento: `archived_at` saiu
 * das tres tabelas de cadastro, e as chaves estrangeiras de `transactions` e
 * `recurring_rules` viraram `cascade`.
 *
 * O que isso custa esta' dito onde importa: apagar uma conta com historico nao
 * e' "parei de usar", e' "este dinheiro nunca existiu" — totais de meses
 * fechados mudam retroativamente. Por isso `accountImpacts`/`cardImpacts`
 * existem: a tela mostra o numero de dependentes antes de deixar seguir.
 */

/** Violacao de UNIQUE no Postgres. */
const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && e.code === UNIQUE_VIOLATION;
}

/**
 * Traduz a recusa do banco para o campo do formulario.
 *
 * O indice e' sobre `lower(name)`, entao "Nubank" e "nubank" colidem — o que e'
 * a intencao, mas a mensagem crua do Postgres nao explica isso a ninguem.
 */
async function comNomeUnico<T>(rotulo: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new RegistryError("name", `Já existe ${rotulo} com esse nome.`);
    }
    throw e;
  }
}

/** Proxima posicao na lista. Item novo entra no fim. */
async function proximaOrdem(
  tabela: typeof accounts | typeof creditCards | typeof categories,
  userId: string
): Promise<number> {
  const [linha] = await db
    .select({ max: sql<number>`coalesce(max(${tabela.sortOrder}), -1)` })
    .from(tabela)
    .where(eq(tabela.userId, userId));
  return Number(linha?.max ?? -1) + 1;
}

// ── contas ───────────────────────────────────────────────────────────────────

export type AccountRow = typeof accounts.$inferSelect;
export type CardRow = typeof creditCards.$inferSelect;

export async function listAccounts(ctx: AppContext): Promise<AccountRow[]> {
  return db
    .select()
    .from(accounts)
    .where(eq(accounts.userId, ctx.userId))
    .orderBy(asc(accounts.sortOrder), asc(accounts.name));
}

export async function createAccount(ctx: AppContext, draft: AccountDraft): Promise<string> {
  return comNomeUnico("uma conta", async () => {
    const [linha] = await db
      .insert(accounts)
      .values({
        userId: ctx.userId,
        name: draft.name,
        type: draft.type,
        tag: draft.tag,
        holder: draft.holder,
        initials: draft.initials,
        color: draft.color,
        includeInCashTotal: draft.includeInCashTotal,
        sortOrder: await proximaOrdem(accounts, ctx.userId),
      })
      .returning({ id: accounts.id });
    if (!linha) throw new RegistryError("name", "Não foi possível criar a conta.");
    return linha.id;
  });
}

export async function updateAccount(
  ctx: AppContext,
  id: string,
  draft: AccountDraft
): Promise<void> {
  const alteradas = await comNomeUnico("uma conta", async () =>
    db
      .update(accounts)
      .set({
        name: draft.name,
        type: draft.type,
        tag: draft.tag,
        holder: draft.holder,
        initials: draft.initials,
        color: draft.color,
        includeInCashTotal: draft.includeInCashTotal,
      })
      // O `userId` na condicao nao e' decorativo: sem ele, um id vindo do
      // formulario alcancaria a linha de outro usuario.
      .where(and(eq(accounts.id, id), eq(accounts.userId, ctx.userId)))
      .returning({ id: accounts.id })
  );
  if (alteradas.length === 0) throw new RegistryError("name", "Conta não encontrada.");
}

export async function deleteAccount(ctx: AppContext, id: string): Promise<void> {
  // O `cascade` das chaves estrangeiras leva lancamentos, regras e cobrancas.
  // Nada de soft delete: apagado e' apagado, por decisao do dono.
  await db.delete(accounts).where(and(eq(accounts.id, id), eq(accounts.userId, ctx.userId)));
}

// ── cartoes ──────────────────────────────────────────────────────────────────

export async function listCards(ctx: AppContext): Promise<CardRow[]> {
  return db
    .select()
    .from(creditCards)
    .where(eq(creditCards.userId, ctx.userId))
    .orderBy(asc(creditCards.sortOrder), asc(creditCards.name));
}

export async function createCard(ctx: AppContext, draft: CardDraft): Promise<string> {
  return comNomeUnico("um cartão", async () => {
    const [linha] = await db
      .insert(creditCards)
      .values({
        userId: ctx.userId,
        name: draft.name,
        brand: draft.brand,
        lastFour: draft.lastFour,
        holder: draft.holder,
        limitCents: draft.limitCents,
        closingDay: draft.closingDay,
        dueDay: draft.dueDay,
        color: draft.color,
        sortOrder: await proximaOrdem(creditCards, ctx.userId),
      })
      .returning({ id: creditCards.id });
    if (!linha) throw new RegistryError("name", "Não foi possível criar o cartão.");
    return linha.id;
  });
}

export async function updateCard(ctx: AppContext, id: string, draft: CardDraft): Promise<void> {
  const alterados = await comNomeUnico("um cartão", async () =>
    db
      .update(creditCards)
      .set({
        name: draft.name,
        brand: draft.brand,
        lastFour: draft.lastFour,
        holder: draft.holder,
        limitCents: draft.limitCents,
        closingDay: draft.closingDay,
        dueDay: draft.dueDay,
        color: draft.color,
      })
      .where(and(eq(creditCards.id, id), eq(creditCards.userId, ctx.userId)))
      .returning({ id: creditCards.id })
  );
  if (alterados.length === 0) throw new RegistryError("name", "Cartão não encontrado.");
}

export async function deleteCard(ctx: AppContext, id: string): Promise<void> {
  await db
    .delete(creditCards)
    .where(and(eq(creditCards.id, id), eq(creditCards.userId, ctx.userId)));
}

// ── categorias ───────────────────────────────────────────────────────────────

/**
 * O `kind` vem estreitado para as duas naturezas que o app conhece.
 *
 * O enum do Postgres ainda carrega `investment` — tirar valor de enum e' reescrita
 * de tabela, e nao vale o risco por um valor que ninguem grava mais. A migration
 * apagou as categorias de aporte, e a consulta abaixo filtra o resto: o valor
 * existe no banco e nao existe no app.
 */
export type CategoryRow = Omit<typeof categories.$inferSelect, "kind"> & { kind: CategoryKind };

export async function listCategories(ctx: AppContext): Promise<CategoryRow[]> {
  const linhas = await db
    .select()
    .from(categories)
    .where(and(eq(categories.userId, ctx.userId), inArray(categories.kind, [...CATEGORY_KINDS])))
    .orderBy(asc(categories.sortOrder), asc(categories.name));
  return linhas as CategoryRow[];
}

export async function createCategory(ctx: AppContext, draft: CategoryDraft): Promise<string> {
  return comNomeUnico("uma categoria", async () => {
    const [linha] = await db
      .insert(categories)
      .values({
        userId: ctx.userId,
        name: draft.name,
        kind: draft.kind,
        color: draft.color,
        monthlyBudgetCents: draft.monthlyBudgetCents,
        sortOrder: await proximaOrdem(categories, ctx.userId),
      })
      .returning({ id: categories.id });
    if (!linha) throw new RegistryError("name", "Não foi possível criar a categoria.");
    return linha.id;
  });
}

export async function updateCategory(
  ctx: AppContext,
  id: string,
  draft: CategoryDraft
): Promise<void> {
  const alteradas = await comNomeUnico("uma categoria", async () =>
    db
      .update(categories)
      .set({
        name: draft.name,
        kind: draft.kind,
        color: draft.color,
        monthlyBudgetCents: draft.monthlyBudgetCents,
      })
      .where(and(eq(categories.id, id), eq(categories.userId, ctx.userId)))
      .returning({ id: categories.id })
  );
  if (alteradas.length === 0) throw new RegistryError("name", "Categoria não encontrada.");
}

/**
 * Categoria de sistema nao se apaga.
 *
 * `isSystem` marca as que o app depende para classificar receita e aporte —
 * apagar uma delas deixaria acoes inteiras sem destino possivel. A tela nem
 * oferece o botao; esta checagem existe para o caminho que nao passa pela tela.
 */
export async function deleteCategory(ctx: AppContext, id: string): Promise<void> {
  const linha = await db.query.categories.findFirst({
    where: (t, { and: a, eq: e }) => a(e(t.id, id), e(t.userId, ctx.userId)),
  });
  if (!linha) return;
  if (linha.isSystem) {
    throw new RegistryError("name", "Categoria de sistema não pode ser apagada.");
  }
  await db.delete(categories).where(and(eq(categories.id, id), eq(categories.userId, ctx.userId)));
}

export async function categoryImpacts(ctx: AppContext): Promise<Map<string, Impacto>> {
  const [porLancamento, porRegra] = await Promise.all([
    db
      .select({ chave: transactions.categoryId, n: sql<number>`count(*)::int` })
      .from(transactions)
      .where(eq(transactions.userId, ctx.userId))
      .groupBy(transactions.categoryId),
    db
      .select({ chave: recurringRules.categoryId, n: sql<number>`count(*)::int` })
      .from(recurringRules)
      .where(eq(recurringRules.userId, ctx.userId))
      .groupBy(recurringRules.categoryId),
  ]);

  const tx = porChave(porLancamento);
  const rr = porChave(porRegra);

  const saida = new Map<string, Impacto>();
  for (const id of new Set([...tx.keys(), ...rr.keys()])) {
    saida.set(id, {
      lancamentos: tx.get(id) ?? 0,
      regras: rr.get(id) ?? 0,
      faturas: 0,
    });
  }
  return saida;
}

// ── contas fixas e assinaturas ───────────────────────────────────────────────

export type RecurringRow = typeof recurringRules.$inferSelect;

export async function listRecurring(ctx: AppContext): Promise<RecurringRow[]> {
  return db
    .select()
    .from(recurringRules)
    .where(eq(recurringRules.userId, ctx.userId))
    .orderBy(asc(recurringRules.dueDay), asc(recurringRules.name));
}

/** Campos comuns ao insert e ao update — a unica fonte do mapeamento. */
function recurringValues(draft: RecurringDraft) {
  return {
    kind: draft.kind,
    name: draft.name,
    categoryId: draft.categoryId,
    method: draft.method,
    accountId: draft.accountId,
    cardId: draft.cardId,
    dueDay: draft.dueDay,
    amountCents: draft.amountCents,
    isVariable: draft.isVariable,
    estimatedCents: draft.estimatedCents,
    essential: draft.essential,
    firstRefMonth: `${draft.firstRefMonth}-01`,
    installmentsTotal: draft.installmentsTotal,
  };
}

export async function createRecurring(ctx: AppContext, draft: RecurringDraft): Promise<string> {
  const [linha] = await db
    .insert(recurringRules)
    .values({ userId: ctx.userId, ...recurringValues(draft) })
    .returning({ id: recurringRules.id });
  if (!linha) throw new RegistryError("name", "Não foi possível criar.");
  return linha.id;
}

/**
 * Editar a regra NAO reescreve as ocorrencias ja' geradas.
 *
 * A cobranca de um mes passado guarda o valor que foi cobrado naquele mes;
 * mudar a regra hoje e ver o historico inteiro mudar junto seria reescrever o
 * passado. Meses futuros pegam o valor novo na proxima materializacao.
 */
export async function updateRecurring(
  ctx: AppContext,
  id: string,
  draft: RecurringDraft
): Promise<void> {
  const alteradas = await db
    .update(recurringRules)
    .set({ ...recurringValues(draft), updatedAt: new Date() })
    .where(and(eq(recurringRules.id, id), eq(recurringRules.userId, ctx.userId)))
    .returning({ id: recurringRules.id });
  if (alteradas.length === 0) throw new RegistryError("name", "Regra não encontrada.");
}

export async function deleteRecurring(ctx: AppContext, id: string): Promise<void> {
  await db
    .delete(recurringRules)
    .where(and(eq(recurringRules.id, id), eq(recurringRules.userId, ctx.userId)));
}

export async function recurringImpacts(ctx: AppContext): Promise<Map<string, Impacto>> {
  const linhas = await db
    .select({ chave: scheduledCharges.ruleId, n: sql<number>`count(*)::int` })
    .from(scheduledCharges)
    .where(eq(scheduledCharges.userId, ctx.userId))
    .groupBy(scheduledCharges.ruleId);

  const saida = new Map<string, Impacto>();
  for (const [id, n] of porChave(linhas)) {
    // Cobranca gerada conta como "lancamento" na confirmacao: e' o que o dono
    // ve' sumir das abas do mes.
    saida.set(id, { lancamentos: n, regras: 0, faturas: 0 });
  }
  return saida;
}

// ── o que uma exclusao leva junto ────────────────────────────────────────────

/**
 * Quantos dependentes cada registro tem.
 *
 * Existe para a confirmacao poder mostrar o estrago em numeros em vez de um
 * "tem certeza?" que ninguem le'. Sao consultas AGREGADAS, uma por relacao — nao
 * uma por linha da lista, que faria a tela crescer em N+1 consultas.
 */
export interface Impacto {
  lancamentos: number;
  regras: number;
  /** So' cartao. */
  faturas: number;
}

const VAZIO: Impacto = { lancamentos: 0, regras: 0, faturas: 0 };

/** `[{chave, n}]` -> `Map<chave, n>`, ignorando linhas sem chave. */
function porChave(linhas: Array<{ chave: string | null; n: number }>): Map<string, number> {
  const m = new Map<string, number>();
  for (const { chave, n } of linhas) if (chave) m.set(chave, (m.get(chave) ?? 0) + Number(n));
  return m;
}

export async function accountImpacts(ctx: AppContext): Promise<Map<string, Impacto>> {
  // Cartao nao aparece aqui: ele nao aponta mais para conta nenhuma. O dinheiro
  // e' um so', entao a fatura sai do caixa inteiro e nao de uma conta escolhida.
  const [porConta, porTransferencia, porRegra] = await Promise.all([
    db
      .select({ chave: transactions.accountId, n: sql<number>`count(*)::int` })
      .from(transactions)
      .where(eq(transactions.userId, ctx.userId))
      .groupBy(transactions.accountId),
    // Transferencia referencia DUAS contas: apagar qualquer uma leva o
    // lancamento, entao a ponta de destino conta como dependente tambem.
    db
      .select({ chave: transactions.transferAccountId, n: sql<number>`count(*)::int` })
      .from(transactions)
      .where(eq(transactions.userId, ctx.userId))
      .groupBy(transactions.transferAccountId),
    db
      .select({ chave: recurringRules.accountId, n: sql<number>`count(*)::int` })
      .from(recurringRules)
      .where(eq(recurringRules.userId, ctx.userId))
      .groupBy(recurringRules.accountId),
  ]);

  const tx = porChave(porConta);
  const tr = porChave(porTransferencia);
  const rr = porChave(porRegra);

  const chaves = new Set([...tx.keys(), ...tr.keys(), ...rr.keys()]);
  const saida = new Map<string, Impacto>();
  for (const id of chaves) {
    saida.set(id, {
      lancamentos: (tx.get(id) ?? 0) + (tr.get(id) ?? 0),
      regras: rr.get(id) ?? 0,
      faturas: 0,
    });
  }
  return saida;
}

export async function cardImpacts(ctx: AppContext): Promise<Map<string, Impacto>> {
  const [porCartao, porRegra, porFatura] = await Promise.all([
    db
      .select({ chave: transactions.cardId, n: sql<number>`count(*)::int` })
      .from(transactions)
      .where(eq(transactions.userId, ctx.userId))
      .groupBy(transactions.cardId),
    db
      .select({ chave: recurringRules.cardId, n: sql<number>`count(*)::int` })
      .from(recurringRules)
      .where(eq(recurringRules.userId, ctx.userId))
      .groupBy(recurringRules.cardId),
    db
      .select({ chave: cardStatements.cardId, n: sql<number>`count(*)::int` })
      .from(cardStatements)
      .where(eq(cardStatements.userId, ctx.userId))
      .groupBy(cardStatements.cardId),
  ]);

  const tx = porChave(porCartao);
  const rr = porChave(porRegra);
  const st = porChave(porFatura);

  const chaves = new Set([...tx.keys(), ...rr.keys(), ...st.keys()]);
  const saida = new Map<string, Impacto>();
  for (const id of chaves) {
    saida.set(id, {
      lancamentos: tx.get(id) ?? 0,
      regras: rr.get(id) ?? 0,
      faturas: st.get(id) ?? 0,
    });
  }
  return saida;
}

export { VAZIO as IMPACTO_VAZIO };

/** Titulares ja' usados — alimenta a sugestao do formulario, sem tabela nova. */
export async function listHolders(ctx: AppContext): Promise<string[]> {
  const [contas, cartoes] = await Promise.all([
    db.selectDistinct({ h: accounts.holder }).from(accounts).where(eq(accounts.userId, ctx.userId)),
    db
      .selectDistinct({ h: creditCards.holder })
      .from(creditCards)
      .where(eq(creditCards.userId, ctx.userId)),
  ]);
  const vistos = new Set<string>();
  for (const { h } of [...contas, ...cartoes]) if (h) vistos.add(h);
  return [...vistos].sort((a, b) => a.localeCompare(b, "pt-BR"));
}
