import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { materializeMonth } from "@/db/materialize";
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
import { cycleFor } from "@/domain/card-cycle";
import type { Cents } from "@/domain/money";
import {
  allowsInstallments,
  categoryKindOf,
  type EntryMethod,
  type EntryShape,
  type EntryType,
  methodsFor,
  planEntry,
} from "@/domain/new-entry";
import {
  firstDayOf,
  isSameOrBefore,
  type PlainDate,
  type RefMonth,
  refMonth,
} from "@/domain/period";
import type { AppContext } from "./context";

/**
 * Escrita de lancamento — o unico caminho de gravacao do painel.
 *
 * A decisao central esta' em `domain/new-entry`: parcelado e recorrente viram
 * UMA regra com ocorrencias derivadas, nunca N transacoes soltas. O design
 * duplica a mesma obrigacao em ate' tres listas (achado 1 do plano); reproduzir
 * aquilo aqui faria o "Notebook Dell" ser contado tres vezes no mes.
 */

export class EntryError extends Error {
  constructor(
    readonly field: string,
    message: string
  ) {
    super(message);
  }
}

export interface CreateEntryCommand {
  type: EntryType;
  amountCents: Cents;
  description: string;
  /** Despesa e receita. Nulo no aporte, que usa `sectorId`. */
  categoryId: string | null;
  /** So' aporte. Ocupa o lugar da categoria. */
  sectorId: string | null;
  method: EntryMethod;
  /** Exatamente um dos dois. Cartao so' com metodo `credit`. */
  accountId: string | null;
  cardId: string | null;
  occurredOn: PlainDate;
  installments: number;
  repeats: boolean;
}

export interface CreatedEntry {
  shape: EntryShape;
  competenceMonth: RefMonth;
  /** Aba em que o lancamento realmente aparece — para onde mandar o usuario. */
  landingSlug: "lancamentos" | "contas" | "recorrentes";
  /**
   * Mes em que ele aparece, que nem sempre e' o da competencia.
   *
   * Assinatura e parcela no cartao aparecem no mes em que a FATURA vence, e uma
   * cobranca posterior ao fechamento cai na fatura do mes seguinte. Redirecionar
   * para o mes da compra levava o usuario a uma aba onde o que ele acabou de
   * cadastrar nao esta'.
   */
  landingMonth: RefMonth;
  /** A primeira ocorrencia ja' nasceu quitada? */
  settled: boolean;
}

export async function createEntry(ctx: AppContext, cmd: CreateEntryCommand): Promise<CreatedEntry> {
  const onCredit = cmd.cardId != null;

  // ── coerencia do pedido ────────────────────────────────────────────────────
  if (!methodsFor(cmd.type).includes(cmd.method)) {
    throw new EntryError("method", `${cmd.type} não aceita este meio de pagamento.`);
  }
  if (onCredit !== (cmd.method === "credit")) {
    throw new EntryError(
      "target",
      "Cartão de crédito exige o meio “Crédito”; os demais meios saem de uma conta."
    );
  }
  if (cmd.installments > 1 && !allowsInstallments(cmd.type, cmd.method)) {
    throw new EntryError("installments", "Só dá para parcelar em crédito ou boleto.");
  }
  // Sem isto, R$ 0,02 em 3x geraria parcelas de zero — e o CHECK `rules_amount_ck`
  // recusaria a regra depois de o formulario inteiro ter sido preenchido.
  if (cmd.installments > cmd.amountCents) {
    throw new EntryError("installments", "Parcelas demais para este valor.");
  }

  // ── posse: nada entra sem pertencer a este usuario ─────────────────────────
  // Aporte escolhe SETOR; despesa e receita escolhem categoria. Sao o mesmo
  // campo na tela e colunas diferentes no banco, com CHECK exigindo um so'.
  const kindEsperado = categoryKindOf(cmd.type);

  if (kindEsperado === null) {
    if (!cmd.sectorId) throw new EntryError("sectorId", "Escolha o setor do aporte.");
    // Regra recorrente exige categoria (`recurring_rules.category_id` e' NOT
    // NULL) e o aporte nao tem uma. Recusar aqui, com o motivo, e' melhor do que
    // deixar o banco recusar depois com uma mensagem que ninguem le'.
    if (cmd.repeats || cmd.installments > 1) {
      throw new EntryError("repeats", "Aporte não repete nem parcela — lance mês a mês.");
    }
    const setor = await db.query.investmentSectors.findFirst({
      where: and(
        eq(investmentSectors.id, cmd.sectorId),
        eq(investmentSectors.userId, ctx.userId)
      ),
    });
    if (!setor) throw new EntryError("sectorId", "Setor não encontrado.");
  } else {
    if (!cmd.categoryId) throw new EntryError("categoryId", "Escolha uma categoria.");
    const category = await db.query.categories.findFirst({
      where: and(eq(categories.id, cmd.categoryId), eq(categories.userId, ctx.userId)),
    });
    if (!category) throw new EntryError("categoryId", "Categoria não encontrada.");
    if (category.kind !== kindEsperado) {
      throw new EntryError("categoryId", "Esta categoria não vale para este tipo de lançamento.");
    }
  }

  const account = cmd.accountId
    ? await db.query.accounts.findFirst({
        where: and(eq(accounts.id, cmd.accountId), eq(accounts.userId, ctx.userId)),
      })
    : null;
  if (cmd.accountId && !account) throw new EntryError("target", "Conta não encontrada.");

  const card = cmd.cardId
    ? await db.query.creditCards.findFirst({
        where: and(eq(creditCards.id, cmd.cardId), eq(creditCards.userId, ctx.userId)),
      })
    : null;
  if (cmd.cardId && !card) throw new EntryError("target", "Cartão não encontrado.");
  if (!account && !card) throw new EntryError("target", "Escolha a conta ou o cartão.");

  const plan = planEntry({
    type: cmd.type,
    amountCents: cmd.amountCents,
    method: cmd.method,
    onCredit,
    occurredOn: cmd.occurredOn,
    installments: cmd.installments,
    repeats: cmd.repeats,
  });

  if (plan.shape === "transaction") {
    return createSingleTransaction(ctx, cmd, plan, card);
  }
  return createRule(ctx, cmd, plan, card);
}

