import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  accounts,
  auditLog,
  cardStatements,
  categories,
  creditCards,
  investmentSectors,
  recurringRules,
  scheduledCharges,
  transactions,
} from "@/db/schema";
import { canEdit, type EntryLink } from "@/domain/entry-edit";
import type { Cents } from "@/domain/money";
import { categoryKindOf, type EntryMethod, type EntryType, methodsFor } from "@/domain/new-entry";
import { firstDayOf, monthOf, type PlainDate, plainDate } from "@/domain/period";
import type { AppContext } from "./context";
import { EntryError, statementIdFor } from "./entries";
import { reopenCharge, reopenStatement } from "./payments";

/**
 * Editar e apagar um lancamento ja' gravado.
 *
 * A parte dificil nao e' o UPDATE — e' que metade dos lancamentos nao existe
 * sozinha. Um quita uma conta a pagar, outro paga a fatura inteira de um cartao,
 * outro e' o aporte que alimenta os setores. Apagar a linha e parar por ai'
 * deixaria a conta marcada como paga com o dinheiro de volta no caixa: as chaves
 * estrangeiras sao `set null`, entao o banco NAO reclama de nada.
 *
 * Por isso tudo aqui passa por `EntryLink`: primeiro se descobre o que aponta
 * para o lancamento, depois se desfaz aquilo, e so' entao a linha some.
 */

/** O vinculo mais os ids que o servico precisa para desfaze-lo. */
interface Dependentes {
  link: EntryLink;
  chargeIds: string[];
  statementId: string | null;
}

async function dependentesDe(
  ctx: AppContext,
  row: { id: string; kind: string; competenceMonth: string }
): Promise<Dependentes> {
  const cobrancas = await db
    .select({ id: scheduledCharges.id, nome: recurringRules.name })
    .from(scheduledCharges)
    .innerJoin(recurringRules, eq(recurringRules.id, scheduledCharges.ruleId))
    .where(
      and(eq(scheduledCharges.transactionId, row.id), eq(scheduledCharges.userId, ctx.userId))
    );

  const primeira = cobrancas[0];
  if (primeira) {
    return {
      link: { kind: "charge", label: primeira.nome },
      chargeIds: cobrancas.map((c) => c.id),
      statementId: null,
    };
  }

  const faturas = await db
    .select({ id: cardStatements.id, nome: creditCards.name })
    .from(cardStatements)
    .innerJoin(creditCards, eq(creditCards.id, cardStatements.cardId))
    .where(
      and(eq(cardStatements.paymentTransactionId, row.id), eq(cardStatements.userId, ctx.userId))
    );

  const fatura = faturas[0];
  if (fatura) {
    const [dentro] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(scheduledCharges)
      .where(
        and(eq(scheduledCharges.statementId, fatura.id), eq(scheduledCharges.userId, ctx.userId))
      );
    return {
      link: { kind: "statement", label: fatura.nome, charges: Number(dentro?.n ?? 0) },
      chargeIds: [],
      statementId: fatura.id,
    };
  }

  /*
   * Aporte nao aparece mais aqui.
   *
   * Ele era um vinculo porque o valor vivia em dois lugares — o lancamento e a
   * tabela de contribuicoes — e editar um deles desencontrava os dois. Hoje o
   * aporte APONTA para o setor e nao ha' segunda copia: e' linha solta como
   * qualquer outra, e editar o valor corrige o setor no mesmo ato.
   */
  return { link: { kind: "none" }, chargeIds: [], statementId: null };
}

export interface EntryForEdit {
  id: string;
  description: string;
  amountCents: Cents;
  occurredOn: PlainDate;
  categoryId: string | null;
  sectorId: string | null;
  method: string;
  accountId: string | null;
  cardId: string | null;
  kind: string;
  link: EntryLink;
}

export async function getEntryForEdit(ctx: AppContext, id: string): Promise<EntryForEdit | null> {
  const row = await db.query.transactions.findFirst({
    where: and(eq(transactions.id, id), eq(transactions.userId, ctx.userId)),
  });
  if (!row) return null;

  const { link } = await dependentesDe(ctx, row);
  return {
    id: row.id,
    description: row.description,
    amountCents: row.amountCents as Cents,
    occurredOn: plainDate(row.occurredOn),
    categoryId: row.categoryId,
    sectorId: row.sectorId,
    method: row.method,
    accountId: row.accountId,
    cardId: row.cardId,
    kind: row.kind,
    link,
  };
}

