import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db/client";
import { investmentSectors, transactions } from "@/db/schema";
import { type Cents, cents } from "@/domain/money";
import { firstDayOf, type PlainDate, plainDate, type RefMonth } from "@/domain/period";
import { RegistryError } from "@/domain/registry";
import {
  allocate,
  type AnnualProgress,
  annualProgress,
  type SectorProgress,
  sectorProgress,
  sharesAreValid,
} from "@/domain/sectors";
import { getCashView } from "./cash";
import type { AppContext } from "./context";

/**
 * Setores de investimento.
 *
 * Dinheiro entra aqui por um caminho so': um lancamento de aporte apontando para
 * o setor. Nao ha' tabela de contribuicao — o acumulado E' a soma dos
 * lancamentos, e por isso corrigir um aporte na lista corrige o setor junto.
 *
 * A fatia da sobra e' SUGESTAO. O app calcula quanto o mes destinaria a cada
 * setor e mostra o numero; quem aporta e' o dono, lancando. Repartir sozinho
 * gravava dinheiro que ninguem tinha mandado sair.
 *
 * Aqui nada zera na virada do mes: o envelope mensal vale para o caixa, e o
 * investido e' justamente o que saiu dele para nao voltar.
 */

export type SectorRow = typeof investmentSectors.$inferSelect;

export interface SectorView extends SectorProgress {
  id: string;
  name: string;
  color: string;
  sharePercent: number;
  isEmergencyFund: boolean;
  targetDate: PlainDate | null;
  /** Quanto ESTE mes destinaria a ele, pela fatia. Indicacao, nao aporte. */
  suggestedCents: Cents;
  /** Quanto ja' entrou neste mes, de verdade. */
  thisMonthCents: Cents;
  /** Objetivo do ano e quanto dele ja' foi cumprido. */
  annual: AnnualProgress;
}

export interface SectorsView {
  sectors: SectorView[];
  /** Soma das fatias. Acima de 100 o app recusa gravar. */
  totalSharePercent: number;
  /** A sobra do mes — a base do calculo da sugestao. */
  leftoverCents: Cents;
  /** Parte da sobra que NAO tem destino sugerido: 100 − fatias. */
  unallocatedCents: Cents;
  /** Aportado neste mes, somando todos os setores. */
  contributedCents: Cents;
  /** Aportado no ano corrente, somando todos os setores. */
  investedThisYearCents: Cents;
  /** Soma das metas anuais dos setores que tem uma. */
  annualTargetCents: Cents;
  year: number;
}

export async function listSectors(ctx: AppContext): Promise<SectorRow[]> {
  return db
    .select()
    .from(investmentSectors)
    .where(eq(investmentSectors.userId, ctx.userId))
    .orderBy(asc(investmentSectors.sortOrder), asc(investmentSectors.name));
}

/**
 * Aportes por setor: total de sempre, do ano e do mes, numa consulta so'.
 *
 * Tres passagens pela mesma tabela seriam tres viagens ao banco para responder
 * a mesma pergunta em recortes diferentes de data.
 */
async function aportesPorSetor(
  ctx: AppContext,
  month: RefMonth,
  year: number
): Promise<Map<string, { total: Cents; ano: Cents; mes: Cents }>> {
  const linhas = await db
    .select({
      sectorId: transactions.sectorId,
      total: sql<string>`coalesce(sum(${transactions.amountCents}), 0)::text`,
      ano: sql<string>`coalesce(sum(${transactions.amountCents})
        filter (where extract(year from ${transactions.competenceMonth}) = ${year}), 0)::text`,
      mes: sql<string>`coalesce(sum(${transactions.amountCents})
        filter (where ${transactions.competenceMonth} = ${firstDayOf(month)}), 0)::text`,
    })
    .from(transactions)
    .where(and(eq(transactions.userId, ctx.userId), eq(transactions.kind, "investment_out")))
    .groupBy(transactions.sectorId);

  const mapa = new Map<string, { total: Cents; ano: Cents; mes: Cents }>();
  for (const l of linhas) {
    if (!l.sectorId) continue;
    mapa.set(l.sectorId, {
      total: cents(Number(l.total)),
      ano: cents(Number(l.ano)),
      mes: cents(Number(l.mes)),
    });
  }
  return mapa;
}