type Plan = ReturnType<typeof planEntry>;
type Card = Awaited<ReturnType<typeof db.query.creditCards.findFirst>> | null;

/**
 * Resolve — e materializa, se preciso — a fatura em que a compra cai.
 *
 * O vinculo e' GRAVADO na transacao, nao recalculado na leitura: se o dia de
 * fechamento do cartao mudar amanha, a compra de hoje nao pode migrar de fatura
 * retroativamente.
 */
export async function statementIdFor(ctx: AppContext, card: NonNullable<Card>, on: PlainDate) {
  const cycle = cycleFor(
    { closingDay: card.closingDay, dueDay: card.dueDay, bestDayOverride: card.bestDayOverride },
    on
  );
  // Comprar num mes ainda nao aberto na tela e' normal — a fatura precisa existir.
  await materializeMonth(db, { userId: ctx.userId }, cycle.refMonth);

  const row = await db.query.cardStatements.findFirst({
    where: and(
      eq(cardStatements.cardId, card.id),
      eq(cardStatements.refMonth, firstDayOf(cycle.refMonth))
    ),
  });
  return row?.id ?? null;
}

async function createSingleTransaction(
  ctx: AppContext,
  cmd: CreateEntryCommand,
  plan: Plan,
  card: Card
): Promise<CreatedEntry> {
  const statementId = card ? await statementIdFor(ctx, card, cmd.occurredOn) : null;

  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(transactions)
      .values({
        userId: ctx.userId,
        kind: plan.kind,
        occurredOn: cmd.occurredOn,
        competenceMonth: firstDayOf(plan.competenceMonth),
        description: cmd.description,
        amountCents: cmd.amountCents,
        categoryId: cmd.categoryId,
        sectorId: cmd.sectorId,
        method: cmd.method,
        accountId: cmd.accountId,
        cardId: cmd.cardId,
        statementId,
        // No credito o dinheiro nao saiu: o que existe e' posicao na fatura.
        settledOn: plan.settlesOnPurchase ? cmd.occurredOn : null,
      })
      .returning({ id: transactions.id });
    if (!row) throw new Error("falhou ao gravar o lancamento");

    await writeAudit(
      tx,
      ctx,
      "create_entry",
      "transaction",
      row.id,
      cmd.amountCents,
      cmd.description
    );
  });

  return {
    shape: plan.shape,
    competenceMonth: plan.competenceMonth,
    landingSlug: "lancamentos",
    landingMonth: plan.competenceMonth,
    settled: plan.settlesOnPurchase,
  };
}

/**
 * Parcelado ou recorrente: uma regra, e as ocorrencias saem dela.
 *
 * A primeira parcela nasce quitada quando o pagamento ja' aconteceu (meio que
 * nao e' cartao e data que nao esta' no futuro). Sem isso o usuario registraria
 * um aluguel que acabou de pagar e ele apareceria como pendente — e nao ha' como
 * o painel adivinhar depois que aquela ocorrencia especifica ja' foi paga.
 */
