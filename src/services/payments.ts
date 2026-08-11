import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { cardStatements, scheduledCharges, transactions } from "@/db/schema";
import { type Cents, cents } from "@/domain/money";
import type { PlainDate } from "@/domain/period";
import type { AppContext } from "./context";

/**
 * Quitar o que esta' em aberto.
 *
 * E' aqui que "sobra" e "em conta" se encontram: cada pagamento tira um item do
 * pendente E move dinheiro do caixa, na mesma medida. Por isso as duas coisas
 * acontecem na MESMA transacao — se so' uma valesse, os dois numeros do topo
 * discordariam ate' alguem reparar.
 */

export class PaymentError extends Error {}

/** A transacao do drizzle, para funcoes que precisam rodar DENTRO de uma. */
export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Devolve uma cobranca ao aberto. NAO apaga o lancamento — quem chama decide.
 *
 * Existe separado porque duas telas desfazem o mesmo pagamento por caminhos
 * opostos: "Desfazer" na conta a pagar parte da cobranca, e "Excluir" na lista
 * de lancamentos parte do lancamento. Se cada uma escrevesse o proprio update,
 * uma acabaria esquecendo um campo — e o mes ficaria com a conta paga e o
 * dinheiro de volta no caixa ao mesmo tempo.
 */
export async function reopenCharge(tx: DbTx, ctx: AppContext, chargeId: string): Promise<void> {
  await tx
    .update(scheduledCharges)
    .set({ status: "pending", paidOn: null, transactionId: null })
    .where(and(eq(scheduledCharges.id, chargeId), eq(scheduledCharges.userId, ctx.userId)));
}

/**
 * Marca a cobranca como pulada: ela nao aconteceu neste mes.
 *
 * E' o desfazer da cobranca de CARTAO. Ela nunca foi paga sozinha — caiu na
 * fatura e virou lancamento —, entao nao ha' pagamento para reabrir; o que se
 * apaga e' a ocorrencia do mes. `skipped` a tira do total da fatura e, por ser
 * um estado gravado, impede que a proxima materializacao a gere de novo.
 *
 * A regra continua viva: o mes que vem tem a cobranca normalmente.
 */
export async function skipCharge(tx: DbTx, ctx: AppContext, chargeId: string): Promise<void> {
  await tx
    .update(scheduledCharges)
    .set({ status: "skipped", paidOn: null, transactionId: null })
    .where(and(eq(scheduledCharges.id, chargeId), eq(scheduledCharges.userId, ctx.userId)));
}

/**
 * Reabre uma fatura e devolve ao aberto as cobrancas que estavam dentro dela.
 *
 * As duas coisas andam juntas: `payStatement` quitou as cobrancas junto com a
 * fatura, entao desfazer so' a fatura deixaria cada cobranca marcada como paga
 * sem nenhum pagamento por tras.
 */
export async function reopenStatement(
  tx: DbTx,
  ctx: AppContext,
  statementId: string
): Promise<void> {
  await tx
    .update(cardStatements)
    .set({ status: "closed", paidOn: null, paidAmountCents: null, paymentTransactionId: null })
    .where(and(eq(cardStatements.id, statementId), eq(cardStatements.userId, ctx.userId)));

  await tx
    .update(scheduledCharges)
    .set({ status: "pending", paidOn: null })
    .where(
      and(eq(scheduledCharges.statementId, statementId), eq(scheduledCharges.userId, ctx.userId))
    );
}

// ── conta a pagar ────────────────────────────────────────────────────────────

/**
 * Marca uma cobranca como paga e registra a saida de caixa.
 *
 * Cobranca que cai em FATURA nao passa por aqui: ela e' quitada quando a fatura
 * do cartao e' paga, e deixar marcar as duas coisas separadamente tiraria
 * dinheiro do caixa duas vezes.
 */
