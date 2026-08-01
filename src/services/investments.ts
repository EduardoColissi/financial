import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { allocation, goalProgress, monthsOfRunway } from "@/domain/investments";
import { type Cents, cents } from "@/domain/money";
import { addMonths, firstDayOf, type RefMonth } from "@/domain/period";
import type { AppContext } from "./context";
import { ensureMonthMaterialized } from "./materialize";

/**
 * Carteira.
 *
 * Tudo aqui e' reconstruido a partir de `investment_valuations` (valor de
 * mercado por mes) e `investment_flows` (movimentos). O design guarda
 * `saldo`/`mes`/`prov` como colunas do ativo, o que so' descreve o mes atual —
 * navegar para julho mostraria os numeros de agosto.
 */

export interface AssetRow {
  id: string;
  name: string;
  detail: string | null;
  segmentName: string;
  color: string;
  investedCents: Cents;
  valueCents: Cents;
  monthReturnCents: Cents;
  monthReturnPercent: number;
  gainCents: Cents;
  gainPercent: number;
  dividendCents: Cents;
  weightPercent: number;
}

export interface SegmentRow {
  id: string;
  name: string;
  color: string;
  assetCount: number;
  valueCents: Cents;
  investedCents: Cents;
  monthReturnCents: Cents;
  currentPercent: number;
  targetPercent: number | null;
  deviationPP: number;
  onTarget: boolean;
}

export interface GoalRow {
  id: string;
  name: string;
  color: string;
  currentCents: Cents;
  targetCents: Cents;
  percent: number;
  reached: boolean;
  deadlineLabel: string | null;
}

export interface InvestmentsResult {
  totalCents: Cents;
  investedCents: Cents;
  gainCents: Cents;
  gainPercent: number;
  monthReturnCents: Cents;
  monthReturnPercent: number;
  dividendCents: Cents;
  contributionCents: Cents;
  runwayMonths: number;
  segments: SegmentRow[];
  assets: AssetRow[];
  goals: GoalRow[];
}