async function createRule(
  ctx: AppContext,
  cmd: CreateEntryCommand,
  plan: Plan,
  card: Card
): Promise<CreatedEntry> {
  const firstAmount = plan.schedule[0];
  const repeatingAmount = plan.schedule[plan.schedule.length - 1] ?? firstAmount;
  if (firstAmount === undefined || repeatingAmount === undefined) {
    throw new EntryError("amount", "Valor inválido.");
  }

  const total = plan.shape === "installment-rule" ? plan.schedule.length : null;
  // Ja' pagou? So' faz sentido fora do cartao (no credito quem paga e' a fatura)
  // e para uma data que nao esta' no futuro.
  const settleFirst = !card && isSameOrBefore(cmd.occurredOn, ctx.today);

  // `recurring_rules.category_id` e' NOT NULL. `createEntry` ja' barra aporte
  // antes de chegar aqui; esta linha e' o que faz o tipo dizer a mesma coisa.
  const categoryId = cmd.categoryId;
  if (!categoryId) throw new EntryError("categoryId", "Escolha uma categoria.");

  const [rule] = await db
    .insert(recurringRules)
    .values({
      userId: ctx.userId,
      kind: card ? "subscription" : "bill",
      name: cmd.description,
      categoryId,
      method: cmd.method,
      accountId: cmd.accountId,
      cardId: cmd.cardId,
      dueDay: plan.dueDay,
      amountCents: repeatingAmount,
      firstRefMonth: firstDayOf(plan.firstRefMonth),
      installmentsTotal: total,
    })
    .returning({ id: recurringRules.id });
  if (!rule) throw new Error("falhou ao gravar a regra");

  // Cria a ocorrencia do primeiro mes usando o MESMO codigo da aplicacao — nada
  // de uma segunda implementacao da geracao aqui dentro.
  await materializeMonth(db, { userId: ctx.userId }, plan.firstRefMonth);

  const charge = await db.query.scheduledCharges.findFirst({
    where: and(
      eq(scheduledCharges.ruleId, rule.id),
      eq(scheduledCharges.refMonth, firstDayOf(plan.firstRefMonth))
    ),
  });

  await db.transaction(async (tx) => {
    let transactionId: string | null = null;

    if (settleFirst) {
      const [row] = await tx
        .insert(transactions)
        .values({
          userId: ctx.userId,
          kind: plan.kind,
          occurredOn: cmd.occurredOn,
          competenceMonth: firstDayOf(plan.competenceMonth),
          description: cmd.description,
          amountCents: firstAmount,
          categoryId,
          sectorId: null,
          method: cmd.method,
          accountId: cmd.accountId,
          cardId: null,
          settledOn: cmd.occurredOn,
          installmentSeq: total != null ? 1 : null,
          installmentTotal: total,
          source: "recurring",
        })
        .returning({ id: transactions.id });
      transactionId = row?.id ?? null;
    }

    if (charge) {
      await tx
        .update(scheduledCharges)
        .set({
          // O resto da divisao vai para a primeira parcela. `amountOverridden`
          // impede que a proxima abertura do mes devolva o valor base da regra.
          amountCents: firstAmount,
          amountOverridden: firstAmount !== repeatingAmount,
          ...(transactionId
            ? { status: "paid" as const, paidOn: cmd.occurredOn, transactionId }
            : {}),
        })
        .where(eq(scheduledCharges.id, charge.id));
    }

    await writeAudit(
      tx,
      ctx,
      "create_entry",
      "recurring_rule",
      rule.id,
      cmd.amountCents,
      `${cmd.description} · ${plan.shape}`
    );
  });

  /*
   * Onde a primeira cobranca foi parar.
   *
   * A aba de assinaturas lista por FATURA, e a cobranca de hoje pode pertencer a'
   * fatura do mes que vem — e' o caso de qualquer cobranca posterior ao
   * fechamento. Ler o mes da fatura ligada, em vez de recalcular, garante que o
   * redirect aponte para a mesma fatura que a materializacao escolheu.
   */
  let landingMonth = plan.competenceMonth;
  if (!settleFirst && card && charge?.statementId) {
    const statement = await db.query.cardStatements.findFirst({
      where: eq(cardStatements.id, charge.statementId),
    });
    if (statement) landingMonth = refMonth(statement.refMonth.slice(0, 7));
  }

  return {
    shape: plan.shape,
    competenceMonth: plan.competenceMonth,
    landingSlug: settleFirst ? "lancamentos" : card ? "recorrentes" : "contas",
    landingMonth,
    settled: settleFirst,
  };
}

/**
 * Trilha de auditoria.
 *
 * O plano Hobby da Vercel guarda log de runtime por uma hora — um valor errado
 * percebido no dia seguinte seria indebugavel. Gravar no proprio Postgres custa
 * uma linha e resolve.
 */
async function writeAudit(
  tx: Pick<typeof db, "insert">,
  ctx: AppContext,
  action: string,
  entity: string,
  entityId: string,
  afterCents: number,
  detail: string
) {
  await tx.insert(auditLog).values({
    userId: ctx.userId,
    action,
    entity,
    entityId,
    afterCents,
    detail,
  });
}