export async function payCharge(
  ctx: AppContext,
  chargeId: string,
  paidOn: PlainDate,
  amountCents?: Cents
): Promise<void> {
  await db.transaction(async (tx) => {
    const cobranca = await tx.query.scheduledCharges.findFirst({
      where: (t, { and: a, eq: e }) => a(e(t.id, chargeId), e(t.userId, ctx.userId)),
    });
    if (!cobranca) throw new PaymentError("Cobrança não encontrada.");
    if (cobranca.status === "paid") return; // idempotente: pagar duas vezes e' no-op
    if (cobranca.statementId) {
      throw new PaymentError("Esta cobrança cai na fatura do cartão — pague a fatura.");
    }

    const regra = await tx.query.recurringRules.findFirst({
      where: (t, { and: a, eq: e }) => a(e(t.id, cobranca.ruleId), e(t.userId, ctx.userId)),
    });
    if (!regra) throw new PaymentError("Regra da cobrança não encontrada.");
    if (!regra.accountId) {
      throw new PaymentError("A regra não tem conta de pagamento definida.");
    }

    const valor = amountCents ?? cents(cobranca.amountCents);

    const [lancamento] = await tx
      .insert(transactions)
      .values({
        userId: ctx.userId,
        kind: "expense",
        occurredOn: paidOn,
        // Competencia e' o mes DA COBRANCA, nao o dia do pagamento: pagar o
        // aluguel de agosto em setembro continua sendo despesa de agosto.
        competenceMonth: cobranca.refMonth,
        description: regra.name,
        amountCents: valor,
        categoryId: regra.categoryId,
        method: regra.method,
        accountId: regra.accountId,
        settledOn: paidOn,
        source: "recurring",
      })
      .returning({ id: transactions.id });
    if (!lancamento) throw new PaymentError("Não foi possível registrar o pagamento.");

    await tx
      .update(scheduledCharges)
      .set({
        status: "paid",
        paidOn,
        amountCents: valor,
        amountOverridden: amountCents != null || cobranca.amountOverridden,
        transactionId: lancamento.id,
      })
      .where(eq(scheduledCharges.id, chargeId));
  });
}

/** Desfaz o pagamento: apaga o lancamento gerado e devolve a cobranca ao aberto. */
export async function unpayCharge(ctx: AppContext, chargeId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const cobranca = await tx.query.scheduledCharges.findFirst({
      where: (t, { and: a, eq: e }) => a(e(t.id, chargeId), e(t.userId, ctx.userId)),
    });
    if (cobranca?.status !== "paid") return;
    /*
     * Cobranca de fatura nao passa por aqui, pelo mesmo motivo de `payCharge` —
     * e agora com um estrago maior: ela esta' paga porque a FATURA foi paga, e o
     * `transaction_id` dela aponta para o lancamento da assinatura, nao para
     * nenhum pagamento. Apagar aquilo tiraria a compra da fatura ja' quitada.
     */
    if (cobranca.statementId) {
      throw new PaymentError("Esta cobrança foi paga com a fatura — reabra a fatura.");
    }

    await reopenCharge(tx, ctx, chargeId);

    if (cobranca.transactionId) {
      await tx
        .delete(transactions)
        .where(
          and(eq(transactions.id, cobranca.transactionId), eq(transactions.userId, ctx.userId))
        );
    }
  });
}

/**
 * Corrige o valor do mes sem pagar.
 *
 * E' o caso da conta de luz: a regra guarda uma estimativa, e o valor real so'
 * aparece quando a fatura chega. `amountOverridden` impede que a proxima
 * abertura do mes sobrescreva o que foi digitado.
 */
export async function setChargeAmount(
  ctx: AppContext,
  chargeId: string,
  amountCents: Cents
): Promise<void> {
  if (amountCents < 0) throw new PaymentError("Valor não pode ser negativo.");

  await db.transaction(async (tx) => {
    const [cobranca] = await tx
      .update(scheduledCharges)
      .set({ amountCents, amountOverridden: true })
      .where(and(eq(scheduledCharges.id, chargeId), eq(scheduledCharges.userId, ctx.userId)))
      .returning({ transactionId: scheduledCharges.transactionId });

    // A cobranca que ja' virou lancamento tem o valor em dois lugares. Corrigir
    // so' um faria a aba de assinaturas e a fatura discordarem — e e' a fatura
    // que manda no que vai ser debitado.
    if (cobranca?.transactionId) {
      await tx
        .update(transactions)
        .set({ amountCents, updatedAt: new Date() })
        .where(
          and(eq(transactions.id, cobranca.transactionId), eq(transactions.userId, ctx.userId))
        );
    }
  });
}

// ── fatura ───────────────────────────────────────────────────────────────────

/**
 * Quanto a fatura soma hoje: compras avulsas mais cobrancas ligadas a ela.
 *
 * O proprio pagamento fica de fora. Ele e' gravado como `transfer` COM
 * `statement_id` — e' o que distingue "paguei a fatura" de "transferi entre
 * contas" —, entao sem o filtro por `source` ele entraria na soma e reabrir e
 * pagar de novo cobraria o dobro. A mesma exclusao vale em `services/cards`;
 * as duas somas precisam devolver o mesmo numero, senao a tela promete um valor
 * e o botao debita outro.
 */