export async function getInvestments(
  ctx: AppContext,
  month: RefMonth,
  monthlyExpenseCents: Cents
): Promise<InvestmentsResult> {
  await ensureMonthMaterialized(ctx, month);
  const ref = firstDayOf(month);
  const prev = firstDayOf(addMonths(month, -1));

  const { rows } = await db.execute<{
    id: string;
    name: string;
    detail: string | null;
    seg_id: string;
    seg_name: string;
    seg_color: string;
    target: string | null;
    value_cents: string;
    prev_cents: string;
    invested_cents: string;
    withdrawn_cents: string;
    contributed_month: string;
    withdrawn_month: string;
    dividend_month: string;
  }>(sql`
    select a.id, a.name, a.detail,
           sg.id as seg_id, sg.name as seg_name, sg.color as seg_color,
           sg.target_percent::text as target,
           coalesce(v.market_value_cents, 0)::text as value_cents,
           coalesce(pv.market_value_cents, 0)::text as prev_cents,
           coalesce((select sum(f.amount_cents) from investment_flows f
                      where f.asset_id = a.id and f.kind = 'contribution'), 0)::text as invested_cents,
           coalesce((select sum(f.amount_cents) from investment_flows f
                      where f.asset_id = a.id and f.kind = 'withdrawal'), 0)::text as withdrawn_cents,
           coalesce((select sum(f.amount_cents) from investment_flows f
                      where f.asset_id = a.id and f.kind = 'contribution' and f.ref_month = ${ref}), 0)::text as contributed_month,
           coalesce((select sum(f.amount_cents) from investment_flows f
                      where f.asset_id = a.id and f.kind = 'withdrawal' and f.ref_month = ${ref}), 0)::text as withdrawn_month,
           coalesce((select sum(f.amount_cents) from investment_flows f
                      where f.asset_id = a.id and f.kind = 'dividend' and f.ref_month = ${ref}), 0)::text as dividend_month
      from investment_assets a
      join investment_segments sg on sg.id = a.segment_id
      left join investment_valuations v  on v.asset_id = a.id and v.ref_month = ${ref}
      left join investment_valuations pv on pv.asset_id = a.id and pv.ref_month = ${prev}
     where a.user_id = ${ctx.userId} and a.archived_at is null
     order by sg.sort_order, a.sort_order
  `);

  const total = rows.reduce<number>((acc, r) => acc + Number(r.value_cents), 0);

  const assets: AssetRow[] = rows.map((r) => {
    const value = Number(r.value_cents);
    const prevValue = Number(r.prev_cents);
    const invested = Number(r.invested_cents) - Number(r.withdrawn_cents);
    // Regra C1: variacao de valor descontando aporte e somando resgate.
    const monthReturn =
      prevValue > 0
        ? value - prevValue - Number(r.contributed_month) + Number(r.withdrawn_month)
        : 0;

    return {
      id: r.id,
      name: r.name,
      detail: r.detail,
      segmentName: r.seg_name,
      color: r.seg_color,
      investedCents: cents(invested),
      valueCents: cents(value),
      monthReturnCents: cents(monthReturn),
      monthReturnPercent: value > 0 ? (monthReturn / value) * 100 : 0,
      gainCents: cents(value - invested),
      gainPercent: invested > 0 ? ((value - invested) / invested) * 100 : 0,
      dividendCents: cents(Number(r.dividend_month)),
      weightPercent: total > 0 ? (value / total) * 100 : 0,
    };
  });

  // Agrupa por segmento e calcula o desvio da alocacao-alvo.
  const bySegment = new Map<
    string,
    { name: string; color: string; target: number | null; assets: AssetRow[] }
  >();
  for (const r of rows) {
    if (!bySegment.has(r.seg_id)) {
      bySegment.set(r.seg_id, {
        name: r.seg_name,
        color: r.seg_color,
        target: r.target != null ? Number(r.target) : null,
        assets: [],
      });
    }
    const asset = assets.find((a) => a.id === r.id);
    if (asset) bySegment.get(r.seg_id)?.assets.push(asset);
  }

  const allocated = allocation(
    [...bySegment.entries()].map(([id, seg]) => ({
      name: id,
      valueCents: cents(seg.assets.reduce<number>((acc, a) => acc + a.valueCents, 0)),
      targetPercent: seg.target,
    }))
  );

  const segments: SegmentRow[] = allocated.map((alloc) => {
    const seg = bySegment.get(alloc.name);
    const list = seg?.assets ?? [];
    return {
      id: alloc.name,
      name: seg?.name ?? "—",
      color: seg?.color ?? "var(--fg-mut)",
      assetCount: list.length,
      valueCents: alloc.valueCents,
      investedCents: cents(list.reduce<number>((acc, a) => acc + a.investedCents, 0)),
      monthReturnCents: cents(list.reduce<number>((acc, a) => acc + a.monthReturnCents, 0)),
      currentPercent: alloc.currentPercent,
      targetPercent: seg?.target ?? null,
      deviationPP: alloc.deviationPP,
      onTarget: alloc.onTarget,
    };
  });

  // Metas: manual, vinculada a segmento, ou soma de ativos escolhidos.
  const goalRows = await db.execute<{
    id: string;
    name: string;
    color: string;
    target_cents: string;
    source_mode: string;
    manual_cents: string | null;
    linked_segment_id: string | null;
    deadline_label: string | null;
  }>(sql`
    select id, name, color, target_cents::text, source_mode,
           manual_amount_cents::text as manual_cents, linked_segment_id, deadline_label
      from goals where user_id = ${ctx.userId} order by sort_order
  `);

  const goals: GoalRow[] = goalRows.rows.map((g) => {
    const current =
      g.source_mode === "linked_segment"
        ? (segments.find((s) => s.id === g.linked_segment_id)?.valueCents ?? 0)
        : Number(g.manual_cents ?? 0);
    const progress = goalProgress(cents(current), cents(Number(g.target_cents)));
    return {
      id: g.id,
      name: g.name,
      color: g.color,
      currentCents: progress.currentCents,
      targetCents: progress.targetCents,
      percent: progress.percent,
      reached: progress.reached,
      deadlineLabel: g.deadline_label,
    };
  });

  const invested = assets.reduce<number>((acc, a) => acc + a.investedCents, 0);
  const monthReturn = assets.reduce<number>((acc, a) => acc + a.monthReturnCents, 0);
  const reserve = segments.find((s) => s.name.startsWith("Reserva"))?.valueCents ?? cents(0);

  return {
    totalCents: cents(total),
    investedCents: cents(invested),
    gainCents: cents(total - invested),
    gainPercent: invested > 0 ? ((total - invested) / invested) * 100 : 0,
    monthReturnCents: cents(monthReturn),
    monthReturnPercent: total > 0 ? (monthReturn / total) * 100 : 0,
    dividendCents: cents(assets.reduce<number>((acc, a) => acc + a.dividendCents, 0)),
    contributionCents: cents(rows.reduce<number>((acc, r) => acc + Number(r.contributed_month), 0)),
    runwayMonths: monthsOfRunway(reserve, monthlyExpenseCents),
    segments,
    assets,
    goals,
  };
}