export interface UpdateEntryCommand {
  description: string;
  amountCents: Cents;
  occurredOn: PlainDate;
  categoryId: string | null;
  /** So' aporte. Ocupa o lugar da categoria. */
  sectorId: string | null;
  method: EntryMethod;
  accountId: string | null;
  cardId: string | null;
}

/** `expense` -> `despesa`, para reaproveitar as regras de `domain/new-entry`. */
function typeOfKind(kind: string): EntryType | null {
  if (kind === "expense") return "despesa";
  if (kind === "income") return "receita";
  if (kind === "investment_out") return "aporte";
  return null;
}

export async function updateEntry(
  ctx: AppContext,
  id: string,
  cmd: UpdateEntryCommand
): Promise<void> {
  const original = await db.query.transactions.findFirst({
    where: and(eq(transactions.id, id), eq(transactions.userId, ctx.userId)),
  });
  if (!original) throw new EntryError("id", "Lançamento não encontrado.");

  const { link, statementId: faturaId } = await dependentesDe(ctx, original);

  // O escopo NAO vem da tela. Esconder o campo no formulario evita o engano;
  // ignorar o valor aqui barra o POST fabricado — sao dois problemas diferentes,
  // e so' o segundo protege os numeros.
  const valor = canEdit(link, "amount") ? cmd.amountCents : (original.amountCents as Cents);
  const trocaDestinoLogico = canEdit(link, "category");
  const categoriaId = trocaDestinoLogico ? cmd.categoryId : original.categoryId;
  // Aporte usa setor no lugar de categoria: o CHECK do banco exige um dos dois,
  // nunca os dois. Trocar o setor e' a mesma acao de trocar a categoria.
  const setorId = trocaDestinoLogico ? cmd.sectorId : original.sectorId;
  const trocaDestino = canEdit(link, "target");
  const contaId = trocaDestino ? cmd.accountId : original.accountId;
  const cartaoId = trocaDestino ? cmd.cardId : original.cardId;
  const metodo = trocaDestino ? cmd.method : (original.method as EntryMethod);

  const onCredit = cartaoId != null;
  if (onCredit !== (metodo === "credit")) {
    throw new EntryError(
      "target",
      "Cartão de crédito exige o meio “Crédito”; os demais meios saem de uma conta."
    );
  }

  const tipo = typeOfKind(original.kind);
  if (tipo && !methodsFor(tipo).includes(metodo)) {
    throw new EntryError("method", "Este meio de pagamento não vale para este lançamento.");
  }

  // ── posse: nada entra sem pertencer a este usuario ─────────────────────────
  if (categoriaId) {
    const cat = await db.query.categories.findFirst({
      where: and(eq(categories.id, categoriaId), eq(categories.userId, ctx.userId)),
    });
    if (!cat) throw new EntryError("categoryId", "Categoria não encontrada.");
    if (tipo && cat.kind !== categoryKindOf(tipo)) {
      throw new EntryError("categoryId", "Esta categoria não vale para este tipo de lançamento.");
    }
  }
  if (setorId) {
    const setor = await db.query.investmentSectors.findFirst({
      where: and(eq(investmentSectors.id, setorId), eq(investmentSectors.userId, ctx.userId)),
    });
    if (!setor) throw new EntryError("sectorId", "Setor não encontrado.");
  }
  if (contaId) {
    const conta = await db.query.accounts.findFirst({
      where: and(eq(accounts.id, contaId), eq(accounts.userId, ctx.userId)),
    });
    if (!conta) throw new EntryError("target", "Conta não encontrada.");
  }

  let cartao = null;
  if (cartaoId) {
    cartao = await db.query.creditCards.findFirst({
      where: and(eq(creditCards.id, cartaoId), eq(creditCards.userId, ctx.userId)),
    });
    if (!cartao) throw new EntryError("target", "Cartão não encontrado.");
  }

  /*
   * A fatura em que a compra cai so' e' recalculada quando o cartao ou a data
   * mudam. Uma compra que ja' entrou numa fatura fechada nao pode migrar de mes
   * porque alguem corrigiu a descricao — o vinculo foi congelado no insert
   * exatamente para isso.
   */
  const mudouFatura =
    cartaoId !== original.cardId || String(cmd.occurredOn) !== String(original.occurredOn);
  const statementId =
    link.kind === "none" && mudouFatura
      ? cartao
        ? await statementIdFor(ctx, cartao, cmd.occurredOn)
        : null
      : original.statementId;

  /*
   * Competencia: quitacao NAO muda de mes quando a data do pagamento muda.
   * Pagar o aluguel de agosto no dia 3 de setembro continua sendo despesa de
   * agosto — a mesma regra que `payCharge` aplica ao criar o lancamento.
   */
  const competenceMonth =
    link.kind === "none" ? firstDayOf(monthOf(cmd.occurredOn)) : original.competenceMonth;

  await db.transaction(async (tx) => {
    await tx
      .update(transactions)
      .set({
        description: cmd.description,
        amountCents: valor,
        occurredOn: cmd.occurredOn,
        competenceMonth,
        categoryId: categoriaId,
        sectorId: setorId,
        method: metodo,
        accountId: contaId,
        cardId: cartaoId,
        statementId,
        // No credito o dinheiro nao saiu: o que existe e' posicao na fatura.
        settledOn: onCredit ? null : cmd.occurredOn,
        updatedAt: new Date(),
      })
      .where(and(eq(transactions.id, id), eq(transactions.userId, ctx.userId)));

    // O que este lancamento quita tem que contar a MESMA historia: sem isto a
    // conta a pagar seguiria exibindo o valor previsto depois de o pagamento
    // ter sido corrigido para o valor real.
    if (link.kind === "charge") {
      await tx
        .update(scheduledCharges)
        .set({ amountCents: valor, amountOverridden: true, paidOn: cmd.occurredOn })
        .where(
          and(eq(scheduledCharges.transactionId, id), eq(scheduledCharges.userId, ctx.userId))
        );
    }
    if (link.kind === "statement" && faturaId) {
      await tx
        .update(cardStatements)
        .set({ paidAmountCents: valor, paidOn: cmd.occurredOn })
        .where(and(eq(cardStatements.id, faturaId), eq(cardStatements.userId, ctx.userId)));
      await tx
        .update(scheduledCharges)
        .set({ paidOn: cmd.occurredOn })
        .where(
          and(eq(scheduledCharges.statementId, faturaId), eq(scheduledCharges.userId, ctx.userId))
        );
    }

    await tx.insert(auditLog).values({
      userId: ctx.userId,
      action: "update_entry",
      entity: "transaction",
      entityId: id,
      beforeCents: original.amountCents,
      afterCents: valor,
      detail: cmd.description,
    });
  });
}

/**
 * Apaga de vez — e desfaz o que o lancamento quitava.
 *
 * Ordem importa: as cobrancas e a fatura voltam ao aberto ANTES do delete. As
 * chaves sao `set null`, entao apagar primeiro apagaria junto o rastro de qual
 * cobranca precisava ser reaberta, e ela ficaria "paga" para sempre — sem
 * nenhum pagamento por tras e sem erro nenhum no banco.
 */
export async function deleteEntry(ctx: AppContext, id: string): Promise<void> {
  const row = await db.query.transactions.findFirst({
    where: and(eq(transactions.id, id), eq(transactions.userId, ctx.userId)),
  });
  if (!row) throw new EntryError("id", "Lançamento não encontrado.");

  const { chargeIds, statementId } = await dependentesDe(ctx, row);

  await db.transaction(async (tx) => {
    for (const chargeId of chargeIds) await reopenCharge(tx, ctx, chargeId);
    if (statementId) await reopenStatement(tx, ctx, statementId);

    await tx
      .delete(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.userId, ctx.userId)));

    await tx.insert(auditLog).values({
      userId: ctx.userId,
      action: "delete_entry",
      entity: "transaction",
      entityId: id,
      beforeCents: row.amountCents,
      detail: row.description,
    });
  });
}