export async function statementTotal(ctx: AppContext, statementId: string): Promise<Cents> {
  const { rows } = await db.execute<{ total: string }>(sql`
    select (
      coalesce((select sum(case when is_refund then -amount_cents else amount_cents end)
                  from transactions
                 where statement_id = ${statementId} and user_id = ${ctx.userId}
                   and source <> 'card_payment'), 0)
      + coalesce((select sum(amount_cents) from scheduled_charges
                   where statement_id = ${statementId} and user_id = ${ctx.userId}
                     and status <> 'skipped'
                     -- A que ja' caiu virou lancamento e entrou na soma acima.
                     and transaction_id is null), 0)
    )::text as total
  `);
  return cents(Number(rows[0]?.total ?? 0));
}

/**
 * Paga a fatura: um unico movimento de caixa, e todas as cobrancas dentro dela
 * passam a pagas.
 *
 * O lancamento e' `transfer` com `statement_id` — e' assim que o modelo
 * distingue "paguei a fatura" de "transferi entre minhas contas": a segunda tem
 * conta de destino, esta nao.
 *
 * Nao pergunta de qual conta sai. O dinheiro e' um so': a conta registra ONDE
 * ele entrou, e o caixa do mes soma todas. Escolher uma na hora de pagar seria
 * cerimonia que nao muda nenhum numero da tela.
 */
export async function payStatement(
  ctx: AppContext,
  statementId: string,
  paidOn: PlainDate,
  amountCents?: Cents
): Promise<void> {
  const valor = amountCents ?? (await statementTotal(ctx, statementId));

  await db.transaction(async (tx) => {
    const fatura = await tx.query.cardStatements.findFirst({
      where: (t, { and: a, eq: e }) => a(e(t.id, statementId), e(t.userId, ctx.userId)),
    });
    if (!fatura) throw new PaymentError("Fatura não encontrada.");
    if (fatura.status === "paid") return;

    // `account_id` e' NOT NULL no lancamento — precisa de uma conta qualquer que
    // conte no caixa, so' para o movimento existir.
    const conta = await tx.query.accounts.findFirst({
      where: (t, { and: a, eq: e }) => a(e(t.userId, ctx.userId), e(t.includeInCashTotal, true)),
    });
    if (!conta) throw new PaymentError("Cadastre uma conta antes de pagar a fatura.");

    const [lancamento] = await tx
      .insert(transactions)
      .values({
        userId: ctx.userId,
        kind: "transfer",
        occurredOn: paidOn,
        competenceMonth: fatura.refMonth,
        description: "Pagamento de fatura",
        amountCents: valor,
        // `tx_category_ck`: transferencia NAO tem categoria.
        categoryId: null,
        method: "transfer",
        accountId: conta.id,
        statementId,
        settledOn: paidOn,
        source: "card_payment",
      })
      .returning({ id: transactions.id });
    if (!lancamento) throw new PaymentError("Não foi possível registrar o pagamento.");

    await tx
      .update(cardStatements)
      .set({
        status: "paid",
        paidOn,
        paidAmountCents: valor,
        paymentTransactionId: lancamento.id,
      })
      .where(eq(cardStatements.id, statementId));

    // As cobrancas dentro da fatura foram quitadas junto — marcar uma a uma
    // seria pedir ao dono que repetisse o que ele acabou de fazer.
    await tx
      .update(scheduledCharges)
      .set({ status: "paid", paidOn })
      .where(
        and(
          eq(scheduledCharges.statementId, statementId),
          eq(scheduledCharges.userId, ctx.userId),
          eq(scheduledCharges.status, "pending")
        )
      );
  });
}

/** Reabre a fatura: apaga o pagamento e devolve as cobrancas ao aberto. */
export async function unpayStatement(ctx: AppContext, statementId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const fatura = await tx.query.cardStatements.findFirst({
      where: (t, { and: a, eq: e }) => a(e(t.id, statementId), e(t.userId, ctx.userId)),
    });
    if (fatura?.status !== "paid") return;

    await reopenStatement(tx, ctx, statementId);

    if (fatura.paymentTransactionId) {
      await tx
        .delete(transactions)
        .where(
          and(eq(transactions.id, fatura.paymentTransactionId), eq(transactions.userId, ctx.userId))
        );
    }
  });
}