export const getSectors = cache(async (ctx: AppContext, month: RefMonth): Promise<SectorsView> => {
  const year = Number(month.slice(0, 4));
  const [linhas, aportes, caixa] = await Promise.all([
    listSectors(ctx),
    aportesPorSetor(ctx, month, year),
    getCashView(ctx, month),
  ]);

  // So' sobra POSITIVA vira sugestao: mes no vermelho nao tem o que destinar.
  const sobra = cents(Math.max(0, caixa.leftoverCents));
  const divisao = new Map(
    allocate(
      sobra,
      linhas.map((l) => ({ id: l.id, sharePercent: l.sharePercent }))
    ).map((a) => [a.id, a.amountCents])
  );

  const sectors: SectorView[] = linhas.map((l) => {
    const aporte = aportes.get(l.id) ?? { total: cents(0), ano: cents(0), mes: cents(0) };
    // Reserva de emergencia nao tem meta fixa: sao 6x o custo de vida, que muda
    // a cada mes lancado. As outras usam a meta digitada.
    const meta = l.isEmergencyFund ? caixa.emergencyTargetCents : cents(l.targetCents ?? 0);
    const progresso = sectorProgress(
      aporte.total,
      meta,
      ctx.today,
      l.targetDate ? plainDate(l.targetDate) : null
    );
    return {
      ...progresso,
      id: l.id,
      name: l.name,
      color: l.color,
      sharePercent: l.sharePercent,
      isEmergencyFund: l.isEmergencyFund,
      targetDate: l.targetDate ? plainDate(l.targetDate) : null,
      suggestedCents: divisao.get(l.id) ?? cents(0),
      thisMonthCents: aporte.mes,
      annual: annualProgress(aporte.ano, cents(l.annualTargetCents ?? 0)),
    };
  });

  const totalShare = linhas.reduce<number>((a, l) => a + l.sharePercent, 0);
  const soma = (f: (s: SectorView) => number) => cents(sectors.reduce<number>((a, s) => a + f(s), 0));

  return {
    sectors,
    totalSharePercent: totalShare,
    leftoverCents: sobra,
    unallocatedCents: cents(Math.max(0, sobra - Math.floor((sobra * totalShare) / 100))),
    contributedCents: soma((s) => s.thisMonthCents),
    investedThisYearCents: soma((s) => s.annual.investedCents),
    annualTargetCents: soma((s) => s.annual.targetCents),
    year,
  };
});

// ── escrita ──────────────────────────────────────────────────────────────────

export interface SectorDraft {
  name: string;
  color: string;
  sharePercent: number;
  targetCents: Cents | null;
  annualTargetCents: Cents | null;
  targetDate: PlainDate | null;
  isEmergencyFund: boolean;
}

/**
 * As fatias nao podem passar de 100% somadas.
 *
 * Checado ANTES de gravar, considerando o setor que esta' sendo editado — senao
 * editar um setor de 40% para 45% compararia 40 + 45 e recusaria sem motivo.
 */
async function assertShares(ctx: AppContext, draft: SectorDraft, ignorarId?: string) {
  const atuais = await listSectors(ctx);
  const outros = atuais
    .filter((s) => s.id !== ignorarId)
    .map((s) => ({ id: s.id, sharePercent: s.sharePercent }));
  if (!sharesAreValid([...outros, { id: "novo", sharePercent: draft.sharePercent }])) {
    throw new RegistryError("sharePercent", "As fatias somadas passariam de 100%.");
  }
}

export async function createSector(ctx: AppContext, draft: SectorDraft): Promise<void> {
  await assertShares(ctx, draft);
  await db.insert(investmentSectors).values({
    userId: ctx.userId,
    name: draft.name,
    color: draft.color,
    sharePercent: draft.sharePercent,
    targetCents: draft.isEmergencyFund ? null : draft.targetCents,
    annualTargetCents: draft.annualTargetCents,
    targetDate: draft.targetDate,
    isEmergencyFund: draft.isEmergencyFund,
  });
}

export async function updateSector(ctx: AppContext, id: string, draft: SectorDraft): Promise<void> {
  await assertShares(ctx, draft, id);
  const alterados = await db
    .update(investmentSectors)
    .set({
      name: draft.name,
      color: draft.color,
      sharePercent: draft.sharePercent,
      targetCents: draft.isEmergencyFund ? null : draft.targetCents,
      annualTargetCents: draft.annualTargetCents,
      targetDate: draft.targetDate,
      isEmergencyFund: draft.isEmergencyFund,
    })
    .where(and(eq(investmentSectors.id, id), eq(investmentSectors.userId, ctx.userId)))
    .returning({ id: investmentSectors.id });
  if (alterados.length === 0) throw new RegistryError("name", "Setor não encontrado.");
}

/**
 * Apaga o setor — e os aportes vao junto, por `cascade`.
 *
 * E' a mesma regra dos outros cadastros: exclusao e' definitiva. Aqui o preco e'
 * alto, entao a tela conta quantos aportes somem antes de deixar seguir.
 */
export async function deleteSector(ctx: AppContext, id: string): Promise<void> {
  await db
    .delete(investmentSectors)
    .where(and(eq(investmentSectors.id, id), eq(investmentSectors.userId, ctx.userId)));
}

/** Quantos aportes cada setor levaria junto se fosse apagado. */
export async function sectorImpacts(ctx: AppContext): Promise<Map<string, number>> {
  const linhas = await db
    .select({ sectorId: transactions.sectorId, n: sql<number>`count(*)::int` })
    .from(transactions)
    .where(and(eq(transactions.userId, ctx.userId), eq(transactions.kind, "investment_out")))
    .groupBy(transactions.sectorId);

  const mapa = new Map<string, number>();
  for (const l of linhas) if (l.sectorId) mapa.set(l.sectorId, Number(l.n));
  return mapa;
}
